import { SignalingRequest, type SignalingResponse } from '../shared/signaling-msgs.ts'
import type { SignalingStore } from './store.ts'
import {
  handleClose,
  handleCreate,
  handleJoin,
  handleLock,
  handlePoll,
  handleSend,
} from './actions.ts'

export interface SignalingHandlerOptions {
  store: SignalingStore
}

export function createSignalingHandler(opts: SignalingHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method not allowed' }, 405)
    }
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ ok: false, error: 'invalid JSON' }, 400)
    }
    const parsed = SignalingRequest.safeParse(body)
    if (!parsed.success) {
      return jsonResponse({ ok: false, error: 'invalid request shape' }, 400)
    }
    const result = await dispatch(opts.store, parsed.data)
    return jsonResponse(result, result.ok ? 200 : 400)
  }
}

async function dispatch(
  store: SignalingStore,
  req: import('../shared/signaling-msgs.ts').SignalingRequest,
): Promise<SignalingResponse> {
  switch (req.action) {
    case 'create':
      return handleCreate(store)
    case 'join':
      return handleJoin(store, req.lobbyCode)
    case 'send':
      return handleSend(store, req.lobbyCode, req.peerId, req.toPeerId, req.message)
    case 'poll':
      return handlePoll(store, req.lobbyCode, req.peerId)
    case 'lock':
      return handleLock(store, req.lobbyCode, req.peerId, req.locked)
    case 'close':
      return handleClose(store, req.lobbyCode, req.peerId)
  }
}

function jsonResponse(body: SignalingResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
