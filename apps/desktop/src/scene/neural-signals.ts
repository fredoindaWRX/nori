/** Ephemeral UI transport observations. Never stores prompts or tool arguments. */
import { createNeuralEventLedger } from '../../bridge/neural-event-contract.mjs'
export const NEURAL_TRANSPORT_DESTINATIONS = ['language', 'tools', 'memory', 'planning', 'protection', 'working_memory'] as const
export type NeuralSignal = { from: 'connections'; to: typeof NEURAL_TRANSPORT_DESTINATIONS[number]; at: number; state?: 'started'|'completed'|'failed'|'cancelled'|'allowed'|'denied' }
export function neuralSignalColor(signal: NeuralSignal): readonly [number,number,number] {
  switch(signal.state) {
    case 'completed': case 'allowed': return [.2,1,.55]
    case 'failed': case 'denied': return [1,.18,.22]
    case 'cancelled': return [1,.65,.15]
    default: return [.7,.45,1]
  }
}
export const SIGNAL_LIFETIME_MS = 1000

export function bridgeNeuralSignal(frame: unknown, turnId: string, now: number): NeuralSignal | null {
  if (!turnId || !Number.isFinite(now) || now < 0 || !frame || typeof frame !== 'object') return null
  const message = frame as Record<string, unknown>
  // Only a tagged frame for the accepted turn establishes this observation.
  if (message.ask !== turnId) return null
  if (message.type === 'text' && typeof message.delta === 'string' && message.delta.length > 0)
    return { from: 'connections', to: 'language', at: now }
  if (message.type === 'tool' && typeof message.name === 'string' && message.name.trim().length > 0)
    return { from: 'connections', to: 'tools', at: now }
  return null
}

export function liveNeuralSignals(signals: readonly NeuralSignal[], now: number): NeuralSignal[] {
  if (!Number.isFinite(now) || now < 0) return []
  return signals.filter(signal => Number.isFinite(signal.at) && signal.at <= now && now - signal.at < SIGNAL_LIFETIME_MS)
}

/** Normalized travel along the fiber; callers use only live observations. */
export function neuralSignalProgress(signal: NeuralSignal, now: number): number {
  return Math.min(1, Math.max(0, (now - signal.at) / SIGNAL_LIFETIME_MS))
}

// Coalesce traffic while a pulse is in flight so streaming cannot restart it.
// One timestamp per supported route bounds storage regardless of stream length.
const latest = new Map<NeuralSignal['to'], NeuralSignal>()
export function clearNeuralSignals(): void {
  latest.clear()
}
export function observeBridgeNeuralSignal(frame: unknown, turnId: string, now = performance.now(), ledger?: ReturnType<typeof createNeuralEventLedger>): void {
  if (!Number.isFinite(now) || now < 0) return
  let signal = bridgeNeuralSignal(frame, turnId, now)
  if (!signal && ledger && frame && typeof frame === 'object' && (frame as Record<string, unknown>).ask === turnId) {
    const event = ledger.accept(frame)
    if (event && NEURAL_TRANSPORT_DESTINATIONS.includes(event.region as NeuralSignal['to']))
      signal = {from:'connections', to:event.region as NeuralSignal['to'], at:now, state:event.state as NeuralSignal['state']}
  }
  if (!signal) return
  const existing = latest.get(signal.to)
  if (!existing || existing.at > now || now - existing.at >= SIGNAL_LIFETIME_MS) latest.set(signal.to, signal)
  else if (signal.state) latest.set(signal.to, {...existing, state:signal.state})
}
export function observedNeuralSignals(now = performance.now()): NeuralSignal[] {
  for (const [destination, signal] of latest) {
    if (signal.at > now || now - signal.at >= SIGNAL_LIFETIME_MS) latest.delete(destination)
  }
  return liveNeuralSignals([...latest.values()], now)
}
