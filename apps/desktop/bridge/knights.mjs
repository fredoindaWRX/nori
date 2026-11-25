/**
 * The 12 Knights of the Round Table: Nori's specialist roles (docs/NORI-CHATGPT-ANALOGY-AND-12-KNIGHTS.md).
 * One local model does the thinking; each Knight owns the tool family that does its job, so a tool
 * call is shown as the Knight doing it ("Knight · Apoc browser open"). Naming a Knight grants nothing:
 * every call still goes through its family's own validation, approval and receipts.
 */

export const KNIGHTS = Object.freeze([
  { id: 'neo', name: 'Neo', role: 'coding', families: ['workspace'] },
  { id: 'trinity', name: 'Trinity', role: 'plugins and skills', families: [] },
  { id: 'morpheus', name: 'Morpheus', role: 'project navigation', families: ['project'] },
  { id: 'apoc', name: 'Apoc', role: 'browser and scouting', families: ['browser'] },
  { id: 'oracle', name: 'Oracle', role: 'your files and documents', families: ['files', 'documents'] },
  { id: 'merovingian', name: 'Merovingian', role: 'memory and learning', families: [] },
  { id: 'architect', name: 'Architect', role: 'planning multi-step work', families: [] },
  { id: 'keymaker', name: 'Keymaker', role: 'web research', families: ['research'] },
  { id: 'smith', name: 'Smith', role: 'running commands', families: ['system', 'shell'] },
  { id: 'tank', name: 'Tank', role: 'hardware and devices', families: ['pcinfo', 'home'] },
  { id: 'machine', name: 'Machine', role: 'model status', families: [] },
  { id: 'sentinel', name: 'Sentinel', role: 'security checks', families: [] },
].map(knight => Object.freeze({ ...knight, families: Object.freeze(knight.families) })))

const BY_FAMILY = new Map(KNIGHTS.flatMap(knight => knight.families.map(family => [family, knight])))
// Skill catalog reads belong to Trinity even though they come from the project family.
const BY_TOOL = new Map([['list_skill_catalog', KNIGHTS.find(knight => knight.id === 'trinity')]])

/** The Knight that owns a tool call, or null for an unknown family. */
export function knightFor(toolName, familyKey) {
  return BY_TOOL.get(toolName) ?? BY_FAMILY.get(familyKey) ?? null
}

const SAFE = /[^A-Za-z0-9_]/g
/** Display-only tool name the HUD renders as "Knight · Apoc browser open". */
export function knightBadge(knight, toolName = '', args = null) {
  const tool = String(toolName).replace(SAFE, '_').slice(0, 48)
  const note = argsNote(args)
  return `mcp__Knight__${knight.name}${tool ? `__${tool}` : ''}${note ? `__${note}` : ''}`
}

// A few words from the call's main argument (query, URL, path, command) for the on-screen council
// view: letters and digits only, at most 48 characters. Display only; it never reaches the model.
const NOTE_KEYS = ['query', 'q', 'url', 'path', 'command', 'name', 'app', 'text', 'goal', 'topic']
export function argsNote(args) {
  if (!args || typeof args !== 'object') return ''
  const value = NOTE_KEYS.map(key => args[key]).find(item => typeof item === 'string' && item.trim())
    ?? Object.values(args).find(item => typeof item === 'string' && item.trim())
  if (typeof value !== 'string') return ''
  return value.replace(/^https?:\/\//i, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
}

/** Specialist families in a union turn that warrant Architect planning (two or more Knights). */
export function architectNeeded(familyKeys) {
  const knights = new Set(familyKeys.map(key => BY_FAMILY.get(key)?.id).filter(Boolean))
  return knights.size >= 2
}

const ROSTER_QUESTION = /\b(?:who|what)\s+(?:are|is)\s+(?:your|the|my)\s+(?:12\s+|twelve\s+)?knights\b|\bknights?\s+(?:of\s+the\s+round\s+table\s+)?(?:status|roster|list)\b|\b(?:list|show(?:\s+me)?)\s+(?:your\s+|the\s+)?(?:12\s+)?knights\b/i

export function isKnightsQuestion(text) { return ROSTER_QUESTION.test(String(text ?? '')) }

/** Exact roster answer from the host, so the model never invents Knights or duties. */
export function knightsAnswer(text, { fullAccess = false } = {}) {
  if (!isKnightsQuestion(text)) return null
  const lines = KNIGHTS.map(knight => {
    const note = knight.id === 'neo' && !fullAccess ? ' (file edits wait for Full Access)' : ''
    return `- ${knight.name}: ${knight.role}${note}`
  })
  return `My 12 Knights of the Round Table. One local model thinks for all of them; each Knight runs the tools for its job, and you see its name when it works.\n${lines.join('\n')}`
}

/**
 * Merge side events (Knight badges) into a text stream as they happen. `makeStream(push)` builds the
 * stream and receives a push(event) callback. Yields { event } for pushed events and { delta } for
 * stream chunks, in arrival order.
 */
export async function* withSideEvents(makeStream) {
  const queue = []
  let wake = null
  const push = event => { queue.push(event); wake?.() }
  const iterator = makeStream(push)[Symbol.asyncIterator]()
  let next = iterator.next()
  try {
    for (;;) {
      while (queue.length) yield { event: queue.shift() }
      const woke = new Promise(resolve => { wake = resolve })
      const result = await Promise.race([next.then(value => ({ value })), woke.then(() => null)])
      wake = null
      if (!result) continue
      if (result.value.done) { while (queue.length) yield { event: queue.shift() }; return }
      yield { delta: result.value.value }
      next = iterator.next()
    }
  } finally {
    // Do not wait: a pending next() would hold return() until the model replies.
    iterator.return?.()?.catch?.(() => {})
  }
}
