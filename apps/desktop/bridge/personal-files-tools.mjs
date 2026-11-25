import os from 'node:os'
import { existsSync, realpathSync } from 'node:fs'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, sep } from 'node:path'

// Read-only access to the owner's own folders. Paths are always "<Folder>/<rest>"
// under one of the known user folders; links that leave those folders, hidden
// entries and credential-looking files are refused. Nothing is written.
const FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']
const TEXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.log',
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.h', '.cpp', '.cs', '.go', '.rs',
  '.rb', '.php', '.sh', '.ps1', '.bat', '.sql', '.srt', '.vtt', '.lua', '.gd', '.rtf'])
const SECRET = /(?:^|[\\/])(?:\.env(?:\..*)?|id_[a-z0-9]+|.*\.(?:pem|key|pfx|p12|kdbx|kdb|ppk|asc|gpg)|wallet\.dat|.*passw(?:or)?d.*|.*credential.*|.*secret.*|.*recovery[-_ ]?codes?.*)$/i
const SKIP = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'AppData', '__pycache__'])
const MAX_LIST = 80, MAX_MATCHES = 40, MAX_SCAN = 25000, MAX_DEPTH = 8, MAX_READ = 4000, MAX_FILE = 2 * 1024 ** 2
// Tool results travel in one bounded Neuralese cell (6000 chars); stay under it.
const RESULT_CHARS = 5200

function fitted(result, key) {
  const items = result[key]
  let shown = items.length
  while (shown > 0 && JSON.stringify({ ...result, [key]: items.slice(0, shown) }).length > RESULT_CHARS) shown--
  return shown === items.length ? result
    : { ...result, [key]: items.slice(0, shown), note: `Showing ${shown} of ${items.length}; ask for a narrower folder or search to see more.` }
}

export function personalFolders({ home = os.homedir(), environment = process.env } = {}) {
  const roots = new Map()
  for (const name of FOLDERS) {
    // OneDrive commonly redirects Desktop and Documents; prefer the copy that exists.
    for (const base of [environment.OneDrive, home].filter(Boolean)) {
      const candidate = join(base, name)
      if (!roots.has(name) && existsSync(candidate)) roots.set(name, realpathSync(candidate))
    }
  }
  return roots
}

const inside = (root, target) => {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
const friendly = (roots, absolute) => {
  for (const [name, root] of roots) if (inside(root, absolute)) return [name, ...relative(root, absolute).split(sep).filter(Boolean)].join('/')
  return null
}

async function resolveUserPath(roots, value) {
  const parts = String(value ?? '').replace(/\\/g, '/').split('/').map(part => part.trim()).filter(Boolean)
  const root = roots.get(FOLDERS.find(name => name.toLowerCase() === parts[0]?.toLowerCase()))
  if (!root) throw Error(`Start the path with one of: ${[...roots.keys()].join(', ')}`)
  if (parts.slice(1).some(part => part === '..' || part === '.' || part.startsWith('.') || /[:*?"<>|]/.test(part))) throw Error('That path is not allowed')
  const target = await realpath(join(root, ...parts.slice(1))).catch(() => { throw Error('Nothing exists at that path') })
  if (!inside(root, target)) throw Error('That path leads outside your personal folders')
  return target
}

function entryInfo(info, name, roots, absolute) {
  return { name, path: friendly(roots, absolute), type: info.isDirectory() ? 'folder' : 'file',
    ...(info.isDirectory() ? {} : { size_kb: Math.round(info.size / 102.4) / 10 }), modified: info.mtime.toISOString().slice(0, 16).replace('T', ' ') }
}

async function listFolder(roots, folder) {
  const target = folder ? await resolveUserPath(roots, folder) : null
  if (!target) return { folders: [...roots.keys()] }
  if (!(await stat(target)).isDirectory()) throw Error('That is a file, not a folder')
  const entries = []
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name) || entry.isSymbolicLink()) continue
    const absolute = join(target, entry.name)
    try { entries.push(entryInfo(await lstat(absolute), entry.name, roots, absolute)) } catch {}
  }
  entries.sort((a, b) => b.modified.localeCompare(a.modified))
  return fitted({ folder: friendly(roots, target), total: entries.length, newest_first: entries.slice(0, MAX_LIST) }, 'newest_first')
}

async function searchFiles(roots, query, folder) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length || words.join(' ').length > 120) throw Error('Give a short name or words to search for')
  const starts = folder ? [await resolveUserPath(roots, folder)] : [...roots.values()]
  const matches = [], queue = starts.map(path => [path, 0])
  let scanned = 0
  while (queue.length && scanned < MAX_SCAN && matches.length < MAX_MATCHES) {
    const [dir, depth] = queue.shift()
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (++scanned > MAX_SCAN || matches.length >= MAX_MATCHES) break
      if (entry.name.startsWith('.') || SKIP.has(entry.name) || entry.isSymbolicLink()) continue
      const absolute = join(dir, entry.name)
      if (words.every(word => entry.name.toLowerCase().includes(word))) {
        try { matches.push(entryInfo(await lstat(absolute), entry.name, roots, absolute)) } catch {}
      }
      if (entry.isDirectory() && depth < MAX_DEPTH) queue.push([absolute, depth + 1])
    }
  }
  matches.sort((a, b) => b.modified.localeCompare(a.modified))
  return fitted({ query: words.join(' '), matches, ...(scanned >= MAX_SCAN ? { note: 'Search stopped early; name a folder to search deeper.' } : {}) }, 'matches')
}

