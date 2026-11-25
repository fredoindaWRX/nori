export const NEURAL_EVENT_SCHEMA: 'nori.neural-event.v1'
export type NeuralOperation = 'memory_recall' | 'memory_store' | 'plan' | 'policy_check' | 'context_update'
export type NeuralEventState = 'started' | 'completed' | 'failed' | 'cancelled' | 'allowed' | 'denied'
export type ValidatedNeuralEvent = Readonly<{
  schema: typeof NEURAL_EVENT_SCHEMA
  type: 'neural-event'
  ask: string
  operation_id: string
  operation: NeuralOperation
  state: NeuralEventState
  result_count?: number
  region: 'memory' | 'planning' | 'protection' | 'working_memory'
}>
export function validateNeuralEvent(value: unknown, acceptedTurn: string): ValidatedNeuralEvent | null
export function createNeuralEventLedger(acceptedTurn: string): Readonly<{
  accept(value: unknown): ValidatedNeuralEvent | null
  close(): void
}>
export function bindNeuralEvent(metadata: unknown, acceptedTurn: string): Omit<ValidatedNeuralEvent, "region"> | null
