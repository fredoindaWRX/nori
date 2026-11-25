import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import * as nodeFs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { correctIntentTypos } from './intent-typos.mjs'
import { requestsNoriLocalAppBuild } from './neuralese-app-tools.mjs'
import { readNativeEvidence, snapshotNativeOverview } from './rea-native-evidence.mjs'

// Inside Electron, node:fs presents every .asar archive as a folder, so a selected
// .asar target would be refused as "not a built app directory". Targets are real
// files on disk; use the unpatched filesystem for them.
const { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } =
  process.versions.electron ? createRequire(import.meta.url)('original-fs') : nodeFs

const REA_PACKAGE_VERSION = '6.8.0'
const execFileAsync = promisify(execFile)
const NORI_WIRED_REA_TOOLS = Object.freeze([
  'analyze_javascript_application', 'inspect_analysis_view', 'open_binary', 'binary_overview', 'export_evidence_bundle', 'close_binary',
])
// REA 6.8.0 accepts only the audited headless JADX MCP 0.7.1 fat JAR.
const JADX_JAR_FOLDER = 'jadx-headless-mcp-0.7.1'
const JADX_JAR_NAME = 'jadx-headless-mcp-0.7.1-all.jar'
const JADX_JAR_SHA256 = '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75'
const ANALYSIS_REQUEST = /\b(?:rea|reverse[- ]engine(?:er|ering)?|inspect|analy[sz]e)\b/i
const QUOTED_REA_DATA = /```[\s\S]*?(?:```|(?![\s\S]))|`[^`\r\n]*(?:`|$)|"[^"\r\n]*(?:"|$)|“[^”\r\n]*(?:”|$)|‘[^’\r\n]*(?:’|$)|(?<![\p{L}\p{N}_])'[^'\r\n]*(?:'|$)|^\s*>.*$/gmu

function negatesReaAction(clause) {
  const match = /^(?:do\s+not|don't|dont|never|avoid|stop|cancel|no)\b\s*(.*)$/i.exec(clause)
  if (!match) return false
  // Bind the prohibition to its action. A reference to REA in a permitted
  // Evidence-save exception does not prohibit the separately requested analysis.
  const actions = match[1].split(/\b(?:except|unless|apart\s+from)\b/i)[0]
    .split(/,|\b(?:and|or|nor)\b/i).map(value => value.trim()).filter(Boolean)
  return actions.some(rawAction => {
    // Adverbs and ordinary intent wrappers do not turn a prohibition into
    // permission ("do not statically inspect", "never attempt to inspect").
    const action = rawAction.replace(/^(?:(?:please|ever|just|really|still|first|then|\w+ly)\s+|(?:attempt|try|plan|intend|want|need|decide)\s+(?:you\s+)?to\s+)*/i, '')
    return /^(?:inspect(?:ing)?|analy[sz](?:e|ing)|reverse[- ]engine(?:er|ering))\b/i.test(action)
    || /^(?:(?:the|this|current|ongoing|any|another|further|local)\s+)*(?:rea|inspection|analysis)\b/i.test(action)
    || /^(?:us(?:e|ing)|run(?:ning)?|invok(?:e|ing)|call(?:ing)?|execut(?:e|ing)|start(?:ing)?|continu(?:e|ing)|proceed(?:ing)?|perform(?:ing)?|conduct(?:ing)?|attempt(?:ing)?|do(?:ing)?)\b.{0,80}\b(?:rea|inspection|analysis)\b/i.test(action)
    || /^(?:configure|connect|integrate|install|set\s+up|check|verify|list|show)\b.{0,80}\brea\b/i.test(action)
    || /^(?:do|start|proceed|continue|run)\s+(?:it|that|this)\b/i.test(action)
  })
}

// Paths are user-supplied DATA bindings, not command authority. Recognize
// only complete, top-level quoted paths; commands and nested paths inside a
// quoted example or code block must not activate the deterministic broker.
function reaRequestIntent(goal) {
  const input = String(goal ?? '')
  if (input.length > 20_000) return { text: '', paths: [], denied: true }
  const paths = []
  const unquoted = input.replace(QUOTED_REA_DATA, quoted => {
    const closing = ({ '“': '”', '‘': '’' })[quoted[0]] || quoted[0]
    const value = quoted.slice(1, -1)
    if (!quoted.startsWith('```') && quoted.at(-1) === closing
      && /^(?:[A-Za-z]:\\|\\\\)[^`"'\r\n]{2,1020}$/.test(value)) {
      paths.push(value)
      return ` REA_TARGET_${paths.length} `
    }
    return ' '
  }).replace(/[’‘]/g, "'")
  // Quoted paths were lifted out above, so typo correction never alters a target.
  const text = correctIntentTypos(unquoted)
  const clauses = text.split(/[.!?;\n]+|\b(?:but|however)\b|(?=\b(?:do\s+not|don't|dont|never|avoid|stop|cancel|no\s+(?:need|rea|inspection|analysis))\b)/i)
    .map(value => value.trim()).filter(Boolean)
  const denied = clauses.some(negatesReaAction)
  const discussion = /^\s*(?:explain|describe|quote|summarize|tell\s+me\s+(?:about|how)|how\s+(?:do|can|would|should)\s+(?:i|we)|what\s+(?:if|would))\b/i.test(text)
  return { text, paths, denied, discussion }
}

function fixedPath(pathValue) {
  if (typeof pathValue !== 'string' || !pathValue || pathValue.length > 1024 || pathValue.includes('\0')) {
    throw new Error('REA requires one exact, quoted local target path from the current user request.')
  }
  const resolved = path.resolve(pathValue)
  const stat = lstatSync(resolved)
  if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) {
    throw new Error('REA target cannot be a reparse point or multiply-linked file.')
  }
  if (realpathSync(resolved).toLowerCase() !== resolved.toLowerCase()) {
    throw new Error('REA target resolved to a different path; analysis was not started.')
  }
  if (stat.isDirectory()) {
    if (!existsSync(path.join(resolved, 'index.html')) || !lstatSync(path.join(resolved, 'assets')).isDirectory()) {
      throw new Error('A directory target must be an extracted built JavaScript app with index.html and assets/.')
    }
    return { path: resolved, extension: '.directory', kind: 'javascript_application_directory' }
  }
  if (!stat.isFile()) throw new Error('REA requires one regular packaged artifact file or built app directory.')
  const extension = path.extname(resolved).toLowerCase()
  if (!['.asar', '.exe', '.dll', '.apk'].includes(extension)) {
    throw new Error('Nori REA currently accepts built app directories, packaged .asar JavaScript apps, native .exe/.dll files, and Android .apk files only.')
  }
  return { path: resolved, extension,
    kind: extension === '.asar' ? 'javascript_application_archive' : extension === '.apk' ? 'android_package' : 'native_pe_artifact' }
}

export function requestedNoriReaTarget(goal) {
  const { text, paths, denied, discussion } = reaRequestIntent(goal)
  if (denied || discussion || !ANALYSIS_REQUEST.test(text)) return null
  if (!paths.length) return { needsPath: true }
  if (paths.length !== 1) return { needsPath: false, invalid: 'REA requires one exact quoted target; multiple target paths are ambiguous.' }
  try { return { ...fixedPath(paths[0]), needsPath: false } }
  catch (error) { return { needsPath: false, invalid: String(error?.message || 'Invalid REA target.') } }
}

export function requestsNoriRea(goal) {
  const { text, denied, discussion } = reaRequestIntent(goal)
  return !denied && !discussion && /\b(?:rea|reverse[- ]engine(?:er|ering)?)\b/i.test(text)
    && (/\b(?:analy[sz]e|inspect|reverse[- ]engine(?:er|ing)|use|run|invoke)\b/i.test(text)
      || /^\s*(?:please\s+)?rea\s+(?!(?:is|was|has|can|means|supports|version|tools?)\b)\S/i.test(text))
}

export function resolveNoriReaIntent(goal, turns = []) {
  const input = String(goal ?? '').trim()
  if (requestsNoriRea(input)) {
    // "Build an app based on it" after an REA run refers back to that run's
    // target; rebind the user's own earlier path instead of asking again.
    if (requestedNoriReaTarget(input)?.needsPath === true && requestsNoriLocalAppBuild(input)) {
      const earlier = earlierNoriReaTarget(input, turns)
      if (earlier) return input + '\nREA target from earlier in this conversation: "' + earlier + '"'
    }
    return input
  }
  let target = input
  if (['"', "'", '\x60'].includes(input[0]) && input.at(-1) === input[0]) target = input.slice(1, -1)
  if (target.length > 1024 || !/^[A-Za-z]:\\[^<>:"|?*\r\n'\x60]+\.(?:exe|dll|asar|apk)$/i.test(target)) return input
  const users = (Array.isArray(turns) ? turns : []).filter(turn => turn?.role === 'user' && typeof turn.text === 'string')
  if (users.at(-1)?.text.trim() === input) users.pop()
  const previous = users.at(-1)?.text
  if (!previous || !requestsNoriRea(previous) || requestedNoriReaTarget(previous)?.needsPath !== true) return input
  return 'Use REA to statically inspect "' + target + '". Do not launch or modify the target.'
}

function earlierNoriReaTarget(input, turns) {
  const users = (Array.isArray(turns) ? turns : []).filter(turn => turn?.role === 'user' && typeof turn.text === 'string')
  if (users.at(-1)?.text.trim() === input) users.pop()
  for (let index = users.length - 1; index >= Math.max(0, users.length - 6); index--) {
    const resolved = resolveNoriReaIntent(users[index].text, users.slice(0, index + 1))
    const target = requestsNoriRea(resolved) ? requestedNoriReaTarget(resolved) : null
    if (target && !target.needsPath && !target.invalid) return target.path
  }
  return null
}

export function requestsNoriReaSetup(goal) {
  const { text, denied, discussion } = reaRequestIntent(goal)
  return !denied && !discussion && /\b(?:rea|rea-agents)\b/i.test(text)
    && /\b(?:setup|set\s+up|install|configure|connect|integrate|working|available|active|check|verify|list|show|tools)\b/i.test(text)
}

function managedNoriToolRoot(environment) {
  const candidates = []
  const data = environment.NORI_APP_DATA_ROOT
  if (typeof data === 'string' && path.isAbsolute(data)) {
    if (path.basename(data).toLowerCase() === 'nori') candidates.push(data)
    else if (path.basename(data).toLowerCase() === 'desktop') {
      if (path.basename(path.dirname(data)).toLowerCase() === 'state') candidates.push(path.resolve(data, '..', '..'))
      else if (path.basename(path.dirname(data)).toLowerCase() === 'private' && path.basename(path.resolve(data, '..', '..')).toLowerCase() === 'state') candidates.push(path.resolve(data, '..', '..', '..'))
    }
  }
  const roaming = environment.APPDATA
  if (typeof roaming === 'string' && path.isAbsolute(roaming) && path.basename(roaming).toLowerCase() === 'roaming' && path.basename(path.dirname(roaming)).toLowerCase() === 'appdata') {
    candidates.push(path.join(path.dirname(roaming), 'Local', 'Nori'))
  }
  for (const candidate of candidates) {
    if (path.basename(candidate).toLowerCase() !== 'nori') continue
    const verified = verifiedDirectory(candidate, ['integrations/rea/node_modules/rea-agents/package.json'])
    if (verified) return verified
  }
  return null
}

function nodeExecutable(environment, noriRoot) {
  const managedRoot = managedNoriToolRoot(environment)
  const candidates = [typeof noriRoot === 'string' ? path.join(noriRoot, 'tools', 'rea', 'node.exe') : '', environment.NORI_REA_NODE,
    managedRoot ? path.join(managedRoot, 'tools', 'node-v26.12.1-win-x64', 'node.exe') : '',
    environment.LOCALAPPDATA
      ? path.join(environment.LOCALAPPDATA, 'Nori', 'tools', 'node-v26.12.1-win-x64', 'node.exe') : '',
    ...(String(environment.PATH || '').split(path.delimiter).map(entry => path.join(entry, 'node.exe'))),
    'C:\\Program Files\\nodejs\\node.exe']
  const found = candidates.find(candidate => typeof candidate === 'string' && candidate && existsSync(candidate))
  if (!found) throw new Error('REA needs the installed Node.js executable; no shell fallback was attempted.')
  return realpathSync(found)
}

function verifiedDirectory(candidate, requiredFiles) {
  if (typeof candidate !== 'string' || !candidate || !existsSync(candidate)) return null
  try {
    const resolved = path.resolve(candidate)
    const info = lstatSync(resolved)
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(resolved).toLowerCase() !== resolved.toLowerCase()) return null
    if (!requiredFiles.every(file => existsSync(path.join(resolved, file)))) return null
    return resolved
  } catch { return null }
}

function installedEnginePath(noriRoot, environment, kind) {
  const folder = kind === 'ghidra' ? 'ghidra_12.1.4_PUBLIC' : 'jdk-25.0.4.1+1'
  const envPath = kind === 'ghidra'
    ? [environment.NORI_GHIDRA_INSTALL_DIR, environment.GHIDRA_INSTALL_DIR]
    : [environment.NORI_JAVA_HOME, environment.JAVA_HOME]
  const required = kind === 'ghidra'
    ? ['Ghidra/application.properties', 'support/analyzeHeadless.bat']
    : ['bin/java.exe', 'release']
  const candidates = [...envPath]
  let ancestor = path.resolve(noriRoot)
  for (let depth = 0; depth <= 10; depth++) {
    candidates.push(path.join(ancestor, 'tools', 'analysis-engines', folder))
    const parent = path.dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  for (const candidate of candidates) {
    const verified = verifiedDirectory(candidate, required)
    if (verified) return verified
  }
  return null
}

export function resolveNoriReaEnginePaths(noriRoot, environment = process.env) {
  return Object.freeze({
    ghidra: installedEnginePath(noriRoot, environment, 'ghidra'),
    jdk: installedEnginePath(noriRoot, environment, 'jdk'),
  })
}

export function resolveNoriJadxJar(noriRoot, environment = process.env) {
  const candidates = [environment.NORI_JADX_MCP_JAR, environment.REA_JADX_MCP_JAR]
  let ancestor = path.resolve(noriRoot)
  for (let depth = 0; depth <= 10; depth++) {
    candidates.push(path.join(ancestor, 'tools', 'analysis-engines', JADX_JAR_FOLDER, JADX_JAR_NAME))
    const parent = path.dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || !existsSync(candidate)) continue
    try {
      const info = lstatSync(candidate)
      if (info.isFile() && !info.isSymbolicLink() && info.nlink === 1) return path.resolve(candidate)
    } catch {}
  }
  return null
}

function checkedSourcePaths(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    throw new Error('REA source_paths must contain 1 to 16 exact paths from the selected JavaScript app.')
  }
  const paths = value.map(item => {
    if (typeof item !== 'string' || !item || item.length > 512 || item.includes('\\')
      || item.includes('\0') || path.posix.isAbsolute(item)
      || item.split('/').some(part => !part || part === '.' || part === '..')
      || path.posix.normalize(item) !== item) {
      throw new Error('REA source_paths must be normalized relative paths without traversal or wildcards.')
    }
    return item
  })
  if (new Set(paths).size !== paths.length) throw new Error('REA source_paths cannot contain duplicates.')
  return Object.freeze(paths)
}

// REA's semantic pass grows steeply with file size: on this PC a 164 KB bundle takes
// seconds while a 1.6 MB minified bundle exceeds 6 minutes. For larger apps, focus on
// the app's own entry, preload and main sources instead of vendored or giant bundles.
const FOCUS_MAX_FILE_BYTES = 512 * 1024
const FOCUS_MAX_TOTAL_BYTES = 3 * 1024 * 1024
const FOCUS_MAX_FILES = 16
const FOCUS_SCAN_LIMIT = 20_000

// Reads the target through node:fs, which inside Electron can list an .asar archive.
// Outside Electron an .asar cannot be listed, and the whole app is analyzed as before.
export function defaultJavaScriptFocus(target, fsApi = nodeFs) {
  const files = []
  let scanned = 0
  const walk = relative => {
    let entries
    try { entries = fsApi.readdirSync(path.join(target, relative), { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (++scanned > FOCUS_SCAN_LIMIT) return
      if (entry.name.startsWith('.') || entry.name.includes('\\')) continue
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!/^(?:node_modules|bower_components|\.git)$/i.test(entry.name)) walk(child)
      } else if (/\.(?:c|m)?js$/i.test(entry.name)) {
        try { files.push({ path: child, size: fsApi.statSync(path.join(target, child)).size }) } catch {}
      }
    }
  }
  walk('')
  if (!files.length || scanned > FOCUS_SCAN_LIMIT) return undefined
  const total = files.reduce((sum, file) => sum + file.size, 0)
  if (files.length <= FOCUS_MAX_FILES && total <= FOCUS_MAX_TOTAL_BYTES
    && files.every(file => file.size <= FOCUS_MAX_FILE_BYTES)) return undefined
  let entry = null
  try {
    const main = JSON.parse(fsApi.readFileSync(path.join(target, 'package.json'), 'utf8')).main
    if (typeof main === 'string') entry = path.posix.normalize(main.replace(/^\.\//, ''))
  } catch {}
  const rank = file => file.path === entry ? 0 : /preload/i.test(file.path) ? 1
    : /(?:^|\/)(?:main|background|index|app|renderer|electron)[^/]*\.(?:c|m)?js$/i.test(file.path) ? 2 : 3
  const chosen = []
  let bytes = 0
  for (const file of files.filter(file => file.size > 0 && file.size <= FOCUS_MAX_FILE_BYTES)
    .sort((a, b) => rank(a) - rank(b) || a.path.split('/').length - b.path.split('/').length || b.size - a.size)) {
    if (chosen.length >= FOCUS_MAX_FILES) break
    if (bytes + file.size > FOCUS_MAX_TOTAL_BYTES) continue
    chosen.push(file.path)
    bytes += file.size
  }
  return chosen.length ? Object.freeze(chosen) : undefined
}

function reaScript(environment, noriRoot) {
  const appData = environment.APPDATA
  const localAppData = environment.LOCALAPPDATA
  const managedRoot = managedNoriToolRoot(environment)
  const candidates = [typeof noriRoot === 'string' ? path.join(noriRoot, 'tools', 'rea', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs') : '', environment.NORI_REA_SCRIPT,
    managedRoot ? path.join(managedRoot, 'integrations', 'rea', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs') : '',
    localAppData ? path.join(localAppData, 'Nori', 'integrations', 'rea', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs') : '',
    appData ? path.join(appData, 'npm', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs') : '']
  const existing = candidates.filter(value => typeof value === 'string' && value && existsSync(value))
  if (!existing.length) throw new Error('REA CLI 6.8.0 is not installed in Nori’s local user environment.')
  const rejected = []
  for (const candidate of existing) {
    const packageJson = path.resolve(path.dirname(candidate), '..', 'package.json')
    let metadata
    try { metadata = JSON.parse(readFileSync(packageJson, 'utf8')) }
    catch { rejected.push('unverified identity'); continue }
    if (metadata?.name === 'rea-agents' && metadata?.version === REA_PACKAGE_VERSION) return realpathSync(candidate)
    rejected.push(String(metadata?.version || 'unknown'))
  }
  throw new Error('Nori is pinned to REA ' + REA_PACKAGE_VERSION + '; installed package identity differs (' + rejected.join(', ') + '). No compatible REA package was selected.')
}

export function noriReaEvidenceDirectory(noriRoot, environment = process.env) {
  if (environment.NORI_APP_DATA_ROOT && (!path.isAbsolute(environment.NORI_APP_DATA_ROOT) || !verifiedDirectory(environment.NORI_APP_DATA_ROOT, []))) {
    throw new Error('Nori REA requires a verified canonical state directory for evidence.')
  }
  const selected = path.resolve(environment.NORI_APP_DATA_ROOT || noriRoot)
  const root = realpathSync(selected)
  if (root.toLowerCase() !== selected.toLowerCase()) throw new Error('Nori evidence root resolves elsewhere.')
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Nori root is not a verified directory.')
  let parent = path.join(root, 'verification')
  if (!existsSync(parent)) mkdirSync(parent)
  let info = lstatSync(parent)
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(parent).toLowerCase() !== parent.toLowerCase()) {
    throw new Error('Nori verification folder is not a verified local directory.')
  }
  const directory = path.join(parent, 'rea')
  if (!existsSync(directory)) mkdirSync(directory)
  info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory).toLowerCase() !== directory.toLowerCase()) {
    throw new Error('Nori REA evidence folder is not a verified local directory.')
  }
  return directory
}

function findEvidenceId(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return null
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'evidence_id' || key === 'parent_evidence_id')
      && typeof child === 'string' && /^ev_[a-f0-9]{64}$/.test(child)) return child
  }
  for (const child of Object.values(value)) {
    const found = findEvidenceId(child, depth + 1)
    if (found) return found
  }
  return null
}

function structuredResult(result) {
  if (result?.isError) throw new Error(String(result.content?.find?.(item => item?.type === 'text')?.text
    || 'REA reported an analysis error.'))
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent
  const text = result?.content?.filter?.(item => item?.type === 'text').map(item => item.text).join('\n')
  if (typeof text === 'string') {
    try { return JSON.parse(text) } catch { /* Keep the bounded text as a summary below. */ }
  }
  return { summary: String(text || 'REA returned no structured analysis summary.').slice(0, 1800) }
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}

async function evidenceIdFromFile(filePath, script, expectedEvidenceId = null) {
  const { parserStream } = createRequire(script)('stream-json')
  const source = createReadStream(filePath)
  const stream = source.pipe(parserStream())
  const containers = []
  let recordsSeen = false
  let evidenceId = null
  try {
    for await (const token of stream) {
      const current = containers.at(-1)
      if (token.name === 'startObject') {
        containers.push({ kind: 'object', record: containers.length === 2 && current?.records === true, key: null, idSeen: false })
        continue
      }
      if (token.name === 'startArray') {
        containers.push({ kind: 'array', records: containers.length === 1 && current?.key === 'records' })
        continue
      }
      if (token.name === 'keyValue') {
        if (containers.length === 1 && token.value === 'records') {
          if (recordsSeen) throw new Error('Duplicate records field')
          recordsSeen = true
        }
        if (current?.record && token.value === 'evidence_id') {
          if (current.idSeen) throw new Error('Duplicate record evidence_id')
          current.idSeen = true
        }
        if (current) current.key = token.value
        continue
      }
      if (token.name === 'stringValue' && current?.record && current.key === 'evidence_id') {
          if (/^ev_[a-f0-9]{64}$/.test(token.value)
            && (!expectedEvidenceId || token.value === expectedEvidenceId)) current.evidenceId = token.value
          current.key = null
      }
      if (token.name === 'endObject' || token.name === 'endArray') {
        const closed = containers.pop()
        // The saved parent must be a record, not a mention in metadata or
        // another record's evidence_links. Consume the full JSON before success.
        if (closed?.record && closed.evidenceId) evidenceId ||= closed.evidenceId
      }
    }
  } catch (error) {
    source.destroy()
    throw new Error(`REA Evidence bundle is not valid complete JSON: ${String(error?.message || error).slice(0, 240)}`)
  }
  return evidenceId
}

async function defaultMcpFactory({ script, node, environment, cwd, signal }) {
  const requireFromRea = createRequire(script)
  const { Client } = requireFromRea('@modelcontextprotocol/client')
  const { StdioClientTransport } = requireFromRea('@modelcontextprotocol/client/stdio')
  const transport = new StdioClientTransport({
    command: node,
    args: [script, 'mcp'],
    env: environment,
    cwd,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'nori-rea-runtime', version: '1.0.0' })
  transport.stderr?.on('data', () => {})
  try { await client.connect(transport, { signal }) }
  catch (error) { await transport.close().catch(() => {}); throw error }
  return client
}

function supportedNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version || '').trim())
  if (!match) return false
  const [major, minor, patch] = match.slice(1).map(Number)
  return major > 26 || (major === 26 && (minor > 12 || (minor === 12 && patch >= 1)))
    || (major === 24 && (minor > 22 || (minor === 22 && patch >= 1)))
    || (major === 22 && (minor > 23 || (minor === 23 && patch >= 4)))
}

export async function checkNoriReaConnection({
  noriRoot = process.env.NORI_ROOT || process.cwd(),
  environment = process.env,
  mcpFactory = defaultMcpFactory,
  nodeVersionProbe = async node => {
    const result = await execFileAsync(node, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
    return String(result.stdout || '').trim()
  },
  signal,
} = {}) {
  const script = reaScript(environment, noriRoot)
  const node = nodeExecutable(environment, noriRoot)
  const nodeVersion = await nodeVersionProbe(node)
  if (!supportedNodeVersion(nodeVersion)) {
    throw new Error(`REA 6.8.0 requires Node.js 22.23.4+, 24.22.1+, or 26.12.1+; Nori found ${nodeVersion || 'an unknown version'}.`)
  }
  const client = await mcpFactory({ script, node, environment, cwd: noriRoot, signal })
  try {
    const response = await client.listTools()
    const toolNames = [...new Set((Array.isArray(response?.tools) ? response.tools : [])
      .map(tool => tool?.name).filter(name => typeof name === 'string'))].sort()
    if (!toolNames.length) throw new Error('REA connected, but its MCP tools/list response was empty.')
    const missing = NORI_WIRED_REA_TOOLS.filter(name => !toolNames.includes(name))
    return Object.freeze({
      status: missing.length ? 'incomplete' : 'connected',
      package_version: REA_PACKAGE_VERSION,
      node_version: nodeVersion,
      server_tool_count: toolNames.length,
      nori_wired_tools: Object.freeze(NORI_WIRED_REA_TOOLS.filter(name => toolNames.includes(name))),
      missing_nori_wired_tools: Object.freeze(missing),
    })
  } finally {
    await client.close().catch(() => {})
  }
}

function compactSummary(value) {
  const textBytes = (value, limit) => {
    let text = '', size = 0
    for (const point of String(value).slice(0, limit * 2)) {
      const bytes = Buffer.byteLength(point, 'utf8')
      if (size + bytes > limit) break
      text += point
      size += bytes
    }
    return text
  }
  let source = value
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { source = {} }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) source = {}
  const stats = source.statistics && typeof source.statistics === 'object' ? source.statistics : {}
  const selectedStats = {}
  for (const key of ['relevant_files', 'parsed_javascript_files', 'findings', 'parse_failures',
    'text_bytes_read', 'skipped_javascript_files', 'visited_ast_nodes', 'modules']) {
    if (Number.isSafeInteger(stats[key]) && stats[key] >= 0) selectedStats[key] = stats[key]
  }
  const candidateCoverage = source.coverage?.application ?? source.coverage
  const coverage = {}
  if (candidateCoverage && typeof candidateCoverage === 'object' && !Array.isArray(candidateCoverage)) {
    if (typeof candidateCoverage.status === 'string') coverage.status = textBytes(candidateCoverage.status, 48)
    if (typeof candidateCoverage.truncated === 'boolean') coverage.truncated = candidateCoverage.truncated
    if (Number.isSafeInteger(candidateCoverage.omitted_count) && candidateCoverage.omitted_count >= 0) {
      coverage.omitted_count = candidateCoverage.omitted_count
    }
    if (Array.isArray(candidateCoverage.limits)) coverage.limits = candidateCoverage.limits.slice(0, 2)
      .map(item => textBytes(item, 140))
  }
  const bounded = {
    statistics: selectedStats,
    coverage,
    findings: Array.isArray(source.findings) ? source.findings.slice(0, 4).map(item => textBytes(item, 200)) : [],
    limitations: (() => {
      const limits = Array.isArray(source.limitations) ? source.limitations.filter(item => typeof item === 'string') : []
      const relevant = limits.find(item => /static paths and relationships|control-flow-sensitive|obfuscat/i.test(item))
        ?? limits.find(item => /dynamic|runtime/i.test(item))
      return (relevant ? [relevant] : limits.slice(0, 2)).map(item => textBytes(item, 180))
    })(),
    unknowns: Array.isArray(source.unknowns) ? source.unknowns.slice(0, 2).map(item => textBytes(item, 160)) : [],
  }
  const serialized = JSON.stringify(bounded)
  if (Buffer.byteLength(serialized, 'utf8') <= 1800) return serialized
  const minimal = { statistics: selectedStats, coverage, findings: bounded.findings.slice(0, 2) }
  // JSON escaping can expand control characters beyond their UTF-8 byte count.
  // Remove optional rows until the serialized, valid JSON obeys the wire limit.
  while (Buffer.byteLength(JSON.stringify(minimal), 'utf8') > 1800) {
    if (minimal.coverage.limits?.length) minimal.coverage.limits.pop()
    else if (minimal.findings.length) minimal.findings.pop()
    else { delete minimal.coverage.status; break }
  }
  return JSON.stringify(minimal)
}

function staticModuleFinding(item) {
  if (!item || item.kind !== 'javascript-module' || typeof item.path !== 'string') return null
  const shortText = (value, limit) => {
    let text = '', size = 0
    for (const point of String(value).slice(0, limit * 2)) {
      const bytes = Buffer.byteLength(point, 'utf8')
      if (size + bytes > limit - 3) return text + '…'
      text += point
      size += bytes
    }
    return text
  }
  const file = shortText(item.path, 48)
  const observations = Array.isArray(item.observations) ? item.observations : []
  const returnShape = observations.find(observation => observation?.properties?.semantic_role === 'export-return-shapes')
  const properties = returnShape?.properties
  const shape = Array.isArray(properties?.static_return_shapes) ? properties.static_return_shapes[0] : null
  const literal = shape?.fields?.find(field => field?.path === '' && field?.state === 'literal')
  if (typeof properties?.exported_name === 'string' && literal && ['string', 'number', 'boolean'].includes(typeof literal.value)) {
    const name = shortText(properties.exported_name, 24)
    const encoded = typeof literal.value === 'string' && literal.value.length > 40 ? null : JSON.stringify(literal.value)
    if (encoded && Buffer.byteLength(encoded, 'utf8') <= 40) {
      return `${file} exports ${name}; static return shape includes literal ${encoded} (not runtime-verified).`
    }
    return `${file} exports ${name}; its literal return value exceeds this bounded report (not runtime-verified).`
  }
  const exports = Array.isArray(item.exports) ? item.exports.filter(name => typeof name === 'string').slice(0, 4).map(name => shortText(name, 20)) : []
  return exports.length ? `${file} statically declares exports: ${exports.join(', ')}.` : null
}

async function inspectJavaScriptFindings(client, evidenceId, signal) {
  signal?.throwIfAborted()
  const pageResult = await client.callTool({ name: 'inspect_analysis_view', arguments: {
    source: { kind: 'retained-evidence', evidence_id: evidenceId },
    view: { kind: 'page', collection: 'modules', offset: 0, limit: 12 },
  } }, { timeout: 30_000, signal })
  const page = structuredResult(pageResult)
  const pageResultData = page.normalized_result
  if (pageResultData?.parent_evidence_id !== evidenceId || !Array.isArray(pageResultData.items)) {
    throw new Error('REA module view did not match the analyzed Evidence; no findings summary was accepted.')
  }
  const findings = []
  for (const module of pageResultData.items.filter(item => item?.kind === 'javascript-module').slice(0, 4)) {
    signal?.throwIfAborted()
    if (typeof module.node_id !== 'string' || !/^jag_node_[a-f0-9]{64}$/.test(module.node_id)) continue
    const itemResult = await client.callTool({ name: 'inspect_analysis_view', arguments: {
      source: { kind: 'retained-evidence', evidence_id: evidenceId },
      view: { kind: 'item', collection: 'modules', selector: { node_id: module.node_id } },
    } }, { timeout: 30_000, signal })
    const detail = structuredResult(itemResult).normalized_result
    if (detail?.parent_evidence_id !== evidenceId || detail?.item?.node_id !== module.node_id
      || detail.item.kind !== module.kind || detail.item.path !== module.path) continue
    const finding = staticModuleFinding(detail.item)
    if (finding && !findings.includes(finding)) findings.push(finding)
  }
  return findings.slice(0, 4)
}

function safeSummary({ target, kind, evidenceId, summary, digest, bytes, evidencePath, completedAt, noriRoot }) {
  return {
    status: 'completed',
    target: path.basename(target),
    target_kind: kind,
    provider: kind === 'native_pe_artifact' ? 'ghidra-12.1.4-windows-p0' : kind === 'android_package' ? 'jadx-headless-mcp-0.7.1' : 'rea-javascript-static',
    evidence_id: evidenceId,
    evidence_sha256: digest,
    evidence_bytes: bytes,
    evidence_path: (path.relative(noriRoot, evidencePath).startsWith('..') ? evidencePath : path.relative(noriRoot, evidencePath)).replace(/\\/g, '/'),
    completed_at: completedAt,
    summary: ['javascript_application_directory', 'javascript_application_archive'].includes(kind)
      ? compactSummary(summary)
      : summary && typeof summary === 'object' ? JSON.stringify(summary).slice(0, 1800) : String(summary || '').slice(0, 1800),
    target_executed: false,
    target_modified: false,
  }
}

export function createNoriReaTools(goal, {
  noriRoot,
  environment = process.env,
  mcpFactory = defaultMcpFactory,
  evidenceReader = evidenceIdFromFile,
  clock = () => new Date(),
  focusSelector = defaultJavaScriptFocus,
} = {}) {
  if (typeof noriRoot !== 'string' || !noriRoot) throw new TypeError('Nori root is required for REA evidence retention.')
  const selected = requestedNoriReaTarget(goal)
  if (!requestsNoriRea(goal) || !selected || selected.needsPath || selected.invalid) {
    throw new Error('REA tools can be created only for an explicit valid target in the current user request.')
  }
  const definition = Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'rea_analyze_target',
      description: `Statically analyze exactly this user-selected local packaged file; no target execution or target modification. This one target is: ${path.basename(selected.path)}.`,
      parameters: Object.freeze({
        type: 'object', additionalProperties: false,
        properties: Object.freeze({
          path: Object.freeze({ type: 'string', enum: Object.freeze([selected.path]) }),
          source_paths: Object.freeze({ type: 'array', minItems: 1, maxItems: 16,
            items: Object.freeze({ type: 'string', minLength: 1, maxLength: 512 }) }),
        }),
        required: Object.freeze(['path']),
      }),
    }),
  })

  const nativeEvidenceDefinition = Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'rea_inspect_latest_evidence',
      description: 'Read a bounded native binary overview from the exact verified Evidence saved by this task. This does not reopen, run, or change the target.',
      parameters: Object.freeze({
        type: 'object', additionalProperties: false,
        properties: Object.freeze({ view: Object.freeze({ type: 'object', additionalProperties: false,
          properties: Object.freeze({ kind: Object.freeze({ type: 'string', enum: Object.freeze(['summary']) }) }),
          required: Object.freeze(['kind']) }) }),
        required: Object.freeze(['view']),
      }),
    }),
  })
  let latestNativeEvidence = null
  let analysisGeneration = 0

  async function inspectLatestNativeEvidence(args, signal) {
    signal?.throwIfAborted()
    const evidence = latestNativeEvidence
    if (!evidence || !args || Object.getPrototypeOf(args) !== Object.prototype
      || Object.keys(args).length !== 1 || !args.view || Object.getPrototypeOf(args.view) !== Object.prototype
      || Object.keys(args.view).length !== 1 || args.view.kind !== 'summary') {
      throw new Error('REA native evidence follow-up requires the latest successful analysis and one summary view.')
    }
    const expectedPath = path.join(noriReaEvidenceDirectory(noriRoot, environment), path.basename(evidence.path))
    if (path.resolve(expectedPath).toLowerCase() !== evidence.path.toLowerCase()) {
      throw new Error('REA evidence path no longer matches Nori’s verified evidence directory.')
    }
    const before = lstatSync(evidence.path)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== evidence.bytes
      || realpathSync(evidence.path).toLowerCase() !== evidence.path.toLowerCase()) {
      throw new Error('Saved REA Evidence changed after analysis; follow-up was not read.')
    }
    const readback = await readNativeEvidence({ filePath: evidence.path, reaScript: evidence.script,
      evidenceId: evidence.evidenceId, expectedSha256: evidence.digest, signal })
    const snapshot = readback.snapshot
    signal?.throwIfAborted()
    const after = lstatSync(evidence.path)
    if (latestNativeEvidence !== evidence || analysisGeneration !== evidence.generation
      || !after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || after.size !== before.size
      || after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || JSON.stringify(snapshot) !== JSON.stringify(evidence.snapshot)) {
      throw new Error('Saved REA Evidence changed or did not match the analyzed overview; follow-up was not read.')
    }
    const response = { evidence_id: evidence.evidenceId, normalized_result: {
      kind: 'summary', view: { kind: 'summary' }, parent_evidence_id: evidence.evidenceId,
      parent_operation: 'binary_overview', ...snapshot,
    } }
    const serialized = JSON.stringify(response)
    if (Buffer.byteLength(serialized, 'utf8') > 12_000) throw new Error('REA native Evidence summary exceeded its bounded size.')
    return serialized
  }

  return Object.freeze({
    definitions: Object.freeze(selected.kind === 'native_pe_artifact' ? [definition, nativeEvidenceDefinition] : [definition]),
    async call(name, args, { signal } = {}) {
      if (name === 'rea_inspect_latest_evidence' && selected.kind === 'native_pe_artifact') {
        return inspectLatestNativeEvidence(args, signal)
      }
      const generation = name === 'rea_analyze_target' ? ++analysisGeneration : null
      if (generation !== null) latestNativeEvidence = null
      signal?.throwIfAborted()
      if (name !== 'rea_analyze_target' || !args || Object.getPrototypeOf(args) !== Object.prototype
        || Object.keys(args).some(key => !['path', 'source_paths'].includes(key)) || args.path !== selected.path) {
        throw new Error('REA request changed or expanded the exact user-selected target; no analysis started.')
      }
      const requestedPaths = checkedSourcePaths(args.source_paths)
      const sourcePaths = requestedPaths ?? (['.asar', '.directory'].includes(selected.extension)
        ? checkedSourcePaths(focusSelector(selected.path)) : undefined)
      const before = statSync(selected.path)
      const script = reaScript(environment, noriRoot)
      const node = nodeExecutable(environment, noriRoot)
       const { ghidra, jdk } = resolveNoriReaEnginePaths(noriRoot, environment)
      const childEnvironment = { ...environment }
      const isJavaScript = selected.extension === '.asar' || selected.extension === '.directory'
        if (sourcePaths && !isJavaScript) throw new Error('REA source_paths are supported only for JavaScript application targets.')
      const isAndroid = selected.extension === '.apk'
      const jadx = isAndroid ? resolveNoriJadxJar(noriRoot, environment) : null
      if (isAndroid) {
        if (!jadx) throw new Error(`Android analysis needs ${JADX_JAR_NAME} in tools\\analysis-engines\\${JADX_JAR_FOLDER}; no analysis started.`)
        if (await sha256File(jadx) !== JADX_JAR_SHA256) throw new Error('The JADX MCP JAR does not match the audited 0.7.1 SHA-256; no analysis started.')
        childEnvironment.REA_JADX_MCP_JAR = jadx
        if (jdk) childEnvironment.JAVA_HOME = jdk
      } else if (!isJavaScript) {
         if (ghidra) childEnvironment.GHIDRA_INSTALL_DIR = ghidra
         if (jdk) childEnvironment.JAVA_HOME = jdk
        childEnvironment.REA_ANALYSIS_PROVIDER = 'ghidra'
      }

      let analysis
      let findings = []
      let analyzedEvidenceId = null
      let binaryOpened = false
      const directory = noriReaEvidenceDirectory(noriRoot, environment)
      const filename = `rea-${clock().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`
      const evidencePath = path.join(directory, filename)
      const client = await mcpFactory({ script, node, environment: childEnvironment, cwd: noriRoot, signal })
      try {
        const available = new Set((await client.listTools()).tools.map(tool => tool.name))
        if (!available.has('export_evidence_bundle')) throw new Error('REA Evidence export is unavailable in this session.')
        if (isJavaScript) {
          if (!available.has('analyze_javascript_application') || !available.has('inspect_analysis_view')) {
            throw new Error('REA static JavaScript analysis or bounded Evidence views are unavailable in this session.')
          }
           analysis = await client.callTool({ name: 'analyze_javascript_application', arguments: {
            input_path: selected.path,
            format: selected.extension === '.asar' ? 'asar' : 'directory',
            detail: 'summary',
            max_semantic_nodes: 128,
            max_semantic_nodes_per_file: 64,
            max_heap_mb: 2048,
             // Full desktop apps (thousands of bundled files) need minutes, not seconds.
             analysis_timeout_ms: 480_000,
             ...(sourcePaths ? { source_paths: sourcePaths } : {}),
           } }, { timeout: 500_000, signal })
        } else if (isAndroid) {
          if (!available.has('inspect_android_package')) throw new Error('REA Android package analysis is unavailable in this session.')
          analysis = await client.callTool({ name: 'inspect_android_package', arguments: { path: selected.path, detail: 'summary' } },
            { timeout: 360_000, signal })
        } else {
          if (!available.has('open_binary') || !available.has('binary_overview') || !available.has('close_binary')) {
            throw new Error('REA native analysis is unavailable in this session.')
          }
          await client.callTool({ name: 'open_binary', arguments: { path: selected.path, provider_id: 'ghidra' } }, { timeout: 360_000, signal })
          binaryOpened = true
          analysis = await client.callTool({ name: 'binary_overview', arguments: {} }, { timeout: 360_000, signal })
        }
        const result = structuredResult(analysis)
        // detail:'summary' returns an inspect_analysis_view receipt. Its own
        // Evidence ID identifies the view; the parent ID identifies the static
        // JavaScript analysis and is the only valid source for follow-up views.
        analyzedEvidenceId = isJavaScript && /^ev_[a-f0-9]{64}$/.test(result.normalized_result?.parent_evidence_id || '')
          ? result.normalized_result.parent_evidence_id : findEvidenceId(result)
        if (!analyzedEvidenceId) throw new Error('REA returned no Evidence identifier; no analysis success was recorded.')
        findings = isJavaScript ? await inspectJavaScriptFindings(client, analyzedEvidenceId, signal) : []
        signal?.throwIfAborted()
        const exported = await client.callTool({ name: 'export_evidence_bundle', arguments: { path: evidencePath, overwrite: false } }, { timeout: 30_000, signal })
        if (exported?.isError) throw new Error(String(exported.content?.find?.(item => item?.type === 'text')?.text
          || 'REA failed to export the complete Evidence bundle.'))
      } finally {
        if (binaryOpened) {
          await client.callTool({ name: 'close_binary', arguments: {} }).catch(() => {})
        }
        await client.close().catch(() => {})
      }
      const after = statSync(selected.path)
      if (before.isFile() && (before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)) {
        throw new Error('REA target changed during analysis; the result was not accepted.')
      }
      const evidenceStat = lstatSync(evidencePath)
      if (!evidenceStat.isFile() || evidenceStat.isSymbolicLink() || evidenceStat.nlink !== 1 || evidenceStat.size <= 0) {
        throw new Error('REA did not create one complete regular Evidence bundle; analysis is not confirmed.')
      }
      const evidenceId = await evidenceReader(evidencePath, script, analyzedEvidenceId)
      if (!evidenceId || evidenceId !== analyzedEvidenceId) throw new Error('Exported REA Evidence bundle does not contain the analyzed Evidence ID.')
      const digest = await sha256File(evidencePath)
      signal?.throwIfAborted()
      const result = structuredResult(analysis)
      if (selected.kind === 'native_pe_artifact') {
        const snapshot = snapshotNativeOverview(result)
        if (generation !== analysisGeneration) throw new Error('REA analysis was superseded before its Evidence could be accepted.')
        latestNativeEvidence = Object.freeze({ evidenceId, path: realpathSync(evidencePath), digest,
          bytes: evidenceStat.size, script, snapshot, generation })
      }
      const collectTextRows = key => {
        const candidates = [result.normalized_result?.[key], result.normalized_result?.summary?.[key], result[key], result.summary?.[key]]
          .flat().filter(item => typeof item === 'string')
        return [...new Set(candidates)].slice(0, 24)
      }
      const summary = isJavaScript ? {
        statistics: result.normalized_result?.summary?.statistics ?? result.normalized_result?.statistics ?? result.statistics ?? {},
        coverage: result.normalized_result?.summary?.coverage?.application
          ?? result.normalized_result?.summary?.coverage
          ?? result.normalized_result?.coverage?.application
          ?? result.normalized_result?.coverage ?? result.coverage ?? {},
        limitations: collectTextRows('limitations'),
        unknowns: collectTextRows('unknowns'),
        findings,
      } : result.normalized_result?.summary ?? result.summary ?? result
      const receipt = safeSummary({ target: selected.path, kind: selected.kind,
        evidenceId, summary, digest, bytes: evidenceStat.size, evidencePath,
        completedAt: clock().toISOString(), noriRoot })
      return JSON.stringify(receipt)
    },
  })
}

// Live inspection Nori's REA route does not have. Asked for one of these with no file to analyze, she says so
// in the first word instead of reciting the connection check (owner report 2026-11-24: USB mixer question).
const REA_LIVE_ASKS = [
  ['live USB inspection', /\busb\b/i, 'a read-only USB device reader (vendor and product ID, interfaces)',
    ' On Windows the USB ID and interfaces are in Device Manager: open the device, then Details, then Hardware Ids.'],
  ['Bluetooth inspection', /\bbluetooth\b/i, 'a read-only Bluetooth device reader', ''],
  ['live network capture', /\b(?:network\s+traffic|packet\s+capture|sniff(?:ing)?)\b/i, 'a live packet capture tool', ''],
  ['live inspection of a running program', /\b(?:live|runtime|running)\s+(?:inspection|analysis|process(?:es)?|app(?:lication)?|program|debugg?ing)\b|\battach\s+to\b/i,
    'a runtime or debugger tool', ''],
]

export function noriReaLiveAsk(goal) {
  const { text, denied, discussion } = reaRequestIntent(goal)
  if (denied || discussion || !/\b(?:rea|rea-agents|reverse[- ]engine(?:er|ering)?)\b/i.test(text)) return null
  return REA_LIVE_ASKS.find(([, pattern]) => pattern.test(text)) ?? null
}

export function noriReaLiveAskResponse(ask) {
  const [label, , missing, where] = ask
  return `No. My REA setup does not support ${label}, so I did not inspect anything. Missing capability: ${missing}. What I have wired from REA is read-only static analysis of one file you name: a built app folder, .asar, .exe, .dll or Android .apk. Nothing was read or changed.${where}`
}

export function noriReaMissingTargetResponse() {
  return 'I can use REA to statically inspect third-party apps as well as Nori-built apps. Paste one exact path to the local .exe, .dll, .asar, or Android .apk file, and I will bind it to this request. Built app folders also need an exact quoted path. I will not launch or modify the target.'
}

export async function noriReaSetupResponse(options = {}) {
  try {
    const status = await checkNoriReaConnection(options)
    if (status.status !== 'connected') {
      return `Nori reached REA ${status.package_version} over local MCP, but her investigation route is incomplete. Missing tools: ${status.missing_nori_wired_tools.join(', ')}. No target was analyzed and no files or settings were changed. Any repair must start with a setup plan for your review.`
    }
    return `Nori’s REA connection check passed: the local MCP handshake succeeded with REA ${status.package_version} on Node ${status.node_version}, and REA exposed ${status.server_tool_count} tools. Nori’s currently wired route uses ${status.nori_wired_tools.join(', ')} for read-only static analysis of an exact user-selected built app folder, .asar, .exe, .dll, or Android .apk; native .exe/.dll analysis also requires an available Ghidra provider, and .apk analysis the audited JADX 0.7.1 JAR. This is not the same as wiring all ${status.server_tool_count} REA tools into Nori. Nori uses her own local MCP client, so the rea-agents setup command is not needed and no Codex/Cline/OpenCode configuration is changed. This check did not inspect a target. To start an investigation, give Nori one exact local path in quotes and the question you want answered.`
  } catch (error) {
    return `Nori’s REA connection check did not pass: ${String(error?.message || error).slice(0, 240)}. No target was analyzed and no files or settings were changed. Nori will not claim REA is connected; any installation or configuration repair must first be shown as a setup plan for your review.`
  }
}

export function noriReaResultResponse(value, nativeEvidenceView = null) {
  let receipt
  try { receipt = JSON.parse(value) } catch { throw new Error('Nori could not verify the REA receipt; analysis is not confirmed.') }
  if (receipt?.status !== 'completed' || typeof receipt.evidence_id !== 'string'
    || !/^[a-f0-9]{64}$/.test(receipt.evidence_sha256)) {
    throw new Error('Nori received an incomplete REA receipt; analysis is not confirmed.')
  }
  const engine = receipt.target_kind === 'native_pe_artifact' ? 'Ghidra' : receipt.target_kind === 'android_package' ? 'JADX Android' : 'JavaScript'
  let report = ''
  if (nativeEvidenceView !== null) {
    const view = nativeEvidenceView?.normalized_result
    if (receipt.target_kind !== 'native_pe_artifact' || view?.parent_evidence_id !== receipt.evidence_id
      || view?.parent_operation !== 'binary_overview' || view?.view?.kind !== 'summary'
      || !view?.summary || typeof view.summary !== 'object' || Array.isArray(view.summary)) {
      throw new Error('REA native readback did not match the saved analysis; no readback was accepted.')
    }
    const facts = []
    for (const [key, label] of [['procedure_count', 'recovered procedures'], ['string_count', 'defined strings'], ['segment_count', 'segments']]) {
      const count = view.summary[key]
      if (Number.isSafeInteger(count) && count >= 0) facts.push(`${count} ${label}`)
    }
    if (facts.length) report += ` Verified native inventory: ${facts.join('; ')}.`
    const limits = Array.isArray(view.limitations) ? view.limitations.filter(item => typeof item === 'string') : []
    const notable = [limits.find(item => /pdb|original names|types may be missing/i.test(item)),
      limits.find(item => /undefined|string.*absent|packed/i.test(item))].filter(Boolean)
    // The evidence reader already bounds each item to 512 UTF-8 bytes. Keeping
    // that whole bounded text prevents dropping a warning at the end of a
    // longer provider preamble.
    if (notable.length) report += ` Provider limitations: ${[...new Set(notable)].map(item => item.slice(0, 512)).join(' ')}`
    if (limits.length > new Set(notable).size || view.truncated?.limitations === true || view.limitations_omitted > 0) {
      report += ' Further provider limitations remain in the saved Evidence.'
    }
  }
  try {
    const detail = typeof receipt.summary === 'string' ? JSON.parse(receipt.summary) : receipt.summary
    const stats = detail?.statistics
    const coverage = detail?.coverage?.application ?? detail?.coverage
    const facts = []
    if (Number.isSafeInteger(stats?.relevant_files)) facts.push(`${stats.relevant_files} relevant files`)
    if (Number.isSafeInteger(stats?.parsed_javascript_files)) facts.push(`${stats.parsed_javascript_files} JavaScript files parsed`)
    if (Number.isSafeInteger(stats?.findings)) facts.push(`${stats.findings} static findings`)
    if (Number.isSafeInteger(stats?.parse_failures)) facts.push(`${stats.parse_failures} parse failures`)
    if (Number.isSafeInteger(stats?.text_bytes_read)) facts.push(`${stats.text_bytes_read} text bytes read`)
    if (facts.length) report += ` Summary: ${facts.join('; ')}.`
    const findings = Array.isArray(detail?.findings) ? detail.findings : []
    const detailedPaths = new Set(findings.filter(item => String(item).includes('static return shape includes literal '))
      .map(item => String(item).split(' exports ')[0]))
    const conciseFindings = findings.filter(item => {
      const text = String(item)
      return !text.includes(' statically declares exports: ') || !detailedPaths.has(text.split(' statically declares exports: ')[0])
    })
    if (conciseFindings.length) report += ` JavaScript findings (bounded module sample): ${conciseFindings.slice(0, 4).map(item => String(item).slice(0, 200)).join(' ')}`
    else if (['javascript_application_directory', 'javascript_application_archive'].includes(receipt.target_kind)) report += ' JavaScript findings: no bounded module-level finding was returned.'
    if (typeof coverage?.status === 'string') report += ` Application coverage: ${coverage.status}.`
    const limits = Array.isArray(detail?.limitations) ? detail.limitations : []
    const unknowns = Array.isArray(detail?.unknowns) ? detail.unknowns : []
    const relevantLimit = limits.find(item => /static paths and relationships|control-flow-sensitive|obfuscat/i.test(String(item)))
      ?? limits.find(item => /dynamic|runtime/i.test(String(item)))
    if (relevantLimit) {
      report += ` Analysis limits: ${String(relevantLimit).slice(0, 180)}`
    }
    const semanticUnknown = unknowns.find(item => /semantic graph unknowns remain/i.test(String(item)))
    if (semanticUnknown) {
      const count = Number(/^\s*(\d+)/.exec(String(semanticUnknown))?.[1] || 0)
      if (count > 0) report += ` REA recorded ${count} semantic-graph unknown${count === 1 ? '' : 's'}.`
    }
  } catch { /* A valid completion receipt may still lack report details. */ }
  return `REA finished a read-only ${engine} analysis of ${receipt.target}.${report} Evidence ${receipt.evidence_id} was saved under ${receipt.evidence_path} (SHA-256 ${receipt.evidence_sha256.slice(0, 16)}…). The target was not executed or modified. This is static analysis; it does not prove runtime behavior.`
}

