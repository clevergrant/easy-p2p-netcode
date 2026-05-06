import type { PeerId } from '../shared/peer-id.ts'
import type { Transport } from './transport/transport.ts'
import type { PeerRole } from './roles.ts'

export interface PeerEntry {
  peerId: PeerId
  role: PeerRole
  transport: Transport
}

export class PeerRegistry {
  private readonly peers = new Map<PeerId, PeerEntry>()

  add(entry: PeerEntry): void {
    this.peers.set(entry.peerId, entry)
  }

  remove(peerId: PeerId): PeerEntry | undefined {
    const entry = this.peers.get(peerId)
    if (entry) this.peers.delete(peerId)
    return entry
  }

  get(peerId: PeerId): PeerEntry | undefined {
    return this.peers.get(peerId)
  }

  all(): PeerEntry[] {
    return Array.from(this.peers.values())
  }

  byRole(role: PeerRole): PeerEntry[] {
    return this.all().filter((p) => p.role === role)
  }

  size(): number {
    return this.peers.size
  }
}
