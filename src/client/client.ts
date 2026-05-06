import type { ProtocolDef, SchemaMap, IntentMessage, EventMessage } from '../shared/protocol.ts'
import type { PeerId } from '../shared/peer-id.ts'
import { validateMessage } from '../shared/validation.ts'
import { SignalingClient } from './signaling-client.ts'
import { connectToHost } from './connect-to-host.ts'
import type { PeerRole } from './roles.ts'

export interface CreateClientOptions<P extends ProtocolDef<SchemaMap, SchemaMap>> {
  signalingUrl: string
  lobbyCode: string
  protocol: P
  onEvent: (event: EventMessage<P>) => void
  onDisconnect?: () => void
  onError?: (reason: string) => void
  iceServers?: RTCIceServer[]
}

interface BaseClient {
  readonly peerId: PeerId
  readonly hostPeerId: PeerId
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
  const { peerId, hostPeerId, role } = await signaling.joinLobby(opts.lobbyCode)
  signaling.startPolling()

  const transport = await connectToHost({
    signaling,
    hostPeerId,
    ...(opts.iceServers !== undefined && { iceServers: opts.iceServers }),
  })

  transport.onMessage = (data) => {
    let raw: unknown
    try {
      raw = JSON.parse(data)
    } catch {
      opts.onError?.('invalid JSON from host')
      return
    }
    const result = validateMessage(opts.protocol.events, raw)
    if (!result.ok) {
      opts.onError?.(result.reason)
      return
    }
    opts.onEvent(result.value as EventMessage<P>)
  }
  transport.onClose = () => opts.onDisconnect?.()

  const base: BaseClient = {
    peerId,
    hostPeerId,
    async close() {
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
