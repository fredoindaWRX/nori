import type { AskHandlers, VideoProgress } from './anthropic'
import type { Blade, Panel } from '../store'
import { BRIDGE_WS_URL } from '../config'
import { observeBridgeNeuralSignal, clearNeuralSignals } from '../scene/neural-signals'
import { createNeuralEventLedger } from '../../bridge/neural-event-contract.mjs'
import { validPersonalitySnapshot, type PersonalityProfile, type PersonalitySnapshot } from '../../bridge/personality/profile.mjs'
import { setSpeechPersonality } from './tts'
import {
  validateScreenPerceptionRequest,
  validateScreenPerceptionResponse,
  type ScreenPerceptionResponse,
} from '../../bridge/screen-perception-contract.mjs'

/**
 * Client for the local bridge (see bridge/server.mjs).
 *
 * Same `ask()` shape as the browser-direct path, so App.tsx doesn't care which
 * brain is behind it. The difference is what's reachable: this one runs on your
 * machine, so every MCP server in your Claude Code config is in play.
 *
 * The socket is the session. The bridge holds one Claude Agent SDK query per
 * connection and the whole conversation lives inside it, so a dropped socket
 * silently wipes N.O.R.I.'s memory of the exchange while the transcript on screen
 * still shows it. That is why the reconnect below is loud rather than
 * invisible: `watchConnection` exists so the HUD can say so.
 */

/** Anything the bridge sends. Deliberately loose — a frame from a future
 *  bridge build should be ignored, not crash the turn. */
type Frame = {
  type?: string
  delta?: string
  name?: string
  text?: string
  message?: string
  panel?: Panel
  blade?: Blade
  op?: string
  args?: unknown
  id?: string
  ask?: string
  reason?: string
  mode?: string
  alert?: string | null
  error?: string | { code?: unknown }
  response?: unknown
  capability?: unknown
  seconds?: number
  when?: string
  index?: number
  title?: string
  servers?: Array<string | { name?: string }>
  model?: string
  effort?: string
  models?: { id: string; label: string }[]
  efforts?: string[]
  resumed?: boolean
  personality?: unknown
  progress?: unknown
}

function readVideoProgress(value: unknown): VideoProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { stage, completedShots, totalShots, durationSeconds, elapsedMs } = value as Partial<VideoProgress>
  if (!['preparing', 'generating', 'assembling', 'verifying'].includes(stage ?? '')
    || typeof totalShots !== 'number' || !Number.isSafeInteger(totalShots) || totalShots < 1
    || typeof completedShots !== 'number' || !Number.isSafeInteger(completedShots) || completedShots < 0 || completedShots > totalShots
    || typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0
    || typeof elapsedMs !== 'number' || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0) return null
  return { stage: stage as VideoProgress['stage'], completedShots, totalShots, durationSeconds, elapsedMs }
}

/** Every question gets an id so its answer can be told from anyone else's. */
let askSeq = 0

let socket: WebSocket | null = null
let connecting: Promise<WebSocket> | null = null

/** Server names reported by the bridge, for the HUD readout. */
let servers: string[] = []
export const bridgeServers = () => servers

/** The list arrives twice — once from config, once with live status — so the
 *  HUD subscribes rather than reading it a single time at boot. */
let onServers: ((s: string[]) => void) | null = null
export function watchServers(fn: (s: string[]) => void) {
  onServers = fn
  fn(servers)
}

/** What the bridge is running, as reported on every ready message. */
export type BridgeInfo = {
  model: string
  effort: string
  models: { id: string; label: string }[]
  efforts: string[]
  resumed: boolean
}
let onInfo: ((info: BridgeInfo) => void) | null = null
let latestInfo: BridgeInfo | null = null

/** The coding-work panel (nori-coding-chat script) owns coding registration and run cards. */
type CodingChat = {
  registerTurn(turn: { rawGoal: string; clientTurnId: string; onCancel: () => void }): Promise<unknown>
  receiveBridge(frame: Frame, ask: string): boolean
  finishTurn(ask: string): void
  interrupt(): void
  reset(): void
}
const codingChat = () => (globalThis as { noriCodingChat?: CodingChat }).noriCodingChat
export function watchBridgeInfo(fn: (info: BridgeInfo) => void) {
  onInfo = fn
  if (latestInfo) fn(latestInfo)
}

