const { connect } = require('node:net')
const { encodeFrame, decodeFrame, MAX_FRAME_BYTES } = require('./guardian-session-protocol.cjs')
const PREFIX = 'NORI_DESKTOP_GUARDIAN_'
const FIELDS = Object.freeze(['PIPE', 'NONCE', 'KEY', 'PID'])
function consumeGuardianEnvironment(environment = process.env) {
  const entries = Object.entries(environment).filter(([name]) => name.toUpperCase().startsWith(PREFIX))
  const values = {}, names = new Set()
  // Strip even malformed/duplicate descriptors before any child can inherit.
  for (const [name] of entries) delete environment[name]
  if (!entries.length) return null
  for (const [name, value] of entries) {
    const field = name.toUpperCase().slice(PREFIX.length)
    if (!FIELDS.includes(field) || names.has(field)) throw Error('Invalid guardian launch descriptor')
    names.add(field); values[field] = value
  }
  if (names.size !== FIELDS.length || FIELDS.some(field => typeof values[field] !== 'string') ||
    !/^[a-f0-9]{64}$/.test(values.NONCE || '') ||
    !/^[a-f0-9]{64}$/.test(values.KEY || '') ||
    values.PIPE !== `\\\\.\\pipe\\nori-guardian-${values.NONCE}` ||
    !/^[1-9][0-9]{0,9}$/.test(values.PID || '') || Number(values.PID) > 0xffffffff)
    throw Error('Invalid guardian launch descriptor')
  return Object.freeze({ pipePath: values.PIPE, nonce: values.NONCE, key: values.KEY, controllerPid: Number(values.PID) })
}

async function connectGuardianSession(descriptor, { pid = process.pid, timeoutMs = 10000,
  ackTimeoutMs = 5000, onFailure = () => {}, connectSocket = connect } = {}) {
  if (!descriptor || typeof descriptor !== 'object' ||
    !Number.isInteger(pid) || pid < 1 || pid > 0xffffffff ||
    !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
    !Number.isInteger(ackTimeoutMs) || ackTimeoutMs < 1 || ackTimeoutMs > 30000 || typeof onFailure !== 'function')
    throw Error('Invalid guardian connection options')
  // Validate a descriptor even if a caller bypasses the consuming helper.
  const copy = Object.fromEntries(FIELDS.map(field => [PREFIX + field,
    field === 'PIPE' ? descriptor.pipePath : field === 'PID' ? String(descriptor.controllerPid) : descriptor[field.toLowerCase()]]))
  consumeGuardianEnvironment(copy)
  let socket, buffer = Buffer.alloc(0), pending, closed = false, failure = false, terminal = false
  let challenge, sequence = 1, reportPending = false
  const fail = () => {
    if (failure || terminal) return
    failure = true
    if (pending) { const item = pending; pending = null; clearTimeout(item.timer); item.reject(Error('Guardian channel failed')) }
    socket?.destroy()
    try { onFailure() } catch { /* Owner callback cannot prevent channel refusal. */ }
  }
  const next = deadline => {
    if (failure || closed || pending) return Promise.reject(Error('Guardian channel unavailable'))
    return new Promise((resolve, reject) => {
      pending = { resolve, reject, timer: setTimeout(fail, deadline) }
    })
  }
  try {
    // Register the bounded receive waiter before a server can send challenge.
    const first = next(timeoutMs)
    // A synchronous connection failure still rejects this owned waiter safely.
    void first.catch(() => {})
    socket = connectSocket({ path: descriptor.pipePath })
    socket.on('error', fail)
    socket.on('close', () => { closed = true; if (!terminal) fail() })
    socket.on('end', () => { closed = true; if (!terminal) fail() })
    socket.on('data', bytes => {
      if (failure || terminal) return
      for (const byte of bytes) {
        if (byte !== 10 && (byte < 32 || byte > 126)) { fail(); return }
        if (buffer.length + 1 > MAX_FRAME_BYTES) { fail(); return }
        buffer = Buffer.concat([buffer, Buffer.from([byte])])
        if (byte !== 10) continue
        let frame
        try { frame = decodeFrame(buffer.toString('ascii'), descriptor.key) } catch { fail(); return }
        buffer = Buffer.alloc(0)
        if (!pending || frame.nonce !== descriptor.nonce || frame.controllerPid !== descriptor.controllerPid || frame.guiPid !== pid) { fail(); return }
        const item = pending; pending = null; clearTimeout(item.timer); item.resolve(frame)
      }
    })
    challenge = await first
    if (challenge.kind !== 'challenge' || challenge.sequence !== 0 || challenge.flags !== 0) throw Error('Invalid guardian challenge')
    const request = async (kind, flags, seq) => {
      const fields = { kind, flags, sequence: seq, nonce: descriptor.nonce, challenge: challenge.challenge,
        controllerPid: descriptor.controllerPid, guiPid: pid }
      const wire = encodeFrame(fields, descriptor.key)
      const reply = next(ackTimeoutMs)
      try { socket.write(wire, error => { if (error) fail() }) } catch { fail() }
      const ack = await reply
      if (ack.kind !== 'ack' || ack.challenge !== challenge.challenge || ack.sequence !== seq || ack.flags !== flags)
        throw Error('Invalid guardian acknowledgement')
    }
    await request('attached', 0, sequence)
    return Object.freeze({
      report(kind, flags) {
        // One bounded in-flight request, no queue/reconnect/replay/endpoint swap.
        if (!['ready', 'quitting', 'terminal'].includes(kind) || terminal || failure)
          return Promise.reject(Error('Guardian report unavailable'))
        if (reportPending) return Promise.reject(Error('Guardian report already pending'))
        reportPending = true
        return (async () => {
          if (sequence === 0xffffffff) throw Error('Guardian sequence exhausted')
          await request(kind, flags, ++sequence)
          if (kind === 'terminal') { terminal = true; socket.end() }
        })().catch(() => { fail(); throw Error('Guardian report failed') })
          .finally(() => { reportPending = false })
      },
      close() { if (!terminal) fail(); else socket.destroy() },
    })
  } catch {
    fail()
    throw Error('Guardian session authentication failed')
  }
}
module.exports = { consumeGuardianEnvironment, connectGuardianSession }
