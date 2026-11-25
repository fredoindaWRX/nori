import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ENTRIES = new Set(['local-chat.mjs', 'project-tools.mjs'])
const MAX_ARCHIVE = 768 * 1024 * 1024
const MAX_ENTRY = 256 * 1024
const MAX_EXCERPT = 32 * 1024
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const equalPath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
function abort(signal) {
  if (signal?.aborted) { const error = new Error('Own-code acquisition cancelled'); error.name = 'AbortError'; throw error }
}
function inspect(api, file, directory = false) {
  const value = api.lstatSync(file)
  if (value.isSymbolicLink() || (directory ? !value.isDirectory() : !value.isFile())
      || !equalPath(api.realpathSync(file), file)) throw new Error('Own-code path identity refused')
  return { dev: value.dev, ino: value.ino, bytes: value.size, mtimeMs: value.mtimeMs,
    ctimeMs: value.ctimeMs, nlink: value.nlink }
}
function same(a, b) {
  return Object.keys(a).every(key => a[key] === b[key])
}
async function containerHash(originalFs, file, expectedBytes, signal) {
  abort(signal)
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of originalFs.createReadStream(file, { highWaterMark: 64 * 1024, signal })) {
    abort(signal)
    bytes += chunk.length
    if (bytes > expectedBytes || bytes > MAX_ARCHIVE) throw new Error('Own-code container exceeded its captured bound')
    hash.update(chunk)
  }
  abort(signal)
  if (bytes !== expectedBytes) throw new Error('Own-code container size changed')
  return hash.digest('hex')
}

// HOST ONLY: the caller passes its lexical import.meta.url, never model/user data.
// This provider is deliberately separate from general project reading and NORI_ROOT.
export function createActiveOwnCodeReader(hostModuleUrl) {
  const url = new URL(hostModuleUrl)
  if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) throw new Error('Own-code host URL refused')
  const hostFile = fileURLToPath(url)
  if (!/^[A-Za-z]:[\\/]$/.test(path.parse(hostFile).root)) throw new Error('Local drive host required')
  const root = path.dirname(hostFile)
  const container = path.dirname(root)
  if (path.basename(hostFile) !== 'local-chat.mjs' || path.basename(root) !== 'bridge'
      || path.basename(container) !== 'app.asar') throw new Error('Packaged local-chat host required')
  const originalFs = createRequire(import.meta.url)('original-fs')
  function refuseSidecar(entry) {
    let parent = container + '.unpacked'
    for (const directory of [parent, path.join(parent, 'bridge')]) {
      let metadata
      try { metadata = originalFs.lstatSync(directory) }
      catch (error) { if (error.code === 'ENOENT') return; throw error }
      if (!metadata.isDirectory() || metadata.isSymbolicLink()
          || !equalPath(originalFs.realpathSync(directory), directory)) {
        throw new Error('Own-code sidecar parent refused')
      }
    }
    try { originalFs.lstatSync(path.join(parent, 'bridge', entry)) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    throw new Error('Own-code unpacked sidecar refused')
  }
  return Object.freeze({
    async readBatch(requests, { signal } = {}) {
      abort(signal)
      if (!Array.isArray(requests) || requests.length < 1 || requests.length > 2) throw new Error('Own-code batch bound refused')
      const seen = new Set()
      const specs = requests.map(request => {
        if (!request || Object.keys(request).some(key => !['entry', 'startLine', 'maxLines'].includes(key))
            || !ENTRIES.has(request.entry) || seen.has(request.entry)
            || !Number.isInteger(request.startLine) || request.startLine < 1
            || !Number.isInteger(request.maxLines) || request.maxLines < 1 || request.maxLines > 90) {
          throw new Error('Own-code entry or line bound refused')
        }
        seen.add(request.entry)
        return { ...request }
      })
      for (const spec of specs) refuseSidecar(spec.entry)
      const before = inspect(originalFs, container)
      if (!Number.isSafeInteger(before.bytes) || before.bytes < 1 || before.bytes > MAX_ARCHIVE || before.nlink !== 1) {
        throw new Error('Own-code physical container bound refused')
      }
      inspect(fs, root, true)
      const beforeHash = await containerHash(originalFs, container, before.bytes, signal)
      if (!same(before, inspect(originalFs, container))) throw new Error('Own-code container changed before entry acquisition')
      const results = []
      for (const spec of specs) {
        abort(signal)
        const file = path.join(root, spec.entry)
        // Virtual ASAR inode/times are not physical file identity.
        // Authority is the before/after physical container identity and hash.
        const entryBefore = inspect(fs, file)
        if (!Number.isSafeInteger(entryBefore.bytes) || entryBefore.bytes < 1 || entryBefore.bytes > MAX_ENTRY) {
          throw new Error('Own-code entry size refused')
        }
        const bytes = fs.readFileSync(file)
        abort(signal)
        if (bytes.length !== entryBefore.bytes || bytes.length > MAX_ENTRY
            || entryBefore.bytes !== inspect(fs, file).bytes) throw new Error('Own-code virtual entry changed')
        const repeated = fs.readFileSync(file)
        abort(signal)
        if (repeated.length !== bytes.length || repeated.length > MAX_ENTRY
            || digest(repeated) !== digest(bytes) || entryBefore.bytes !== inspect(fs, file).bytes) {
          throw new Error('Own-code virtual entry content changed')
        }
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (text.includes('\0')) throw new Error('Own-code binary content refused')
        const lines = text.split(/\r?\n/)
        if (spec.startLine > lines.length) throw new Error('Own-code start line is past the file')
        const selected = []
        for (const line of lines.slice(spec.startLine - 1, spec.startLine - 1 + spec.maxLines)) {
          if (Buffer.byteLength([...selected, line].join('\n'), 'utf8') > MAX_EXCERPT) break
          selected.push(line)
        }
        if (!selected.length) throw new Error('Own-code excerpt exceeds its bound')
        const content = selected.join('\n')
        results.push({ path: `bridge/${spec.entry}`, start_line: spec.startLine,
          returned_lines: selected.length, content,
          omitted: spec.startLine > 1 || spec.startLine - 1 + selected.length < lines.length,
          entry_sha256: digest(bytes), entry_bytes: bytes.length, excerpt_sha256: digest(Buffer.from(content)) })
      }
      abort(signal)
      if (!same(before, inspect(originalFs, container))) throw new Error('Own-code physical container changed during acquisition')
      const afterHash = await containerHash(originalFs, container, before.bytes, signal)
      abort(signal)
      if (beforeHash !== afterHash || !same(before, inspect(originalFs, container))) {
        throw new Error('Own-code physical container changed during verification')
      }
      inspect(fs, root, true)
      for (const spec of specs) refuseSidecar(spec.entry)
      abort(signal)
      return { provider: 'nori.active-packaged-own-code.v1', host_module_url: url.href,
        root, container, container_sha256: beforeHash, container_bytes: before.bytes,
        container_identity: before, container_unchanged: true, release_attested: false, results }
    },
  })
}