/** The settings panel. Any of these restarts the agent session on the bridge;
 *  model and effort keep the conversation, `fresh` starts it over. */
export function configure(patch: { model?: string; effort?: string; fresh?: boolean; personality?: Partial<PersonalityProfile> }): Promise<void> {
  return connect().then((ws) => {
    if (ws.readyState !== WebSocket.OPEN) throw new Error('Nori is reconnecting. Try again when the bridge is ready.')
    if (patch.fresh) codingChat()?.reset()
    ws.send(JSON.stringify({ type: 'config', ...patch }))
  })
}

/** Panels arrive out of band — they're pushed while a turn is in flight,
 *  not returned by it. */
let onPanel: ((panel: Panel) => void) | null = null
export function watchPanels(fn: (panel: Panel) => void) {
  onPanel = fn
}

/**
 * The one request the bridge makes of us rather than the other way round.
 *
 * Everything else on this socket is pushed at the browser and needs no answer.
 * A camera frame has to travel back, so this handler is registered by the app
 * and its result is returned against the request's id.
 */
export type CaptureRequest = {
  /** 'look' for a single frame, 'watch' for a grid over time. */
  mode: 'look' | 'watch'
  reason: string
  seconds: number
  /** 'now' records forward; 'past' reads the rolling buffer. */
  when: 'now' | 'past'
}
export type CaptureResult = { data?: string; mimeType?: string; error?: string }

let onCapture: ((req: CaptureRequest) => Promise<CaptureResult>) | null = null
export function watchCapture(fn: (req: CaptureRequest) => Promise<CaptureResult>) {
  onCapture = fn
}

export type TabsHandler = (
  op: 'show' | 'hide' | 'close' | 'rename',
  index: number,
  title?: string,
) => void
let onTabs: TabsHandler | null = null
export function watchTabs(fn: TabsHandler) {
  onTabs = fn
}

/** Blades arrive the same way panels do — pushed mid-turn, so the article is
 *  already open as he starts the sentence about it. */
let onBlade: ((blade: Blade) => void) | null = null
export function watchBlades(fn: (blade: Blade) => void) {
  onBlade = fn
}

/** Commands that redress the interface — theme, reactor, orbits, effects. Same
 *  out-of-band route as panels: N.O.R.I. issues them while he is still mid-answer
 *  so the change is on screen as he says it, which means they cannot ride back
 *  on the turn's result. The op/args pair stays untyped here on purpose — this
 *  module is a transport, and the store is where the shape is decided. */
let onUi: ((op: string, args: any) => void) | null = null
export function watchUi(fn: (op: string, args: any) => void) {
  onUi = fn
}

/**
 * Connection state, for the UI.
 *
 *   'open'        — first connection of the page.
 *   'lost'        — the socket died. The agent session died with it, so
 *                   everything said so far is gone as far as N.O.R.I. knows.
 *   'reconnected' — we're back, on a fresh session with no memory of the above.
 */
export type ConnectionState = 'open' | 'lost' | 'reconnected'
let onConnection: ((state: ConnectionState) => void) | null = null
export function watchConnection(fn: (state: ConnectionState) => void) {
  onConnection = fn
}

export function isConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN
}

let latestPersonality: PersonalitySnapshot | null = null
const personalityListeners = new Set<(value: PersonalitySnapshot | null, error?: string) => void>()
export function watchPersonality(fn: (value: PersonalitySnapshot | null, error?: string) => void): () => void {
  personalityListeners.add(fn)
  fn(latestPersonality)
  return () => { personalityListeners.delete(fn) }
}
function publishPersonality(value: PersonalitySnapshot | null, error?: string) {
  latestPersonality = value
  setSpeechPersonality(value)
  for (const fn of personalityListeners) fn(value, error)
}

const screenMonitorRequests = new Map<string, {
  resolve: (result: { alert: string | null; error?: string }) => void
  timer: number
}>()
const screenPerceptionRequests = new Map<string, {
  sampleId: string
  capturedAt: number
  resolve: (result: ScreenPerceptionResult) => void
  timer: number
}>()
const screenPerceptionCapabilityRequests = new Map<string, {
  resolve: (result: ScreenPerceptionCapability) => void
  timer: number
}>()

