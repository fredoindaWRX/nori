import { useCallback, useEffect, useRef, useState } from 'react'

type ModelStatus = { installed: boolean; online: boolean; model?: string; runtime?: string; loadedModel?: string; identity?: string; trainedByNori?: boolean; sonCheckpoint?: boolean; toolsQualified?: boolean; error?: string }
type AppIdentity = { executable: string; suiteRoot: string; stateRoot: string; version: string; build: string; runtime: string; packaged: boolean }

declare global {
  interface Window {
    noriInstall?: {
      identity?: () => Promise<AppIdentity | null>
      status: () => Promise<ModelStatus>
      open: () => void
      subscribeOpen: (callback: () => void) => () => void
    }
  }
}

export function LocalModelManager() {
  const dialog = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has('manage-installation'))
  const [model, setModel] = useState<ModelStatus>({ installed: false, online: false })
  const [error, setError] = useState('')
  const [identity, setIdentity] = useState<AppIdentity | null>(null)
  const [identityError, setIdentityError] = useState('')

  const refresh = useCallback(async () => {
    const api = window.noriInstall
    if (!api) {
      setError('Live model status is available in the Nori desktop app, not this browser preview.')
      return
    }
    try {
      setModel(await api.status())
    } catch {
      setModel({ installed: false, online: false })
      setError('Unable to read local model status. Reopen this window to try again.')
    }
  }, [])

  useEffect(() => window.noriInstall?.subscribeOpen(() => setOpen(true)), [])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const panel = dialog.current
    if (!panel) return
    panel.querySelector<HTMLButtonElement>('.model-manager-close')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      } else if (event.key === 'Tab') {
        const controls = [...panel.querySelectorAll<HTMLElement>('button, summary, [tabindex="0"]')]
          .filter((element) => element.getClientRects().length > 0)
        const first = controls[0], last = controls.at(-1)
        if (!first || !last) { event.preventDefault(); panel.focus(); return }
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    setError('')
    void refresh()
    setIdentity(null)
    setIdentityError('')
    let active = true
    const readIdentity = window.noriInstall?.identity
    if (readIdentity) void readIdentity().then((value) => {
      if (active) { setIdentity(value); if (!value) setIdentityError('Running-copy identity unavailable.') }
    }).catch(() => { if (active) setIdentityError('Running-copy identity unavailable.') })
    else setIdentityError('Running-copy details are available in the desktop app.')
    return () => { active = false }
  }, [open, refresh])

  if (!open) return null

  return (
    <div className="model-manager-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section ref={dialog} tabIndex={-1} className="model-manager" role="dialog" aria-modal="true" aria-labelledby="model-manager-title">
        <div className="model-manager-head">
          <div>
            <span className="model-manager-kicker">N.O.R.I. · LOCAL MODELS</span>
            <h2 id="model-manager-title">Nori SoN models</h2>
          </div>
          <button className="model-manager-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <p className="model-manager-copy">NORI-20B SoN is Nori’s standard model target through Norama. Its serving checkpoint has not yet been created and qualified.</p>
        <p className="model-manager-copy">Temporary bridge: imported Llama 3.2 3B weights, not Nori-trained. <strong>Built with Llama.</strong> Its license and acceptable-use notices are bundled with the model under <code>models/language/llama3.2-3b-instruct/</code>.</p>
        {['NORI-20B SoN'].map((name) => (
          <div className="model-manager-card" key={name}>
            <div className="model-manager-card-title">{name} <span>NOT ACTIVATED</span></div>
            <p>Model development is pending, followed by native serving and hardware qualification.</p>
            <button className="model-manager-primary" type="button" disabled aria-disabled="true">
              20B SUPPORT PENDING
            </button>
          </div>
        ))}
        <p className="model-manager-copy">Automatic hardware selection requires measured NORI-20B SoN profiles. No substitute model will be downloaded.</p>
        <div className="model-manager-card">
          <div className="model-manager-card-title">Runtime status</div>
          <p>{model.online ? `Runtime reachable · ${model.runtime || 'identity unavailable'}` : 'No active model service is reported.'}</p>
          <p>Reported model · {model.loadedModel || 'NOT REPORTED'}</p>
          {model.identity && <p>Model status · {model.identity}</p>}
          {model.error && <p className="model-manager-warning">{model.error}</p>}
          {error && <p className="model-manager-error" role="alert">{error}</p>}
        </div>
        <details className="model-manager-card">
          <summary>Which Nori is this? · Running copy details</summary>
          {identity ? <>
            <p>Build: {identity.build} · Version: {identity.version}</p>
            <p>{identity.runtime}</p>
            <p style={{ overflowWrap: 'anywhere' }}>App: {identity.executable}</p>
            <p style={{ overflowWrap: 'anywhere' }}>Suite: {identity.suiteRoot}</p>
            <p style={{ overflowWrap: 'anywhere' }}>Saved state: {identity.stateRoot}</p>
          </> : <p>{identityError || 'Reading running-copy details…'}</p>}
        </details>
        <div className="model-manager-foot"><span>{window.noriInstall ? 'Nori desktop · local model service' : 'Browser preview · live model status unavailable'}</span><button onClick={() => setOpen(false)}>DONE</button></div>
      </section>
    </div>
  )
}
