import { execFile } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { installationPaths } from './installation-paths.mjs'

const execFileAsync = promisify(execFile)

// Norama worker prompt budget.
//
// The worker refuses any chat prompt above its advertised prompt_limit, and
// NorLlama rejects any handshake that does not match the built worker, so the
// constants below have to match worker.cu exactly:
//   ENGINE_CONTEXT_TOKENS   checkpoint_graph.hpp clamps llama.context_length
//                           (131072 in this checkpoint) to 8192.
//   KV_SESSION_TOKENS       the 1 GiB session cache budget divided by the
//                           F16 per-token KV footprint: 8 kv heads x 128 width x
//                           4 bytes x 28 layers = 114688 bytes/token, which
//                           admits 9362 tokens.
//   SESSION_CAPACITY_TOKENS the admitted prompt+output session size. 6144 =
//                           PROMPT_BUDGET + OUTPUT_RESERVE, below both limits
//                           above and leaving 2048 tokens of engine headroom.
//   OUTPUT_RESERVE_TOKENS   the worker output_limit, so generation room is
//                           never consumed by conversation history.
export const ENGINE_CONTEXT_TOKENS = 8192
export const KV_SESSION_TOKENS = 9362
export const SESSION_CAPACITY_TOKENS = 6144
export const OUTPUT_RESERVE_TOKENS = 2048
export const PROMPT_BUDGET_TOKENS = 4096

// Windows command lines are bounded, so very long messages take the byte-count
// path instead of risking an argument that cannot be spawned.
export const MAX_EXACT_COUNT_CHARS = 16000
const COUNT_CACHE_LIMIT = 4096
const COUNT_CONCURRENCY = 4

export class PromptBudgetError extends Error {
  constructor(detail) {
    super(`Nori prompt budget exceeded: ${String(detail).slice(0, 240)}`)
    this.name = 'PromptBudgetError'
  }
}

// A BPE token never covers fewer than one UTF-8 byte, so byte counts are a
// rigorous upper bound on token counts. This is the safe framing used when the
// exact engine tokenizer cannot run on this machine.
export function byteCount(text) {
  return Buffer.byteLength(String(text), 'utf8')
}

export function byteFraming() {
  return { system: byteCount('system'), user: byteCount('user'),
           assistant: byteCount('assistant'), sep: byteCount('\n\n') }
}

// tokenizer.hpp chat_prompt framing: BOS, then for each message start_header,
// role, end_header, "\n\n", content, eot, then the closing assistant header.
export function messageOverheadTokens(framing, role) {
  if (!framing || typeof framing[role] !== 'number') throw new PromptBudgetError(`unsupported role ${String(role)}`)
  return 3 + framing[role] + framing.sep
}

export function promptFixedTokens(framing) {
  if (!framing || typeof framing.assistant !== 'number') throw new PromptBudgetError('missing framing constants')
  return 3 + framing.assistant + framing.sep
}

