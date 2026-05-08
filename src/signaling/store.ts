import type { PeerRole } from '../client/roles.ts'

export interface LobbyState {
  hostPeerId: string
  hostToken: string
  // Updated on every host-originated action (poll, send, etc.). When this is
  // older than the migration silence threshold, a designated successor is
  // allowed to claim the host slot via the claimHost action.
  hostLastSeenAt: number
  locked: boolean
  members: Record<string, PeerRole>
  // Per-peer resume tokens for non-host peers. Host uses hostToken instead.
  peerTokens: Record<string, string>
  mailboxes: Record<string, Array<{ from: string; message: unknown }>>
  expiresAt: number
}

export interface SignalingStore {
  createLobby(
    lobbyCode: string,
    hostPeerId: string,
    hostToken: string,
    expiresAt: number,
  ): Promise<void>
  getLobby(lobbyCode: string): Promise<LobbyState | null>
  updateLobby(
    lobbyCode: string,
    mutator: (state: LobbyState) => LobbyState,
  ): Promise<LobbyState | null>
  deleteLobby(lobbyCode: string): Promise<void>
}
