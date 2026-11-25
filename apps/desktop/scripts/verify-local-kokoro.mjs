/** Actual canonical TTS protocol probe. Synthetic clips only; no playback/mic. */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import voicePaths from '../desktop/voice-paths.cjs'
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

export function wavDetails(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.length > 1440044
      || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE'
      || audio.toString('ascii', 12, 16) !== 'fmt ' || audio.readUInt32LE(16) !== 16
      || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1
      || audio.readUInt32LE(24) !== 24000 || audio.readUInt32LE(28) !== 48000
      || audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16
      || audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(4) + 8 !== audio.length)
    throw new Error('Invalid local speech WAV')
  const bytes = audio.readUInt32LE(40)
  if (bytes < 4800 || bytes % 2 || bytes + 44 !== audio.length) throw new Error('Invalid local speech sample count')
  let energy = 0
  for (let offset = 44; offset < audio.length; offset += 2) energy += audio.readInt16LE(offset) ** 2
  const rms = Math.sqrt(energy / (bytes / 2))
  if (rms < 1) throw new Error('Silent local speech')
  return { durationSeconds: bytes / 48000, rms, rate: 24000, channels: 1, bits: 16 }
}

export async function verifyLocalKokoro({suiteRoot = root, evidenceRoot = resolve(root, 'verification', 'voice-probes')} = {}) {
  const paths = voicePaths.localVoicePaths(suiteRoot, {})
  const start = Date.now(), child = spawn(paths.python, paths.args, {
    cwd: suiteRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
  })
  let diagnostics = '', pending, timer
  child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-1000) })
  const lines = createInterface({ input: child.stdout })
  const wait = () => new Promise((resolveMessage, reject) => {
    pending = { resolve: resolveMessage, reject }
    timer = setTimeout(() => { pending = null; reject(new Error('Local speech probe deadline')) }, 30000)
  })
  const fail = error => { clearTimeout(timer); pending?.reject(error); pending = null }
  child.on('error', fail); child.stdin.on('error', fail)
  child.on('exit', code => fail(new Error(`Local speech worker exited${code}`)))
  lines.on('line', line => {
    if (line.length > 2100000) return fail(new Error('Local speech record exceeds bound'))
    try { const message = JSON.parse(line); clearTimeout(timer); pending?.resolve(message); pending = null }
    catch { fail(new Error('Malformed local speech protocol')) }
  })
  let exit
  try {
    const ready = await wait()
    if (ready.ready !== true) throw new Error('Canonical speech worker did not become ready')
    const startupMs = Date.now() - start
    const ask = (id, text) => { const reply = wait(); child.stdin.write(JSON.stringify({ id, text }) + '\n'); return reply }
    const first = await ask('local-first', 'Nori is ready to help.')
    if (first.id !== 'local-first' || first.error || typeof first.audio !== 'string') throw new Error('First local synthesis failed')
    const rejected = await ask('local-invalid', '')
    if (rejected.id !== 'local-invalid' || rejected.error !== 'ValueError') throw new Error('Invalid speech input was not refused')
    const second = await ask('local-second', 'I am speaking from the local Nori folder.')
    if (second.id !== 'local-second' || second.error || typeof second.audio !== 'string') throw new Error('Speech worker did not survive input refusal')
    const directory = resolve(evidenceRoot)
    await mkdir(directory, { recursive: true })
    const clips = []
    for (const result of [first, second]) {
      const audio = Buffer.from(result.audio, 'base64'), details = wavDetails(audio)
      const output = resolve(directory, `local-kokoro-${randomUUID()}.wav`)
      await writeFile(output, audio, { flag: 'wx' })
      clips.push({ output, ...details })
    }
    child.stdin.end()
    exit = await Promise.race([new Promise(resolveExit => child.once('exit', code => resolveExit(code))),
      new Promise((_, reject) => { const deadline = setTimeout(() => reject(new Error('Speech EOF cleanup timed out')), 5000); deadline.unref() })])
    if (exit !== 0) throw new Error('Speech worker failed orderly exit')
    return { passed: true, workerPid: child.pid, startupMs, elapsedMs: Date.now() - start,
      sameWorkerReused: true, invalidInputRefused: true, workerExit: exit, clips,
      python: paths.python, sourceWorker: paths.worker, model: paths.model,
      microphoneUsed: false, playbackUsed: false, usbUsedAtRuntime: false,
      limitations: ['No physical desktop,installed setup,STT,wake word or viseme acceptance yet.'] }
  } catch (error) { throw new Error(`${error.message}; diagnostics: ${diagnostics}`) }
  finally {
    clearTimeout(timer); lines.close()
    if (child.pid && child.exitCode === null) {
      child.kill()
      await new Promise(resolveExit => child.once('exit', resolveExit))
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyLocalKokoro()))
}
