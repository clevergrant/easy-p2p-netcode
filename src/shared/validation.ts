import type { SchemaMap } from './protocol.ts'

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string }

export function validateMessage<T extends SchemaMap>(
  schemas: T,
  raw: unknown,
): ValidationResult<{ type: keyof T & string } & Record<string, unknown>> {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'message is not an object' }
  }
  const obj = raw as Record<string, unknown>
  const type = obj['type']
  if (typeof type !== 'string') {
    return { ok: false, reason: 'missing or non-string "type" field' }
  }
  const schema = schemas[type]
  if (!schema) {
    return { ok: false, reason: `unknown message type "${type}"` }
  }
  const { type: _ignored, ...payload } = obj
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.message }
  }
  return { ok: true, value: { type: type as keyof T & string, ...parsed.data } }
}
