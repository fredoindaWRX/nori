// Capture adapters must confirm release before the foreground app can launch.
// This controller does not capture audio, install startup, or infer process death.
function createBackgroundWakeController({ startCapture, stopCapture, launchApp }) {
  let state = 'disabled', generation = 0, serial = Promise.resolve()
  const enqueue = operation => {
    const result = serial.then(operation)
    serial = result.catch(() => {})
    return result
  }
  const release = async () => {
    if (await stopCapture() !== true) throw Error('Background microphone release not confirmed')
  }
  const disable = () => {
    generation++ // Also invalidate an in-flight capture startup.
    return enqueue(async () => {
      try { await release(); state = 'disabled' }
      catch (error) { state = 'failed'; throw error }
    })
  }
  return {
    state: () => state,
    disable,
    enable: () => {
      const ticket = generation
      return enqueue(async () => {
        if (ticket !== generation || state !== 'disabled') return false
        try {
          state = 'arming'
          if (await startCapture() !== true) throw Error('Background microphone startup not confirmed')
          if (ticket !== generation) { await release(); state = 'disabled'; return false }
          state = 'listening'
          return true
        } catch (error) {
          state = 'failed'
          try { await release() } catch { /* Preserve failure; never launch. */ }
          throw error
        }
      })
    },
    transcript: text => enqueue(async () => {
      // Background wake is an explicit address, not an incidental mention.
      if (state !== 'listening' || typeof text !== 'string' || text.length > 512 ||
          !/^\s*hey[\s,]+(?:nori|norrie|norry|norri)[\s,.!?]*$/i.test(text)) return false
      const ticket = generation
      state = 'handoff'
      try {
        await release()
        if (ticket !== generation) { state = 'disabled'; return false }
        if (await launchApp() !== true) throw Error('Nori app launch not confirmed')
        state = 'foreground'
        return true
      } catch (error) { state = 'failed'; throw error }
    }),
  }
}
module.exports = { createBackgroundWakeController }