export type ScreenPerceptionResult =
  | { ok: true; response: ScreenPerceptionResponse }
  | { ok: false; error: { code: string } }

export type ScreenPerceptionCapability = {
  available: boolean
  backendId: string | null
  modelId: string | null
  imageCapable: boolean
  structuredOutput: boolean
  errorCode?: string
}

function isScreenPerceptionCapability(value: unknown): value is ScreenPerceptionCapability {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'available' in value
    && typeof value.available === 'boolean'
    && 'backendId' in value
    && (value.backendId === null || typeof value.backendId === 'string')
    && 'modelId' in value
    && (value.modelId === null || typeof value.modelId === 'string')
    && 'imageCapable' in value
    && typeof value.imageCapable === 'boolean'
    && 'structuredOutput' in value
    && typeof value.structuredOutput === 'boolean'
    && (!('errorCode' in value) || typeof value.errorCode === 'string')
}

/** Inspect only local backend/model capability; this does not sample a screen. */
export async function getScreenPerceptionCapability(): Promise<ScreenPerceptionCapability> {
  let ws: WebSocket
  try {
    ws = await connect()
    await firstReady.promise
  } catch {
    return { available: false, backendId: null, modelId: null, imageCapable: false, structuredOutput: false, errorCode: 'bridge_unavailable' }
  }
  if (ws.readyState !== WebSocket.OPEN) {
    return { available: false, backendId: null, modelId: null, imageCapable: false, structuredOutput: false, errorCode: 'bridge_unavailable' }
  }

  const id = globalThis.crypto?.randomUUID?.() ?? `screen-capability-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      screenPerceptionCapabilityRequests.delete(id)
      resolve({ available: false, backendId: null, modelId: null, imageCapable: false, structuredOutput: false, errorCode: 'capability_timeout' })
    }, 8_000)
    screenPerceptionCapabilityRequests.set(id, { resolve, timer })
    try {
      ws.send(JSON.stringify({ type: 'screen-perception-capability', id }))
    } catch {
      clearTimeout(timer)
      screenPerceptionCapabilityRequests.delete(id)
      resolve({ available: false, backendId: null, modelId: null, imageCapable: false, structuredOutput: false, errorCode: 'bridge_unavailable' })
    }
  })
}

/** Arm/disarm local-only proactive vision on the bridge for this connection. */
export async function setScreenMonitorActive(active: boolean): Promise<void> {
  const ws = await connect()
  await firstReady.promise
  if (ws.readyState !== WebSocket.OPEN) throw new Error('Nori vision bridge is not connected.')
  ws.send(JSON.stringify({ type: 'screen-monitor-state', active }))
}

/** Send one frame from the explicitly shared screen to the local vision model. */
export async function scanSharedScreen(frame: { data: string; mimeType: string }): Promise<{ alert: string | null; error?: string }> {
  const ws = await connect()
  await firstReady.promise
  if (ws.readyState !== WebSocket.OPEN) throw new Error('Nori vision bridge is not connected.')
  const id = globalThis.crypto?.randomUUID?.() ?? `monitor-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      screenMonitorRequests.delete(id)
      reject(new Error('Local screen scan timed out.'))
    }, 45_000)
    screenMonitorRequests.set(id, { resolve, timer })
    try {
      ws.send(JSON.stringify({ type: 'screen-monitor-frame', id, frame }))
    } catch (error) {
      clearTimeout(timer)
      screenMonitorRequests.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }

  })
}

