import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { link, lstat, open, readFile, realpath, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

const MAX_CLIPS = 65_536
const MAX_JOB_BYTES = 16 * 1024 * 1024
const MAX_LINE_BYTES = 64 * 1024
const IDLE_TIMEOUT_MS = 120_000
const PYTHON_RELATIVE = ['integrations', 'image-generation', 'runtime', 'ComfyUI_windows_portable', 'python_embeded', 'python.exe']
const PROFILES = Object.freeze([
  Object.freeze({ fps: 16, width: 832, height: 480, shotFrames: 33 }),
  Object.freeze({ fps: 24, width: 704, height: 1280, shotFrames: 121 }),
])

function inside(root, candidate) {
  const part = relative(root, candidate)
  return Boolean(part) && part !== '..' && !part.startsWith(`..\\`) && !part.startsWith('../') && !isAbsolute(part)
}

function absoluteLocal(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 32_767 || /[\0\r\n]/.test(value)) {
    throw new TypeError(`${label} must be an absolute local path.`)
  }
  // Do not admit UNC/device paths or alternate data streams into a media decoder.
  if (/^(?:\\\\|\/\/)/.test(value) || value.slice(2).includes(':')) throw new Error(`${label} must be a local filesystem path.`)
  return resolve(value)
}

function abortError() {
  const error = new Error('Local video assembly was cancelled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) { if (signal?.aborted) throw abortError() }

async function pythonRuntime(override) {
  const candidates = override !== undefined
    ? [absoluteLocal(override, 'Test Python runtime')]
    : [process.env.NORI_SUITE_ROOT, process.env.NORI_ROOT]
      .filter(value => typeof value === 'string' && value.length)
      .map(value => join(absoluteLocal(value, 'Nori suite root'), ...PYTHON_RELATIVE))
  for (const candidate of candidates) {
    if (basename(candidate).toLowerCase() !== 'python.exe') continue
    try {
      const info = await lstat(candidate)
      if (info.isFile() && !info.isSymbolicLink()) return candidate
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error }
  }
  throw new Error('Local video assembly runtime is unavailable: no bundled image-runtime Python was found under NORI_SUITE_ROOT or NORI_ROOT.')
}

async function exists(path) {
  try { await lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

function sameFile(left, right) { return left.dev === right.dev && left.ino === right.ino && !right.isSymbolicLink() }

async function removeOwned(path, identity) {
  try {
    const current = await lstat(path, { bigint: true })
    if (sameFile(identity, current)) await unlink(path)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}

function runHelper(python, source, job, signal, onProgress) {
  return new Promise((resolveRun, rejectRun) => {
    let child, timer, stoppedError, result, pending = '', stderr = ''
    const stop = error => {
      stoppedError ??= error
      child?.kill() // Only this CPU assembly child; never a shared ComfyUI worker.
    }
    const onAbort = () => stop(abortError())
    const heartbeat = () => {
      clearTimeout(timer)
      timer = setTimeout(() => stop(new Error('Local video assembly stopped making progress.')), IDLE_TIMEOUT_MS)
      timer.unref?.()
    }
    try {
      throwIfAborted(signal)
      child = spawn(python, ['-I', '-B', '-c', source], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) { rejectRun(error); return }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    heartbeat()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      pending += chunk
      let index
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1)
        if (Buffer.byteLength(line) > MAX_LINE_BYTES) { stop(new Error('Invalid assembly helper output.')); return }
        if (!line.trim()) continue
        try {
          const message = JSON.parse(line)
          if (message.type === 'progress' && ['assembling', 'verifying'].includes(message.stage)
            && Number.isSafeInteger(message.frames) && message.frames >= 0 && message.frames <= job.totalFrames
            && message.totalFrames === job.totalFrames) {
            heartbeat()
            onProgress?.(Object.freeze({ stage: message.stage, frames: message.frames, totalFrames: job.totalFrames }))
          } else if (message.type === 'result' && !result) {
            result = message
          } else throw new Error('Unexpected assembly helper output.')
        } catch (error) { stop(error); return }
      }
      if (Buffer.byteLength(pending) > MAX_LINE_BYTES) stop(new Error('Invalid assembly helper output.'))
    })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-MAX_LINE_BYTES) })
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error) })
    child.once('error', error => { stoppedError ??= error })
    child.once('close', code => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (stoppedError || signal?.aborted) { rejectRun(stoppedError ?? abortError()); return }
      if (code !== 0 || !result || pending.trim()) {
        rejectRun(new Error(`Local video assembly failed: ${stderr.trim().slice(-2000) || `helper exit ${code}`}`)); return
      }
      resolveRun(result)
    })
    child.stdin.end(JSON.stringify(job))
  })
}

/** Probe the exact bundled CPU encoder before spending GPU time on any shots. */
export async function verifyLocalVideoAssembly({ outputRoot, pythonPath, signal } = {}) {
  throwIfAborted(signal)
  if (outputRoot !== undefined) absoluteLocal(outputRoot, 'Nori video output root')
  const python = await pythonRuntime(pythonPath)
  const source = `import json, av
from fractions import Fraction
encoder = av.CodecContext.create("libx264", "w")
encoder.width, encoder.height = 832, 480
encoder.pix_fmt = "yuv420p"
encoder.time_base = Fraction(1, 16)
encoder.framerate = Fraction(16)
encoder.thread_count = 1
encoder.options = {"preset": "veryfast", "tune": "zerolatency"}
encoder.open()
print(json.dumps({"type": "result", "pyavVersion": av.__version__, "encoder": "libx264"}), flush=True)
`
  const result = await runHelper(python, source, {}, signal)
  if (result.encoder !== 'libx264' || typeof result.pyavVersion !== 'string') throw new Error('Bundled video encoder did not pass preflight.')
  return Object.freeze({ pythonPath: python, pyavVersion: result.pyavVersion, encoder: result.encoder })
}

