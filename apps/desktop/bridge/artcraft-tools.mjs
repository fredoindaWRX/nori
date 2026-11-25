import { spawn } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { installationPaths } from './installation-paths.mjs'

const MAX_RESULT_BYTES = 8192
const APP_ID = /^[a-z][a-z0-9-]{1,40}$/
const DEFINITIONS = Object.freeze([
  Object.freeze({ type: 'function', function: Object.freeze({
    name: 'list_artcraft_apps',
    description: 'List the locally installed ArtCraft creative applications and their purpose. This does not launch or edit anything.',
    parameters: Object.freeze({ type: 'object', additionalProperties: false,
      properties: Object.freeze({ scope: Object.freeze({ type: 'string', enum: Object.freeze(['installed']) }) }), required: Object.freeze(['scope']) }),
  }) }),
  Object.freeze({ type: 'function', function: Object.freeze({
    name: 'launch_artcraft_app',
    description: 'Open one locally installed ArtCraft desktop application by its exact app ID. This only starts the selected GUI; it does not open, read, modify, or export project files.',
    parameters: Object.freeze({ type: 'object', additionalProperties: false,
      properties: Object.freeze({ app_id: Object.freeze({ type: 'string', enum: Object.freeze([
        'photocraft', 'vectorcraft', 'filmcraft', 'lightcraft', 'pdfcraft', 'effectcraft',
        'designcraft', 'figcraft', 'wordcraft', 'soundcraft', 'deckcraft', 'cadcraft', 'gridcraft',
      ]) }) }), required: Object.freeze(['app_id']) }),
  }) }),
])

function result(value, maxBytes) {
  const encoded = JSON.stringify(value)
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new Error('ArtCraft result exceeds the local tool output limit.')
  return encoded
}

export function createNoriArtCraftTools(noriRoot = installationPaths().noriRoot, { launchProcess = spawn } = {}) {
  if (typeof noriRoot !== 'string' || !noriRoot) throw new TypeError('Nori install root is required.')
  const root = realpathSync(noriRoot)
  const integrationRoot = realpathSync(path.join(root, 'integrations', 'artcraft'))
  const manifestPath = path.join(integrationRoot, 'artcraft-apps.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.schema !== 'nori.integration.artcraft-apps.v1' || !Array.isArray(manifest.applications)) {
    throw new Error('The local ArtCraft inventory is missing or has an unsupported schema.')
  }
  const applications = new Map()
  for (const app of manifest.applications) {
    if (!APP_ID.test(app?.id) || typeof app.purpose !== 'string' || typeof app.desktop_exe !== 'string') continue
    const executable = path.resolve(integrationRoot, app.desktop_exe)
    const relative = path.relative(integrationRoot, executable)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
    applications.set(app.id, Object.freeze({ id: app.id, version: String(app.version || 'unknown'),
      purpose: app.purpose, executable }))
  }
  return Object.freeze({
    definitions: DEFINITIONS,
    async call(name, args, { maxBytes = MAX_RESULT_BYTES } = {}) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > MAX_RESULT_BYTES) throw new RangeError('Invalid ArtCraft result budget.')
      if (name === 'list_artcraft_apps') {
        if (!args || Object.keys(args).length !== 1 || args.scope !== 'installed') throw new Error('This ArtCraft inventory tool accepts only scope=installed.')
        const appIds = [...applications.keys()].sort().join(',')
        return result({ apps: appIds, access: 'installed; local GUI launch only' }, maxBytes)
      }
      if (name !== 'launch_artcraft_app' || !args || Object.keys(args).length !== 1
        || typeof args.app_id !== 'string' || !applications.has(args.app_id)) {
        throw new Error('Select one app ID from Nori’s installed ArtCraft inventory.')
      }
      const app = applications.get(args.app_id)
      const actual = realpathSync(app.executable)
      const stat = statSync(actual)
      const relative = path.relative(integrationRoot, actual)
      if (!stat.isFile() || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('The ArtCraft executable is not a regular file inside Nori’s integration folder.')
      }
      return await new Promise((resolve, reject) => {
        const child = launchProcess(actual, [], { cwd: path.dirname(actual), detached: true, windowsHide: false, stdio: 'ignore', shell: false })
        child.once('error', error => reject(new Error(`Nori could not start ${app.id}: ${String(error.message).slice(0, 180)}`)))
        child.once('spawn', () => {
          child.unref()
          resolve(result({ launched: true, app_id: app.id, version: app.version, pid: child.pid, app_dir: path.dirname(actual),
            status: 'process_started', note: 'The GUI process was started; readiness and creative-task completion were not tested.' }, maxBytes))
        })
      })
    },
  })
}

export function requestsNoriArtCraft(goal) {
  const { text } = artCraftRoutingIntent(goal)
  return /\bartcraft\b/i.test(text) || namedArtCraftApps(text).length > 0
}

