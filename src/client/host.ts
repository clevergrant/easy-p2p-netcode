import type { ProtocolDef, SchemaMap, IntentMessage, EventMessage } from '../shared/protocol.ts'
import type { PeerId } from '../shared/peer-id.ts'
import { PeerToPeerSignal } from '../shared/signaling-msgs.ts'
import { validateMessage } from '../shared/validation.ts'
import { SignalingClient } from './signaling-client.ts'
import { PeerRegistry } from './peer-registry.ts'
import { TokenBucketLimiter, type RateLimitConfig } from './rate-limit.ts'
import { acceptPeer } from './accept-peer.ts'
import { LEAVING_MSG, isCtrlMessage, startHeartbeat, type HeartbeatMonitor } from './heartbeat.ts'
import type { PeerRole } from './roles.ts'

export interface CreateHostOptions<P extends ProtocolDef<SchemaMap, SchemaMap>> {
  signalingUrl: string
  protocol: P
  onPeerJoined?: (peerId: PeerId, role: PeerRole) => void
  onPeerLeft?: (peerId: PeerId) => void
  onIntent: (peerId: PeerId, intent: IntentMessage<P>) => void
  onError?: (peerId: PeerId, reason: string) => void
  iceServers?: RTCIceServer[]
  rateLimit?: RateLimitConfig
  startLocked?: boolean
  // Resume an existing host session after a refresh. When present,
  // createHost skips lobby creation and re-attaches signaling polling using
  // the saved peerId + hostToken. Players whose mailboxes are still alive on
  // the signaling backend will reconnect via synthesized peer-joined events
  // emitted by handleResume on the player's side.
  resume?: { lobbyCode: string; peerId: PeerId; hostToken: string }
}

export interface Host<P extends ProtocolDef<SchemaMap, SchemaMap>> {
  readonly lobbyCode: string
  readonly peerId: PeerId
  readonly hostToken: string
  broadcast(event: EventMessage<P>): void
  send(peerId: PeerId, event: EventMessage<P>): void
  kick(peerId: PeerId): void
  lockLobby(): Promise<void>
  unlockLobby(): Promise<void>
  // Best-effort: notify peers that the host is going away cleanly. Synchronous
  // because it's typically called from beforeunload, where async work doesn't
  // complete. Peers receive {__ctrl:'leaving'} and skip the heartbeat-timeout
  // wait, treating it as an immediate disconnect.
  notifyLeaving(): void
  close(): Promise<void>
}

