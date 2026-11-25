// Process-local ownership travels outside serializable producer metadata.
const origins = new WeakMap()
const identities = new WeakSet()
export function createNeuralOrigin(turnId) {
  if (typeof turnId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(turnId)) return null
  const origin = Object.freeze({turnId})
  identities.add(origin)
  return origin
}
export function attachNeuralOrigin(value, origin) {
  if (value && typeof value === 'object' && identities.has(origin)) origins.set(value, origin)
  return value
}
export function neuralOriginOf(value) {
  return value && typeof value === 'object' ? origins.get(value) ?? null : null
}
export function ownsNeuralObservation(origin, activeOrigin) {
  return origin !== null && identities.has(origin) && origin === activeOrigin
}