const ARTCRAFT_APP_NAMES = Object.freeze(['photocraft', 'vectorcraft', 'filmcraft', 'lightcraft', 'pdfcraft', 'effectcraft',
  'designcraft', 'figcraft', 'wordcraft', 'soundcraft', 'deckcraft', 'cadcraft', 'gridcraft'])

function isQuestionAboutArtCraft(text) {
  const question = text.trim().replace(/^please\s+/i, '')
  // "Can you create ..." is an indirect work request, unlike "Can WordCraft
  // create ...". Asking Nori for an explanation still grants no tool action.
  const indirect = question.match(/^(?:can|could|would|will)\s+you\s+(?:please\s+)?(.+)$/i)
  const lead = indirect ? indirect[1] : question
  if (/^(?:(?:should|can|could|do)\s+i|what|which|why|when|where|who|whose|how\s+come|how\s+(?:long|much|many|big|fast|well)|how\s+(?:do|can|would|should)\s+i|tell\s+me\s+(?:about|how|what|which|whether|if)|explain\s+(?:how|what|whether|if)|describe\s+(?:how|what)|show\s+me\s+(?:how|what|which))\b/i.test(lead)) return true
  if (indirect) return false
  const appSubject = ARTCRAFT_APP_NAMES.map(id => id.replace('craft', '\\s*craft')).join('|')
  return new RegExp(`^(?:can|could|does|do|did|is|are|was|were|has|have|will|would|should)\\s+(?:(?:the|any|these|those)\\s+)?(?:${appSubject}|artcraft)\\b`, 'i').test(question)
}

const TASK_APP_RULES = Object.freeze([
  ['pdfcraft', /\b(?:pdf|acrobat|annotat(?:e|ion)|redact(?:ion)?|combine\s+pdf|split\s+pdf)\b/i],
  ['filmcraft', /\b(?:video|film|footage|timeline\s+edit|cut\s+a\s+clip)\b/i],
  ['soundcraft', /\b(?:audio|music|soundtrack|podcast|mix(?:ing)?|voiceover|sound\s+effect)\b/i],
  ['gridcraft', /\b(?:spreadsheet|workbook|excel|xlsx|csv|worksheet|formula|chart\s+from\s+data)\b/i],
  ['deckcraft', /\b(?:slides?|presentation|slide\s+deck|powerpoint|pptx)\b/i],
  ['cadcraft', /\b(?:cad|blueprint|technical\s+drawing|dxf|dwg)\b/i],
  ['figcraft', /\b(?:interface|ui\s+design|wireframe|prototype|figma)\b/i],
  ['designcraft', /\b(?:page\s+layout|brochure|magazine|print\s+layout|idml)\b/i],
  ['effectcraft', /\b(?:motion\s+graphics?|composit(?:e|ing)|after\s+effects|keyframe\s+animation)\b/i],
  ['photocraft', /\b(?:photorealistic|photo\s+of|image\s+of|picture\s+of)\b/i],
  ['vectorcraft', /\b(?:vector|svg|illustrat(?:e|ion)|logo|icon\s+set)\b/i],
  ['lightcraft', /\b(?:raw\s+photo|photo\s+library|lightroom|develop\s+photos)\b/i],
  ['photocraft', /\b(?:photo\s+edit|image\s+edit|photoshop|retouch|crop\s+photo)\b/i],
  ['wordcraft', /\b(?:document|resume|word\s+file|docx|report|letter|manuscript)\b/i],
])

const LAUNCH_VERB = /\b(?:open|launch|start|run|bring\s+up|fire\s+up|boot(?:\s+up)?|load\s+up|pull\s+up)\b/i
const OPERATION =/\b(?:create|make|build|design|draw|edit|retouch|format|write|compose|render|export|convert|inspect|read|analy[sz]e|open|import|organize|mix|trim|crop|annotate|highlight|combine|split|fill|sort|plot|record|produce|generate|save)\b/i
const VEHICLE_SUBJECT = /\b(?:car|automobile|vehicle|subaru|wrx|honda|del\s+sol|j30|sports\s+car)\b/i

function namedArtCraftApps(text) {
  return ARTCRAFT_APP_NAMES.filter(id => new RegExp(`\\b${id.replace('craft', '\\s*craft')}\\b`, 'i').test(text))
}

function taskArtCraftApps(text) {
  return [...new Set(TASK_APP_RULES.filter(([, pattern]) => pattern.test(text)).map(([id]) => id))]
}

