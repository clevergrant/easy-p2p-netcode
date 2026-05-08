import type { Transport } from './transport/transport.ts'

// App-level heartbeat over the data channel. Browser ICE/DTLS timeouts take
// 20–40s to declare a peer dead, which is too slow for a party-game UX. We
// piggyback on the data channel itself: send a tiny ctrl ping every 2s,
// declare the peer dead after 5s of silence (any traffic counts as alive).
// Numbers match common practice in PeerJS / discuss-webrtc threads and
// Halo:Reach network keepalives.
export const HEARTBEAT_INTERVAL_MS = 2000
export const HEARTBEAT_TIMEOUT_MS = 5000
export const HEARTBEAT_MSG = JSON.stringify({ __ctrl: 'hb' })
export const LEAVING_MSG = JSON.stringify({ __ctrl: 'leaving' })

export interface CtrlMessage {
  __ctrl: 'hb' | 'leaving'
}

export function isCtrlMessage(raw: unknown): raw is CtrlMessage {
  return (
    !!raw &&
    typeof raw === 'object' &&
    '__ctrl' in raw &&
    typeof (raw as { __ctrl: unknown }).__ctrl === 'string'
  )
}

export interface HeartbeatMonitor {
  // Call on every inbound message — any traffic counts as proof-of-life,
  // not just the ctrl pings, so a busy connection never falsely times out.
  bump(): void
  // Cancel the send/watch intervals. Idempotent.
  stop(): void
}

export interface StartHeartbeatOptions {
  transport: Transport
  onTimeout: () => void
  intervalMs?: number
  timeoutMs?: number
}

export function startHeartbeat(opts: StartHeartbeatOptions): HeartbeatMonitor {
  const intervalMs = opts.intervalMs ?? HEARTBEAT_INTERVAL_MS
  const timeoutMs = opts.timeoutMs ?? HEARTBEAT_TIMEOUT_MS
  let lastSeenAt = Date.now()
  let stopped = false
  const sendTimer = setInterval(() => {
    try {
      opts.transport.send(HEARTBEAT_MSG)
    } catch {
      // transport mid-close; cleanup happens via watchdog or explicit stop
    }
  }, intervalMs)
  const watchTimer = setInterval(() => {
    if (Date.now() - lastSeenAt > timeoutMs) {
      opts.onTimeout()
    }
  }, 1000)
  return {
    bump() {
      lastSeenAt = Date.now()
    },
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(sendTimer)
      clearInterval(watchTimer)
    },
  }
}
