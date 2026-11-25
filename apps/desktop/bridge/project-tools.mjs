import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import { verifiedSkillCatalogStatus } from './skill-catalog-status.mjs'

const MAX_READ_BYTES = 1024 * 1024
// The GPT-OSS bridge still enforces the smaller live-context-derived limit on
// every call. This is only the absolute per-result ceiling for higher-context
// profiles and for a single result that has sufficient remaining room.
const MAX_RESULT_BYTES = 8192
const MAX_ENTRIES = 100
const MAX_LINES = 120
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.cu', '.cuh', '.csv', '.cjs', '.h', '.hpp', '.html', '.ini',
  '.java', '.js', '.json', '.jsonl', '.md', '.mjs', '.ps1', '.py', '.rs', '.sh', '.sql',
  '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
])
const DENIED_PARTS = new Set([
  '.git', '.cache', '__pycache__', 'build', 'dist', 'node_modules', 'models', 'release', 'releases',
])
const EDITABLE_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log',
  '.py', '.js', '.ts', '.tsx', '.html', '.css', '.sql',
])
const GPT_OSS_PROJECT_TOOLS = Object.freeze([
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'list_skill_catalog',
      description: 'List Nori skills: verified installed instruction skills from her skill registry (source installed) and bundled suite skill artifacts under skills/ (source bundled). installedTotal is the verified installed count, or null when unknown; entries may be truncated and are not the total. Copy names exactly. Read-only; bundled artifacts are not installed skills and no skill is implied executable.',
      parameters: Object.freeze({
        type: 'object', additionalProperties: false,
        properties: Object.freeze({ path: Object.freeze({ type: 'string', enum: Object.freeze(['skills']), description: 'Must be the literal Nori project path skills.' }) }),
        required: Object.freeze(['path']),
      }),
    }),
  }),
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'list_dir',
      description: 'List ordinary file and directory names inside the Nori project folder. Read-only; hidden/runtime/model/build folders are excluded.',
      parameters: Object.freeze({
        type: 'object', additionalProperties: false,
        properties: Object.freeze({ path: Object.freeze({ type: 'string', description: 'Project-relative directory path; use . for the project root.' }) }),
        required: Object.freeze(['path']),
      }),
    }),
  }),
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'read_file',
      description: 'Read a bounded excerpt of a UTF-8 text/source file inside the Nori project folder. Read-only; no binary, model, secret, or generated build files.',
      parameters: Object.freeze({
        type: 'object', additionalProperties: false,
        properties: Object.freeze({
          path: Object.freeze({ type: 'string', description: 'Project-relative file path.' }),
          start_line: Object.freeze({ type: 'integer', minimum: 1, maximum: 10000000 }),
          max_lines: Object.freeze({ type: 'integer', minimum: 1, maximum: MAX_LINES }),
        }),
        required: Object.freeze(['path']),
      }),
    }),
  }),
])

function saveEditedCopyDefinition() {
  return Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'save_edited_copy',
      description: 'Save a user-requested edited copy of the currently attached text/code file. Creates a new file only in Nori’s user-edits/ folder; never overwrites the original or any existing output and accepts no paths.',
      parameters: Object.freeze({
        type: 'object', additionalProperties: false,
        properties: Object.freeze({
          filename: Object.freeze({ type: 'string', minLength: 1, maxLength: 120, description: 'A plain filename with one supported text/code extension; no folders or path.' }),
          content: Object.freeze({ type: 'string', minLength: 1, maxLength: 12000, description: 'The complete edited copy content.' }),
        }),
        required: Object.freeze(['filename', 'content']),
      }),
    }),
  })
}

function denyPart(part) {
  const lower = part.toLowerCase()
  return DENIED_PARTS.has(lower) || lower === '.env' || lower.startsWith('.env.')
    || /(?:^|[._-])(?:secret|credential|credentials|private_key|api_key)(?:[._-]|$)/i.test(part)
}

