/** Electron display bounds are desktop DIPs, not physical pixels. Retaining
 * negative origins is essential for monitors left of or above the primary. */
function workspaceLayout(displays, primaryId) {
  const screens = displays.map((display) => ({
    id: String(display.id), label: display.label || `Display ${display.id}`,
    primary: String(display.id) === String(primaryId),
    x: display.workArea.x, y: display.workArea.y,
    width: display.workArea.width, height: display.workArea.height,
    scaleFactor: display.scaleFactor || 1,
  })).filter((display) => display.width > 0 && display.height > 0)
  if (!screens.length) return { screens: [], bounds: { x: 0, y: 0, width: 1440, height: 900 } }
  const x = Math.min(...screens.map((display) => display.x))
  const y = Math.min(...screens.map((display) => display.y))
  const right = Math.max(...screens.map((display) => display.x + display.width))
  const bottom = Math.max(...screens.map((display) => display.y + display.height))
  return { screens, bounds: { x, y, width: right - x, height: bottom - y } }
}
function fitWindowBounds(bounds, workArea) {
  const width=Math.min(Math.max(640,bounds.width),workArea.width)
  const height=Math.min(Math.max(480,bounds.height),workArea.height)
  return {x:Math.min(Math.max(bounds.x,workArea.x),workArea.x+workArea.width-width),y:Math.min(Math.max(bounds.y,workArea.y),workArea.y+workArea.height-height),width,height}
}
module.exports = { workspaceLayout, fitWindowBounds }