export async function createHost<P extends ProtocolDef<SchemaMap, SchemaMap>>(
  opts: CreateHostOptions<P>,
): Promise<Host<P>> {
  const signaling = new SignalingClient({ signalingUrl: opts.signalingUrl })
  let lobbyCode: string
  let hostPeerId: PeerId
  let hostToken: string
  if (opts.resume) {
    const r = await signaling.resumeLobby({
      lobbyCode: opts.resume.lobbyCode,
      peerId: opts.resume.peerId,
      token: opts.resume.hostToken,
    })
    if (!r.isHost) throw new Error('resume token did not match host')
    lobbyCode = opts.resume.lobbyCode
    hostPeerId = opts.resume.peerId
    hostToken = opts.resume.hostToken
  } else {
    const created = await signaling.createLobby()
    lobbyCode = created.lobbyCode
    hostPeerId = created.peerId
    hostToken = created.hostToken
  }
  if (opts.startLocked) await signaling.setLocked(true)

  const registry = new PeerRegistry()
  const limiter = new TokenBucketLimiter(opts.rateLimit)
  const heartbeats = new Map<PeerId, HeartbeatMonitor>()

  signaling.subscribe(async (_from, raw) => {
    // Peer-joined / peer-left notifications are server-synthesized and addressed
    // to the host. Their `from` field is the affected peer's id, not the host's,
    // so we don't filter on `from` here — the discriminator on `kind` is enough.
    // Offer/answer/ice signals for individual peers are handled separately in
    // acceptPeer's per-peer subscriber.
    const parsed = PeerToPeerSignal.safeParse(raw)
    if (!parsed.success) return
    if (parsed.data.kind === 'peer-joined') {
      await onPeerJoined(parsed.data.peerId, parsed.data.role)
    } else if (parsed.data.kind === 'peer-left') {
      onPeerLeft(parsed.data.peerId)
    }
  })
  signaling.startPolling()

  async function onPeerJoined(remoteId: PeerId, role: PeerRole): Promise<void> {
    try {
      const transport = await acceptPeer({
        signaling,
        remotePeerId: remoteId,
        ...(opts.iceServers !== undefined && { iceServers: opts.iceServers }),
      })
      registry.add({ peerId: remoteId, role, transport })
      transport.onMessage = (data) => handleIncoming(remoteId, role, data)
      transport.onClose = () => onPeerLeft(remoteId)
      heartbeats.set(
        remoteId,
        startHeartbeat({ transport, onTimeout: () => onPeerLeft(remoteId) }),
      )
      opts.onPeerJoined?.(remoteId, role)
    } catch (err) {
      opts.onError?.(remoteId, err instanceof Error ? err.message : 'failed to accept peer')
    }
  }

  function onPeerLeft(remoteId: PeerId): void {
    heartbeats.get(remoteId)?.stop()
    heartbeats.delete(remoteId)
    const entry = registry.remove(remoteId)
    if (!entry) return
    limiter.forget(remoteId)
    try {
      entry.transport.close()
    } catch {
      // already closed; ignore
    }
    opts.onPeerLeft?.(remoteId)
  }

  function handleIncoming(remoteId: PeerId, role: PeerRole, data: string): void {
    // Any inbound traffic counts as proof-of-life — bump before any other
    // gating so a peer being rate-limited doesn't get falsely declared dead.
    heartbeats.get(remoteId)?.bump()
    let raw: unknown
    try {
      raw = JSON.parse(data)
    } catch {
      opts.onError?.(remoteId, 'invalid JSON')
      return
    }
    if (isCtrlMessage(raw)) {
      if (raw.__ctrl === 'leaving') onPeerLeft(remoteId)
      // 'hb' just bumps lastSeenAt above; ignore.
      return
    }
    if (role !== 'player') return
    if (!limiter.consume(remoteId)) {
      opts.onError?.(remoteId, 'rate limit exceeded')
      return
    }
    const result = validateMessage(opts.protocol.intents, raw)
    if (!result.ok) {
      opts.onError?.(remoteId, result.reason)
      return
    }
    opts.onIntent(remoteId, result.value as IntentMessage<P>)
  }

  function sendTo(entry: { transport: { send(s: string): void } }, event: EventMessage<P>): void {
    entry.transport.send(JSON.stringify(event))
  }

  return {
    lobbyCode,
    peerId: hostPeerId,
    hostToken,
    broadcast(event) {
      for (const entry of registry.all()) {
        try {
          sendTo(entry, event)
        } catch {
          // peer transport closed mid-broadcast; cleanup happens via onClose
        }
      }
    },
    send(remoteId, event) {
      const entry = registry.get(remoteId)
      if (!entry) throw new Error(`unknown peer ${remoteId}`)
      sendTo(entry, event)
    },
    kick(remoteId) {
      onPeerLeft(remoteId)
    },
    async lockLobby() {
      await signaling.setLocked(true)
    },
    async unlockLobby() {
      await signaling.setLocked(false)
    },
    notifyLeaving() {
      for (const entry of registry.all()) {
        try {
          entry.transport.send(LEAVING_MSG)
        } catch {
          // best effort; transport may have died
        }
      }
    },
    async close() {
      for (const monitor of heartbeats.values()) monitor.stop()
      heartbeats.clear()
      for (const entry of registry.all()) {
        try {
          entry.transport.close()
        } catch {
          // ignore
        }
      }
      await signaling.close()
    },
  }
}
