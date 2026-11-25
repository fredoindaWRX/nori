/** Original Nori image-tool boundary. No Adobe code, services, or patch files. */
import { generateImage, localImageHealth } from './local-image.mjs'
import { encodeNeuraleseImageIntent, decodeNeuraleseImageIntent } from './neuralese-image-intent.mjs'
export { localImageHealth } from './local-image.mjs'

export function createLadybug({ generate = generateImage, health = localImageHealth } = {}) {
  return {
    async status() {
      const available = await health()
      return { name: 'Ladybug', localOnly: true, generation: available ? 'provider-reachable' : 'unavailable',
        maskedFill: 'not-implemented', canvasExpansion: 'not-implemented', generated: false }
    },
    async generate(request, { signal } = {}) {
      if (!request || typeof request.prompt !== 'string' || !request.prompt.trim()
          || Buffer.byteLength(request.prompt, 'utf8') > 12000) throw new TypeError('Ladybug needs a prompt of 1–12000 UTF-8 bytes.')
      for (const key of Object.keys(request)) if (!['prompt', 'width', 'height'].includes(key)) throw new TypeError(`Unsupported Ladybug field: ${key}`)
      const width = request.width ?? 1024, height = request.height ?? 768
      for (const size of [width, height]) if (!Number.isInteger(size) || size < 512 || size > 1536 || size % 64) throw new RangeError('Ladybug dimensions must be multiples of 64 between 512 and 1536.')
      signal?.throwIfAborted()
      const image = await generate(encodeNeuraleseImageIntent(request.prompt.trim(), { width, height }), { signal })
      if (!image || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)
          || typeof image.data !== 'string' || !image.data) throw new Error('Ladybug received no valid image; generation is unconfirmed.')
      return { tool: 'Ladybug', generated: true, displayed: false, localOnly: true, image }
    },
  }
}

/** Existing Nori display path consumes only the verified local image payload. */
export async function generateLadybugImage(frame, options = {}) {
  const intent = decodeNeuraleseImageIntent(frame)
  const result = await createLadybug().generate({ prompt: intent.prompt, width: intent.width, height: intent.height }, options)
  return result.image
}
