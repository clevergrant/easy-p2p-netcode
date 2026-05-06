import { describe, expect, test } from 'bun:test'
import { PeerRegistry } from '../../src/client/peer-registry.ts'
import type { Transport } from '../../src/client/transport/transport.ts'

function fakeTransport(): Transport {
  return {
    state: 'open',
    send() {},
    close() {},
    onOpen: null,
    onMessage: null,
    onClose: null,
    onError: null,
  }
}

describe('PeerRegistry', () => {
  test('add and get round-trip', () => {
    const reg = new PeerRegistry()
    reg.add({ peerId: 'a', role: 'player', transport: fakeTransport() })
    const entry = reg.get('a')
    expect(entry?.peerId).toBe('a')
    expect(entry?.role).toBe('player')
  })

  test('size reflects added peers', () => {
    const reg = new PeerRegistry()
    expect(reg.size()).toBe(0)
    reg.add({ peerId: 'a', role: 'player', transport: fakeTransport() })
    reg.add({ peerId: 'b', role: 'spectator', transport: fakeTransport() })
    expect(reg.size()).toBe(2)
  })

  test('remove returns the entry and clears it', () => {
    const reg = new PeerRegistry()
    reg.add({ peerId: 'a', role: 'player', transport: fakeTransport() })
    const removed = reg.remove('a')
    expect(removed?.peerId).toBe('a')
    expect(reg.get('a')).toBeUndefined()
    expect(reg.size()).toBe(0)
  })

  test('remove on missing peer returns undefined', () => {
    const reg = new PeerRegistry()
    expect(reg.remove('missing')).toBeUndefined()
  })

  test('byRole filters correctly', () => {
    const reg = new PeerRegistry()
    reg.add({ peerId: 'a', role: 'player', transport: fakeTransport() })
    reg.add({ peerId: 'b', role: 'player', transport: fakeTransport() })
    reg.add({ peerId: 'c', role: 'spectator', transport: fakeTransport() })
    expect(reg.byRole('player').map((p) => p.peerId).sort()).toEqual(['a', 'b'])
    expect(reg.byRole('spectator').map((p) => p.peerId)).toEqual(['c'])
  })

  test('all returns every entry', () => {
    const reg = new PeerRegistry()
    reg.add({ peerId: 'a', role: 'player', transport: fakeTransport() })
    reg.add({ peerId: 'b', role: 'spectator', transport: fakeTransport() })
    expect(reg.all().length).toBe(2)
  })
})
