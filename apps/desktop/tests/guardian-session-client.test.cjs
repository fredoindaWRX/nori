'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { Duplex } = require('node:stream')
const { setImmediate: nextTurn } = require('node:timers/promises')
const { consumeGuardianEnvironment, connectGuardianSession } = require('../desktop/guardian-session-client.cjs')
const { decodeFrame, MAX_FRAME_BYTES } = require('../desktop/guardian-session-protocol.cjs')

const PREFIX = 'NORI_DESKTOP_GUARDIAN_'
const KEY = '0123456789abcdef'.repeat(4)
const NONCE = 'ab'.repeat(32)
const CHALLENGE = 'cd'.repeat(32)
const CONTROLLER_PID = 4242
const GUI_PID = 7331
const PIPE = `\\\\.\\pipe\\nori-guardian-${NONCE}`
const DESCRIPTOR = Object.freeze({ pipePath: PIPE, nonce: NONCE, key: KEY, controllerPid: CONTROLLER_PID })
const BASE = { kind: 'challenge', nonce: NONCE, challenge: CHALLENGE,
  controllerPid: CONTROLLER_PID, guiPid: GUI_PID, sequence: 0, flags: 0 }

function environment(extra = {}) {
  return { PATH: 'preserved-test-path', [PREFIX + 'PIPE']: PIPE, [PREFIX + 'NONCE']: NONCE,
    [PREFIX + 'KEY']: KEY, [PREFIX + 'PID']: String(CONTROLLER_PID), ...extra }
}

// The peer constructs its MAC independently rather than reusing encodeFrame.
function wire(fields, key = KEY) {
  const payload = ['NG1', fields.kind, fields.nonce, fields.challenge, fields.controllerPid,
    fields.guiPid, fields.sequence, fields.flags].join('|')
  return `${payload}|${createHmac('sha256', Buffer.from(key, 'hex')).update(payload, 'ascii').digest('hex')}\n`
}

class MemorySocket extends Duplex {
  constructor(onWrite) {
    super({ allowHalfOpen: true })
    this.onWrite = onWrite
    this.writes = []
  }
  _read() {}
  _write(bytes, _encoding, callback) {
    this.writes.push(Buffer.from(bytes))
    this.onWrite(bytes)
    callback()
  }
  send(bytes) { this.push(Buffer.from(bytes)) }
  eof() { this.push(null) }
}

function fixture(t, options = {}) {
  const state = { failures: 0, requests: [], connections: [], autoAck: true,
    onRequest: null, socket: null, session: null }
  const receive = bytes => {
    const request = decodeFrame(bytes.toString('ascii'), KEY)
    state.requests.push(request)
    if (state.onRequest) return state.onRequest(request)
    if (state.autoAck) queueMicrotask(() => state.send({ ...request, kind: 'ack' }))
  }
  state.send = fields => state.socket.send(wire(fields))
  state.ack = request => state.send({ ...request, kind: 'ack' })
  state.connection = connectGuardianSession(DESCRIPTOR, {
    pid: GUI_PID, timeoutMs: 200, ackTimeoutMs: 100,
    ...options.connectionOptions,
    onFailure() {
      state.failures += 1
      if (options.onFailure) options.onFailure()
    },
    connectSocket(connectionOptions) {
      state.connections.push(connectionOptions)
      state.socket = new MemorySocket(receive)
      if (options.onSocket) options.onSocket(state)
      if (options.initial !== false) {
        queueMicrotask(() => {
          const bytes = options.initial ?? wire(BASE)
          if (options.splitInitial) {
            for (const byte of Buffer.from(bytes)) state.socket.send(Buffer.from([byte]))
          } else state.socket.send(bytes)
        })
      }
      return state.socket
    },
  })
  t.after(() => state.socket?.destroy())
  return state
}

async function rejectOnce(state, promise, expression = /guardian/i) {
  await assert.rejects(promise, expression)
  await nextTurn()
  assert.equal(state.failures, 1)
  assert.equal(state.socket.destroyed, true)
  state.socket.emit('error', Error('duplicate synthetic failure'))
  state.socket.emit('end')
  state.socket.emit('close')
  await nextTurn()
  assert.equal(state.failures, 1)
}

