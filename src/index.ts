export { defineProtocol } from './shared/protocol.ts'
export type { ProtocolDef, IntentMessage, EventMessage, SchemaMap } from './shared/protocol.ts'

export { createHost } from './client/host.ts'
export type { Host, CreateHostOptions } from './client/host.ts'

export { createClient } from './client/client.ts'
export type {
  Client,
  PlayerClient,
  SpectatorClient,
  CreateClientOptions,
} from './client/client.ts'

export type { PeerRole } from './client/roles.ts'
export type { PeerId } from './shared/peer-id.ts'

export { normalizeLobbyCode, isValidLobbyCode, LOBBY_CODE_LENGTH } from './shared/lobby-code.ts'
export type { RateLimitConfig } from './client/rate-limit.ts'
