export type TransportState = 'connecting' | 'open' | 'closed'

export interface Transport {
  readonly state: TransportState
  send(data: string): void
  close(): void
  onOpen: (() => void) | null
  onMessage: ((data: string) => void) | null
  onClose: (() => void) | null
  onError: ((err: Error) => void) | null
}
