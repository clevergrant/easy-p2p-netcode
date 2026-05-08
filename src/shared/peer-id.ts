export type PeerId = string

export function generatePeerId(): PeerId {
  return crypto.randomUUID()
}

// Resume token used to authenticate a returning peer (host or player) after a
// page refresh. 122 bits of entropy from randomUUID is plenty for a session-
// scoped secret.
export function generateResumeToken(): string {
  return crypto.randomUUID()
}
