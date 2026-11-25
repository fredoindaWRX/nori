/**
 * Facts the host can answer exactly, before any model call: which model is loaded, which
 * creative apps exist, and what weekday a calendar date falls on. A small model guesses these
 * (or invents a "lookup"); the host reads or computes them.
 */
import { NORI_TEXT_ENDPOINT } from './local-endpoint.mjs'
import { knightsAnswer } from './knights.mjs'

const MODEL_QUESTION = /\b(?:what|which)\s+(?:ai\s+|language\s+|local\s+|llm\s+|text\s+)?(?:model|llm|brain)\b|\bwhat\s+are\s+you\s+running\s+on\b|\bwhat(?:'s| is)\s+your\s+(?:model|llm|brain)\b/i
const CREATIVE_APPS_QUESTION = /^(?:hey\s+nori[,!]?\s*)?(?:which|what)\b[^?]{0,40}\b(?:creative|craft)\b[^?]{0,20}\bapps?\b|\b(?:list|show me)\b[^?]{0,20}\b(?:creative|craft)\s+apps\b/i
const WEEKDAY_QUESTION = /\bwhat\s+day(?:\s+of\s+the\s+week)?\s+(?:was|is|will\s+be|falls\s+on)\s+(.{4,40}?)\s*\??$/i

const MODEL_LABELS = Object.freeze({
  'qwen3.5-9b': 'Huihui Qwen3.5 9B (abliterated)',
  'qwen3.8-27b': 'Qwen3.8 27B',
  'gpt-oss-20b': 'GPT-OSS 20B',
  'qwen3.6-35b': 'Huihui Qwen3.6 35B-A3B (abliterated MoE)',
  'qwen3-14b': 'Huihui Qwen3 14B (abliterated)',
  'qwen3-24b-freedom': 'DavidAU Qwen3 24B-A4B Freedom (abliterated MoE)',
})
// Installed ArtCraft suite (integrations/artcraft/artcraft-apps.json) and what each is for.
const CRAFT_APPS = Object.freeze([
  ['PhotoCraft', 'photo editing'], ['VectorCraft', 'logos, icons, SVG'], ['FilmCraft', 'video editing'],
  ['LightCraft', 'photo lighting and color'], ['PDFCraft', 'PDFs'], ['EffectCraft', 'motion graphics'],
  ['DesignCraft', 'page layout and print'], ['FigCraft', 'UI design and prototypes'], ['WordCraft', 'documents'],
  ['SoundCraft', 'audio and music'], ['DeckCraft', 'slides'], ['CADCraft', 'CAD drawings'], ['GridCraft', 'spreadsheets'],
])
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export function isModelQuestion(text) { return MODEL_QUESTION.test(String(text ?? '')) }

function parseCalendarDate(text) {
  const value = text.trim().replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ')
  let match = value.match(/^([a-z]+) (\d{1,2}) (\d{4})$/i)
  if (match) return [Number(match[3]), MONTHS.indexOf(match[1].toLowerCase()), Number(match[2])]
  match = value.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/i)
  if (match) return [Number(match[3]), MONTHS.indexOf(match[2].toLowerCase()), Number(match[1])]
  match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ?? value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  return match[0].includes('-') ? [Number(match[1]), Number(match[2]) - 1, Number(match[3])] : [Number(match[3]), Number(match[1]) - 1, Number(match[2])]
}

export function weekdayAnswer(text) {
  const question = String(text ?? '').trim().match(WEEKDAY_QUESTION)
  if (!question) return null
  const parts = parseCalendarDate(question[1])
  if (!parts || parts[1] < 0) return null
  const [year, month, day] = parts
  const date = new Date(Date.UTC(year, month, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null
  return `${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)} ${day}, ${year} ${date < Date.now() ? 'was' : 'is'} a ${WEEKDAYS[date.getUTCDay()]}.`
}

export function creativeAppsAnswer(text) {
  if (!CREATIVE_APPS_QUESTION.test(String(text ?? '').trim())) return null
  return `I can open these creative apps: ${CRAFT_APPS.map(([name, use]) => `${name} (${use})`).join(', ')}. Say "open" or "start" plus the name, or just describe what you want to make.`
}

export async function modelAnswer({ endpoint = process.env.NORI_GPT_OSS_URL || NORI_TEXT_ENDPOINT, fetcher = fetch, signal } = {}) {
  try {
    const response = await fetcher(`${endpoint}/v1/models`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) })
    const entry = (await response.json())?.data?.[0]
    const profile = entry?.backend_profile
    if (!profile) return "I'm running on my local model service, but it didn't report which model is loaded right now."
    const label = MODEL_LABELS[profile] ?? profile
    const context = Number.isSafeInteger(entry.context_tokens) ? ` with a ${Math.round(entry.context_tokens / 1024)}K-token context` : ''
    return `Right now I'm running ${label}${context}, locally on your GPU. When RAM or the GPU is busy I drop to the Freedom 24B-A4B, then the 9B, and move back up when memory frees.`
  } catch {
    return null
  }
}

/** Exact host answer for the current request, or null to let the model answer. */
export async function hostFactAnswer(text, options = {}) {
  const fixed = weekdayAnswer(text) ?? creativeAppsAnswer(text) ?? knightsAnswer(text)
  if (fixed) return fixed
  return isModelQuestion(text) ? modelAnswer(options) : null
}
