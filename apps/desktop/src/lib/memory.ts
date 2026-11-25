import { BRIDGE_HTTP_URL } from '../config'

export type LearnedMemoryKind = 'knowledge' | 'preferences' | 'feedback'
export type LearnedMemoryEntry = {
  id: string
  kind: LearnedMemoryKind
  label: string
  text: string
  at: string
  source: string
}
export type LearnedMemoryInventory = {
  schema: 'nori.memory-inventory.v1'
  scope: 'learned-guidance-only'
  source: string
  complete: false
  note: string
  counts: Record<LearnedMemoryKind, number>
  entries: LearnedMemoryEntry[]
}

async function memoryRequest(body?: Record<string, unknown>): Promise<LearnedMemoryInventory> {
  const response = await fetch(`${BRIDGE_HTTP_URL}/memory`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
  if (!response.ok) {
    const message = (await response.text()).slice(0, 240)
    throw new Error(message || `Memory request failed (${response.status}).`)
  }
  const value = await response.json() as LearnedMemoryInventory
  if (value?.schema !== 'nori.memory-inventory.v1' || value.scope !== 'learned-guidance-only'
    || value.complete !== false || !Array.isArray(value.entries) || !value.counts) {
    throw new Error('Nori returned an invalid memory inventory.')
  }
  return value
}

export function readLearnedMemory() { return memoryRequest() }
export function editLearnedMemory(id: string, text: string) { return memoryRequest({ action: 'edit', id, text }) }
export function deleteLearnedMemory(id: string) { return memoryRequest({ action: 'delete', id }) }
