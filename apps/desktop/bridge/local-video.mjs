/** Requested-duration video: new local Wan shots, then a verified local MP4. */
import { requestImageRuntime } from './image-runtime-request.mjs'
import { randomUUID } from 'node:crypto'
import { localEndpoint, localFetch as fetch } from './local-policy.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import { resolveGeneratedVideoFile, generatedVideoOutputRoot } from './generated-video-file.mjs'
import { decodeNeuraleseVideoIntent } from './neuralese-video-intent.mjs'
import { resolve, relative, isAbsolute } from 'node:path'
import { mkdir, writeFile, rename, statfs, unlink, realpath, lstat } from 'node:fs/promises'
import { assembleLocalVideo, verifyLocalVideoAssembly } from './local-video-assembly.mjs'
import {CINEMATIC_SCHEMA,decodeCinematicVideoIntent,cinematicWorkflow,checkedReference,cinematicResourceCheck} from './cinematic-video-profile.mjs'

const COMFY = localEndpoint('NORI_COMFY_URL', process.env.NORI_COMFY_URL, 'http://127.0.0.1:8188')
const OUTPUT_ROOT = generatedVideoOutputRoot(process.env.NORI_APP_DATA_ROOT || process.cwd())
const MAX_GENERATION_MS = 10 * 60_000
const DISK_RESERVE = 1024 ** 3

export async function localVideoHealth() {
  try { return (await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(700) })).ok } catch { return false }
}

export const WAN22_TEXT_MODEL = 'wan2.2_ti2v_5B_fp16.safetensors'

