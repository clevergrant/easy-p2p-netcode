import type { PeerRole } from '../client/roles.ts'

export interface LobbyState {
  hostPeerId: string
  locked: boolean
  members: Record<string, PeerRole>
  mailboxes: Record<string, Array<{ from: string; message: unknown }>>
  expiresAt: number
}

export interface SignalingStore {
  createLobby(lobbyCode: string, hostPeerId: string, expiresAt: number): Promise<void>
  getLobby(lobbyCode: string): Promise<LobbyState | null>
  updateLobby(lobbyCode: string, mutator: (state: LobbyState) => LobbyState): Promise<LobbyState | null>
  deleteLobby(lobbyCode: string): Promise<void>
}