export async function promptTokens(messages, { framing, countContent } = {}) {
  const frame = framing || byteFraming()
  const count = countContent || byteCount
  let total = promptFixedTokens(frame)
  for (const message of messages) total += messageOverheadTokens(frame, message.role) + await count(message.content)
  return total
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

// Drop whole oldest user turns (including their assistant replies) until the
// prompt fits. Text is never cut, and system messages plus the newest user turn
// are always preserved. Orphan assistant messages are never sent by themselves.
export async function fitPrompt(messages, options = {}) {
  const { budget = PROMPT_BUDGET_TOKENS, framing = byteFraming(), countContent = byteCount, maxMessages = 64 } = options
  if (!Array.isArray(messages) || messages.length === 0) throw new PromptBudgetError('conversation is empty')
  if (!Number.isInteger(budget) || budget < 1) throw new PromptBudgetError('budget must be a positive token count')
  if (!Number.isInteger(maxMessages) || maxMessages < 1) throw new PromptBudgetError('maxMessages must be a positive integer')
  const entries = messages.map((message, index) => {
    if (!message || typeof message !== 'object') throw new PromptBudgetError(`message ${index} is not an object`)
    if (!['system', 'user', 'assistant'].includes(message.role)) throw new PromptBudgetError(`message ${index} has an unsupported role`)
    if (typeof message.content !== 'string') throw new PromptBudgetError(`message ${index} has no text content`)
    return { index, role: message.role, content: message.content, overhead: messageOverheadTokens(framing, message.role) }
  })
  const counts = await mapLimit(entries, COUNT_CONCURRENCY, entry => countContent(entry.content))
  const tokens = entries.map((entry, index) => entry.overhead + counts[index])
  const systemIndexes = entries.filter(entry => entry.role === 'system').map(entry => entry.index)
  const turns = []
  let activeTurn = null
  for (const entry of entries) {
    if (entry.role === 'system') continue
    if (entry.role === 'user') {
      activeTurn = { indexes: [entry.index] }
      turns.push(activeTurn)
    } else if (activeTurn) {
      activeTurn.indexes.push(entry.index)
    }
  }
  if (turns.length === 0) throw new PromptBudgetError('conversation has no user turn')

  const latestTurn = turns.at(-1)
  const keep = new Set([...systemIndexes, ...latestTurn.indexes])
  let used = promptFixedTokens(framing)
  for (const index of keep) used += tokens[index]
  if (used > budget) {
    throw new PromptBudgetError(`the system prompt and the newest message alone need ${used} tokens, above the ${budget}-token budget`)
  }
  if (keep.size > maxMessages) throw new PromptBudgetError('system prompt and newest user turn exceed the message limit')
  for (let turnIndex = turns.length - 2; turnIndex >= 0; turnIndex -= 1) {
    const turnIndexes = turns[turnIndex].indexes
    const turnTokens = turnIndexes.reduce((sum, index) => sum + tokens[index], 0)
    if (keep.size + turnIndexes.length > maxMessages || used + turnTokens > budget) break
    for (const index of turnIndexes) keep.add(index)
    used += turnTokens
  }
  const droppedTurns = turns.length - [...keep].filter(index => entries[index].role === 'user').length
  const fitted = messages.filter((_, index) => keep.has(index))
  return { messages: fitted, promptTokens: used, dropped: droppedTurns, droppedMessages: messages.length - fitted.length }
}

async function encodeCount(binary, model, text) {
  const { stdout } = await execFileAsync(binary, [model, '--encode', text],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' })
  const line = stdout.trim()
  if (!line) return 0
  if (!/^\d+(?:,\d+)*$/.test(line)) throw new Error('unexpected tokenizer output')
  return line.split(',').length
}

export async function configuredModelPath(root, configPath) {
  root = await realpath(root)
  const contained = async path => {
    const resolved = await realpath(path)
    const delta = relative(root, resolved)
    if (delta.startsWith('..') || isAbsolute(delta)) throw new Error('Tokenizer configuration or model escapes Nori root')
    return resolved
  }
  const selected = await contained(configPath ?? join(root, 'runtime', 'norllama', 'config.json'))
  const config = await readFile(selected, 'utf8')
  const parsed = JSON.parse(config)
  if (typeof parsed.model_path !== 'string' || !parsed.model_path) throw new Error('runtime model path is not configured')
  if (isAbsolute(parsed.model_path)) throw new Error('Tokenizer model path must be relative to Nori')
  return contained(resolve(root, parsed.model_path))
}

// Imported Qwen's worker advertises a separate prompt limit from the legacy
// Norama session profile above. Trust only the exact shipped Qwen 27B config;
// all other or malformed configurations retain the conservative legacy cap.
export async function configuredPromptBudget({ noriRoot, configPath } = {}) {
  const root = noriRoot ?? installationPaths().noriRoot
  const selected = configPath ?? join(root, 'runtime', 'norllama', 'config.json')
  const parsed = JSON.parse(await readFile(selected, 'utf8'))
  if (parsed.architecture === 'imported-qwen35'
    && parsed.model_id === 'qwen3.8-27b'
    && parsed.cache_precision === 'f32'
    && parsed.prompt_limit === 65536) return parsed.prompt_limit
  return PROMPT_BUDGET_TOKENS
}

// Exact counting through the engine's own tokenizer CLI, which shares the
// worker's vocabulary and BPE rules. The framing constants are measured from
// that same vocabulary instead of assumed. Falls back to the rigorous byte
// bound when the tool or the configured checkpoint is unavailable.
export async function createEngineTokenCounter({ noriRoot, modelPath, tokenizerBinary, configPath } = {}) {
  const root = noriRoot ?? installationPaths().noriRoot
  const binary = tokenizerBinary ?? join(root, 'engine', 'norama', 'norama-tokenizer.exe')
  const model = modelPath ?? await configuredModelPath(root, configPath)
  const framing = {
    system: await encodeCount(binary, model, 'system'),
    user: await encodeCount(binary, model, 'user'),
    assistant: await encodeCount(binary, model, 'assistant'),
    sep: await encodeCount(binary, model, '\n\n'),
  }
  const cache = new Map()
  return {
    exact: true,
    framing,
    countContent: async (text) => {
      const content = String(text ?? '')
      if (!content) return 0
      if (content.length > MAX_EXACT_COUNT_CHARS || content.includes('\0')) return byteCount(content)
      const hit = cache.get(content)
      if (hit !== undefined) return hit
      let counted
      try {
        counted = await encodeCount(binary, model, content)
      } catch {
        counted = byteCount(content) // Never under-count: an over-count only drops an older turn.
      }
      if (cache.size >= COUNT_CACHE_LIMIT) cache.clear()
      cache.set(content, counted)
      return counted
    },
  }
}

let counterPromise = null

// One counter per bridge process: the framing call is paid once and repeated
// conversation turns hit the content cache, so steady state costs one spawn.
export function nativePromptCounter() {
  if (!counterPromise) {
    const configPath = process.env.NORI_RUNTIME_CONFIG_PATH
    counterPromise = Promise.all([
      createEngineTokenCounter({ configPath }).catch(() => ({ exact: false, framing: byteFraming(), countContent: byteCount })),
      configuredPromptBudget({ configPath }).catch(() => PROMPT_BUDGET_TOKENS),
    ]).then(([counter, promptBudget]) => ({ ...counter, promptBudget }))
  }
  return counterPromise
}