// Quoted document text, titles and code are data, never routing authority.
// This is intentionally conservative: ambiguous prose gets no automation
// route, rather than granting an app access from an embedded instruction.
export function userCreativeRoutingText(goal) {
  return String(goal || '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\r\n]*`/g, ' ')
    .replace(/"[^"]*"|“[^”]*”|‘[^’]*’/g, ' ')
    .replace(/(^|[\s([{])'[^'\r\n]*'(?=$|[\s)\]},.!?:;])/g, '$1 ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/[’‘]/g, "'")
}

function artCraftRoutingIntent(goal) {
  const clauses = userCreativeRoutingText(goal).split(/[.!?;\n]+|\b(?:but|however)\b|(?=\b(?:do\s+not|don't|dont|never|avoid|without|no)\b)/i)
    .map(text => text.trim()).filter(Boolean)
  const positive = []
  const denied = new Set()
  let deniedAll = false
  for (const clause of clauses) {
    if (!/^(?:do\s+not|don't|dont|never|avoid|without|no)\b/i.test(clause)) {
      positive.push(clause)
      continue
    }
    const explicit = namedArtCraftApps(clause)
    const domains = explicit.length ? explicit : taskArtCraftApps(clause)
    for (const app of domains) denied.add(app)
    // Unrelated constraints (no web access, no changes to other files) do
    // not cancel a positive local task. An unqualified stop/no-create does.
    if (/\bartcraft\b/i.test(clause)
      || (!domains.length && OPERATION.test(clause) && !/\b(?:other|unrelated|outside)\b/i.test(clause))) deniedAll = true
  }
  const text = positive.join('. ')
  const explicit = namedArtCraftApps(text)
  const domains = explicit.length ? explicit : taskArtCraftApps(text)
  // A vehicle is the subject, not the artifact type. Only use the historical
  // PhotoCraft fallback when no concrete artifact domain was requested.
  const appId = domains.length === 1 ? domains[0]
    : !domains.length && VEHICLE_SUBJECT.test(text) ? 'photocraft' : null
  return { text, appId: deniedAll || denied.has(appId) ? null : appId, deniedAll }
}

/** Resolve one app only when named explicitly or the task has a distinct app-domain cue. */
export function resolveNoriArtCraftApp(goal) {
  return artCraftRoutingIntent(goal).appId
}

/** Prevent an image fallback from stealing concrete non-image artifact work,
 * including ambiguous requests that must not dispatch to any single app. */
export function hasNoriArtCraftNonImageIntent(goal) {
  const { text } = artCraftRoutingIntent(goal)
  return [...namedArtCraftApps(text), ...taskArtCraftApps(text)].some(app => app !== 'photocraft')
}

/** Only operational user requests open an app automation session. */
export function requestsNoriArtCraftOperation(goal) {
  const { text, appId } = artCraftRoutingIntent(goal)
  return Boolean(appId && !isQuestionAboutArtCraft(text) && OPERATION.test(text))
}

export function noriArtCraftMcpToolMatchesUserIntent(toolName, goal) {
  const expectedId = resolveNoriArtCraftApp(goal)
  if (!expectedId || !requestsNoriArtCraftOperation(goal)) return false
  return typeof toolName === 'string' && toolName.startsWith(`artcraft_${expectedId}_`)
}

export function resolveNoriArtCraftRequest(goal) {
  const { text, appId, deniedAll } = artCraftRoutingIntent(goal)
  if (!requestsNoriArtCraft(text)) return null
  if (isQuestionAboutArtCraft(text) || deniedAll) return null
  const listIntent = /\b(?:list|show|what|which|available|installed|catalog|catalogue)\b/i.test(text)
  // "Start PDFCraft", "fire up WordCraft": any launch verb opens the named app's window.
  const actionIntent = LAUNCH_VERB.test(text)
  if (listIntent && /\bartcraft\b/i.test(text) && !/\b(?:photocraft|photo\s*craft|vectorcraft|vector\s*craft|filmcraft|film\s*craft|lightcraft|light\s*craft|pdfcraft|pdf\s*craft|effectcraft|effect\s*craft|designcraft|design\s*craft|figcraft|fig\s*craft|wordcraft|word\s*craft|soundcraft|sound\s*craft|deckcraft|deck\s*craft|cadcraft|cad\s*craft|gridcraft|grid\s*craft)\b/i.test(text)) {
    return { name: 'list_artcraft_apps', args: { scope: 'installed' } }
  }
  if (!actionIntent) return null
  return appId ? { name: 'launch_artcraft_app', args: { app_id: appId } } : null
}

/** The exact launch a plain "start/launch/run/fire up <app>" asks for, with no app operation; else null. */
export function resolveNoriArtCraftLaunch(goal) {
  const requested = resolveNoriArtCraftRequest(goal)
  return requested?.name === 'launch_artcraft_app' && !requestsNoriArtCraftOperation(goal) ? requested : null
}

const ARTCRAFT_LABELS = Object.freeze({ pdfcraft: 'PDFCraft', cadcraft: 'CADCraft' })
/** Display name for an ArtCraft app ID: pdfcraft -> PDFCraft, wordcraft -> WordCraft. */
export function artCraftLabel(appId) {
  const id = String(appId || '')
  return ARTCRAFT_LABELS[id] || (id.endsWith('craft') ? `${id[0].toUpperCase()}${id.slice(1, -5)}Craft` : id)
}

export function noriArtCraftToolMatchesUserIntent(name, args, goal) {
  const requested = resolveNoriArtCraftRequest(goal)
  return Boolean(requested && requested.name === name
    && Object.keys(requested.args).length === Object.keys(args || {}).length
    && Object.entries(requested.args).every(([key, value]) => args?.[key] === value))
}
