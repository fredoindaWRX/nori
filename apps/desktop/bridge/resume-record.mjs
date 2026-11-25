// Missing state is new state; unreadable state is a recovery problem, not empty.
import { lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
export const MAX_RESUME_BYTES = 262144
const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
const failed = () => new Error('Saved Nori conversation cannot be safely read. Its file was preserved; recovery is required.')

export function readResumeRecord(file) {
  let initial
  try { initial = lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw failed() }
  let handle
  try {
    const requested = resolve(file)
    if (!initial.isFile() || initial.isSymbolicLink() || initial.size < 1 || initial.size > MAX_RESUME_BYTES ||
        normalize(realpathSync(file)) !== normalize(requested)) throw failed()
    handle = openSync(file, 'r')
    const opened = fstatSync(handle)
    if (!opened.isFile() || opened.ino !== initial.ino || opened.dev !== initial.dev || opened.size !== initial.size) throw failed()
    const buffer = Buffer.alloc(MAX_RESUME_BYTES + 1)
    let length = 0, count
    while (length < buffer.length && (count = readSync(handle, buffer, length, buffer.length - length, null)) > 0) length += count
    const after = fstatSync(handle), current = lstatSync(file)
    if (length !== opened.size || length > MAX_RESUME_BYTES || after.size !== opened.size ||
        current.isSymbolicLink() || current.ino !== opened.ino || current.dev !== opened.dev ||
        normalize(realpathSync(file)) !== normalize(requested)) throw failed()
    // Replacement decoding can silently turn corrupt saved history into new
    // content. Invalid encoding is a recovery problem, not repaired memory.
    const record = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, length)))
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw failed()
    for (const field of ['session_id', 'model', 'effort']) {
      if (record[field] !== undefined && record[field] !== null && typeof record[field] !== 'string') throw failed()
    }
    if (record.history !== undefined && (!Array.isArray(record.history) || record.history.length > 128 ||
        record.history.some(turn => !turn || !['user', 'nori'].includes(turn.role) || typeof turn.text !== 'string'))) throw failed()
    if (record.personality !== undefined && (!record.personality || typeof record.personality !== 'object' || Array.isArray(record.personality))) throw failed()
    return record
  } catch { throw failed() }
  finally { if (handle !== undefined) closeSync(handle) }
}
