import { generateLobbyCode, isValidLobbyCode } from '../shared/lobby-code.ts'
import { generatePeerId } from '../shared/peer-id.ts'
import type { SignalingResponse } from '../shared/signaling-msgs.ts'
import type { SignalingStore } from './store.ts'

const DEFAULT_LOBBY_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

export async function handleCreate(store: SignalingStore): Promise<SignalingResponse> {
  const lobbyCode = generateLobbyCode()
  const hostPeerId = generatePeerId()
  await store.createLobby(lobbyCode, hostPeerId, Date.now() + DEFAULT_LOBBY_TTL_MS)
  return { ok: true, action: 'create', lobbyCode, peerId: hostPeerId }
}

export async function handleJoin(store: SignalingStore, lobbyCode: string): Promise<SignalingResponse> {
  if (!isValidLobbyCode(lobbyCode)) return { ok: false, error: 'invalid lobby code' }
  const newPeerId = generatePeerId()
  const next = await store.updateLobby(lobbyCode, (state) => {
    const role = state.locked ? 'spectator' : 'player'
    return {
      ...state,
      members: { ...state.members, [newPeerId]: role },
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
  return { ok: true, action: 'join', peerId: newPeerId, hostPeerId: next.hostPeerId, role }
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
    return { ...state, locked }
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
      return {
        ...state,
        members: remainingMembers,
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
