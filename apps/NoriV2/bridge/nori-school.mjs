/**
 * Nori School lane adapter — the desktop's read-only driver for the canonical
 * learning and self-improvement systems that already live under C:\Nori.
 *
 * Nothing here invents a pipeline. The GitHub Learning Policy and the Evolution
 * Policy define the lanes; the Council's durable work queue executes them. This
 * module only (a) frames owner requests with the policy contracts so a queued
 * goal cannot drift into unreviewed live-code changes, and (b) reports the real
 * ledger state so N.O.R.I.'s self-description stays grounded in evidence files
 * instead of recollection.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Canonical root. NORI_ROOT keeps parity with the rest of the bridge. */
export const noriRoot = () => process.env.NORI_ROOT ?? resolve(HERE, '..', '..', '..')

/** The canonical files, per SCHOOL_AUTONOMY_POLICY.md. */
export const paths = (root = noriRoot()) => ({
  learningPolicy: join(root, 'school', 'github-learning', 'GITHUB_LEARNING_POLICY.md'),
  evolutionPolicy: join(root, 'school', 'evolution', 'NORI_EVOLUTION_POLICY.md'),
  ledger: join(root, 'school', 'NORI_SCHOOL_UPDATES.txt'),
  notes: join(root, 'school', 'github-learning'),
  learningReports: join(root, 'runtime-data', 'learning'),
  evolutionReports: join(root, 'runtime-data', 'evolution'),
})

const LEDGER_TAIL_CHARS = 1400
/** A runaway ledger is not evidence; it is a read risk. */
const LEDGER_READ_CAP_BYTES = 512 * 1024
const RECENT_FILES = 3

/** Bounded so a chat turn can never drown in its own self-report. */
export const MAX_EVIDENCE_CHARS = 2600

function tailText(file, maxChars, capBytes) {
  try {
    const info = statSync(file)
    if (!info.isFile() || info.size > capBytes) return null
    const text = readFileSync(file, 'utf8')
    return text.length > maxChars ? text.slice(-maxChars) : text
  } catch { return null }
}

function recentFiles(dir, count) {
  try {
    const files = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const full = join(dir, entry.name)
      try {
        const info = statSync(full)
        files.push({ name: entry.name, size: info.size, at: info.mtimeMs })
      } catch { /* raced away; not evidence */ }
    }
    return files.sort((a, b) => b.at - a.at).slice(0, count)
  } catch { return null }
}

const describe = (files) => (files && files.length
  ? files.map((f) => `${f.name} (${f.size} B, ${new Date(f.at).toISOString().slice(0, 10)})`).join('; ')
  : '(none yet)')

const DEFAULT_GOALS = {
  learn: 'Choose the next highest-value GitHub learning target for Nori and pursue it.',
  improve: 'Choose the next highest-value improvement to your own shell and prepare it in an isolated chamber.',
}

/**
 * Parse an explicit lane command. `*work` is unchanged in the query adapter;
 * these two ride the same durable queue, but the goal carries the contract of
 * the lane the owner actually asked for.
 */
export function command(text) {
  const match = /^\*(learn|improve)\b[ \t]*([\s\S]*)$/i.exec(String(text ?? '').trim())
  if (!match) return null
  const kind = match[1].toLowerCase()
  const goal = match[2].trim()
  return { kind, goal: goal || DEFAULT_GOALS[kind] }
}

/** GitHub learning: research, notes and recommendations only — the policy's
 *  blocked list (installs, binaries, licensed copies, live-code edits) is
 *  quoted into the goal so the queue's workers see the same contract. */
export function learningBrief(goal) {
  const p = paths()
  return [
    'Nori School GitHub learning task.',
    `Owner request (NoriV2): ${goal}`,
    '',
    `Follow the canonical GitHub Learning Policy at ${p.learningPolicy}:`,
    '- research only: search repos, read docs and source, clone read-only into a research folder, extract design patterns; never train model weights locally.',
    '- never run unknown install scripts or downloaded binaries, never copy licensed code into product source, and never modify live Nori code from unreviewed GitHub material.',
    `- write learning notes under ${p.notes} and the run report under ${p.learningReports}.`,
    '- promotion path: research -> notes -> small prototype -> test -> review -> Nori Lead approval -> implementation.',
    '- finish with GITHUB_LEARNING_READY, or GITHUB_LEARNING_BLOCKED with evidence.',
  ].join('\n')
}

/** Self-evolution: chambered mutation only, with the promotion rule stated. */
export function evolutionBrief(goal) {
  const p = paths()
  return [
    'Nori self-evolution task.',
    `Owner request (NoriV2): ${goal}`,
    '',
    `Follow the canonical Evolution Policy at ${p.evolutionPolicy}:`,
    '- cycle: observe -> study -> mutate -> test -> compare -> review -> promote -> remember.',
    '- mutate only inside an isolated evolution worktree/chamber; never edit the live C:\\Nori tree.',
    '- no unknown install scripts or binaries, no licensed code copied into product, no new startup services or network listeners, no replacement without rollback.',
    '- every mutation reports its reason, changed files, tests/checks and rollback instructions; when tests fail, keep evidence and do not promote.',
    '- finish with EVOLUTION_MUTATION_READY, or EVOLUTION_BLOCKED with evidence. The owner promotes reviewed mutations.',
  ].join('\n')
}

/** True when the turn is a question about Nori's own learning or evolution. */
const SELF_QUERY = /\b(what (?:have|did) you learn(?:ed)?|learn(?:ed|ing) lately|nori school|your school|your learning|self[- ](?:improvement|development)|improve yourself|evolve yourself|your (?:own )?(?:code|codebase|source code|evolution))\b/i
export const selfQuery = (text) => SELF_QUERY.test(String(text ?? ''))

/**
 * A read-only snapshot of the canonical evidence: ledger tail plus the most
 * recent notes and run reports. Reads only; it may never create or repair a
 * file, because its output is quoted to the model as fact.
 */
export function schoolStatus({ root = noriRoot() } = {}) {
  const p = paths(root)
  const lines = ['[Nori School — canonical files, read-only snapshot]']
  const ledger = tailText(p.ledger, LEDGER_TAIL_CHARS, LEDGER_READ_CAP_BYTES)
  lines.push(ledger
    ? `Ledger tail (${p.ledger}):\n${ledger.trim()}`
    : `Ledger (${p.ledger}): (unavailable)`)
  lines.push(`GitHub learning notes (${p.notes}): ${describe(recentFiles(p.notes, RECENT_FILES))}`)
  lines.push(`Learning reports (${p.learningReports}): ${describe(recentFiles(p.learningReports, RECENT_FILES))}`)
  lines.push(`Evolution reports (${p.evolutionReports}): ${describe(recentFiles(p.evolutionReports, RECENT_FILES))}`)
  lines.push('These files are the source of truth; do not state more than they show.')
  const text = lines.join('\n')
  return text.length > MAX_EVIDENCE_CHARS ? `${text.slice(0, MAX_EVIDENCE_CHARS)}\n…(truncated)` : text
}
