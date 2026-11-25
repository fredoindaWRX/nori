'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { KINDS, FLAGS, MAX_FRAME_BYTES, encodeFrame, decodeFrame, flagsFromOutcome } =
  require('../desktop/guardian-session-protocol.cjs')

const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const NONCE = '11'.repeat(32)
const CHALLENGE = '22'.repeat(32)
const BASE = { kind: 'challenge', nonce: NONCE, challenge: CHALLENGE,
  controllerPid: 4242, guiPid: 7331, sequence: 0, flags: 0 }
const KNOWN_PAYLOAD = `NG1|challenge|${NONCE}|${CHALLENGE}|4242|7331|0|0`
// Fixed independently with Python hmac/hashlib; this is not an encode/decode round trip.
const KNOWN_MAC = '8bf95168d7249f8b5ddf3026baa284a232f0bb012e6831190ee538bff1ebbc65'
const KNOWN_WIRE = `${KNOWN_PAYLOAD}|${KNOWN_MAC}\n`

function signed(payload, key = KEY) {
  return `${payload}|${createHmac('sha256', Buffer.from(key, 'hex')).update(payload, 'ascii').digest('hex')}\n`
}

function payload(fields) {
  return ['NG1', fields.kind, fields.nonce, fields.challenge, fields.controllerPid,
    fields.guiPid, fields.sequence, fields.flags].join('|')
}

const completeHealth = () => ({ failed: false, cleanupVerified: false,
  ownershipReleased: false, bootComplete: false, rendererReady: false })

test('the exact canonical challenge matches an independent HMAC-SHA256 known vector', () => {
  assert.equal(encodeFrame(BASE, KEY), KNOWN_WIRE)
  const decoded = decodeFrame(KNOWN_WIRE, KEY)
  assert.deepEqual(decoded, BASE)
  assert.equal(Object.isFrozen(decoded), true)
  assert.throws(() => { decoded.flags = 63 }, TypeError)
})

test('bounded kinds and health flags have stable immutable values', () => {
  assert.deepEqual(KINDS, ['challenge', 'attached', 'ready', 'quitting', 'terminal', 'ack'])
  assert.deepEqual(FLAGS, { failed: 1, normalShutdown: 2, cleanupVerified: 4,
    ownershipReleased: 8, bootComplete: 16, rendererReady: 32 })
  assert.equal(MAX_FRAME_BYTES, 512)
  assert.equal(Object.isFrozen(KINDS), true)
  assert.equal(Object.isFrozen(FLAGS), true)
})

test('all message kinds round trip and maximum unsigned integers remain canonical', () => {
  for (const fields of [
    BASE,
    { ...BASE, kind: 'attached', sequence: 1 },
    { ...BASE, kind: 'ready', sequence: 2, flags: 48 },
    { ...BASE, kind: 'quitting', sequence: 3, flags: 48 },
    { ...BASE, kind: 'terminal', sequence: 4, flags: 62 },
    { ...BASE, kind: 'terminal', sequence: 4, flags: 13 },
    { ...BASE, kind: 'ack', sequence: 0xffffffff, flags: 62,
      controllerPid: 0xffffffff, guiPid: 0xffffffff },
  ]) {
    const wire = encodeFrame(fields, KEY)
    assert.equal(wire, signed(payload(fields)))
    assert.ok(Buffer.byteLength(wire) <= MAX_FRAME_BYTES)
    assert.deepEqual(decodeFrame(wire, KEY), fields)
  }
})

test('wire framing rejects non-ASCII, controls, missing newline and oversized input', () => {
  for (const wire of [undefined, null, {}, Buffer.from(KNOWN_WIRE), '', KNOWN_WIRE.slice(0, -1),
    `${KNOWN_WIRE}\n`, KNOWN_WIRE.replace('\n', '\r\n'), ` ${KNOWN_WIRE}`,
    KNOWN_WIRE.replace('NG1', 'NG1\0'), KNOWN_WIRE.replace('NG1', 'NG1\t'),
    KNOWN_WIRE.replace('NG1', 'NG1\x7f'), KNOWN_WIRE.replace('NG1', 'NG1é'),
    `${'A'.repeat(MAX_FRAME_BYTES)}\n`, 'A'.repeat(MAX_FRAME_BYTES + 1)]) {
    assert.throws(() => decodeFrame(wire, KEY), /guardian/i)
  }
})

