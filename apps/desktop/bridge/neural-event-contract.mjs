/** Metadata-only subsystem observations. This contract grants no execution permission. */
export const NEURAL_EVENT_SCHEMA = 'nori.neural-event.v1'
const operations = Object.freeze({
  memory_recall: 'memory', memory_store: 'memory',
  plan: 'planning', policy_check: 'protection', context_update: 'working_memory',
})
const states = new Set(['started', 'completed', 'failed', 'cancelled', 'allowed', 'denied'])
const required = ['schema', 'type', 'ask', 'operation_id', 'operation', 'state']
const keys = new Set([...required, 'result_count'])
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

/** Reject rather than strip unexpected fields so producers cannot leak payloads. */
export function validateNeuralEvent(value, acceptedTurn) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !keys.has(key)
    || !Object.hasOwn(descriptors[key], 'value'))) return null
  if (required.some(key => !Object.hasOwn(descriptors, key))) return null
  const event = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]))
  if (event.schema !== NEURAL_EVENT_SCHEMA || event.type !== 'neural-event') return null
  if (typeof acceptedTurn !== 'string' || !identifier.test(acceptedTurn) || event.ask !== acceptedTurn) return null
  if (typeof event.operation_id !== 'string' || !identifier.test(event.operation_id)) return null
  if (typeof event.operation !== 'string' || !Object.hasOwn(operations, event.operation) || !states.has(event.state)) return null
  const policy = event.operation === 'policy_check'
  if (policy ? !['started', 'allowed', 'denied', 'failed', 'cancelled'].includes(event.state)
    : ['allowed', 'denied'].includes(event.state)) return null
  if (Object.hasOwn(event, 'result_count') && (
    event.operation !== 'memory_recall' || event.state !== 'completed'
    || !Number.isSafeInteger(event.result_count) || event.result_count < 0 || event.result_count > 1_000_000
  )) return null
  return Object.freeze({...event, region: operations[event.operation]})
}

/** A bounded per-turn ledger. Terminal entries remain to prevent replay. */
export function createNeuralEventLedger(acceptedTurn) {
  if (typeof acceptedTurn !== 'string' || !identifier.test(acceptedTurn)) throw new TypeError('Invalid neural event turn')
  const entries = new Map()
  let closed = false
  return Object.freeze({
    accept(value) {
      if (closed) return null
      const event = validateNeuralEvent(value, acceptedTurn)
      if (!event) return null
      const previous = entries.get(event.operation_id)
      if (event.state === 'started') {
        if (previous || entries.size >= 256) return null
      } else if (!previous || previous.state !== 'started' || previous.operation !== event.operation) return null
      entries.set(event.operation_id, {operation:event.operation, state:event.state})
      return event
    },
    close() { closed = true; entries.clear() },
  })
}

/** Bind producer metadata without reading accessors or accepting producer turn IDs. */
export function bindNeuralEvent(metadata, acceptedTurn) {
  if(!metadata || typeof metadata!=='object' || Array.isArray(metadata))return null
  const prototype=Object.getPrototypeOf(metadata)
  if(prototype!==Object.prototype && prototype!==null)return null
  const descriptors=Object.getOwnPropertyDescriptors(metadata)
  if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string' || key==='ask'
    || !Object.hasOwn(descriptors[key],'value')))return null
  const event=Object.fromEntries(Object.entries(descriptors).map(([key,descriptor])=>[key,descriptor.value]))
  event.ask=acceptedTurn
  return validateNeuralEvent(event,acceptedTurn) ? Object.freeze(event) : null
}
