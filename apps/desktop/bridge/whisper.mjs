/**
 * Local speech-to-text via an owned warm Whisper or pinned Parakeet worker.
 *
 * The browser already records a whole utterance (its VAD trims the silence) and
 * POSTs the audio to /stt. A local Python process answers it, spawned once with
 * the cached model loaded and kept warm,
 * fed one audio file at a time over stdin. Warm is the whole point — reloading
 * the model per turn is what makes local Whisper feel slow.
 *
 * It degrades to nothing: if Python or faster-whisper is missing the worker
 * cannot report ready, /health advertises no local STT. There is no cloud
 * fallback. Failed requests are surfaced to the caller.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PARAKEET = process.env.NORI_STT_BACKEND === 'parakeet'
const ROOT = process.env.NORI_ROOT || join(HERE, '..', '..', '..')
// Electron can read its virtual ASAR filesystem; the owned Python process cannot.
// Packaged workers are promoted to the physical suite alongside the archive.
export function sttWorkerScript(moduleDirectory,suiteRoot,parakeet){
  const name=parakeet?'parakeet_stt.py':'whisper_stt.py'
  return /(?:^|[\\/])[^\\/]+\.asar(?:[\\/]|$)/i.test(moduleDirectory)
    ?join(suiteRoot,'apps','desktop','bridge',name):join(moduleDirectory,name)
}
const WORKER = sttWorkerScript(HERE,ROOT,PARAKEET)
const LOCAL_LAUNCHER = join(ROOT, 'runtime', 'stt', 'launch_worker.py')

/** Resolve the Python that actually has faster-whisper installed. Explicit,
 *  because the bridge is spawned by npm and must not inherit a guess. */
function resolvePython() {
  if (PARAKEET) {
    const python = process.env.NORI_PARAKEET_PYTHON
    return python && existsSync(python) ? python : null
  }
  const override = process.env.NORI_PYTHON
  if (override) return override
  const local = join(ROOT, 'python', 'Python311', 'python.exe')
  return existsSync(local) && existsSync(LOCAL_LAUNCHER) ? local : null
}

let proc = null
let ready = false
let unavailable = false
let state = 'idle'
let errorCode = null
/** Serialises requests: the worker handles one clip at a time, in order. */
let chain = Promise.resolve()
/** Resolver for the single in-flight transcription, keyed by nothing because
 *  the chain guarantees one at a time. */
let pending = null
let stdoutBuf = ''

/** True once the model is loaded and the worker can transcribe. */
export function whisperReady() {
  return ready
}

/** True when we know local STT can never come up (no Python / no package). */
export function whisperUnavailable() {
  return unavailable
}

// Expose only bounded state categories to Nori's local health view; worker
// stderr and paths may contain host details and are intentionally not returned.
export function whisperStatus() {
  return { state: ready ? 'ready' : unavailable ? 'unavailable' : state,
    errorCode: typeof errorCode === 'string' ? errorCode : null }
}

/** Stop only this module's owned worker; reject outstanding recordings. */
export async function stopWhisper() {
  const worker = proc
  proc = null
  ready = false
  unavailable = false // Explicit stop permits a subsequent clean startup attempt.
  state = 'stopped'
  errorCode = null
  const request = pending
  pending = null
  request?.reject(new Error('local STT stopped'))
  if (!worker || worker.exitCode !== null && worker.exitCode !== undefined) return
  const exited = new Promise(resolveExit => worker.once('exit', resolveExit))
  worker.stdin.end()
  let timer
  const graceful = await Promise.race([exited.then(()=>true),new Promise(resolveWait=>{
    timer=setTimeout(()=>resolveWait(false),5000)
  })])
  clearTimeout(timer)
  if (!graceful) {
    worker.kill()
    let forcedTimer
    const stopped=await Promise.race([exited.then(()=>true),new Promise(resolveWait=>{
      forcedTimer=setTimeout(()=>resolveWait(false),2000)
    })])
    clearTimeout(forcedTimer)
    if(!stopped)throw new Error('Owned STT worker did not stop')
  }
}

/**
 * Start the worker if it is not already running. Safe to call more than once.
 * The worker uses an already cached model; startup is bounded.
 */