test('correctly MACed noncanonical numeric spellings still reject', () => {
  const pieces = KNOWN_PAYLOAD.split('|')
  for (const index of [4, 5, 6, 7]) {
    for (const value of ['00', '01', '+1', '-0', '-1', '1.0', '1e0', ' 1', '1 ',
      '0x1', '4294967296', '99999999999', '', 'NaN', 'Infinity']) {
      const mutated = [...pieces]
      mutated[index] = value
      assert.throws(() => decodeFrame(signed(mutated.join('|')), KEY), /guardian/i,
        `field ${index}: ${JSON.stringify(value)}`)
    }
  }
})

test('correctly MACed wrong versions, arity, kinds and nonce/challenge encodings reject', () => {
  const pieces = KNOWN_PAYLOAD.split('|')
  const malformed = [KNOWN_PAYLOAD.replace('NG1|', 'NG2|'), `${KNOWN_PAYLOAD}|extra`,
    pieces.slice(0, -1).join('|'), KNOWN_PAYLOAD.replace('|challenge|', '|release|')]
  for (const index of [2, 3]) {
    for (const value of ['A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '']) {
      const mutated = [...pieces]
      mutated[index] = value
      malformed.push(mutated.join('|'))
    }
  }
  for (const wire of malformed) assert.throws(() => decodeFrame(signed(wire), KEY), /guardian/i)
})

test('authentication binds every wire field and rejects wrong keys or MAC spellings', () => {
  const authenticated = { ...BASE, kind: 'ack', sequence: 2, flags: 48 }
  const original = encodeFrame(authenticated, KEY)
  for (const changes of [{ kind: 'terminal' }, { nonce: '33'.repeat(32) },
    { challenge: '44'.repeat(32) }, { controllerPid: 4243 }, { guiPid: 7332 },
    { sequence: 3 }, { flags: 49 }]) {
    const fields = { ...authenticated, ...changes }
    const staleMac = original.trimEnd().split('|').at(-1)
    assert.throws(() => decodeFrame(`${payload(fields)}|${staleMac}\n`, KEY), /authentication/i)
  }
  assert.throws(() => decodeFrame(KNOWN_WIRE, 'ff'.repeat(32)), /authentication/i)
  for (const mac of ['0'.repeat(64), KNOWN_MAC.toUpperCase(), KNOWN_MAC.slice(1), `${KNOWN_MAC}0`, 'z'.repeat(64)]) {
    assert.throws(() => decodeFrame(`${KNOWN_PAYLOAD}|${mac}\n`, KEY), /guardian/i)
  }
})

test('keys must be primitive lowercase 32-byte hex strings for both directions', () => {
  for (const key of [undefined, null, 1, {}, [], Buffer.alloc(32), new String(KEY),
    KEY.toUpperCase(), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), `${KEY}\n`]) {
    assert.throws(() => encodeFrame(BASE, key), /session key/i)
    assert.throws(() => decodeFrame(KNOWN_WIRE, key), /session key/i)
  }
})

