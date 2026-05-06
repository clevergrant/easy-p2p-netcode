import type { PeerId } from '../shared/peer-id.ts'
import { PeerToPeerSignal } from '../shared/signaling-msgs.ts'
import type { SignalingClient } from './signaling-client.ts'
import type { Transport } from './transport/transport.ts'
import {
  applyRemoteSignal,
  createOfferSignal,
  createPeerConnection,
} from './transport/webrtc-handshake.ts'
import { awaitChannelOpen } from './transport/webrtc-transport.ts'

export interface AcceptPeerOptions {
  signaling: SignalingClient
  remotePeerId: PeerId
  iceServers?: RTCIceServer[]
  connectTimeoutMs?: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000

export async function acceptPeer(opts: AcceptPeerOptions): Promise<Transport> {
  const pc = createPeerConnection({
    ...(opts.iceServers !== undefined && { iceServers: opts.iceServers }),
    sendSignal: (sig) => opts.signaling.sendSignal(opts.remotePeerId, sig),
  })

  const channel = pc.createDataChannel('netcode', { ordered: true })

  const unsubscribe = opts.signaling.subscribe(async (from, raw) => {
    if (from !== opts.remotePeerId) return
    const parsed = PeerToPeerSignal.safeParse(raw)
    if (!parsed.success) return
    if (parsed.data.kind === 'offer' || parsed.data.kind === 'peer-joined') return
    await applyRemoteSignal(pc, parsed.data)
  })

  const offer = await createOfferSignal(pc)
  await opts.signaling.sendSignal(opts.remotePeerId, offer)

  try {
    return await awaitChannelOpen(pc, channel, opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)
  } finally {
    unsubscribe()
  }
}
