import {
  SCREEN_PERCEPTION_MAX_CAPTURE_AGE_MS,
  SCREEN_PERCEPTION_MAX_FINDINGS,
  SCREEN_PERCEPTION_MAX_IMAGE_BYTES,
  SCREEN_PERCEPTION_FUTURE_SKEW_MS,
  validateScreenPerceptionResponse,
  type ScreenPerceptionResponse,
} from '../../bridge/screen-perception-contract.mjs'
import {
  visionProcessorCoordinator,
  type IVisionProcessor,
  type VisionAvailability,
  type VisionFrameSample,
  type VisionObservation,
  type VisionProcessorCoordinator,
} from './vision.ts'

const PROCESSOR_ID = 'nori.screen-structured-perception'
const MAX_DIMENSION = 16_384
const MAX_PIXELS = 33_554_432
const MAX_SUMMARY_LENGTH = 1_400

export type ScreenVisionCapability = {
  available: boolean
  backendId: string | null
  modelId: string | null
  imageCapable: boolean
  structuredOutput: boolean
  errorCode?: string
}

export type ScreenVisionResult =
  | { ok: true; response: ScreenPerceptionResponse }
  | { ok: false; error: { code: string } }

export type ScreenVisionBackend = {
  getCapability(): Promise<ScreenVisionCapability>
  perceive(input: {
    sampleId: string
    capturedAt: number
    frame: { data: string; mimeType: string }
  }): Promise<ScreenVisionResult>
}

export class ScreenVisionProcessor implements IVisionProcessor {
  private readonly backend: ScreenVisionBackend
  private modelId: string | null = null
  private backendId: string | null = null

  readonly metadata = {
    id: PROCESSOR_ID,
    name: 'Structured screen perception',
    supportedSources: ['screen'] as const,
    enabled: true,
    availability: 'unavailable' as VisionAvailability,
    supportedObservationTypes: ['screen_observation', 'text_observation'] as const,
  }

  constructor(backend: ScreenVisionBackend) {
    this.backend = backend
  }

  setCapability(capability: ScreenVisionCapability): void {
    const textOnly = capability.backendId === 'nori-windows-ocr-v1' && capability.modelId === null
    this.modelId = capability.backendId === 'ollama-json-screen-v1'
      && typeof capability.modelId === 'string'
      && capability.modelId.length > 0
      ? capability.modelId
      : null
    this.backendId = textOnly ? 'nori-windows-ocr-v1' : this.modelId !== null ? 'ollama-json-screen-v1' : null
    this.metadata.name = textOnly ? 'Screen text recognition (Windows OCR)' : 'Structured screen perception'
    this.metadata.availability = capability.available
      && capability.imageCapable
      && capability.structuredOutput
      && this.backendId !== null
      ? 'available'
      : 'unavailable'
  }

  async refreshAvailability(): Promise<void> {
    try {
      this.setCapability(await this.backend.getCapability())
    } catch {
      this.setCapability({
        available: false,
        backendId: null,
        modelId: null,
        imageCapable: false,
        structuredOutput: false,
        errorCode: 'capability_unavailable',
      })
    }
  }

