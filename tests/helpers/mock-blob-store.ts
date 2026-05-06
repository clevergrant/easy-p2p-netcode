import type { BlobLikeStore } from '../../src/signaling/blobs-store.ts'

export function createMockBlobStore(): BlobLikeStore & { _data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    _data: data,
    async get(key) {
      return data.get(key) ?? null
    },
    async setJSON(key, value) {
      data.set(key, value)
    },
    async delete(key) {
      data.delete(key)
    },
  }
}
