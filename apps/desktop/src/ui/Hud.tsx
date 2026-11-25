import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useStore, accentFor, type Phase } from '../store'
import { configure, setScreenMonitorActive } from '../lib/brain'
import * as camera from '../lib/camera'
import { deriveVisionStatus, visionClient } from '../lib/vision'
import { BladeSweep, Blades } from './Blades'
import { Effects } from './Effects'
import { Pointer } from './Pointer'
import { GestureGuide } from './GestureGuide'
import { LocalModelManager } from './LocalModelManager'
import { PersonalityPanel } from './PersonalityPanel'
import { SpatialWorkspace } from '../workspace/SpatialWorkspace'
import { NoriAstral } from './NoriAstral'
import { ComputerControl } from './ComputerControl'
import { MemoryPanel } from './MemoryPanel'
import { createReadAloudSpeaker } from '../lib/tts'

declare global {
  interface Window {
    noriSystem?: {
      confirm: (taskId: string) => Promise<{ confirmed: boolean }>
      read: () => Promise<{ enabled: boolean | null; perTaskConfirmationRequired: boolean;
        fullAccessAvailable: boolean; fullAccessEnabled: boolean; confirmationFloorActive: boolean;
        fullAccessBackup: null | { verified: true; fileCount: number; totalBytes: number; path: string } }>
    }
  }
}

const statusText: Record<Phase, string> = {
  offline: 'OFFLINE',
  boot: 'INITIALISING',
  // Interface standby does not establish microphone or model readiness.
  dormant: 'STANDBY',
  waking: 'ONLINE',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  tooling: 'ACCESSING SYSTEMS',
  speaking: 'RESPONDING',
}

function Corner({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  return <div className={`corner corner-${at}`} />
}

/* ------------------------------------------------------------------ decode */

/**
 * The glyphs the ghost is drawn from. Uppercase, digits and rules only: the
 * point is that the unresolved text reads as *machine*, so lowercase letters
 * and anything with a descender are left out — they look like badly rendered
 * words rather than an unfinished decode.
 */
const GLYPHS = '/\\|<>[]{}=+*#%&$0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Characters of noise shown ahead of the resolved text. */
const GHOST = 22
/** Repaint interval for the scramble. ~24fps is plenty for glyph noise. */
const FRAME_MS = 42
/** Floor on the resolve rate, characters per second. */
const MIN_RATE = 110
/** The frontier is never allowed to trail the streamed text by longer. */
const MAX_LAG_MS = 420

function scramble(s: string, seed: number) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    // Whitespace is left alone so word shapes and line breaks hold still while
    // the glyphs underneath churn.
    if (c === ' ' || c === '\n' || c === '\t') {
      out += c
      continue
    }
    out += GLYPHS[(seed * 7919 + i * 104729 + c.charCodeAt(0)) % GLYPHS.length]
  }
  return out
}

/**
 * N.O.R.I.'s lines, arriving the way a computer would produce them.
 *
 * The hard part is not the effect, it is that the text underneath is *live*.
 * The store appends a token at a time, so this component re-renders dozens of
 * times a second with a slightly longer string, and the naive implementation —
 * scramble the whole thing, resolve it over N milliseconds — restarts the
 * animation on every token and never finishes decoding anything.
 *
 * So the frontier is a ref and only ever moves forward. Everything behind it
 * has settled and is plain text that will never animate again; a short window
 * ahead of it is noise; the rest is present in the DOM but invisible, which
 * keeps the line wrapping identical to the finished paragraph and means the
 * accessibility tree always holds the real sentence. The rate scales with how
 * far behind the frontier has fallen, so a single token drips and a 300
 * character burst clears inside MAX_LAG_MS — the decode must never be the
 * reason the transcript trails the voice.
 *
 * The rAF loop repaints on a 42ms gate rather than every frame, and stops dead
 * the moment the frontier catches up.
 */
/**
 * Formats a finished Nori reply as React elements (never HTML): fenced code
 * blocks, headings, bullet and numbered lists, **bold** and `inline code`.
 * Unclosed fences still render their text as code, so nothing typed by a tool
 * can inject markup. Styles live in public/assets/nori-fixes-20261030.css.
 */
