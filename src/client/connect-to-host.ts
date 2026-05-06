import type { PeerId } from '../shared/peer-id.ts'
import { PeerToPeerSignal } from '../shared/signaling-msgs.ts'
import type { SignalingClient } from './signaling-client.ts'
import type { Transport } from './transport/transport.ts'
import {
  applyRemoteSignal,
  createAnswerSignal,
  createPeerConnection,
} from './transport/webrtc-handshake.ts'
import { awaitChannelOpen } from './transport/webrtc-transport.ts'

export interface ConnectToHostOptions {
  signaling: SignalingClient
  hostPeerId: PeerId
  iceServers?: RTCIceServer[]
  connectTimeoutMs?: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000

export async function connectToHost(opts: ConnectToHostOptions): Promise<Transport> {
  const pc = createPeerConnection({
    ...(opts.iceServers !== undefined && { iceServers: opts.iceServers }),
    sendSignal: (sig) => opts.signaling.sendSignal(opts.hostPeerId, sig),
  })

  const channelPromise = new Promise<RTCDataChannel>((resolve) => {
    pc.ondatachannel = (ev) => resolve(ev.channel)
  })

  const unsubscribe = opts.signaling.subscribe(async (from, raw) => {
    if (from !== opts.hostPeerId) return
    const parsed = PeerToPeerSignal.safeParse(raw)
    if (!parsed.success) return
    if (parsed.data.kind === 'offer') {
      await applyRemoteSignal(pc, parsed.data)
      const answer = await createAnswerSignal(pc)
      await opts.signaling.sendSignal(opts.hostPeerId, answer)
    } else if (parsed.data.kind === 'ice') {
      await applyRemoteSignal(pc, parsed.data)
    }
  })

  try {
    const channel = await channelPromise
    return await awaitChannelOpen(pc, channel, opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)
  } finally {
    unsubscribe()
  }
}
