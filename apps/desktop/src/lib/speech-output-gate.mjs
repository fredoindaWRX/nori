/** Session-only opt-in speech; independent of microphone/wake listening. */
export function createSpeechOutputGate() {
  let enabled = false
  const active = new Set()
  const silent = () => ({say() {}, push() {}, async end() {}, cancel() {}, level: () => 0})
  return {
    enabled: () => enabled,
    setEnabled(value) {
      enabled = value === true
      if (!enabled) { for (const speaker of active) speaker.cancel(); active.clear() }
      return enabled
    },
    create(factory) {
      if (!enabled) return silent()
      const speaker = factory()
      let ended = false
      const control = {
        say(text) { if (enabled && !ended) speaker.say(text) },
        push(text) { if (enabled && !ended) speaker.push(text) },
        async end() { try { if (enabled && !ended) await speaker.end() } finally { ended=true; active.delete(control) } },
        cancel() { ended=true; active.delete(control); speaker.cancel() },
        level: () => enabled && !ended ? speaker.level() : 0,
      }
      active.add(control)
      return control
    },
  }
}