/** Join newly generated shots from the fixed legacy or cinematic profile. No replay or padding. */
export async function assembleLocalVideo({ clips, outputPath, totalFrames, fps = 16, width = 832, height = 480,
  signal, onProgress, outputRoot, pythonPath } = {}) {
  throwIfAborted(signal)
  const profile=PROFILES.find(p=>p.fps===fps&&p.width===width&&p.height===height)
  if(!profile)throw new Error('Video assembly requires a qualified profile: 832x480 at 16 fps or 704x1280 at 24 fps.')
  if (!Array.isArray(clips) || clips.length < 1 || clips.length > MAX_CLIPS
    || !Number.isSafeInteger(totalFrames) || totalFrames < 1 || Math.ceil(totalFrames / profile.shotFrames) !== clips.length) {
    throw new TypeError(`Video assembly requires a bounded clip list with exactly ceil(totalFrames / ${profile.shotFrames}) newly generated shots.`)
  }
  const configuredRoot = outputRoot ?? (process.env.NORI_APP_DATA_ROOT && join(process.env.NORI_APP_DATA_ROOT, 'image-runtime', 'output'))
  const lexicalRoot = absoluteLocal(configuredRoot, 'Nori video output root')
  const destination = absoluteLocal(outputPath, 'Video output')
  const requestedClips = clips.map(value => absoluteLocal(value, 'Video clip'))
  // Complete lexical checks before any filesystem access or process launch.
  for (const candidate of [...requestedClips, destination]) {
    if (!inside(lexicalRoot, candidate) || extname(candidate).toLowerCase() !== '.mp4') throw new Error('Video assembly paths must remain inside Nori’s local output folder and end in .mp4.')
  }
  if (Buffer.byteLength(JSON.stringify({ clips: requestedClips, outputPath: destination })) > MAX_JOB_BYTES - 4096) throw new Error('Video assembly clip manifest exceeds the 16 MiB local job limit.')
  const root = await realpath(lexicalRoot)
  const parent = await realpath(dirname(destination))
  if (parent !== root && !inside(root, parent)) throw new Error('Video output directory escapes Nori’s local output folder.')
  const output = join(parent, basename(destination))
  if (await exists(output)) throw new Error('Video output already exists; assembly will not overwrite it.')
  const sources = []
  const identities = new Set()
  for (const requested of requestedClips) {
    throwIfAborted(signal)
    const canonical = await realpath(requested)
    const info = await lstat(canonical, { bigint: true })
    if (!inside(root, canonical) || extname(canonical).toLowerCase() !== '.mp4'
      || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.size <= 0n) throw new Error('Video clip is not an unlinked regular MP4 inside Nori’s output folder.')
    const identity = `${info.dev}:${info.ino}`
    if (identities.has(identity)) throw new Error('Repeated video clips are not allowed; generate a new shot instead of replay padding.')
    identities.add(identity)
    sources.push(canonical)
  }
  const python = await pythonRuntime(pythonPath)
  // Reading the source works inside Electron ASAR; Python receives code, not an ASAR pathname.
  const helper = await readFile(new URL('./local-video-assembly.py', import.meta.url), 'utf8')
  throwIfAborted(signal)
  const partial = join(parent, `.nori-video-${randomUUID()}.partial.mp4`)
  const handle = await open(partial, 'wx')
  const identity = await handle.stat({ bigint: true })
  await handle.close()
  let published = false, completed = false
  try {
    const job = { clips: sources, outputRoot: root, partialPath: partial, totalFrames, fps, width, height,
      partialDevice: String(identity.dev), partialInode: String(identity.ino) }
    if (Buffer.byteLength(JSON.stringify(job)) > MAX_JOB_BYTES) throw new Error('Video assembly clip manifest exceeds the 16 MiB local job limit.')
    const result = await runHelper(python, helper, job, signal, onProgress)
    throwIfAborted(signal)
    if (result.frameCount !== totalFrames || result.fps !== fps || result.width !== width || result.height !== height
      || result.durationSeconds !== totalFrames / fps) throw new Error('Assembly helper did not verify the requested video duration/profile.')
    const info = await lstat(partial, { bigint: true })
    if (!sameFile(identity, info) || info.nlink !== 1n || info.size <= 0n || info.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Assembly output identity or size validation failed.')
    // link is no-overwrite on Windows and POSIX. Unlike rename, it cannot replace a racing destination.
    await link(partial, output)
    published = true
    throwIfAborted(signal)
    await removeOwned(partial, identity)
    const final = await stat(output, { bigint: true })
    if (final.ino !== identity.ino || final.dev !== identity.dev || final.nlink !== 1n) throw new Error('Published video identity validation failed.')
    throwIfAborted(signal)
    completed = true
    return Object.freeze({ path: output, mimeType: 'video/mp4', size: Number(final.size), frameCount: totalFrames,
      durationSeconds: totalFrames / fps, fps, width, height })
  } finally {
    if (!completed && published) await removeOwned(output, identity)
    await removeOwned(partial, identity)
  }
}
