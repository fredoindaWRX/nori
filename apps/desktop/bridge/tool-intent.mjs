import { localEndpoint, localFetch } from './local-policy.mjs'
import { NORI_TEXT_ENDPOINT } from './local-endpoint.mjs'

// Let Nori's own model pick a capability for a plain-language request that no
// explicit phrase route matched. The choice only selects which existing tool
// flow is offered; every flow keeps its own approval and safety checks.
// answer_directly returns null (a tool-less reply). A chooser timeout or
// malformed answer returns 'base' so the turn still gets the read-only base
// tools instead of silently losing every capability. So does an answer cut
// off at the token limit (finish=length): a truncated label is not a choice.
const CHOICES = Object.freeze({ web_search: 'research', control_browser: 'browser',
  generate_image: 'image', check_pc: 'pcinfo', my_files: 'files', create_document: 'documents', run_program: 'system', about_nori: 'self',
  multi_step: 'agent', project_files: 'project' })
// A bounded reason plus CHOOSER_MAX_TOKENS keeps the answer from ending mid-call.
export const CHOOSER_MAX_TOKENS = 192
const fn = (name, description) => ({ type: 'function', function: { name, description,
  parameters: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string', maxLength: 80, description: 'A few words.' } }, required: ['reason'] } } })
const TOOLS = [
  fn('answer_directly', 'Reply in conversation with no tool: greetings, feelings, opinions, advice, writing, maths, coding help, and general explanations of how things work.'),
  fn('web_search', 'Look up information on the public web: news, weather, scores, prices, recent events, and details about a specific named film, show, book, game, song, person, company, product, place or historical event (plots, casts, dates, records, specs).'),
  fn('control_browser', 'Operate a website for the user: open a site, navigate, fill in or click things, shop, compare listings.'),
  fn('generate_image', 'Create a new picture, drawing, photo or artwork from a description.'),
  fn('check_pc', 'Look up this PC\'s current status: disk space, memory use, open programs, battery, network connection, graphics card.'),
  fn('my_files', 'Find, list or read the user\'s own files and folders: Desktop, Documents, Downloads, Pictures, Music, Videos.'),
  fn('create_document', 'Make and save a new file for the user: a Word document, PDF, Excel spreadsheet, CSV, Markdown or text file (letters, reports, resumes, budgets, lists, tables).'),
  fn('about_nori', 'Questions about Nori herself: what she is, her brain or model, her abilities and limits, her memory, how she works or learns, whether she feels or is self-aware.'),
  fn('run_program', 'Run a program or command, or change a setting or install something on the PC.'),
  fn('multi_step', 'A task needing several steps or tools together: find or look something up, then make, save, compare or summarize it (for example find my notes and turn them into a document).'),
  fn('project_files', 'Look through Nori\'s own project folder: her source code, skills or docs.'),
]
const SYSTEM = 'You route requests for Nori, a local desktop assistant. Call exactly one function. '
  + 'Choose answer_directly unless the latest user request clearly needs live web information, operating a website, a new image, '
  + 'checking the PC, the user\'s own files, saving a new document file, running a program, Nori\'s own project files, or several of these steps together. Writing text in the chat itself is answer_directly. '
  + 'Route only the latest request. When it refers back to something an earlier reply found with a tool ("the second one", "that file", "more detail"), it needs that same kind of tool again.'
const clipped = (value, limit) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > limit ? `${text.slice(0, limit)}…` : text }
const textOf = turn => String(turn.text ?? turn.content)
const isText = turn => turn && (typeof turn.text === 'string' || typeof turn.content === 'string')

/** The latest prior exchange, bounded, so the chooser can route a follow-up ("the second one"). */
export function chooserContext(turns) {
  const list = (Array.isArray(turns) ? turns : []).filter(isText)
  const at = list.findLastIndex(turn => turn.role !== 'user')
  if (at < 0) return ''
  const asked = list.slice(0, at).findLast(turn => turn.role === 'user')
  return `${asked ? `User: ${clipped(textOf(asked), 300)}\n` : ''}Nori: ${clipped(textOf(list[at]), 700)}`
}

// A short follow-up that points back at items of the previous reply.
const REFERENCE = /\b(?:the\s+(?:first|second|third|fourth|fifth|last|latest|newest|biggest|largest|other|next|previous)\s+(?:one|file|folder|item|result|link|page)s?|th(?:at|is|ose|ese)\s+(?:one|file|folder|zip|document|item|result|link|page)s?|(?:more|further)\s+(?:detail|details|info|information)|(?:open|read|check|show)\s+(?:it|that|them)|what(?:'s|\s+is)\s+in\s+(?:it|that|there))\b/i
// File names, personal folders or URLs in the previous reply suggest it came from a read-only tool.
const FOUND_ITEMS = /\b[\w()[\]-]+\.[a-z][a-z0-9]{1,4}\b|\b(?:Desktop|Documents|Downloads|Pictures|Music|Videos)\b|https?:\/\//i

/** True for a short follow-up about items a previous reply listed; such a turn gets the read-only base tools. */
export function referentialFollowUp(text, turns) {
  const value = String(text ?? '').trim()
  if (!value || value.length > 240 || !REFERENCE.test(value)) return false
  const reply = (Array.isArray(turns) ? turns : []).filter(isText).findLast(turn => turn.role !== 'user')
  return Boolean(reply) && FOUND_ITEMS.test(textOf(reply).slice(0, 8000))
}

/**
 * "Which skill would help me reverse engineer X?" asks Nori to choose among her
 * skills; it is not a request to run REA now or to print the bare catalog.
 */
// Skill/capability nouns, and a question that ties one of them to a task.
const SKILL_NOUN = String.raw`(?:skills?|tools?|abilit(?:y|ies)|capabilit(?:y|ies))`
const SKILL_FIT = [
  new RegExp(String.raw`\b(?:which|what)\s+(?:(?:of\s+)?(?:your|my|nori['’]?s)\s+)?(?:one|ones|${SKILL_NOUN})\b[^.?!\n]{0,60}?\b(?:(?:would|could|can|should|might|will|best|do\s+(?:i|you))\b[^.?!\n]{0,24}?\b(?:help|work|suit|fit|handle|do|use|need)|fits|suits|helps|works|for(?!\s+(?:me|us)\b)|to\s+(?:use|help|handle))\b`, 'i'),
  new RegExp(String.raw`\b(?:do\s+you\s+have|is\s+there|are\s+there|have\s+you\s+got)\s+(?:a|an|any|the)\s+(?:\w+\s+)?${SKILL_NOUN}\s+(?:for|to|that|which)\b`, 'i'),
  new RegExp(String.raw`\b(?:can|could|would|will)\s+(?:any\s+(?:of\s+)?)?(?:your|nori['’]?s)\s+(?:\w+\s+)?${SKILL_NOUN}\s+(?:help|handle|do|work)\b`, 'i'),
  new RegExp(String.raw`\b(?:what\s+(?:are|is)|tell\s+me\s+about)\s+(?:your|nori['’]?s)\s+(?:best\s+)?${SKILL_NOUN}\s+(?:for|to)\b`, 'i'),
]
export function skillFitQuestion(text) {
  const value = String(text ?? '')
  return value.length <= 4000 && SKILL_FIT.some(pattern => pattern.test(value))
}

/**
 * True when a request's only project-reader cue is a plain file/folder word
 * ("find the tax file in Downloads"): that is the owner's own files, not
 * Nori's project folder, so it belongs to the chooser and the union catalog.
 */
export function personalFileMention(text) {
  const value = String(text ?? '')
  return /\b(?:file|folder|directory)\b/i.test(value)
    && !/\b(?:read[_ ]file|list[_ ]dir|repo(?:sitory)?|codebase|source|code|project|roadmap|journal|skills?|capabilities|abilities)\b/i.test(value)
    && !/\b(?:your|nori['’]?s?)\s+(?:own\s+)?(?:files?|folders?|director(?:y|ies))\b/i.test(value)
}

export async function chooseToolIntent(request, { signal, fetcher = localFetch, environment = process.env, timeoutMs = 8000, context = '' } = {}) {
  const text = String(request ?? '').trim()
  if (!text || environment.NORI_GPT_OSS_ENABLED !== '1') return null
  if (text.length > 4000) return 'base'
  try {
    const endpoint = localEndpoint('NORI_GPT_OSS_URL', environment.NORI_GPT_OSS_URL, NORI_TEXT_ENDPOINT)
    const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    const response = await fetcher(`${endpoint}/v1/chat/completions`, { method: 'POST', redirect: 'error', signal: bounded,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: environment.NORI_GPT_OSS_SERVER_MODEL || 'nori-auto', stream: false, max_tokens: CHOOSER_MAX_TOKENS,
        temperature: 0, tools: TOOLS, tool_choice: 'required', chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: context
          ? `[Earlier conversation, for reference only]\n${clipped(context, 1200)}\n\n[Latest request to route]\n${text}` : text }] }) })
    if (!response.ok) return 'base'
    const choice = (await response.json())?.choices?.[0]
    const calls = choice?.message?.tool_calls
    if (choice?.finish_reason === 'length' || !Array.isArray(calls) || calls.length !== 1) return 'base'
    const name = calls[0]?.function?.name
    // Arguments that do not parse were cut off mid-call even without finish=length.
    const args = calls[0]?.function?.arguments
    if (typeof args === 'string' && args.trim()) { try { JSON.parse(args) } catch { return 'base' } }
    if (name === 'answer_directly') return null
    return Object.hasOwn(CHOICES, name) ? CHOICES[name] : 'base'
  } catch {
    // A Stop is not a chooser failure; the caller sees the abort itself.
    return signal?.aborted ? null : 'base'
  }
}
