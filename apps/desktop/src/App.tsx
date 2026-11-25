import { useEffect, useRef } from 'react'
import { Hud } from './ui/Hud'
import { Boot } from './ui/Boot'
import { Ignition } from './ui/Ignition'
import { Diagnostics } from './ui/Diagnostics'
import { resolveSubsystem } from './lib/subsystem'
import { useStore } from './store'
import { startVoice, type Voice, type VoiceMode } from './lib/voice'
import { BARE_NAME, LEADING_NAME } from './lib/wake'
import { createSpeaker, cycleVoice, currentVoiceName, watchVoice } from './lib/tts'
import * as sfx from './lib/sfx'
import * as music from './lib/music'
import * as hands from './lib/hands'
import { listenForClap } from './lib/clap'
import * as camera from './lib/camera'
import {
  canMakeVisualClaim,
  connectGestureVision,
  getGroundedVisionContext,
  isScreenVisionQuestion,
  visionProcessorCoordinator,
  visionClient,
  visionScheduler,
} from './lib/vision'
import { ScreenVisionProcessor, registerScreenVisionProcessor } from './lib/screenVisionProcessor'
import { forTool, attention } from './lib/fillers'
import {
  ask,
  warm,
  interrupt,
  watchServers,
  watchPanels,
  watchBlades,
  watchTabs,
  watchBridgeInfo,
  watchCapture,
  watchUi,
  watchConnection,
  connectedLabels,
  usingBridge,
  getScreenPerceptionCapability,
  perceiveSharedScreen,
  setScreenMonitorActive,
  type Msg,
} from './lib/brain'
import { startAnalyser, micLevel, setMicMuted, setEchoStrict } from './lib/audio'
import { probeCapabilities } from './lib/capabilities'
import { prepareVoiceInput } from './lib/voice-startup'
import { createSingleFlight } from './lib/single-flight'
import { createWakeRetrySchedule } from './lib/wake-retry-schedule'
import { env } from './config'

/**
 * What is open on the tab strip, riding in front of what the user said.
 *
 * The local model does not automatically know which in-app tabs are open, so
 * "look at the pricing tab" needs this small UI-owned map. Prepended to the
 * prompt only, never to the transcript or history.
 */
function tabContext(): string {
  const { blades, hiddenBlades, focusedBlade, expandedBlade } = useStore.getState()
  if (!blades.length) return ''
  const visible = [...blades].reverse().filter((b) => !hiddenBlades.includes(b.id))
  const front = expandedBlade ?? focusedBlade ?? visible[0]?.id
  const list = blades
    .map((b, i) => {
      const where = hiddenBlades.includes(b.id) ? 'tucked away' : b.id === front ? 'in front' : 'open'
      const src = b.url ? `, ${b.url}` : ''
      return `${i + 1} "${b.title}" (${b.kind}${src}, ${where})`
    })
    .join('; ')
  return `[Open tabs: ${list}]`
}

/**
 * The conversation.
 *
 * This used to be a sequential loop — greet, await a capture, await an answer,
 * repeat — with the microphone opened and closed around each step. That shape
 * cannot be interrupted: while it is awaiting the answer, nothing is listening,
 * so there is no way for the user to get a word in.
 *
 * It is an event machine now. The voice loop runs continuously and pushes
 * events at us; every one of them is legal in every phase. Saying anything at
 * all stops him talking, and whatever you say next becomes the new turn.
 */

/** How long to wait for someone to start speaking after he wakes. Generous:
 *  people say his name and *then* think about what they wanted. */
const AWAIT_SPEECH_MS = 14000

/** After an answer, how long the mic stays open for a follow-up before he
 *  drops back to standby. Long enough that you don't have to say the name
 *  again to continue a thought. 30 s since 2026-11-18 (owner: talk back and
 *  forth like Jarvis); it was 11 s. */
const FOLLOW_UP_MS = 30000

/** crypto.randomUUID needs a secure context, which a LAN address over plain
 *  http is not. Not worth failing a whole turn over an id. */
const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** Explicit stop phrases are still recognised after transcription, but normal
 *  speech now also takes the floor immediately through onSpeechStart. */
const STOP_WORD =
  /^(?:stop|cancel|wait|hold on|enough|quiet|shut up|never ?mind|forget it)(?:\s+(?:that|it|there|now|please))?[\s,.!?]*$/i
const BUSY = new Set(['thinking', 'tooling', 'speaking'])

const screenVisionProcessor = new ScreenVisionProcessor({
  getCapability: getScreenPerceptionCapability,
  perceive: perceiveSharedScreen,
})

