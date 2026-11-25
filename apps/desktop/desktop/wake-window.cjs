// A local wake can reveal only its own app; no commands or transcripts cross IPC.
function createWakeWindow({ owns, allowed, show, now = () => performance.now() }) {
  let last = -Infinity
  return event => {
    if (!owns(event) || !allowed()) return false
    const time = now()
    if (time - last < 1000) return false
    last = time
    show()
    return true
  }
}
module.exports = { createWakeWindow }
