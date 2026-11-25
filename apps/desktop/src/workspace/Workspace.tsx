import { useEffect, useRef, useState } from 'react'
import './workspace.css'
import { visibleScreens, workspaceKey, placeEntity, type WorkspaceState, type Presence } from './placement'
declare global {
  interface Window {
    noriWorkspace?: {
      read: () => Promise<WorkspaceState | null>
      command: (command: 'minimize' | 'toggle-maximize' | 'hide' | 'toggle-span' | 'quit') => Promise<WorkspaceState | null>
      captureDisplays: () => Promise<{ id: string; image: string }[]>
      handInput: (input: {x:number;y:number;pinch:boolean}) => Promise<boolean>
      subscribe: (callback: (state: WorkspaceState) => void) => () => void
      projectList?: (args: { path: string }) => Promise<{ path: string; entries: Array<{ name: string; kind: 'directory' | 'file' }>; truncated: boolean } | null>
      projectRead?: (args: { path: string; start_line?: number; max_lines?: number }) => Promise<{ path: string; start_line: number; returned_lines: number; content: string; omitted: boolean } | null>
      appDraftList?: () => Promise<{ root: string; entries: Array<{ id: string; title: string; description: string; status: string }>; apps: Array<{ id: string; title: string; description: string; status: string }>; truncated: boolean } | null>
      appDraftRead?: (args: { id: string }) => Promise<{ id: string; status: string; frame: import('./spatial-contract').AppSpecFrame; validation: { status: string; findings: Array<{ code: string; pointer: string; severity: string }>; execution_authorized: false; external_effects: false; materialized: false }; execution_authorized: false; external_effects: false } | null>
      appDraftActivate?: (args: { id: string; approved: true }) => Promise<{ id: string; status: string; path: string; execution_authorized: false; external_effects: false } | null>
      appRead?: (args: { id: string }) => Promise<{ id: string; status: string; frame: import('./spatial-contract').AppSpecFrame; execution_authorized: false; external_effects: false } | null>
      appRecords?: (args: { app_id: string; collection_id: string }) => Promise<{ app_id: string; collection_id: string; records: Array<{ id: string; values: Record<string, string | number | boolean>; updated_at: string }>; execution_authorized: false } | null>
      appRecordCreate?: (args: { app_id: string; collection_id: string; values: Record<string, string | number | boolean> }) => Promise<{ id: string; values: Record<string, string | number | boolean>; updated_at: string; execution_authorized: false } | null>
      appRecordUpdate?: (args: { app_id: string; collection_id: string; record_id: string; values: Record<string, string | number | boolean> }) => Promise<{ id: string; values: Record<string, string | number | boolean>; updated_at: string; execution_authorized: false } | null>
      appRecordDelete?: (args: { app_id: string; collection_id: string; record_id: string }) => Promise<{ id: string; deleted: true; execution_authorized: false } | null>
    }
    noriWorkspaceActive?: boolean
    noriWorkspacePoint?: (x: number,y: number) => {x: number; y: number}
  }
}
const localScreens = (state: WorkspaceState) => visibleScreens(state,innerWidth,innerHeight)

/** One renderer/brain spans all displays. Only its existing scene canvas moves;
 * app panels keep their current pointer/hand drag implementation and state. */
