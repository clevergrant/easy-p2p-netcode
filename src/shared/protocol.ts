import { z } from 'zod'

export type SchemaMap = Record<string, z.ZodTypeAny>

export interface ProtocolDef<Intents extends SchemaMap, Events extends SchemaMap> {
  intents: Intents
  events: Events
}

export function defineProtocol<Intents extends SchemaMap, Events extends SchemaMap>(
  def: ProtocolDef<Intents, Events>,
): ProtocolDef<Intents, Events> {
  return def
}

export type IntentMessage<P extends ProtocolDef<SchemaMap, SchemaMap>> = {
  [K in keyof P['intents'] & string]: { type: K } & z.infer<P['intents'][K]>
}[keyof P['intents'] & string]

export type EventMessage<P extends ProtocolDef<SchemaMap, SchemaMap>> = {
  [K in keyof P['events'] & string]: { type: K } & z.infer<P['events'][K]>
}[keyof P['events'] & string]
