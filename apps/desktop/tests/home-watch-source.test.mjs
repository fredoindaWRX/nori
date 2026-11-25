import test from 'node:test'
import assert from 'node:assert/strict'
import { createHomeWatch, HOME_DEFAULTS, homeWatchCommand } from '../bridge/home-watch.mjs'

test('watch-only settings track transitions without requesting light control or location', async () => {
  const settings = structuredClone(HOME_DEFAULTS)
  settings.habits.leave.enabled = settings.habits.arrive.enabled = false
  let at = 1000, present = true
  const events = []
  const watch = createHomeWatch({ dataRoot: 'C:/synthetic-unused', now: () => at,
    readSettings: () => settings, present: async () => ({ present, ip: settings.owner.last_ip }),
    idleSeconds: async () => 3600, recordEvent: (_, event) => events.push(event),
    writeSettings: () => { throw Error('unexpected write') },
    hue: () => { throw Error('must not control lights') }, locate: () => { throw Error('must not locate') } })
  assert.equal(await watch.tick(), 'home')
  present = false; at += 16 * 60_000
  assert.equal(await watch.tick(), 'left')
  present = true; at += 1000
  assert.equal(await watch.tick(), 'arrived')
  assert.deepEqual(events, [{ presence: 'away' }, { presence: 'home' }])
})

test('pause is classified separately from device actions', () => {
  assert.deepEqual(homeWatchCommand('pause home habits'), { kind: 'all', enabled: false })
  assert.equal(homeWatchCommand('hello Nori'), null)
})

for (const action of ['pause', 'stop']) test(`${action} during presence check prevents late state writes`, async () => {
  const settings = structuredClone(HOME_DEFAULTS)
  let release
  const pending = new Promise(resolve => { release = resolve })
  const watch = createHomeWatch({ dataRoot: 'C:/synthetic-unused', readSettings: () => settings,
    present: () => pending,
    writeSettings: () => assert.fail('late settings write'),
    recordEvent: () => assert.fail('late event'), hue: () => assert.fail('late device call') })
  const tick = watch.tick()
  if (action === 'pause') settings.enabled = false
  else watch.stop()
  release({ present: true, ip: '10.0.0.123' })
  assert.equal(await tick, action === 'pause' ? 'paused' : 'stopped')
  assert.equal(watch.state, 'unknown')
})

test('disabling habit during light listing prevents the pending light change', async () => {
  const settings = structuredClone(HOME_DEFAULTS)
  let at = 1000, present = true
  const calls = []
  const watch = createHomeWatch({ dataRoot: 'C:/synthetic-unused', now: () => at,
    readSettings: () => settings, present: async () => ({ present }), idleSeconds: async () => 3600,
    recordEvent: () => {}, hue: async text => {
      calls.push(text); settings.habits.leave.enabled = false
      return 'Your Hue Bridge has 1 light:\nDesk, on'
    } })
  await watch.tick(); present = false; at += 16 * 60_000
  await watch.tick()
  assert.deepEqual(calls, ['list my lights'])
})