function boundedRelativePath(root, value, { allowRoot = false } = {}) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\0') || value.includes(':')) {
    throw new Error('A bounded Nori project-relative path is required.')
  }
  if (isAbsolute(value) || win32.isAbsolute(value) || value.startsWith('/') || value.startsWith('\\')) {
    throw new Error('Absolute paths are outside this Nori project tool.')
  }
  const normalized = value.replace(/\\/g, '/')
  const parts = normalized === '.' && allowRoot ? [] : normalized.split('/')
  if (!parts.length && !allowRoot) throw new Error('The Nori project root is not a file.')
  if (parts.some(part => !part || part === '.' || part === '..' || denyPart(part))) {
    throw new Error('That path is not available through the bounded Nori project reader.')
  }
  const target = resolve(root, ...parts)
  const delta = relative(root, target)
  if (delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta)) {
    throw new Error('Path escaped the Nori project root.')
  }
  return { target, parts, relativePath: parts.join('/') || '.' }
}

function inspectPath(root, value, expectedKind, { allowRoot = false } = {}) {
  const { target, parts, relativePath } = boundedRelativePath(root, value, { allowRoot })
  let current = root
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index])
    let stat
    try { stat = lstatSync(current) } catch { throw new Error('That Nori project path does not exist.') }
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error('Reparse points and multiply-linked files are not followed.')
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('A parent path component is not a directory.')
  }
  let finalStat
  try { finalStat = lstatSync(target) } catch { throw new Error('That Nori project path does not exist.') }
  if (finalStat.isSymbolicLink() || (finalStat.isFile() && finalStat.nlink > 1)) throw new Error('Reparse points and multiply-linked files are not followed.')
  if (expectedKind === 'file' && !finalStat.isFile()) throw new Error('The requested Nori project path is not a regular file.')
  if (expectedKind === 'directory' && !finalStat.isDirectory()) throw new Error('The requested Nori project path is not a directory.')
  const actual = realpathSync(target)
  if (actual.toLowerCase() !== target.toLowerCase()) throw new Error('The resolved path differs from the requested Nori project path.')
  return { target, relativePath, stat: finalStat }
}

function encoded(value) {
  return JSON.stringify(value)
}

function sameFileIdentity(left, right) {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

function capEntries(path, entries, maxBytes) {
  const safe = entries
    .filter(entry => !entry.isSymbolicLink() && !denyPart(entry.name))
    .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' }))
    .filter(entry => entry.kind !== 'other')
    .sort((left, right) => left.name.localeCompare(right.name))
  const result = []
  let truncated = safe.length > MAX_ENTRIES
  for (const entry of safe.slice(0, MAX_ENTRIES)) {
    const next = { path, entries: [...result, entry], truncated }
    if (Buffer.byteLength(encoded(next), 'utf8') > maxBytes) { truncated = true; break }
    result.push(entry)
  }
  return encoded({ path, entries: result, truncated })
}

function skillCatalog(root, maxBytes, skillStore) {
  // Installed skills come from the same registry the skill installer writes and chat loads.
  const installed = verifiedSkillCatalogStatus(skillStore)
  const rows = installed.skills.map(skill => ({ name: skill.name, description: skill.description.slice(0, 300),
    version: skill.version, source: 'installed', classification: 'installed_instruction_skill',
    sourceKind: skill.sourceKind, verified: true, codeExecutionEnabled: false }))
  let checked = null
  try { checked = inspectPath(root, 'skills', 'directory') } catch (error) {
    if (installed.status !== 'verified') throw error
  }
  const maxScannedDirectories = 512
  let scanned = 0
  let truncated = false
  const artifacts = new Set(['skill.md', 'skill.json', 'skill.py'])
  const walk = (directory, relativePath, depth) => {
    if (depth > 6 || scanned >= maxScannedDirectories || rows.length >= MAX_ENTRIES) {
      truncated = true
      return
    }
    scanned++
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) }
    catch { return }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink() || denyPart(entry.name)) continue
      const itemPath = `${relativePath}/${entry.name}`
      if (entry.isDirectory()) {
        walk(resolve(directory, entry.name), itemPath, depth + 1)
        if (rows.length >= MAX_ENTRIES || scanned >= maxScannedDirectories) { truncated = true; return }
      } else if (entry.isFile() && artifacts.has(entry.name.toLowerCase())) {
        const area = relativePath.split('/')[1] ?? 'nori_owned'
        const classification = area === 'incoming' ? 'incoming_reference'
          : area === 'quarantine' ? 'quarantined' : 'local_candidate_artifact'
        rows.push({ path: itemPath, source: 'bundled', classification, activation: 'not_asserted' })
        if (rows.length >= MAX_ENTRIES) { truncated = true; return }
      }
    }
  }
  if (checked) walk(checked.target, 'skills', 1)
  const output = { root: 'skills', installed: installed.status,
    installedTotal: installed.status === 'verified' ? installed.skills.length : null,
    bundled: checked ? 'listed' : 'unavailable', entries: [], truncated }
  for (const row of rows) {
    const next = { ...output, entries: [...output.entries, row] }
    if (Buffer.byteLength(encoded(next), 'utf8') > maxBytes) { output.truncated = true; break }
    output.entries.push(row)
  }
  return encoded(output)
}