test('a complete launch descriptor is consumed, frozen and scrubbed before use', () => {
  const env = environment({ NORI_DESKTOP_OTHER: 'preserved' })
  const descriptor = consumeGuardianEnvironment(env)
  assert.deepEqual(descriptor, DESCRIPTOR)
  assert.equal(Object.isFrozen(descriptor), true)
  assert.deepEqual(env, { PATH: 'preserved-test-path', NORI_DESKTOP_OTHER: 'preserved' })
  assert.equal(consumeGuardianEnvironment(env), null)
  assert.throws(() => { descriptor.key = 'ff'.repeat(32) }, TypeError)
})

test('case-insensitive names are consumed and every case variant is scrubbed', () => {
  const env = Object.fromEntries(Object.entries(environment()).map(([name, value]) =>
    [name.startsWith(PREFIX) ? name.toLowerCase() : name, value]))
  assert.deepEqual(consumeGuardianEnvironment(env), DESCRIPTOR)
  assert.deepEqual(env, { PATH: 'preserved-test-path' })
  for (const field of ['PIPE', 'NONCE', 'KEY', 'PID']) {
    const duplicate = environment({ [(PREFIX + field).toLowerCase()]: environment()[PREFIX + field] })
    assert.throws(() => consumeGuardianEnvironment(duplicate), /launch descriptor/i)
    assert.deepEqual(duplicate, { PATH: 'preserved-test-path' })
  }
})

test('partial, unknown and malformed launch fields are all scrubbed on rejection', () => {
  const bad = [
    { PATH: 'preserved-test-path', [PREFIX + 'KEY']: KEY },
    { PATH: 'preserved-test-path', [(PREFIX + 'UNKNOWN').toLowerCase()]: 'secret' },
    environment({ [PREFIX + 'EXTRA']: 'secret' }),
    environment({ [PREFIX + 'PIPE']: '\\\\.\\pipe\\unrelated-endpoint' }),
    environment({ [PREFIX + 'PIPE']: `${PIPE}-suffix` }),
    environment({ [PREFIX + 'PIPE']: `\\\\localhost\\pipe\\nori-guardian-${NONCE}` }),
  ]
  for (const field of ['NONCE', 'KEY']) {
    for (const value of ['', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65),
      undefined, null, new String(field === 'NONCE' ? NONCE : KEY)]) {
      bad.push(environment({ [PREFIX + field]: value }))
    }
  }
  for (const value of ['', '0', '-0', '-1', '+1', '01', '1.0', '1e3', ' 1', '1 ',
    '4294967296', '99999999999', undefined, null, CONTROLLER_PID]) {
    bad.push(environment({ [PREFIX + 'PID']: value }))
  }
  for (const env of bad) {
    assert.throws(() => consumeGuardianEnvironment(env), /launch descriptor/i)
    assert.deepEqual(env, { PATH: 'preserved-test-path' })
  }
})

test('no guardian fields leaves unrelated environment data untouched', () => {
  const env = { PATH: 'same', NORI_DESKTOP_GUARDIAN: 'same', XNORI_DESKTOP_GUARDIAN_KEY: 'same' }
  const before = { ...env }
  assert.equal(consumeGuardianEnvironment(env), null)
  assert.deepEqual(env, before)
  assert.equal(consumeGuardianEnvironment({}), null)
})

test('valid challenge and ACK frames may arrive split into individual bytes', async t => {
  const state = fixture(t, { splitInitial: true, onSocket(current) {
    current.onRequest = request => queueMicrotask(() => {
      for (const byte of Buffer.from(wire({ ...request, kind: 'ack' }))) {
        current.socket.send(Buffer.from([byte]))
      }
    })
  } })
  const session = await state.connection
  assert.equal(Object.isFrozen(session), true)
  assert.deepEqual(state.connections, [{ path: PIPE }])
  assert.deepEqual(state.requests, [{ ...BASE, kind: 'attached', sequence: 1 }])
  await session.report('ready', 48)
  await session.report('quitting', 48)
  const result = await session.report('terminal', 62)
  assert.equal(result, undefined)
  assert.deepEqual(state.requests.map(({ kind, sequence, flags }) => [kind, sequence, flags]),
    [['attached', 1, 0], ['ready', 2, 48], ['quitting', 3, 48], ['terminal', 4, 62]])
  assert.equal(state.failures, 0)
})

