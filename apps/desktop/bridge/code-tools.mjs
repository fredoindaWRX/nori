// Nori codes in her own chat loop (owner, 2026-11-24: "she should do the work in her text box like how you do it
// here... shouldnt need to accept a coding job"). These tools read, search, edit, create and run inside ONE project
// folder, step by step, with no approval prompt and no background job. Every call is shown live in her chat.
//
// What stays fixed without a prompt:
//   - every file path must resolve inside the project folder; links and junctions are not followed;
//   - .git internals, .env files and secret/credential-named files are neither read nor written;
//   - the first change to an existing file in a turn saves the original under coding-backups in her data folder;
//   - commands run in the project folder with a time limit; a short list of machine-level or outward commands
//     (formatting a disk, shutdown, registry deletes, git push, download-and-run) is refused and left to the owner.
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveAiderWorkspace } from './aider-tools.mjs'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_WRITE_CHARS = 200_000
const MAX_READ_LINES = 400
const SKIP_FOLDERS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.cache', '.next', 'target'])
const SECRET_NAME = /(?:^|[._-])(?:secret|secrets|credential|credentials|private_key|api_key|id_rsa)(?:[._-]|$)/i
const REFUSED_COMMANDS = [
  [/\bformat(?:-volume)?\b\s+(?:[a-z]:|-drive)/i, 'formatting a drive'],
  [/\b(?:diskpart|bcdedit|cipher\s+\/w)\b/i, 'disk or boot tools'],
  [/\b(?:shutdown|restart-computer|stop-computer)\b/i, 'shutting down or restarting the PC'],
  [/\breg(?:\.exe)?\s+delete\b|\bremove-item(?:property)?\b[^|;\n]*\bhk(?:lm|cu|cr):/i, 'deleting registry keys'],
  [/\bgit\b[^|;&\n]*\bpush\b/i, 'git push (publishing is the owner\'s step)'],
  [/\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b[^\n]*\|\s*(?:iex|invoke-expression|sh|bash|powershell|pwsh)\b/i, 'download-and-run'],
  [/\b(?:net|net1)(?:\.exe)?\s+(?:user|localgroup)\b|\bset-executionpolicy\b/i, 'changing Windows accounts or policy'],
  [/\b(?:rm|del|rd|rmdir|remove-item)\b[^|;&\n]*\s["']?(?:[a-z]:[\\/]?|[\\/]|~|\$env:userprofile|\$home|[a-z]:[\\/](?:windows|users|program files(?: \(x86\))?)[\\/]?)["']?(?:\s|$)/i,
    'deleting a drive, home or system folder'],
]

/** On unless NORI_INLINE_CODING=0. Off restores the reviewed background coding job. */
export function inlineCodingEnabled(environment = process.env) { return environment.NORI_INLINE_CODING !== '0' }

function workspaceMention(value) {
  const text = String(value ?? '')
  if (text.length > 20_000) return null
  const quoted = text.match(/["'`]([A-Za-z]:\\[^"'`\r\n]{2,512})["'`]/)
  const bare = quoted ? null : text.match(/\b([A-Za-z]:\\[^\s"'`<>|?*]{2,512})/)
  const raw = (quoted?.[1] ?? bare?.[1] ?? '').replace(/[),.;]+$/, '')
  return raw && isAbsolute(raw) ? raw : null
}

function checkedRoot(candidate) {
  let folder = resolve(candidate)
  // A named file means "the project that file is in": use its folder.
  if (existsSync(folder) && statSync(folder).isFile()) folder = dirname(folder)
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error('I could not find that project folder.')
  const root = realpathSync(folder)
  if (root === root.slice(0, 3) || /^[a-z]:\\(?:windows|program files(?: \(x86\))?)(?:\\|$)/i.test(root)) {
    throw new Error('A drive root or Windows system folder cannot be a coding project.')
  }
  return root
}

/** The folder this coding request works in: a path named in the request wins, then the selected project, then her own code. */
export function resolveCodeWorkspace(userRequest, environment = process.env) {
  const named = workspaceMention(userRequest)
  if (named) return checkedRoot(named)
  try { return resolveAiderWorkspace(userRequest, environment) } catch (error) {
    // Her own code while another project is selected: go to her own code, no switch step.
    if (!/different coding project/i.test(String(error?.message))) throw error
    return resolveAiderWorkspace(userRequest, { ...environment, NORI_AIDER_WORKSPACE_ROOT: '' })
  }
}

