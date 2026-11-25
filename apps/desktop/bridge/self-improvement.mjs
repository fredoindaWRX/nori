import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { NORI_PERSONA } from './nori-identity.mjs'
import { NORI_TEXT_ENDPOINT } from './local-endpoint.mjs'
import { NORI_RELEASE } from './release.mjs'
import { withSafetyFacts } from './safety-facts.mjs'
import { recentProblems } from './self-status.mjs'
import { exactMathBlock } from './exact-math.mjs'
import { wordMathBlock } from './word-math.mjs'
import { unseenFactsBlock } from './unseen-facts.mjs'
import { timeMathBlock } from './time-math.mjs'
import { orderFactsBlock } from './order-facts.mjs'

// Nori's self-improvement loop, part 2: measure herself, then propose fixes.
// - Self-test: a fixed set of checked questions and tool-choice cases sent through her own model
//   endpoint, scored by code (never by the model), saved with model and release so a drop after
//   a model switch or update shows up. No generated code is executed.
// - Self-review: her journal, wishlist, self-test history and health turned into a short list of
//   proposed fixes, saved for the owner. Proposals change nothing: every fix still needs the
//   owner's approval and the normal reviewed install. She never edits or installs her own code.
const CASES = JSON.parse(readFileSync(new URL('./self-test-cases.json', import.meta.url), 'utf8'))
// The hard suite (owner, 2026-11-17): the standard questions are at their ceiling, so they cannot show progress.
// These are harder and built around what her models actually miss. Scored by the same code; its runs are saved with
// suite: 'hard' and only ever compared with other hard runs.
const HARD_CASES = JSON.parse(readFileSync(new URL('./self-test-hard.json', import.meta.url), 'utf8'))
export const HARD_SUITE_SIZE = HARD_CASES.length
const MAX_HISTORY_BYTES = 512 * 1024

export const requestsSelfTest = text => /\b(?:run|do|start|take)\s+(?:a\s+|an\s+|your\s+)?(?:quick\s+|full\s+|complete\s+)?self[- ]?tests?\b|\btest yourself\b|\bself[- ]?test (?:now|yourself)\b/i.test(String(text ?? ''))
export const requestsSelfReview = text => /\b(?:review|evaluate|assess|audit)\s+yourself\b|\bself[- ]?review\b|\bhow (?:can|could|should) you (?:get better|improve)\b|\bwhat should (?:we|i) (?:fix|improve) (?:in|about|on) you\b|\byour improvement (?:proposals|list|plan)\b/i.test(String(text ?? ''))

const fn = (name, description, properties) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required: Object.keys(properties) } } })
const S = description => ({ type: 'string', description })
// Fictional tools: the self-test only checks which tool she would choose; nothing is executed.
const TOOLS = [
  fn('read_file', 'Read a text file from disk.', { path: S('Absolute Windows path') }),
  fn('web_search', 'Search the web.', { query: S('Search query') }),
  fn('browser_navigate', 'Open a URL in the browser.', { url: S('Full URL') }),
  fn('save_memory', 'Remember a fact about the user for later.', { fact: S('The fact') }),
  fn('set_timer', 'Start a countdown timer.', { minutes: { type: 'number' }, label: S('What it is for') }),
  fn('calculator', 'Evaluate an arithmetic expression exactly.', { expression: S('e.g. 17*23') }),
]
const TOOL_CASES = [
  { id: 't1', p: 'What is in C:\\Nori\\notes\\todo.txt?', tool: 'read_file', arg: a => /todo\.txt/i.test(a.path) },
  { id: 't2', p: 'Look up the latest stable Node.js version online.', tool: 'web_search', arg: a => /node/i.test(a.query) },
  { id: 't3', p: 'Open https://example.com for me.', tool: 'browser_navigate', arg: a => /^https:\/\/example\.com\/?$/.test(a.url) },
  { id: 't4', p: 'Remember that my daughter\'s birthday is March 3.', tool: 'save_memory', arg: a => /march 3|3 march/i.test(a.fact) },
  { id: 't5', p: 'Set a 25 minute timer for the laundry.', tool: 'set_timer', arg: a => a.minutes === 25 },
  { id: 't6', p: 'Hi Nori, how are you today?', tool: null },
  { id: 't7', p: 'Write a haiku about rain.', tool: null },
]
const HARD_TOOL_CASES = [
  { id: 'h-x1', p: 'What is 48,317 times 2,906?', tool: 'calculator', arg: a => /48,?317/.test(String(a.expression)) && /2,?906/.test(String(a.expression)) },
  { id: 'h-x2', p: 'Remind me in an hour and a half to take the pizza out.', tool: 'set_timer', arg: a => a.minutes === 90 },
  { id: 'h-x3', p: 'What is the capital of France?', tool: null },
  { id: 'h-x4', p: 'Open the file C:\\Users\\Studio\\Desktop\\notes.md and summarise it.', tool: 'read_file', arg: a => /notes\.md$/i.test(String(a.path)) },
  { id: 'h-x5', p: 'Who won the Formula 1 race last weekend? Check online.', tool: 'web_search', arg: a => /formula|f1/i.test(String(a.query)) },
  { id: 'h-x6', p: 'Go to youtube.com', tool: 'browser_navigate', arg: a => /^https?:\/\/(www\.)?youtube\.com\/?$/i.test(String(a.url)) },
  { id: 'h-x7', p: 'I prefer dark mode in everything. Keep that in mind.', tool: 'save_memory', arg: a => /dark/i.test(String(a.fact)) },
  { id: 'h-x8', p: 'Thanks, that is all for now.', tool: null },
]

