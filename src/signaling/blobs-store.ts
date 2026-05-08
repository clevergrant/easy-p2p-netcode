import type { LobbyState, SignalingStore } from './store.ts'

export interface BlobLikeStore {
  get(key: string, opts?: { type?: 'json' }): Promise<unknown>
  setJSON(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

export function createBlobsStore(blobs: BlobLikeStore): SignalingStore {
  function key(code: string): string {
    return `lobby:${code}`
  }

  return {
    async createLobby(lobbyCode, hostPeerId, hostToken, expiresAt) {
      const state: LobbyState = {
        hostPeerId,
        hostToken,
        hostLastSeenAt: Date.now(),
        locked: false,
        members: { [hostPeerId]: 'player' },
        peerTokens: {},
        mailboxes: { [hostPeerId]: [] },
        expiresAt,
      }
      await blobs.setJSON(key(lobbyCode), state)
    },

    async getLobby(lobbyCode) {
      const raw = (await blobs.get(key(lobbyCode), { type: 'json' })) as LobbyState | null
      if (!raw) return null
      if (raw.expiresAt < Date.now()) return null
      return raw
    },

    async updateLobby(lobbyCode, mutator) {
      const current = (await blobs.get(key(lobbyCode), { type: 'json' })) as LobbyState | null
      if (!current) return null
      if (current.expiresAt < Date.now()) return null
      const next = mutator(current)
      await blobs.setJSON(key(lobbyCode), next)
      return next
    },

    async deleteLobby(lobbyCode) {
      await blobs.delete(key(lobbyCode))
    },
  }
}
