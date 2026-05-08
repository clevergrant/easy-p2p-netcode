import { generateLobbyCode, isValidLobbyCode } from '../shared/lobby-code.ts'
import { generatePeerId, generateResumeToken } from '../shared/peer-id.ts'
import type { SignalingResponse } from '../shared/signaling-msgs.ts'
import type { SignalingStore } from './store.ts'

const DEFAULT_LOBBY_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
// How long the host must be silent before a successor is allowed to claim the
// host slot. Picked to be longer than a refresh blip but short enough that
// players don't sit on a dead lobby for ages.
const HOST_MIGRATION_SILENCE_MS = 10_000

export async function handleCreate(store: SignalingStore): Promise<SignalingResponse> {
  const lobbyCode = generateLobbyCode()
  const hostPeerId = generatePeerId()
  const hostToken = generateResumeToken()
  await store.createLobby(lobbyCode, hostPeerId, hostToken, Date.now() + DEFAULT_LOBBY_TTL_MS)
  return { ok: true, action: 'create', lobbyCode, peerId: hostPeerId, hostToken }
}

export async function handleJoin(
  store: SignalingStore,
  lobbyCode: string,
): Promise<SignalingResponse> {
  if (!isValidLobbyCode(lobbyCode)) return { ok: false, error: 'invalid lobby code' }
  const newPeerId = generatePeerId()
  const peerToken = generateResumeToken()
  const next = await store.updateLobby(lobbyCode, (state) => {
    const role = state.locked ? 'spectator' : 'player'
    return {
      ...state,
      members: { ...state.members, [newPeerId]: role },
      peerTokens: { ...state.peerTokens, [newPeerId]: peerToken },
      mailboxes: {
        ...state.mailboxes,
        [newPeerId]: [],
        [state.hostPeerId]: [
          ...(state.mailboxes[state.hostPeerId] ?? []),
          { from: newPeerId, message: { kind: 'peer-joined', peerId: newPeerId, role } },
        ],
      },
    }
  })
  if (!next) return { ok: false, error: 'lobby not found or expired' }
  const role = next.members[newPeerId]
  if (!role) return { ok: false, error: 'failed to assign role' }
  return { ok: true, action: 'join', peerId: newPeerId, hostPeerId: next.hostPeerId, role, peerToken }
}

// Resume an existing session after a refresh. Validates the token against the
// stored hostToken (host) or peerTokens entry (player), then returns the
// snapshot the caller needs to re-establish polling and transport. For a
// player resume, drop a fresh `peer-joined` into the host's mailbox so the
// host's normal join-handling path re-runs the WebRTC handshake.
export async function handleResume(
  store: SignalingStore,
  lobbyCode: string,
  peerId: string,
  token: string,
): Promise<SignalingResponse> {
  if (!isValidLobbyCode(lobbyCode)) return { ok: false, error: 'invalid lobby code' }
  let resolvedRole: 'player' | 'spectator' | null = null
  let resolvedHostPeerId: string | null = null
  let resolvedIsHost = false
  let authError: string | null = null
  const next = await store.updateLobby(lobbyCode, (state) => {
    const isHost = peerId === state.hostPeerId
    if (isHost) {
      if (state.hostToken !== token) {
        authError = 'invalid token'
        return state
      }
    } else {
      const expected = state.peerTokens[peerId]
      if (!expected || expected !== token) {
        authError = 'invalid token'
        return state
      }
    }
    const role = state.members[peerId]
    if (!role) {
      authError = 'peer no longer in lobby'
      return state
    }
    resolvedRole = role
    resolvedHostPeerId = state.hostPeerId
    resolvedIsHost = isHost
    if (isHost) {
      // Host coming back from a refresh — bump the heartbeat so the silence
      // window resets and successors don't try to migrate.
      return { ...state, hostLastSeenAt: Date.now() }
    }
    // Synthesize a fresh peer-joined for the host so the renewed WebRTC
    // handshake kicks off as if the player just joined.
    return {
      ...state,
      mailboxes: {
        ...state.mailboxes,
        [state.hostPeerId]: [
          ...(state.mailboxes[state.hostPeerId] ?? []),
          { from: peerId, message: { kind: 'peer-joined', peerId, role } },
        ],
      },
    }
  })
  if (!next) return { ok: false, error: 'lobby not found or expired' }
  if (authError) return { ok: false, error: authError }
  if (!resolvedRole || !resolvedHostPeerId) return { ok: false, error: 'resume failed' }
  return {
    ok: true,
    action: 'resume',
    peerId,
    hostPeerId: resolvedHostPeerId,
    role: resolvedRole,
    isHost: resolvedIsHost,
  }
}

