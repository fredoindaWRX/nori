import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { localEndpoint, localFetch } from './local-policy.mjs'
import { personalFolders } from './personal-files-tools.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const contained = (root, target) => {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export async function readPersonalWriteAccess({ environment = process.env, fetcher = localFetch, signal } = {}) {
  signal?.throwIfAborted()
  const token = environment.NORI_API_TOKEN
  if (typeof token !== 'string' || token.length < 32) return false
  const base = localEndpoint('NORI_COUNCIL_URL', environment.NORI_COUNCIL_URL, 'http://127.0.0.1:9107')
  try {
    const response = await fetcher(`${base}/work/system`, { method: 'GET',
      headers: { authorization: `Bearer ${token}`, origin: new URL(base).origin },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) })
    signal?.throwIfAborted()
    const result = await response.json()
    return response.ok && result?.enabled === true && result?.full_access_available === true
      && result?.full_access_enabled === true && result?.confirmation_floor_active === true
      && result?.per_task_confirmation_required === false
      && result?.full_access_backup?.verified === true
      && Number.isSafeInteger(result?.full_access_backup?.file_count)
      && result.full_access_backup.file_count >= 0
      && Number.isSafeInteger(result?.full_access_backup?.total_bytes)
      && result.full_access_backup.total_bytes >= 0
      && typeof result?.full_access_backup?.path === 'string'
  } catch {
    signal?.throwIfAborted()
    return false
  }
}

async function ensureSafeDirectories(directory) {
  const absolute = resolve(directory)
  const parsed = parse(absolute)
  if (!parsed.root || !isAbsolute(absolute)) throw Error('Backup location must be absolute')
  let current = parsed.root
  for (const part of absolute.slice(parsed.root.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    try { await mkdir(current) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink() || (info.fileAttributes & 0x400)) {
      throw Error('Linked or non-folder backup location refused')
    }
    if (resolve(await realpath(current)) !== current) throw Error('Backup path changed during validation')
  }
  return absolute
}

export async function backupPersonalFile(target, { environment = process.env } = {}) {
  if (typeof target !== 'string' || !isAbsolute(target)) throw Error('An exact local file is required for backup')
  const absoluteTarget = resolve(target)
  const roots = personalFolders()
  const personalRoot = [...roots.values()].find(root => contained(root, absoluteTarget))
  if (!personalRoot) throw Error('Backup target is outside the known personal folders')
  const relativeTarget = relative(personalRoot, absoluteTarget)
  let walked = personalRoot
  for (const part of relativeTarget.split(sep).filter(Boolean)) {
    walked = join(walked, part)
    const info = await lstat(walked)
    if (info.isSymbolicLink() || (info.fileAttributes & 0x400)) throw Error('Linked personal-file path refused')
  }
  const targetInfo = await lstat(absoluteTarget)
  if (!targetInfo.isFile() || targetInfo.isSymbolicLink() || (targetInfo.fileAttributes & 0x400)) {
    throw Error('Linked or non-file backup target refused')
  }
  const backupRoot = await ensureSafeDirectories(environment.NORI_FULL_ACCESS_BACKUP_ROOT
    || 'C:\\Nori\\backups\\nori-data\\file-edits')
  if (contained(absoluteTarget, backupRoot) || contained(backupRoot, absoluteTarget)) {
    throw Error('Personal-file backup cannot overlap the edited file path')
  }
  const beforeHandle = await open(absoluteTarget, fsConstants.O_RDONLY)
  let before, bytes
  try {
    before = await beforeHandle.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > 2 * 1024 ** 2) throw Error('Unsupported file for backup')
    bytes = await beforeHandle.readFile()
  } finally { await beforeHandle.close() }
  const targetSha256 = sha256(bytes)
  const suffix = createHash('sha256').update(absoluteTarget.toLowerCase()).digest('hex').slice(0, 16)
  const backupPath = join(backupRoot, `${Date.now()}-${suffix}-${randomUUID()}.bak`)
  const backupHandle = await open(backupPath, 'wx', 0o600)
  try { await backupHandle.writeFile(bytes); await backupHandle.sync() } finally { await backupHandle.close() }
  try {
    const copied = await readFile(backupPath)
    if (sha256(copied) !== targetSha256 || copied.length !== bytes.length) throw Error('Backup verification failed')
    const latestHandle = await open(absoluteTarget, fsConstants.O_RDONLY)
    try {
      const latest = await latestHandle.stat()
      const current = await latestHandle.readFile()
      if (latest.size !== before.size || latest.mtimeMs !== before.mtimeMs || latest.ino !== before.ino
        || sha256(current) !== targetSha256) throw Error('File changed while its backup was made')
    } finally { await latestHandle.close() }
  } catch (error) {
    // Keep the verified original if a race is detected; it is a recovery copy.
    throw error
  }
  return { verified: true, targetSha256, backupSha256: targetSha256, backupPath }
}

