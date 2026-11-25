/**
 * The camera, and everything that looks through it.
 *
 * One stream, shared. Hand tracking wants it, the camera blade wants it, and
 * looking at something wants it — and a second getUserMedia makes Chrome drop
 * the first, so anything that opens its own would silently blind the others.
 * Everything here goes through one refcounted handle.
 *
 * Three ways of seeing, because "look at this" means three different things:
 *
 *   grabFrame   — one photograph. What is in front of me right now.
 *   watchAhead  — the next few seconds, as a grid. What am I doing.
 *   recentGrid  — the last few seconds, as a grid. What did I just do.
 *
 * The grid is the whole trick for the last two. A model sees images, not video,
 * so a clip has to become a contact sheet: frames sampled evenly, laid out in
 * reading order, each stamped with its offset so the order is unambiguous and
 * the model can talk about timing rather than just contents.
 *
 * Nothing is written to disk and nothing leaves the machine except the single
 * still that a tool call returns. The rolling buffer exists only while the
 * camera is open and is dropped the moment it closes.
 */

/** Frames per second kept in the rolling buffer. Enough to catch a gesture,
 *  cheap enough to run alongside hand tracking. */
const BUFFER_FPS = 6
/** How much past to keep. Long enough for "what did I just do", short enough
 *  that the memory cost is a few megabytes rather than a few hundred. */
const BUFFER_SECONDS = 10

/** Each cell in a contact sheet. Small on purpose — nine of these is already a
 *  large image, and detail past this adds tokens rather than understanding. */
const CELL_W = 426
const CELL_H = 240

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
/** What the live stream is: the webcam, or a shared screen, window or tab. */
let source: 'camera' | 'screen' = 'camera'
/** Told when the user ends a share from Chrome's own bar, so the blade that
 *  opened it can close itself instead of showing a frozen frame. */
const endedListeners = new Set<() => void>()
const screenStateListeners = new Set<(active: boolean) => void>()
/** How many things currently need the camera. It closes at zero, not before. */
let holders = 0

export const diag = {
  open: false,
  holders: 0,
  buffered: 0,
  lastError: '',
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__camera = diag
}

/* ------------------------------------------------------------------- stream */

/**
 * Take a hold on the camera. Every caller must release it exactly once.
 *
 * Refcounted rather than "open if closed", because the failure mode of getting
 * that wrong is invisible: whoever closes it last takes the picture away from
 * everyone still using it, and the symptom is another feature going blind for
 * reasons that have nothing to do with it.
 */
export async function holdCamera(): Promise<HTMLVideoElement> {
  return hold('camera')
}

/**
 * Share the screen instead. Chrome's own picker offers a tab, a window or
 * the whole screen, which is where "share the Zoom window" gets answered.
 * While a share is live it is what every look, watch and per-turn frame sees;
 * the webcam is not opened alongside it.
 */
export async function holdScreen(): Promise<HTMLVideoElement> {
  return hold('screen')
}

export const screenLive = () => source === 'screen' && Boolean(video && stream)
export const monitorCaptureAvailable = () => screenLive() || Boolean(window.noriWorkspace?.captureDisplays)

export function onShareEnded(fn: () => void): () => void {
  endedListeners.add(fn)
  return () => endedListeners.delete(fn)
}

/** Lets the visible HUD turn screen monitoring off as soon as sharing stops. */
export function onScreenState(fn: (active: boolean) => void): () => void {
  screenStateListeners.add(fn)
  return () => screenStateListeners.delete(fn)
}

async function hold(want: 'camera' | 'screen'): Promise<HTMLVideoElement> {
  holders++
  diag.holders = holders
  // A live share answers a request for the camera too: "look at this" while
  // sharing means the screen. A live camera does not answer a request for the
  // screen; that swaps the source.
  if (video && stream && (source === want || source === 'screen')) return video
  if (video && stream) tearDown()

  try {
    stream =
      want === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 5 },
            audio: false,
          })
        : await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720, facingMode: 'user' },
          })
    source = want
    const el = document.createElement('video')
    el.autoplay = true
    el.playsInline = true
    el.muted = true
    el.srcObject = stream
    await el.play()
    video = el
    diag.open = true
    diag.lastError = ''
    if (want === 'screen') screenStateListeners.forEach((fn) => fn(true))
    if (want === 'screen') {
      // "Stop sharing" on Chrome's bar ends the track with no other signal.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        holders = 0
        diag.holders = 0
        tearDown()
        endedListeners.forEach((fn) => fn())
      })
    }
    return el
  } catch (err) {
    // The hold is given back on failure, or the count drifts up for ever and
    // the camera can never be closed.
    holders = Math.max(0, holders - 1)
    diag.holders = holders
    diag.lastError = String((err as Error)?.message ?? err)
    throw err
  }
}

/** Give back a hold. The camera light goes out when the last one does. */
export function releaseCamera(): void {
  holders = Math.max(0, holders - 1)
  diag.holders = holders
  if (holders > 0) return
  tearDown()
}

