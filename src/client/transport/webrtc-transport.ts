import type { Transport, TransportState } from './transport.ts'

export function awaitChannelOpen(
  pc: RTCPeerConnection,
  channel: RTCDataChannel,
  timeoutMs: number,
): Promise<Transport> {
  return new Promise<Transport>((resolve, reject) => {
    if (channel.readyState === 'open') {
      resolve(wrapDataChannel(channel, pc))
      return
    }
    const timer = setTimeout(() => {
      pc.close()
      reject(new Error('peer connection timed out before data channel opened'))
    }, timeoutMs)
    channel.addEventListener('open', () => {
      clearTimeout(timer)
      resolve(wrapDataChannel(channel, pc))
    })
    channel.addEventListener('error', () => {
      clearTimeout(timer)
      pc.close()
      reject(new Error('data channel errored before opening'))
    })
  })
}

export function wrapDataChannel(channel: RTCDataChannel, peerConnection: RTCPeerConnection): Transport {
  const transport: Transport = {
    get state(): TransportState {
      if (channel.readyState === 'open') return 'open'
      if (channel.readyState === 'closed' || channel.readyState === 'closing') return 'closed'
      return 'connecting'
    },
    send(data: string) {
      if (channel.readyState !== 'open') {
        throw new Error(`cannot send on transport in state "${channel.readyState}"`)
      }
      channel.send(data)
    },
    close() {
      try {
        channel.close()
      } finally {
        peerConnection.close()
      }
    },
    onOpen: null,
    onMessage: null,
    onClose: null,
    onError: null,
  }

  channel.onopen = () => transport.onOpen?.()
  channel.onmessage = (ev) => {
    if (typeof ev.data === 'string') transport.onMessage?.(ev.data)
  }
  channel.onclose = () => transport.onClose?.()
  channel.onerror = (ev) => {
    const err = (ev as RTCErrorEvent).error ?? new Error('data channel error')
    transport.onError?.(err)
  }

  return transport
}