test('wrong key, nonce and peer PIDs cannot authenticate a challenge', async t => {
  for (const changes of [{ nonce: 'ef'.repeat(32) }, { controllerPid: CONTROLLER_PID + 1 },
    { guiPid: GUI_PID + 1 }]) {
    await t.test(JSON.stringify(changes), async child => {
      const state = fixture(child, { initial: wire({ ...BASE, ...changes }) })
      await rejectOnce(state, state.connection)
      assert.equal(state.requests.length, 0)
    })
  }
  await t.test('MAC made with another key', async child => {
    const state = fixture(child, { initial: wire(BASE, 'ff'.repeat(32)) })
    await rejectOnce(state, state.connection)
    assert.equal(state.requests.length, 0)
  })
})

test('malformed, oversized and control-byte packets fail without attachment', async t => {
  for (const bytes of [Buffer.alloc(MAX_FRAME_BYTES + 1, 65),
    Buffer.from(`${'A'.repeat(MAX_FRAME_BYTES)}\n`), Buffer.from('NG1\0'),
    Buffer.from('NG1\r\n'), Buffer.from([0xff]), Buffer.from('bogus\n'),
    Buffer.from(wire(BASE).replace('NG1|', 'NG2|'))]) {
    await t.test(`packet ${bytes.length} bytes starting ${bytes.subarray(0, 8).toString('hex')}`, async child => {
      const state = fixture(child, { initial: bytes })
      await rejectOnce(state, state.connection)
      assert.equal(state.requests.length, 0)
    })
  }
})

test('a replayed challenge or unsolicited second complete frame fails closed', async t => {
  await t.test('two complete challenges in one packet', async child => {
    const state = fixture(child, { initial: wire(BASE) + wire(BASE) })
    await rejectOnce(state, state.connection)
  })
  await t.test('challenge replay instead of attached ACK', async child => {
    const state = fixture(child, { onSocket(current) {
      current.onRequest = () => queueMicrotask(() => current.send(BASE))
    } })
    await rejectOnce(state, state.connection)
  })
  await t.test('challenge replay after attachment while idle', async child => {
    const state = fixture(child)
    await state.connection
    state.send(BASE)
    await nextTurn()
    assert.equal(state.failures, 1)
    assert.equal(state.socket.destroyed, true)
  })
})

test('attached ACK must match kind, challenge, flags, nonce, PIDs and sequence', async t => {
  for (const changes of [{ kind: 'terminal' }, { challenge: 'ef'.repeat(32) },
    { flags: 48 }, { nonce: 'ef'.repeat(32) }, { controllerPid: CONTROLLER_PID + 1 },
    { guiPid: GUI_PID + 1 }, { sequence: 2 }]) {
    await t.test(JSON.stringify(changes), async child => {
      const state = fixture(child, { onSocket(current) {
        current.onRequest = request => queueMicrotask(() => current.send({ ...request, kind: 'ack', ...changes }))
      } })
      await rejectOnce(state, state.connection)
      assert.equal(state.requests.length, 1)
    })
  }
})

test('subsequent ACKs must echo the current sequence and health flags', async t => {
  for (const changes of [{ sequence: 1 }, { sequence: 3 }, { flags: 49 },
    { challenge: 'ef'.repeat(32) }, { kind: 'quitting' }, { nonce: 'ef'.repeat(32) },
    { controllerPid: CONTROLLER_PID + 1 }, { guiPid: GUI_PID + 1 }]) {
    await t.test(JSON.stringify(changes), async child => {
      const state = fixture(child)
      const session = await state.connection
      state.onRequest = request => queueMicrotask(() => state.send({ ...request, kind: 'ack', ...changes }))
      await rejectOnce(state, session.report('ready', 48))
      assert.equal(state.requests.length, 2)
      await assert.rejects(session.report('quitting', 48), /guardian/i)
      assert.equal(state.requests.length, 2)
    })
  }
})

test('the challenge deadline fails once and cannot be revived by a late challenge', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const state = fixture(t, { initial: false, connectionOptions: { timeoutMs: 25 } })
  const rejected = assert.rejects(state.connection, /guardian/i)
  t.mock.timers.tick(24)
  assert.equal(state.failures, 0)
  t.mock.timers.tick(1)
  await rejected
  await nextTurn()
  assert.equal(state.failures, 1)
  state.socket.emit('data', Buffer.from(wire(BASE)))
  t.mock.timers.tick(1000)
  assert.equal(state.failures, 1)
  assert.equal(state.requests.length, 0)
})

