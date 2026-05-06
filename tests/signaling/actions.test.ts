import { describe, expect, test } from 'bun:test'
import {
  handleClose,
  handleCreate,
  handleJoin,
  handleLock,
  handlePoll,
  handleSend,
} from '../../src/signaling/actions.ts'
import { createMemoryStore } from '../helpers/memory-store.ts'

async function freshLobby() {
  const store = createMemoryStore()
  const created = await handleCreate(store)
  if (!created.ok || created.action !== 'create') throw new Error('create failed')
  return { store, lobbyCode: created.lobbyCode, hostPeerId: created.peerId }
}

describe('handleCreate', () => {
  test('returns lobby code and host peer id', async () => {
    const store = createMemoryStore()
    const res = await handleCreate(store)
    expect(res.ok).toBe(true)
    if (res.ok && res.action === 'create') {
      expect(res.lobbyCode).toMatch(/^[A-Z0-9]{6}$/)
      expect(res.peerId.length).toBeGreaterThan(0)
    }
  })
})

describe('handleJoin', () => {
  test('rejects invalid lobby code', async () => {
    const store = createMemoryStore()
    const res = await handleJoin(store, 'xx')
    expect(res.ok).toBe(false)
  })

  test('rejects unknown lobby code', async () => {
    const store = createMemoryStore()
    const res = await handleJoin(store, 'ZZZZZZ')
    expect(res.ok).toBe(false)
  })

  test('joins as player when lobby is unlocked', async () => {
    const { store, lobbyCode } = await freshLobby()
    const res = await handleJoin(store, lobbyCode)
    expect(res.ok).toBe(true)
    if (res.ok && res.action === 'join') expect(res.role).toBe('player')
  })

  test('joins as spectator when lobby is locked', async () => {
    const { store, lobbyCode, hostPeerId } = await freshLobby()
    await handleLock(store, lobbyCode, hostPeerId, true)
    const res = await handleJoin(store, lobbyCode)
    expect(res.ok).toBe(true)
    if (res.ok && res.action === 'join') expect(res.role).toBe('spectator')
  })

  test('posts peer-joined message to host mailbox', async () => {
    const { store, lobbyCode, hostPeerId } = await freshLobby()
    await handleJoin(store, lobbyCode)
    const poll = await handlePoll(store, lobbyCode, hostPeerId)
    expect(poll.ok).toBe(true)
    if (poll.ok && poll.action === 'poll') {
      expect(poll.messages.length).toBe(1)
      const msg = poll.messages[0]?.message as { kind: string; role?: string }
      expect(msg.kind).toBe('peer-joined')
      expect(msg.role).toBe('player')
    }
  })
})

describe('handleSend', () => {
  test('delivers a message to recipient mailbox', async () => {
    const { store, lobbyCode, hostPeerId } = await freshLobby()
    const join = await handleJoin(store, lobbyCode)
    if (!join.ok || join.action !== 'join') throw new Error('join failed')

    await handlePoll(store, lobbyCode, hostPeerId) // clear peer-joined notice

    await handleSend(store, lobbyCode, hostPeerId, join.peerId, { kind: 'offer', sdp: 'x' })
    const poll = await handlePoll(store, lobbyCode, join.peerId)
    if (poll.ok && poll.action === 'poll') {
      expect(poll.messages.length).toBe(1)
      expect(poll.messages[0]?.from).toBe(hostPeerId)
    }
  })

  test('rejects send from non-member peer', async () => {
    const { store, lobbyCode, hostPeerId } = await freshLobby()
    const res = await handleSend(store, lobbyCode, 'unknown-peer', hostPeerId, {})
    expect(res.ok).toBe(false)
  })

  test('rejects send to non-member peer', async () => {
    const { store, lobbyCode, hostPeerId } = await freshLobby()
    const res = await handleSend(store, lobbyCode, hostPeerId, 'unknown-peer', {})
    expect(res.ok).toBe(false)
  })
})

describe('handlePoll', () => {
  test('rejects unknown peer', async () => {
    const { store, lobbyCode } = await freshLobby()
    const res = await handlePoll(store, lobbyCode, 'unknown-peer')
    expect(res.ok).toBe(false)
  })

  test('clears mailbox after poll', async () => {
    const { store, lobbyCode, hostPeerId } = await freshLobby()
    await handleJoin(store, lobbyCode)
    const first = await handlePoll(store, lobbyCode, hostPeerId)
    expect(first.ok).toBe(true)
    if (first.ok && first.action === 'poll') expect(first.messages.length).toBe(1)
    const second = await handlePoll(store, lobbyCode, hostPeerId)
    if (second.ok && second.action === 'poll') expect(second.messages.length).toBe(0)
  })
})

describe('handleLock', () => {
  test('host can lock and unlock', async () => {
    const { store, lobbyCode, hostPeerId } = await freshLobby()
    expect((await handleLock(store, lobbyCode, hostPeerId, true)).ok).toBe(true)
    expect((await handleLock(store, lobbyCode, hostPeerId, false)).ok).toBe(true)
  })

  test('non-host cannot change lock', async () => {
    const { store, lobbyCode } = await freshLobby()
    const join = await handleJoin(store, lobbyCode)
    if (!join.ok || join.action !== 'join') throw new Error('join failed')
    const res = await handleLock(store, lobbyCode, join.peerId, true)
    expect(res.ok).toBe(false)
  })
})

describe('handleClose', () => {
  test('host close deletes lobby', async () => {
    const { store, lobbyCode, hostPeerId } = await freshLobby()
    await handleClose(store, lobbyCode, hostPeerId)
    expect(await store.getLobby(lobbyCode)).toBeNull()
  })

  test('peer close removes peer and notifies host', async () => {
    const { store, lobbyCode, hostPeerId } = await freshLobby()
    const join = await handleJoin(store, lobbyCode)
    if (!join.ok || join.action !== 'join') throw new Error('join failed')
    await handlePoll(store, lobbyCode, hostPeerId) // clear peer-joined

    await handleClose(store, lobbyCode, join.peerId)
    const lobby = await store.getLobby(lobbyCode)
    expect(lobby?.members[join.peerId]).toBeUndefined()
    const poll = await handlePoll(store, lobbyCode, hostPeerId)
    if (poll.ok && poll.action === 'poll') {
      expect(poll.messages[0]?.message).toMatchObject({ kind: 'peer-left', peerId: join.peerId })
    }
  })
})