export function createNoriProjectTools(projectRoot, { maxResultBytes = MAX_RESULT_BYTES, attachmentWriteEnabled = false,
  skillStore = process.env.NORI_SKILL_STORE } = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot) throw new TypeError('Nori project root is required')
  if (!Number.isSafeInteger(maxResultBytes) || maxResultBytes < 256 || maxResultBytes > MAX_RESULT_BYTES) {
    throw new RangeError(`maxResultBytes must be 256..${MAX_RESULT_BYTES}`)
  }
  const root = realpathSync(projectRoot)
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Nori project root is not a verified directory')
  if (typeof attachmentWriteEnabled !== 'boolean') throw new TypeError('attachmentWriteEnabled must be boolean')
  const definitions = attachmentWriteEnabled
    ? Object.freeze([...GPT_OSS_PROJECT_TOOLS, saveEditedCopyDefinition()])
    : GPT_OSS_PROJECT_TOOLS

  function listDir(args, maxBytes) {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => key !== 'path')) {
      throw new Error('list_dir accepts only a project-relative path.')
    }
    const checked = inspectPath(root, args.path, 'directory', { allowRoot: args.path === '.' })
    return capEntries(checked.relativePath, readdirSync(checked.target, { withFileTypes: true }), maxBytes)
  }

  function listSkillCatalog(args, maxBytes) {
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).length !== 1 || args.path !== 'skills') {
      throw new Error('list_skill_catalog accepts only the literal skills path.')
    }
    return skillCatalog(root, maxBytes, skillStore)
  }

  function readFile(args, maxBytes) {
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).some(key => !['path', 'start_line', 'max_lines'].includes(key))) {
      throw new Error('read_file accepts only path, start_line, and max_lines.')
    }
    const startLine = args.start_line === undefined ? 1 : args.start_line
    const maxLines = args.max_lines === undefined ? 60 : args.max_lines
    if (!Number.isSafeInteger(startLine) || startLine < 1 || startLine > 10_000_000
      || !Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > MAX_LINES) {
      throw new Error(`Use start_line 1..10000000 and max_lines 1..${MAX_LINES}.`)
    }
    const checked = inspectPath(root, args.path, 'file')
    const extension = extname(args.path).toLowerCase()
    const basename = args.path.split(/[\\/]/).at(-1).toLowerCase()
    if (!TEXT_EXTENSIONS.has(extension) || basename === '.env' || basename.startsWith('.env.')
      || /(?:^|[._-])(?:secret|credential|credentials|private_key|api_key)(?:[._-]|$)/i.test(basename)) {
      throw new Error('This reader supports ordinary text/source files, not secret or binary files.')
    }
    if (checked.stat.size > MAX_READ_BYTES) throw new Error('File exceeds the 1 MiB source-read limit.')
    const fd = openSync(checked.target, 'r')
    let bytes
    try {
      const opened = fstatSync(fd)
      if (!sameFileIdentity(checked.stat, opened) || opened.nlink > 1) {
        throw new Error('The file changed or gained a link after path validation; it was not read.')
      }
      const currentPath = lstatSync(checked.target)
      if (currentPath.isSymbolicLink() || !sameFileIdentity(opened, currentPath)) {
        throw new Error('The project file path changed during validation; it was not read.')
      }
      bytes = readFileSync(fd)
    } finally { closeSync(fd) }
    if (bytes.includes(0)) throw new Error('Binary content is not returned by the Nori project reader.')
    let text
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { throw new Error('File is not valid UTF-8 text.') }
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    const start = startLine - 1
    const selected = lines.slice(start, start + maxLines)
    let content = selected.join('\n')
    let omitted = start + selected.length < lines.length
    while (Buffer.byteLength(encoded({ path: checked.relativePath, start_line: startLine,
      returned_lines: Math.min(selected.length, maxLines), content, omitted }), 'utf8') > maxBytes) {
      if (selected.length > 1) { selected.pop(); content = selected.join('\n'); omitted = true }
      else {
        const available = Math.max(0, maxBytes - 128)
        const chars = [...content]
        while (chars.length && Buffer.byteLength(encoded({ path: checked.relativePath, start_line: startLine,
          returned_lines: Math.min(selected.length, maxLines), content: chars.join(''), omitted: true }), 'utf8') > available) chars.pop()
        content = chars.join('')
        omitted = true
        break
      }
    }
    return encoded({ path: checked.relativePath, start_line: startLine,
      returned_lines: Math.min(selected.length, maxLines), content, omitted })
  }

  function saveEditedCopy(args, maxBytes) {
    if (!attachmentWriteEnabled) throw new Error('Saving edited copies is not enabled for this request.')
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).length !== 2 || typeof args.filename !== 'string' || typeof args.content !== 'string') {
      throw new Error('save_edited_copy accepts only filename and content.')
    }
    const filename = args.filename
    if (filename.length > 120 || filename !== filename.trim() || /[\\/:*?"<>|\0]/.test(filename)
      || filename === '.' || filename === '..' || filename.startsWith('.') || filename.includes('..')) {
      throw new Error('Use a plain filename without folders, hidden names, or path characters.')
    }
    const extension = extname(filename).toLowerCase()
    if (!EDITABLE_EXTENSIONS.has(extension) || filename.slice(0, -extension.length).trim() === '') {
      throw new Error('This save path supports text/code files only; PDF and Office editing is not enabled.')
    }
    if (!args.content.length || args.content.length > 12000 || args.content.includes('\0')) {
      throw new Error('Edited copy must contain 1..12000 non-binary text characters.')
    }
    const destination = resolve(root, 'user-edits')
    try { mkdirSync(destination) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const dirStat = lstatSync(destination)
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || realpathSync(destination).toLowerCase() !== destination.toLowerCase()) {
      throw new Error('Nori user-edits output folder is not a verified local directory.')
    }
    const target = resolve(destination, filename)
    if (relative(destination, target).startsWith(`..${sep}`) || isAbsolute(relative(destination, target))) {
      throw new Error('Edited copy filename escaped Nori user-edits/.')
    }
    const bytes = Buffer.from(args.content, 'utf8')
    if (bytes.length > 48000) throw new Error('Edited copy exceeds the 48 KB output cap.')
    const parsed = JSON.stringify({ saved: true, path: `user-edits/${filename}`, bytes: bytes.length, original_overwritten: false })
    if (Buffer.byteLength(parsed, 'utf8') > maxBytes) throw new Error('Save receipt exceeds the available local result budget.')
    try { writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('That output name already exists. Choose a new filename; the existing file was not changed.')
      throw error
    }
    return parsed
  }

  return Object.freeze({
    definitions,
    writableAttachment: attachmentWriteEnabled,
    async call(name, args, { maxBytes = maxResultBytes } = {}) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > maxResultBytes) {
        throw new RangeError(`tool result limit must be 256..${maxResultBytes}`)
      }
      if (name === 'list_dir') return listDir(args, maxBytes)
      if (name === 'list_skill_catalog') return listSkillCatalog(args, maxBytes)
      if (name === 'read_file') return readFile(args, maxBytes)
      if (name === 'save_edited_copy' && attachmentWriteEnabled) return saveEditedCopy(args, maxBytes)
      throw new Error('This Nori project reader has no such registered tool.')
    },
  })
}
