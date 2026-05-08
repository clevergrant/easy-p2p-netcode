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

  // Cap the entire wait — if the host never sends an offer (because they're
  // gone), `ondatachannel` never fires and channelPromise hangs forever
  // without this. The timeout originally only covered awaitChannelOpen, which
  // never even runs in the no-offer case.
  const totalTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('connect to host timed out')),
      totalTimeoutMs,
    )
  })

  // The polling loop will detect a deleted lobby via repeated 4xx responses
  // and surface a fatal-error signal long before the timeout expires. Race
  // against it so we abort in ~1-2s instead of waiting the full 15s when
  // the host's gone for good.
  const fatalPromise = opts.signaling.awaitFatalError().then((reason) => {
    throw new Error(`signaling fatal: ${reason}`)
  }) as Promise<never>

  try {
    const channel = await Promise.race([channelPromise, timeoutPromise, fatalPromise])
    return await Promise.race([
      awaitChannelOpen(pc, channel, totalTimeoutMs),
      fatalPromise,
    ])
  } catch (err) {
    try {
      pc.close()
    } catch {
      // already closed
    }
    throw err
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    unsubscribe()
  }
}
