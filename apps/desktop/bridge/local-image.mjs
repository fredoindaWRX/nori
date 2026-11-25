import { withLocalVideoModelLease } from './video-model-lease.mjs'
/** Local, keyless image-provider seam for New Nori. */
import { imageRuntimeManaged, requestImageRuntime } from './image-runtime-request.mjs'
import { localEndpoint, localFetch as fetch } from './local-policy.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { decodeNeuraleseImageIntent } from './neuralese-image-intent.mjs'
const BASE = localEndpoint('NORI_IMAGE_API', process.env.NORI_IMAGE_API, 'http://127.0.0.1:8080')
const COMFY = localEndpoint('NORI_COMFY_URL', process.env.NORI_COMFY_URL, 'http://127.0.0.1:8188')
const MAX_IMAGE_BYTES = 64 * 1024 * 1024

function imageResult(bytes) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Generated image exceeds the supported size or is empty')
  let mimeType
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mimeType='image/png'
  else if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) mimeType='image/jpeg'
  else if (bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') mimeType='image/webp'
  else throw new Error('Local provider returned an unsupported image format')
  return {data:bytes.toString('base64'),mimeType}
}

async function boundedBody(response, limit=MAX_IMAGE_BYTES) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw new Error('Local provider response exceeds the supported size')
  }
  const chunks=[]; let size=0
  for await (const chunk of response.body ?? []) {
    size+=chunk.length
    if(size>limit) throw new Error('Local provider response exceeds the supported size')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function localImageHealth() {
  // The app starts its image runtime on the first request, so a managed runtime counts as available.
  if (imageRuntimeManaged()) return true
  try {
    const response = await fetch(`${BASE}/v1/models`, { signal: AbortSignal.timeout(500) })
    if (response.ok) return true
  } catch {}
  return comfyHealth()
}

export async function generateLocalImage(frame, options = {}) {
  const intent = decodeNeuraleseImageIntent(frame)
  const response = await fetch(`${BASE}/v1/images/generations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(Number(options.timeoutMs ?? 120000))])
      : AbortSignal.timeout(Number(options.timeoutMs ?? 120000)),
    body: JSON.stringify({ prompt: intent.prompt, model: intent.model, n: 1, size: `${intent.width}x${intent.height}`, response_format: 'b64_json' }),
  })
  if (!response.ok) throw new Error(`local image provider returned ${response.status}`)
  const body = JSON.parse((await boundedBody(response, Math.ceil(MAX_IMAGE_BYTES*4/3)+65536)).toString('utf8'))
  const item = body?.data?.[0]
  if (!item?.b64_json && !item?.url) throw new Error('local image provider returned no image')
  if (item.url) localEndpoint('Generated image URL', item.url)
  return item
}

function comfyWorkflow(prompt, options = {}) {
  const width = Number.isInteger(options.width) ? Math.max(512, Math.min(1536, options.width)) : 1024
  const height = Number.isInteger(options.height) ? Math.max(512, Math.min(1536, options.height)) : 1024
  const model = options.model ?? 'z_image_turbo_int8_convrot.safetensors'
  if (model !== 'z_image_turbo_int8_convrot.safetensors') throw new Error('Unsupported Nori local image model')
  return {
    '4': { class_type: 'UNETLoader', inputs: { unet_name: model, weight_dtype: 'default' } },
    '5': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b_fp8_mixed.safetensors', type: 'lumina2', device: 'default' } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    '7': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['4', 0], shift: 3 } },
    '8': { class_type: 'CLIPTextEncode', inputs: { clip: ['5', 0], text: String(prompt).slice(0, 12000) } },
    '9': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['8', 0] } },
    '10': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    '11': { class_type: 'KSampler', inputs: {
      model: ['7', 0], positive: ['8', 0], negative: ['9', 0], latent_image: ['10', 0],
      seed: Math.floor(Math.random() * 2 ** 31), steps: 9, cfg: 1, sampler_name: 'res_multistep',
      scheduler: 'simple', denoise: 1,
    } },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['6', 0] } },
    '13': { class_type: 'SaveImage', inputs: { filename_prefix: `nori-${randomUUID()}`, images: ['12', 0] } },
  }
}

export async function comfyHealth() {
  try { const r = await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(700) }); return r.ok } catch { return false }
}

async function waitForManagedComfy(options = {}) {
  const timeoutMs = Number(options.comfyStartupTimeoutMs ?? 120000)
  const pollMs = Number(options.comfyPollIntervalMs ?? 250)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300000 ||
      !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 5000) {
    throw new RangeError('Invalid bundled image-runtime readiness bounds')
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted()
    if (await comfyHealth()) return true
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())), undefined,
      options.signal ? { signal: options.signal } : undefined)
  }
  return comfyHealth()
}

export async function generateComfyImage(frame, options = {}) {
  const intent = decodeNeuraleseImageIntent(frame)
  const timeoutMs = Number(options.timeoutMs ?? 120000)
  const pollMs = Number(options.imagePollIntervalMs ?? 500)
  const attempts = Number(options.imagePollAttempts ?? 180)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000
      || !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 5000
      || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 180) {
    throw new RangeError('Invalid local image polling bounds')
  }
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  const queued = await fetch(`${COMFY}/prompt`, { method: 'POST', signal, headers: {'content-type':'application/json'}, body: JSON.stringify({ prompt: comfyWorkflow(intent.prompt, { ...options, width: intent.width, height: intent.height, model: intent.model }), client_id: `nori-${intent.correlationId}` }) })
  const body = await queued.json().catch(() => ({}))
  if (!queued.ok || !body.prompt_id) throw new Error(body.error?.message ?? `ComfyUI returned ${queued.status}`)
  for (let i = 0; i < attempts; i++) {
    await delay(pollMs, undefined, {signal})
    const history = await fetch(`${COMFY}/history/${encodeURIComponent(body.prompt_id)}`, {signal})
    if (!history.ok) throw new Error(`ComfyUI history returned ${history.status}`)
    const h = await history.json()
    const item = h[body.prompt_id]
    if (!item) continue
    if (item.status?.status_str === 'error') throw new Error('ComfyUI image workflow failed')
    if (item.status?.completed !== true) continue
    if (item.status.status_str !== 'success') throw new Error('ComfyUI image workflow did not complete successfully')
    // Node 13 is this workflow's SaveImage node. Previews and unrelated outputs
    // cannot establish that the requested image was completed and saved.
    const images = item.outputs?.['13']?.images
    if (!Array.isArray(images) || !images.length || images.length > 16) {
      throw new Error('ComfyUI image workflow completed without its designated saved image')
    }
    for (const image of images) {
      const folder = image?.subfolder ?? ''
      if (image?.type !== 'output' || typeof image.filename !== 'string' || !image.filename
          || image.filename.length > 512 || /[\\/:\0]/.test(image.filename) || image.filename === '..'
          || typeof folder !== 'string' || folder.length > 1024 || /[\\:\0]/.test(folder)
          || (folder && folder.split('/').some(part => !part || part === '.' || part === '..'))) {
        throw new Error('ComfyUI designated image is not a valid saved output')
      }
      const q = new URLSearchParams({ filename: image.filename, subfolder: folder, type: 'output' })
      const view = await fetch(`${COMFY}/view?${q}`, {signal})
      if (!view.ok) throw new Error(`ComfyUI image returned ${view.status}`)
      return imageResult(await boundedBody(view))
    }
  }
  throw new Error('ComfyUI image generation timed out')
}

/** Match the advertised health seam: ComfyUI or the loopback image API. */
async function generateImageOwned(frame, options = {}) {
  options.signal?.throwIfAborted()
  decodeNeuraleseImageIntent(frame)
  requestImageRuntime()
  if (await comfyHealth()) return generateComfyImage(frame, options)
  const managedComfy = process.env.NORI_COMFY_RUNTIME_MANAGED === '1'
  if (managedComfy && await waitForManagedComfy(options)) return generateComfyImage(frame, options)
  let item
  try {
    item = await generateLocalImage(frame, options)
  } catch (error) {
    if (managedComfy) {
      throw new Error(`The bundled image runtime did not become ready${options.comfyStartupTimeoutMs ? ` within ${options.comfyStartupTimeoutMs} ms` : ''}; ${String(error.message).slice(0, 256)}`)
    }
    throw error
  }
  if (item.b64_json) {
    if(typeof item.b64_json!=='string' || item.b64_json.length>Math.ceil(MAX_IMAGE_BYTES*4/3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.b64_json)) throw new Error('Local provider returned invalid image data')
    return imageResult(Buffer.from(item.b64_json,'base64'))
  }
  const deadline=AbortSignal.timeout(30000)
  const image=await fetch(item.url,{signal:options.signal ? AbortSignal.any([options.signal,deadline]) : deadline})
  if (!image.ok) throw new Error(`Local generated image returned ${image.status}`)
  return imageResult(await boundedBody(image))
}

// Qwen-Image-Edit-2511 (Apache-2.0), run by the bundled ComfyUI. The model is larger than the
// card, so ComfyUI keeps part of it in system RAM; the GPU lease unloads Nori's language model first.
export const QWEN_EDIT_MODEL = 'qwen_image_edit_2511_fp8mixed.safetensors'
const EDIT_IMAGE_TYPES = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']])
const EDIT_VERB = /^(?:(?:hey\s+)?nori[,!]?\s*)?(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?(?:edit|change|make|turn|remove|erase|delete|add|replace|swap|recolou?r|colou?r|put|give|convert|restyle|fix|clean\s+up|retouch|brighten|darken|blur|sharpen|crop\s+out|zoom\s+out)\b/i
const EDIT_OBJECT = /\b(?:this|it|the|photo|picture|image|pic|background|him|her|them|his|its|my)\b/i

/** An instruction to change an attached photo (not a question about it). */
export function requestsImageEdit(text) {
  const value = String(text ?? '').trim()
  return value.length <= 2000 && EDIT_VERB.test(value) && EDIT_OBJECT.test(value)
    && !/^\s*(?:what|who|where|why|how|which|describe|is|are|does|do)\b/i.test(value)
}

export function qwenEditWorkflow(uploaded, instruction, { seed = Math.floor(Math.random() * 2 ** 31), steps = 30 } = {}) {
  if (typeof uploaded !== 'string' || !uploaded || uploaded.length > 256 || /[\\/:\0]/.test(uploaded)) throw new Error('Invalid uploaded image name')
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: QWEN_EDIT_MODEL, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '4': { class_type: 'LoadImage', inputs: { image: uploaded } },
    '5': { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['4', 0], upscale_method: 'lanczos', megapixels: 1, resolution_steps: 1 } },
    '6': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], prompt: String(instruction).slice(0, 2000), vae: ['3', 0], image1: ['5', 0] } },
    '7': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], prompt: '', vae: ['3', 0], image1: ['5', 0] } },
    '8': { class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { conditioning: ['6', 0], reference_latents_method: 'index_timestep_zero' } },
    '9': { class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { conditioning: ['7', 0], reference_latents_method: 'index_timestep_zero' } },
    '10': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3.1 } },
    '11': { class_type: 'CFGNorm', inputs: { model: ['10', 0], strength: 1 } },
    '12': { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['3', 0] } },
    '13': { class_type: 'KSampler', inputs: { model: ['11', 0], positive: ['8', 0], negative: ['9', 0], latent_image: ['12', 0],
      seed, steps, cfg: 4, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    '14': { class_type: 'VAEDecode', inputs: { samples: ['13', 0], vae: ['3', 0] } },
    '15': { class_type: 'SaveImage', inputs: { filename_prefix: `nori-edit-${randomUUID()}`, images: ['14', 0] } },
  }
}

/** Edit one attached image ({data: base64, mimeType}) by instruction; returns {data, mimeType}. */
export async function editComfyImage(image, instruction, options = {}) {
  const extension = EDIT_IMAGE_TYPES.get(image?.mimeType)
  if (!extension || typeof image.data !== 'string') throw new Error('Photo editing accepts one PNG, JPEG or WebP image')
  const bytes = Buffer.from(image.data, 'base64')
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('The photo to edit is empty or too large')
  const timeoutMs = Number(options.timeoutMs ?? 900000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) throw new RangeError('Invalid photo edit timeout')
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  const form = new FormData()
  form.append('image', new Blob([bytes], { type: image.mimeType }), `nori-edit-source-${randomUUID()}.${extension}`)
  form.append('overwrite', 'false')
  const upload = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form, signal })
  const uploaded = await upload.json().catch(() => ({}))
  if (!upload.ok || typeof uploaded.name !== 'string') throw new Error(`ComfyUI upload returned ${upload.status}`)
  if (uploaded.subfolder) throw new Error('ComfyUI stored the photo in an unexpected folder')
  const queued = await fetch(`${COMFY}/prompt`, { method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: qwenEditWorkflow(uploaded.name, instruction, options), client_id: `nori-edit-${randomUUID()}` }) })
  const body = await queued.json().catch(() => ({}))
  if (!queued.ok || !body.prompt_id) throw new Error(body.error?.message ?? `ComfyUI returned ${queued.status}`)
  return collectComfyImage(body.prompt_id, '15', { signal, pollMs: Number(options.pollMs ?? 1000), attempts: Math.ceil(timeoutMs / 1000) })
}

async function collectComfyImage(promptId, nodeId, { signal, pollMs, attempts }) {
  for (let i = 0; i < attempts; i++) {
    await delay(pollMs, undefined, { signal })
    const history = await fetch(`${COMFY}/history/${encodeURIComponent(promptId)}`, { signal })
    if (!history.ok) throw new Error(`ComfyUI history returned ${history.status}`)
    const item = (await history.json())[promptId]
    if (!item) continue
    if (item.status?.status_str === 'error') throw new Error('ComfyUI photo edit failed')
    if (item.status?.completed !== true) continue
    const saved = item.outputs?.[nodeId]?.images?.[0]
    if (saved?.type !== 'output' || typeof saved.filename !== 'string' || !saved.filename || /[\\/:\0]/.test(saved.filename) || saved.subfolder) {
      throw new Error('ComfyUI photo edit completed without its saved image')
    }
    const query = new URLSearchParams({ filename: saved.filename, subfolder: '', type: 'output' })
    const view = await fetch(`${COMFY}/view?${query}`, { signal })
    if (!view.ok) throw new Error(`ComfyUI image returned ${view.status}`)
    return imageResult(await boundedBody(view))
  }
  throw new Error('ComfyUI photo edit timed out')
}

export async function editImage(image, instruction, options = {}) {
  options.signal?.throwIfAborted()
  return withLocalVideoModelLease(async () => {
    requestImageRuntime()
    if (!await comfyHealth() && !(process.env.NORI_COMFY_RUNTIME_MANAGED === '1' && await waitForManagedComfy(options))) {
      throw new Error('The local image runtime (ComfyUI) is not running')
    }
    return editComfyImage(image, instruction, options)
  }, { signal: options.signal, mediaKind: 'image' })
}

export async function generateImage(frame, options = {}) {
  options.signal?.throwIfAborted()
  decodeNeuraleseImageIntent(frame)
  return withLocalVideoModelLease(()=>generateImageOwned(frame,options),{signal:options.signal,mediaKind:"image"})
}
