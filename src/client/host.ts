import type { ProtocolDef, SchemaMap, IntentMessage, EventMessage } from '../shared/protocol.ts'
import type { PeerId } from '../shared/peer-id.ts'
import { PeerToPeerSignal } from '../shared/signaling-msgs.ts'
import { validateMessage } from '../shared/validation.ts'
import { SignalingClient } from './signaling-client.ts'
import { PeerRegistry } from './peer-registry.ts'
import { TokenBucketLimiter, type RateLimitConfig } from './rate-limit.ts'
import { acceptPeer } from './accept-peer.ts'
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
}

export interface Host<P extends ProtocolDef<SchemaMap, SchemaMap>> {
  readonly lobbyCode: string
  readonly peerId: PeerId
  broadcast(event: EventMessage<P>): void
  send(peerId: PeerId, event: EventMessage<P>): void
  kick(peerId: PeerId): void
  lockLobby(): Promise<void>
  unlockLobby(): Promise<void>
  close(): Promise<void>
}

export async function createHost<P extends ProtocolDef<SchemaMap, SchemaMap>>(
  opts: CreateHostOptions<P>,
): Promise<Host<P>> {
  const signaling = new SignalingClient({ signalingUrl: opts.signalingUrl })
  const { lobbyCode, peerId: hostPeerId } = await signaling.createLobby()
  if (opts.startLocked) await signaling.setLocked(true)

  const registry = new PeerRegistry()
  const limiter = new TokenBucketLimiter(opts.rateLimit)

  signaling.subscribe(async (from, raw) => {
    if (from !== hostPeerId) return
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
      opts.onPeerJoined?.(remoteId, role)
    } catch (err) {
      opts.onError?.(remoteId, err instanceof Error ? err.message : 'failed to accept peer')
    }
  }

  function onPeerLeft(remoteId: PeerId): void {
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
    if (role !== 'player') return
    if (!limiter.consume(remoteId)) {
      opts.onError?.(remoteId, 'rate limit exceeded')
      return
    }
    let raw: unknown
    try {
      raw = JSON.parse(data)
    } catch {
      opts.onError?.(remoteId, 'invalid JSON')
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
    async close() {
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
