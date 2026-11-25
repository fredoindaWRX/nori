'use strict'
// Disposable Node acceptance peer. No Electron/GUI, state access or lease.
const net = require('node:net')
const { createHmac, timingSafeEqual } = require('node:crypto')
const scenario = process.argv[2]
if (scenario === 'idle') {
  setInterval(() => {}, 1000)
} else {
  const pipePath = process.env.NORI_PIPE_FIXTURE_PATH
  const key = Buffer.from(process.env.NORI_PIPE_FIXTURE_KEY, 'hex')
  const nonce = process.env.NORI_PIPE_FIXTURE_NONCE
  const controllerPid = process.env.NORI_PIPE_FIXTURE_CONTROLLER
  const socket = net.connect(pipePath)
  let challenge, buffer = '', step = 0
  const mac = prefix => createHmac('sha256', key).update(prefix, 'ascii').digest('hex')
  const encode = (kind, sequence, flags) => {
    const prefix = ['NG1', kind, nonce, challenge, controllerPid, String(process.pid), String(sequence), String(flags)].join('|')
    return `${prefix}|${mac(prefix)}\n`
  }
  const fail = () => { process.exitCode = 1; socket.destroy() }
  socket.on('error', () => {
    if (!['wrong-peer', 'wrong-mac', 'replay', 'skipped-sequence', 'ready-twice', 'sticky-failure',
      'normal-upgrade', 'oversized', 'non-ascii', 'ownership-without-cleanup', 'terminal-before-quitting'].includes(scenario)) fail()
  })
  socket.on('data', bytes => {
    buffer += bytes.toString('ascii')
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n'), line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      const fields = line.split('|')
      if (fields.length !== 9 || fields[0] !== 'NG1' || fields[2] !== nonce || fields[4] !== controllerPid ||
          fields[5] !== String(process.pid) || !/^[a-f0-9]{64}$/.test(fields[3])) return fail()
      challenge = fields[3]
      if (!/^[a-f0-9]{64}$/.test(fields[8]) || !timingSafeEqual(Buffer.from(fields[8], 'hex'),
          Buffer.from(mac(fields.slice(0, 8).join('|')), 'hex'))) return fail()
      if (step === 0) {
        if (fields[1] !== 'challenge' || fields[6] !== '0' || fields[7] !== '0') return fail()
        if (scenario === 'wrong-peer') return fail() // Server must reject BEFORE challenge.
        const attached = encode('attached', 1, 0)
        socket.write(scenario === 'wrong-mac' ? attached.slice(0, -65) + '0'.repeat(64) + '\n' : attached)
        step++
        continue
      }
      const reports = scenario === 'happy' ? [['ready', 2, 48], ['quitting', 3, 50], ['terminal', 4, 62]] :
        scenario === 'late-failure' ? [['ready', 2, 48], ['quitting', 3, 50], ['terminal', 4, 61]] :
        scenario === 'cancelled' ? [['quitting', 2, 0], ['terminal', 3, 12]] :
        scenario === 'replay' ? [['ready', 2, 48], ['ready', 2, 48]] :
        scenario === 'skipped-sequence' ? [['ready', 2, 48], ['quitting', 4, 50]] :
        scenario === 'ready-twice' ? [['ready', 2, 48], ['ready', 3, 48]] :
        scenario === 'sticky-failure' ? [['quitting', 2, 1], ['terminal', 3, 12]] :
        scenario === 'normal-upgrade' ? [['quitting', 2, 0], ['terminal', 3, 62]] :
        scenario === 'ownership-without-cleanup' ? [['quitting', 2, 8]] :
        scenario === 'terminal-before-quitting' ? [['terminal', 2, 0]] : []
      const previous = step === 1 ? ['attached', 1, 0] : reports[step - 2]
      if (!previous || fields[1] !== 'ack' || fields[6] !== String(previous[1]) || fields[7] !== String(previous[2])) return fail()
      if (scenario === 'cancel-read') { setInterval(() => {}, 1000); step++; continue }
      if (scenario === 'oversized') { socket.write('A'.repeat(512)); step++; continue }
      if (scenario === 'non-ascii') { socket.write(Buffer.from([255, 10])); step++; continue }
      const next = reports[step - 1]
      if (next) { socket.write(encode(...next)); step++ }
      else socket.end()
    }
  })
  socket.setTimeout(4000, fail)
}
