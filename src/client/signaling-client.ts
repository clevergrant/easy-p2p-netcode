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
}

export interface JoinLobbyResult {
  peerId: PeerId
  hostPeerId: PeerId
  role: PeerRole
}

export type SignalSubscriber = (from: PeerId, signal: PeerToPeerSignal) => void

const DEFAULT_POLL_INTERVAL_MS = 750

export class SignalingClient {
  private readonly url: string
  private readonly pollIntervalMs: number
  private lobbyCode: string | null = null
  private peerId: PeerId | null = null
  private polling = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private subscribers = new Set<SignalSubscriber>()

  constructor(opts: SignalingClientOptions) {
    this.url = opts.signalingUrl
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  async createLobby(): Promise<CreateLobbyResult> {
    const res = await this.request({ action: 'create' })
    if (!res.ok || res.action !== 'create') throw new Error('createLobby failed')
    this.lobbyCode = res.lobbyCode
    this.peerId = res.peerId
    return { lobbyCode: res.lobbyCode, peerId: res.peerId }
  }

  async joinLobby(lobbyCode: string): Promise<JoinLobbyResult> {
    const res = await this.request({ action: 'join', lobbyCode })
    if (!res.ok || res.action !== 'join') throw new Error('joinLobby failed')
    this.lobbyCode = lobbyCode
    this.peerId = res.peerId
    return { peerId: res.peerId, hostPeerId: res.hostPeerId, role: res.role }
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

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const res = await this.request({
          action: 'poll',
          lobbyCode: this.lobbyCode!,
          peerId: this.peerId!,
        })
        if (res.ok && res.action === 'poll') {
          for (const m of res.messages) {
            this.dispatch(m.from, m.message)
          }
        }
      } catch {
        // network blip — keep trying
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
    if (!res.ok) throw new Error(`signaling request failed: ${res.status}`)
    return res.json()
  }

  private assertConnected(): void {
    if (!this.lobbyCode || !this.peerId) {
      throw new Error('signaling client is not connected to a lobby')
    }
  }
}