// Promote a non-host peer to host once the current host has been silent past
// HOST_MIGRATION_SILENCE_MS. The caller proves membership with their peerToken;
// on success the lobby's hostPeerId/hostToken are rotated and the caller's
// peerTokens entry is removed. Race-safe: first successful update wins; later
// attempts see a fresh hostLastSeenAt and fail the silence check.
export async function handleClaimHost(
  store: SignalingStore,
  lobbyCode: string,
  peerId: string,
  token: string,
): Promise<SignalingResponse> {
  if (!isValidLobbyCode(lobbyCode)) return { ok: false, error: 'invalid lobby code' }
  let authError: string | null = null
  let resolvedHostToken: string | null = null
  const next = await store.updateLobby(lobbyCode, (state) => {
    if (peerId === state.hostPeerId) {
      authError = 'already host'
      return state
    }
    const expected = state.peerTokens[peerId]
    if (!expected || expected !== token) {
      authError = 'invalid token'
      return state
    }
    if (!state.members[peerId]) {
      authError = 'peer no longer in lobby'
      return state
    }
    if (Date.now() - state.hostLastSeenAt < HOST_MIGRATION_SILENCE_MS) {
      authError = 'host still active'
      return state
    }
    const fresh = generateResumeToken()
    resolvedHostToken = fresh
    const { [peerId]: _removedToken, ...remainingTokens } = state.peerTokens
    return {
      ...state,
      hostPeerId: peerId,
      hostToken: fresh,
      hostLastSeenAt: Date.now(),
      peerTokens: remainingTokens,
    }
  })
  if (!next) return { ok: false, error: 'lobby not found or expired' }
  if (authError) return { ok: false, error: authError }
  if (!resolvedHostToken) return { ok: false, error: 'claim failed' }
  return { ok: true, action: 'claimHost', hostPeerId: peerId, hostToken: resolvedHostToken }
}

export async function handleSend(
  store: SignalingStore,
  lobbyCode: string,
  fromPeerId: string,
  toPeerId: string,
  message: unknown,
): Promise<SignalingResponse> {
  const next = await store.updateLobby(lobbyCode, (state) => {
    if (!state.members[fromPeerId]) return state
    if (!state.members[toPeerId]) return state
    return {
      ...state,
      ...(fromPeerId === state.hostPeerId ? { hostLastSeenAt: Date.now() } : {}),
      mailboxes: {
        ...state.mailboxes,
        [toPeerId]: [...(state.mailboxes[toPeerId] ?? []), { from: fromPeerId, message }],
      },
    }
  })
  if (!next) return { ok: false, error: 'lobby not found or expired' }
  if (!next.members[fromPeerId]) return { ok: false, error: 'unauthorized peer' }
  if (!next.members[toPeerId]) return { ok: false, error: 'unknown recipient' }
  return { ok: true, action: 'send' }
}

export async function handlePoll(
  store: SignalingStore,
  lobbyCode: string,
  peerId: string,
): Promise<SignalingResponse> {
  let messages: Array<{ from: string; message: unknown }> = []
  const next = await store.updateLobby(lobbyCode, (state) => {
    if (!state.members[peerId]) return state
    messages = state.mailboxes[peerId] ?? []
    return {
      ...state,
      ...(peerId === state.hostPeerId ? { hostLastSeenAt: Date.now() } : {}),
      mailboxes: { ...state.mailboxes, [peerId]: [] },
    }
  })
  if (!next) return { ok: false, error: 'lobby not found or expired' }
  if (!next.members[peerId]) return { ok: false, error: 'unauthorized peer' }
  return { ok: true, action: 'poll', messages }
}

export async function handleLock(
  store: SignalingStore,
  lobbyCode: string,
  peerId: string,
  locked: boolean,
): Promise<SignalingResponse> {
  const next = await store.updateLobby(lobbyCode, (state) => {
    if (state.hostPeerId !== peerId) return state
    return { ...state, locked, hostLastSeenAt: Date.now() }
  })
  if (!next) return { ok: false, error: 'lobby not found or expired' }
  if (next.hostPeerId !== peerId) return { ok: false, error: 'only host can change lock' }
  return { ok: true, action: 'lock' }
}

export async function handleClose(
  store: SignalingStore,
  lobbyCode: string,
  peerId: string,
): Promise<SignalingResponse> {
  const lobby = await store.getLobby(lobbyCode)
  if (!lobby) return { ok: true, action: 'close' }
  if (lobby.hostPeerId === peerId) {
    await store.deleteLobby(lobbyCode)
  } else {
    await store.updateLobby(lobbyCode, (state) => {
      const { [peerId]: _removed, ...remainingMembers } = state.members
      const { [peerId]: _mb, ...remainingMailboxes } = state.mailboxes
      const { [peerId]: _tok, ...remainingTokens } = state.peerTokens
      return {
        ...state,
        members: remainingMembers,
        peerTokens: remainingTokens,
        mailboxes: {
          ...remainingMailboxes,
          [state.hostPeerId]: [
            ...(remainingMailboxes[state.hostPeerId] ?? []),
            { from: peerId, message: { kind: 'peer-left', peerId } },
          ],
        },
      }
    })
  }
  return { ok: true, action: 'close' }
}
