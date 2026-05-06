import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { validateMessage } from '../../src/shared/validation.ts'

const schemas = {
  fireShot: z.object({ angle: z.number(), power: z.number() }),
  endTurn: z.object({}),
}

describe('validateMessage', () => {
  test('accepts well-formed message and preserves type field', () => {
    const result = validateMessage(schemas, { type: 'fireShot', angle: 45, power: 80 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.type).toBe('fireShot')
      expect(result.value['angle']).toBe(45)
      expect(result.value['power']).toBe(80)
    }
  })

  test('accepts empty payload schema', () => {
    const result = validateMessage(schemas, { type: 'endTurn' })
    expect(result.ok).toBe(true)
  })

  test('rejects null', () => {
    const result = validateMessage(schemas, null)
    expect(result.ok).toBe(false)
  })

  test('rejects non-object primitives', () => {
    expect(validateMessage(schemas, 'string').ok).toBe(false)
    expect(validateMessage(schemas, 42).ok).toBe(false)
    expect(validateMessage(schemas, true).ok).toBe(false)
  })

  test('rejects object missing type field', () => {
    const result = validateMessage(schemas, { angle: 45, power: 80 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/type/)
  })

  test('rejects non-string type field', () => {
    const result = validateMessage(schemas, { type: 123 })
    expect(result.ok).toBe(false)
  })

  test('rejects unknown message type', () => {
    const result = validateMessage(schemas, { type: 'noSuchAction' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/unknown/)
  })

  test('rejects payload that fails schema validation', () => {
    const result = validateMessage(schemas, { type: 'fireShot', angle: 'bad', power: 80 })
    expect(result.ok).toBe(false)
  })
})