function tearDown(): void {
  const stoppedScreen = source === 'screen'
  stopBuffer()
  if (video) {
    video.pause()
    video.srcObject = null
    video = null
  }
  // Stopping every track is what actually extinguishes the hardware light.
  // Anything less leaves it on, and a user who sees that is right to distrust
  // every other claim this interface makes about its camera.
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  source = 'camera'
  diag.open = false
  if (stoppedScreen) screenStateListeners.forEach((fn) => fn(false))
}

export const cameraLive = () => Boolean(video && stream)
export const cameraStream = () => stream

/** Copy one frame from the already-active matching source without taking a hold. */
export function sampleActiveFrame(want: 'camera' | 'screen'): HTMLCanvasElement | null {
  const sourceIsActive = want === 'screen' ? screenLive() : cameraLive() && !screenLive()
  if (!sourceIsActive || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null
  }

  const canvas = document.createElement('canvas')
  if (!drawTo(canvas, video.videoWidth, video.videoHeight)) return null
  return canvas
}

/* -------------------------------------------------------------------- frames */

function drawTo(canvas: HTMLCanvasElement, w: number, h: number) {
  const ctx = canvas.getContext('2d')
  if (!ctx || !video) return null
  canvas.width = w
  canvas.height = h
  /**
   * Drawn unmirrored, deliberately.
   *
   * The hand overlay mirrors its coordinates because a mirror is what a person
   * expects to see of themselves. The raw frame is not mirrored, and for
   * looking at something that is the correct choice: hold a label up to the
   * camera and the raw frame reads it the right way round, while a mirrored
   * one hands the model text backwards.
   */
  ctx.drawImage(video, 0, 0, w, h)
  return ctx
}

const toJpeg = (canvas: HTMLCanvasElement, q = 0.82) => {
  const url = canvas.toDataURL('image/jpeg', q)
  return { data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' }
}

/** One frame, full size. */
export function grabFrame(): { data: string; mimeType: string } {
  if (!video?.videoWidth) throw new Error('the camera is not ready')
  const canvas = document.createElement('canvas')
  if (!drawTo(canvas, video.videoWidth, video.videoHeight)) {
    throw new Error('could not read the camera frame')
  }
  return toJpeg(canvas)
}

/**
 * The frame that rides with each spoken turn while the screen is shared, so
 * "what do you think of this" needs no tool call. Kept small: the model reads
 * a 1280-wide screenshot fine, and a full 4K frame per turn is mostly cost.
 */
export function frameForTurn(): { data: string; mimeType: string } | null {
  if (!screenLive() || !video?.videoWidth) return null
  const scale = Math.min(1, 1280 / video.videoWidth)
  const canvas = document.createElement('canvas')
  if (!drawTo(canvas, Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale))) {
    return null
  }
  return toJpeg(canvas, 0.6)
}

/** A smaller, low-cost frame used only by the explicitly enabled local screen monitor. */
export function frameForMonitor(): { data: string; mimeType: string; signature: number[] } | null {
  if (!screenLive() || !video?.videoWidth) return null
  const scale = Math.min(1, 1024 / video.videoWidth)
  const canvas = document.createElement('canvas')
  if (!drawTo(canvas, Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale))) return null

  // A tiny grayscale signature avoids repeatedly running vision on an unchanged
  // desktop. Four changed cells is enough to catch a new toast/dialog while
  // ignoring a moving cursor or the clock.
  const thumb = document.createElement('canvas')
  thumb.width = 32
  thumb.height = 18
  const ctx = thumb.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height)
  const pixels = ctx.getImageData(0, 0, thumb.width, thumb.height).data
  const signature: number[] = []
  for (let i = 0; i < pixels.length; i += 4) {
    signature.push(Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114))
  }
  return { ...toJpeg(canvas, 0.55), signature }
}

export function screenChanged(previous: number[] | null, next: number[]): boolean {
  if (!previous || previous.length !== next.length) return true
  let changed = 0
  for (let i = 0; i < next.length; i++) {
    if (Math.abs(next[i] - previous[i]) >= 20 && ++changed >= 4) return true
  }
  return false
}

/** Capture all physical displays in the installed desktop shell; web preview
 * falls back to the single display explicitly shared through the browser. */
export async function frameForAllMonitors(): Promise<{ data: string; mimeType: string; signature: number[] } | null> {
  const nativeCapture = window.noriWorkspace?.captureDisplays
  if (!nativeCapture) return frameForMonitor()
  // A failed native all-display capture must not silently become one screen.
  const screens: { id: string; image: string }[] = await nativeCapture()
  if (!screens.length) return null

  const images = await Promise.all(screens.map(({ image }) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('A monitor screenshot could not be decoded.'))
    img.src = image
  })))
  const columns = images.length <= 2 ? 1 : 2
  const rows = Math.ceil(images.length / columns)
  const tileW = 1024
  const tileH = 576
  const canvas = document.createElement('canvas')
  canvas.width = tileW * columns
  canvas.height = tileH * rows
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#08070d'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  images.forEach((img, i) => {
    const scale = Math.min(tileW / img.naturalWidth, tileH / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    const x = (i % columns) * tileW + (tileW - w) / 2
    const y = Math.floor(i / columns) * tileH + (tileH - h) / 2
    ctx.drawImage(img, x, y, w, h)
  })
  const thumb = document.createElement('canvas')
  thumb.width = 48
  thumb.height = 27
  const thumbCtx = thumb.getContext('2d', { willReadFrequently: true })
  if (!thumbCtx) return null
  thumbCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height)
  const pixels = thumbCtx.getImageData(0, 0, thumb.width, thumb.height).data
  const signature: number[] = []
  for (let i = 0; i < pixels.length; i += 4) {
    signature.push(Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114))
  }
  const url = canvas.toDataURL('image/jpeg', 0.55)
  return { data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg', signature }
}

