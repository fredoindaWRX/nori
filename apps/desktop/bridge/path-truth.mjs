import { existsSync } from 'node:fs'

/**
 * Deterministic check on local file paths a reply names. A model can repeat an
 * earlier invented path from conversation history, so the host verifies the
 * filesystem instead of trusting the wording. node:fs keeps paths inside
 * Nori's own .asar resolvable under Electron.
 */
const LOCAL_FILE_PATH = /\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n`]+\\)*[^\\/:*?"<>|\s`]+\.[A-Za-z0-9]{1,8}\b/g
const MAX_CHECKED_PATHS = 12
// Wording that presents a file as made, saved or ready, rather than proposed.
const CREATION_CLAIM = /\b(?:built|generated|created|saved|wrote|written|compiled|installed|ready to (?:run|launch|open)|lives at|launch it|click (?:that|the) link)\b/i
// Model text that imitates the host's own correction lines.
const IMITATED_CHECK = /\(?Nori[’']s file check:[^)\n]*\)?(?:\s*That earlier claim was wrong; do not repeat it\.)?/g
const REMOVED_TURN = '[Earlier Nori reply removed by her file check:'
// Wording that presents a file as opened or examined.
const READ_CLAIM = /\b(?:inspected|opened|read|checked|examined|looked (?:at|through)|pried open|scanned)\b/i

// Device claims. Nori's real device results (TV, lights, apps) come from host
// code that answers before any model runs, so they never reach this check. The
// caller says whether the model had a device-capable tool for this reply; only
// when it had none can the host state that the reply sent no device command.
const DEVICE = String.raw`\b(?:tv|television|volume|speakers?|lights?|lamps?|bulbs?|thermostat|vacuum|remote)\b`
const SENT = String.raw`\bi(?:'ve|’ve| have)?\s+(?:just\s+|already\s+)?(?:sent|fired|pushed|issued|triggered|reset|muted|unmuted|cranked|dimmed|bumped|raised|lowered)\b`
const WILL = String.raw`\bi(?:'ll|’ll| will|'m going to|’m going to| am going to)\s+(?:send|fire|push|issue|trigger|reset|mute|unmute|crank|dim|bump|raise|lower)\b`
const TURNED = String.raw`\bi(?:'ve|’ve| have|'ll|’ll| will)?\s+(?:just\s+)?(?:turned|switched|turn|switch)\s+(?:(?:the|your|my)\s+[\w ]{0,30}?\s+)?(?:on|off|up|down)\b`
const PENDING = String.raw`\bwaiting (?:for|on) (?:the |your )?(?:tv|television|speakers?|lights?|hue bridge)\b[^.!?\n]{0,30}\b(?:acknowledg\w*|respond\w*|confirm\w*)`
const TURNED_DEVICE = String.raw`\bi(?:'ve|’ve| have)?\s+(?:just\s+)?(?:turned|switched)\s+(?:the|your|my)\s+[\w ]{0,30}?${DEVICE}\s+(?:on|off|up|down)\b`
const DEVICE_CLAIM = new RegExp(`(?:${SENT}|${WILL})[^.!?\n]{0,90}${DEVICE}|${DEVICE}[^.!?\n]{0,40}(?:${TURNED})|(?:${TURNED})[^.!?\n]{0,60}${DEVICE}|${TURNED_DEVICE}|${PENDING}`, 'i')
const NEGATION = /\b(?:not|never|no|cannot|can't|can’t|didn't|didn’t|won't|won’t|don't|don’t|haven't|haven’t|unless|if)\b/i
const QUOTED = /"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g
const DEVICE_NOTE = '(Nori\'s device check: this reply had no TV, light or speaker control available, so it did not send any device command. For a real change, use a direct command such as "turn the TV volume up 5" or "turn off the kitchen lights".)'
// Home-tool turns offer device tools, so "no control available" would be false there.
export const DEVICE_NOT_SENT_NOTE = '(Nori\'s device check: no device command was sent in this turn, so nothing changed. For a real change, use a direct command such as "turn off the kitchen lights".)'

/** True when some sentence, outside quotes and without negation before the claim, claims a device action. */
// File work the reply describes as done or about to happen. Only checked when the
// caller reports that no tool ran during the reply.
const RELATIVE_FILE = /\b[\w.-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx|json|md|txt|css|html|toml|ya?ml|c|cpp|h|rs|go|java|cs|ps1)\b/i
const FILE_DONE_CLAIM = /\bI(?:['’]ve| have)?\s+(?:just\s+|already\s+)?(?:read|opened|inspected|checked|examined|looked (?:at|through)|scanned|edited|changed|updated|modified|fixed|patched|tweaked|rewrote|ran)\b/i
const FILE_PROMISE = /\b(?:I['’]m (?:about|going) to|I am (?:about|going) to|I['’]ll(?: now)?|I will(?: now)?|let me)\b[^.!?\n]{0,80}\b(?:edit|change|update|modify|fix|patch|tweak|rewrite|run|apply)\b/i
const FILE_WORK_NOTE = '(Nori\'s file check: no file was opened, edited or sent to the coder during this reply, so any statement above about reading or changing a file did not happen. For real coding, choose the project and allow coding in the Coding work panel.)'

// A real System submission ends the turn with the host's own "I prepared System task" receipt,
// so model text claiming it queued or submitted a command never describes a real submission.
const QUEUED_CLAIM = /\bI(?:['’]ve| have)?\s+(?:just\s+|already\s+)?(?:queued|submitted|scheduled)\b|\bqueued\s+up\b/i
const QUEUED_NOTE = '(Nori\'s task check: no System task was submitted in this reply, so nothing was queued or scheduled. A real submission shows its task ID for you to review.)'
export function claimsUnbackedQueue(text) { return QUEUED_CLAIM.test(String(text ?? '')) }

export function claimsUnbackedFileWork(text) {
  return String(text ?? '').split(/(?<=[.!?])\s+|\n+/)
    .some(sentence => RELATIVE_FILE.test(sentence) && (FILE_DONE_CLAIM.test(sentence) || FILE_PROMISE.test(sentence)))
}

export function claimsDeviceAction(text) {
  return String(text ?? '').replace(QUOTED, ' ').split(/(?<=[.!?])\s+|\n+/).some(sentence => {
    const found = DEVICE_CLAIM.exec(sentence)
    return found !== null && !NEGATION.test(sentence.slice(0, found.index + found[0].length))
  })
}

export function missingLocalPaths(text) {
  const found = [...new Set(String(text ?? '').match(LOCAL_FILE_PATH) ?? [])].slice(0, MAX_CHECKED_PATHS)
  return found.filter(candidate => { try { return !existsSync(candidate) } catch { return false } })
}

function quoted(missing) {
  return missing.map(item => '`' + item + '`').join(', ')
}

function missingNote(missing) {
  return `(Nori's file check: ${quoted(missing)} ${missing.length > 1 ? 'do' : 'does'} not exist on this PC.)`
}

/** Replaces earlier assistant turns that cite missing files, so the model has nothing false to copy. */
export function annotateMissingPathTurns(turns) {
  if (!Array.isArray(turns)) return turns
  return turns.map(turn => {
    if (!turn || turn.role === 'user' || typeof turn.text !== 'string' || turn.text.startsWith(REMOVED_TURN)) return turn
    const missing = missingLocalPaths(turn.text)
    if (!missing.length) return turn
    if (!CREATION_CLAIM.test(turn.text)) return turn.text.includes("Nori's file check:") ? turn : { ...turn, text: `${turn.text}\n\n${missingNote(missing)}` }
    return { ...turn, text: `${REMOVED_TURN} it named ${quoted(missing)}, which ${missing.length > 1 ? 'do' : 'does'} not exist on this PC. Nothing was built or saved there.]` }
  })
}

/**
 * Checks a complete reply. A reply that presents a missing file as made is
 * replaced with an honest one; other missing paths get a correction note.
 */
export function appendPathTruth(text) {
  const clean = String(text ?? '').replace(IMITATED_CHECK, '').trimEnd()
  const missing = missingLocalPaths(clean)
  if (!missing.length) return clean
  if (CREATION_CLAIM.test(clean)) {
    const app = missing.some(item => /\.exe$/i.test(item))
      ? ' I can save a reviewable design for an app instead: ask me to "make an app called …" and it will appear under SPACE → APPS.' : ''
    return `I can't stand behind the reply I was about to give: it said ${quoted(missing)} ${missing.length > 1 ? 'were' : 'was'} made, but ${missing.length > 1 ? 'they do' : 'it does'} not exist on this PC, so nothing was built or saved.${app}`
  }
  return `${clean}\n\n${missingNote(missing)}`
}

/**
 * Streams a reply unchanged, then appends corrections: one for any named file
 * that does not exist, and, when the caller confirms the model had no
 * device-capable tool, one for a claimed device action. Corrections follow the
 * reply; they disclose, they do not prevent. deviceToolsAvailable may be a
 * function evaluated after the stream, so a home turn counts only device
 * commands that were actually dispatched.
 */
export async function* withPathTruth(stream, { deviceToolsAvailable = true, homeTurn = false, fileToolsUsed = null } = {}) {
  let text = ''
  for await (const chunk of stream) {
    if (typeof chunk === 'string') text += chunk
    else if (typeof chunk?.text === 'string') text += chunk.text
    yield chunk
  }
  const missing = missingLocalPaths(text)
  if (missing.length) {
    // Judge the claim by the lines that name a missing path, not by the whole reply.
    const near = text.split('\n').filter(line => missing.some(item => line.includes(item))).join('\n')
    const claim = CREATION_CLAIM.test(near) ? ' Nothing was built or saved there; disregard that claim.'
      : READ_CLAIM.test(near) ? ' It could not have been opened or read; disregard that claim.' : ''
    yield `\n\n${missingNote(missing)}${claim}`
  }
  const devices = typeof deviceToolsAvailable === 'function' ? Boolean(deviceToolsAvailable()) : deviceToolsAvailable
  if (devices === false && claimsDeviceAction(text)) yield `\n\n${homeTurn ? DEVICE_NOT_SENT_NOTE : DEVICE_NOTE}`
  if (typeof fileToolsUsed === 'function' && !fileToolsUsed() && claimsUnbackedFileWork(text)) yield `\n\n${FILE_WORK_NOTE}`
  if (!/I prepared System task [a-f0-9]{32}/.test(text) && claimsUnbackedQueue(text)) yield `\n\n${QUEUED_NOTE}`
}
