'use strict'

// On-demand lifecycle for the owned ComfyUI image/video runtime. It used to start at every boot
// and hold ~2.5 GB of RAM plus GPU memory even when no image was ever asked for, which pushed
// the text model down to a smaller fallback. Now the bridge asks for it per image/video request
// (IPC 'nori-image-runtime-start'), and it is stopped after it has been idle: no request and an
// empty ComfyUI queue for idleMs. Starting and stopping never touch user files or models.
function createImageRuntimeLifecycle({start, stop, isOwnedAlive, queueBusy, clock = Date.now, idleMs = 10 * 60_000} = {}) {
  if (typeof start !== 'function' || typeof stop !== 'function' || typeof isOwnedAlive !== 'function' || typeof queueBusy !== 'function')
    throw new TypeError('Image runtime lifecycle requires start, stop, ownership and queue checks')
  if (!Number.isSafeInteger(idleMs) || idleMs < 60_000) throw new RangeError('Image runtime idle window must be at least one minute')
  let starting = null, lastActive = clock(), stopping = null
  const request = () => {
    lastActive = clock()
    if (stopping) return stopping.then(() => request())
    if (!starting) starting = Promise.resolve().then(start).finally(() => { starting = null; lastActive = clock() })
    return starting
  }
  // Called periodically. Stops only a runtime this app owns, only when nothing is queued or
  // running and nothing asked for it within the idle window. Returns what it did.
  const tick = async () => {
    if (starting || stopping || !isOwnedAlive()) return 'none'
    let busy
    try { busy = await queueBusy() } catch { busy = true } // unknown state: keep it running
    if (busy) { lastActive = clock(); return 'busy' }
    if (clock() - lastActive < idleMs) return 'recent'
    stopping = Promise.resolve().then(stop).finally(() => { stopping = null })
    await stopping
    return 'stopped'
  }
  return Object.freeze({request, tick, get lastActive() { return lastActive }})
}

module.exports = {createImageRuntimeLifecycle}
