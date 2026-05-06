import { describe, expect, test } from 'bun:test'
import { PeerToPeerSignal, SignalingRequest } from '../../src/shared/signaling-msgs.ts'

describe('SignalingRequest', () => {
  test('parses each known action', () => {
    const samples: unknown[] = [
      { action: 'create' },
      { action: 'join', lobbyCode: 'BANJ07' },
      { action: 'send', lobbyCode: 'BANJ07', peerId: 'p1', toPeerId: 'p2', message: { foo: 1 } },
      { action: 'poll', lobbyCode: 'BANJ07', peerId: 'p1' },
      { action: 'lock', lobbyCode: 'BANJ07', peerId: 'p1', locked: true },
      { action: 'close', lobbyCode: 'BANJ07', peerId: 'p1' },
    ]
    for (const sample of samples) {
      expect(SignalingRequest.safeParse(sample).success).toBe(true)
    }
  })

  test('rejects unknown action', () => {
    expect(SignalingRequest.safeParse({ action: 'oops' }).success).toBe(false)
  })

  test('rejects missing required fields', () => {
    expect(SignalingRequest.safeParse({ action: 'join' }).success).toBe(false)
    expect(SignalingRequest.safeParse({ action: 'send', lobbyCode: 'X' }).success).toBe(false)
  })
})

describe('PeerToPeerSignal', () => {
  test('parses each kind', () => {
    const samples: unknown[] = [
      { kind: 'offer', sdp: 'sdp text' },
      { kind: 'answer', sdp: 'sdp text' },
      { kind: 'ice', candidate: 'candidate', sdpMid: '0', sdpMLineIndex: 0 },
      { kind: 'ice', candidate: 'candidate', sdpMid: null, sdpMLineIndex: null },
      { kind: 'peer-joined', peerId: 'p1', role: 'player' },
      { kind: 'peer-joined', peerId: 'p1', role: 'spectator' },
      { kind: 'peer-left', peerId: 'p1' },
    ]
    for (const sample of samples) {
      expect(PeerToPeerSignal.safeParse(sample).success).toBe(true)
    }
  })

  test('rejects unknown kind', () => {
    expect(PeerToPeerSignal.safeParse({ kind: 'mystery' }).success).toBe(false)
  })

  test('rejects invalid role', () => {
    const sample = { kind: 'peer-joined', peerId: 'p1', role: 'admin' }
    expect(PeerToPeerSignal.safeParse(sample).success).toBe(false)
  })
})
