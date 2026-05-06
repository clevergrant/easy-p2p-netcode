import type { PeerToPeerSignal } from '../../shared/signaling-msgs.ts'

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export interface PeerHandshakeOptions {
  iceServers?: RTCIceServer[]
  sendSignal: (signal: PeerToPeerSignal) => void | Promise<void>
}

export function createPeerConnection(opts: PeerHandshakeOptions): RTCPeerConnection {
  const pc = new RTCPeerConnection({
    iceServers: opts.iceServers ?? DEFAULT_ICE_SERVERS,
  })
  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return
    void opts.sendSignal({
      kind: 'ice',
      candidate: ev.candidate.candidate,
      sdpMid: ev.candidate.sdpMid,
      sdpMLineIndex: ev.candidate.sdpMLineIndex,
    })
  }
  return pc
}

export async function applyRemoteSignal(pc: RTCPeerConnection, signal: PeerToPeerSignal): Promise<void> {
  if (signal.kind === 'offer') {
    await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
  } else if (signal.kind === 'answer') {
    await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
  } else if (signal.kind === 'ice') {
    await pc.addIceCandidate({
      candidate: signal.candidate,
      sdpMid: signal.sdpMid,
      sdpMLineIndex: signal.sdpMLineIndex,
    })
  }
}

export async function createOfferSignal(pc: RTCPeerConnection): Promise<PeerToPeerSignal> {
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  return { kind: 'offer', sdp: offer.sdp! }
}

export async function createAnswerSignal(pc: RTCPeerConnection): Promise<PeerToPeerSignal> {
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  return { kind: 'answer', sdp: answer.sdp! }
}
