import { z } from 'zod'

export const PeerRoleSchema = z.enum(['player', 'spectator'])

export const SignalingRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create') }),
  z.object({ action: z.literal('join'), lobbyCode: z.string() }),
  z.object({
    action: z.literal('send'),
    lobbyCode: z.string(),
    peerId: z.string(),
    toPeerId: z.string(),
    message: z.unknown(),
  }),
  z.object({
    action: z.literal('poll'),
    lobbyCode: z.string(),
    peerId: z.string(),
  }),
  z.object({
    action: z.literal('lock'),
    lobbyCode: z.string(),
    peerId: z.string(),
    locked: z.boolean(),
  }),
  z.object({
    action: z.literal('close'),
    lobbyCode: z.string(),
    peerId: z.string(),
  }),
])
export type SignalingRequest = z.infer<typeof SignalingRequest>

export type SignalingResponse =
  | { ok: true; action: 'create'; lobbyCode: string; peerId: string }
  | { ok: true; action: 'join'; peerId: string; hostPeerId: string; role: 'player' | 'spectator' }
  | { ok: true; action: 'send' }
  | { ok: true; action: 'poll'; messages: Array<{ from: string; message: unknown }> }
  | { ok: true; action: 'lock' }
  | { ok: true; action: 'close' }
  | { ok: false; error: string }

export const PeerToPeerSignal = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('offer'), sdp: z.string() }),
  z.object({ kind: z.literal('answer'), sdp: z.string() }),
  z.object({
    kind: z.literal('ice'),
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().nullable(),
  }),
  z.object({ kind: z.literal('peer-joined'), peerId: z.string(), role: PeerRoleSchema }),
  z.object({ kind: z.literal('peer-left'), peerId: z.string() }),
])
export type PeerToPeerSignal = z.infer<typeof PeerToPeerSignal>