export function Workspace() {
  const [state,setState] = useState<WorkspaceState | null>(null)
  const [presence,setPresence] = useState('')
  const lastLayout=useRef('')
  const placement=useRef<Presence>({selected:'',movedAt:0,compact:false,corner:0})
  useEffect(() => {
    const api = window.noriWorkspace
    if (!api) return
    const off = api.subscribe(setState)
    void api.read().then(setState)
    return off
  },[])
  useEffect(() => {
    if (!state) return
    const root = document.documentElement
    const screens = localScreens(state)
    if (!screens.length) return
    root.dataset.workspace = state.enabled ? 'span' : 'single'
    window.noriWorkspaceActive = state.enabled
    window.noriWorkspacePoint = state.enabled ? (x,y) => {
      const points=screens.map((display)=>({x:Math.max(display.x+1,Math.min(display.x+display.width-2,x)),y:Math.max(display.y+1,Math.min(display.y+display.height-2,y))}))
      points.sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))
      return points[0]
    } : undefined
    const layoutKey=workspaceKey(state,innerWidth,innerHeight)
    if(lastLayout.current && lastLayout.current!==layoutKey) window.dispatchEvent(new Event('nori:workspace-reset-panels'))
    lastLayout.current=layoutKey
    const primary = screens.find((display) => display.primary) || screens[0]
    const css = (name: string, value: number) => root.style.setProperty(name,`${Math.round(value)}px`)
    css('--workspace-home-x',Math.max(0,primary.x)); css('--workspace-home-y',Math.max(0,primary.y))
    css('--workspace-home-w',Math.min(innerWidth,primary.width)); css('--workspace-home-h',Math.min(innerHeight,primary.height))
    const work = screens.find((display) => !display.primary) || primary
    css('--workspace-work-x',Math.max(0,work.x)); css('--workspace-work-y',Math.max(0,work.y))
    css('--workspace-work-w',Math.min(innerWidth,work.width)); css('--workspace-work-h',Math.min(innerHeight,work.height))
    // Native desktop mouse injection is disabled in span mode: app-owned
    // gesture events already cover this complete multi-monitor viewport.
    if (state.enabled) void fetch('http://127.0.0.1:9393/input',{ method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:.5,y:.5,pinch:false}) }).catch(()=>{})
    const update = () => {
      const panels = [...document.querySelectorAll<HTMLElement>('.bl')].flatMap((node) => {
        if (!node.getClientRects().length) return []
        const r = node.getBoundingClientRect()
        return r.width && r.height ? [{x:r.x,y:r.y,width:r.width,height:r.height}] : []
      })
      const next=placeEntity(screens,panels,placement.current,performance.now())
      if (!next) return
      placement.current=next.presence
      const {view}=next
      css('--workspace-nori-x',view.x); css('--workspace-nori-y',view.y)
      css('--workspace-nori-w',view.width); css('--workspace-nori-h',view.height)
      setPresence(next.presence.selected)
    }
    update()
    const timer=setInterval(update,350)
    return () => { clearInterval(timer); delete root.dataset.workspace; window.noriWorkspaceActive=false;window.noriWorkspacePoint=undefined }
  },[state])
  if (!state) return null
  const screens = state.enabled ? localScreens(state) : [{...state.screens[0],x:0,y:0,width:innerWidth,height:innerHeight}]
  return <>
    {screens.map((display,index)=><div key={display.id} className="workspace-toolbar" style={{left:Math.max(0,display.x)+12,top:Math.max(0,display.y)+8,width:Math.min(display.width,innerWidth)-24}}>
      <span className="workspace-drag">N.O.R.I. · {state.enabled ? `DISPLAY ${index+1}${presence===display.id?' · NORI':''}` : 'WORKSPACE'}</span>
      <button onClick={()=>void window.noriWorkspace?.command('toggle-span')} title="Switch between all monitors and a window (F11)">{state.spanning?'Window':'All screens'}</button>
      <button onClick={()=>void window.noriWorkspace?.command('minimize')} aria-label="Minimize Nori" title="Minimize Nori">—</button>
      <button onClick={()=>void window.noriWorkspace?.command('toggle-maximize')} aria-label={state.maximized?'Restore Nori':'Maximize Nori'} title={state.maximized?'Restore':'Maximize'}>{state.maximized?'❐':'□'}</button>
      <button onClick={()=>void window.noriWorkspace?.command('hide')} aria-label="Hide Nori to system tray" title="Hide to system tray">×</button>
    </div>)}
  </>
}