export function startWhisper() {
  if (proc || unavailable) return
  const python = resolvePython()
  if (!existsSync(WORKER)) {
    unavailable = true
    state = 'unavailable'
    errorCode = 'worker_file_missing'
    return
  }
  if (!python) {
    unavailable = true
    state = 'unavailable'
    errorCode = 'python_or_launcher_missing'
    console.warn(PARAKEET ? '[nori] local STT unavailable: owned Parakeet interpreter is missing'
      : '[nori] local STT unavailable: faster-whisper is not installed; run npm run setup:voice')
    return
  }

  const args = PARAKEET ? ['-I', '-B', '-u', WORKER]
    : process.env.NORI_PYTHON ? ['-u', '-B', WORKER] : ['-I', '-B', '-u', LOCAL_LAUNCHER]
  const worker = spawn(python, args, {
    // Explicit env, plus an unbuffered stdio so lines arrive promptly.
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  proc = worker
  state = 'starting'
  errorCode = null
  const startupTimer = setTimeout(() => {
    if (proc !== worker || ready) return
    unavailable = true
    state = 'unavailable'
    errorCode = 'worker_startup_timeout'
    worker.kill()
  }, 90_000)
  startupTimer.unref?.()
  worker.on('error', () => {
    if (proc !== worker) return
    clearTimeout(startupTimer)
    proc = null
    ready = false
    unavailable = true
    state = 'unavailable'
    errorCode = 'worker_spawn_failed'
    const request = pending
    pending = null
    request?.reject(new Error('local STT worker could not start'))
  })
  worker.stdin.on('error', () => {
    if (proc !== worker) return
    ready = false
    unavailable = true
    state = 'unavailable'
    errorCode = 'worker_stdin_failed'
    const request = pending
    pending = null
    request?.reject(new Error('local STT worker input failed'))
    worker.kill()
  })

  proc.stdout.on('data', (d) => {
    if (proc !== worker) return
    stdoutBuf += d.toString()
    let nl
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim()
      stdoutBuf = stdoutBuf.slice(nl + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.ready) {
        clearTimeout(startupTimer)
        ready = true
        state = 'ready'
        errorCode = null
        console.log(`[nori] local STT ready (faster-whisper ${msg.model ?? ''})`)
        continue
      }
      // Otherwise it is a transcription result or a per-clip error.
      if (pending) {
        const p = pending
        pending = null
        if (typeof msg.text === 'string') p.resolve(msg.text)
        else p.reject(new Error(msg.error || 'transcription failed'))
      } else if (msg.error && !ready) {
        // A startup error (bad import / model load) before ready: give up.
        unavailable = true
        state = 'unavailable'
        errorCode = 'worker_startup_failed'
        clearTimeout(startupTimer)
        worker.kill()
        console.warn(`[nori] local STT unavailable: ${msg.error}`)
      }
    }
  })

  proc.stderr.on('data', (d) => {
    const s = d.toString().trim()
    if (s && process.env.NORI_DEBUG === '1') console.log('[whisper]', s)
  })

  proc.on('exit', (code) => {
    if (proc !== worker) return
    clearTimeout(startupTimer)
    console.warn(`[nori] local STT worker exited (${code}); local transcription is off until restart`)
    proc = null
    ready = false
    if (!unavailable) state = 'exited'
    if (pending) {
      pending.reject(new Error('whisper worker exited'))
      pending = null
    }
  })
}

/**
 * Transcribe one audio buffer. Resolves to the text (possibly empty). Rejects
 * only on a real failure; the caller decides how to surface that. Requests are
 * serialised so the single worker is never asked to do two at once.
 *
 * @param {Buffer} buffer
 * @param {string} contentType  the MediaRecorder mime, used only to pick an ext
 * @returns {Promise<string>}
 */
export function whisperTranscribe(buffer, contentType) {
  if (!ready || !proc) return Promise.reject(new Error('local STT not ready'))

  const run = () =>
    new Promise((resolve, reject) => {
      if (!ready || !proc) return reject(new Error('local STT not ready'))
      const ext = contentType?.includes('ogg')
        ? 'ogg'
        : contentType?.includes('wav')
          ? 'wav'
          : contentType?.includes('mp4') || contentType?.includes('mpeg')
            ? 'mp4'
            : 'webm'
      let file
      let dir
      try {
        dir = mkdtempSync(join(tmpdir(), 'nori-stt-'))
        file = join(dir, `clip.${ext}`)
        writeFileSync(file, buffer)
      } catch (err) {
        if (dir) rmSync(dir, { recursive: true, force: true })
        return reject(err)
      }
      const request = {}
      // Guard against a wedged worker: never hang the turn forever.
      const timer = setTimeout(() => {
        if (pending === request) {
          pending = null
          ready = false
          unavailable = true
          proc?.kill()
          request.reject(new Error('local STT timed out'))
        }
      }, 30_000)
      const done = (fn) => (v) => {
        clearTimeout(timer)
        rmSync(dir, { recursive: true, force: true })
        fn(v)
      }
      request.resolve = done(resolve)
      request.reject = done(reject)
      pending = request
      try {
        proc.stdin.write(file + '\n')
      } catch (err) {
        pending = null
        request.reject(err)
      }
    })

  // Append to the chain so calls run one after another; return this call's result.
  const result = chain.then(run, run)
  chain = result.then(
    () => {},
    () => {},
  )
  return result
}