test('each pending ACK has a bounded deadline, including initial attachment', async t => {
  for (const attached of [false, true]) {
    await t.test(attached ? 'ready ACK deadline' : 'attached ACK deadline', async child => {
      child.mock.timers.enable({ apis: ['setTimeout'] })
      const state = fixture(child, { connectionOptions: { ackTimeoutMs: 25 }, onSocket(current) {
        current.autoAck = attached
      } })
      let pending = state.connection
      if (attached) {
        const session = await pending
        state.autoAck = false
        pending = session.report('ready', 48)
      }
      const rejected = assert.rejects(pending, /guardian/i)
      await nextTurn()
      child.mock.timers.tick(24)
      assert.equal(state.failures, 0)
      child.mock.timers.tick(1)
      await rejected
      await nextTurn()
      assert.equal(state.failures, 1)
      assert.equal(state.socket.destroyed, true)
      child.mock.timers.tick(1000)
      assert.equal(state.failures, 1)
    })
  }
})

test('an attached idle session has no challenge or ACK timeout between reports', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const state = fixture(t, { connectionOptions: { timeoutMs: 20, ackTimeoutMs: 10 } })
  const session = await state.connection
  t.mock.timers.tick(120000)
  await nextTurn()
  assert.equal(state.failures, 0)
  assert.equal(state.socket.destroyed, false)
  await session.report('ready', 48)
  t.mock.timers.tick(120000)
  await nextTurn()
  assert.equal(state.failures, 0)
  await session.report('quitting', 48)
  await session.report('terminal', 62)
  assert.equal(state.failures, 0)
})

test('a second report rejects promptly without being queued or disrupting the in-flight report', async t => {
  const state = fixture(t)
  const session = await state.connection
  state.autoAck = false
  const first = session.report('ready', 48)
  // Register both outcomes immediately so a failed assertion cannot hide a rejected request.
  const firstResult = first.then(() => ({ ok: true }), error => ({ error }))
  let secondRejected = false
  const secondResult = session.report('quitting', 48).then(
    () => ({ ok: true }), error => { secondRejected = true; return { error } })
  await nextTurn()
  assert.equal(secondRejected, true, 'an overlapping report must settle before the first ACK')
  assert.deepEqual(state.requests.map(request => request.kind), ['attached', 'ready'])
  assert.equal(state.failures, 0)
  state.ack(state.requests[1])
  assert.deepEqual(await firstResult, { ok: true })
  assert.match((await secondResult).error.message, /guardian/i)
  state.autoAck = true
  await session.report('quitting', 48)
  await session.report('terminal', 62)
  assert.deepEqual(state.requests.map(request => request.sequence), [1, 2, 3, 4])
  assert.equal(state.failures, 0)
})

test('EOF rejects pending challenge and pending ACK promptly, exactly once', async t => {
  for (const phase of ['challenge', 'attached-ack', 'ready-ack']) {
    await t.test(phase, async child => {
      child.mock.timers.enable({ apis: ['setTimeout'] })
      const state = fixture(child, { initial: phase === 'challenge' ? false : undefined,
        onSocket(current) { current.autoAck = phase === 'ready-ack' } })
      let pending = state.connection
      if (phase === 'ready-ack') {
        const session = await pending
        state.autoAck = false
        pending = session.report('ready', 48)
      }
      let rejected = false
      const settled = pending.then(() => ({ ok: true }), error => { rejected = true; return { error } })
      await nextTurn()
      state.socket.eof()
      await nextTurn()
      assert.equal(rejected, true, 'readable EOF must not wait for the deadline')
      assert.match((await settled).error.message, /guardian/i)
      assert.equal(state.failures, 1)
      child.mock.timers.tick(120000)
      state.socket.emit('error', Error('duplicate EOF failure'))
      state.socket.emit('close')
      await nextTurn()
      assert.equal(state.failures, 1)
    })
  }
})

