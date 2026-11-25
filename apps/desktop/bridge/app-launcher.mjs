import { execFile } from 'node:child_process'

// Text selects a verified current Start-menu entry, never an executable/URL or
// shell command. Windows receives exactly one AppsFolder activation argument.
const LIST_APPS = "$ErrorActionPreference = 'Stop'; Get-StartApps -ErrorAction Stop | Select-Object Name, AppID | ConvertTo-Json -Compress"
const NORI_PANELS = /^(?:the\s+)?(?:space|workspace|settings|memory|my memory|camera|screen|vision|brain(?:\s+view)?|nori|apps?|outputs?)\b/i
const NOT_APPS = /\b(?:uninstall|help|manual|readme|documentation|website|release notes|license)\b/i
const LEAD = String.raw`^\s*(?:(?:hey\s+)?nori[,:\s]+)?(?:please\s+|can\s+you\s+|could\s+you\s+)?`
const OPEN = new RegExp(`${LEAD}(?:open|launch|start|run|fire\\s+up|bring\\s+up)\\s+(?:up\\s+)?(?:the\\s+|my\\s+)?(.+?)(?:\\s+(?:app|application|program))?(?:\\s+(?:for\\s+me|please|now))?\\s*[.!?]*$`, 'i')
const HAVE = new RegExp(`${LEAD}(?:do\\s+i\\s+have|is)\\s+(?:the\\s+)?(.+?)\\s+(?:installed|on\\s+(?:my|this)\\s+(?:pc|computer))\\s*[?.!]*$`, 'i')

function active(signal) { if (signal?.aborted) throw signal.reason || new Error('App request cancelled') }
function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_{][A-Za-z0-9._{}!\\ -]{0,255}$/.test(id)
    && !id.includes('..') && !/^[\\/]/.test(id)
}
function catalog(rows) {
  if (!Array.isArray(rows) || rows.length > 4000) throw new Error('Windows app catalog was invalid or too large')
  const seen = new Set(), result = []
  for (const row of rows) {
    if (typeof row?.name !== 'string' || !row.name.trim() || row.name.length > 200 || /[\x00-\x1f\x7f]/.test(row.name) || !validId(row.id)) continue
    if (!seen.has(row.id)) { seen.add(row.id); result.push({ name: row.name.trim(), id: row.id }) }
  }
  return result
}

// Only a fully recognized read-only qualifier may extend an installed-entry
// question. Unknown tails and activation requests never receive this treatment.
function readOnlyLookupHead(text) {
  const noLaunch = String.raw`without\s+(?:launching|opening|starting|running)\s+(?:anything|any\s+apps?)`
  const catalog = String.raw`(?:please\s+)?check\s+(?:your|the|my)\s+(?:local\s+)?(?:Windows\s+)?app\s+catalog`
  const noLaunchSentence = String.raw`(?:do\s+not|don't|never)\s+(?:launch|open|start|run)\s+(?:anything|any\s+apps?)`
  const qualifier = new RegExp('^(.+?)(?:[?!.]\\s+|,\\s+|\\s+)(?:' + catalog + '\\s+' + noLaunch + '|' + noLaunch + '|' + catalog + '[.!]\\s+' + noLaunchSentence + ')[.!?]*$', 'i')
  const match = String(text).match(qualifier)
  const head = match?.[1].trim()
  // Reject internal sentences/activation clauses, but retain dotted app names.
  return head && !/[?!]|[.!]\s|\b(?:and|then)\s+(?:open|launch|start|run)\b/i.test(head) && HAVE.test(head) ? head : null
}

