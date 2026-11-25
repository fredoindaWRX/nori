import { randomUUID } from 'node:crypto'
import { NEURAL_EVENT_SCHEMA } from './neural-event-contract.mjs'

/** Observes selection from the local learned-guidance cache, not disk or Merovingian retrieval. */
export function observeLocalMemoryContext(read, emit) {
  const metadata = {schema:NEURAL_EVENT_SCHEMA,type:'neural-event',operation_id:randomUUID(),operation:'memory_recall'}
  const notify = state => {
    // Visualization delivery must never change the memory operation's outcome.
    try { emit?.(Object.freeze({...metadata,state})) } catch {}
  }
  notify('started')
  try {
    const context = read()
    notify('completed')
    return context
  } catch (error) {
    notify('failed')
    throw error
  }
}
