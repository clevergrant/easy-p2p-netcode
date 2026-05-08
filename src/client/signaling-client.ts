import type { PeerToPeerSignal } from '../shared/signaling-msgs.ts'
import type { PeerId } from '../shared/peer-id.ts'
import type { PeerRole } from './roles.ts'

export interface SignalingClientOptions {
  signalingUrl: string
  pollIntervalMs?: number
}

export interface CreateLobbyResult {
  lobbyCode: string
  peerId: PeerId
  hostToken: string
}

export interface JoinLobbyResult {
  peerId: PeerId
  hostPeerId: PeerId
  role: PeerRole
  peerToken: string
}

export interface ResumeLobbyResult {
  peerId: PeerId
  hostPeerId: PeerId
  role: PeerRole
  isHost: boolean
}

export interface ResumeOptions {
  lobbyCode: string
  peerId: PeerId
  token: string
}

export interface ClaimHostResult {
  hostPeerId: PeerId
  hostToken: string
}

export type SignalSubscriber = (from: PeerId, signal: PeerToPeerSignal) => void

const DEFAULT_POLL_INTERVAL_MS = 750

// After this many consecutive 'lobby not found / expired' poll responses, the
// SignalingClient declares the lobby fatally gone and stops polling. Two is
// enough to filter brief eventual-consistency hiccups while staying fast.
const FATAL_LOBBY_GONE_THRESHOLD = 2

export class SignalingClient {
  private readonly url: string
  private readonly pollIntervalMs: number
  private lobbyCode: string | null = null
  private peerId: PeerId | null = null
  private polling = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private subscribers = new Set<SignalSubscriber>()
  // Set when the polling loop has decided the lobby is permanently gone.
  // Anyone waiting on awaitFatalError() resolves with this reason. Once set,
  // it stays set for the lifetime of the SignalingClient — no recovery.
  private fatalReason: string | null = null
  private fatalWaiters: Array<(reason: string) => void> = []

