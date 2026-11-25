import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// These explicit ceilings keep the parser's own state bounded even when it is
// handed a hostile or unexpectedly large Evidence bundle.
const MAX_DEPTH = 64
const MAX_KEYS_PER_OBJECT = 256
const MAX_KEY_BYTES = 256
const MAX_TEXT_BYTES = 512
const MAX_LIMITATIONS = 8
const MAX_LIMITATION_ITEMS = 8192
const MAX_NUMBER_CHARS = 64
const COUNT_FIELDS = ['procedure_count', 'string_count', 'segment_count']
const ID_PATTERN = /^ev_[a-f0-9]{64}$/
const SHA_PATTERN = /^[a-f0-9]{64}$/i

function ownData(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (!descriptor) return { present: false }
  if (!Object.hasOwn(descriptor, 'value')) throw new Error(`Native Evidence ${key} must be a data property.`)
  return { present: true, value: descriptor.value }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function textCapture() {
  return { prefix: '', dropped: false }
}

function appendText(capture, text) {
  // Two extra UTF-16 units preserve a possible surrogate pair across chunks.
  const remaining = MAX_TEXT_BYTES + 2 - capture.prefix.length
  if (remaining > 0) capture.prefix += text.slice(0, remaining)
  if (text.length > Math.max(0, remaining)) capture.dropped = true
}

function finishText(capture) {
  let value = ''
  let used = 0
  let consumed = 0
  for (const character of capture.prefix) {
    const size = Buffer.byteLength(character, 'utf8')
    if (used + size > MAX_TEXT_BYTES) return { value, truncated: true }
    value += character
    used += size
    consumed += character.length
  }
  return { value, truncated: capture.dropped || consumed < capture.prefix.length }
}

function createState() {
  return { normalizedPresent: false, document: null, counts: Object.create(null),
    limitationsPresent: false, limitations: [], limitationCount: 0, error: null }
}

function invalidate(state, message) {
  if (!state.error) state.error = message
}

function checkedCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Native Evidence ${name} must be a nonnegative safe integer.`)
  return value === 0 ? 0 : value
}

function snapshotFromState(state) {
  if (state.error) throw new Error(state.error)
  if (!state.normalizedPresent) throw new Error('Native Evidence normalized_result must be an object.')
  const summary = {}
  let documentTruncated = false
  if (state.document !== null) {
    const document = finishText(state.document)
    summary.document = document.value
    documentTruncated = document.truncated
  }
  for (const field of COUNT_FIELDS) {
    if (Object.hasOwn(state.counts, field)) summary[field] = checkedCount(state.counts[field], field)
  }
  const limited = state.limitations.map(finishText)
  const omitted = state.limitationCount - limited.length
  return {
    summary,
    limitations: limited.map(item => item.value),
    limitations_available: state.limitationsPresent,
    limitations_omitted: omitted,
    truncated: { document: documentTruncated, limitations: omitted > 0 || limited.some(item => item.truncated) },
  }
}

/** Normalize only bounded fields from an MCP binary_overview or saved record. */
export function snapshotNativeOverview(value) {
  if (!isObject(value)) throw new Error('Native Evidence result must be an object.')
  const op = ownData(value, 'operation')
  if (op.present && op.value !== 'binary_overview') throw new Error('Native Evidence operation is not binary_overview.')
  const normalized = ownData(value, 'normalized_result')
  if (!normalized.present || !isObject(normalized.value)) throw new Error('Native Evidence normalized_result must be an object.')
  const state = createState()
  state.normalizedPresent = true
  const doc = ownData(normalized.value, 'document')
  if (doc.present) {
    if (typeof doc.value !== 'string') throw new Error('Native Evidence document must be a string.')
    state.document = textCapture()
    appendText(state.document, doc.value)
  }
  for (const field of COUNT_FIELDS) {
    const candidate = ownData(normalized.value, field)
    if (candidate.present) state.counts[field] = checkedCount(candidate.value, field)
  }
  const limitations = ownData(value, 'limitations')
  if (limitations.present) {
    if (!Array.isArray(limitations.value) || limitations.value.length > MAX_LIMITATION_ITEMS) {
      throw new Error('Native Evidence limitations must be a bounded array of strings.')
    }
    state.limitationsPresent = true
    state.limitationCount = limitations.value.length
    for (let index = 0; index < limitations.value.length; index++) {
      const item = ownData(limitations.value, String(index))
      if (!item.present || typeof item.value !== 'string') throw new Error('Native Evidence limitation must be a string.')
      if (index < MAX_LIMITATIONS) {
        const capture = textCapture()
        appendText(capture, item.value)
        state.limitations.push(capture)
      }
    }
  }
  return snapshotFromState(state)
}

function makeCollector(evidenceId) {
  const frames = []
  let rootStarted = false
  let rootFinished = false
  let recordsSeen = false
  let active = null
  let record = null
  let matchingCount = 0
  let matchedSnapshot = null

  function parent() { return frames.at(-1) }
  function field(frame) { return frame?.kind === 'object' ? frame.key : null }

  function checkValue(frame, type) {
    if (!frame) return
    const key = field(frame)
    if (frame.role === 'root' && key === 'records' && type !== 'array') throw new Error('Native Evidence records must be an array.')
    if (frame.role === 'records' && type !== 'object') throw new Error('Native Evidence records must contain objects.')
    if (frame.role === 'record') {
      if (['evidence_id', 'operation'].includes(key) && type !== 'string') invalidate(record, `Native Evidence ${key} must be a string.`)
      if (key === 'normalized_result' && type !== 'object') invalidate(record, 'Native Evidence normalized_result must be an object.')
      if (key === 'limitations' && type !== 'array') invalidate(record, 'Native Evidence limitations must be an array.')
    }
    if (frame.role === 'normalized') {
      if (key === 'document' && type !== 'string') invalidate(record, 'Native Evidence document must be a string.')
      if (COUNT_FIELDS.includes(key) && type !== 'number') invalidate(record, `Native Evidence ${key} must be a number.`)
    }
    if (frame.role === 'limitations' && type !== 'string') invalidate(record, 'Native Evidence limitation must be a string.')
  }

  function startContainer(kind) {
    const outer = parent()
    checkValue(outer, kind)
    let role = 'other'
    if (!outer) {
      if (rootStarted || kind !== 'object') throw new Error('Native Evidence bundle must be one object.')
      rootStarted = true
      role = 'root'
    } else if (outer.role === 'root' && field(outer) === 'records' && kind === 'array') {
      recordsSeen = true
      role = 'records'
    } else if (outer.role === 'records' && kind === 'object') {
      record = createState()
      record.evidenceId = null
      record.operation = null
      role = 'record'
    } else if (outer.role === 'record' && field(outer) === 'normalized_result' && kind === 'object') {
      record.normalizedPresent = true
      role = 'normalized'
    } else if (outer.role === 'record' && field(outer) === 'limitations' && kind === 'array') {
      record.limitationsPresent = true
      role = 'limitations'
    }
    if (frames.length >= MAX_DEPTH) throw new Error('Native Evidence nesting limit exceeded.')
    frames.push({ kind, role, key: null, seen: kind === 'object' ? new Set() : null })
  }

  function finishContainer(kind) {
    const frame = frames.pop()
    if (!frame || frame.kind !== kind) throw new Error('Native Evidence container mismatch.')
    if (frame.role === 'record') {
      const id = record.evidenceId && finishText(record.evidenceId)
      if (id && !id.truncated && id.value === evidenceId) {
        matchingCount++
        if (matchingCount !== 1) throw new Error('Native Evidence contains duplicate matching IDs.')
        const op = record.operation && finishText(record.operation)
        if (!op || op.truncated || op.value !== 'binary_overview') throw new Error('Native Evidence operation is not binary_overview.')
        matchedSnapshot = snapshotFromState(record)
      }
      record = null
    }
    if (frame.role === 'root') rootFinished = true
  }

  function startScalar(type) {
    const frame = parent()
    if (!frame) throw new Error('Native Evidence bundle must be one object.')
    checkValue(frame, type)
    const key = field(frame)
    active = { type, capture: null, number: '', numberOverflow: false, countKey: null }
    if (type === 'string' && frame.role === 'record' && ['evidence_id', 'operation'].includes(key)) {
      active.capture = textCapture()
      if (key === 'evidence_id') record.evidenceId = active.capture
      else record.operation = active.capture
    } else if (type === 'string' && frame.role === 'normalized' && key === 'document') {
      active.capture = textCapture()
      record.document = active.capture
    } else if (type === 'number' && frame.role === 'normalized' && COUNT_FIELDS.includes(key)) {
      active.countKey = key
    } else if (type === 'string' && frame.role === 'limitations') {
      record.limitationCount++
      if (record.limitationCount > MAX_LIMITATION_ITEMS) invalidate(record, 'Native Evidence limitations exceed the item limit.')
      if (record.limitationCount <= MAX_LIMITATIONS) {
        active.capture = textCapture()
        record.limitations.push(active.capture)
      }
    }
  }

  function consume(token) {
    switch (token.name) {
      case 'startObject': startContainer('object'); break
      case 'endObject': finishContainer('object'); break
      case 'startArray': startContainer('array'); break
      case 'endArray': finishContainer('array'); break
      case 'startKey':
        if (!parent() || parent().kind !== 'object') throw new Error('Unexpected Native Evidence key.')
        active = { type: 'key', value: '' }
        break
      case 'endKey': {
        if (!active || active.type !== 'key' || Buffer.byteLength(active.value, 'utf8') > MAX_KEY_BYTES) {
          throw new Error('Native Evidence key length limit exceeded.')
        }
        const frame = parent()
        if (frame.seen.has(active.value)) throw new Error('Native Evidence contains an ambiguous duplicate key.')
        if (frame.seen.size >= MAX_KEYS_PER_OBJECT) throw new Error('Native Evidence object key limit exceeded.')
        frame.seen.add(active.value)
        frame.key = active.value
        active = null
        break
      }
      case 'startString': startScalar('string'); break
      case 'stringChunk':
        if (active?.type === 'key') {
          if (active.value.length + token.value.length > MAX_KEY_BYTES) throw new Error('Native Evidence key length limit exceeded.')
          active.value += token.value
        } else if (active?.type === 'string' && active.capture) appendText(active.capture, token.value)
        break
      case 'endString': active = null; break
      case 'startNumber': startScalar('number'); break
      case 'numberChunk':
        if (active?.countKey) {
          if (active.number.length + token.value.length > MAX_NUMBER_CHARS) active.numberOverflow = true
          else active.number += token.value
        }
        break
      case 'endNumber':
        if (active?.countKey) {
          const number = Number(active.number)
          if (active.numberOverflow || !Number.isSafeInteger(number) || number < 0) {
            invalidate(record, `Native Evidence ${active.countKey} must be a nonnegative safe integer.`)
          } else record.counts[active.countKey] = number === 0 ? 0 : number
        }
        active = null
        break
      case 'trueValue': case 'falseValue': case 'nullValue': checkValue(parent(), 'literal'); break
      default: throw new Error(`Unexpected Native Evidence parser token: ${token.name}`)
    }
  }

  function finish() {
    if (!rootFinished || frames.length || !recordsSeen) throw new Error('Native Evidence bundle has no complete records array.')
    if (matchingCount !== 1) throw new Error('Native Evidence does not contain exactly one matching record.')
    return matchedSnapshot
  }
  return { consume, finish }
}

/** Read one exact native Evidence record while hashing the same byte stream. */
export async function readNativeEvidence({ filePath, reaScript, evidenceId, expectedSha256, signal } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)
      || typeof reaScript !== 'string' || !path.isAbsolute(reaScript)
      || typeof evidenceId !== 'string' || !ID_PATTERN.test(evidenceId)
      || typeof expectedSha256 !== 'string' || !SHA_PATTERN.test(expectedSha256)) {
    throw new TypeError('An absolute Evidence path, trusted REA script, Evidence ID, and expected SHA-256 are required.')
  }
  signal?.throwIfAborted()
  const beforePath = await lstat(filePath, { bigint: true })
  if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.nlink !== 1n) {
    throw new Error('Native Evidence must be one regular, non-linked file.')
  }
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  let source, digestStream, parser, pump
  try {
    signal?.throwIfAborted()
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.dev !== beforePath.dev || before.ino !== beforePath.ino
      || before.size !== beforePath.size || before.mtimeNs !== beforePath.mtimeNs || before.ctimeNs !== beforePath.ctimeNs) {
      throw new Error('Native Evidence changed before it was opened.')
    }
    const { parserStream } = createRequire(reaScript)('stream-json')
    const collector = makeCollector(evidenceId)
    const hash = createHash('sha256')
    const utf8 = new TextDecoder('utf-8', { fatal: true })
    let bytes = 0
    source = handle.createReadStream({ autoClose: false, highWaterMark: 16 * 1024 })
    digestStream = new Transform({ transform(chunk, encoding, done) {
      bytes += chunk.length
      if (!Number.isSafeInteger(bytes)) return done(new Error('Native Evidence byte count exceeds safe integer range.'))
      try {
        utf8.decode(chunk, { stream: true })
        hash.update(chunk)
        done(null, chunk)
      } catch (error) { done(error) }
    }, flush(done) {
      try { utf8.decode(); done() } catch (error) { done(error) }
    } })
    parser = parserStream({ packValues: false, streamValues: true })
    pump = pipeline(source, digestStream, parser, { signal }).then(() => null, error => error)
    for await (const token of parser) {
      signal?.throwIfAborted()
      collector.consume(token)
    }
    const pumpError = await pump
    if (pumpError) throw pumpError
    signal?.throwIfAborted()
    const after = await handle.stat({ bigint: true })
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(bytes) !== before.size) {
      throw new Error('Native Evidence changed while being read.')
    }
    const sha256 = hash.digest('hex')
    if (sha256 !== expectedSha256.toLowerCase()) throw new Error('Native Evidence SHA-256 does not match the saved digest.')
    const snapshot = collector.finish()
    signal?.throwIfAborted()
    return { evidence_id: evidenceId, operation: 'binary_overview', snapshot, sha256, bytes }
  } finally {
    source?.destroy()
    digestStream?.destroy()
    parser?.destroy()
    if (pump) await pump
    await handle.close()
  }
}