// A zip's central directory names its entries; nothing is extracted or run.
// ZIP64 and damaged archives report their size only.
async function zipListing(target, size, facts) {
  const unreadable = note => ({ ...facts, readable: false, note })
  if (size < 22) return unreadable('That zip file is empty or damaged.')
  const handle = await open(target, 'r')
  try {
    const tailSize = Math.min(size, 65557)
    const tail = Buffer.alloc(tailSize)
    await handle.read(tail, 0, tailSize, size - tailSize)
    let end = -1
    for (let index = tailSize - 22; index >= 0; index--) if (tail.readUInt32LE(index) === 0x06054b50) { end = index; break }
    if (end < 0) return unreadable('That zip file has no readable directory; it may be damaged.')
    const total = tail.readUInt16LE(end + 10), directorySize = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16)
    if (total === 0xffff || offset === 0xffffffff) return unreadable('That is a very large (ZIP64) archive; Nori cannot list it yet.')
    if (directorySize > 1024 ** 2 || offset + directorySize > size) return unreadable('That zip file\'s directory is too large or damaged to list.')
    const directory = Buffer.alloc(directorySize)
    await handle.read(directory, 0, directorySize, offset)
    const entries = []
    for (let at = 0; entries.length < MAX_LIST && at + 46 <= directorySize && directory.readUInt32LE(at) === 0x02014b50;) {
      const nameLength = directory.readUInt16LE(at + 28)
      const raw = directory.subarray(at + 46, at + 46 + nameLength)
      const name = raw.toString(directory.readUInt16LE(at + 8) & 0x800 ? 'utf8' : 'latin1').replace(/[\u0000-\u001f]/g, '').slice(0, 200)
      entries.push({ name, ...(name.endsWith('/') ? { type: 'folder' } : { size_kb: Math.round(directory.readUInt32LE(at + 24) / 102.4) / 10 }) })
      at += 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32)
    }
    return fitted({ ...facts, kind: 'zip archive', entries_total: total, entries,
      ...(total > entries.length ? { note: `Showing the first ${entries.length} of ${total} entries.` } : {}) }, 'entries')
  } finally { await handle.close() }
}

async function readFile(roots, file) {
  const target = await resolveUserPath(roots, file)
  const info = await stat(target)
  if (info.isDirectory()) throw Error('That is a folder; list it instead')
  if (SECRET.test(target)) throw Error('That looks like a password, key or credential file, so Nori does not read it')
  const ext = extname(target).toLowerCase()
  const facts = { file: friendly(roots, target), size_kb: Math.round(info.size / 102.4) / 10,
    modified: info.mtime.toISOString().slice(0, 16).replace('T', ' '), created: info.birthtime.toISOString().slice(0, 16).replace('T', ' ') }
  if (ext === '.zip') return zipListing(target, info.size, facts)
  if (!TEXT.has(ext)) return { ...facts, readable: false, note: `Nori can read plain-text files here; ${ext || 'this file type'} is not supported yet, so only its size and dates are known.` }
  if (info.size > MAX_FILE) throw Error('That file is too large to read here')
  const handle = await open(target, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(info.size, MAX_READ * 4))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const bytes = buffer.subarray(0, bytesRead)
    if (bytes.includes(0)) return { file: friendly(roots, target), readable: false, note: 'That file is binary, not text.' }
    const text = bytes.toString('utf8')
    return { file: friendly(roots, target), size_kb: Math.round(info.size / 102.4) / 10, content: text.slice(0, MAX_READ),
      ...(info.size > MAX_READ ? { truncated: true, note: 'Only the beginning of the file is shown.' } : {}) }
  } finally { await handle.close() }
}

export function createPersonalFilesTools({ roots = personalFolders() } = {}) {
  const folderNames = [...roots.keys()].join(', ')
  const path = description => ({ type: 'string', maxLength: 400, description })
  return {
    personalFilesWorker: true,
    definitions: [
      { type: 'function', function: { name: 'list_my_folder',
        description: `List what is in one of the owner's folders, newest first. Read-only. Folder paths start with one of: ${folderNames}. Example: "Downloads" or "Documents/School".`,
        parameters: { type: 'object', additionalProperties: false, required: ['folder'], properties: { folder: path('Folder path such as Downloads or Documents/Taxes') } } } },
      { type: 'function', function: { name: 'search_my_files',
        description: `Find files or folders by name across ${folderNames} (or inside one folder). Read-only; matches words in the name, not file contents.`,
        parameters: { type: 'object', additionalProperties: false, required: ['query'],
          properties: { query: { type: 'string', maxLength: 120 }, folder: path('Optional folder to search inside, such as Documents') } } } },
      { type: 'function', function: { name: 'read_my_file',
        description: 'Read the beginning of one plain-text file found with list_my_folder or search_my_files; for a .zip it lists the entries inside, and for other files it gives the size and dates. Read-only. Passwords, keys and credential files are refused.',
        parameters: { type: 'object', additionalProperties: false, required: ['file'], properties: { file: path('File path such as Documents/notes.txt') } } } },
    ],
    async call(name, args) {
      if (name === 'list_my_folder') return JSON.stringify(await listFolder(roots, args?.folder))
      if (name === 'search_my_files') return JSON.stringify(await searchFiles(roots, args?.query, args?.folder))
      if (name === 'read_my_file') return JSON.stringify(await readFile(roots, args?.file))
      throw Error('Unknown personal files tool')
    },
  }
}
