// Pure local energy gate. It is not speech recognition or speaker identity.
// Caller feeds fixed-cadence samples only after microphone consent.
function createVoiceActivityGate({ threshold = 0.025, startMs = 200, silenceMs = 1000, maxMs = 28000 } = {}) {
  if (![threshold, startMs, silenceMs, maxMs].every(Number.isFinite)
      || threshold <= 0 || threshold >= 1 || startMs < 100 || silenceMs < 300 || maxMs <= silenceMs) throw Error('Invalid voice activity settings')
  let active = false, loudSince = null, quietSince = null, began = null, previous = null
  function reset() { active = false; loudSince = quietSince = began = previous = null }
  return {
    reset,
    sample(samples, now) {
      if (!Number.isFinite(now) || (previous !== null && now < previous)) { reset(); return 'reset' }
      previous = now
      if (!samples || !samples.length) return null
      let square = 0
      for (const value of samples) {
        if (!Number.isFinite(value) || Math.abs(value) > 1) { reset(); return 'reset' }
        square += value * value
      }
      const loud = Math.sqrt(square / samples.length) >= threshold
      if (!active) {
        if (!loud) { loudSince = null; return null }
        loudSince ??= now
        if (now - loudSince < startMs) return null
        active = true; began = now; quietSince = null
        return 'start'
      }
      if (loud) quietSince = null
      else quietSince ??= now
      if (now - began >= maxMs || (quietSince !== null && now - quietSince >= silenceMs)) {
        reset(); return 'stop'
      }
      return null
    },
  }
}
module.exports = { createVoiceActivityGate }
