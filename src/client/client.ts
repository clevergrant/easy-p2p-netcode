import type { ProtocolDef, SchemaMap, IntentMessage, EventMessage } from '../shared/protocol.ts'
import type { PeerId } from '../shared/peer-id.ts'
import { validateMessage } from '../shared/validation.ts'
import { SignalingClient } from './signaling-client.ts'
import { connectToHost } from './connect-to-host.ts'
import { isCtrlMessage, startHeartbeat } from './heartbeat.ts'
import type { PeerRole } from './roles.ts'

export interface CreateClientOptions<P extends ProtocolDef<SchemaMap, SchemaMap>> {
  signalingUrl: string
  lobbyCode: string
  protocol: P
  onEvent: (event: EventMessage<P>) => void
  onDisconnect?: () => void
  onError?: (reason: string) => void
  iceServers?: RTCIceServer[]
  // Resume an existing player session after a refresh. When present,
  // createClient skips joinLobby and instead calls resume with the saved
  // peerId + peerToken. The server synthesizes a peer-joined into the host's
  // mailbox so the WebRTC handshake re-runs.
  resume?: { peerId: PeerId; peerToken: string }
}

interface BaseClient {
  readonly peerId: PeerId
  readonly hostPeerId: PeerId
  readonly peerToken: string
  // Promote ourselves to host. Server enforces the silence window; throws if
  // the previous host hasn't been silent long enough or if our peerToken is
  // stale. On success the caller should immediately detach() this client and
  // call createHost({ resume }) with the returned hostToken.
  claimHost(): Promise<{ hostToken: string }>
  // Stop locally without notifying the server. Use during host migration or
  // resume: a regular close() sends a 'close' action that removes our
  // peerToken (or deletes the whole lobby if we just became host via
  // claimHost), which breaks the upcoming resume.
  detach(): void
  close(): Promise<void>
}

export interface PlayerClient<P extends ProtocolDef<SchemaMap, SchemaMap>> extends BaseClient {
  readonly role: 'player'
  send(intent: IntentMessage<P>): void
}

export interface SpectatorClient extends BaseClient {
  readonly role: 'spectator'
}

export type Client<P extends ProtocolDef<SchemaMap, SchemaMap>> = PlayerClient<P> | SpectatorClient

export async function createClient<P extends ProtocolDef<SchemaMap, SchemaMap>>(
  opts: CreateClientOptions<P>,
): Promise<Client<P>> {
  const signaling = new SignalingClient({ signalingUrl: opts.signalingUrl })
  let peerId: PeerId
  let hostPeerId: PeerId
  let role: 'player' | 'spectator'
  let peerToken: string
  if (opts.resume) {
    const r = await signaling.resumeLobby({
      lobbyCode: opts.lobbyCode,
      peerId: opts.resume.peerId,
      token: opts.resume.peerToken,
    })
    if (r.isHost) throw new Error('resume token belongs to the host, not a player')
    peerId = r.peerId
    hostPeerId = r.hostPeerId
    role = r.role
    peerToken = opts.resume.peerToken
  } else {
    const joined = await signaling.joinLobby(opts.lobbyCode)
    peerId = joined.peerId
    hostPeerId = joined.hostPeerId
    role = joined.role
    peerToken = joined.peerToken
  }
  signaling.startPolling()

  let transport
  try {
    transport = await connectToHost({
      signaling,
      hostPeerId,
      ...(opts.iceServers !== undefined && { iceServers: opts.iceServers }),
    })
  } catch (err) {
    // connectToHost can hang for ~15s waiting for an offer that never comes
    // (host is dead). If we let signaling keep polling after the throw, the
    // orphaned SignalingClient consumes our mailbox forever and competes with
    // the next retry attempt. Stop it before propagating.
    signaling.detach()
    throw err
  }

  // Suppress the disconnect callback when the caller is tearing the client
  // down intentionally (close / claimHost / becomeHost transition). Only an
  // unsolicited transport drop should surface as a disconnect.
  let closing = false
  function fireDisconnect(): void {
    if (closing) return
    closing = true
    opts.onDisconnect?.()
  }

  const heartbeat = startHeartbeat({
    transport,
    onTimeout: fireDisconnect,
  })

  transport.onMessage = (data) => {
    heartbeat.bump()
    let raw: unknown
    try {
      raw = JSON.parse(data)
    } catch {
      opts.onError?.('invalid JSON from host')
      return
    }
    if (isCtrlMessage(raw)) {
      if (raw.__ctrl === 'leaving') fireDisconnect()
      // 'hb' just bumped the heartbeat above; ignore.
      return
    }
    const result = validateMessage(opts.protocol.events, raw)
    if (!result.ok) {
      opts.onError?.(result.reason)
      return
    }
    opts.onEvent(result.value as EventMessage<P>)
  }
  transport.onClose = fireDisconnect

  const base: BaseClient = {
    peerId,
    hostPeerId,
    peerToken,
    async claimHost() {
      return signaling.claimHost({ lobbyCode: opts.lobbyCode, peerId, peerToken })
    },
    detach() {
      closing = true
      heartbeat.stop()
      try {
        transport.close()
      } catch {
        // already closed
      }
      signaling.detach()
    },
    async close() {
      closing = true
      heartbeat.stop()
      try {
        transport.close()
      } catch {
        // already closed
      }
      await signaling.close()
    },
  }

  if (role === 'player') {
    return {
      ...base,
      role: 'player',
      send(intent) {
        transport.send(JSON.stringify(intent))
      },
    } satisfies PlayerClient<P>
  }
  return { ...base, role: 'spectator' } satisfies SpectatorClient
}