export function targetOf(text) {
  const raw = String(text ?? '').trim()
  if (raw.length > 300 || /[\r\n]/.test(raw)) return null
  const value = readOnlyLookupHead(raw) || raw
  if (/^(?:open\s+source|run\s+me\s+through|bring\s+up\s+(?:the\s+)?(?:idea|topic|discussion))\b/i.test(value)) return null
  if (!value || value.length > 300 || /\b(?:don't|do not|never|stop)\b|["`\r\n<>|;&]|(?:[a-z][a-z0-9+.-]*:\/\/)|\b(?:file|shell|javascript|data|ms-settings|steam):|[a-z]:[\\/]|[\\/]|\b(?:on|to)\s+(?:the\s+)?(?:TV|television)\b/i.test(value)) return null
  const have = value.match(HAVE), open = value.match(OPEN)
  const target = (have?.[1] || open?.[1] || '').trim().replace(/(?:\s+(?:for\s+(?:me|us)|please|now|real\s+quick|thanks))+$/i, '')
  if (!target || target.length > 60 || NORI_PANELS.test(target) || /\b(?:file|folder|document|photo|picture|link|tab|door|window|hue|lights?)\b/i.test(target)) return null
  return { kind: have ? 'have' : 'open', target }
}
export function requestsAppLaunch(text) { return targetOf(text) !== null }
const words = value => String(value).toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim()
const display = value => String(value).replace(/[\\`*_{}[\]()<>]/g, '\\$&')

export function matchApps(apps, wanted) {
  const query = words(wanted)
  if (!query) return []
  const parts = query.split(' ')
  return catalog(apps).filter(app => !NOT_APPS.test(app.name))
    .map(app => {
      const name = words(app.name)
      return { app, score: name === query ? 4 : name.startsWith(query + ' ') ? 3
        : parts.every(part => (' ' + name + ' ').includes(' ' + part + ' ')) ? 2 : 0, length: name.length }
    }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.length - b.length)
}

function runPowerShell(script, { signal } = {}) {
  active(signal)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); error ? reject(error) : resolve(value) }
    const onAbort = () => finish(signal.reason || new Error('App request cancelled'))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    try {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 20000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, signal },
        (error, stdout, stderr) => {
          if (signal?.aborted) { onAbort(); return }
          if (error || String(stderr || '').trim()) { finish(new Error('Windows did not return a verified app catalog')); return }
          finish(null, String(stdout || '').trim())
        })
    } catch { finish(new Error('Windows app catalog query could not start')) }
  })
}
export async function listInstalledApps({ run = runPowerShell, signal } = {}) {
  active(signal)
  const text = await run(LIST_APPS, { signal })
  active(signal)
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 4 * 1024 * 1024) throw new Error('Windows app catalog was invalid or too large')
  const parsed = JSON.parse(text || '[]')
  return catalog((Array.isArray(parsed) ? parsed : [parsed]).map(row => ({ name: row?.Name, id: row?.AppID })))
}

function launch(appId, { signal } = {}) {
  active(signal)
  if (!validId(appId)) throw new Error('App activation ID was not verified')
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); error ? reject(error) : resolve(value) }
    const onAbort = () => finish(signal.reason || new Error('App request cancelled; activation may already have been requested'))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    try {
      execFile('explorer.exe', ['shell:AppsFolder\\' + appId], { windowsHide: true, timeout: 15000, signal }, error => {
        if (signal?.aborted) { onAbort(); return }
        // Explorer can return 1 after forwarding activation. Neither exit code
        // proves that a target app window opened, so never report it as verified.
        if (error && error.code !== 1) { finish(new Error('Windows activation was not confirmed; check the app before retrying')); return }
        finish(null, { requested: true, verified: false })
      })
    } catch { finish(new Error('Windows activation was not confirmed; check the app before retrying')) }
  })
}
export async function appRequest(text, { list = listInstalledApps, open = launch, signal } = {}) {
  active(signal)
  const request = targetOf(text)
  if (!request) return 'No app request was sent. Name one Start-menu app to open or ask whether its entry exists.'
  const apps = catalog(await list({ signal }))
  active(signal)
  const found = matchApps(apps, request.target)
  if (request.kind === 'have') {
    return found.length ? 'Start-menu entry found: ' + found.slice(0, 3).map(entry => '**' + display(entry.app.name) + '**').join(', ') + '. Launch readiness is not verified.'
      : 'No verified matching Start-menu entry was found for ' + JSON.stringify(request.target) + '.'
  }
  if (!found.length) return 'App launch is not confirmed. No verified matching Start-menu entry was found for ' + JSON.stringify(request.target) + '.'
  const best = found.filter(entry => entry.score === found[0].score)
  if (best.length !== 1 || best[0].score < 3) return 'App launch is not confirmed. Please choose an exact Start-menu app name: ' + best.slice(0, 5).map(entry => '**' + display(entry.app.name) + '**').join(', ') + '.'
  active(signal)
  const result = await open(best[0].app.id, { signal })
  active(signal)
  if (result?.requested !== true || result?.verified !== false) throw new Error('Windows activation was not confirmed; check the app before retrying')
  return 'I sent Windows an activation request for **' + display(best[0].app.name) + '**. The app\'s launch is not confirmed.'
}