function formatReply(text: string) {
  const lines = String(text).split(/\r?\n/)
  const out: ReactNode[] = []
  const inline = (value: string) => {
    const parts: ReactNode[] = []
    const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(value))) {
      if (m.index > last) parts.push(value.slice(last, m.index))
      const token = m[0]
      parts.push(token[0] === '`'
        ? <code className="log-code" key={m.index}>{token.slice(1, -1)}</code>
        : <strong key={m.index}>{token.slice(2, -2)}</strong>)
      last = m.index + token.length
    }
    if (last < value.length) parts.push(value.slice(last))
    return parts
  }
  const bullet = /^\s*[-*•]\s+(.*)$/
  const numbered = /^\s*(\d{1,3})[.)]\s+(.*)$/
  const fence = /^\s*```\s*([\w+#.-]{0,20})\s*$/
  let i = 0
  while (i < lines.length) {
    const open = lines[i].match(fence)
    if (open) {
      const body: string[] = []
      i++
      while (i < lines.length && !fence.test(lines[i])) body.push(lines[i++])
      i++
      out.push(<pre className="log-pre" key={`c${i}`}>{open[1] ? <span className="log-pre-lang">{open[1]}</span> : null}<code>{body.join('\n')}</code></pre>)
      continue
    }
    if (bullet.test(lines[i])) {
      const items: ReactNode[] = []
      let m: RegExpMatchArray | null
      while (i < lines.length && (m = lines[i].match(bullet))) { items.push(<li key={i}>{inline(m[1])}</li>); i++ }
      out.push(<ul className="log-list" key={`l${i}`}>{items}</ul>)
      continue
    }
    if (numbered.test(lines[i])) {
      const items: ReactNode[] = []
      const start = Number(lines[i].match(numbered)![1])
      let m: RegExpMatchArray | null
      while (i < lines.length && (m = lines[i].match(numbered))) { items.push(<li key={i}>{inline(m[2])}</li>); i++ }
      out.push(<ol className="log-list" start={start} key={`o${i}`}>{items}</ol>)
      continue
    }
    const heading = lines[i].match(/^#{1,4}\s+(.*)$/)
    const next = lines[i + 1]
    const breakAfter = i < lines.length - 1 && !bullet.test(next) && !numbered.test(next) && !fence.test(next)
    out.push(<Fragment key={i}>{heading ? <strong className="log-heading">{inline(heading[1])}</strong> : inline(lines[i])}{breakAfter ? <br /> : null}</Fragment>)
    i++
  }
  return out
}

function DecodeText({ text }: { text: string }) {
  const reduced = useReducedMotion()
  const settled = useRef(0)
  const raf = useRef(0)
  const latest = useRef(text)
  const [tick, bump] = useState(0)

  useEffect(() => {
    // The running loop reads the length through this ref rather than through
    // its own closure, so a token landing mid-sweep simply extends the target
    // instead of leaving the loop chasing a length that is already stale.
    latest.current = text

    if (reduced) {
      settled.current = text.length
      return
    }
    if (raf.current || settled.current >= text.length) return

    let prev = performance.now()
    let painted = 0

    const step = (now: number) => {
      // Clamped so a backgrounded tab does not resolve the whole answer in one
      // enormous frame the moment it comes back.
      const dt = Math.min(now - prev, 120) / 1000
      prev = now

      const target = latest.current.length
      const rate = Math.max(MIN_RATE, (target - settled.current) / (MAX_LAG_MS / 1000))
      settled.current = Math.min(target, settled.current + rate * dt)

      if (now - painted >= FRAME_MS) {
        painted = now
        bump((n) => n + 1)
      }

      if (settled.current < latest.current.length) {
        raf.current = requestAnimationFrame(step)
      } else {
        raf.current = 0
        bump((n) => n + 1)
      }
    }
    raf.current = requestAnimationFrame(step)
  }, [text, reduced])

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = 0
    },
    [],
  )

  const n = Math.floor(settled.current)
  if (reduced || n >= text.length) return <>{formatReply(text)}</>

  return (
    <>
      {text.slice(0, n)}
      <span className="decode-ghost">{scramble(text.slice(n, n + GHOST), tick)}</span>
      <span className="decode-veil">{text.slice(n + GHOST)}</span>
    </>
  )
}

/* --------------------------------------------------------------------- hud */

export function Hud({
  onStop,
  onSubmitText,
}: {
  onStop: () => void
  onSubmitText: (text: string, attachment?: { data?: string; text?: string; mimeType?: string; name: string }) => boolean | void
}) {
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<{ name: string; data?: string; text?: string; mimeType?: string } | null>(null)
  const [attachmentError, setAttachmentError] = useState('')
  const attachmentInput = useRef<HTMLInputElement>(null)
  const [logOpen, setLogOpen] = useState(true)
  const [spatialOpen, setSpatialOpen] = useState(false)
  const phase = useStore((s) => s.phase)
  const caption = useStore((s) => s.caption)
  const turns = useStore((s) => s.turns)
  const [readingReply, setReadingReply] = useState<string | null>(null)
  const replySpeaker = useRef<ReturnType<typeof createReadAloudSpeaker> | null>(null)
  useEffect(() => () => replySpeaker.current?.cancel(), [])
  const readReply = (id: string, text: string) => {
    replySpeaker.current?.cancel()
    if (readingReply === id) { replySpeaker.current = null; setReadingReply(null); return }
    const speaker = createReadAloudSpeaker()
    replySpeaker.current = speaker
    setReadingReply(id)
    speaker.say(text)
    void speaker.end().finally(() => {
      if (replySpeaker.current === speaker) { replySpeaker.current = null; setReadingReply(null) }
    })
  }
  const transcriptVisible = useStore((s) => s.ui.chrome.transcript)
  const transcript = useRef<HTMLDivElement>(null)
  const followTranscript = useRef(true)
  useEffect(() => {
    const panel = transcript.current
    if (!panel) return
    const observer = new ResizeObserver(() => {
      if (followTranscript.current) panel.scrollTop = panel.scrollHeight
    })
    for (const line of panel.children) observer.observe(line)
    if (followTranscript.current) panel.scrollTop = panel.scrollHeight
    return () => observer.disconnect()
  }, [turns, transcriptVisible])
  const activeTool = useStore((s) => s.activeTool)
  const connected = useStore((s) => s.connected)
  const error = useStore((s) => s.error)
  const level = useStore((s) => s.level)
  const voice = useStore((s) => s.voice)
  const bootNote = useStore((s) => s.bootNote)
  const gestures = useStore((s) => s.gestures)
  const screenMonitor = useStore((s) => s.screenMonitor)
  const looking = useStore((s) => s.looking)
  const ui = useStore((s) => s.ui)
  const setError = useStore((s) => s.setError)
  const setScreenMonitor = useStore((s) => s.setScreenMonitor)
  const [workingSince, setWorkingSince] = useState<number | null>(null)
  const [workingNow, setWorkingNow] = useState(Date.now())
  const busy = phase === 'thinking' || phase === 'tooling'

  useEffect(() => {
    if (!busy) {
      setWorkingSince(null)
      return
    }
    setWorkingSince((value) => value ?? Date.now())
    const timer = window.setInterval(() => setWorkingNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [busy])

  // Notices clear themselves after a few seconds. Most are informational — a
  // reconnect, a stood-down mic — and a banner that never leaves reads as a
  // stuck error. The user can also dismiss it with the x.
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 7000)
    return () => clearTimeout(t)
  }, [error, setError])
  const muted = useStore((s) => s.muted)
  const setMuted = useStore((s) => s.setMuted)
  const queue = useStore((s) => s.queue)
  const bridge = useStore((s) => s.bridge)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const [visionStatus, setVisionStatus] = useState(() => visionClient.getStatus())
  useEffect(() => {
    const unsubscribe = visionClient.subscribe(setVisionStatus)
    return unsubscribe
  }, [])
  const visionEnabled = visionStatus.enabled
  const screenShared = camera.screenLive()
  const cameraActive = camera.cameraLive() && !screenShared
  const activeVisualSources = [
    ...(cameraActive || (gestures && !screenShared) ? ['camera' as const] : []),
    ...(screenShared || screenMonitor ? ['screen' as const] : []),
  ]
  const visionDerived = deriveVisionStatus({
    enabled: visionEnabled,
    gestures,
    screenMonitor,
    looking,
    activeSources: activeVisualSources,
    cameraPermission: cameraActive ? 'granted' : 'unknown',
    screenPermission: screenShared ? 'granted' : 'unknown',
  })
  const visionLabel = !visionEnabled
    ? 'OFF'
    : visionDerived.activeSources.includes('screen') && visionDerived.activeSources.includes('camera')
      ? 'CAMERA + SCREEN'
      : visionDerived.activeSources.includes('screen')
        ? 'SCREEN'
        : visionDerived.activeSources.includes('camera')
          ? 'CAMERA'
          : 'IDLE'

  useEffect(() => {
    visionClient.syncFromUiState({
      enabled: visionEnabled,
      gestures,
      screenMonitor,
      looking,
      activeSources: activeVisualSources,
      cameraPermission: cameraActive ? 'granted' : 'unknown',
      screenPermission: screenShared ? 'granted' : 'unknown',
    })
  }, [visionEnabled, gestures, screenMonitor, looking, screenShared, cameraActive])

  const toggleVision = () => {
    const next = !visionEnabled
    visionClient.setEnabled(next)
    visionClient.syncFromUiState({
      enabled: next,
      gestures,
      screenMonitor,
      looking,
      activeSources: activeVisualSources,
      cameraPermission: cameraActive ? 'granted' : 'unknown',
      screenPermission: screenShared ? 'granted' : 'unknown',
    })
  }
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [systemAccess, setSystemAccess] = useState<Awaited<ReturnType<NonNullable<Window['noriSystem']>['read']>> | null>(null)
  const [systemAccessBusy, setSystemAccessBusy] = useState(false)
  const blades = useStore((s) => s.blades)
  const pushBlade = useStore((s) => s.pushBlade)
  const focusBlade = useStore((s) => s.focusBlade)
  const toggleBladeHidden = useStore((s) => s.toggleBladeHidden)
  /** Open the webcam or a screen share as a sticky blade, or bring the one
   *  already open forward. */
  const openEye = (source: 'camera' | 'screen') => {
    const id = `eye-${source}`
    if (blades.some((b) => b.id === id)) {
      toggleBladeHidden(id, false)
      focusBlade(id)
      return
    }
    pushBlade({
      id,
      kind: 'camera',
      source,
      title: source === 'screen' ? 'Screen share' : 'Camera',
      size: 'tall',
      hold: 'sticky',
    })
  }
  const toggleScreenMonitor = () => {
    if (screenMonitor) {
      setScreenMonitor(false)
      void setScreenMonitorActive(false).catch(() => {})
      return
    }
    if (!camera.monitorCaptureAvailable()) {
      setError('Screen monitoring is unavailable here. Share a screen first, then turn <span class="text-green-600">Nori Vision</span> on.')
      return
    }
    setError(null)
    setScreenMonitor(true)
    void setScreenMonitorActive(true).catch((err: Error) => {
      setScreenMonitor(false)
      setError(`<span class="text-green-600">Nori Vision</span> could not start: ${err.message}`)
    })
  }
  const removeQueued = useStore((s) => s.removeQueued)
  const echoGuard = useStore((s) => s.echoGuard)
  const setEchoGuard = useStore((s) => s.setEchoGuard)
  // Open on first load; the user can fold it away once it gets long.
  const [systemsOpen, setSystemsOpen] = useState(true)
  const systemCount = connected.length + 1 // + Web

  const refreshSystemAccess = async () => {
    try {
      const state = await window.noriSystem?.read()
      if (state) setSystemAccess(state)
    } catch {
      setSystemAccess(null)
    }
  }
  useEffect(() => {
    if (!settingsOpen) return
    void refreshSystemAccess()
    const timer = window.setInterval(() => void refreshSystemAccess(), 5000)
    return () => window.clearInterval(timer)
  }, [settingsOpen])
  const confirmSystemSetting = async (taskId: string) => {
    if (systemAccessBusy || !window.noriSystem) return
    setSystemAccessBusy(true)
    try {
      const receipt = await window.noriSystem.confirm(taskId)
      if (!receipt.confirmed) return
      await refreshSystemAccess()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update Nori system access.')
      await refreshSystemAccess()
    } finally {
      setSystemAccessBusy(false)
    }
  }

  // accentFor folds N.O.R.I.'s overrides in over the phase colour, so one
  // variable on the root carries a theme change into every .hud-* rule without
  // a single component knowing a theme exists.
  const colour = accentFor(phase, ui)

  useEffect(() => {
    // The ground has to be set on the document, not painted here: the HUD sits
    // above the 3D scene, so a background drawn inside it would cover the
    // reactor rather than sit behind it. --bg is what html, body, #root and the
    // boot screen all pin themselves to.
    const root = document.documentElement
    if (ui.background) root.style.setProperty('--bg', ui.background)
    else root.style.removeProperty('--bg')
  }, [ui.background])

  return (
    <div className="hud nori-workspace" style={{ ['--accent' as string]: colour }}>
      {/* First in the tree on purpose. Everything after it is positioned with
          `z-index: auto`, so paint order is document order and the sweep stays
          behind the transcript and the panels without a z-index war. */}
      <BladeSweep />

      <Corner at="tl" />
      <Corner at="tr" />
      <Corner at="bl" />
      <Corner at="br" />

      <header className="hud-top">
        {ui.chrome.brand && (
          <div className="brand">
            <span className="brand-mark">N.O.R.I.</span>
            <span className="brand-sub">Neural Operations &amp; Responsive Intelligence</span>
          </div>
        )}

        <div className="status">
          <span className="dot" />
          <span className="status-text">
            {/* bootNote is the voice-model download readout. It is only ever
                the right thing to show during boot — as a general fallback a
                note that never got cleared (a stuck 'voice 97%') sits over
                LISTENING and PROCESSING for the rest of the session. */}
            {phase === 'boot' && bootNote ? bootNote : statusText[phase]}
          </span>
        </div>
        {/* Visible only while he is working. Same call as Escape. */}
        {(phase === 'thinking' || phase === 'tooling' || phase === 'speaking') && (
          <button className="stop-btn" onClick={onStop} title="Stop (Esc)">
            <span className="stop-square" />
            STOP
          </button>
        )}
      </header>

      {/* Left rail: which integrations are live */}
      {ui.chrome.systems && (
        <aside className="rail rail-left">
          <button
            className="nori-new-chat"
            onClick={() => {
              setError(null)
              void configure({ fresh: true })
                .then(() => useStore.getState().clearScreen('transcript'))
                .catch((error: unknown) => {
                  setError(error instanceof Error ? `Could not start a new conversation: ${error.message}` : 'Could not start a new conversation.')
                })
            }}
            title="Start a fresh local conversation"
            disabled={phase === 'thinking' || phase === 'tooling' || phase === 'speaking'}
          >
            <span aria-hidden="true">＋</span> New conversation
          </button>
          <ComputerControl />
          <div className="nori-nav-label">Connected systems</div>
          <button
            className="rail-title rail-toggle"
            onClick={() => setSystemsOpen((o) => !o)}
            aria-expanded={systemsOpen}
          >
            SYSTEMS <span className="rail-count">{systemCount}</span>
            <span className={`rail-chevron ${systemsOpen ? 'open' : ''}`} />
          </button>
          {systemsOpen && (
            // Capped height and its own scroll, so a long MCP list stays a list
            // instead of running off the top and bottom of the frame.
            <div className="rail-list">
              {connected.length === 0 && <div className="rail-item dim">none linked</div>}
              {connected.map((c) => (
                <div key={c} className="rail-item">
                  <span className="tick" />
                  {c}
                </div>
              ))}
              <div className="rail-item">
                <span className="tick" />
                Web
              </div>
            </div>
          )}
          {phase !== 'offline' && phase !== 'boot' && (
            <div className="rail-actions">
              <button className={`rail-btn ${spatialOpen ? 'is-on' : ''}`} onClick={() => setSpatialOpen(true)} title="Open Nori's spatial workspace">
                SPACE
              </button>
              <button className="rail-btn" onClick={() => openEye('camera')} title="Open the camera">
                CAMERA
              </button>
              <button
                className="rail-btn"
                onClick={() => openEye('screen')}
                title="Share a tab, a window or the whole screen. Nori sees a screenshot with each message while you share."
              >
                SCREEN
              </button>
              <button
                className={`rail-btn ${screenMonitor ? 'is-on' : ''}`}
                onClick={toggleScreenMonitor}
                aria-pressed={screenMonitor}
                title="Opt-in local vision: periodically checks every connected display for a clear error or blocker. Images stay on this PC."
              >
                {screenMonitor ? 'MONITOR ALL ON' : 'MONITOR ALL'}
              </button>
              <button
                className={`rail-btn vision-control ${visionEnabled ? 'is-on' : ''}`}
                onClick={toggleVision}
                aria-pressed={visionEnabled}
                title="Toggle the Vision UI contract without owning camera or screen streams."
              >
                VISION {visionEnabled ? 'ON' : 'OFF'}{visionEnabled ? ` · ${visionLabel}` : ''}
              </button>
              <button
                className={`rail-btn ${settingsOpen ? 'is-on' : ''}`}
                onClick={() => setSettingsOpen(!settingsOpen)}
                title="Response and session settings"
              >
                SETTINGS
              </button>
            </div>
          )}
          {phase !== 'offline' && phase !== 'boot' && (
            <button className="rail-btn memory-open" onClick={() => setMemoryOpen(true)} title="Review Nori’s saved local memories">
              MY MEMORY
            </button>
          )}
          {settingsOpen && phase !== 'offline' && (
            <div className="settings">
              <div className="settings-row">
                <label>{bridge.efforts.includes('lightning-fast') ? 'Response style' : 'Effort'}</label>
                <select
                  aria-label="Response style"
                  value={bridge.effort}
                  onChange={(e) => {
                    if (e.target.value === 'adult-companion' && !window.confirm('Enable Adult Companion style? Confirm that you are 18 or older. This is self-attestation only; it does not verify your age. The setting changes chat tone only and does not enable tools or device control.')) return
                    void configure({ effort: e.target.value }).catch((error: unknown) => {
                      setError(error instanceof Error ? error.message : 'Could not change the response style.')
                    })
                  }}
                >
                  {(bridge.efforts.length ? bridge.efforts : [bridge.effort]).map((e) => (
                    <option key={e} value={e}>
                      {e === 'lightning-fast' ? 'Lightning Fast — concise'
                        : e === 'balanced' ? 'Balanced — useful detail'
                          : e === 'deep' ? 'Deep — thorough explanation'
                            : e === 'adult-companion' ? 'Adult Companion — opt-in, 18+'
                            : e || 'Default (from settings)'}
                    </option>
                  ))}
                </select>
                {bridge.efforts.includes('lightning-fast') && <span className="settings-note">Applies to the next answer. Conversation stays intact.</span>}
                {bridge.efforts.includes('adult-companion') && <span className="settings-note">Adult Companion is off by default. Selecting it asks for 18+ self-attestation and changes chat style only.</span>}
              </div>
              <div className="settings-row">
                <label>Noise guard</label>
                <select
                  aria-label="Noise guard"
                  value={echoGuard}
                  onChange={(e) => setEchoGuard(e.target.value as 'standard' | 'strict')}
                >
                  <option value="standard">Standard</option>
                  <option value="strict">Strict (nothing heard while he speaks)</option>
                </select>
              </div>
              <div className="settings-row">
                <label>Nori system access</label>
                {!systemAccess?.enabled ? (
                  <button className="rail-btn" disabled={systemAccessBusy || !systemAccess}
                    onClick={() => void confirmSystemSetting('enable')}>
                    {systemAccessBusy ? 'CHECKING…' : 'Enable System Neuron…'}
                  </button>
                ) : (
                  <button className="rail-btn" disabled={systemAccessBusy}
                    onClick={() => void confirmSystemSetting(systemAccess.fullAccessEnabled ? 'full-access-disable' : 'full-access-enable')}>
                    {systemAccessBusy ? 'UPDATING…' : systemAccess.fullAccessEnabled ? 'Disable Full Access…' : 'Enable Full Access…'}
                  </button>
                )}
                <span className="settings-note">
                  {!systemAccess ? 'System status is unavailable; no permission changed.'
                    : !systemAccess.enabled ? 'System commands are off. Enabling them still requires your confirmation.'
                      : systemAccess.fullAccessEnabled
                        ? `Full Access is on. Exact low-risk diagnostics can run without a popup; the confirmation floor stays active. ${systemAccess.fullAccessBackup?.verified ? `Last verified backup: ${systemAccess.fullAccessBackup.fileCount} files.` : 'No verified backup receipt is available.'}`
                        : 'Full Access is off. Every System command still needs separate approval.'}
                </span>
              </div>
              <div className="settings-row settings-actions">
                <span className="settings-note">
                  {bridge.resumed ? 'resumed from last time' : 'fresh session'}
                </span>
              </div>
            </div>
          )}
          <PersonalityPanel />
          <button className="workspace-quit" onClick={() => void window.noriWorkspace?.command('quit')}>Quit Nori</button>
        </aside>
      )}

      {/* Right rail: live telemetry, mostly for flavour */}
      <aside className="rail rail-right">
        <div className="workspace-inspector-heading">Workspace</div>
        <button className="workspace-model-card" onClick={() => setSettingsOpen(!settingsOpen)}>
          <span>Nori</span>
          <strong>Local assistant</strong>
          <small>Response settings ↗</small>
        </button>
        <div className="workspace-outputs">
          <div className="workspace-section-title">Outputs <span>{blades.filter(blade => blade.kind !== 'camera').length}</span></div>
          {blades.filter(blade => blade.kind !== 'camera').map(blade => (
            <button key={blade.id} onClick={() => { toggleBladeHidden(blade.id, false); focusBlade(blade.id) }}>
              <span aria-hidden="true">▧</span><span>{blade.title || blade.kind}</span>
            </button>
          ))}
          {!blades.some(blade => blade.kind !== 'camera') && <p>Files and previews from your tools appear here.</p>}
        </div>
        <div className="rail-title">SIGNAL</div>
        <div className="meter">
          <div className="meter-fill" style={{ height: `${level * 100}%` }} />
        </div>
        <div className="rail-item mono">
          {muted ? 'MUTED' : `${(level * 100).toFixed(0).padStart(3, '0')}%`}
        </div>
        {phase !== 'offline' && (
          <button
            className={`mute-btn ${muted ? 'is-muted' : ''}`}
            onClick={() => setMuted(!muted)}
            aria-pressed={muted}
            title="Mute microphone (M)"
          >
            <span className="mute-icon" />
            {muted ? 'MIC OFF' : 'MIC ON'}
          </button>
        )}
        {phase !== 'offline' && (
          <button
            className={`mute-btn ${echoGuard === 'strict' ? 'is-strict' : ''}`}
            onClick={() => setEchoGuard(echoGuard === 'strict' ? 'standard' : 'strict')}
            aria-pressed={echoGuard === 'strict'}
            title={
              echoGuard === 'strict'
                ? 'Noise guard STRICT: stronger echo rejection; speaking clearly still interrupts N.O.R.I.'
                : 'Noise guard STANDARD: echo cancellation with natural voice interruption.'
            }
          >
            <span className="mute-icon" />
            {echoGuard === 'strict' ? 'NOISE STRICT' : 'NOISE STD'}
          </button>
        )}
      </aside>

      <AnimatePresence>
        {busy && ui.chrome.toolBadge && (
          <motion.div className="working-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            <div className="working-head">Working for {workingSince ? Math.max(0, Math.floor((workingNow - workingSince) / 1000)) : 0}s</div>
            <div className="working-rule" />
            <div className="working-stage"><span className="working-dot" />{phase === 'tooling' ? 'Running command' : 'Thinking'}</div>
            {activeTool && <div className="working-entry"><span className="working-terminal">›_</span> Ran command · {activeTool.replace(/[_-]/g, ' ')}</div>}
          </motion.div>
        )}
        {activeTool && ui.chrome.toolBadge && (
          <motion.div
            className="tool-badge"
            // Anchored to the TOP of the frame, not the middle. The old home was
            // viewport-centre plus a fixed drop, which on a tall or square
            // window landed the headline straight on top of the bottom
            // transcript — two elements pinned to different edges of the screen
            // were always going to meet somewhere. Up here it sits in its own
            // band with the rest of the status chrome and can never collide with
            // the log. Framer owns `transform` on an animated element, so the
            // centring (x: -50%) lives in these props, not the stylesheet.
            initial={{ opacity: 0, x: '-50%', y: -8, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: '-50%', y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: '-50%', y: -8, filter: 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          >
            <span className="tool-kicker">
              <span className="spinner" />
              accessing
            </span>
            <span className="tool-name">{activeTool.replace(/[_-]/g, ' ')}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {turns.length === 0 && <section className="workspace-welcome" aria-label="Start a conversation">
        <NoriAstral />
        <div className="workspace-emblem" aria-hidden="true">N</div>
        <h1>What are we making today?</h1>
        <p>Talk with Nori, create with your local tools, or bring a file into the conversation.</p>
        <div className="workspace-starters">
          {['Show me the creative apps you can use.', 'Create a document with WordCraft.', 'Help me investigate a local app with REA.'].map(prompt =>
            <button key={prompt} onClick={() => setDraft(prompt)}>{prompt}<span aria-hidden="true">↗</span></button>)}
        </div>
      </section>}

      {/* Conversation log — last few turns, fading upward */}
      {ui.chrome.transcript && turns.length > 0 && (
        <div className={`log${logOpen ? '' : ' log-collapsed'}`} ref={transcript} onScroll={(event) => {
          const panel = event.currentTarget
          followTranscript.current = panel.scrollHeight - panel.clientHeight - panel.scrollTop < 32
        }}>
          <div className="log-toolbar"><span>CONVERSATION</span><button type="button" aria-expanded={logOpen}
            aria-label={logOpen ? 'Minimize conversation panel' : 'Expand conversation panel'}
            onClick={() => setLogOpen(value => !value)}>{logOpen ? '−' : '+'}</button></div>
          {logOpen && <AnimatePresence initial={false}>
            {turns.map((t) => (
              <motion.div
                key={t.id}
                className={`log-line log-${t.role}${
                  t.subsystem ? ` log-sub-${t.subsystem}` : ''
                }`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              >
                <span className="log-who">{t.role === 'user' ? 'YOU' : 'N.O.R.I.'}</span>
                {/* Only his half decodes. What the user said was never
                    transmitted from anywhere — dressing it up as machine
                    output would be a lie about where the words came from. */}
                <span className="log-text">
                  {t.segments && t.segments.length > 0 ? (
                    // A note about several systems at once. Each span carries
                    // its own subsystem, so one line can hold several colours.
                    t.segments.map((s, i) => (
                      <span
                        key={i}
                        className={`log-seg${s.subsystem ? ` log-sub-${s.subsystem}` : ''}`}
                      >
                        {t.role === 'nori' ? <DecodeText text={s.text} /> : s.text}
                      </span>
                    ))
                  ) : (
                    t.role === 'nori' ? <DecodeText text={t.text} /> : t.text
                  )}
                  {t.role === 'nori' && t.text.trim() && <button type="button"
                    style={{display:'block',marginTop:8,background:'transparent',border:'1px solid currentColor',borderRadius:8,color:'inherit',cursor:'pointer'}}
                    onClick={() => readReply(t.id, t.text)} aria-label={readingReply === t.id ? 'Stop reading aloud' : 'Read reply aloud'}>
                    {readingReply === t.id ? '■ Stop reading' : '◖ Read aloud'}
                  </button>}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>}
          {/* Mount point for the coding-work panel and its run cards. */}
          {logOpen && <div id="nori-inline-coding-host" />}
        </div>
      )}

      <AnimatePresence>
        {caption && (
          <motion.div
            className="caption"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {caption}
          </motion.div>
        )}
      </AnimatePresence>

      {/* What was said while he was busy, waiting its turn. */}
      <AnimatePresence>
        {queue.length > 0 && (
          <motion.div
            className="queue"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
          >
            <div className="queue-title">UP NEXT · {queue.length}</div>
            {queue.map((q, i) => (
              <div key={`${i}-${q}`} className="queue-item">
                <span className="queue-n">{i + 1}</span>
                <span className="queue-text">{q}</span>
                <button className="queue-x" onClick={() => removeQueued(i)} title="Drop">
                  ✕
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The one surface. Panels used to sit alongside this as a second place
          for things to appear, which meant two places to look and a decision
          the model had to make on grounds it could not know. Everything renders
          here now; Panels.tsx is unmounted rather than deleted so the design
          system it documents stays findable. */}
      <Blades />
      {spatialOpen && <SpatialWorkspace onClose={() => setSpatialOpen(false)} />}

      {/* Suggestions strip removed: the type-to-N.O.R.I. bar sits here now, and the
          rotating "try saying…" text read as clutter cycling behind the box. */}

      {error && (
        <div className="error">
          <span className="error-text">{error}</span>
          <button
            className="error-x"
            onClick={() => useStore.getState().setError(null)}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Type to N.O.R.I.. The reliable path — no wake word, no microphone. Enter
          sends; while he is busy it joins the queue. */}
      {phase !== 'offline' && phase !== 'boot' && (
        <form
          className="textbar"
          onSubmit={(e) => {
            e.preventDefault()
            const t = draft.trim()
            if (!t && !attachment) return
            const accepted = onSubmitText(t || (attachment?.data ? 'Please inspect the attached image.' : 'Please inspect the attached file.'), attachment
              ? { data: attachment.data, text: attachment.text, mimeType: attachment.mimeType, name: attachment.name } : undefined)
            if (accepted !== false) {
              setDraft('')
              setAttachment(null)
              setAttachmentError('')
            }
          }}
        >
          <span className="textbar-prompt">›</span>
          <input
            ref={attachmentInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,.txt,.md,.csv,.json,.jsonl,.xml,.yaml,.yml,.toml,.ini,.log,.py,.js,.ts,.tsx,.html,.css,.sql"
            aria-label="Choose an image or text file for Nori"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              setAttachmentError('')
              if (!file) return
              if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                if (file.size > 2_800_000) {
                  setAttachmentError('Images must be 2.8 MB or smaller for local review.')
                  return
                }
                const reader = new FileReader()
                reader.onerror = () => setAttachmentError('Nori could not read that image from this device.')
                reader.onload = () => {
                  const value = typeof reader.result === 'string' ? reader.result : ''
                  const comma = value.indexOf(',')
                  if (comma < 0) {
                    setAttachmentError('The selected image could not be prepared for Nori.')
                    return
                  }
                  setAttachment({ name: file.name, mimeType: file.type, data: value.slice(comma + 1) })
                }
                reader.readAsDataURL(file)
                return
              }
              const extension = file.name.split('.').at(-1)?.toLowerCase() || ''
              const textTypes = new Set(['txt','md','csv','json','jsonl','xml','yaml','yml','toml','ini','log','py','js','ts','tsx','html','css','sql'])
              if (!textTypes.has(extension)) {
                setAttachmentError('Choose an image or a supported text/code file. PDF and Office files are not readable here yet.')
                return
              }
              if (file.size > 12_000) {
                setAttachmentError('Text/code attachments must be 12 KB or smaller for this local review path.')
                return
              }
              void file.arrayBuffer().then((buffer) => {
                if (new Uint8Array(buffer).includes(0)) throw new Error('binary')
                const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
                setAttachment({ name: file.name, text })
              }).catch(() => setAttachmentError('Nori could not read that file as UTF-8 text.'))
            }}
          />
          <button
            type="button"
            className="textbar-attach"
            title="Attach a local image or text/code file"
            aria-label="Attach a local image or text/code file"
            onClick={() => attachmentInput.current?.click()}
          >
            ＋
          </button>
          <textarea
            className="textbar-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            rows={2}
            aria-label="Message Nori"
            placeholder="Ask Nori to make, explore, or do something…"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="textbar-attach"
            style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 22, color: muted ? 'inherit' : '#82efd3', background: muted ? 'transparent' : '#153a36' }}
            aria-label={muted ? 'Enable voice input' : 'Disable voice input'}
            aria-pressed={!muted}
            title={muted ? 'Enable voice input - then say Hey Nori' : 'Turn microphone off'}
            onClick={() => setMuted(!muted)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4" />
            </svg>
          </button>
          {busy || phase === 'speaking'
            ? <button className="workspace-send" type="button" aria-label="Stop Nori" title="Stop Nori" onClick={onStop}>■</button>
            : <button className="workspace-send" type="submit" aria-label="Send message" title="Send message" disabled={!draft.trim() && !attachment}>↑</button>}
          {attachment && <span className="textbar-attachment" title={attachment.name}>{attachment.name}</span>}
          {attachmentError && <span className="textbar-attachment-error" role="status">{attachmentError}</span>}
        </form>
      )}

      <footer className="hud-bottom">
        <span className="hint">
          type below, or <kbd>M</kbd> for voice · <kbd>Space</kbd> talk · <kbd>G</kbd> hands · <kbd>Esc</kbd> stop
          {voice && (
            <>
              {' · '}
              <kbd>V</kbd> voice: {voice.replace(/\(.*?\)/g, '').trim()}
            </>
          )}
        </span>
      </footer>

      {/* Last, so a flash or a tear reads as being on the glass rather than
          underneath the chrome. It is pointer-events: none and unmounts the
          instant it finishes. */}
      <Effects />

      {/* Above even the effects: the reticle shows where a press will land, and
          a press that lands under a flourish is a press you cannot aim. */}
      <Pointer />
      {(gestures || looking) && (
        <div className="hands-live">
          {looking ? `LOOKING — ${looking.toUpperCase()}` : 'CAMERA ON · G TO STOP'}
        </div>
      )}
      <GestureGuide live={gestures} />
      <LocalModelManager />
      <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </div>
  )
}
