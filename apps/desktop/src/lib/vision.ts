import * as camera from './camera.ts'

export type VisionAvailability = 'available' | 'unavailable' | 'degraded'
export type VisionPermission = 'unknown' | 'granted' | 'denied' | 'prompt'
export type VisionSource = 'camera' | 'screen' | 'none'

export type VisionEventType =
  | 'object_detected'
  | 'person_detected'
  | 'hand_gesture'
  | 'screen_observation'
  | 'scene_observation'
  | 'room_observation'
  | 'presence_update'
  | 'text_observation'
  | 'ui_signal'
  | (string & {})

export type VisionObservation = {
  id: string
  type: VisionEventType
  source: VisionSource
  summary: string
  confidence?: number
  timestamp: number
  metadata?: Record<string, unknown>
}

/** Default maximum age for evidence used to answer a current visual question. */
export const VISION_EVIDENCE_MAX_AGE_MS = 5_000

export type GroundedVisionContext = {
  enabled: boolean
  visualQuestion: boolean
  observations: VisionObservation[]
  sources: Exclude<VisionSource, 'none'>[]
  observedAt: number | null
  agesMs: number[]
  fresh: boolean
  supportsVisualAnswering: boolean
  supportsFrameInput: boolean
  constraint: string
}

export type GroundedVisionContextOptions = {
  enabled: boolean
  screenMonitorEnabled?: boolean
  observations: readonly VisionObservation[]
  now?: number
  maxAgeMs?: number
}

export type VisionFrameSample = {
  id: string
  source: Exclude<VisionSource, 'none'>
  timestamp: number
  width: number
  height: number
  payload: HTMLCanvasElement
}

export type VisionEvent = {
  type: VisionEventType
  summary: string
  source: VisionSource
  confidence?: number
  timestamp: number
}

export type VisionStatus = {
  availability: VisionAvailability
  enabled: boolean
  activeSources: VisionSource[]
  cameraPermission: VisionPermission
  screenPermission: VisionPermission
  latestEvent: VisionEvent | null
  updatedAt: number
}

export interface IVisionClient {
  getStatus(): VisionStatus
  getObservations(): VisionObservation[]
  subscribe(listener: (status: VisionStatus) => void): () => void
  setEnabled(enabled: boolean): void
  getActiveSources(): VisionSource[]
  syncFromUiState(state: {
    enabled?: boolean
    gestures?: boolean
    screenMonitor?: boolean
    looking?: string | null
    cameraPermission?: VisionPermission
    screenPermission?: VisionPermission
    activeSources?: VisionSource[]
  }): void
  sampleCurrentFrame(source: Exclude<VisionSource, 'none'>): VisionFrameSample | null
  publishObservation(observation: VisionObservation): boolean
  subscribeObservations(listener: (observation: VisionObservation) => void): () => void
}

const defaultVisionStatus: VisionStatus = {
  availability: 'unavailable',
  enabled: false,
  activeSources: ['none'],
  cameraPermission: 'unknown',
  screenPermission: 'unknown',
  latestEvent: null,
  updatedAt: Date.now(),
}

export type VisionClientOptions = {
  initialStatus?: Partial<VisionStatus>
}

const isVisionSource = (value: unknown): value is VisionSource =>
  value === 'camera' || value === 'screen' || value === 'none'

const normalizeActiveSources = (sources?: readonly VisionSource[]): VisionSource[] => {
  if (!sources || sources.length === 0) return ['none']
  const seen = new Set<VisionSource>()
  for (const source of sources) {
    if (isVisionSource(source)) seen.add(source)
  }
  return seen.size > 0 ? [...seen] : ['none']
}

export function deriveVisionStatus(params: {
  enabled: boolean
  gestures: boolean
  screenMonitor: boolean
  looking: string | null
  cameraPermission?: VisionPermission
  screenPermission?: VisionPermission
  activeSources?: VisionSource[]
}): VisionStatus {
  const activeSources: VisionSource[] = params.activeSources
    ? normalizeActiveSources(params.activeSources)
    : (() => {
        const next: VisionSource[] = []
        if (params.gestures) next.push('camera')
        if (params.screenMonitor) next.push('screen')
        return next
      })()

  const resolvedSources: VisionSource[] = activeSources.length > 0 ? activeSources : ['none']
  const status: VisionStatus = {
    availability: params.enabled ? 'available' : 'unavailable',
    enabled: params.enabled,
    activeSources: resolvedSources,
    cameraPermission: params.cameraPermission ?? 'unknown',
    screenPermission: params.screenPermission ?? 'unknown',
    latestEvent: params.looking
      ? {
          type: 'ui_signal',
          summary: `Looking: ${params.looking}`,
          source: resolvedSources.includes('screen') ? 'screen' : resolvedSources.includes('camera') ? 'camera' : 'none',
          timestamp: Date.now(),
        }
      : null,
    updatedAt: Date.now(),
  }

  if (status.enabled && !status.activeSources.includes('none')) {
    status.availability = 'available'
  }

  return status
}

