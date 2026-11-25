/** Explicit offline recovery copy; never changes USB or differing local files. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifiedCopy } from './verified-copy.mjs'

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const usb = 'F:/release/suite-payload/NoriSuite'
const runtime = join(root, 'runtime', 'voice')
const weights = join(root, 'models', 'voice', 'kokoro-v1')
const hash = path => {
  const result = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), descriptor = openSync(path, 'r')
  try { let count; while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) result.update(buffer.subarray(0, count)) }
  finally { closeSync(descriptor) }
  return result.digest('hex')
}
const excluded = new Set(['__pycache__', 'site-packages', '.git'])

export function contained(rootPath, path) {
  const offset = relative(rootPath, path)
  return !!offset && !offset.startsWith('..') && !isAbsolute(offset)
}
export function safeDestination(rootPath, path) {
  if (!contained(rootPath, path)) throw new Error('Voice destination escapes product root')
  const parts = relative(rootPath, path).split(/[\\/]/)
  let current = rootPath
  for (const part of parts) {
    current = join(current, part)
    if (!existsSync(current)) continue
    if (lstatSync(current).isSymbolicLink() || !contained(rootPath, realpathSync(current)))
      throw new Error('Voice destination traverses a link or escapes root')
  }
}
export function refuseDifferentFile(source, destination) {
  if (existsSync(destination) && (!lstatSync(destination).isFile() || hash(destination) !== hash(source)))
    throw new Error(`Preserving differing existing voice file: ${destination}`)
}

function collect(source, target, files) {
  if (lstatSync(source).isSymbolicLink()) throw new Error('Recovery source link refused')
  if (lstatSync(source).isDirectory()) {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (excluded.has(entry.name) || /\.(pyc|pyo|whl|pth)$/i.test(entry.name)) continue
      collect(join(source, entry.name), join(target, entry.name), files)
    }
  } else if (lstatSync(source).isFile()) {
    files.push({ source, destination: target, bytes: lstatSync(source).size })
  } else throw new Error('Recovery source is not regular')
}

export function plan() {
  const files = []
  const base = join(usb, 'python', 'Python310')
  for (const name of ['python.exe', 'python3.dll', 'python310.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt', 'DLLs', 'Lib'])
    collect(join(base, name), join(runtime, 'python310', name), files)
  collect(join(usb, 'data', 'voice-runtime', 'Lib', 'site-packages'), join(runtime, 'packages'), files)
  collect(join(usb, 'data', 'voice-models', 'kokoro-v1'), weights, files)
  const provenance = JSON.parse(readFileSync(join(usb, 'data', 'voice-models', 'kokoro-v1', 'provenance.json')))
  if (provenance.files.length !== 2) throw new Error('Unexpected Kokoro provenance')
  const known = { 'kokoro-v1.0.onnx': 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a',
    'voices-v1.0.bin': 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d' }
  for (const file of provenance.files) {
    if (known[file.file] !== file.sha256 || hash(join(usb, 'data', 'voice-models', 'kokoro-v1', file.file)) !== file.sha256)
      throw new Error('Kokoro model provenance verification failed')
  }
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0)
  if (files.length > 10000 || bytes > 1024 ** 3) throw new Error('Voice copy exceeds bounded recovery scope')
  for (const file of files) { safeDestination(root, file.destination); refuseDifferentFile(file.source, file.destination) }
  return { files, bytes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported')
  const work = plan(), apply = process.argv.includes('--apply')
  const entries = []
  if (apply) for (const file of work.files) {
    safeDestination(root, file.destination); refuseDifferentFile(file.source, file.destination)
    const result = verifiedCopy(file.source, file.destination)
    entries.push({ path: relative(root, file.destination), bytes: file.bytes, sha256: hash(file.destination), result })
  }
  const result = { applied: apply, fileCount: work.files.length, bytes: work.bytes,
    usbModified: false, excludesBytecodeWheelsAndPthHooks: true, entries }
  let receipt
  if (apply) {
    receipt = join(root, 'verification', 'voice-probes', `tts-copy-${randomUUID()}.json`)
    safeDestination(root, receipt)
    mkdirSync(join(root, 'verification', 'voice-probes'), { recursive: true })
    writeFileSync(receipt, JSON.stringify(result, null, 2), { flag: 'wx' })
  }
  console.log(JSON.stringify({ ...result, entries: undefined, receipt, receiptSha256: receipt ? hash(receipt) : undefined }))
}