export default function App() {
  const store = useStore
  const phase = useStore((s) => s.phase)
  const muted = useStore((s) => s.muted)
  const history = useRef<Msg[]>([])
  const speaker = useRef<ReturnType<typeof createSpeaker> | null>(null)
  const voice = useRef<Voice | null>(null)
  const wakeRetryHandler = useRef<((failure: 'unavailable' | 'transient') => void) | null>(null)
  // The boot sequence and the always-armed wake effect may both reach startup
  // while getUserMedia is pending. They must share one VAD/Whisper loop: the
  // browser grants one shared stream, but two recognizers would compete for it.
  const startVoiceFlight = useRef(createSingleFlight<Voice>())

  /**
   * Monotonic turn counter. Every await in a turn checks it on the way out:
   * if it has moved, that turn was superseded by a barge-in and must not touch
   * the phase, the speaker, or the busy state on its way to the floor.
   */
  const turn = useRef(0)
  const monitorSignature = useRef<number[] | null>(null)
  const screenMonitor = useStore((s) => s.screenMonitor)
  const booting = useRef(false)
  useEffect(() => watchVoice(name => store.getState().setVoice(name)), [store])
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let mounted = true
    const unregister = registerScreenVisionProcessor(screenVisionProcessor, visionProcessorCoordinator)
    void getScreenPerceptionCapability()
      .then((capability) => {
        if (mounted) screenVisionProcessor.setCapability(capability)
      })
      .catch(() => {
        if (mounted) {
          screenVisionProcessor.setCapability({
            available: false,
            backendId: null,
            modelId: null,
            imageCapable: false,
            structuredOutput: false,
            errorCode: 'capability_unavailable',
          })
        }
      })
    return () => {
      mounted = false
      unregister()
    }
  }, [])

  // Standby must show the real local model and settings, even when the intro
  // has not run. Subscribe before dialing; this does not arm any sensor or
  // submit a model turn. ignite() may safely warm the same socket again.
  useEffect(() => {
    if (!usingBridge) return
    let mounted = true
    watchServers((servers) => { if (mounted) store.getState().setConnected(servers) })
    watchBridgeInfo((info) => { if (mounted) store.getState().setBridge(info) })
    watchConnection((state) => {
      if (!mounted) return
      if (state === 'lost') store.getState().setError('Bridge connection lost — reconnecting.')
      else if (state === 'reconnected') store.getState().setError(
        'Bridge reconnected. Check the conversation before continuing.',
      )
    })
    void warm().catch((err: Error) => { if (mounted) store.getState().setError(err.message) })
    return () => { mounted = false }
  }, [store])

  // Ending the share disarms the browser-preview monitor. Desktop mode captures
  // every connected display through the native, explicitly armed monitor.
  useEffect(() => {
    const off = camera.onScreenState((active) => {
      if (active || window.noriWorkspace?.captureDisplays) return
      monitorSignature.current = null
      useStore.getState().setScreenMonitor(false)
      void setScreenMonitorActive(false).catch(() => {})
    })
    return () => {
      off()
      void setScreenMonitorActive(false).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const syncScreenMonitor = () => {
      visionScheduler.setScreenMonitorEnabled(useStore.getState().screenMonitor)
    }
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.screenMonitor !== previous.screenMonitor) syncScreenMonitor()
    })
    syncScreenMonitor()
    return () => {
      unsubscribe()
      visionScheduler.setScreenMonitorEnabled(false)
    }
  }, [])

  useEffect(
    () => connectGestureVision(hands.subscribeGestureEvents, visionScheduler),
    [],
  )

  // Scan changed frames from every connected desktop display. Never upload
  // them off-device, never inspect the webcam, and only speak while idle.
  useEffect(() => {
    if (!screenMonitor) return
    if (!camera.monitorCaptureAvailable()) {
      useStore.getState().setScreenMonitor(false)
      void setScreenMonitorActive(false).catch(() => {})
      return
    }

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const scan = async () => {
      if (stopped) return
      let scanStage: 'capture' | 'analysis' = 'capture'
      try {
        if (!camera.monitorCaptureAvailable()) {
          useStore.getState().setScreenMonitor(false)
          void setScreenMonitorActive(false).catch(() => {})
          return
        }
        // Leave the model and conversation alone while the user is interacting.
        if (useStore.getState().phase !== 'dormant') {
          timer = setTimeout(scan, 12_000)
          return
        }
        const frame = await camera.frameForAllMonitors()
        if (stopped || !useStore.getState().screenMonitor) return
        if (!frame) {
          timer = setTimeout(scan, 12_000)
          return
        }
        const changed = camera.screenChanged(monitorSignature.current, frame.signature)
        monitorSignature.current = frame.signature
        if (changed) {
          scanStage = 'analysis'
          const sampleId = `screen-monitor-${Date.now()}`
          const sampleAt = Date.now()
          const observations = await screenVisionProcessor.processEncodedFrame({
            id: sampleId,
            timestamp: sampleAt,
            frame: { data: frame.data, mimeType: frame.mimeType },
          })
          if (stopped) return
          for (const observation of observations) visionClient.publishObservation(observation)
        }
      } catch (err) {
        if (!stopped) {
          console.warn('[nori] local screen monitor stopped:', err)
          useStore.getState().setScreenMonitor(false)
          useStore.getState().setError(scanStage === 'capture'
            ? '<span class="text-green-600">Nori Vision</span> stopped because not all screens could be captured. Check your connected displays, then turn MONITOR back on.'
            : '<span class="text-green-600">Nori Vision</span> stopped during local screen analysis. Check the local model runtime, then turn MONITOR back on.')
          void setScreenMonitorActive(false).catch(() => {})
        }
        return
      }
      if (!stopped && useStore.getState().screenMonitor) timer = setTimeout(scan, 12_000)
    }
    timer = setTimeout(scan, 1000)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      void setScreenMonitorActive(false).catch(() => {})
    }
  }, [screenMonitor])

  // -- helpers --------------------------------------------------------------

  const clearIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = null
  }

  const silence = () => {
    speaker.current?.cancel()
    speaker.current = null
  }

  const goDormant = () => {
    clearIdle()
    silence()
    turn.current++
    const s = store.getState()
    s.clearQueue()
    s.setCaption('')
    s.setActiveTool(null)
    music.working(false)
    music.duck(false)
    sfx.duck(false)
    s.setPhase('dormant')
  }

  /** Open the mic and wait. `window` is how long before he gives up. */
  const listen = (window: number) => {
    clearIdle()
    const s = store.getState()
    s.setCaption('')
    s.setPhase('listening')
    sfx.play('listen')
    idleTimer.current = setTimeout(goDormant, window)
  }

  /**
   * Space, held to talk. Straight into listening with no greeting: the greeting
   * is what made Space unreliable — in strict noise mode N.O.R.I. speaking his own
   * line suppressed the user talking over it, so the command was dropped. The
   * "…" shows at once so it is obvious he is capturing.
   */
  const pushToTalk = () => {
    silence()
    store.getState().setError(null)
    listen(AWAIT_SPEECH_MS)
    store.getState().setCaption('…')
  }

  // -- one turn -------------------------------------------------------------

  const respond = async (said: string, attachment?: { data?: string; text?: string; mimeType?: string; name: string }): Promise<void> => {
    const mine = ++turn.current
    const stale = () => mine !== turn.current

    clearIdle()
    const s = store.getState()
    // Last turn's panels go now, before the new answer starts putting its own
    // up. Blades do not: they are tabs, and stay open until the user closes one.
    s.clearPanels()
    s.setCaption('')
    s.setActiveTool(null)
    s.pushTurn({ id: newId(), role: 'user', text: said })
    s.setPhase('thinking')

    const spk = createSpeaker()
    speaker.current = spk
    sfx.duck(true)
    music.duck(true)

    const turnId = newId()
    let started = false
    let filled = false
    let videoProgressActive = false

    try {
      // A short follow-up such as "ChatGPT window" is still an explicit
      // screen request. Refresh the already-armed local monitor before
      // grounding the answer instead of relying on a periodic scan.
      if (isScreenVisionQuestion(said)
        && useStore.getState().screenMonitor
        && visionClient.getStatus().enabled) {
        try {
          const frame = await camera.frameForAllMonitors()
          if (frame && !stale()) {
            const observations = await screenVisionProcessor.processEncodedFrame({
              id: `screen-turn-${turnId}`,
              timestamp: Date.now(),
              frame: { data: frame.data, mimeType: frame.mimeType },
            })
            if (!stale()) {
              for (const observation of observations) visionClient.publishObservation(observation)
            }
          }
        } catch (error) {
          console.warn('[nori] fresh local screen evidence unavailable:', error)
        }
      }
      const grounded = getGroundedVisionContext(said, {
        enabled: visionClient.getStatus().enabled,
        screenMonitorEnabled: useStore.getState().screenMonitor,
        observations: visionClient.getObservations(),
      })
      if (grounded.visualQuestion && import.meta.env.DEV) {
        console.info(grounded.supportsVisualAnswering
          ? `[Vision Grounding] using ${grounded.observations.length} fresh ${grounded.observations.map(({ type }) => type).join(', ')} observation(s)`
          : '[Vision Grounding] visual evidence unavailable')
      }
      // A user-selected attachment is explicit input. Shared frames still
      // require fresh, relevant evidence before they can ride along.
      const image = attachment?.data && attachment.mimeType
        ? { data: attachment.data, mimeType: attachment.mimeType }
        : (grounded.supportsFrameInput ? camera.frameForTurn() : null)
      // A user-selected image is explicit input. Shared-screen frames still
      // require fresh, relevant evidence before they may be attached.
      const context = [tabContext(), grounded.constraint].filter(Boolean).join('\n\n')
      const { text, tools } = await ask(said, history.current, {
        onText: (delta) => {
          if (stale()) return
          if (!started || videoProgressActive) {
            store.getState().setPhase('speaking')
            // A video has an initial spoken notice and a final answer with a
            // real work phase between them. Resume speech when text returns.
            store.getState().setActiveTool(null)
            videoProgressActive = false
            music.working(false)
          }
          if (!started) {
            started = true
            store.getState().pushTurn({ id: turnId, role: 'nori', text: '' })
          }
          store.getState().appendToLastTurn(delta)
          spk.push(delta)
        },
        onTool: (name) => {
          if (stale()) return
          videoProgressActive = false
          // Only claim the tooling phase while he has nothing to say yet.
          // Setting it unconditionally pinned the machine in 'tooling' for the
          // rest of any answer that called a tool after it started talking,
          // which also broke the reactor's lip-sync for the remainder.
          if (!started) store.getState().setPhase('tooling')
          store.getState().setActiveTool(name)
          sfx.play('tool')
          // Say something the moment work starts — a tool can take ten seconds
          // and silence that long reads as a crash. Once per turn only; a
          // chain of five tools shouldn't produce five apologies.
          if (!filled && !started) {
            filled = true
            spk.say(forTool(name))
          }
        },
        onProgress: (progress) => {
          if (stale()) return
          if (!progress) {
            if (videoProgressActive) store.getState().setActiveTool(null)
            videoProgressActive = false
            return
          }
          videoProgressActive = true
          store.getState().setPhase('tooling')
          const { stage, completedShots, totalShots, durationSeconds, elapsedMs } = progress
          const duration = durationSeconds >= 3600
            ? `${Math.round(durationSeconds / 360) / 10}-hour`
            : durationSeconds >= 120 ? `${Math.round(durationSeconds / 6) / 10}-minute` : `${durationSeconds}-second`
          const label = stage === 'generating'
            ? `Generating shot ${Math.min(completedShots + 1, totalShots)}/${totalShots} for a ${duration} video`
            : stage === 'assembling' ? `Assembling ${totalShots} shots into a ${duration} video`
            : stage === 'verifying' ? `Checking the ${duration} video`
            : `Preparing a ${duration} local video`
          const elapsedSeconds = Math.floor(elapsedMs / 1000)
          const elapsedHours = Math.floor(elapsedSeconds / 3600)
          const elapsedMinutes = Math.floor(elapsedSeconds / 60) % 60
          const elapsed = [
            elapsedHours > 0 ? `${elapsedHours}h` : '',
            elapsedHours > 0 || elapsedMinutes > 0 ? `${elapsedMinutes}m` : '',
            `${elapsedSeconds % 60}s`,
          ].filter(Boolean).join(' ')
          store.getState().setActiveTool(`${label} · elapsed ${elapsed}`)
        },
      }, image, context, attachment?.text ? { filename: attachment.name, text: attachment.text } : undefined)

      if (stale()) return

      // The bridge keeps conversation state in its own session, so history is
      // only threaded through on the direct path.
      if (!usingBridge) {
        history.current.push({ role: 'user', content: said })
        history.current.push({ role: 'assistant', content: text || '…' })
        if (history.current.length > 16) {
          history.current = history.current.slice(-16)
        }
      }

      await spk.end()
      if (stale()) return
      // What the turn ended up being ABOUT, as opposed to what carried it.
      store.getState().tagLastTurn(resolveSubsystem({ tools }))

      sfx.play('done')
    } catch (err) {
      if (stale()) return
      console.error(err)
      sfx.play('error')
      const failure = err instanceof Error ? err.message : 'Something went wrong.'
      store.getState().pushTurn({ id: newId(), role: 'nori', text: `Task failed: ${failure}` })
      store
        .getState()
        .setError(failure)
    } finally {
      if (!stale()) {
        speaker.current = null
        sfx.duck(false)
        music.duck(false)
        store.getState().setActiveTool(null)
        music.working(false)
        // Everything said while he was answering runs now, MERGED into one
        // instruction in the order it was said — not one turn per phrase. Three
        // quick additions become a single coherent ask, which is what the user
        // meant by saying them. Otherwise stay open for a follow-up.
        const q = store.getState().queue
        if (q.length) {
          store.getState().clearQueue()
          void respond(q.join('. '))
        } else {
          listen(FOLLOW_UP_MS)
        }
      }
    }
  }

  /**
   * The terminal's Escape: stop what he is doing and hand the floor back.
   *
   * Busy, it abandons the answer and opens the mic, with the queue intact, so
   * the next thing said runs next. Already idle, it stands him down, which is
   * also what clears the queue. The STOP button on the HUD is the same call.
   */
  const stopOrStandDown = () => {
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot') return
    voice.current?.discardPendingSpeech()
    if (BUSY.has(phase)) {
      clearIdle()
      cutOff()
      // If things were queued while he worked, Escape does not just stop — it
      // takes everything you added and runs it together now, as one re-planned
      // instruction. Nothing queued means a plain stop-and-listen.
      const q = store.getState().queue
      if (q.length) {
        store.getState().clearQueue()
        void respond(q.join('. '))
      } else {
        listen(AWAIT_SPEECH_MS)
      }
    } else {
      goDormant()
    }
  }

  /**
   * Typed input from the on-screen box. Works from any phase, no wake word: if
   * he is busy it joins the coalescing queue, otherwise it runs as a turn now.
   * This is the reliable path that does not touch the microphone at all.
   */
  const submitText = (text: string, attachment?: { data?: string; text?: string; mimeType?: string; name: string }): boolean => {
    const t = text.trim()
    if (!t) return false
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot') return false
    if (attachment && BUSY.has(phase)) {
      store.getState().setError('Wait for Nori to finish this turn before attaching a file, so it stays with your request.')
      return false
    }
    // A typed turn is an input boundary: queued or in-flight microphone
    // audio from before it must not be delivered after the typed message.
    voice.current?.discardPendingSpeech()
    if (BUSY.has(phase)) {
      store.getState().enqueue(t)
      return true
    }
    void respond(t, attachment)
    return true
  }

  /** Abandon the answer in flight, right now. */
  const cutOff = () => {
    silence()
    // The turn counter moves in respond()'s replacement; bumping it here
    // covers the case where nothing replaces it.
    turn.current++
    interrupt()
    store.getState().setActiveTool(null)
    music.working(false)
    sfx.duck(false)
    music.duck(false)
  }

  // -- voice events ---------------------------------------------------------

  /** What the voice loop should do with what it hears, derived from phase. */
  const mode = (): VoiceMode => {
    // Muted means nothing is heard at all, in any phase.
    if (store.getState().muted) return 'deaf'
    switch (store.getState().phase) {
      case 'offline':
      case 'dormant':
        return 'wake'
      case 'boot':
        return 'deaf'
      case 'waking':
      case 'listening':
        return 'command'
      default:
        return 'guard' // thinking, tooling, speaking
    }
  }

  const onWake = (trailing: string) => {
    const phase = store.getState().phase
    if (phase === 'boot' || store.getState().muted) return
    // A recognized local wake reveals the same tray-resident desktop window.
    void window.noriWake?.reveal().catch(() => {})
    if (phase === 'offline') {
      void powerOn().then(() => {
        if (trailing && store.getState().phase === 'dormant') void respond(trailing)
      })
      return
    }

    store.getState().setError(null)
    sfx.play('wake')

    // "Nori, what's happening in AI this week" in one breath. Waiting for a
    // greeting he didn't need is the most common way an assistant wastes time.
    if (trailing) {
      void respond(trailing)
      return
    }

    store.getState().setPhase('waking')

    // Answer to his name. Deliberately NOT awaited any more: the microphone is
    // already open and the echo filter knows his voice, so the user can talk
    // straight over the greeting instead of waiting it out.
    const greeting = createSpeaker()
    speaker.current = greeting
    greeting.say(attention())
    void greeting.end()

    listen(AWAIT_SPEECH_MS)
  }

  /** Someone started talking. Human speech owns the floor: if N.O.R.I. is
   * answering, stop both the audio and the in-flight model turn immediately,
   * then keep recording the interruption as the next command. */
  const onSpeechStart = () => {
    if (store.getState().muted) return
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot' || phase === 'dormant') return

    clearIdle()
    if (BUSY.has(phase)) cutOff()
    else silence()
    store.getState().setPhase('listening')
    store.getState().setCaption('…')
    // If transcription fails after an interruption, do not leave the UI stuck
    // listening forever. A successful utterance clears this in respond().
    idleTimer.current = setTimeout(goDormant, AWAIT_SPEECH_MS)
  }

  const onUtterance = (text: string) => {
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot' || phase === 'dormant') return
    if (store.getState().muted) return

    // People keep using his name as a vocative once they're already talking to
    // him. Strip it rather than sending "nori" to the model as a question.
    if (BARE_NAME.test(text)) {
      listen(AWAIT_SPEECH_MS)
      return
    }
    const said = text.replace(LEADING_NAME, '').trim()
    if (!said) {
      listen(AWAIT_SPEECH_MS)
      return
    }

    // Defensive fallback for engines that deliver words without an onset
    // event. The local VAD normally cut N.O.R.I. off before we reach here.
    if (BUSY.has(phase)) {
      clearIdle()
      cutOff()
      if (STOP_WORD.test(said)) listen(AWAIT_SPEECH_MS)
      else void respond(said)
      return
    }

    void respond(said)
  }

  const onPartial = (text: string) => {
    if (store.getState().muted) return
    store.getState().setCaption(text)
    // Still hearing you: every live partial means speech is ongoing, so push the
    // idle window back. Without this a sentence longer than the listen window
    // (or a slow one) trips goDormant mid-utterance — the "…" vanishes and the
    // rest of what you said is dropped. Only while actually capturing a command.
    if (text) {
      const phase = store.getState().phase
      if (phase === 'listening' || phase === 'waking') {
        clearIdle()
        idleTimer.current = setTimeout(goDormant, AWAIT_SPEECH_MS)
      }
    }
  }

  // Dev console only: feed him a line without a microphone.
  //   __say('what is two plus two')
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__say = onUtterance
  }

  const onVoiceError = (message: string) => {
    store.getState().setError(message)
  }

  // -- power on -------------------------------------------------------------

  const powerOn = async (skip = false) => {
    // The ignition button and the space bar can both land here, and the phase
    // only moves after the first await — so without this a double press boots
    // twice, arming two voice loops and two download polls.
    if (booting.current) return
    booting.current = true
    store.getState().setSkipBoot(skip)

    try {
      await ignite(skip)
    } catch (err) {
      // The guard must not outlive a failed boot. Audio unlock can be refused,
      // the microphone prompt dismissed, the bridge unreachable at the wrong
      // moment — and with the flag still latched the ignition button was dead
      // for the rest of the page, recoverable only by reloading. Reset it and
      // put the button back so the user can simply press it again.
      booting.current = false
      console.error('[nori] power-up failed:', err)
      store.getState().setPhase('offline')
      store
        .getState()
        .setError(
          err instanceof Error
            ? `Power-up failed: ${err.message}`
            : 'Power-up failed. Click to try again.',
        )
    }
  }

  const ignite = async (skip: boolean) => {
    const s = store.getState()

    // Must happen inside the click handler — browsers won't start an
    // AudioContext or speech synthesis without a user gesture.
    await sfx.unlockAudio()
    // Skipping the boot skips its cue and its score too: the rising boot track
    // over an interface that is already up reads as a glitch.
    // Startup remains silent; explicit voice and Read aloud are separate.
    // Initialize the optional work cue without playing a startup score.
    music.enable()

    // The film owns its duration; loading or buffering must not cause a cut.
    const entranceFinished = skip ? Promise.resolve() : new Promise<void>((resolve) => {
      const finish = () => {
        window.clearTimeout(fallback)
        window.removeEventListener('nori-entrance-ended', finish)
        resolve()
      }
      const fallback = window.setTimeout(finish, 30000)
      window.addEventListener('nori-entrance-ended', finish, { once: true })
    })
    s.setPhase('boot')


    watchPanels((panel) => store.getState().pushPanel(panel))
    watchBlades((blade) => store.getState().pushBlade(blade))
    watchTabs((op, index, title) => {
      const st = store.getState()
      const blade = st.blades[index - 1]
      if (!blade) return
      if (op === 'show') {
        if (st.expandedBlade && st.expandedBlade !== blade.id) st.expandBlade(null)
        st.toggleBladeHidden(blade.id, false)
        st.focusBlade(blade.id)
      } else if (op === 'hide') st.toggleBladeHidden(blade.id, true)
      else if (op === 'close') st.closeBlade(blade.id)
      else if (op === 'rename' && title) st.renameBlade(blade.id, title)
    })

    /**
     * N.O.R.I. asking to see something.
     *
     * Announced on screen for as long as it takes, with whatever he said he was
     * looking for. The camera's own light is on too, but a hardware light that
     * appears with no explanation is exactly the thing that makes people
     * distrust an assistant — so the interface says it before they have to ask.
     */
    watchCapture(async (req) => {
      const grounded = getGroundedVisionContext(req.reason, {
        enabled: visionClient.getStatus().enabled,
        screenMonitorEnabled: useStore.getState().screenMonitor,
        observations: visionClient.getObservations(),
      })
      if (!canMakeVisualClaim(grounded) || !grounded.supportsFrameInput) {
        if (import.meta.env.DEV) console.info('[Vision Grounding] visual evidence unavailable')
        return {
          error: 'Current visual evidence is unavailable or insufficient. No camera image was provided.',
        }
      }

      const note =
        req.mode === 'watch'
          ? req.when === 'past'
            ? req.reason || 'reviewing the last few seconds'
            : `${req.reason || 'watching'} · ${req.seconds}s`
          : req.reason || 'taking a look'
      store.getState().setLooking(note)

      // The past is only available if something has been remembering it, and
      // that only happens while the camera is on screen. Answering plainly
      // beats opening the camera and recording the next few seconds instead,
      // which is a different question from the one that was asked.
      if (req.mode === 'watch' && req.when === 'past' && camera.bufferedSeconds() < 1) {
        store.getState().setLooking(null)
        return {
          error:
            'There is no recent footage — the camera has to be open on screen ' +
            'for me to remember what just happened. Ask me to open the camera, ' +
            'and I can watch from then on.',
        }
      }

      // Held for the whole capture. Without this the stream can be torn down by
      // whoever else was using it half way through a six-second watch.
      let held = false
      try {
        await camera.holdCamera()
        held = true
        if (req.mode === 'look') return camera.grabFrame()
        if (req.when === 'past') {
          const grid = camera.recentGrid(req.seconds, 9)
          return grid ?? { error: 'There is not enough recent footage to review.' }
        }
        return await camera.watchAhead(req.seconds, 9)
      } catch (err) {
        return {
          error:
            (err as DOMException)?.name === 'NotAllowedError'
              ? 'The camera is not permitted, so I cannot see anything.'
              : `The camera could not be read: ${(err as Error)?.message ?? err}`,
        }
      } finally {
        if (held) camera.releaseCamera()
        store.getState().setLooking(null)
      }
    })

    // The interface is N.O.R.I.'s to drive. These arrive out of band, pushed
    // mid-turn the way panels are, so a command can retint the reactor or put
    // something into orbit while he is still speaking the sentence about it.
    watchUi((op, args) => {
      const s = store.getState()
      const a = (args ?? {}) as Record<string, never>
      switch (op) {
        case 'patch':
          s.applyUi(args)
          break
        case 'orbit':
          if (a.action === 'add') s.addOrbit(args)
          else if (a.action === 'remove') s.removeOrbit(String(a.id))
          else s.clearOrbits()
          break
        case 'effect':
          s.fireEffect(a.kind)
          break
        case 'reset':
          s.resetUi()
          break
        case 'screen':
          s.clearScreen(a.what ?? 'all')
          break
        default:
          console.warn('[nori] unknown ui op:', op, args)
      }
    })
    // In bridge mode the conversation lives in the agent session, which is tied
    // to the socket — so a drop silently wipes his memory while the transcript
    // on screen still shows it. Better to say so than to let him quietly forget.
    const warming = warm().catch((err: Error) => s.setError(err.message))

    if (!usingBridge && !env.anthropicKey) {
      s.setError(
        'No Anthropic API key — copy .env.example to .env.local and set VITE_ANTHROPIC_API_KEY.',
      )
    }

    // System speech is ready immediately; boot never waits on a model download.

    // Long enough for the four-beat start-up sequence in Boot.tsx to play —
    // status bar, rings, suit schematic, reactor power-up — before the live
    // interface takes over. Kept a touch under the boot cue so the music is
    // still rising as the reactor lands.
    await entranceFinished
    await warming
    store.getState().setConnected(connectedLabels())
    store.getState().setVoice(currentVoiceName())

    // The analyser is what makes the reactor pulse with your voice. It needs a
    // getUserMedia stream; speech recognition does not, and gets its own. So a
    // failure here costs the animation and nothing else — saying "voice input
    // is unavailable" was both alarming and untrue.
    // Check local speech availability before asking for microphone permission.
    await prepareVoiceInput({ probe: probeCapabilities, startAnalyser,
      onAnalyserFailure: () => console.warn(
        '[nori] no microphone stream — the reactor will not pulse with your ' +
          'voice. Speech recognition is unaffected.',
      ),
    })

    // One voice loop, started once, running until the page closes.
    if (!store.getState().muted && !voice.current?.live()) {
      voice.current = await startVoiceFlight.current(() => startVoice({
        mode,
        onWake,
        onSpeechStart,
        onPartial,
        onUtterance,
        onError: onVoiceError,
        onRuntimeFailure: (failure) => wakeRetryHandler.current?.(failure),
      }))
    }
    // The stream only exists once the loop has opened it, so a mute pressed
    // during start-up has to be applied here as well.
    setMicMuted(store.getState().muted)

    store.getState().setPhase('dormant')
  }

  // The window microphone is opt-in. The separate Windows wake listener
  // owns background wake detection when the conversation microphone is off.
  useEffect(() => {
    if (muted) return
    let stopped = false
    const retries = createWakeRetrySchedule()
    let healthyTimer: ReturnType<typeof setTimeout> | null = null
    const markLive = () => {
      if (healthyTimer !== null) clearTimeout(healthyTimer)
      healthyTimer = setTimeout(() => {
        healthyTimer = null
        retries.reset()
      }, 60_000)
    }
    const scheduleRetry = (failure: 'permission-denied' | 'unavailable' | 'transient') => {
      if (healthyTimer !== null) clearTimeout(healthyTimer)
      healthyTimer = null
      return retries.scheduleRetry(failure, () => { void arm() })
    }
    const arm = async () => {
      try {
        const available = await probeCapabilities()
        if (stopped) return
        if (!available.stt) {
          scheduleRetry('unavailable')
          return
        }
        if (voice.current?.live()) {
          markLive()
          return
        }
        const listener = await startVoiceFlight.current(() => startVoice({
          mode,
          onWake,
          onSpeechStart,
          onPartial,
          onUtterance,
          onError: onVoiceError,
          onRuntimeFailure: (failure) => scheduleRetry(failure),
        }))
        if (stopped) listener.stop()
        else if (listener.live()) {
          voice.current = listener
          markLive()
        } else if (listener.startupFailure) {
          // Permission denial deliberately does not retry or re-prompt.
          scheduleRetry(listener.startupFailure)
        }
      } catch (err) {
        if (stopped) return
        console.error('[nori] wake listener startup failed:', err)
        onVoiceError('Nori’s local wake listener could not start; retrying shortly.')
        scheduleRetry('transient')
      }
    }
    wakeRetryHandler.current = scheduleRetry
    void arm()
    return () => {
      stopped = true
      if (healthyTimer !== null) clearTimeout(healthyTimer)
      retries.stop()
      if (wakeRetryHandler.current === scheduleRetry) wakeRetryHandler.current = null
      voice.current?.stop()
      voice.current = null
    }
    // One microphone/wake pipeline lives for this app window's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted])

  // A background wake uses the same wake path, only after renderer boot finishes.
  useEffect(() => {
    let gone = false, checking = false
    const check = async () => {
      if (gone || checking || store.getState().phase === 'boot') return
      checking = true
      try {
        if (await window.noriWake?.consume() && !gone) onWake('')
      } catch { /* An unavailable desktop bridge must not manufacture a wake. */ }
      finally { checking = false }
    }
    void check()
    const timer = setInterval(() => void check(), 500)
    return () => { gone = true; clearInterval(timer) }
    // Read current phase/mute through store; do not reopen listeners on renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -- clap to start --------------------------------------------------------

  /**
   * A clap brings him up, as an alternative to the button.
   *
   * Only while the ignition screen is showing, and torn down the moment he
   * boots — the microphone is about to belong to the voice loop, and two
   * analysers arguing over the same stream is how you get an assistant that
   * hears half of what you say.
   *
   * Deliberately silent about failure. If the microphone is refused, or has not
   * been granted yet, the button is still right there; announcing an error
   * about a feature nobody asked for would be worse than quietly doing without.
   */
  useEffect(() => {
    if (phase !== 'offline' || muted) return
    let live: { stop: () => void } | null = null
    let gone = false
    void listenForClap(() => {
      if (!gone) void powerOn()
    }).then((l) => {
      if (gone) l.stop()
      else live = l
    })
    return () => {
      gone = true
      live?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, muted])

  // -- mute -------------------------------------------------------------------

  /**
   * The mute button and the M key both flip the store flag; this is the one
   * place it takes effect. Muting mid-turn stands him down rather than leaving
   * him listening to a mic that can no longer hear anything.
   */
  useEffect(() => {
    setMicMuted(muted)
    if (!muted) return
    const p = store.getState().phase
    if (p === 'waking' || p === 'listening') goDormant()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted])

  const echoGuard = useStore((s) => s.echoGuard)
  useEffect(() => {
    setEchoStrict(echoGuard === 'strict')
  }, [echoGuard])

  // -- level pump + keys ----------------------------------------------------

  useEffect(() => {
    let raf = 0

    const pump = () => {
      const st = store.getState()
      // While speaking, follow N.O.R.I.'s own output rather than the mic, so the
      // orb lip-syncs instead of reacting to room noise.
      const lvl =
        st.phase === 'speaking' && speaker.current
          ? speaker.current.level()
          : micLevel()
      st.setLevel(lvl)
      raf = requestAnimationFrame(pump)
    }
    pump()

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // A HUD button keeps keyboard focus after a click, so Space or Escape
      // would re-activate that button instead of driving the voice loop. For
      // the keys we own, hand focus back to the page. preventDefault in each
      // handler stops this press activating the button; the blur fixes the next.
      if (
        (e.code === 'Space' || e.key === 'Escape' || e.key === 'm') &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement.tagName === 'BUTTON'
      ) {
        document.activeElement.blur()
      }

      // V auditions the next N.O.R.I. voice installed on this machine. Which
      // ones exist varies per Mac, so hearing them beats trusting a ranking.
      // Bare V only — ⌘V and ⌃V are paste, and swallowing those was rude.
      if (
        e.key === 'v' &&
        !e.repeat &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault()
        const name = cycleVoice()
        store.getState().setVoice(name)
        silence()
        const demo = createSpeaker()
        speaker.current = demo
        demo.say(`Voice set to ${name.replace(/\(.*?\)/g, '').trim()}. N.O.R.I. is ready.`)
        void demo.end()
        return
      }

      // G puts the camera on and starts tracking hands. Off by default and
      // never implicit: a webcam that turns itself on because an interface
      // thought it might be useful is not a trade anyone agreed to.
      if (e.key === 'g' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const on = store.getState().gestures
        if (on) {
          hands.disableHands()
          store.getState().setGestures(false)
        } else {
          store.getState().setError(null)
          void hands
            .enableHands()
            .then(() => store.getState().setGestures(true))
            .catch((err: Error) => {
              store.getState().setGestures(false)
              store
                .getState()
                .setError(
                  err?.name === 'NotAllowedError'
                    ? 'Camera access denied — gesture control is unavailable.'
                    : `Gesture control failed to start: ${err?.message ?? err}`,
                )
            })
        }
        return
      }

      // T speaks a fixed line, bypassing the wake word, the recogniser and the
      // model entirely. When "I can't hear him" is the report, this is the one
      // keypress that separates a broken voice engine from a broken voice loop
      // — and it prints the verdict rather than making you infer it.
      if (e.key === 't' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        silence()
        const t = createSpeaker()
        speaker.current = t
        t.say('Audio test. If you can hear this, N.O.R.I. speech output is working.')
        void t.end().then(() => {
          const d = (window as unknown as Record<string, Record<string, unknown>>).__tts
          console.info('[nori] audio test →', d)
          if (d && d.started === 0 && d.rescued === 0) {
            store.getState().setError(
              `No sound produced. engine=${d.engine} voice=${d.voice} error=${d.lastError || 'none'}`,
            )
          }
        })
        return
      }

      // M mutes the microphone for this session. Bare M only.
      if (e.key === 'm' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const st = store.getState()
        if (st.phase !== 'offline') st.setMuted(!st.muted)
        return
      }

      // Escape: stop the current answer and listen, or stand down when idle.
      if (e.key === 'Escape') {
        e.preventDefault()
        stopOrStandDown()
        return
      }

      // Space starts a turn without the wake word. Worth using while filming so
      // a missed wake word doesn't cost a take.
      if (e.code !== 'Space' || e.repeat) return
      e.preventDefault()

      const phase = store.getState().phase
      if (phase === 'offline') {
        void powerOn()
      } else if (phase === 'boot') {
        /* ignore — the boot sequence owns the phase until it finishes */
      } else if (
        phase === 'thinking' ||
        phase === 'tooling' ||
        phase === 'speaking'
      ) {
        onSpeechStart()
        listen(AWAIT_SPEECH_MS)
      } else {
        pushToTalk()
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      clearIdle()
      voice.current?.stop()
      speaker.current?.cancel()
      // The camera must not outlive the page that turned it on.
      hands.disableHands()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Hud onStop={stopOrStandDown} onSubmitText={submitText} />
      <Boot />
      <Diagnostics />
      <Ignition
        onStart={() => void powerOn()}
        onSkip={() => void powerOn(true)}
      />
    </>
  )
}
