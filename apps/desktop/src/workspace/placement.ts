/** Pure workspace geometry, in desktop DIPs. No sensors or native windows. */
export type Rect = { x: number; y: number; width: number; height: number }
export type Display = Rect & { id: string; label: string; primary: boolean; scaleFactor: number }
export type WorkspaceState = { screens: Display[]; bounds: Rect; viewport: Rect; spanning: boolean; maximized: boolean; enabled: boolean }
export type Presence = { selected: string; movedAt: number; compact: boolean; corner: number }
const valid = (r: Rect) => [r.x,r.y,r.width,r.height].every(Number.isFinite) && r.width>0 && r.height>0
export const area = (a: Rect,b: Rect) => Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) * Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))

export function visibleScreens(state: WorkspaceState,width: number,height: number): Display[] {
  const viewport = {x:0,y:0,width,height}
  return state.screens.filter(valid).map(display => ({...display,x:display.x-state.viewport.x,y:display.y-state.viewport.y}))
    .filter(display => area(display,viewport)>100)
    .map(display => ({...display,x:Math.max(0,display.x),y:Math.max(0,display.y),
      width:Math.min(width,display.x+display.width)-Math.max(0,display.x),
      height:Math.min(height,display.y+display.height)-Math.max(0,display.y)}))
}
export function workspaceKey(state: WorkspaceState,width: number,height: number): string {
  return JSON.stringify([state.enabled,state.viewport,width,height,
    state.screens.map(d => [d.id,d.x,d.y,d.width,d.height,d.primary,d.scaleFactor]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))])
}
/** Union, not sum: stacked panels must never count the same pixels twice. */
export function occupiedArea(bounds: Rect,panels: Rect[]): number {
  if (!valid(bounds)) return 0
  const clipped = panels.filter(valid).filter(p=>area(bounds,p)>0).map(p => ({
    x:Math.max(bounds.x,p.x),y:Math.max(bounds.y,p.y),
    right:Math.min(bounds.x+bounds.width,p.x+p.width),bottom:Math.min(bounds.y+bounds.height,p.y+p.height),
  }))
  const xs = [...new Set(clipped.flatMap(p=>[p.x,p.right]))].sort((a,b)=>a-b)
  let total = 0
  for (let i=1;i<xs.length;i++) {
    const intervals = clipped.filter(p=>p.x<xs[i] && p.right>xs[i-1]).map(p=>[p.y,p.bottom]).sort((a,b)=>a[0]-b[0])
    let end = -Infinity,covered = 0
    for (const [top,bottom] of intervals) {
      covered += Math.max(0,bottom-Math.max(top,end))
      end = Math.max(end,bottom)
    }
    total += (xs[i]-xs[i-1])*covered
  }
  return total
}
export function placeEntity(screens: Display[],panels: Rect[],previous: Presence,now: number): { presence: Presence; view: Rect } | null {
  if (!screens.length) return null
  const primary = screens.find(d=>d.primary) || screens[0]
  const presence = {...previous}
  const candidates = screens.map(display=>({display,score:occupiedArea(display,panels)/(display.width*display.height)}))
    .sort((a,b)=>a.score-b.score || Number(b.display.id===primary.id)-Number(a.display.id===primary.id) || a.display.id.localeCompare(b.display.id))
  let current = candidates.find(c=>c.display.id===presence.selected)
  if (!current) { current=candidates[0]; presence.selected=current.display.id;presence.compact=false;presence.corner=0 }
  const best=candidates[0]
  if (now-presence.movedAt>2400 && best.score+.10<current.score) {
    current=best;presence.selected=best.display.id;presence.movedAt=now;presence.compact=false;presence.corner=0
  }
  const display=current.display
  if (current.score>.18) presence.compact=true
  else if (current.score<.08) presence.compact=false
  let view: Rect={x:display.x,y:display.y,width:display.width,height:display.height}
  if (presence.compact) {
    const w=Math.min(display.width*.52,display.height*.86),h=Math.min(display.height*.72,w)
    const choices=[.05,.95].flatMap(x=>[.28,.64].map(y=>({x:display.x+(display.width-w)*x,y:display.y+(display.height-h)*y,width:w,height:h})))
    const costs=choices.map(c=>occupiedArea(c,panels)/(w*h)),corner=costs.indexOf(Math.min(...costs))
    if (presence.corner<0 || presence.corner>=choices.length) presence.corner=0
    if (costs[corner]+.12<costs[presence.corner] && now-presence.movedAt>1200) { presence.corner=corner;presence.movedAt=now }
    view=choices[presence.corner]
  }
  return {presence,view}
}