  async process(sample: VisionFrameSample): Promise<VisionObservation[]> {
    if (!this.metadata.enabled || this.metadata.availability !== 'available') {
      throw new Error('screen_backend_unavailable')
    }
    if (!sample || sample.source !== 'screen') throw new Error('invalid_screen_source')
    if (typeof sample.id !== 'string' || sample.id.length < 1 || sample.id.length > 128) {
      throw new Error('invalid_sample_id')
    }

    const now = Date.now()
    if (!Number.isFinite(sample.timestamp) || sample.timestamp <= 0
      || sample.timestamp > now + SCREEN_PERCEPTION_FUTURE_SKEW_MS
      || now - sample.timestamp > SCREEN_PERCEPTION_MAX_CAPTURE_AGE_MS) {
      throw new Error('invalid_sample_timestamp')
    }
    if (!Number.isInteger(sample.width) || !Number.isInteger(sample.height)
      || sample.width < 1 || sample.height < 1
      || sample.width > MAX_DIMENSION || sample.height > MAX_DIMENSION
      || sample.width * sample.height > MAX_PIXELS
      || !sample.payload || sample.payload.width !== sample.width || sample.payload.height !== sample.height
      || typeof sample.payload.toDataURL !== 'function') {
      throw new Error('invalid_sample_dimensions')
    }

    let encoded: string
    try {
      encoded = sample.payload.toDataURL('image/jpeg', 0.78)
    } catch {
      throw new Error('screen_frame_encoding_failed')
    }
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(encoded)
    const data = match?.[1]
    if (!data || data.length > SCREEN_PERCEPTION_MAX_IMAGE_BYTES) {
      throw new Error('invalid_encoded_screen_frame')
    }

    const result = await this.backend.perceive({
      sampleId: sample.id,
      capturedAt: sample.timestamp,
      frame: { data, mimeType: 'image/jpeg' },
    })
    if (!result.ok) throw new Error(result.error.code)

    const response = result.response
    const checked = validateScreenPerceptionResponse(response, {
      requestId: response.requestId,
      sampleId: sample.id,
      capturedAt: sample.timestamp,
      now: Date.now(),
    })
    if (!checked.ok) throw new Error(checked.error.code)
    if (checked.response.backendId !== this.backendId) throw new Error('screen_backend_mismatch')
    if (checked.response.status === 'error') {
      throw new Error(checked.response.errorCode ?? 'screen_perception_failed')
    }
    if (checked.response.status === 'no_findings') return []
    if (checked.response.findings.length > SCREEN_PERCEPTION_MAX_FINDINGS) {
      throw new Error('invalid_finding_count')
    }

    const seen = new Set<string>()
    const observations: VisionObservation[] = []
    for (const [index, finding] of checked.response.findings.entries()) {
      const duplicateKey = `${finding.kind}\u0000${finding.value}`
      if (seen.has(duplicateKey)) continue
      seen.add(duplicateKey)

      const observationType = finding.kind === 'visible_text' ? 'text_observation' : 'screen_observation'
      const value = Array.from(finding.value, (character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127 ? ' ' : character
      }).join('').trim()
      const detail = finding.kind === 'visible_text' ? JSON.stringify(value) : value
      const summaryPrefix = finding.kind === 'application'
        ? 'Visible application: '
        : finding.kind === 'window'
          ? 'Visible window: '
          : finding.kind === 'ui_element'
            ? 'Visible UI element: '
            : 'Visible screen text: '
      const summary = `${summaryPrefix}${detail}`.slice(0, MAX_SUMMARY_LENGTH)

      observations.push({
        id: `${PROCESSOR_ID}:${sample.id}:${index}`,
        type: observationType,
        source: 'screen',
        summary,
        ...(finding.confidence === undefined ? {} : { confidence: finding.confidence }),
        timestamp: checked.response.observedAt,
        metadata: {
          sampleId: sample.id,
          processorId: PROCESSOR_ID,
          backendId: checked.response.backendId,
          ...((checked.response.modelId ?? this.modelId)
            ? { modelId: checked.response.modelId ?? this.modelId }
            : {}),
          findingKind: finding.kind,
          findingValue: value,
          capturedAt: checked.response.capturedAt,
          observedAt: checked.response.observedAt,
        },
      })
    }
    return observations
  }

  /** Decode one explicitly captured local display frame and run this processor. */
  async processEncodedFrame(input: {
    id: string
    timestamp: number
    frame: { data: string; mimeType: string }
  }): Promise<VisionObservation[]> {
    const image = new Image()
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('screen_frame_decode_failed'))
    })
    image.src = `data:${input.frame.mimeType};base64,${input.frame.data}`
    await loaded

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context || canvas.width < 1 || canvas.height < 1) {
      throw new Error('screen_frame_decode_failed')
    }
    context.drawImage(image, 0, 0)

    return this.process({
      id: input.id,
      source: 'screen',
      timestamp: input.timestamp,
      width: canvas.width,
      height: canvas.height,
      payload: canvas,
    })
  }
}

export function registerScreenVisionProcessor(
  processor: ScreenVisionProcessor,
  coordinator: VisionProcessorCoordinator = visionProcessorCoordinator,
): () => void {
  if (coordinator.getProcessors().some(({ id }) => id === processor.metadata.id)) return () => {}
  coordinator.registerProcessor(processor)
  return () => {
    coordinator.unregisterProcessor(processor.metadata.id)
  }
}
