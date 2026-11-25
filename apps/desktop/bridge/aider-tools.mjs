import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { createNoriProjectTools } from './project-tools.mjs'
import { installationPaths } from './installation-paths.mjs'
import { userCreativeRoutingText, requestsNoriArtCraftOperation } from './artcraft-tools.mjs'
import { isSelfCodeRequest, prepareSelfCodeWorkspace, selfCodeWorkspace } from './self-code-workspace.mjs'
import { createBackgroundWorkerSubmission } from './worker-submit.mjs'
import { codingActionText, priorCodeGenerationRequest } from './coding-followup-context.mjs'
import { requestsReadOnlyProjectReview } from './project-read-intent.mjs'
import { createAiderWorkerReceiptValidator } from './aider-worker-receipt.mjs'
import { requestsInstalledSkillCatalog } from './skill-catalog-status.mjs'

const MAX_CAPTURE_BYTES = 512 * 1024

export function localAiderModel(environment = process.env) {
  const id = environment.NORI_GPT_OSS_SERVER_MODEL
  if (typeof id !== 'string' || !id) {
    throw new Error('Aider requires Nori’s explicit active local model identity; no default or fallback was used.')
  }
  if (id === 'qwen3.5-9b') return { id: 'openai/qwen3.5-9b', label: 'local Qwen3.5 9B' }
  if (id === 'nori-auto') return { id: 'openai/nori-auto', label: 'Nori automatic local coder' }
  if (id === 'qwen3.8-27b') return { id: 'openai/qwen3.8-27b', label: 'local Qwen3.8 27B' }
  if (id === 'gpt-oss-20b') return { id: 'openai/gpt-oss-20b', label: 'local GPT-OSS 20B' }
  throw new Error('Aider has no supported profile for the selected local model; no fallback was used.')
}

export const AIDER_CODE_TASK = Object.freeze({
  type: 'function',
  function: {
    name: 'aider_code_task',
    description: 'Run local Aider for the host-bound user task and project. Supply exact relative edit files and optional read-only context.',
    parameters: {
      type: 'object',
      properties: {
        allowed_files: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'string', minLength: 1, maxLength: 240 } },
        context_files: { type: 'array', maxItems: 24, items: { type: 'string', minLength: 1, maxLength: 240 } },
      },
      required: ['allowed_files'],
      additionalProperties: false,
    },
  },
})