test('encoding requires exact fields, primitive values and bounded positive PIDs', () => {
  for (const fields of [undefined, null, [], { ...BASE, extra: true },
    Object.fromEntries(Object.entries(BASE).filter(([name]) => name !== 'challenge'))]) {
    assert.throws(() => encodeFrame(fields, KEY), /guardian/i)
  }
  for (const name of ['controllerPid', 'guiPid']) {
    for (const value of [undefined, null, 0, -0, -1, 1.5, NaN, Infinity, 0x100000000,
      '4242', new Number(4242), true, {}]) {
      assert.throws(() => encodeFrame({ ...BASE, [name]: value }, KEY), /guardian/i)
    }
  }
  for (const name of ['sequence', 'flags']) {
    for (const value of [undefined, null, -1, 1.5, NaN, Infinity, '0', new Number(0), true, {}]) {
      assert.throws(() => encodeFrame({ ...BASE, [name]: value }, KEY), /guardian/i)
    }
  }
  for (const name of ['nonce', 'challenge']) {
    for (const value of [undefined, null, new String(NONCE), NONCE.toUpperCase().replace(/1/g, 'A'),
      'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), Buffer.alloc(32)]) {
      assert.throws(() => encodeFrame({ ...BASE, [name]: value }, KEY), /guardian/i)
    }
  }
  assert.throws(() => encodeFrame({ ...BASE, kind: 'ack', sequence: 0x100000000 }, KEY), /guardian/i)
  assert.throws(() => encodeFrame({ ...BASE, kind: 'ack', sequence: 1, flags: 64 }, KEY), /guardian/i)
})

test('sequence and flag semantics reject authenticated but contradictory health reports', () => {
  const invalid = [
    { ...BASE, sequence: 1 }, { ...BASE, flags: 1 },
    { ...BASE, kind: 'attached', sequence: 0 },
    { ...BASE, kind: 'attached', sequence: 2 },
    { ...BASE, kind: 'attached', sequence: 1, flags: 48 },
    { ...BASE, kind: 'ready', sequence: 2, flags: 0 },
    { ...BASE, kind: 'ready', sequence: 2, flags: 49 },
    { ...BASE, kind: 'ready', sequence: 2, flags: 60 },
    { ...BASE, kind: 'quitting', sequence: 2, flags: 4 },
    { ...BASE, kind: 'quitting', sequence: 2, flags: 12 },
  ]
  for (const kind of ['ready', 'quitting', 'terminal', 'ack']) {
    invalid.push({ ...BASE, kind, sequence: 0, flags: kind === 'ready' ? 48 : 0 })
  }
  for (const kind of ['terminal', 'ack']) {
    for (const flags of [8, 9, 24, 40, 56, 2, 18, 34, 51, 63]) {
      invalid.push({ ...BASE, kind, sequence: 2, flags })
    }
  }
  for (const fields of invalid) {
    assert.throws(() => encodeFrame(fields, KEY), /guardian/i)
    assert.throws(() => decodeFrame(signed(payload(fields)), KEY), /guardian/i)
  }
})

test('flagsFromOutcome requires explicit primitive health booleans and sets only bounded bits', () => {
  assert.equal(flagsFromOutcome(completeHealth()), 0)
  for (const [name, expected] of [['failed', 1], ['cleanupVerified', 4],
    ['ownershipReleased', 8], ['bootComplete', 16], ['rendererReady', 32]]) {
    assert.equal(flagsFromOutcome({ ...completeHealth(), [name]: true }), expected)
    for (const value of [undefined, null, 0, 1, 'true', 'false', new Boolean(true), {}, []]) {
      assert.throws(() => flagsFromOutcome({ ...completeHealth(), [name]: value }), /booleans/i)
    }
  }
  assert.equal(flagsFromOutcome({ failed: false, cleanupVerified: true, ownershipReleased: true,
    bootComplete: true, rendererReady: true }, { normalShutdown: true }), 62)
  assert.equal(flagsFromOutcome({ ...completeHealth(), normalShutdown: true }), 0)
  for (const value of [undefined, null, 0, 1, 'true', new Boolean(true), {}]) {
    if (value === undefined) continue // Undefined selects the documented default false.
    assert.throws(() => flagsFromOutcome(completeHealth(), { normalShutdown: value }), /booleans/i)
  }
  for (const outcome of [undefined, null, {}, []]) {
    assert.throws(() => flagsFromOutcome(outcome), /booleans/i)
  }
})
