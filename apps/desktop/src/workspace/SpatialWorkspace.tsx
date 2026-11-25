import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  DEFAULT_SPATIAL_LAYOUT, encodeSpatialFrame, parseSpatialLayout, SPATIAL_LAYOUT_KEY,
  type SpatialEdge, type SpatialLayout, type SpatialNode, type SpatialRoom,
} from './spatial-contract'
import './spatial-workspace.css'
import { ModelSpace3D } from './ModelSpace3D'
import { MODEL_CATALOG_CANDIDATES } from './model-catalog'
import { LocalAppSurface } from './LocalAppSurface'
import type { AppSpecFrame } from './spatial-contract'

const rooms: SpatialRoom[] = ['CORE', 'WORK', 'SYSTEMS', 'NOTES', 'MODELS', 'APPS']
const initialPosition = (index: number, count: number) => {
  const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2
  return { x: Math.max(.1, Math.min(.9, .5 + Math.cos(angle) * .29)), y: Math.max(.14, Math.min(.86, .5 + Math.sin(angle) * .29)), z: 0 }
}
const safeSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'system'

function readLayout(): { layout: SpatialLayout; error: string } {
  try { return { layout: parseSpatialLayout(localStorage.getItem(SPATIAL_LAYOUT_KEY)), error: '' } }
  catch (error) { return { layout: { ...DEFAULT_SPATIAL_LAYOUT, positions: {}, notes: [] }, error: error instanceof Error ? error.message : 'Saved workspace could not be read.' } }
}

