import type { LobbyState, SignalingStore } from '../../src/signaling/store.ts'

export function createMemoryStore(): SignalingStore {
  const lobbies = new Map<string, LobbyState>()
  return {
    async createLobby(code, hostPeerId, hostToken, expiresAt) {
      lobbies.set(code, {
        hostPeerId,
        hostToken,
        hostLastSeenAt: Date.now(),
        locked: false,
        members: { [hostPeerId]: 'player' },
        peerTokens: {},
        mailboxes: { [hostPeerId]: [] },
        expiresAt,
      })
    },
    async getLobby(code) {
      const lobby = lobbies.get(code)
      if (!lobby) return null
      if (lobby.expiresAt < Date.now()) return null
      return lobby
    },
    async updateLobby(code, mutator) {
      const current = lobbies.get(code)
      if (!current) return null
      if (current.expiresAt < Date.now()) return null
      const next = mutator(current)
      lobbies.set(code, next)
      return next
    },
    async deleteLobby(code) {
      lobbies.delete(code)
    },
  }
}
