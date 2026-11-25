// Live work steps for Nori's chat (owner, 2026-11-13: "when Nori is working on code she should show it the same way
// you do, in her text area... it should auto-update and not wait for me"). Each tool call she makes is reported twice
// to her own chat window: once when it starts (what she is doing) and once when it ends (worked or failed, plus a
// bounded preview of the result). Display only: a step never grants a tool, changes a decision, or reaches the model.
// Nothing leaves the PC; the frames go only to her local chat window over the bridge socket.
const SECRET = /(?<![A-Za-z0-9])(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{40,}={0,2})(?![A-Za-z0-9])/g
const KEYISH = /\b(api[_-]?key|token|password|secret|authorization|bearer)\b(\s*[:=]\s*|\s+)("?)[^\s",}]+/gi

export function cleanStepText(value, limit) {
  let text = typeof value === 'string' ? value : value === undefined || value === null ? '' : (() => { try { return JSON.stringify(value) } catch { return String(value) } })()
  text = text.replace(KEYISH, '$1$2$3[hidden]').replace(SECRET, '[hidden]').replace(/\u0000/g, '')
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

const VERBS = [
  [/^update_plan$/, 'Plan'],
  [/^code_read$/, 'Reading'], [/^code_list$/, 'Listing'], [/^code_search$/, 'Searching code'],
  [/^code_edit$/, 'Editing'], [/^code_write$/, 'Writing'], [/^code_run$/, 'Running'],
  [/^(read_file|read|open_file|view_file|file_read)/, 'Reading'],
  [/^(list_dir|list_files|ls|glob|find_files)/, 'Listing'],
  [/(grep|search_files|search_code|find_in_files)/, 'Searching code'],
  [/^(write_file|create_file)/, 'Writing'],
  [/^(edit_file|apply_patch|replace_in_file|patch)/, 'Editing'],
  [/^aider_code_task$/, 'Coding with Aider'],
  [/(run_tests|verify|test)/, 'Running tests'],
  [/(submit_system_command|run_command|shell|powershell|bash)/, 'Preparing a command'],
  [/^(web_search|search_web|research_search)/, 'Searching the web'],
  [/^(fetch_url|web_fetch|read_url)/, 'Reading a web page'],
  [/^browser_/, 'Using the browser'],
  [/^check_pc$/, 'Checking the PC'],
  [/^rea_|reverse/, 'Analyzing with REA'],
  [/^artcraft_/, 'Using ArtCraft'],
  [/^home_|hue_|light/, 'Home control'],
  [/memory|remember/, 'Checking memory'],
]

export function stepLabel(name) {
  const tool = String(name || 'tool')
  for (const [pattern, verb] of VERBS) if (pattern.test(tool)) return verb
  return tool.replace(/^mcp__[^_]+__/, '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())
}

/** The one thing worth showing about a call's arguments: a path, query, URL or command, else compact JSON. */
export function stepDetail(args) {
  let value = args
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return cleanStepText(value, 200) } }
  if (!value || typeof value !== 'object') return ''
  for (const key of ['path', 'file', 'file_path', 'query', 'q', 'pattern', 'url', 'command', 'cmd', 'task', 'request', 'goal', 'name'])
    if (typeof value[key] === 'string' && value[key].trim()) return cleanStepText(value[key].trim(), 200)
  return cleanStepText(value, 200)
}

export function startStep({ id, name, args, knight = null }) {
  return { step: { id: cleanStepText(id || '', 80), phase: 'start', tool: cleanStepText(name, 80), label: stepLabel(name),
    detail: stepDetail(args), knight: knight ? cleanStepText(knight, 60) : null, at: Date.now() } }
}

export function endStep({ id, name, ok, result }) {
  const raw = typeof result === 'string' ? result : cleanStepText(result, 4000)
  return { step: { id: cleanStepText(id || '', 80), phase: 'end', tool: cleanStepText(name, 80), ok: ok === true,
    preview: cleanStepText(raw, 1500), at: Date.now() } }
}

/** Calls the display callback and swallows any error: a step can never break the turn. */
export function reportStep(onStep, event) {
  try { if (typeof onStep === 'function') onStep(event) } catch { /* display only */ }
}