const CODE_ACTION = /\b(?:build|create|write|implement|code|fix|debug|refactor|edit|modify|update|change|add|remove|repair|enhanc\w*)\b/i
const CODE_MODIFICATION = /\b(?:build|create|write|implement|fix|debug|refactor|edit|modify|update|change|add|remove|repair|improve|enhanc\w*)\b/i
const READ_ONLY_CODE_REQUEST = /\b(?:inspect|review|explain|understand|audit|analy[sz]e)\b/i
const CODE_SUBJECT = /\b(?:aider|code|coder|coding|software|script|function|bug|repo(?:sitory)?|source code|unit tests?|test suite|plugins?|browser extensions?|api (?:client|connector|adapter))\b/i
const SOURCE_FILE_EDIT = /\b(?:edit|write|modify|fix|debug|refactor|update|repair|implement)\s+(?:(?:the|my|our|this|existing|file|source|code)\s+){0,3}["'`]?(?:[a-z]:[\\/])?[\w./\\-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx|c|cpp|h|cs|rs|go|java|rb|sh|ps1)\b/i
const TOOL_DEVELOPMENT = /\b(?:build|create|develop|implement|write)\s+(?:(?:me|us|a|an|the|my|new|small|simple|local|nori)\s+){0,6}tool\b.{0,120}\b(?:api|post|publish|upload|automate|software)\b/i
const APP_DEVELOPMENT = /\b(?:build|create|develop|implement|program)\s+(?:(?:me|us|a|an|the|my|new|small|simple|local|desktop|web|mobile|nori)\s+){0,6}(?:app|application|program)\b|\b(?:fix|debug|refactor|repair)\s+(?:(?:my|the|this|our|nori)\s+){0,3}(?:app|application|project)\b/i
const PURE_QUESTION = /^(?:\s*)(?:what|which|who|where|when|why|how|is|are|does|do)\b/i
const execFileAsync = promisify(execFile)

const AFFIRMATIVE_CODE_FOLLOWUP = /^(?:sure(?:\s+(?:run it|do it|go ahead|proceed))?|yes(?:\s+(?:run it|do it|go ahead|proceed))?|go ahead(?:\s+and\s+(?:run|do|implement|build|make)(?:\s+it)?)?|run it|do it|proceed|please do|that works|sounds good)[.!\s]*$/i
const ASSISTANT_CODE_CONFIRMATION = /\b(?:should i|would you like me to|want me to|shall i|ready for me to|can i proceed|may i proceed|if you want me to|say the word and i(?:'| wi)ll)\b.{0,180}\b(?:run|implement|build|edit|change|code|fix|update|create|write|apply|proceed)\b|\b(?:run|implement|build|edit|change|code|fix|update|create|write|apply)\b.{0,120}\b(?:want me to|should i|shall i|if you want)\b/i

/** Resolve a short confirmation only against the immediately preceding coding request and explicit assistant offer. */
function codingFollowupParts(currentRequest, turns) {
  const current = String(currentRequest ?? '').trim()
  if (!AFFIRMATIVE_CODE_FOLLOWUP.test(current) || !Array.isArray(turns) || !turns.length) return null
  const latest = turns.slice(-4)
  const userIndex = latest.map(turn => turn?.role).lastIndexOf('user')
  if (userIndex < 0) return null
  return { current, prior: latest[userIndex],
    assistant: latest.slice(userIndex + 1).filter(turn => turn?.role === 'nori').at(-1) }
}

export function isAiderFollowupContextIncomplete(currentRequest, turns = []) {
  if (isAiderCodeRequest(currentRequest)) return false
  const parts = codingFollowupParts(currentRequest, turns)
  if (!parts) return false
  const prior = codingActionText(parts.prior), assistant = codingActionText(parts.assistant)
  const codingHint = isAiderCodeRequest(parts.prior?.text?.slice(0, 1800)) || priorCodeGenerationRequest(parts.prior?.text?.slice(0, 1800))
  return Boolean(codingHint && (prior === null || parts.assistant && assistant === null || prior.length + parts.current.length + 120 > 20000))
}

/** A conversation confirmation requests preparation; Core still owns task approval. */
export function resolveAiderCodingRequest(currentRequest, turns = []) {
  if (isAiderCodeRequest(currentRequest)) return String(currentRequest).trim()
  const parts = codingFollowupParts(currentRequest, turns)
  if (!parts || isAiderFollowupContextIncomplete(currentRequest, turns)) return ''
  const priorRequest = codingActionText(parts.prior), assistant = codingActionText(parts.assistant)
  if (typeof priorRequest !== 'string' || !(isAiderCodeRequest(priorRequest) || priorCodeGenerationRequest(priorRequest))) return ''
  if (typeof assistant !== 'string' || !ASSISTANT_CODE_CONFIRMATION.test(assistant)) return ''
  const confirmation = isAiderCodeRequest(priorRequest)
    ? `User explicitly confirmed the pending coding task with: ${parts.current}`
    : `User requested local Aider code implementation by explicitly confirming: ${parts.current}`
  return `${priorRequest.trim()}\n\n${confirmation}`
}

export function isAiderCodeRequest(value) {
  const text = userCreativeRoutingText(value).trim()
  if (!text || text.length > 20_000 || PURE_QUESTION.test(text) || isAiderCapabilityQuestion(text)) return false
  // Skill names such as code-reviewer and execution-status questions are not
  // requests to edit code. Share the host's bounded, read-only catalog route;
  // compound catalog-plus-action requests must still pass normal coding gates.
  if (requestsInstalledSkillCatalog(text)) return false
  if (/\b(?:do\s+not|don't|dont|never|stop|cancel)\b.{0,60}\b(?:build|create|write|implement|fix|repair|improve|enhanc\w*|review|inspect|check|edit|modify|code|aider)\b/i.test(text)) return false
  if (requestsReadOnlyProjectReview(text)) return false
  if (READ_ONLY_CODE_REQUEST.test(text) && !CODE_MODIFICATION.test(text)) return false
  const explicitCoder = /\b(?:aider|source code|refactor|debug|bugfix|repository|(?:python|javascript|typescript|powershell|bash)\s+(?:script|code|function))\b/i.test(text)
  if (requestsNoriArtCraftOperation(text) && !explicitCoder && !APP_DEVELOPMENT.test(text)) return false
  const selfMaintenance = isSelfCodeRequest(text)
  // Preserve only a quoted source-path literal, never a quoted command, as the
  // object of an explicit edit verb. This is classification, not file authority.
  const fileIntent = userCreativeRoutingText(String(value ?? '').replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/(["'`])((?:[a-z]:[\\/])?[\w./\\-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx|c|cpp|h|cs|rs|go|java|rb|sh|ps1))\1/gi, '$2'))
  return selfMaintenance || SOURCE_FILE_EDIT.test(fileIntent) || CODE_ACTION.test(text) && (CODE_SUBJECT.test(text) || APP_DEVELOPMENT.test(text) || TOOL_DEVELOPMENT.test(text))
}

export function isAiderCapabilityQuestion(value) {
  const text=String(value??'').trim()
  return /^(?:who|what|which)\b.{0,60}\b(?:coder|coding|aider)\b/i.test(text)
    || /^(?:can|could)\s+you\s+(?:write\s+code|code|do\s+coding(?:\s+work)?)\s*[?!.]*$/i.test(text)
    || /^(?:do\s+you|does\s+nori)\s+(?:have|use|know)\b.{0,50}\b(?:aider|coder|coding worker|coding agent)\b/i.test(text)
    || /^(?:does|can)\s+(?:(?:your|the)\s+)?(?:local\s+)?(?:aider(?:\s+worker)?|coding\s+worker)\s+run\s+tests\s*[?!.]*$/i.test(text)
}

export async function aiderCapabilityAnswer(environment=process.env,suiteRoot=installationPaths(environment).noriRoot) {
  let runtime
  try { runtime = suiteAiderPaths(suiteRoot,environment) }
  catch { return 'My Aider worker is not ready: one or more bundled Python, Aider, Git, launcher, or local-configuration files are missing. I have not tried a system or online substitute.' }
  try {
    const { stdout } = await execFileAsync(runtime.python, ['-I', runtime.launcher, '--version'], {
      cwd: suiteRoot, windowsHide: true, timeout: 8_000, maxBuffer: 16 * 1024,
      env: { ...environment, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' },
    })
    const version = String(stdout).trim().match(/^run_aider\.py\s+(\d+\.\d+\.\d+)$/m)?.[1]
    if (!version) throw new Error('Aider did not return a recognized local version.')
    return aiderRuntimeCapabilitySummary(version)
  } catch {
    return 'My Aider files are present, but I could not start the bundled worker to verify it. I will not claim coding is available until its local runtime check passes.'
  }
}

export function aiderRuntimeCapabilitySummary(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new TypeError('A verified local Aider version is required.')
  }
  return `My bundled Aider worker starts locally (Aider ${version}). This version check does not verify the selected model, its readiness, or this chat’s coding connection. Coding requires an explicitly selected Git project and the applicable approval checks. A completed worker receipt can confirm changed files; Aider does not run tests or publish changes.`
}

function absoluteWorkspaceMention(value) {
  const text = String(value ?? '')
  if (text.length > 20_000) return null
  // Prefer a quoted Windows path so folder names containing spaces stay whole.
  const quoted = text.match(/["'`]([A-Za-z]:\\[^"'`\r\n]{2,512})["'`]/)
  const bare = quoted ? null : text.match(/\b([A-Za-z]:\\[^\s"'`<>|?*]{2,512})/)
  const raw = (quoted?.[1] ?? bare?.[1] ?? '').replace(/[),.;]+$/, '')
  return raw && isAbsolute(raw) ? raw : null
}

export function resolveAiderWorkspace(userRequest, environment = process.env) {
  const requested = absoluteWorkspaceMention(userRequest)
  const configured = typeof environment.NORI_AIDER_WORKSPACE_ROOT === 'string'
    ? environment.NORI_AIDER_WORKSPACE_ROOT.trim() : ''
  if (!requested && configured && isSelfCodeRequest(userCreativeRoutingText(userRequest))) {
    const ownWorkspace = environment.NORI_APP_DATA_ROOT ? selfCodeWorkspace(environment) : null
    if (!ownWorkspace || resolve(configured).toLowerCase() !== resolve(ownWorkspace).toLowerCase()) {
      throw new Error('This request changes Nori herself, but a different coding project is selected. Choose Nori’s self-development project first; I have not changed the selected project or edited files.')
    }
  }
  if (!requested && !configured) {
    if (!isSelfCodeRequest(userCreativeRoutingText(userRequest))) return null
    const suiteRoot=installationPaths(environment).noriRoot
    const runtime=suiteAiderPaths(suiteRoot,environment)
    return prepareSelfCodeWorkspace({suiteRoot,environment,gitExecutable:runtime.git})
  }
  if (requested && configured && resolve(requested).toLowerCase() !== resolve(configured).toLowerCase()) {
    throw new Error('The requested project folder differs from Nori’s selected coding workspace.')
  }
  const candidate = resolve(requested || configured)
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error('Nori could not find the explicitly selected project folder.')
  }
  const root = realpathSync(candidate)
  if (root === root.slice(0, 3) || root.split(/[\\/]/).some(part => part.toLowerCase() === 'windows')) {
    throw new Error('Nori cannot use a drive root or Windows system folder as a coding workspace.')
  }
  return root
}

function safeRelativeFile(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || value.includes('\0')) {
    throw new Error(`${label} must be a short repository-relative file path.`)
  }
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`${label} must stay inside the selected project and cannot be an absolute path.`)
  }
  return normalized
}

function scopeDirectiveText(value) {
  return String(value ?? '').replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, ' ')
    .replace(/"([^"\r\n]*)"|(?<![A-Za-z])'([^'\r\n]*)'(?![A-Za-z])|\x60([^\x60\r\n]*)\x60/g,
      (whole, double, single, tick) => /\s/.test(double ?? single ?? tick ?? '') ? ' ' : whole)
}