const fn = (name, description, properties, required) => Object.freeze({ type: 'function', function: Object.freeze({ name, description,
  parameters: Object.freeze({ type: 'object', additionalProperties: false, properties: Object.freeze(properties), required: Object.freeze(required) }) }) })

function definitionsFor(root) {
  const where = `the coding project ${root}`
  return Object.freeze([
    fn('code_list', `List the files and folders in one folder of ${where}.`,
      { folder: { type: 'string', description: 'Folder relative to the project root; use . for the root.' } }, ['folder']),
    fn('code_search', `Find a piece of text in the source files of ${where}. Returns file, line number and the line.`,
      { query: { type: 'string', minLength: 2, maxLength: 200, description: 'Plain text to find (not a regular expression); case does not matter.' },
        folder: { type: 'string', description: 'Optional folder to search in, relative to the project root.' } }, ['query']),
    fn('code_read', `Read a text file in ${where}. Read a file before you edit it.`,
      { file: { type: 'string', description: 'File path relative to the project root.' },
        start_line: { type: 'integer', minimum: 1, maximum: 10000000 },
        max_lines: { type: 'integer', minimum: 1, maximum: MAX_READ_LINES } }, ['file']),
    fn('code_edit', `Change part of an existing file in ${where} by replacing exact text. old_text must be copied exactly from the file (whitespace included) and must match once, unless replace_all is true.`,
      { file: { type: 'string', description: 'File path relative to the project root.' },
        old_text: { type: 'string', minLength: 1, maxLength: 20000 }, new_text: { type: 'string', maxLength: 20000 },
        replace_all: { type: 'boolean' } }, ['file', 'old_text', 'new_text']),
    fn('code_write', `Create a new file, or replace a whole file, in ${where}. content is the complete file. Prefer code_edit for a small change to an existing file.`,
      { file: { type: 'string', description: 'File path relative to the project root.' },
        content: { type: 'string', maxLength: MAX_WRITE_CHARS } }, ['file', 'content']),
    fn('code_run', `Run one PowerShell command in ${where}: tests, a build, a script, git status or git diff. Returns the exit code and the end of the output.`,
      { command: { type: 'string', minLength: 1, maxLength: 2000 },
        timeout_seconds: { type: 'integer', minimum: 5, maximum: 600 } }, ['command']),
  ])
}

export function refusedCommand(command) {
  return REFUSED_COMMANDS.find(([pattern]) => pattern.test(command))?.[1] ?? null
}

/**
 * root: verified project folder. backupRoot: where first-change originals are saved (null = no backups).
 * runner: test seam for code_run.
 */
