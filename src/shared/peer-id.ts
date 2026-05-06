export type PeerId = string

export function generatePeerId(): PeerId {
  return crypto.randomUUID()
}