function explicitEditFiles(userRequest) {
  const text = scopeDirectiveText(userRequest)
  const expression = /(?:^|[.!?;\r\n])\s*(?:please\s+)?(?:only\s+(?:edit|modify|update|change)|(?:edit|modify|update|change)\s+only)\s+\x60?["']?([A-Za-z0-9_-]+(?:[/.][A-Za-z0-9_-]+)+)["']?\x60?(?=\s*(?:[.;\r\n]|$))/gi
  const files = [...new Set([...text.matchAll(expression)].map(match => safeRelativeFile(match[1], 'User-selected file')))]
  if (files.length > 1 || (!files.length && /\b(?:only\s+(?:edit|modify|update|change)|(?:edit|modify|update|change)\s+only)\b/i.test(text))) {
    throw new Error('The editable-file restriction is unclear or conflicting; no coding task was submitted.')
  }
  return files.length ? files : null
}

function explicitReadOnlyFiles(userRequest) {
  const text = scopeDirectiveText(userRequest)
  const expression = /(?:^|[.!?;\r\n])\s*(?:please\s+)?read\s+(.{1,1000}?)\s+(?:without\s+(?:changing|editing|modifying)\s+(?:them|it|the files)|(?:but\s+)?do not\s+(?:change|edit|modify)\s+(?:them|it|the files))(?=\s*(?:[.;\r\n]|$))/gi
  const matches = [...text.matchAll(expression)]
  if (!matches.length) return null
  const files = matches.flatMap(match => match[1].trim().replace(/,\s*$/, '').split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map(value => {
    const unquoted = value.trim().replace(/^[\x60"']|[\x60"']$/g, '')
    if (!/^[A-Za-z0-9_-]+(?:[/.][A-Za-z0-9_-]+)+$/.test(unquoted)) throw new Error('Name the read-only context files explicitly; no coding task was submitted.')
    return safeRelativeFile(unquoted, 'User-selected read-only file')
  }))
  const result = [...new Set(files)]
  if (!result.length || result.length > 24) throw new Error('A bounded read-only context list is required.')
  return result
}

function runChild(executable, args, { cwd, env, signal, timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = { stdout: [], stderr: [] }
    let sizes = { stdout: 0, stderr: 0 }
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const finish = (error, result) => {
      if (settled) return
      settled = true
      cleanup()
      error ? rejectPromise(error) : resolvePromise(result)
    }
    const capture = (name, chunk) => {
      const bytes = Buffer.from(chunk)
      const room = Math.max(0, MAX_CAPTURE_BYTES - sizes[name])
      if (room) chunks[name].push(bytes.subarray(0, room))
      sizes[name] += bytes.length
    }
    child.stdout.on('data', chunk => capture('stdout', chunk))
    child.stderr.on('data', chunk => capture('stderr', chunk))
    child.once('error', error => finish(error))
    child.once('close', (code, childSignal) => finish(null, {
      code: Number.isInteger(code) ? code : -1,
      signal: childSignal,
      stdout: Buffer.concat(chunks.stdout).toString('utf8'),
      stderr: Buffer.concat(chunks.stderr).toString('utf8'),
      truncated: sizes.stdout > MAX_CAPTURE_BYTES || sizes.stderr > MAX_CAPTURE_BYTES,
    }))
    const abort = () => {
      if (process.platform === 'win32' && child.pid && child.exitCode === null) {
        // Stop this exact owned controller and its Aider descendant together.
        execFile(join(environmentSystemRoot(env), 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false }, () => {})
      } else child.kill()
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, timeoutMs)
  })
}

function environmentSystemRoot(environment) {
  return environment?.SystemRoot || environment?.SYSTEMROOT || process.env.SystemRoot || 'C:\\Windows'
}

function suiteAiderPaths(suiteRoot, environment) {
  const python = environment.NORI_AIDER_PYTHON || environment.NORI_RUNTIME_PYTHON
    || join(suiteRoot, 'python', 'Python311', 'python.exe')
  const script = join(suiteRoot, 'nori', 'nori_aider.py')
  const launcher = join(suiteRoot, 'integrations', 'aider', 'run_aider.py')
  const config = join(suiteRoot, 'integrations', 'aider', 'aider-nori.conf.yml')
  const git = join(suiteRoot, 'integrations', 'aider', 'git', 'mingw64', 'bin', 'git.exe')
  const packages = join(suiteRoot, 'integrations', 'aider', '.venv', 'Lib', 'site-packages', 'aider', '__init__.py')
  if (![python, script, launcher, config, packages, git].every(existsSync)) {
    throw new Error('Nori’s packaged Aider worker is incomplete; no source tree, system Aider, or remote service was substituted.')
  }
  return { python, script, launcher, config, git }
}

function completionSummary(payload, model) {
  if (!payload || typeof payload !== 'object' || payload.outcome !== 'completed'
    || payload.worker !== 'aider-local' || !Array.isArray(payload.changed_files)
    || payload.changed_files.length === 0) {
    const detail = typeof payload?.detail === 'string' && payload.detail
      ? payload.detail : `Aider did not complete (${String(payload?.error_type || 'incomplete')}).`
    throw new Error(detail.slice(0, 512))
  }
  const changed = payload.changed_files.map(value => String(value).replaceAll('\\', '/')).slice(0, 24)
  return JSON.stringify({ outcome: 'completed', worker: 'aider-local', model: model.label,
    changed_files: changed, tests: 'not run by Aider', external_services: false,
    detail: 'The local worker returned a completed receipt. No tests or shell commands were run.' })
}

/** Pure owner-text scope metadata for the independent native admission check; no authority. */
export function ownerCodingFileScope(rawGoal) {
  const editableFiles = explicitEditFiles(rawGoal)
  const readOnlyFiles = explicitReadOnlyFiles(rawGoal)
  return { editableFiles: editableFiles === null ? null : [...editableFiles], readOnlyFiles: readOnlyFiles ? [...readOnlyFiles] : [] }
}

export function createNoriAiderTools({ userRequest, apiBase, environment = process.env,
  suiteRoot = installationPaths(environment).noriRoot, signal, codingOwnerBinding = null, onCodingAdmission = null } = {}) {
  if (!isAiderCodeRequest(userRequest)) throw new Error('Aider tools are available only for an explicit user-requested coding change.')
  if (typeof apiBase !== 'string') throw new TypeError('Nori’s local model endpoint is required.')
  const endpoint = new URL(apiBase)
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Aider is restricted to Nori’s local loopback model server.')
  }
  const workspaceRoot = resolveAiderWorkspace(userRequest, environment)
  if (!workspaceRoot) throw new Error('Tell Nori the full project folder before asking her to edit code.')
  const reader = createNoriProjectTools(workspaceRoot)
  const suite = resolve(suiteRoot)
  const runtime = suiteAiderPaths(suite, environment)
  const requestedFiles = explicitEditFiles(userRequest)
  const requestedContextFiles = explicitReadOnlyFiles(userRequest)
  if (requestedFiles && requestedContextFiles?.some(file => requestedFiles.some(edit => edit.toLowerCase() === file.toLowerCase()))) throw new Error('A file cannot be both editable and explicitly read-only.')
  // Bind dispatch and completion to one host-owned invocation, not later env state.
  const boundModel = Object.freeze({ ...localAiderModel(environment) })
  const validateCompletionReceipt = createAiderWorkerReceiptValidator(boundModel)
  const submitBackground = createBackgroundWorkerSubmission({ goal: userRequest, workspace: workspaceRoot, environment, signal, codingOwnerBinding, onCodingAdmission })
  // Reuse the readers' validation, with compact schemas for the 4K model slot.
  const readDefinitions = reader.definitions.filter(tool => ['list_dir', 'read_file'].includes(tool.function.name))
    .map(tool => ({ type: 'function', function: { name: tool.function.name,
      description: tool.function.name === 'list_dir' ? 'List the selected project directory.' : 'Read a bounded project text file.',
      parameters: { ...tool.function.parameters, properties: Object.fromEntries(
        Object.entries(tool.function.parameters.properties).map(([key, property]) => {
          const { description, ...contract } = property
          return [key, key === 'path' ? { ...contract, description: 'Project-relative path; use . for the root directory.' } : contract]
        })) } } }))
  return Object.freeze({
    aiderWorker: true,
    validateCompletionReceipt,
    workspaceRoot,
    definitions: Object.freeze(requestedFiles ? [{ ...AIDER_CODE_TASK, function: {
      ...AIDER_CODE_TASK.function, parameters: { ...AIDER_CODE_TASK.function.parameters,
        properties: { ...AIDER_CODE_TASK.function.parameters.properties,
          allowed_files: { type:'array', minItems:1, maxItems:1, items:{type:'string',enum:requestedFiles} },
          ...(requestedContextFiles ? { context_files: { type:'array', minItems:requestedContextFiles.length, maxItems:requestedContextFiles.length, uniqueItems:true, items:{type:'string',enum:requestedContextFiles}, description:'Owner-declared read-only context; never editable.' } } : {}) } } } }]
      : [...readDefinitions, AIDER_CODE_TASK]),
    async call(name, args, { maxBytes = 8192 } = {}) {
      if (name !== 'aider_code_task') return reader.call(name, args, { maxBytes })
      if (!args || typeof args !== 'object' || Array.isArray(args)
        || Object.keys(args).some(key => !['allowed_files', 'context_files'].includes(key))) {
        throw new Error('Aider accepts only an explicit editable-file list and optional read-only context files.')
      }
      if (!Array.isArray(args.allowed_files) || args.allowed_files.length < 1 || args.allowed_files.length > 24
        || (args.context_files !== undefined && (!Array.isArray(args.context_files) || args.context_files.length > 24))) {
        throw new Error('Aider needs 1–24 explicitly scoped edit files and at most 24 context files.')
      }
      const allowed = args.allowed_files.map(value => safeRelativeFile(value, 'Editable file'))
      if (requestedFiles && (allowed.length !== requestedFiles.length || allowed.some(file => !requestedFiles.includes(file)))) {
        throw new Error('Aider may edit only the exact file explicitly selected in the user request.')
      }
      const proposedContext = (args.context_files || []).map(value => safeRelativeFile(value, 'Context file'))
      if (requestedContextFiles && (allowed.some(file => requestedContextFiles.includes(file)) || proposedContext.some(file => !requestedContextFiles.includes(file)))) {
        throw new Error('Aider must preserve the owner-selected read-only files and cannot expand their scope.')
      }
      const context = requestedContextFiles ? [...requestedContextFiles] : proposedContext
      if (context.some(file => allowed.some(edit => edit.toLowerCase() === file.toLowerCase()))) throw new Error('Editable and read-only file scopes must be disjoint.')
      // A model proposal is never an owner approval. All coding attempts use
      // Core's existing exact-scope review/native-confirmation flow, regardless
      // of inherited background or owner-approved environment flags.
      return submitBackground(allowed, context)
    },
    close() { reader.close?.() },
  })
}
