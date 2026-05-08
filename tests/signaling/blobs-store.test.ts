import { describe, expect, test } from 'bun:test'
import { createBlobsStore } from '../../src/signaling/blobs-store.ts'
import { createMockBlobStore } from '../helpers/mock-blob-store.ts'

describe('createBlobsStore', () => {
  test('createLobby and getLobby round-trip', async () => {
    const store = createBlobsStore(createMockBlobStore())
    const expiresAt = Date.now() + 60_000
    await store.createLobby('ABCDEF', 'host-1', 'tok', expiresAt)
    const lobby = await store.getLobby('ABCDEF')
    expect(lobby?.hostPeerId).toBe('host-1')
    expect(lobby?.members['host-1']).toBe('player')
    expect(lobby?.locked).toBe(false)
  })

  test('getLobby returns null for missing code', async () => {
    const store = createBlobsStore(createMockBlobStore())
    expect(await store.getLobby('MISSING')).toBeNull()
  })

  test('getLobby returns null for expired lobby', async () => {
    const store = createBlobsStore(createMockBlobStore())
    await store.createLobby('ABCDEF', 'host-1', 'tok', Date.now() - 1)
    expect(await store.getLobby('ABCDEF')).toBeNull()
  })

  test('updateLobby applies mutator', async () => {
    const store = createBlobsStore(createMockBlobStore())
    await store.createLobby('ABCDEF', 'host-1', 'tok', Date.now() + 60_000)
    const updated = await store.updateLobby('ABCDEF', (s) => ({ ...s, locked: true }))
    expect(updated?.locked).toBe(true)
    const reread = await store.getLobby('ABCDEF')
    expect(reread?.locked).toBe(true)
  })

  test('updateLobby returns null for missing or expired lobby', async () => {
    const store = createBlobsStore(createMockBlobStore())
    expect(await store.updateLobby('MISSING', (s) => s)).toBeNull()
    await store.createLobby('ABCDEF', 'host-1', 'tok', Date.now() - 1)
    expect(await store.updateLobby('ABCDEF', (s) => s)).toBeNull()
  })

  test('deleteLobby removes the lobby', async () => {
    const store = createBlobsStore(createMockBlobStore())
    await store.createLobby('ABCDEF', 'host-1', 'tok', Date.now() + 60_000)
    await store.deleteLobby('ABCDEF')
    expect(await store.getLobby('ABCDEF')).toBeNull()
  })
})