test('idle EOF, explicit close and repeated socket errors invoke the owner failure callback once', async t => {
  for (const action of ['eof', 'close', 'error']) {
    await t.test(action, async child => {
      const state = fixture(child)
      const session = await state.connection
      if (action === 'eof') state.socket.eof()
      if (action === 'close') session.close()
      if (action === 'error') state.socket.emit('error', Error('synthetic socket failure'))
      await nextTurn()
      assert.equal(state.failures, 1)
      session.close()
      state.socket.emit('error', Error('duplicate synthetic failure'))
      state.socket.emit('close')
      await nextTurn()
      assert.equal(state.failures, 1)
      await assert.rejects(session.report('ready', 48), /guardian/i)
      assert.equal(state.requests.length, 1)
    })
  }
})

test('an owner callback that throws cannot prevent channel refusal', async t => {
  const state = fixture(t, { initial: wire(BASE, 'ff'.repeat(32)), onFailure() {
    throw Error('synthetic owner callback exception')
  } })
  await rejectOnce(state, state.connection)
})

test('connection and write exceptions fail once and retire their receive deadlines', async t => {
  await t.test('synchronous connection throw', async child => {
    child.mock.timers.enable({ apis: ['setTimeout'] })
    let failures = 0
    await assert.rejects(connectGuardianSession(DESCRIPTOR, { pid: GUI_PID, timeoutMs: 20,
      onFailure() { failures += 1 }, connectSocket() { throw Error('synthetic connect exception') } }), /guardian/i)
    child.mock.timers.tick(120000)
    await nextTurn()
    assert.equal(failures, 1)
  })
  await t.test('synchronous attached write throw', async child => {
    child.mock.timers.enable({ apis: ['setTimeout'] })
    const state = fixture(child, { onSocket(current) {
      current.socket.write = () => { throw Error('synthetic write exception') }
    } })
    await rejectOnce(state, state.connection)
    child.mock.timers.tick(120000)
    await nextTurn()
    assert.equal(state.failures, 1)
  })
  await t.test('asynchronous attached write failure', async child => {
    const state = fixture(child, { onSocket(current) {
      current.socket.write = (_bytes, callback) => {
        queueMicrotask(() => callback(Error('synthetic write failure')))
        return true
      }
    } })
    await rejectOnce(state, state.connection)
  })
})

test('invalid launch descriptors and connection options never open a socket', async () => {
  let connections = 0
  const connectSocket = () => { connections += 1; throw Error('must not connect') }
  for (const descriptor of [null, {}, { ...DESCRIPTOR, pipePath: `${PIPE}-extra` },
    { ...DESCRIPTOR, nonce: NONCE.toUpperCase() }, { ...DESCRIPTOR, key: KEY.toUpperCase() },
    { ...DESCRIPTOR, controllerPid: 0 }, { ...DESCRIPTOR, controllerPid: 0x100000000 }]) {
    await assert.rejects(connectGuardianSession(descriptor, { connectSocket }), /guardian/i)
  }
  for (const options of [{ pid: 0 }, { pid: 1.5 }, { pid: '7331' }, { pid: 0x100000000 },
    { timeoutMs: 0 }, { timeoutMs: 120001 }, { timeoutMs: '100' },
    { ackTimeoutMs: 0 }, { ackTimeoutMs: 30001 }, { ackTimeoutMs: 1.5 }, { onFailure: null }]) {
    await assert.rejects(connectGuardianSession(DESCRIPTOR, { ...options, connectSocket }), /guardian/i)
  }
  assert.equal(connections, 0)
})

test('authenticated terminal health has no cleanup or guardian release authority', async t => {
  const state = fixture(t)
  const session = await state.connection
  await session.report('quitting', 0)
  assert.equal(await session.report('terminal', 12), undefined)
  assert.notEqual(session.guardianReleaseAuthorized, true)
  for (const name of ['release', 'releaseGuardian', 'releaseOwnership', 'cleanup', 'adoptPid']) {
    assert.equal(typeof session[name], 'undefined', name)
  }
  await assert.rejects(session.report('terminal', 12), /guardian/i)
  await assert.rejects(session.report('ready', 48), /guardian/i)
  state.socket.emit('end')
  state.socket.emit('error', Error('synthetic event after authenticated terminal ACK'))
  state.socket.emit('close')
  session.close()
  await nextTurn()
  assert.equal(state.failures, 0)
  assert.deepEqual(state.requests.map(request => request.kind), ['attached', 'quitting', 'terminal'])
})