export function createNoriCodeTools({ root, signal = null,
  backupRoot = process.env.NORI_APP_DATA_ROOT ? join(process.env.NORI_APP_DATA_ROOT, 'coding-backups') : null, now = () => new Date(), runner = runPowerShell } = {}) {
  root = checkedRoot(root)
  const definitions = definitionsFor(root)
  const backedUp = new Map()
  const changed = new Set()
  const stamp = now().toISOString().replace(/[:.]/g, '-')

  function locate(value, { mustExist = true, kind = 'file' } = {}) {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024 || value.includes('\0')) throw new Error('Give a file path inside the project.')
    const target = isAbsolute(value) ? resolve(value) : resolve(root, value)
    const delta = relative(root, target)
    if (delta.startsWith('..') || isAbsolute(delta)) throw new Error(`That path is outside the project folder ${root}; nothing was touched.`)
    const parts = delta ? delta.split(sep) : []
    if (parts.some(part => part.toLowerCase() === '.git')) throw new Error('Git\'s own folder is not edited directly; use code_run with a git command.')
    const base = (parts.at(-1) || '').toLowerCase()
    if (kind === 'file' && (base === '.env' || base.startsWith('.env.') || SECRET_NAME.test(base))) throw new Error('Secret and credential files are not read or written.')
    let current = root
    for (const part of parts) {
      current = join(current, part)
      let info
      try { info = lstatSync(current) } catch { break }
      if (info.isSymbolicLink()) throw new Error('Links and junctions inside the project are not followed.')
    }
    if (mustExist) {
      let info
      try { info = statSync(target) } catch { throw new Error(`${delta || '.'} does not exist in the project.`) }
      if (kind === 'file' && !info.isFile()) throw new Error(`${delta} is not a file.`)
      if (kind === 'folder' && !info.isDirectory()) throw new Error(`${delta || '.'} is not a folder.`)
      if (realpathSync(target).toLowerCase() !== target.toLowerCase()) throw new Error('That path resolves somewhere else; nothing was touched.')
    }
    return { target, name: delta.split(sep).join('/') || '.' }
  }

  function text(target, name) {
    const info = statSync(target)
    if (info.size > MAX_FILE_BYTES) throw new Error(`${name} is larger than 1 MB; it is not opened here.`)
    const bytes = readFileSync(target)
    if (bytes.includes(0)) throw new Error(`${name} is a binary file.`)
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error(`${name} is not UTF-8 text.`) }
  }

  function fit(value, maxBytes, trim) {
    let out = JSON.stringify(value)
    for (let guard = 0; Buffer.byteLength(out, 'utf8') > maxBytes && guard < 60; guard++) { trim(value); out = JSON.stringify(value) }
    if (Buffer.byteLength(out, 'utf8') > maxBytes) throw new Error('The result does not fit; ask for a smaller part.')
    return out
  }

  function backup(target, name) {
    if (!backupRoot || backedUp.has(name) || !existsSync(target)) return backedUp.get(name) ?? null
    const copy = join(backupRoot, stamp, ...name.split('/'))
    mkdirSync(dirname(copy), { recursive: true })
    copyFileSync(target, copy)
    backedUp.set(name, copy)
    return copy
  }

  function list(args, maxBytes) {
    const { target, name } = locate(args.folder ?? '.', { kind: 'folder' })
    const entries = readdirSync(target, { withFileTypes: true }).filter(entry => !entry.isSymbolicLink() && entry.name.toLowerCase() !== '.git')
      .map(entry => entry.isDirectory() ? `${entry.name}/` : entry.name).sort((a, b) => a.localeCompare(b))
    const value = { folder: name, entries: entries.slice(0, 200), more: Math.max(0, entries.length - 200) }
    return fit(value, maxBytes, v => { const drop = Math.ceil(v.entries.length / 4); v.more += drop; v.entries.length -= drop })
  }

  function search(args, maxBytes) {
    const needle = String(args.query).toLowerCase()
    const start = locate(args.folder ?? '.', { kind: 'folder' })
    const matches = []
    let files = 0, truncated = false
    const walk = folder => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (matches.length >= 40 || files >= 4000) { truncated = true; return }
        if (entry.isSymbolicLink()) continue
        const full = join(folder, entry.name)
        if (entry.isDirectory()) { if (!SKIP_FOLDERS.has(entry.name.toLowerCase())) walk(full); continue }
        if (!entry.isFile() || SECRET_NAME.test(entry.name) || /^\.env(?:\.|$)/i.test(entry.name)) continue
        let info
        try { info = statSync(full) } catch { continue }
        if (info.size > MAX_FILE_BYTES) continue
        files++
        let body
        try { const bytes = readFileSync(full); if (bytes.includes(0)) continue; body = bytes.toString('utf8') } catch { continue }
        if (!body.toLowerCase().includes(needle)) continue
        const lines = body.split(/\r?\n/)
        for (let index = 0; index < lines.length && matches.length < 40; index++) {
          if (lines[index].toLowerCase().includes(needle)) matches.push({ file: relative(root, full).split(sep).join('/'), line: index + 1, text: lines[index].trim().slice(0, 200) })
        }
      }
    }
    walk(start.target)
    const value = { query: args.query, matches, truncated }
    return fit(value, maxBytes, v => { v.matches.length = Math.floor(v.matches.length * 0.7); v.truncated = true })
  }

  function read(args, maxBytes) {
    const { target, name } = locate(args.file)
    const lines = text(target, name).split(/\r?\n/)
    const first = args.start_line ?? 1
    const count = args.max_lines ?? 200
    const picked = lines.slice(first - 1, first - 1 + count)
    const value = { file: name, start_line: first, total_lines: lines.length, content: picked.join('\n'), more_below: first - 1 + picked.length < lines.length }
    return fit(value, maxBytes, v => { const kept = v.content.split('\n'); kept.length = Math.max(1, Math.floor(kept.length * 0.7)); v.content = kept.join('\n'); v.more_below = true })
  }

  function save(target, name, body, action) {
    const copy = backup(target, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body, 'utf8')
    changed.add(name)
    return JSON.stringify({ ok: true, action, file: name, bytes: Buffer.byteLength(body, 'utf8'), lines: body.split('\n').length, ...(copy ? { original_saved_at: copy } : {}) })
  }

  function edit(args) {
    const { target, name } = locate(args.file)
    const body = text(target, name)
    const windows = body.includes('\r\n')
    const shape = value => windows ? String(value).replace(/\r?\n/g, '\r\n') : String(value).replace(/\r\n/g, '\n')
    const from = shape(args.old_text), to = shape(args.new_text)
    if (from === to) throw new Error('old_text and new_text are the same; nothing to change.')
    const hits = body.split(from).length - 1
    if (!hits) throw new Error(`old_text was not found in ${name}. Read the file again and copy the exact text, spaces included.`)
    if (hits > 1 && args.replace_all !== true) throw new Error(`old_text appears ${hits} times in ${name}. Include more surrounding text so it matches once, or set replace_all.`)
    return save(target, name, body.split(from).join(to), hits > 1 ? `replaced ${hits} places` : 'edited')
  }

  function write(args) {
    const { target, name } = locate(args.file, { mustExist: false })
    if (typeof args.content !== 'string' || args.content.length > MAX_WRITE_CHARS || args.content.includes('\0')) throw new Error('content must be text of at most 200,000 characters.')
    const existed = existsSync(target)
    if (existed && !statSync(target).isFile()) throw new Error(`${name} is a folder.`)
    // Keep an existing file's Windows line endings when the new text arrives with plain ones.
    const body = existed && text(target, name).includes('\r\n') ? args.content.replace(/\r?\n/g, '\r\n') : args.content
    return save(target, name, body, existed ? 'replaced' : 'created')
  }

  async function run(args, maxBytes) {
    const command = String(args.command).trim()
    const refused = refusedCommand(command)
    if (refused) throw new Error(`Not run: ${refused} is left to the owner. Tell him the exact command instead.`)
    const seconds = args.timeout_seconds ?? 120
    const outcome = await runner({ command, cwd: root, timeoutMs: seconds * 1000, signal })
    const value = { command, exit_code: outcome.code, timed_out: outcome.timedOut === true, output: outcome.output.slice(-6000) }
    return fit(value, maxBytes, v => { v.output = v.output.slice(Math.ceil(v.output.length * 0.3)) })
  }

  return Object.freeze({
    definitions, root, codeWorker: true,
    changedFiles: () => [...changed],
    async call(name, args, { maxBytes = 8192 } = {}) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.')
      if (name === 'code_list') return list(args, maxBytes)
      if (name === 'code_search') return search(args, maxBytes)
      if (name === 'code_read') return read(args, maxBytes)
      if (name === 'code_edit') return edit(args)
      if (name === 'code_write') return write(args)
      if (name === 'code_run') return run(args, maxBytes)
      throw new Error('No such coding tool.')
    },
  })
}

function runPowerShell({ command, cwd, timeoutMs, signal }) {
  return new Promise((done, fail) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', timedOut = false, settled = false
    const take = chunk => { output = (output + chunk.toString('utf8')).slice(-64_000) }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const stop = () => { try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* already gone */ } }
    const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    const aborted = () => stop()
    signal?.addEventListener('abort', aborted, { once: true })
    const finish = code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      if (signal?.aborted) fail(signal.reason ?? new Error('Stopped.'))
      else done({ code: timedOut ? null : code, timedOut, output: output.replace(/\r\n/g, '\n') })
    }
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); fail(error) } })
    child.on('close', finish)
  })
}