  constructor(opts: SignalingClientOptions) {
    this.url = opts.signalingUrl
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  // Resolves the first time the SignalingClient detects an unrecoverable
  // signaling failure (lobby deleted, etc.). Used by connectToHost/acceptPeer
  // to abort their await loops early instead of waiting for a connect timeout.
  awaitFatalError(): Promise<string> {
    if (this.fatalReason !== null) return Promise.resolve(this.fatalReason)
    return new Promise((resolve) => {
      this.fatalWaiters.push(resolve)
    })
  }

  private signalFatalError(reason: string): void {
    if (this.fatalReason !== null) return
    this.fatalReason = reason
    this.polling = false
    if (this.pollTimer) clearTimeout(this.pollTimer)
    const waiters = this.fatalWaiters
    this.fatalWaiters = []
    for (const w of waiters) w(reason)
  }

  async createLobby(): Promise<CreateLobbyResult> {
    const res = await this.request({ action: 'create' })
    if (!res.ok || res.action !== 'create') throw new Error('createLobby failed')
    this.lobbyCode = res.lobbyCode
    this.peerId = res.peerId
    return { lobbyCode: res.lobbyCode, peerId: res.peerId, hostToken: res.hostToken }
  }

  async joinLobby(lobbyCode: string): Promise<JoinLobbyResult> {
    const res = await this.request({ action: 'join', lobbyCode })
    if (!res.ok || res.action !== 'join') throw new Error('joinLobby failed')
    this.lobbyCode = lobbyCode
    this.peerId = res.peerId
    return {
      peerId: res.peerId,
      hostPeerId: res.hostPeerId,
      role: res.role,
      peerToken: res.peerToken,
    }
  }

  async resumeLobby(opts: ResumeOptions): Promise<ResumeLobbyResult> {
    const res = await this.request({
      action: 'resume',
      lobbyCode: opts.lobbyCode,
      peerId: opts.peerId,
      token: opts.token,
    })
    if (!res.ok) throw new Error(res.error ?? 'resumeLobby failed')
    if (res.action !== 'resume') throw new Error('resumeLobby failed')
    this.lobbyCode = opts.lobbyCode
    this.peerId = opts.peerId
    return {
      peerId: res.peerId,
      hostPeerId: res.hostPeerId,
      role: res.role,
      isHost: res.isHost,
    }
  }

  // Promote ourselves to host. Caller must already have polled signaling and
  // determined the existing host has been silent past the migration window
  // (server enforces that). On success, this client's peerId becomes the new
  // hostPeerId server-side; the returned hostToken is what the caller passes
  // to createHost({ resume }) to take over the lobby.
  async claimHost(opts: { lobbyCode: string; peerId: PeerId; peerToken: string }): Promise<ClaimHostResult> {
    const res = await this.request({
      action: 'claimHost',
      lobbyCode: opts.lobbyCode,
      peerId: opts.peerId,
      token: opts.peerToken,
    })
    if (!res.ok) throw new Error(res.error ?? 'claimHost failed')
    if (res.action !== 'claimHost') throw new Error('claimHost failed')
    return { hostPeerId: res.hostPeerId, hostToken: res.hostToken }
  }

  async setLocked(locked: boolean): Promise<void> {
    this.assertConnected()
    await this.request({
      action: 'lock',
      lobbyCode: this.lobbyCode!,
      peerId: this.peerId!,
      locked,
    })
  }

  async sendSignal(toPeerId: PeerId, signal: PeerToPeerSignal): Promise<void> {
    this.assertConnected()
    await this.request({
      action: 'send',
      lobbyCode: this.lobbyCode!,
      peerId: this.peerId!,
      toPeerId,
      message: signal,
    })
  }

  subscribe(fn: SignalSubscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  startPolling(): void {
    if (this.polling) return
    this.assertConnected()
    this.polling = true
    void this.pollLoop()
  }

  async close(): Promise<void> {
    this.polling = false
    if (this.pollTimer) clearTimeout(this.pollTimer)
    if (this.lobbyCode && this.peerId) {
      try {
        await this.request({
          action: 'close',
          lobbyCode: this.lobbyCode,
          peerId: this.peerId,
        })
      } catch {
        // best-effort; signaling close is non-critical once WebRTC is established
      }
    }
  }

  // Stop polling locally without telling the server we're leaving. Used during
  // host migration / resume flows where the caller is about to spin up a fresh
  // signaling session against the same peerId — calling the regular close()
  // would remove our peerToken (or, if we just won claimHost, delete the
  // whole lobby) and break the upcoming resume.
  detach(): void {
    this.polling = false
    if (this.pollTimer) clearTimeout(this.pollTimer)
  }

  private async pollLoop(): Promise<void> {
    let consecutiveLobbyGone = 0
    while (this.polling) {
      try {
        const res = await this.request({
          action: 'poll',
          lobbyCode: this.lobbyCode!,
          peerId: this.peerId!,
        })
        if (res.ok && res.action === 'poll') {
          consecutiveLobbyGone = 0
          for (const m of res.messages) {
            this.dispatch(m.from, m.message)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('lobby not found') || msg.includes('expired')) {
          consecutiveLobbyGone += 1
          if (consecutiveLobbyGone >= FATAL_LOBBY_GONE_THRESHOLD) {
            this.signalFatalError('lobby gone')
            return
          }
        } else {
          // Network blip / unrelated error — reset so a transient hiccup
          // doesn't fall through into a fatal verdict.
          consecutiveLobbyGone = 0
        }
      }
      await new Promise((resolve) => {
        this.pollTimer = setTimeout(resolve, this.pollIntervalMs)
      })
    }
  }

  private dispatch(from: PeerId, message: unknown): void {
    // Subscribers validate against PeerToPeerSignal; keeping this layer protocol-agnostic.
    for (const sub of this.subscribers) sub(from, message as PeerToPeerSignal)
  }

  private async request(body: unknown): Promise<any> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    // Server returns 4xx for protocol errors with a JSON body of
    // {ok:false, error: "..."}. Surface that error string so callers can
    // distinguish "lobby gone" from "host still active" from a network blip.
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const errorMessage =
        json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
          ? json.error
          : `signaling request failed: ${res.status}`
      throw new Error(errorMessage)
    }
    return json
  }

  private assertConnected(): void {
    if (!this.lobbyCode || !this.peerId) {
      throw new Error('signaling client is not connected to a lobby')
    }
  }
}
