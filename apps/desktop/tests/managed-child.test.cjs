const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { managedSpawn } = require('../desktop/managed-child.cjs')

test('real missing executable is captured as ENOENT', async () => {
  const child = managedSpawn('nori-deliberately-missing-executable-53bd77', [], { windowsHide: true, stdio: 'ignore' })
  await new Promise((resolve) => child.once('close', resolve))
  assert.equal(child.startupError?.code, 'ENOENT')
})

test('desktop child spawn records asynchronous failure without uncaught error', () => {
  const child = new EventEmitter()
  const error = Object.assign(new Error('missing executable'), { code: 'ENOENT' })
  const returned = managedSpawn('missing', [], { windowsHide: true }, () => child)
  assert.equal(returned.startupError, null)
  assert.doesNotThrow(() => child.emit('error', error))
  assert.equal(returned.startupError, error)
})

test('managed spawn preserves executable arguments and options', () => {
  const child = new EventEmitter()
  const options = { windowsHide: true, stdio: 'ignore' }
  managedSpawn('node', ['worker.mjs'], options, (command, args, received) => {
    assert.equal(command, 'node')
    assert.deepEqual(args, ['worker.mjs'])
    assert.equal(received, options)
    return child
  })
  assert.equal(child.startupError, null)
})