/** True when the bundled ComfyUI lists the Wan 2.2 5B model and its VAE. */
export async function wan22TextVideoReady({ signal } = {}) {
  try {
    const timeout = AbortSignal.timeout(5000)
    const read = async node => (await (await fetch(`${COMFY}/object_info/${node}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })).json())?.[node]?.input?.required
    const [unet, vae] = await Promise.all([read('UNETLoader'), read('VAELoader')])
    return Boolean(unet?.unet_name?.[0]?.includes?.(WAN22_TEXT_MODEL) && vae?.vae_name?.[0]?.includes?.('wan2.2_vae.safetensors'))
  } catch { return false }
}

export function wanVideoWorkflow(intent, seed = Math.floor(Math.random() * 2 ** 31), filenamePrefix, { wan22 = false } = {}) {
  const checked = intent?.schema === CINEMATIC_SCHEMA ? decodeCinematicVideoIntent(intent) : intent?.schema === undefined ? intent : decodeNeuraleseVideoIntent(intent)
  if(checked?.model==='wan2.2_ti2v_5B_fp16.safetensors')return cinematicWorkflow(checked,seed,filenamePrefix,checked.referenceName)
  if (!checked || checked.model !== 'wan2.1_t2v_1.3B_fp16.safetensors' || checked.width !== 832 || checked.height !== 480 || checked.frames !== 33 || checked.fps !== 16 ||
      typeof checked.prompt !== 'string' || !checked.prompt.trim()) throw new TypeError('Unsupported local Wan video profile; nothing was dispatched.')
  const unique = randomUUID()
  // Same 832x480, 33-frame, 16 fps segment contract, rendered by the stronger Wan 2.2 5B (text only).
  if (wan22) return {
    '1': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' } },
    '2': { class_type: 'VAELoader', inputs: { vae_name: 'wan2.2_vae.safetensors' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 0], text: checked.prompt.slice(0, 12000) } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 0], text: 'blurry, low quality, distorted motion, flicker, text, watermark' } },
    '5': { class_type: 'UNETLoader', inputs: { unet_name: WAN22_TEXT_MODEL, weight_dtype: 'default' } },
    '6': { class_type: 'ModelSamplingSD3', inputs: { model: ['5', 0], shift: 8 } },
    '7': { class_type: 'Wan22ImageToVideoLatent', inputs: { vae: ['2', 0], width: checked.width, height: checked.height, length: checked.frames, batch_size: 1 } },
    '8': { class_type: 'KSampler', inputs: { model: ['6', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['7', 0], seed, steps: 20, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1 } },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['2', 0] } },
    '10': { class_type: 'CreateVideo', inputs: { images: ['9', 0], fps: checked.fps } },
    '11': { class_type: 'SaveVideo', inputs: { video: ['10', 0], filename_prefix: filenamePrefix ?? `nori/nori-${unique}`, format: 'mp4', codec: 'h264' } },
  }
  return {
    '1': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' } },
    '2': { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 0], text: checked.prompt.slice(0, 12000) } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 0], text: 'blurry, low quality, distorted motion, text, watermark' } },
    '5': { class_type: 'UNETLoader', inputs: { unet_name: checked.model, weight_dtype: 'default' } },
    '6': { class_type: 'ModelSamplingSD3', inputs: { model: ['5', 0], shift: 8 } },
    '7': { class_type: 'EmptyHunyuanLatentVideo', inputs: { width: checked.width, height: checked.height, length: checked.frames, batch_size: 1 } },
    '8': { class_type: 'KSampler', inputs: { model: ['6', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['7', 0], seed, steps: 30, cfg: 6, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1 } },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['2', 0] } },
    '10': { class_type: 'CreateVideo', inputs: { images: ['9', 0], fps: checked.fps } },
    '11': { class_type: 'SaveVideo', inputs: { video: ['10', 0], filename_prefix: filenamePrefix ?? `nori/nori-${unique}`, format: 'mp4', codec: 'h264' } },
  }
}

async function resultFile(entry) {
  if (!entry || typeof entry.filename !== 'string' || !/^[\w .-]+\.mp4$/i.test(entry.filename) ||
      typeof entry.subfolder !== 'string' || entry.subfolder.split(/[\\/]/).some(part => part === '..')) throw new Error('Local video provider returned an invalid output path')
  return resolveGeneratedVideoFile(resolve(OUTPUT_ROOT, entry.subfolder, entry.filename), process.env.NORI_APP_DATA_ROOT)
}

async function waitForRuntime(signal, startupTimeoutMs) {
  const startupDeadline = Date.now() + startupTimeoutMs
  let ready = false
  while (!ready && Date.now() < startupDeadline) {
    signal.throwIfAborted()
    try {
      ready = (await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.any([signal,
        AbortSignal.timeout(Math.max(1, Math.min(1500, startupDeadline - Date.now())))]) })).ok
    } catch {
      signal.throwIfAborted()
    }
    if (!ready) await delay(Math.max(1, Math.min(250, startupDeadline - Date.now())), undefined, { signal })
  }
  if (!ready) throw new Error('Nori’s bundled local video runtime did not become ready before the startup deadline')
}

// The jobs API checks the running ID under the queue lock. Never fall back to
// Comfy's global interrupt: another user's image may have started meanwhile.
async function cancelOwnedPrompt(promptId) {
  try {
    const response = await fetch(`${COMFY}/api/jobs/${encodeURIComponent(promptId)}/cancel`, {
      method: 'POST', signal: AbortSignal.timeout(2500), headers: {'content-type': 'application/json'}, body: '{}',
    })
    if (response.ok) return
  } catch { /* Older runtimes may not implement targeted cancellation. */ }
  try {
    await fetch(`${COMFY}/queue`, {method: 'POST', signal: AbortSignal.timeout(2500),
      headers: {'content-type': 'application/json'}, body: JSON.stringify({delete: [promptId]})})
  } catch { /* Do not cancel someone else's running work to compensate. */ }
}

async function generateShot(intent, {signal, timeoutMs, filenamePrefix, seed, onPromptId}) {
  signal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  // Assign the ID before submission so a lost/aborted acknowledgement does not
  // orphan GPU work. The bundled jobs API accepts and validates client UUIDs.
  const promptId = randomUUID()
  let completed = false
  try {
  await onPromptId?.(promptId)
  signal.throwIfAborted()
  // Keep the bounded submission alive after Stop: cancelling an unknown ID
  // before server validation finishes is not a cancellation tombstone. Wait
  // for acceptance, then finally cancels the exact owned ID before any polling.
  const response = await fetch(`${COMFY}/prompt`, { method: 'POST', signal: AbortSignal.timeout(Math.min(timeoutMs, 60000)), headers: { 'content-type': 'application/json' },
    body: JSON.stringify({prompt_id: promptId, prompt: wanVideoWorkflow(intent, seed, filenamePrefix, { wan22: intent?.schema !== CINEMATIC_SCHEMA && await wan22TextVideoReady({ signal }) }), client_id: `nori-video-${intent.correlationId}` }) })
  const queued = await response.json().catch(() => ({}))
  signal.throwIfAborted()
  if (!response.ok || queued.prompt_id !== promptId) {
    const details=Object.values(queued.node_errors??{}).flatMap(node=>(node.errors??[]).map(error=>String(error.details??error.message??''))).filter(Boolean).join('; ').slice(0,600)
    throw new Error((queued.error?.message ?? 'Local video runtime did not acknowledge the owned prompt ID')+(details?': '+details:''))
  }
  while (true) {
    signal.throwIfAborted()
    await delay(750, undefined, { signal })
    const historyResponse = await fetch(`${COMFY}/history/${encodeURIComponent(queued.prompt_id)}`, { signal })
    if (!historyResponse.ok) throw new Error(`Local video status returned ${historyResponse.status}`)
    const history = await historyResponse.json()
    const item = history[queued.prompt_id]
    if (!item) continue
    if (item.status?.status_str === 'error') throw new Error('The local Wan video workflow failed')
    if (item.status?.completed !== true) continue
    // ComfyUI SaveVideo uses PreviewVideo, whose history field is "images".
    // Only accept our designated output node after execution has completed.
    const output = item.outputs?.['11'] ?? {}
    const entries = ['images', 'videos', 'gifs'].flatMap(key => Array.isArray(output[key]) ? output[key] : [])
    const entry = entries.find(video => video?.type === 'output' && /\.mp4$/i.test(video?.filename ?? ''))
    if (entry) {
      const video = await resultFile(entry)
      const expected = resolve(await realpath(OUTPUT_ROOT), filenamePrefix)
      if (!video.path.startsWith(expected + '_')) throw new Error('Local video result does not belong to the submitted shot')
      completed = true
      return video
    }
    throw new Error('Local video workflow completed without an MP4 output')
  }
  } finally { if (!completed) await cancelOwnedPrompt(promptId) }
}

async function createOwnedJobDirectory(jobId) {
  const root = await realpath(OUTPUT_ROOT)
  let parent = root
  for (const component of ['nori', 'jobs']) {
    const candidate = resolve(parent, component)
    try { await mkdir(candidate) } catch (error) { if (error.code !== 'EEXIST') throw error }
    if ((await lstat(candidate)).isSymbolicLink()) throw new Error('Video job folder must not be a junction or symbolic link')
    const actual = await realpath(candidate)
    const rel = relative(root, actual)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Video job folder escapes Nori’s output root')
    parent = actual
  }
  const jobRoot = resolve(parent, jobId)
  await mkdir(jobRoot) // Exclusive new UUID directory; never reuse a supplied tree.
  return jobRoot
}

/** One frame-bound request; no looped padding, cloud fallback or silent shortening. */
export async function generateLocalVideo(frame, options = {}) {
  let intent = frame?.schema===CINEMATIC_SCHEMA?decodeCinematicVideoIntent(frame):decodeNeuraleseVideoIntent(frame)
  const timeoutMs = Number(options.timeoutMs ?? MAX_GENERATION_MS)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_GENERATION_MS) throw new RangeError('Invalid local video per-shot generation time limit')
  const startupTimeoutMs = Number(options.startupTimeoutMs ?? Math.min(120000, timeoutMs))
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 120000) throw new RangeError('Invalid local video startup time limit')
  const progressAbort = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, progressAbort.signal]) : progressAbort.signal
  signal.throwIfAborted()
  const totalFrames = intent.totalFrames ?? intent.frames
  const totalShots = Math.ceil(totalFrames / intent.frames)
  const durationSeconds = totalFrames / intent.fps
  const jobId = randomUUID()
  let jobRoot
  const start = Date.now()
  let progress = {stage: 'preparing', completedShots: 0, totalShots, durationSeconds, elapsedMs: 0}
  const emit = (patch = {}) => {
    progress = {...progress, ...patch, elapsedMs: Date.now() - start}
    options.onProgress?.(Object.freeze({...progress}))
  }
  const heartbeat = setInterval(() => {
    try { emit() } catch (error) { progressAbort.abort(error) }
  }, 15000)
  heartbeat.unref?.()
  const clips = []
  const receipt = {schema: 'nori.local-video-job.v1', jobId, frameSha256: frame.frame_sha256,
    requestedDurationSeconds: durationSeconds, totalFrames, fps: intent.fps, totalShots,
    state: 'preparing', completedShots: 0, clips: [], createdAt: new Date().toISOString()}
  let jobCreated = false
  const save = async patch => {
    Object.assign(receipt, patch, {updatedAt: new Date().toISOString()})
    await writeFile(resolve(jobRoot, 'job.json.tmp'), JSON.stringify(receipt, null, 2), {flag: 'w'})
    await rename(resolve(jobRoot, 'job.json.tmp'), resolve(jobRoot, 'job.json'))
  }
  try {
    emit()
    if (totalShots > 65_536) throw new Error('This video exceeds the local assembly job capacity of 65,536 shots; split it into projects. Duration was not shortened.')
    // Reserve a conservative JSON-escaped path budget before the first shot.
    // Actual paths are host-generated; no user path is ever sent as a command.
    const maxClipPath = resolve(OUTPUT_ROOT, 'nori', 'jobs', jobId, `shot-${totalShots}-${randomUUID()}_00001_.mp4`)
    if (totalShots * (Buffer.byteLength(JSON.stringify(maxClipPath), 'utf8') + 16) + 4096 > 16 * 1024 * 1024) {
      throw new Error('This video exceeds the local assembly manifest capacity; split it into projects. Duration was not shortened.')
    }
    if (!options.assembleVideo) await verifyLocalVideoAssembly({signal})
    requestImageRuntime()
  await waitForRuntime(signal, startupTimeoutMs)
    signal.throwIfAborted()
    if(frame.schema===CINEMATIC_SCHEMA){
      await (options.cinematicResources??cinematicResourceCheck)()
      const catalogResponse=await fetch(`${COMFY}/object_info`,{signal})
      if(!catalogResponse.ok)throw new Error('Cinematic runtime model catalog is unavailable; no shot was queued.')
      const catalog=await catalogResponse.json()
      const models=catalog.UNETLoader?.input?.required?.unet_name?.[0]??[]
      const vaes=catalog.VAELoader?.input?.required?.vae_name?.[0]??[]
      if(!models.includes(intent.model)||!vaes.includes('wan2.2_vae.safetensors'))throw new Error('Cinematic model files are not registered in this runtime. Load the prepared extra-model-paths configuration; no shot was queued.')
      const reference=await checkedReference(intent.referencePath,intent.referenceSha256)
      const referenceName=`nori-${randomUUID()}.${reference.extension}`
      const form=new FormData()
      form.append('image',new Blob([reference.bytes],{type:reference.mimeType}),referenceName)
      form.append('type','input');form.append('overwrite','false')
      const upload=await fetch(`${COMFY}/upload/image`,{method:'POST',body:form,signal})
      const ack=await upload.json().catch(()=>({}))
      if(!upload.ok||ack.name!==referenceName||(ack.subfolder??'')!=='')throw new Error('Cinematic reference upload did not return its owned filename; no shot was queued.')
      intent=Object.freeze({...intent,referenceName})
    }
    // Conservative raw-frame estimate covers intermediates and final encode;
    // reject an oversized job explicitly, never reduce the requested duration.
    await mkdir(OUTPUT_ROOT, {recursive: true})
    const space = await statfs(OUTPUT_ROOT, {bigint: true})
    const estimatedBytes = BigInt(totalFrames) * BigInt(intent.width * intent.height * 6)
    if (space.bavail * space.bsize < estimatedBytes + BigInt(DISK_RESERVE)) {
      throw new Error(`Not enough local disk space for the requested ${durationSeconds}-second video; duration was not shortened`)
    }
    jobRoot = await createOwnedJobDirectory(jobId)
    jobCreated = true
    await save({state: 'generating'})
    for (let index = 0; index < totalShots; index++) {
      signal.throwIfAborted()
      const remaining = await statfs(OUTPUT_ROOT, {bigint: true})
      if (remaining.bavail * remaining.bsize < BigInt(DISK_RESERVE)) throw new Error('Video stopped because local disk space is low; completed shots are preserved')
      emit({stage: 'generating', completedShots: index})
      const prefix = `nori/jobs/${jobId}/shot-${index + 1}-${randomUUID()}`
      const seed = Math.floor(Math.random() * 2 ** 31)
      const video = await generateShot(intent, {signal, timeoutMs, filenamePrefix: prefix, seed,
        onPromptId: activePromptId => save({activePromptId})})
      clips.push(video.path)
      receipt.clips.push({path: video.path, size: video.size, seed})
      await save({completedShots: clips.length, activePromptId: null})
      emit({completedShots: clips.length})
    }
    signal.throwIfAborted()
    emit({stage: 'assembling'})
    await save({state: 'assembling'})
    const outputPath = resolve(jobRoot, 'video.mp4')
    const assembled = await (options.assembleVideo ?? assembleLocalVideo)({clips, outputPath, totalFrames,
      fps: intent.fps, width: intent.width, height: intent.height, signal, outputRoot: OUTPUT_ROOT,
      onProgress: value => { if (value?.stage === 'verifying') emit({stage: 'verifying'}) }})
    signal.throwIfAborted()
    if (assembled.frameCount !== totalFrames || assembled.durationSeconds !== durationSeconds) {
      throw new Error('Assembled video did not match the requested frame count and duration; no video was delivered')
    }
    const video = await resolveGeneratedVideoFile(outputPath, process.env.NORI_APP_DATA_ROOT)
    await save({state: 'completed', outputPath: video.path, outputBytes: video.size,
      verifiedFrameCount: assembled.frameCount, verifiedDurationSeconds: assembled.durationSeconds})
    // Only this job's exact, owned intermediate files are disposable after the
    // final MP4 is verified. Preserve them on failure for diagnosis/recovery.
    for (const path of clips) await unlink(path).catch(() => {})
    return Object.freeze({...video, durationSeconds, frameCount: totalFrames, shots: totalShots, jobId})
  } catch (error) {
    if (jobCreated) await save({state: signal.aborted ? 'cancelled' : 'failed',
      error: String(error?.message ?? error).slice(0, 1000)}).catch(() => {})
    throw error
  } finally { clearInterval(heartbeat) }
}

