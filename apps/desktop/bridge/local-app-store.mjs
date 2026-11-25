import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const MAX_DRAFT_BYTES = 300 * 1024

function verifyDirectory(path) {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Local app storage contains a non-directory or reparse point.')
  const actual = realpathSync(path)
  const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value
  if (normalized(actual) !== normalized(path)) throw new Error('Local app storage path is redirected.')
}

function ensureDirectory(root, relativePath) {
  let current = root
  for (const part of relativePath.split(/[\\/]/)) {
    current = join(current, part)
    if (!existsSync(current)) {
      try { mkdirSync(current) } catch (error) { if (error?.code !== 'EEXIST') throw error }
    }
    verifyDirectory(current)
  }
  return current
}

export function createLocalAppDraftStore(noriRoot) {
  if (typeof noriRoot !== 'string' || !noriRoot) throw new TypeError('Nori root is required for local app drafts.')
  const root = resolve(noriRoot)
  verifyDirectory(root)
  const draftsRoot = ensureDirectory(root, 'workspace/generated-apps/drafts')

  return Object.freeze({
    save(frame, validation) {
      if (!frame || validation?.frame_sha256 !== frame.frame_sha256 || validation?.materialized !== false
        || validation?.execution_authorized !== false || validation?.external_effects !== false) {
        throw new TypeError('Only verified, unauthorized Neuralese app proposals may be saved as drafts.')
      }
      const file = join(draftsRoot, `draft-${frame.frame_sha256}.json`)
      const record = { schema: 'nori.local-app-draft.v1', status: 'pending_review',
        frame, validation, created_at: new Date().toISOString(),
        execution_authorized: false, external_effects: false }
      const content = `${JSON.stringify(record, null, 2)}\n`
      if (Buffer.byteLength(content, 'utf8') > MAX_DRAFT_BYTES) throw new RangeError('Local app draft exceeds its storage limit.')
      let descriptor
      try {
        descriptor = openSync(file, 'wx', 0o600)
        writeFileSync(descriptor, content, { encoding: 'utf8' })
        fsyncSync(descriptor)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        const existingStat = lstatSync(file)
        if (!existingStat.isFile() || existingStat.isSymbolicLink() || existingStat.nlink !== 1
          || existingStat.size > MAX_DRAFT_BYTES || realpathSync(file).toLowerCase() !== file.toLowerCase()) {
          throw new Error('An existing local app draft failed filesystem identity verification.')
        }
        let existing
        try { existing = JSON.parse(readFileSync(file, 'utf8')) } catch {
          throw new Error('An existing local app draft is malformed; it was not overwritten.')
        }
        if (existing?.schema !== record.schema || existing?.status !== 'pending_review'
          || existing?.frame?.frame_sha256 !== frame.frame_sha256
          || JSON.stringify(existing.frame) !== JSON.stringify(frame)
          || JSON.stringify(existing.validation) !== JSON.stringify(validation)
          || existing.execution_authorized !== false || existing.external_effects !== false) {
          throw new Error('An existing local app draft failed content verification; it was not overwritten.')
        }
      } finally { if (descriptor !== undefined) closeSync(descriptor) }
      const stat = lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file).toLowerCase() !== file.toLowerCase()) {
        throw new Error('Saved local app draft failed filesystem identity verification.')
      }
      return `workspace/generated-apps/drafts/draft-${frame.frame_sha256}.json`
    },
  })
}
