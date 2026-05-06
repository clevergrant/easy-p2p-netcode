const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const LOBBY_CODE_LENGTH = 6

export function generateLobbyCode(): string {
  const bytes = new Uint8Array(LOBBY_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length]
  }
  return out
}

export function normalizeLobbyCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/I/g, '1')
    .replace(/O/g, '0')
    .replace(/[^A-Z0-9]/g, '')
}

export function isValidLobbyCode(code: string): boolean {
  if (code.length !== LOBBY_CODE_LENGTH) return false
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return false
  }
  return true
}
