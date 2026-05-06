import { describe, expect, test } from 'bun:test'
import {
  generateLobbyCode,
  isValidLobbyCode,
  LOBBY_CODE_LENGTH,
  normalizeLobbyCode,
} from '../../src/shared/lobby-code.ts'

const ALLOWED = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/

describe('generateLobbyCode', () => {
  test('produces a code of the configured length', () => {
    const code = generateLobbyCode()
    expect(code).toHaveLength(LOBBY_CODE_LENGTH)
  })

  test('only uses allowed alphabet (no I, O, 0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateLobbyCode()
      expect(code).toMatch(ALLOWED)
    }
  })

  test('produces varied output', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 200; i++) codes.add(generateLobbyCode())
    expect(codes.size).toBeGreaterThan(150)
  })
})

describe('isValidLobbyCode', () => {
  test('accepts a code from generateLobbyCode', () => {
    expect(isValidLobbyCode(generateLobbyCode())).toBe(true)
  })

  test('rejects wrong length', () => {
    expect(isValidLobbyCode('ABCDE')).toBe(false)
    expect(isValidLobbyCode('ABCDEFG')).toBe(false)
  })

  test('rejects disallowed characters', () => {
    expect(isValidLobbyCode('ABCDEI')).toBe(false)
    expect(isValidLobbyCode('ABCDEO')).toBe(false)
    expect(isValidLobbyCode('ABCDE1')).toBe(false)
    expect(isValidLobbyCode('ABCDE0')).toBe(false)
    expect(isValidLobbyCode('abcdef')).toBe(false)
  })
})

describe('normalizeLobbyCode', () => {
  test('uppercases input', () => {
    expect(normalizeLobbyCode('banj07')).toBe('BANJ07')
  })

  test('substitutes I→1 and O→0', () => {
    expect(normalizeLobbyCode('IO')).toBe('10')
  })

  test('strips disallowed characters', () => {
    expect(normalizeLobbyCode('AB-CD EF')).toBe('ABCDEF')
  })
})