/** Separate structured-perception RPC. The legacy alert API remains unchanged. */
export async function perceiveSharedScreen(input: {
  sampleId: string
  capturedAt: number
  frame: { data: string; mimeType: string }
}): Promise<ScreenPerceptionResult> {
  let ws: WebSocket
  try {
    ws = await connect()
    await firstReady.promise
  } catch {
    return { ok: false, error: { code: 'bridge_unavailable' } }
  }
  if (ws.readyState !== WebSocket.OPEN) return { ok: false, error: { code: 'bridge_unavailable' } }

  const id = globalThis.crypto?.randomUUID?.() ?? `screen-perception-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const request = {
    id,
    sampleId: input.sampleId,
    source: 'screen',
    capturedAt: input.capturedAt,
    frame: input.frame,
  }
  const checked = validateScreenPerceptionRequest(request)
  if (!checked.ok) return { ok: false, error: checked.error }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      screenPerceptionRequests.delete(id)
      resolve({ ok: false, error: { code: 'perception_timeout' } })
    }, 45_000)
    screenPerceptionRequests.set(id, { sampleId: input.sampleId, capturedAt: input.capturedAt, resolve, timer })
    try {
      ws.send(JSON.stringify({ type: 'screen-perception-frame', ...request }))
    } catch {
      clearTimeout(timer)
      screenPerceptionRequests.delete(id)
      resolve({ ok: false, error: { code: 'bridge_unavailable' } })
    }
  })
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Resolved by the socket-level dispatcher on the first `ready` of the current
 *  connection. Re-armed per connection so a reconnect re-announces. */
let firstReady = deferred()

let everConnected = false

/** Backoff for the automatic re-dial. It gives up after the last delay rather
 *  than retrying forever — a bridge that has been down for half a minute is
 *  usually one you stopped on purpose, and the next ask() re-dials anyway. */
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 8000]
let attempt = 0
let reconnectTimer = 0

function scheduleReconnect() {
  if (attempt >= RECONNECT_DELAYS.length) return
  const delay = RECONNECT_DELAYS[attempt]
  attempt += 1
  clearTimeout(reconnectTimer)
  reconnectTimer = window.setTimeout(() => {
    void connect().catch(() => {})
  }, delay)
}

/**
 * One message listener per socket, owning everything that isn't part of a
 * turn. It used to live inside warmBridge, bound to that one socket: after any
 * reconnect the SYSTEM rail froze for the life of the page, and every extra
 * warmBridge() call leaked another listener onto the same socket.
 */
function dispatch(ws: WebSocket) {
  ws.addEventListener('message', (e: MessageEvent) => {
    let msg: Frame
    try {
      msg = JSON.parse(e.data as string)
    } catch {
      return
    }

    if (msg.type === 'ready') {
      if (validPersonalitySnapshot(msg.personality)) publishPersonality(msg.personality)
      // The bridge announces immediately on connect from Claude Code's config,
      // then again with live status once the agent initialises. Keep listening
      // so the later, more accurate list wins.
      servers = (msg.servers ?? [])
        .map((s) => (typeof s === 'string' ? s : (s.name ?? '')))
        .filter(Boolean)
      onServers?.(servers)
      if (Array.isArray(msg.models)) {
        latestInfo = {
          model: String(msg.model ?? ''),
          effort: String(msg.effort ?? ''),
          models: msg.models,
          efforts: Array.isArray(msg.efforts) ? msg.efforts : [],
          resumed: Boolean(msg.resumed),
        }
        onInfo?.(latestInfo)
      }
      firstReady.resolve()
    } else if (msg.type === 'personality' && validPersonalitySnapshot(msg.personality)) {
      publishPersonality(msg.personality)
    } else if (msg.type === 'personality-error') {
      publishPersonality(latestPersonality, String(msg.message ?? 'Personality update failed.').slice(0, 200))
    } else if (msg.type === 'panel' && msg.panel) {
      onPanel?.(msg.panel)
    } else if (msg.type === 'blade' && msg.blade) {
      onBlade?.(msg.blade)
    } else if (msg.type === 'tabs' && msg.op && typeof msg.index === 'number') {
      onTabs?.(msg.op as Parameters<TabsHandler>[0], msg.index, msg.title)
    } else if (msg.type === 'capture' && msg.id) {
      const id = msg.id
      const reply = (payload: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'reply', id, ...payload }))
        }
      }
      if (!onCapture) {
        reply({ error: 'The interface has no camera handler.' })
      } else {
        // Always answers, even on failure: the bridge is holding a turn open
        // waiting for this, and a rejection that never arrives is a turn that
        // hangs until the idle timer notices.
        onCapture({
          mode: msg.mode === 'watch' ? 'watch' : 'look',
          reason: msg.reason ?? '',
          seconds: Math.max(2, Math.min(15, Number(msg.seconds) || 6)),
          when: msg.when === 'past' ? 'past' : 'now',
        })
          .then(reply)
          .catch((err) => reply({ error: String(err?.message ?? err) }))
      }
    } else if (msg.type === 'screen-monitor-result' && typeof msg.id === 'string') {
      const request = screenMonitorRequests.get(msg.id)
      if (!request) return
      screenMonitorRequests.delete(msg.id)
      clearTimeout(request.timer)
      request.resolve({ alert: typeof msg.alert === 'string' ? msg.alert : null,
        ...(typeof msg.error === 'string' ? { error: msg.error } : {}) })
    } else if (msg.type === 'screen-perception-result' && typeof msg.id === 'string') {
      const request = screenPerceptionRequests.get(msg.id)
      if (!request) return
      screenPerceptionRequests.delete(msg.id)
      clearTimeout(request.timer)
      if (msg.error && typeof msg.error === 'object' && typeof msg.error.code === 'string') {
        request.resolve({ ok: false, error: { code: msg.error.code.slice(0, 48) } })
        return
      }
      const checked = validateScreenPerceptionResponse(msg.response, {
        requestId: msg.id,
        sampleId: request.sampleId,
        capturedAt: request.capturedAt,
      })
      if (!checked.ok) {
        request.resolve({ ok: false, error: checked.error })
      } else if (checked.response.status === 'error') {
        request.resolve({ ok: false, error: { code: checked.response.errorCode ?? 'perception_unavailable' } })
      } else {
        request.resolve({ ok: true, response: checked.response })
      }
    } else if (msg.type === 'screen-perception-capability-result' && typeof msg.id === 'string') {
      const request = screenPerceptionCapabilityRequests.get(msg.id)
      if (!request) return
      screenPerceptionCapabilityRequests.delete(msg.id)
      clearTimeout(request.timer)
      const capability = msg.capability
      if (!isScreenPerceptionCapability(capability)) {
        request.resolve({ available: false, backendId: null, modelId: null, imageCapable: false, structuredOutput: false, errorCode: 'invalid_capability_response' })
        return
      }
      request.resolve({
        available: capability.available,
        backendId: capability.backendId?.slice(0, 64) ?? null,
        modelId: capability.modelId?.slice(0, 128) ?? null,
        imageCapable: capability.imageCapable,
        structuredOutput: capability.structuredOutput,
        ...(typeof capability.errorCode === 'string' ? { errorCode: capability.errorCode.slice(0, 48) } : {}),
      })
    } else if (msg.type === 'ui' && msg.op) {
      // A `ui` frame with no args is normal — reset and clear take none — so an
      // absent args object is an empty one, not a reason to drop the command.
      onUi?.(msg.op, (msg.args ?? {}) as Record<string, unknown>)
    }
  })
}

function connect(): Promise<WebSocket> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
  if (connecting) return connecting

  firstReady = deferred()

  connecting = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(BRIDGE_WS_URL)
    let settled = false

    /**
     * Every terminal path runs through here, and clearing `connecting` is the
     * whole point. The timeout used to reject without clearing it, which
     * bricked the client: the fast path above hands that same dead promise to
     * every later caller, so one slow start cost you a page reload.
     */
    const settle = (err: Error | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      connecting = null
      if (err) reject(err)
      else resolve(ws)
    }

    const timer = setTimeout(() => {
      ws.close()
      settle(new Error('Bridge not responding — is `npm run bridge` running?'))
    }, 6000)

    ws.onopen = () => {
      socket = ws
      attempt = 0
      dispatch(ws)
      settle(null)
      onConnection?.(everConnected ? 'reconnected' : 'open')
      everConnected = true
    }
    ws.onerror = () => {
      /**
       * The browser will not tell us why.
       *
       * A refused handshake and a rejected Origin arrive here identically — no
       * status, no reason, just `error` — and the two have completely different
       * fixes. The old message named only one of them, and confidently: it said
       * to start the bridge. When the real cause was the page being served on a
       * port outside the range the bridge trusts, that advice sent everyone to
       * inspect a process that was running perfectly the whole time.
       *
       * So say both, and put the actual port in front of them, since that is
       * the fact that distinguishes the two cases at a glance.
       */
      settle(
        new Error(
          `Cannot reach the bridge at ${BRIDGE_WS_URL}. Either it is not ` +
            'running, or it refused this interface origin. ' +
            `This page is on ${location.port || '80'}.`,
        ),
      )
    }
    ws.onclose = () => {
      // A close before open is just a failed dial; after open it's a lost
      // session, and the two want different handling.
      settle(new Error('The bridge closed the connection.'))
      if (socket === ws) {
        socket = null
        servers = []
        onServers?.(servers)
        latestInfo = null
        publishPersonality(null)
        onConnection?.('lost')
        scheduleReconnect()
      }
    }
  })

  return connecting
}

/** Open the socket early so the first "Hey Nori" isn't waiting on a handshake. */
export async function warmBridge(): Promise<void> {
  await connect()
  // Don't block startup if the bridge never announces — the dispatcher fills
  // the rail in whenever the list does turn up.
  await Promise.race([
    firstReady.promise,
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ])
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/**
 * No valid activity for two minutes means the turn is never coming back.
 * Generous on purpose: a long agent run can sit silent through a slow tool,
 * and cutting a real answer off is worse than waiting. What this catches is
 * the case that used to hang forever — the bridge alive but the turn lost.
 * Video progress must belong to this turn; a stale heartbeat cannot keep it alive.
 */
const IDLE_TIMEOUT_MS = 120_000

/** The turn in flight, so a barge-in can settle it locally. */
let pending: { finish: (fallback?: string) => void } | null = null

export async function ask(
  prompt: string,
  handlers: AskHandlers,
  image?: { data: string; mimeType: string } | null,
  context?: string,
  attachment?: { filename: string; text: string },
): Promise<{ text: string; tools: string[] }> {
  /**
   * A new question supersedes the one in flight.
   *
   * Two concurrent turns genuinely would corrupt each other — both listeners
   * see every delta, and the first 'done' resolves both with the other's text —
   * but refusing the new one was the wrong way to prevent that. It surfaced as
   * "N.O.R.I. is already answering", which is a sentence about this module's
   * bookkeeping rather than about anything the user did, and it contradicts the
   * premise the whole app is built on: say something and it becomes the turn.
   *
   * It fired far more than it looked like it should, because the only thing
   * that cleared the slot was a barge-in — and a barge-in only fires in guard
   * mode. A transcript can arrive well after the speech that produced it: the
   * segment queue means several can be waiting, and their onsets happened while
   * the machine was still listening, when nothing interrupts. So the second
   * utterance of a normal sentence could land on a turn that was already
   * running and simply be refused.
   *
   * Cancelling settles the old promise synchronously, so by the time the code
   * below claims the slot there is nothing left to collide with. The abandoned
   * turn's caller sees its own `stale()` check and stands down quietly.
   */
  if (pending) cancel()

  // Claim the slot in this same tick. connect() below awaits, and two calls
  // made before it settles would otherwise both sail past the check above.
  let cancelledWhileDialling = false
  pending = {
    finish: () => {
      cancelledWhileDialling = true
    },
  }

  let ws: WebSocket
  try {
    ws = await connect()
  } catch (err) {
    pending = null
    throw err
  }

  // Barged in on before the socket was even up. Nothing was ever asked.
  if (cancelledWhileDialling) {
    pending = null
    return { text: '', tools: [] }
  }

  const id = `a${++askSeq}`
  const neuralLedger = createNeuralEventLedger(id)
  const tools: string[] = []
  let text = ''

  // A coding request is registered with its project session first; without consent the
  // panel holds it until the owner allows the project, and nothing is sent until then.
  let codingBinding: unknown = null
  try {
    codingBinding = await codingChat()?.registerTurn({ rawGoal: prompt, clientTurnId: id, onCancel: cancel }) ?? null
  } catch (err) {
    neuralLedger.close()
    pending = null
    throw err
  }
  if (cancelledWhileDialling) {
    neuralLedger.close()
    pending = null
    return { text: '', tools: [] }
  }

  return new Promise((resolve, reject) => {
    let done = false
    let timer = 0
    let hasVideoProgress = false

    const cleanup = () => {
      done = true
      codingChat()?.finishTurn(id)
      neuralLedger.close()
      pending = null
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('close', onClose)
      ws.removeEventListener('error', onError)
      if (hasVideoProgress) {
        hasVideoProgress = false
        try { handlers.onProgress?.(null) } catch { /* Cleanup must still settle the turn. */ }
      }
    }

    const finish = (fallback = '') => {
      if (done) return
      cleanup()
      // Prefer the streamed text; fall back to the final result if this build
      // didn't emit deltas.
      resolve({ text: (text || fallback).trim(), tools })
    }

    const fail = (err: Error) => {
      if (done) return
      clearNeuralSignals()
      cleanup()
      reject(err)
    }

    const arm = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        fail(new Error('The bridge went quiet — that turn was lost.'))
      }, IDLE_TIMEOUT_MS)
    }

    const onMessage = (e: MessageEvent) => {
      let msg: Frame
      try {
        msg = JSON.parse(e.data as string)
      } catch {
        // A frame we can't read is not a reason to abandon the turn. It used
        // to be: the parse threw inside the listener, nothing settled the
        // promise, and App's `busy` flag stayed true for the life of the page.
        return
      }

      /**
       * Somebody else's answer.
       *
       * A superseded turn keeps streaming for a moment after it is abandoned,
       * and this listener is attached to the socket rather than to a turn — so
       * without this check the tail of the old answer is read as the beginning
       * of the new one. Measured before it existed: ask for ALPHA, barge in,
       * ask for BRAVO, and BRAVO's answer came back as "ALPHA".
       */
      if (msg.ask && msg.ask !== id) return

      if (msg.type === 'coding_run_event') {
        if (msg.ask === id && codingChat()?.receiveBridge(msg, id)) arm()
        return
      }

      if (msg.type === 'video_progress') {
        // Only validated progress for this exact turn is a heartbeat. It is
        // neither assistant speech nor a new tool invocation/completion.
        if (msg.ask !== id) return
        const progress = readVideoProgress(msg.progress)
        if (!progress) return
        arm()
        hasVideoProgress = true
        try { handlers.onProgress?.(progress) } catch { /* Progress display is best effort. */ }
        return
      }

      arm()

      observeBridgeNeuralSignal(msg, id, performance.now(), neuralLedger)

      try {
        switch (msg.type) {
          case 'text':
            text += msg.delta ?? ''
            handlers.onText(msg.delta ?? '')
            break

          case 'tool':
            if (!msg.name) break
            tools.push(msg.name)
            handlers.onTool(prettyToolName(msg.name))
            break

          case 'done':
            finish(msg.text ?? '')
            break

          case 'error':
            fail(new Error(msg.message ?? 'The bridge reported an error.'))
            break
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)))
      }
    }

    const onClose = () => {
      fail(new Error('The bridge disconnected mid-answer — that session is gone.'))
    }
    const onError = () => {
      fail(new Error('The connection to the bridge failed.'))
    }

    pending = { finish }
    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', onClose)
    ws.addEventListener('error', onError)
    arm()

    try {
      ws.send(JSON.stringify({ type: 'ask', text: prompt, id, image: image ?? undefined,
        context: context || undefined, attachment: attachment ?? undefined,
        ...(codingBinding ? { codingOwnerBinding: codingBinding } : {}) }))
    } catch (err) {
      // The socket can go into CLOSING between connect() resolving and here.
      fail(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/**
 * Cut N.O.R.I. off mid-answer.
 *
 * Tells the bridge to stop, then settles the in-flight turn here rather than
 * waiting for a 'done' that a barge-in may never produce. Whatever he had
 * already said is returned, so the caller's await always comes back and the
 * transcript keeps the half-sentence the user actually heard.
 */
export function cancel(): void {
  codingChat()?.interrupt()
  clearNeuralSignals()
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'interrupt' }))
  }
  pending?.finish()
}

/** The older name for `cancel()`. */
export function interrupt(): void {
  cancel()
}

/** `mcp__higgsfield__generate_image` -> `higgsfield · generate image` */
function prettyToolName(raw: string): string {
  if (!raw.startsWith('mcp__')) return raw
  const [, server, ...rest] = raw.split('__')
  return `${server} · ${rest.join(' ').replace(/_/g, ' ')}`
}