const VISUAL_QUESTION_PATTERN =
  /\b(?:see|seeing|look|looking|watch|watching|show(?:ing)?|camera|screen|display|window|read|reading|says|said|color|colour|wearing|shirt|room|dark|bright|lighting|holding|gesture|hand|person|people|behind|visible|pictured|image|photo|scene)\b|what(?:'s| is| are)\s+(?:on|in|around|behind|visible|shown|displayed|this|that|there)\b/i

function questionScope(question: string): 'camera' | 'screen' | 'either' | null {
  if (!VISUAL_QUESTION_PATTERN.test(question)) return null
  if (/\b(?:screen|display|window|tab|page|interface|monitor)\b/i.test(question)) return 'screen'
  if (/\b(?:shirt|wearing|room|dark|bright|lighting|holding|gesture|hand|person|people|behind|camera)\b/i.test(question)) return 'camera'
  return 'either'
}

/** True when the wording targets a visible display, window, tab, or UI. */
export function isScreenVisionQuestion(question: string): boolean {
  return questionScope(question) === 'screen'
}

function observationSupportsQuestion(observation: VisionObservation, question: string): boolean {
  const screenQuestion = /\b(?:screen|display|window|tab|page|interface|monitor)\b/i.test(question)

  switch (observation.type) {
    case 'hand_gesture': {
      if (observation.source !== 'camera' || screenQuestion
        || !/\b(?:gesture|pose|point|peace|open hand|fist|frame|pinch|which hand|left hand|right hand|hand side)\b/i.test(question)) {
        return false
      }
      const observedGesture = observation.metadata?.gesture
      const requestedGesture = question.match(/\b(point|peace|open|fist|frame|pinch)\b/i)?.[1]?.toLowerCase()
      if (requestedGesture && observedGesture !== requestedGesture) return false
      const observedSide = observation.metadata?.handedness
      const requestedSide = question.match(/\b(left|right) hand\b/i)?.[1]?.toLowerCase()
      return !requestedSide || observedSide === requestedSide
    }
    case 'screen_observation':
      return observation.source === 'screen' && screenQuestion
    case 'text_observation':
      return screenQuestion
        ? observation.source === 'screen'
        : /\b(?:text|read|reading|says|written|words?|sign|label)\b/i.test(question)
          && observation.source === 'camera'
    case 'room_observation':
      return observation.source === 'camera'
        && !screenQuestion
        && /\b(?:room|dark|bright|lighting|environment|surroundings)\b/i.test(question)
    case 'scene_observation':
      return observation.source === 'camera'
        && !screenQuestion
        && /\b(?:scene|visible|see|seeing|around|desk|table|object|thing|what(?:'s| is))\b/i.test(question)
    case 'object_detected':
      return observation.source === 'camera'
        && !screenQuestion
        && /\b(?:object|thing|item|holding|desk|table|what(?:'s| is))\b/i.test(question)
    case 'person_detected':
      return observation.source === 'camera'
        && !screenQuestion
        && !/\bwho\b/i.test(question)
        && /\b(?:person|people|someone|behind|beside|near)\b/i.test(question)
    case 'presence_update':
      return observation.source === 'camera'
        && !screenQuestion
        && /\b(?:person|people|someone|present|presence|here|behind)\b/i.test(question)
    default:
      return false
  }
}

/** Only real published observations can enter response context; model prose and UI signals cannot. */
export function getGroundedVisionContext(
  question: string,
  options: GroundedVisionContextOptions,
): GroundedVisionContext {
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? VISION_EVIDENCE_MAX_AGE_MS
  const visualQuestion = questionScope(question) !== null
  const freshRelevant = options.enabled && visualQuestion
    ? options.observations
      .filter((observation) => {
        const age = now - observation.timestamp
        return observation.source !== 'none'
          && Number.isFinite(observation.timestamp)
          && age >= 0
          && age <= maxAgeMs
          && observationSupportsQuestion(observation, question)
      })
      .sort((a, b) => b.timestamp - a.timestamp)
    : []
  const latestByEvidence = new Map<string, VisionObservation>()
  for (const observation of freshRelevant) {
    const handId = observation.type === 'hand_gesture' ? observation.metadata?.handId : undefined
    const key = `${observation.source}:${observation.type}:${handId ?? ''}`
    if (!latestByEvidence.has(key)) latestByEvidence.set(key, observation)
  }
  const observations = Array.from(latestByEvidence.values()).map((observation) => ({
    ...observation,
    metadata: observation.metadata ? { ...observation.metadata } : undefined,
  }))
  const sources = Array.from(new Set(
    observations
      .map(({ source }) => source)
      .filter((source): source is Exclude<VisionSource, 'none'> => source !== 'none'),
  ))
  const agesMs = observations.map(({ timestamp }) => now - timestamp)
  const observedAt = observations.length > 0
    ? Math.max(...observations.map(({ timestamp }) => timestamp))
    : null
  const supportsFrameInput = observations.some(({ source, type }) =>
    (source === 'screen' && (type === 'screen_observation' || type === 'text_observation'))
    || (source === 'camera' && (
      type === 'scene_observation'
      || type === 'room_observation'
      || type === 'object_detected'
      || type === 'person_detected'
      || type === 'text_observation'
    )),
  )
  const constraint = !visualQuestion
    ? 'This turn does not ask about visual details. Do not claim to see or infer visual details without current evidence. Do not mention vision availability unless the user asks about it; answer the actual conversational request.'
    : !options.enabled
    ? 'Vision is OFF. No current visual evidence is available. Do not claim to see, recognize, read, detect, or observe anything; do not guess or infer visual details from conversation or prior turns. State that current visual evidence is unavailable.'
    : observations.length > 0
      ? `Use only these fresh Vision observations for the visual question; do not extrapolate beyond their type, source, summary, or metadata. Evidence: ${observations.map((observation) => JSON.stringify({
          type: observation.type,
          source: observation.source,
          summary: observation.summary,
          timestamp: observation.timestamp,
          metadata: observation.metadata,
        })).join('; ')}`
      : questionScope(question) === 'screen' && !options.screenMonitorEnabled
        ? 'The request is about the desktop screen, but screen monitoring is off. Do not claim you can inspect the current window or interact with it. Tell the user to enable Screen/Monitor All, then ask them to repeat the request. Do not imply camera Vision alone provides desktop content.'
        : questionScope(question) === 'screen'
          ? 'This is a desktop-screen request, but no fresh screen observation was received for this turn. Do not claim you can inspect the current window or interact with it. Say the screen read did not return usable evidence and ask the user to retry or check screen sharing.'
          : 'No fresh, relevant Vision observation supports visual claims in this turn. If asked about visual details, do not guess or infer from conversation or prior turns; state that current visual evidence is unavailable or insufficient.'

  return {
    enabled: options.enabled,
    visualQuestion,
    observations,
    sources,
    observedAt,
    agesMs,
    fresh: observations.length > 0,
    supportsVisualAnswering: observations.length > 0,
    supportsFrameInput,
    constraint,
  }
}

export function canMakeVisualClaim(context: GroundedVisionContext): boolean {
  return context.enabled && context.fresh && context.supportsVisualAnswering
}

export class VisionClient implements IVisionClient {
  private status: VisionStatus
  private listeners = new Set<(status: VisionStatus) => void>()
  private observationListeners = new Set<(observation: VisionObservation) => void>()
  private observations: VisionObservation[] = []
  private frameSequence = 0

  constructor(options: VisionClientOptions = {}) {
    const initialSources: VisionSource[] = normalizeActiveSources(options.initialStatus?.activeSources)

    this.status = {
      ...defaultVisionStatus,
      ...options.initialStatus,
      activeSources: initialSources,
      updatedAt: Date.now(),
    }
  }

  private emit(): void {
    const snapshot = this.getStatus()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private setStatus(patch: Partial<VisionStatus>): void {
    const nextActiveSources: VisionSource[] = patch.activeSources
      ? normalizeActiveSources(patch.activeSources)
      : [...this.status.activeSources]

    this.status = {
      ...this.status,
      ...patch,
      activeSources: nextActiveSources,
      latestEvent: Object.prototype.hasOwnProperty.call(patch, 'latestEvent')
        ? patch.latestEvent ? { ...patch.latestEvent } : null
        : this.status.latestEvent ? { ...this.status.latestEvent } : null,
      updatedAt: Date.now(),
    }
    this.emit()
  }

  getStatus(): VisionStatus {
    return {
      ...this.status,
      activeSources: [...this.status.activeSources],
      latestEvent: this.status.latestEvent ? { ...this.status.latestEvent } : null,
    }
  }

  subscribe(listener: (status: VisionStatus) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getObservations(): VisionObservation[] {
    return this.observations.map((observation) => ({
      ...observation,
      metadata: observation.metadata ? { ...observation.metadata } : undefined,
    }))
  }

  setEnabled(enabled: boolean): void {
    if (!enabled) this.observations = []
    this.setStatus({
      enabled,
      availability: enabled ? 'available' : 'unavailable',
    })
  }

  syncFromUiState(state: {
    enabled?: boolean
    gestures?: boolean
    screenMonitor?: boolean
    looking?: string | null
    cameraPermission?: VisionPermission
    screenPermission?: VisionPermission
    activeSources?: VisionSource[]
  }): void {
    const enabled = state.enabled ?? this.status.enabled
    const gestures = state.gestures ?? false
    const screenMonitor = state.screenMonitor ?? false
    const looking = state.looking ?? null

    const derived = deriveVisionStatus({
      enabled,
      gestures,
      screenMonitor,
      looking,
      cameraPermission: state.cameraPermission ?? this.status.cameraPermission,
      screenPermission: state.screenPermission ?? this.status.screenPermission,
      activeSources: state.activeSources ?? undefined,
    })

    if (!enabled) this.observations = []
    this.setStatus({
      ...derived,
      latestEvent: derived.latestEvent
        ?? (this.status.latestEvent?.type !== 'ui_signal' ? this.status.latestEvent : null),
      enabled,
    })
  }

  getActiveSources(): VisionSource[] {
    return [...this.status.activeSources]
  }

  sampleCurrentFrame(source: Exclude<VisionSource, 'none'>): VisionFrameSample | null {
    if (!this.status.enabled) return null

    const payload = camera.sampleActiveFrame(source)
    if (!payload) return null

    return {
      id: `vision-frame-${++this.frameSequence}`,
      source,
      timestamp: Date.now(),
      width: payload.width,
      height: payload.height,
      payload,
    }
  }

  publishObservation(observation: VisionObservation): boolean {
    if (!this.status.enabled) return false

    const normalized: VisionObservation = {
      ...observation,
      metadata: observation.metadata ? { ...observation.metadata } : undefined,
    }
    this.observations.push(normalized)
    if (this.observations.length > 64) this.observations.shift()
    this.recordEvent({
      type: normalized.type,
      summary: normalized.summary,
      source: normalized.source,
      confidence: normalized.confidence,
      timestamp: normalized.timestamp,
    })
    for (const listener of this.observationListeners) {
      listener({
        ...normalized,
        metadata: normalized.metadata ? { ...normalized.metadata } : undefined,
      })
    }
    return true
  }

  subscribeObservations(listener: (observation: VisionObservation) => void): () => void {
    this.observationListeners.add(listener)
    return () => {
      this.observationListeners.delete(listener)
    }
  }

  setAvailability(availability: VisionAvailability): void {
    this.setStatus({ availability })
  }

  setPermission(kind: 'camera' | 'screen', permission: VisionPermission): void {
    const next = kind === 'camera'
      ? { cameraPermission: permission }
      : { screenPermission: permission }

    this.setStatus(next)
  }

  setActiveSources(sources: VisionSource[]): void {
    const normalized: VisionSource[] = Array.from(new Set<VisionSource>(sources)).filter(
      (source): source is VisionSource => source === 'camera' || source === 'screen' || source === 'none',
    )
    const nextSources: VisionSource[] = normalized.length > 0 ? normalized : ['none']
    this.setStatus({ activeSources: nextSources })
  }

  recordEvent(event: Omit<VisionEvent, 'timestamp'> & { timestamp?: number }): void {
    this.setStatus({
      latestEvent: {
        ...event,
        timestamp: event.timestamp ?? Date.now(),
      },
    })
  }
}

export const createVisionClient = (options?: VisionClientOptions): IVisionClient => new VisionClient(options)

export const visionClient: IVisionClient = createVisionClient()

export type VisionProcessorMetadata = {
  id: string
  name: string
  supportedSources: readonly Exclude<VisionSource, 'none'>[]
  enabled: boolean
  availability: VisionAvailability
  supportedObservationTypes?: readonly VisionEventType[]
}

export interface IVisionProcessor {
  readonly metadata: VisionProcessorMetadata
  process(sample: VisionFrameSample): Promise<VisionObservation[]>
}

export type VisionProcessorFailure = {
  processorId: string
  message: string
}

export type VisionProcessResult = {
  observations: VisionObservation[]
  processorsAttempted: number
  processorsFailed: VisionProcessorFailure[]
}

export type VisionTriggerReason =
  | 'manual'
  | 'screen_monitor'
  | 'gesture'
  | 'explicit_request'
  | 'ambient'

export type VisionTrigger = {
  reason: VisionTriggerReason
  timestamp?: number
  requestedSource?: Exclude<VisionSource, 'none'>
  metadata?: Record<string, unknown>
}

export type VisionSamplingSkipReason =
  | 'vision_disabled'
  | 'no_active_source'
  | 'requested_source_inactive'
  | 'source_unavailable_or_not_ready'
  | 'sampling_failed'

export type VisionSamplingSkip = {
  source: VisionSource
  reason: VisionSamplingSkipReason
  message?: string
}

export type VisionSamplingPolicyInput = {
  status: VisionStatus
  trigger: VisionTrigger
  activeSources: readonly VisionSource[]
}

export type VisionSamplingDecision = {
  allowed: boolean
  selectedSources: Exclude<VisionSource, 'none'>[]
  skippedSources: VisionSamplingSkip[]
}

export interface VisionSamplingPolicy {
  decide(input: VisionSamplingPolicyInput): VisionSamplingDecision
}

export const defaultVisionSamplingPolicy: VisionSamplingPolicy = {
  decide({ status, trigger, activeSources }) {
    if (!status.enabled) {
      const sources: VisionSource[] = trigger.requestedSource
        ? [trigger.requestedSource]
        : activeSources.filter(
            (source): source is Exclude<VisionSource, 'none'> => source === 'camera' || source === 'screen',
          )
      const skippedSourceList: VisionSource[] = sources.length > 0 ? sources : ['none']
      const skippedSources: VisionSamplingSkip[] = skippedSourceList.map((source) => ({
        source,
        reason: 'vision_disabled',
      }))
      return {
        allowed: false,
        selectedSources: [],
        skippedSources,
      }
    }

    const active = Array.from(new Set(activeSources.filter(
      (source): source is Exclude<VisionSource, 'none'> => source === 'camera' || source === 'screen',
    )))

    if (trigger.requestedSource) {
      if (active.includes(trigger.requestedSource)) {
        return {
          allowed: true,
          selectedSources: [trigger.requestedSource],
          skippedSources: [],
        }
      }
      return {
        allowed: true,
        selectedSources: [],
        skippedSources: [{ source: trigger.requestedSource, reason: 'requested_source_inactive' }],
      }
    }

    if (active.length === 0) {
      return {
        allowed: true,
        selectedSources: [],
        skippedSources: [{ source: 'none', reason: 'no_active_source' }],
      }
    }

    return { allowed: true, selectedSources: active, skippedSources: [] }
  },
}

export type VisionCycleProcessorFailure = VisionProcessorFailure & {
  source: Exclude<VisionSource, 'none'>
}

export type VisionCycleResult = {
  trigger: VisionTrigger
  requestedSources: VisionSource[]
  selectedSources: Exclude<VisionSource, 'none'>[]
  sampledSources: Exclude<VisionSource, 'none'>[]
  skippedSources: VisionSamplingSkip[]
  processorsAttempted: number
  processorsFailed: VisionCycleProcessorFailure[]
  observations: VisionObservation[]
  startedAt: number
  completedAt: number
}

export class VisionProcessorCoordinator {
  private readonly processors = new Map<string, IVisionProcessor>()
  private readonly client: IVisionClient

  constructor(client: IVisionClient = visionClient) {
    this.client = client
  }

  registerProcessor(processor: IVisionProcessor): void {
    if (this.processors.has(processor.metadata.id)) {
      throw new Error(`Vision processor "${processor.metadata.id}" is already registered.`)
    }
    this.processors.set(processor.metadata.id, processor)
  }

  unregisterProcessor(id: string): boolean {
    return this.processors.delete(id)
  }

  getProcessors(): VisionProcessorMetadata[] {
    return Array.from(this.processors.values(), ({ metadata }) => ({
      ...metadata,
      supportedSources: [...metadata.supportedSources],
      supportedObservationTypes: metadata.supportedObservationTypes
        ? [...metadata.supportedObservationTypes]
        : undefined,
    }))
  }

  async processSample(sample: VisionFrameSample): Promise<VisionProcessResult> {
    const result: VisionProcessResult = {
      observations: [],
      processorsAttempted: 0,
      processorsFailed: [],
    }
    if (!this.client.getStatus().enabled) return result

    const applicable = Array.from(this.processors.values()).filter(({ metadata }) =>
      metadata.enabled
      && metadata.availability === 'available'
      && metadata.supportedSources.includes(sample.source),
    )

    for (const processor of applicable) {
      result.processorsAttempted++
      try {
        const observations = await processor.process(sample)
        if (!Array.isArray(observations)) {
          throw new TypeError(`Vision processor "${processor.metadata.id}" did not return an observation array.`)
        }
        for (const observation of observations) {
          if (this.client.publishObservation(observation)) {
            result.observations.push(observation)
          }
        }
      } catch (error) {
        result.processorsFailed.push({
          processorId: processor.metadata.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return result
  }
}

export const visionProcessorCoordinator = new VisionProcessorCoordinator(visionClient)

export async function runVisionCycle(
  trigger: VisionTrigger,
  options: {
    client?: IVisionClient
    coordinator?: VisionProcessorCoordinator
    policy?: VisionSamplingPolicy
  } = {},
): Promise<VisionCycleResult> {
  const startedAt = Date.now()
  const client = options.client ?? visionClient
  const coordinator = options.coordinator ?? visionProcessorCoordinator
  const policy = options.policy ?? defaultVisionSamplingPolicy
  const status = client.getStatus()
  const activeSources = client.getActiveSources()
  const decision = policy.decide({ status, trigger, activeSources })
  const requestedSources: VisionSource[] = trigger.requestedSource
    ? [trigger.requestedSource]
    : activeSources.filter((source): source is Exclude<VisionSource, 'none'> =>
        source === 'camera' || source === 'screen',
      )
  const result: VisionCycleResult = {
    trigger: { ...trigger, timestamp: trigger.timestamp ?? startedAt },
    requestedSources: requestedSources.length > 0 ? requestedSources : ['none'],
    selectedSources: [...decision.selectedSources],
    sampledSources: [],
    skippedSources: [...decision.skippedSources],
    processorsAttempted: 0,
    processorsFailed: [],
    observations: [],
    startedAt,
    completedAt: startedAt,
  }

  if (decision.allowed) {
    for (const source of decision.selectedSources) {
      let sample: VisionFrameSample | null
      try {
        sample = client.sampleCurrentFrame(source)
      } catch (error) {
        result.skippedSources.push({
          source,
          reason: 'sampling_failed',
          message: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      if (!sample) {
        result.skippedSources.push({ source, reason: 'source_unavailable_or_not_ready' })
        continue
      }
      result.sampledSources.push(source)

      try {
        const processed = await coordinator.processSample(sample)
        result.processorsAttempted += processed.processorsAttempted
        result.processorsFailed.push(
          ...processed.processorsFailed.map((failure) => ({ ...failure, source })),
        )
        result.observations.push(...processed.observations)
      } catch (error) {
        result.processorsFailed.push({
          source,
          processorId: 'coordinator',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  result.completedAt = Date.now()
  return result
}

/** Sparse screen observations; the existing screen monitor remains authoritative. */
export const SCREEN_MONITOR_VISION_CADENCE_MS = 4_000
/** Ambient sampling is opt-in and deliberately slower than screen monitoring. */
export const AMBIENT_VISION_CADENCE_MS = 20_000
/** Suppress repeated qualifying gesture triggers during one short look window. */
export const GESTURE_VISION_COOLDOWN_MS = 1_500

export type VisionSchedulerState = {
  screenMonitorActive: boolean
  ambientActive: boolean
  cycleRunning: boolean
  lastCycleAt: number | null
  lastTriggerReason: VisionTriggerReason | null
  gestureCooldownUntil: number | null
  skippedRecurringTicks: number
  lastError: string | null
}

export type VisionSchedulerOptions = {
  client?: IVisionClient
  runCycle?: (trigger: VisionTrigger) => Promise<VisionCycleResult>
  screenMonitorCadenceMs?: number
  ambientCadenceMs?: number
  gestureCooldownMs?: number
  now?: () => number
  setInterval?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void
}

export class VisionScheduler {
  private readonly client: IVisionClient
  private readonly runCycle: (trigger: VisionTrigger) => Promise<VisionCycleResult>
  private readonly screenMonitorCadenceMs: number
  private readonly ambientCadenceMs: number
  private readonly gestureCooldownMs: number
  private readonly now: () => number
  private readonly setIntervalFn: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>
  private readonly clearIntervalFn: (timer: ReturnType<typeof setInterval>) => void
  private readonly listeners = new Set<(state: VisionSchedulerState) => void>()
  private readonly unsubscribeStatus: () => void
  private screenMonitorTimer: ReturnType<typeof setInterval> | null = null
  private ambientTimer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<VisionCycleResult> | null = null
  private gestureCooldownUntil: number | null = null
  private lastCycleAt: number | null = null
  private lastTriggerReason: VisionTriggerReason | null = null
  private skippedRecurringTicks = 0
  private lastError: string | null = null
  private screenMonitorRequested = false
  private disposed = false

  constructor(options: VisionSchedulerOptions = {}) {
    this.client = options.client ?? visionClient
    this.runCycle = options.runCycle ?? ((trigger) => runVisionCycle(trigger, { client: this.client }))
    this.screenMonitorCadenceMs = options.screenMonitorCadenceMs ?? SCREEN_MONITOR_VISION_CADENCE_MS
    this.ambientCadenceMs = options.ambientCadenceMs ?? AMBIENT_VISION_CADENCE_MS
    this.gestureCooldownMs = options.gestureCooldownMs ?? GESTURE_VISION_COOLDOWN_MS
    this.now = options.now ?? Date.now
    this.setIntervalFn = options.setInterval ?? ((callback, delayMs) => setInterval(callback, delayMs))
    this.clearIntervalFn = options.clearInterval ?? ((timer) => clearInterval(timer))
    this.unsubscribeStatus = this.client.subscribe((status) => {
      if (!status.enabled) {
        this.clearScreenMonitorTimer()
        this.stopAmbient()
        this.gestureCooldownUntil = null
        this.emit()
        return
      }
      this.reconcileScreenMonitor()
    })
  }

  getState(): VisionSchedulerState {
    return {
      screenMonitorActive: this.screenMonitorTimer !== null,
      ambientActive: this.ambientTimer !== null,
      cycleRunning: this.inFlight !== null,
      lastCycleAt: this.lastCycleAt,
      lastTriggerReason: this.lastTriggerReason,
      gestureCooldownUntil: this.gestureCooldownUntil,
      skippedRecurringTicks: this.skippedRecurringTicks,
      lastError: this.lastError,
    }
  }

  subscribe(listener: (state: VisionSchedulerState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }

  private execute(trigger: VisionTrigger, recurring: boolean): Promise<VisionCycleResult> | null {
    if (this.disposed || !this.client.getStatus().enabled) return null
    if (this.inFlight) {
      if (recurring) {
        this.skippedRecurringTicks++
        this.emit()
        return null
      }
      return this.inFlight
    }

    this.lastTriggerReason = trigger.reason
    const work = Promise.resolve().then(() => this.runCycle({ ...trigger, timestamp: trigger.timestamp ?? this.now() }))
    this.inFlight = work
    this.lastError = null
    this.emit()
    void work.then(
      (result) => {
        this.lastCycleAt = result.completedAt
      },
      (error: unknown) => {
        this.lastCycleAt = this.now()
        this.lastError = error instanceof Error ? error.message : String(error)
      },
    ).finally(() => {
      if (this.inFlight === work) this.inFlight = null
      this.emit()
    })
    return work
  }

  private recurringTick(trigger: VisionTrigger): void {
    const cycle = this.execute(trigger, true)
    if (cycle) {
      void cycle.catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.emit()
      })
    }
  }

  triggerNow(options: { requestedSource?: Exclude<VisionSource, 'none'>; explicit?: boolean } = {}): Promise<VisionCycleResult> | null {
    return this.execute({
      reason: options.explicit ? 'explicit_request' : 'manual',
      requestedSource: options.requestedSource,
    }, false)
  }

  triggerFromGesture(
    requestedSource?: Exclude<VisionSource, 'none'>,
    metadata?: Record<string, unknown>,
  ): Promise<VisionCycleResult> | null {
    if (this.disposed || !this.client.getStatus().enabled) return null
    const now = this.now()
    if (this.gestureCooldownUntil !== null && now < this.gestureCooldownUntil) return null
    this.gestureCooldownUntil = now + this.gestureCooldownMs
    this.emit()
    return this.execute({ reason: 'gesture', requestedSource, timestamp: now, metadata }, false)
  }

  setScreenMonitorEnabled(screenMonitorEnabled: boolean): boolean {
    if (this.disposed) return false
    this.screenMonitorRequested = screenMonitorEnabled
    if (!screenMonitorEnabled) {
      this.clearScreenMonitorTimer()
      this.emit()
      return false
    }
    return this.reconcileScreenMonitor()
  }

  private reconcileScreenMonitor(): boolean {
    const canSchedule = !this.disposed
      && this.screenMonitorRequested
      && this.client.getStatus().enabled
      && this.client.getActiveSources().includes('screen')
    if (!canSchedule) {
      this.clearScreenMonitorTimer()
      return false
    }
    if (this.screenMonitorTimer !== null) return true
    this.screenMonitorTimer = this.setIntervalFn(() => {
      if (!this.client.getStatus().enabled) {
        this.clearScreenMonitorTimer()
        return
      }
      if (!this.client.getActiveSources().includes('screen')) {
        this.clearScreenMonitorTimer()
        return
      }
      this.recurringTick({ reason: 'screen_monitor', requestedSource: 'screen' })
    }, this.screenMonitorCadenceMs)
    this.emit()
    return true
  }

  stopScreenMonitor(): void {
    this.screenMonitorRequested = false
    this.clearScreenMonitorTimer()
  }

  private clearScreenMonitorTimer(): void {
    if (this.screenMonitorTimer === null) return
    this.clearIntervalFn(this.screenMonitorTimer)
    this.screenMonitorTimer = null
    this.emit()
  }

  startAmbient(): boolean {
    if (this.disposed || this.ambientTimer !== null || !this.client.getStatus().enabled) return false
    this.ambientTimer = this.setIntervalFn(() => {
      if (!this.client.getStatus().enabled) {
        this.stopAmbient()
        return
      }
      this.recurringTick({ reason: 'ambient' })
    }, this.ambientCadenceMs)
    this.emit()
    return true
  }

  stopAmbient(): void {
    if (this.ambientTimer === null) return
    this.clearIntervalFn(this.ambientTimer)
    this.ambientTimer = null
    this.emit()
  }

  dispose(): void {
    if (this.disposed) return
    this.screenMonitorRequested = false
    this.stopScreenMonitor()
    this.stopAmbient()
    this.unsubscribeStatus()
    this.disposed = true
    this.listeners.clear()
  }
}

export const visionScheduler = new VisionScheduler()

export type GestureVisionEvent = {
  gesture: string
  timestamp: number
  handId: number
  handedness: string
}

let gestureObservationSequence = 0

export function gestureEventToObservation(event: GestureVisionEvent): VisionObservation | null {
  if (event.gesture === 'none') return null

  const hand = event.handedness === 'right' ? 'Right' : 'Left'
  return {
    id: `vision-observation-${event.timestamp}-${++gestureObservationSequence}`,
    type: 'hand_gesture',
    source: 'camera',
    summary: `${hand} hand: ${event.gesture}`,
    timestamp: event.timestamp,
    metadata: {
      gesture: event.gesture,
      handId: event.handId,
      handedness: event.handedness,
    },
  }
}

export function connectGestureVision(
  subscribe: (listener: (event: GestureVisionEvent) => void) => () => void,
  scheduler: VisionScheduler = visionScheduler,
  client: IVisionClient = visionClient,
): () => void {
  return subscribe((event) => {
    const observation = gestureEventToObservation(event)
    if (observation && client.publishObservation(observation) && import.meta.env.DEV) {
      console.info(`[Vision] observation ${observation.type}: ${observation.summary}`, {
        timestamp: observation.timestamp,
        metadata: observation.metadata,
      })
    }

    // Point is the existing deliberate attention pose; other poses are not look requests.
    if (event.gesture !== 'point') return
    const cycle = scheduler.triggerFromGesture(undefined, {
      gesture: event.gesture,
      handId: event.handId,
      handedness: event.handedness,
    })
    if (cycle) {
      if (import.meta.env.DEV) console.info('[Vision] gesture requested look cycle')
      void cycle.catch(() => {})
    }
  })
}

export const getDefaultVisionStatus = (): VisionStatus => ({
  ...defaultVisionStatus,
  activeSources: [...defaultVisionStatus.activeSources],
  latestEvent: null,
})
