// Host action scope and model background have separate bounds. Serialized
// metadata never grants completeness or coding/approval authority.
const DISPLAY_LIMIT = 1800
const ACTION_LIMIT = 20000
const HISTORY_BYTES = 245760
const capturedComplete = new WeakSet()

export function codingActionText(turn) {
  if (!turn || typeof turn.text !== 'string' || turn.truncated === true) return null
  if (turn.text.length > ACTION_LIMIT) return null
  if (turn.text.length === DISPLAY_LIMIT && !capturedComplete.has(turn)) return null
  return turn.text
}

function boundedTurn(role, text, incomplete) {
  if (incomplete || text.length > ACTION_LIMIT) return { role, text: text.slice(0, DISPLAY_LIMIT), truncated: true }
  const turn = { role, text }
  capturedComplete.add(turn)
  return turn
}

export function captureCodingConversationTurn(role, value) {
  return boundedTurn(role, String(value ?? ''), false)
}

export function restoreCodingConversationTurn(turn) {
  return boundedTurn(turn.role, turn.text, codingActionText(turn) === null)
}

export function boundedCodingConversationTurns(turns) {
  const bounded = Array.isArray(turns) ? turns.filter(turn => turn &&
    ['user', 'nori'].includes(turn.role) && typeof turn.text === 'string').slice(-12)
    .map(restoreCodingConversationTurn) : []
  // Remove oldest context, never shorten a retained owner scope. The newest
  // standard task/offer pair fits even at the worst JSON-escaped 20K limit.
  while (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > HISTORY_BYTES && bounded.length > 2) bounded.shift()
  if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > HISTORY_BYTES) throw new Error('Conversation context exceeds its safe history bound.')
  return bounded
}

export function serializeCodingResumeRecord(record, maxBytes = 262144) {
  const history = boundedCodingConversationTurns(record.history)
  let encoded = JSON.stringify({ ...record, history })
  while (Buffer.byteLength(encoded, 'utf8') > maxBytes && history.length > 2) {
    history.shift()
    encoded = JSON.stringify({ ...record, history })
  }
  // Preserve personality and other metadata exactly. Refuse before opening a
  // stage if the newest pair plus envelope cannot fit the existing reader.
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new Error('Conversation resume exceeds its existing safe size limit; previous saved state was preserved.')
  return encoded
}

export function codingModelBackgroundTurns(turns) {
  return turns.map(turn => ({ role: turn.role, text: turn.text.slice(0, DISPLAY_LIMIT) }))
}

export function priorCodeGenerationRequest(value) {
  if (typeof value !== 'string' || !value || value.length > ACTION_LIMIT) return false
  if (/\b(?:draft|example|sample)[ -]*only\b|\b(?:do\s+not|don't|dont|never)\b.{0,80}\b(?:edit|modify|write|save|execute|run|install|change)\b|\bno\s+(?:files?|edits?|changes?|execution)\b|\bwithout\b.{0,40}\b(?:editing|modifying|writing|saving|executing|running|files?)\b/i.test(value)) return false
  return /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?generate\s+(?:(?:a|an|the)\s+)?(?:python|javascript|typescript)\s+(?:function|script|class|program)\b/i.test(value.trim())
}
