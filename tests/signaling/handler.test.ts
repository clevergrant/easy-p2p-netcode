import { describe, expect, test } from 'bun:test'
import { createSignalingHandler } from '../../src/signaling/handler.ts'
import { createMemoryStore } from '../helpers/memory-store.ts'

function postRequest(body: unknown): Request {
  return new Request('http://localhost/lobby', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('createSignalingHandler', () => {
  test('rejects non-POST methods', async () => {
    const handler = createSignalingHandler({ store: createMemoryStore() })
    const res = await handler(new Request('http://localhost/lobby', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  test('rejects invalid JSON', async () => {
    const handler = createSignalingHandler({ store: createMemoryStore() })
    const res = await handler(new Request('http://localhost/lobby', { method: 'POST', body: 'not-json' }))
    expect(res.status).toBe(400)
  })

  test('rejects malformed body shape', async () => {
    const handler = createSignalingHandler({ store: createMemoryStore() })
    const res = await handler(postRequest({ action: 'mystery' }))
    expect(res.status).toBe(400)
  })

  test('end-to-end create → join → send → poll flow', async () => {
    const handler = createSignalingHandler({ store: createMemoryStore() })

    const createRes = await handler(postRequest({ action: 'create' })).then((r) => r.json())
    expect(createRes.ok).toBe(true)
    const { lobbyCode, peerId: hostPeerId } = createRes

    const joinRes = await handler(postRequest({ action: 'join', lobbyCode })).then((r) => r.json())
    expect(joinRes.ok).toBe(true)
    expect(joinRes.role).toBe('player')
    const { peerId: clientPeerId } = joinRes

    // Drain host mailbox so the next poll only sees our targeted send
    await handler(postRequest({ action: 'poll', lobbyCode, peerId: hostPeerId }))

    await handler(
      postRequest({
        action: 'send',
        lobbyCode,
        peerId: hostPeerId,
        toPeerId: clientPeerId,
        message: { kind: 'offer', sdp: 'fake' },
      }),
    )

    const pollRes = await handler(
      postRequest({ action: 'poll', lobbyCode, peerId: clientPeerId }),
    ).then((r) => r.json())
    expect(pollRes.messages.length).toBe(1)
    expect(pollRes.messages[0].from).toBe(hostPeerId)
  })

  test('returns 400 status when action returns not-ok', async () => {
    const handler = createSignalingHandler({ store: createMemoryStore() })
    const res = await handler(postRequest({ action: 'join', lobbyCode: 'NOPE99' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})