/* -------------------------------------------------------------------- buffer */

type Shot = { at: number; bitmap: HTMLCanvasElement }

let buffer: Shot[] = []
let bufferTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start remembering the recent past.
 *
 * Frames are kept as small canvases rather than as encoded images: encoding
 * costs real time and most of these are thrown away unlooked-at, so paying for
 * it up front would be paying six times a second for something used once.
 */
export function startBuffer(): void {
  if (bufferTimer) return
  bufferTimer = setInterval(() => {
    if (!video?.videoWidth) return
    const cell = document.createElement('canvas')
    if (!drawTo(cell, CELL_W, CELL_H)) return
    buffer.push({ at: performance.now(), bitmap: cell })
    const cutoff = performance.now() - BUFFER_SECONDS * 1000
    while (buffer.length && buffer[0].at < cutoff) buffer.shift()
    diag.buffered = buffer.length
  }, 1000 / BUFFER_FPS)
}

export function stopBuffer(): void {
  if (bufferTimer) clearInterval(bufferTimer)
  bufferTimer = null
  buffer = []
  diag.buffered = 0
}

/* --------------------------------------------------------------------- grids */

/**
 * Lay frames out as a contact sheet.
 *
 * Reading order, left to right and top to bottom, with each cell stamped with
 * its offset in seconds. The stamps are not decoration: without them a model
 * looking at nine similar frames has no way to know which came first, and will
 * describe a sequence of events in whatever order it happens to read them.
 */
function contactSheet(
  shots: { at: number; bitmap: HTMLCanvasElement }[],
  originAt: number,
): { data: string; mimeType: string } {
  const n = shots.length
  const cols = n <= 2 ? n : n <= 6 ? 3 : 4
  const rows = Math.ceil(n / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * CELL_W
  canvas.height = rows * CELL_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not build the grid')

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  shots.forEach((shot, i) => {
    const x = (i % cols) * CELL_W
    const y = Math.floor(i / cols) * CELL_H
    ctx.drawImage(shot.bitmap, x, y, CELL_W, CELL_H)

    const label = `${i + 1}  ${((shot.at - originAt) / 1000).toFixed(1)}s`
    ctx.font = '600 22px ui-monospace, monospace'
    // Drawn twice — dark underneath, light on top — so the stamp survives both
    // a bright frame and a dark one without a panel behind it.
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(label, x + 12, y + 30)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x + 12, y + 30)

    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1)
  })

  return toJpeg(canvas, 0.78)
}

/** Evenly spaced picks, always including the first and last. */
function sample<T>(items: T[], want: number): T[] {
  if (items.length <= want) return items
  const out: T[] = []
  for (let i = 0; i < want; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (want - 1))])
  }
  return out
}

/**
 * Watch for the next few seconds and hand back a grid.
 *
 * Forward-looking, so it is the right tool for "watch me do this" — the answer
 * is about something that has not happened yet when the question is asked.
 */
export async function watchAhead(
  seconds: number,
  frames: number,
): Promise<{ data: string; mimeType: string }> {
  if (!video?.videoWidth) throw new Error('the camera is not ready')
  const shots: Shot[] = []
  const started = performance.now()
  const gap = (seconds * 1000) / Math.max(1, frames - 1)

  for (let i = 0; i < frames; i++) {
    const cell = document.createElement('canvas')
    if (drawTo(cell, CELL_W, CELL_H)) {
      shots.push({ at: performance.now(), bitmap: cell })
    }
    if (i < frames - 1) await new Promise((r) => setTimeout(r, gap))
  }
  if (!shots.length) throw new Error('no frames were captured')
  return contactSheet(shots, started)
}

/**
 * The last few seconds, as a grid.
 *
 * Only possible while the buffer is running, which it is whenever the camera
 * blade is open. This is what answers "what did I just do" — a question that
 * cannot be answered by starting to record when it is asked.
 */
export function recentGrid(
  seconds: number,
  frames: number,
): { data: string; mimeType: string } | null {
  const cutoff = performance.now() - seconds * 1000
  const window = buffer.filter((s) => s.at >= cutoff)
  if (window.length < 2) return null
  const picked = sample(window, frames)
  return contactSheet(picked, picked[0].at)
}

export const bufferedSeconds = () =>
  buffer.length < 2 ? 0 : (buffer[buffer.length - 1].at - buffer[0].at) / 1000