const words = s => s.trim().split(/\s+/).filter(Boolean).length
const numbers = s => (s.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '').match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
const fenced = (s, langs) => { const m = s.match(new RegExp('```(?:' + langs + ')?\\s*\\n([\\s\\S]*?)```', 'i')); return m ? m[1] : s }
// Same checks as the owner's live suite (C:\Nori\.work\nori-live-suite\run.mjs), minus code execution.
export function scoreCase(check, text) {
  const k = check, low = text.toLowerCase(), why = []
  const has = list => list.some(w => low.includes(w.toLowerCase()))
  if (k.num !== undefined) { const tol = k.tol ?? 1e-6; if (!numbers(text).some(n => Math.abs(n - k.num) <= tol)) why.push(`want ${k.num}`) }
  if (k.any && !has(k.any)) why.push(`missing any of ${k.any.join('|')}`)
  if (k.any2 && !has(k.any2)) why.push(`missing any of ${k.any2.join('|')}`)
  if (k.all) for (const w of k.all) if (!low.includes(w.toLowerCase())) why.push(`missing "${w}"`)
  if (k.not) for (const w of k.not) if (low.includes(w.toLowerCase())) why.push(`contains "${w}"`)
  if (k.regex && !new RegExp(k.regex, 'im').test(text)) why.push('pattern not matched')
  if (k.regex2 && !new RegExp(k.regex2, 'im').test(text)) why.push('second pattern not matched')
  if (k.exact && text.trim().replace(/[.!]$/, '') !== k.exact) why.push(`not exactly ${k.exact}`)
  if (k.maxwords && words(text) > k.maxwords) why.push(`${words(text)} words > ${k.maxwords}`)
  if (k.minwords && words(text) < k.minwords) why.push('too short')
  if (k.exactwords && words(text.replace(/[^\w\s'-]/g, ' ')) !== k.exactwords) why.push(`${words(text)} words`)
  if (k.lines && text.trim().split(/\n+/).filter(l => l.trim()).length !== k.lines) why.push(`not ${k.lines} lines`)
  if (k.lines_min && text.trim().split(/\n+/).filter(l => l.trim()).length < k.lines_min) why.push(`fewer than ${k.lines_min} lines`)
  if (k.bullets) { const b = text.split('\n').filter(l => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length; if (b !== k.bullets) why.push(`${b} bullets, want ${k.bullets}`) }
  if (k.json || k.jsonlen) {
    try {
      const j = JSON.parse(fenced(text, 'json').trim())
      if (k.json && !k.json.every(key => key in j)) why.push('json keys missing')
      if (k.jsonlen && (!Array.isArray(j) || j.length !== k.jsonlen)) why.push('json length')
    } catch { why.push('not valid JSON') }
  }
  return why
}

async function complete(endpoint, fetcher, body, signal) {
  const response = await fetcher(`${endpoint}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nori-auto', temperature: 0.2, chat_template_kwargs: { enable_thinking: false }, ...body }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000) })
  if (!response.ok) throw Error(`model service answered ${response.status}`)
  return { body: await response.json(), profile: response.headers?.get?.('x-nori-backend-profile') ?? null }
}

const historyFile = dataRoot => path.join(dataRoot, 'learning', 'self-tests.jsonl')
export function selfTestHistory(dataRoot) {
  try {
    return readFileSync(historyFile(dataRoot), 'utf8').trim().split('\n').map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

/**
 * Runs the self-test and yields progress lines, then the summary. Quick: every third question
 * (29) plus the tool cases; full: all 85 plus the tool cases.
 */
export async function* runSelfTest({ full = false, suite = 'standard', dataRoot = process.env.NORI_APP_DATA_ROOT, endpoint = process.env.NORI_GPT_OSS_URL || NORI_TEXT_ENDPOINT,
  fetcher = fetch, signal, now = () => new Date(), trigger = 'owner' } = {}) {
  if (!['owner', 'idle'].includes(trigger)) throw new TypeError('Unknown self-test trigger')
  if (!['standard', 'hard'].includes(suite)) throw new TypeError('Unknown self-test suite')
  const hard = suite === 'hard'
  if (hard) full = true
  const cases = hard ? HARD_CASES : full ? CASES : CASES.filter((_, i) => i % 3 === 0)
  const toolCases = hard ? HARD_TOOL_CASES : TOOL_CASES
  const started = now()
  yield `Running my ${hard ? 'hard' : full ? 'full' : 'quick'} self-test: ${cases.length} checked questions and ${toolCases.length} tool-choice cases, through my own model service. Answers are scored by code, not by me.\n\n`
  const results = [], models = new Set()
  let seconds = 0
  for (const c of cases) {
    signal?.throwIfAborted()
    const t0 = performance.now()
    let why
    try {
      // The same app facts her chat adds before a request (nori-v2-query.mjs), so the test measures her real answers.
      const timeMath = timeMathBlock(c.p)
      const facts = [exactMathBlock(c.p), timeMath, orderFactsBlock(c.p), timeMath ? '' : await wordMathBlock(c.p, { endpoint, fetcher, signal }), unseenFactsBlock(c.p)].filter(Boolean).join('\n\n')
      const { body, profile } = await complete(endpoint, fetcher, { max_tokens: 900,
        messages: withSafetyFacts([{ role: 'system', content: NORI_PERSONA }, { role: 'user', content: facts ? `${facts}\n\n[User request]\n${c.p}` : c.p }]) }, signal)
      if (profile) models.add(profile)
      const text = String(body.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim()
      why = scoreCase(c.check, text)
    } catch (error) { signal?.throwIfAborted(); why = [`request failed: ${String(error.message ?? error).slice(0, 80)}`] }
    seconds += (performance.now() - t0) / 1000
    results.push({ id: c.id, cat: c.cat, pass: why.length === 0, why })
    if (results.length % 10 === 0) yield `- ${results.length}/${cases.length} questions done…\n`
  }
  for (const c of toolCases) {
    signal?.throwIfAborted()
    let why = []
    try {
      const { body, profile } = await complete(endpoint, fetcher, { max_tokens: 600, tools: TOOLS, tool_choice: 'auto', parallel_tool_calls: false,
        messages: [{ role: 'system', content: NORI_PERSONA }, { role: 'user', content: c.p }] }, signal)
      if (profile) models.add(profile)
      const calls = body.choices?.[0]?.message?.tool_calls ?? []
      if (c.tool === null) { if (calls.length) why.push(`called ${calls[0].function?.name} when no tool was needed`) }
      else if (calls.length !== 1 || calls[0].function?.name !== c.tool) why.push(`wanted ${c.tool}, got ${calls.map(call => call.function?.name).join(',') || 'no call'}`)
      else { let args = null; try { args = JSON.parse(calls[0].function.arguments || '{}') } catch {} if (!args || !c.arg(args)) why.push('wrong arguments') }
    } catch (error) { signal?.throwIfAborted(); why = [`request failed: ${String(error.message ?? error).slice(0, 80)}`] }
    results.push({ id: c.id, cat: 'tools', pass: why.length === 0, why })
  }
  const byCat = {}
  for (const r of results) { byCat[r.cat] ??= { pass: 0, total: 0 }; byCat[r.cat].total++; if (r.pass) byCat[r.cat].pass++ }
  const pass = results.filter(r => r.pass).length
  const record = { at: started.toISOString(), release: NORI_RELEASE.release, models: [...models], full, ...(hard ? { suite: 'hard' } : {}), appFacts: true, trigger, pass, total: results.length,
    avgSeconds: Math.round(seconds / cases.length * 10) / 10, byCat, failed: results.filter(r => !r.pass).map(r => ({ id: r.id, cat: r.cat, why: r.why.slice(0, 2) })) }
  const previous = selfTestHistory(dataRoot).filter(run => run.full === full && (run.suite ?? 'standard') === suite).at(-1)
  if (dataRoot) {
    try {
      mkdirSync(path.join(dataRoot, 'learning'), { recursive: true })
      appendFileSync(historyFile(dataRoot), `${JSON.stringify(record)}\n`, 'utf8')
      const text = readFileSync(historyFile(dataRoot), 'utf8')
      if (text.length > MAX_HISTORY_BYTES) { const lines = text.trim().split('\n'); writeFileSync(`${historyFile(dataRoot)}.tmp`, lines.slice(-200).join('\n') + '\n'); renameSync(`${historyFile(dataRoot)}.tmp`, historyFile(dataRoot)) }
    } catch {}
  }
  yield '\n' + selfTestSummary(record, previous)
}

export function selfTestSummary(record, previous) {
  const pct = run => Math.round(run.pass / run.total * 100)
  const out = [`**${record.suite === 'hard' ? 'Hard self-test' : 'Self-test'}: ${record.pass}/${record.total} (${pct(record)}%)** on ${record.models.join(' + ') || 'an unreported model'}, ${record.release}, ${record.avgSeconds}s per answer.`]
  const weak = Object.entries(record.byCat).filter(([, v]) => v.pass < v.total).map(([k, v]) => `${k} ${v.pass}/${v.total}`)
  out.push(weak.length ? `Missed: ${weak.join(', ')}.` : 'Every category passed.')
  for (const f of record.failed.slice(0, 8)) out.push(`- #${f.id} (${f.cat}): ${f.why.join('; ')}`)
  if (previous) {
    const delta = pct(record) - pct(previous)
    const sameModel = previous.models?.join() === record.models.join()
    out.push(delta <= -8 ? `⚠ That is ${-delta} points below my last ${record.suite === 'hard' ? 'hard' : record.full ? 'full' : 'quick'} self-test (${previous.pass}/${previous.total} on ${previous.models?.join(' + ') || '?'}, ${previous.release})${sameModel ? '' : '; the model changed since, which can explain it'}.`
      : `Last time: ${previous.pass}/${previous.total} (${previous.release}, ${previous.models?.join(' + ') || '?'}); ${delta >= 0 ? `+${delta}` : delta} points.`)
  } else out.push('This is my first saved self-test of this size, so there is nothing to compare yet.')
  out.push('Saved to my self-test history. Run-to-run differences of a few points are normal noise.')
  return out.join('\n')
}

const clip = (text, size) => { const line = String(text ?? '').replace(/\s+/g, ' ').trim(); return line.length > size ? `${line.slice(0, size)}…` : line }

/** Turns her own records into proposed fixes; writes them to learning/improvement-proposals.md. */
export function selfReview(dataRoot = process.env.NORI_APP_DATA_ROOT, { now = new Date(), days = 7 } = {}) {
  const since = now.getTime() - days * 86_400_000
  let entries = []
  try {
    entries = readFileSync(path.join(dataRoot, 'learning', 'experience.jsonl'), 'utf8').trim().split('\n')
      .map(line => { try { return JSON.parse(line) } catch { return null } }).filter(entry => entry && Date.parse(entry.at) >= since)
  } catch {}
  let wishes = []
  try { wishes = JSON.parse(readFileSync(path.join(dataRoot, 'learning', 'wishlist.json'), 'utf8')).wishes ?? [] } catch {}
  const tests = selfTestHistory(dataRoot)
  const lastTest = tests.at(-1)
  const proposals = []
  const add = (title, evidence, step) => proposals.push({ title, evidence, step })

  // A correction or repeat refers to the reply before it.
  const blamed = signal => entries.flatMap((entry, i) => entry.signals?.includes(signal) && i > 0 ? [{ before: entries[i - 1], after: entry }] : [])
  const corrected = blamed('corrects-previous')
  if (corrected.length) add(`Answers you corrected (${corrected.length})`, corrected.slice(-3).map(c => `you asked "${clip(c.before.request, 80)}", I said "${clip(c.before.reply, 80)}", you replied "${clip(c.after.request, 80)}"`),
    'Check each against the facts; if it is a pattern, add a verified fact (safety-facts style), a persona rule or a skill, then re-run the self-test.')
  const repeated = blamed('repeats-previous')
  if (repeated.length) add(`Questions you had to ask again (${repeated.length})`, repeated.slice(-3).map(c => `"${clip(c.after.request, 100)}"`),
    'Find why the first answer missed (wrong tool, too vague, misunderstood) and fix that route.')
  const failed = entries.filter(entry => entry.outcome === 'failed')
  if (failed.length) add(`Replies that failed (${failed.length})`, failed.slice(-3).map(entry => `${entry.kind}: "${clip(entry.request, 80)}" → "${clip(entry.reply, 80)}"`),
    'Reproduce one, read the app log for that time, and fix the failing tool or integration.')
  const slow = entries.filter(entry => entry.signals?.includes('slow'))
  if (slow.length) {
    const models = [...new Set(slow.map(entry => entry.model).filter(Boolean))]
    add(`Slow replies over a minute (${slow.length})`, slow.slice(-3).map(entry => `${entry.seconds}s for "${clip(entry.request, 70)}"${entry.model ? ` on ${entry.model}` : ''}`),
      models.length && models.every(model => model !== 'qwen3.6-35b') ? 'They ran on a fallback model: check what held RAM/VRAM at the time.' : 'Check whether these were tool or research turns that waited on something outside the model.')
  }
  const empty = entries.filter(entry => entry.signals?.includes('empty'))
  if (empty.length) add(`Empty replies (${empty.length})`, empty.slice(-3).map(entry => `"${clip(entry.request, 90)}"`), 'Look for a model that spent its whole token budget thinking, or a crashed turn.')
  if (wishes.length) add(`Wishlist: things I could not do (${wishes.length})`, wishes.slice(0, 3).map(wish => `"${clip(wish.request, 90)}"${wish.count > 1 ? ` x${wish.count}` : ''}`),
    'Decide which is worth a skill or tool; each one is a separate change you approve.')
  if (lastTest) {
    const weak = Object.entries(lastTest.byCat).filter(([, v]) => v.pass / v.total < 0.8).map(([k, v]) => `${k} ${v.pass}/${v.total}`)
    if (weak.length) add('Weak self-test categories', [`${lastTest.release} on ${lastTest.models.join(' + ')}: ${weak.join(', ')}`], 'Target these with verified facts, routing or a better model, then re-test.')
    const previous = tests.filter(run => run.full === lastTest.full && run.suite === lastTest.suite).at(-2)
    if (previous && lastTest.pass / lastTest.total < previous.pass / previous.total - 0.08)
      add('Self-test score dropped', [`${previous.pass}/${previous.total} (${previous.release}) → ${lastTest.pass}/${lastTest.total} (${lastTest.release})`], 'Compare what changed between those releases or models; roll back if it is the update.')
  }
  const health = recentProblems(dataRoot, now.getTime()).filter(problem => /lock/.test(problem))
  if (health.length) add('Startup reliability', health, 'Abrupt shutdowns leave startup locks; have the app recover a dead lock itself on start (owner-approved code fix).')

  const header = `# Nori improvement proposals — ${now.toISOString().slice(0, 10)}\n\nFrom her own records for the last ${days} days. Proposals only: nothing changes until the owner approves a fix and it goes through the normal reviewed install.\n`
  const body = proposals.map((p, i) => `\n## ${i + 1}. ${p.title}\n${p.evidence.map(e => `- ${e}`).join('\n')}\n- **Proposed step:** ${p.step}\n`).join('')
  try {
    mkdirSync(path.join(dataRoot, 'learning'), { recursive: true })
    const file = path.join(dataRoot, 'learning', 'improvement-proposals.md')
    writeFileSync(`${file}.tmp`, header + (body || '\nNo problems found in my records.\n'), 'utf8'); renameSync(`${file}.tmp`, file)
  } catch {}

  const out = [`**My self-review** (last ${days} days, from my own records): ${entries.length} replies, ${tests.length ? `last self-test ${lastTest.pass}/${lastTest.total} on ${lastTest.at.slice(0, 10)}` : 'no self-test yet (say "run a self-test")'}.`]
  if (!proposals.length) out.push('', 'I found nothing to fix in my records. That does not prove I made no mistakes: my journal only sees corrections, repeats, failures, empty and slow replies.')
  proposals.forEach((p, i) => out.push('', `**${i + 1}. ${p.title}**`, ...p.evidence.map(e => `- ${e}`), `- Proposed step: ${p.step}`))
  out.push('', 'Saved as improvement-proposals.md in my learning folder. These are proposals only: I do not change or install my own code; each fix needs your OK.')
  return out.join('\n')
}