export function SpatialWorkspace({ onClose }: { onClose: () => void }) {
  const phase = useStore((s) => s.phase)
  const activeTool = useStore((s) => s.activeTool)
  const connected = useStore((s) => s.connected)
  const bridge = useStore((s) => s.bridge)
  const blades = useStore((s) => s.blades)
  const focusBlade = useStore((s) => s.focusBlade)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const [initialLayout] = useState(readLayout)
  const [layout, setLayout] = useState(initialLayout.layout)
  const [storageReady, setStorageReady] = useState(!initialLayout.error)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('nori-core')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [noteTitle, setNoteTitle] = useState('')
  const [noteDetail, setNoteDetail] = useState('')
  const [frameError, setFrameError] = useState(initialLayout.error)
  const [modelStatus, setModelStatus] = useState<{ online: boolean; model?: string; loadedModel?: string; runtime?: string; identity?: string; error?: string; sonCheckpoint?: boolean } | null>(null)
  const [projectPath, setProjectPath] = useState('.')
  const [projectListing, setProjectListing] = useState<{ path: string; entries: Array<{ name: string; kind: 'directory' | 'file' }>; truncated: boolean } | null>(null)
  const [projectError, setProjectError] = useState('')
  const [projectPreview, setProjectPreview] = useState('')
  const [appDrafts, setAppDrafts] = useState<Array<{ id: string; title: string; description: string; status: string }>>([])
  const [activeApps, setActiveApps] = useState<Array<{ id: string; title: string; description: string; status: string }>>([])
  const [appDraftError, setAppDraftError] = useState('')
  const [appDraftPreview, setAppDraftPreview] = useState('')
  const [reviewedApp, setReviewedApp] = useState<{ id: string; frame: AppSpecFrame; validation: { status: string; findings: Array<{ code: string; pointer: string; severity: string }> } } | null>(null)
  const [activeApp, setActiveApp] = useState<{ id: string; frame: AppSpecFrame } | null>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const closeWorkspace = useRef(onClose)
  const drag = useRef<{ id: string | null; pointer: number; x: number; y: number; origin: { x: number; y: number }; pan: boolean } | null>(null)

  useEffect(() => { closeWorkspace.current = onClose }, [onClose])

  useEffect(() => {
    let active = true
    const readStatus = async () => {
      try { const status = await window.noriInstall?.status(); if (active && status) setModelStatus(status) }
      catch { if (active) setModelStatus(null) }
    }
    void readStatus()
    const timer = window.setInterval(() => { void readStatus() }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (layout.room !== 'WORK') return
    let active = true
    setProjectError('')
    const list = window.noriWorkspace?.projectList
    if (!list) { setProjectListing(null); setProjectError('Read-only project browsing is available in the Nori desktop app.'); return }
    void list({ path: projectPath }).then((result) => {
      if (!active) return
      if (!result) throw new Error('The project reader is unavailable in this copy.')
      setProjectListing(result)
    }).catch((error) => { if (active) { setProjectListing(null); setProjectError(error instanceof Error ? error.message : 'Could not list this project folder.') } })
    return () => { active = false }
  }, [layout.room, projectPath])

  useEffect(() => {
    if (layout.room !== 'APPS') return
    let active = true
    const list = window.noriWorkspace?.appDraftList
    if (!list) { setAppDrafts([]); setAppDraftError('Local app draft review is available in the Nori desktop app.'); return }
    const refresh = async () => {
      try {
        const result = await list()
        if (!active) return
        if (!result) throw new Error('Local app draft storage is unavailable in this copy.')
        setAppDrafts(result.entries)
        setActiveApps(result.apps)
        setAppDraftError('')
      } catch (error) {
        if (active) setAppDraftError(error instanceof Error ? error.message : 'Could not read Nori app drafts.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [layout.room])

  useEffect(() => {
    if (!storageReady) return
    try { localStorage.setItem(SPATIAL_LAYOUT_KEY, JSON.stringify(layout)) }
    catch { setFrameError('This browser session cannot save workspace layout locally. Existing saved state was left untouched.'); setStorageReady(false) }
  }, [layout, storageReady])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])]
    focusables()[0]?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeWorkspace.current() }
      if (event.key === 'Tab') {
        const items = focusables()
        if (!items.length) { event.preventDefault(); return }
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => { window.removeEventListener('keydown', closeOnEscape, true); previous?.focus() }
  }, [])

  const nodes = useMemo(() => {
    const core: SpatialNode[] = [
      { id: 'nori-core', kind: 'core', title: 'N.O.R.I. CORE', status: phase.toUpperCase(), room: 'CORE', x: .5, y: .5, z: 0, detail: 'Live desktop state. This reports the current interface phase; it does not claim that speech, the SoN checkpoint, or task tools are qualified.', origin: 'nori_live' },
      { id: 'model-runtime', kind: 'model', title: bridge.model || 'MODEL STATUS', status: bridge.model ? 'REPORTED BY LOCAL BRIDGE' : 'MODEL NOT REPORTED', room: 'CORE', x: .5, y: .2, z: 1, detail: bridge.model ? `Current model: ${bridge.model}${bridge.effort ? ` · effort ${bridge.effort}` : ''}. Runtime identity is shown as reported by Nori's local bridge.` : 'The local bridge has not reported a model name.', origin: 'nori_live' },
      { id: 'current-activity', kind: 'system', title: 'CURRENT ACTIVITY', status: activeTool ? 'ACTIVE TOOL' : phase.toUpperCase(), room: 'CORE', x: .5, y: .8, z: 1, detail: activeTool ? `Observed active tool: ${activeTool}` : 'No tool is currently reported as active.', origin: 'nori_live' },
    ]
    const systems = connected.map((label, index): SpatialNode => ({
      id: `system:${safeSlug(label)}:${index}`, kind: 'system', title: label.slice(0, 80), status: 'CONNECTED', room: 'SYSTEMS', ...initialPosition(index, connected.length), detail: 'Connected according to Nori bridge state. This does not assert tool qualification or write authority.', origin: 'nori_live',
    }))
    const surfaces = blades.map((blade, index): SpatialNode => ({
      id: `surface:${safeSlug(blade.id)}`, kind: 'surface', title: blade.title.slice(0, 100), status: blade.hold === 'sticky' ? 'PINNED SURFACE' : 'OPEN SURFACE', room: 'WORK', ...initialPosition(index, blades.length), detail: `${blade.kind}${blade.url ? ` · ${blade.url}` : ''}`, sourceId: blade.id, origin: 'nori_live',
    }))
    const projects = (projectListing?.entries ?? []).map((entry, index): SpatialNode => {
      const path = projectPath === '.' ? entry.name : `${projectPath}/${entry.name}`
      return { id: `project:entry:${index}`, kind: 'project', title: entry.name.slice(0, 120), status: entry.kind === 'directory' ? 'LOCAL FOLDER' : 'LOCAL FILE', room: 'WORK', ...initialPosition(index, projectListing?.entries.length ?? 1), detail: `Read-only Nori project item · ${path}`, sourceId: path, origin: 'nori_project' }
    })
    const apps = [...appDrafts, ...activeApps].map((app, index): SpatialNode => ({
      id: `app:${app.id.slice(0, 32)}`, kind: 'app', title: app.title.slice(0, 100), status: app.status,
      room: 'APPS', ...initialPosition(index, Math.max(1, appDrafts.length + activeApps.length)),
      detail: `${app.description || 'Nori-owned local app'} · ${app.id}`,
      sourceId: app.id, origin: 'nori_app',
    }))
    const activeModel = modelStatus?.loadedModel || modelStatus?.model || bridge.model || ''
    const models: SpatialNode[] = [
      { id: 'model-son-target', kind: 'model', title: 'NORI-20B SoN', status: modelStatus?.sonCheckpoint ? 'CHECKPOINT REPORTED' : 'TARGET · NOT QUALIFIED', room: 'MODELS', x: .5, y: .24, z: 0, detail: 'Nori-owned Swarm of Neurons target. A target record is not evidence of a trained or serving checkpoint.', origin: 'nori_live' },
      ...MODEL_CATALOG_CANDIDATES,
      ...(activeModel ? [{ id: 'model-active-runtime', kind: 'model' as const, title: activeModel.slice(0, 120), status: modelStatus?.online ? 'RUNTIME ONLINE' : 'MODEL REPORTED · STATUS UNKNOWN', room: 'MODELS' as const, x: .5, y: .68, z: 0, detail: `${modelStatus?.runtime || 'Local bridge'}${modelStatus?.identity ? ` · ${modelStatus.identity}` : ''}${modelStatus?.error ? ` · ${modelStatus.error}` : ''}`, sourceId: activeModel.slice(0, 512), origin: 'nori_live' as const }] : []),
    ]
    return [...core, ...systems, ...surfaces, ...projects, ...apps, ...models, ...layout.notes]
  }, [phase, activeTool, connected, bridge.model, bridge.effort, blades, layout.notes, modelStatus, projectListing, projectPath, appDrafts, activeApps])

  const edges = useMemo<SpatialEdge[]>(() => {
    const links: SpatialEdge[] = [
      { from: 'nori-core', relation: 'uses', to: 'model-runtime' },
      { from: 'nori-core', relation: 'contains', to: 'current-activity' },
    ]
    for (const node of nodes) {
      if (node.kind === 'system') links.push({ from: 'nori-core', relation: 'uses', to: node.id })
      if (node.kind === 'surface') links.push({ from: 'nori-core', relation: 'opens', to: node.id })
      if (node.kind === 'project') links.push({ from: 'nori-core', relation: 'contains', to: node.id })
      if (node.kind === 'app') links.push({ from: 'nori-core', relation: 'contains', to: node.id })
      if (node.kind === 'note') links.push({ from: 'nori-core', relation: 'contains', to: node.id })
    }
    return links
  }, [nodes])

  const frame = useMemo(() => {
    try {
      const visible = nodes.map((node, index) => {
        const saved = layout.positions[node.id]
        return saved ? { ...node, ...saved } : { ...node, ...initialPosition(index, nodes.length) }
      })
      return { value: encodeSpatialFrame(visible, edges), visible, error: '' }
    } catch (error) {
      return { value: null, visible: nodes, error: error instanceof Error ? error.message : 'Spatial frame validation failed.' }
    }
  }, [nodes, edges, layout.positions])

  const filtered = frame.visible.filter((node) => node.room === layout.room &&
    `${node.title} ${node.status} ${node.detail}`.toLowerCase().includes(query.trim().toLowerCase()))
  const activeIds = new Set(filtered.map((node) => node.id))
  const selectedNode = frame.visible.find((node) => node.id === selected) ?? null
  const reviewedSelectedApp = selectedNode?.kind === 'app' && reviewedApp?.id === selectedNode.sourceId ? reviewedApp : null
  const activeSelectedApp = selectedNode?.kind === 'app' && activeApp?.id === selectedNode.sourceId ? activeApp : null
  const visibleEdges = frame.value?.edges.flatMap(([from, relation, to]) => {
    const a = frame.value?.nodes[from]?.[0], b = frame.value?.nodes[to]?.[0]
    if (!a || !b || !activeIds.has(a) || !activeIds.has(b)) return []
    const source = frame.visible.find((node) => node.id === a), target = frame.visible.find((node) => node.id === b)
    if (!source || !target) return []
    const relationName = Object.entries({ contains: 0x0201, uses: 0x0202, opens: 0x0203 }).find(([, code]) => code === relation)?.[0] ?? 'link'
    return [{ a: source, b: target, relation: relationName }]
  }) ?? []

  const moveNode = (id: string, x: number, y: number) => {
    const rect = canvas.current?.getBoundingClientRect()
    if (!rect) return
    setLayout((current) => ({ ...current, positions: {
      ...current.positions,
      [id]: { x: Math.max(.04, Math.min(.96, x / rect.width)), y: Math.max(.08, Math.min(.92, y / rect.height)), z: current.positions[id]?.z ?? 0 },
    } }))
  }
  const startNodeDrag = (event: React.PointerEvent<HTMLButtonElement>, node: SpatialNode) => {
    if (event.button !== 0 || !canvas.current) return
    event.stopPropagation()
    const rect = canvas.current.getBoundingClientRect()
    const position = layout.positions[node.id] ?? node
    drag.current = { id: node.id, pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: { x: position.x * rect.width, y: position.y * rect.height }, pan: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: React.PointerEvent<Element>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    if (current.pan) setPan({ x: current.origin.x + event.clientX - current.x, y: current.origin.y + event.clientY - current.y })
    else if (current.id) moveNode(current.id, current.origin.x + (event.clientX - current.x) / zoom, current.origin.y + (event.clientY - current.y) / zoom)
  }
  const endDrag = (event: React.PointerEvent<Element>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null
  }
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.button !== 0) return
    drag.current = { id: null, pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: pan, pan: true }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const nudge = (event: React.KeyboardEvent<HTMLButtonElement>, node: SpatialNode) => {
    const delta = event.shiftKey ? .03 : .01
    const position = layout.positions[node.id] ?? node
    const step = ({ ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] } as const)[event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown']
    if (!step) return
    event.preventDefault()
    setLayout((current) => ({ ...current, positions: { ...current.positions, [node.id]: { x: Math.max(.04, Math.min(.96, position.x + step[0])), y: Math.max(.08, Math.min(.92, position.y + step[1])), z: position.z } } }))
  }
  const addNote = (event: React.FormEvent) => {
    event.preventDefault()
    const title = noteTitle.trim().slice(0, 80)
    const detail = noteDetail.trim().slice(0, 1000)
    if (!title || !detail) return
    const id = `note:${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`
    const note: SpatialNode = { id, kind: 'note', title, status: 'LOCAL NOTE', room: 'NOTES', ...initialPosition(layout.notes.length, layout.notes.length + 1), detail, origin: 'user_local' }
    setLayout((current) => ({ ...current, notes: [...current.notes, note] }))
    setSelected(id); setNoteTitle(''); setNoteDetail('')
  }
  const resetRoom = () => setLayout((current) => ({ ...current, positions: Object.fromEntries(Object.entries(current.positions).filter(([id]) => !frame.visible.some((node) => node.id === id && node.room === current.room))) }))
  const resetSavedLayout = () => {
    if (!window.confirm('Replace the unread saved spatial workspace with a clean layout? The existing saved bytes will be overwritten.')) return
    setLayout({ ...DEFAULT_SPATIAL_LAYOUT, positions: {}, notes: [] })
    setStorageReady(true)
    setFrameError('')
  }
  const activateNode = (node: SpatialNode) => {
    setSelected(node.id)
    if (node.kind === 'model' && node.room !== 'MODELS') setSettingsOpen(true)
    if (node.kind === 'surface' && node.sourceId) focusBlade(node.sourceId)
    setProjectPreview('')
    setAppDraftPreview('')
    setReviewedApp(null)
    setActiveApp(null)
    if (node.kind === 'app' && node.sourceId) {
      if (node.status === 'ACTIVE LOCAL APP') {
        void window.noriWorkspace?.appRead?.({ id: node.sourceId }).then((app) => {
          if (!app) throw new Error('This active local app is no longer available.')
          setActiveApp({ id: app.id, frame: app.frame })
        }).catch((error) => setAppDraftError(error instanceof Error ? error.message : 'Could not open this local app.'))
      } else {
        void window.noriWorkspace?.appDraftRead?.({ id: node.sourceId }).then((draft) => {
          if (!draft) throw new Error('This app draft is no longer available.')
          setReviewedApp({ id: draft.id, frame: draft.frame, validation: draft.validation })
          setAppDraftPreview(JSON.stringify({ title: draft.frame.title, description: draft.frame.description,
            validation: draft.validation, data_schema: draft.frame.data_schema, views: draft.frame.views,
            workflows: draft.frame.workflows, capabilities: draft.frame.capabilities }, null, 2))
        }).catch((error) => setAppDraftError(error instanceof Error ? error.message : 'Could not verify this app draft.'))
      }
    }
  }
  const activateLocalApp = async () => {
    if (!reviewedApp || reviewedApp.validation.status !== 'ready_for_local_preview') return
    if (!window.confirm(`Approve and open “${reviewedApp.frame.title}” as a Nori local app? Its interface and data stay under Nori. No generated code, network access, or workflow automation will run.`)) return
    try {
      const result = await window.noriWorkspace?.appDraftActivate?.({ id: reviewedApp.id, approved: true })
      if (!result) throw new Error('Nori did not confirm the local app approval.')
      const app = await window.noriWorkspace?.appRead?.({ id: reviewedApp.id })
      if (!app) throw new Error('The approved local app could not be reopened.')
      setActiveApp({ id: app.id, frame: app.frame }); setReviewedApp(null); setAppDraftPreview('')
      const listing = await window.noriWorkspace?.appDraftList?.()
      if (listing) { setAppDrafts(listing.entries); setActiveApps(listing.apps) }
      setAppDraftError('')
    } catch (error) { setAppDraftError(error instanceof Error ? error.message : 'Local app approval failed.') }
  }
  const openProjectFolder = (path: string) => { setProjectPath(path); setProjectPreview(''); setSelected('') }
  const readProjectFile = async (path: string) => {
    try {
      const result = await window.noriWorkspace?.projectRead?.({ path, start_line: 1, max_lines: 60 })
      setProjectPreview(result ? `${result.path} · ${result.returned_lines} lines${result.omitted ? ' · excerpt truncated' : ''}\n\n${result.content}` : 'The read-only project reader is unavailable in this copy.')
    } catch (error) { setProjectPreview(error instanceof Error ? error.message : 'This file could not be read.') }
  }
  const parentProjectPath = () => projectPath.includes('/') ? projectPath.slice(0, projectPath.lastIndexOf('/')) || '.' : '.'

  return <div className="spatial-shade" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="spatial-workspace" role="dialog" aria-modal="true" aria-label="Nori spatial workspace">
      <header className="spatial-head">
        <div><div className="spatial-eyebrow">N.O.R.I. · LOCAL SPATIAL WORKSPACE</div><h1>Work in space, not in a stack.</h1><p>Live Nori state, model runtime, project surfaces, and private workspace notes.</p></div>
        <button className="spatial-close" onClick={onClose} aria-label="Close spatial workspace">×</button>
      </header>
      <div className="spatial-toolbar">
        <nav className="spatial-rooms" aria-label="Workspace areas">
          {rooms.map((room) => <button key={room} aria-pressed={layout.room === room} onClick={() => setLayout((current) => ({ ...current, room }))}>{room}</button>)}
        </nav>
        {layout.room === 'WORK' && <div className="spatial-project-path"><span>NORI PROJECT</span><code>{projectListing?.path || projectPath}</code>{projectPath !== '.' && <button className="spatial-tool" onClick={() => openProjectFolder(parentProjectPath())}>UP</button>}</div>}
        <label className="spatial-search"><span aria-hidden="true">⌕</span><input aria-label="Search workspace objects" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an object…" /></label>
        <button className="spatial-tool" onClick={() => setZoom((value) => Math.max(.65, Math.min(1.6, value - .12)))} aria-label="Zoom out">−</button>
        <output className="spatial-zoom" aria-label="Workspace zoom">{Math.round(zoom * 100)}%</output>
        <button className="spatial-tool" onClick={() => setZoom((value) => Math.max(.65, Math.min(1.6, value + .12)))} aria-label="Zoom in">+</button>
        <button className="spatial-tool" onClick={resetRoom} title="Reset placements in this area">RE-FRAME</button>
        {!storageReady && <button className="spatial-danger" onClick={resetSavedLayout}>RESET SAVED SPACE</button>}
      </div>
      <div className="spatial-content">
        <div className={`spatial-canvas${layout.room === 'MODELS' ? ' is-model-room' : ''}`} ref={canvas} onPointerDown={startPan} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.65, Math.min(1.6, value + (event.deltaY < 0 ? .06 : -.06)))) }}>
          {layout.room === 'MODELS' && <ModelSpace3D modelName={selectedNode?.room === 'MODELS' && selectedNode.kind === 'model' ? selectedNode.title : modelStatus?.loadedModel || modelStatus?.model || bridge.model || 'NORI MODEL SPACE'} runtime={modelStatus?.runtime || 'Norama · local runtime'} online={Boolean(modelStatus?.online && selectedNode?.id === 'model-active-runtime')} state={selectedNode?.id === 'model-candidate-qwen36' ? 'CATALOG CANDIDATE · NOT INSTALLED OR LOADED' : selectedNode?.id === 'model-son-target' ? 'NORI SoN TARGET · TRAINING/SERVING GATES OPEN' : modelStatus?.online ? 'LOCAL RUNTIME REPORTED ONLINE' : modelStatus?.loadedModel ? 'MODEL IDENTIFIED · RUNTIME NOT REPORTED ONLINE' : modelStatus?.model ? 'MODEL SELECTED · RUNTIME NOT REPORTED ONLINE' : 'NO MODEL REPORTED LOADED'} />}
          <div className="spatial-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <svg className="spatial-links" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
              {visibleEdges.map(({ a, b, relation }, index) => <line key={`${a.id}-${b.id}-${index}`} className={`spatial-link is-${relation}`} x1={a.x * 1000} y1={a.y * 700} x2={b.x * 1000} y2={b.y * 700} />)}
            </svg>
            {filtered.map((node) => {
              const position = layout.positions[node.id] ?? node
              return <button key={node.id} className={`spatial-node node-${node.kind}${selected === node.id ? ' is-selected' : ''}`} style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%`, zIndex: 10 + Math.round(position.z) }} onClick={() => activateNode(node)} onPointerDown={(event) => startNodeDrag(event, { ...node, ...position })} onKeyDown={(event) => nudge(event, node)} aria-label={`${node.title}, ${node.status}. Drag or use arrow keys to move.`}>
                <span className="spatial-node-kind">{node.kind}</span><strong>{node.title}</strong><span className="spatial-node-state"><i />{node.status}</span>
              </button>
            })}
          {filtered.length === 0 && <div className="spatial-empty">{query ? 'No matching objects in this area.' : layout.room === 'NOTES' ? 'Add a note to start mapping this area.' : layout.room === 'APPS' ? 'Ask Nori to build a local app; validated drafts will appear here for review.' : 'Nothing is currently reported in this area.'}</div>}
          </div>
          <span className="spatial-canvas-hint">DRAG TO ARRANGE · BLANK SPACE TO PAN · WHEEL TO ZOOM · ARROWS TO NUDGE</span>
        </div>
        <aside className="spatial-inspector" aria-label="Selected workspace object">
          <div className="spatial-inspector-label">OBJECT INSPECTOR</div>
          {selectedNode ? <>
            <span className="spatial-inspector-kind">{selectedNode.kind} · {selectedNode.origin === 'nori_live' ? 'LIVE STATE' : selectedNode.origin === 'nori_project' ? 'READ-ONLY PROJECT DATA' : selectedNode.origin === 'nori_app' ? 'NORi-OWNED LOCAL APP' : 'LOCAL DATA'}</span>
            <h2>{selectedNode.title}</h2><p>{selectedNode.detail}</p>
            <div className="spatial-proof"><span>STATE</span><strong>{selectedNode.status}</strong></div>
            {selectedNode.kind === 'model' && selectedNode.room !== 'MODELS' && <button className="spatial-primary" onClick={() => { setSettingsOpen(true); onClose() }}>OPEN MODEL SETTINGS</button>}
            {selectedNode.kind === 'surface' && selectedNode.sourceId && <button className="spatial-primary" onClick={() => { focusBlade(selectedNode.sourceId!); onClose() }}>FOCUS OPEN SURFACE</button>}
            {selectedNode.kind === 'project' && selectedNode.sourceId && selectedNode.status === 'LOCAL FOLDER' && <button className="spatial-primary" onClick={() => openProjectFolder(selectedNode.sourceId!)}>OPEN FOLDER IN SPACE</button>}
            {selectedNode.kind === 'project' && selectedNode.sourceId && selectedNode.status === 'LOCAL FILE' && <button className="spatial-primary" onClick={() => void readProjectFile(selectedNode.sourceId!)}>READ SAFE EXCERPT</button>}
            {selectedNode.kind === 'app' && selectedNode.status === 'PENDING REVIEW' && <>
              {reviewedSelectedApp && <div className="spatial-proof"><span>NEURALESE VALIDATION</span><strong>{reviewedSelectedApp.validation.status}</strong><span>{reviewedSelectedApp.validation.findings.length ? reviewedSelectedApp.validation.findings.map(item => item.code).join(' · ') : 'No structural findings'}</span></div>}
              <p className="local-app-inert">Review the typed schema and capability list below. Approval opens a local-only generated interface; declared workflows remain inactive.</p>
              <button className="spatial-primary" disabled={!reviewedSelectedApp || reviewedSelectedApp.validation.status !== 'ready_for_local_preview'} onClick={() => void activateLocalApp()}>APPROVE &amp; OPEN LOCAL APP</button>
            </>}
            {selectedNode.kind === 'app' && selectedNode.status === 'ACTIVE LOCAL APP' && activeSelectedApp && <LocalAppSurface app={activeSelectedApp} />}
            {selectedNode.kind === 'note' && <button className="spatial-danger" onClick={() => setLayout((current) => ({ ...current, notes: current.notes.filter((item) => item.id !== selectedNode.id) }))}>DELETE THIS NOTE</button>}
          </> : <p>Select an object to inspect it.</p>}
          {layout.room === 'WORK' && (projectError || projectListing?.truncated) && <p className="spatial-project-message" role={projectError ? 'alert' : 'status'}>{projectError || 'Folder listing capped at 100 visible items.'}</p>}
          {projectPreview && <pre className="spatial-project-preview">{projectPreview}</pre>}
          {layout.room === 'APPS' && appDraftError && <p className="spatial-project-message" role="alert">{appDraftError}</p>}
          {appDraftPreview && <pre className="spatial-project-preview">{appDraftPreview}</pre>}
          {layout.room === 'NOTES' && <form className="spatial-note-form" onSubmit={addNote}><label htmlFor="spatial-note-title">Add a local note</label><input id="spatial-note-title" value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} maxLength={80} placeholder="Title" /><textarea value={noteDetail} onChange={(event) => setNoteDetail(event.target.value)} maxLength={1000} placeholder="What should live in this workspace?" rows={4} /><button className="spatial-primary" type="submit" disabled={!noteTitle.trim() || !noteDetail.trim()}>ADD TO SPACE</button></form>}
          <div className="spatial-integrity"><span>NEURALESE FRAME</span><code>{frame.value?.schema ?? 'INVALID'}</code><span>{frame.value ? `${frame.value.nodes.length} objects · ${frame.value.edges.length} links · 0 translation losses · no action authority` : frame.error || frameError}</span></div>
        </aside>
      </div>
      <footer className="spatial-footer"><span>{filtered.length} OBJECTS IN {layout.room}</span><span>{connected.length} bridge connections · {blades.length} open surfaces · {appDrafts.length} local app drafts · {layout.notes.length} saved notes</span><span>{storageReady ? 'Layout saved on this device' : frameError || 'Existing saved layout preserved'}</span></footer>
    </section>
  </div>
}
