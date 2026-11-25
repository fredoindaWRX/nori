const test = require('node:test')
const assert = require('node:assert/strict')
const { createWakeWindow } = require('../desktop/wake-window.cjs')

test('wake reveals only an authorized window and suppresses repeated events', () => {
  const owner = {}, other = {}
  let enabled = true, time = 0, shows = 0
  const wake = createWakeWindow({owns:event=>event===owner,allowed:()=>enabled,
    show:()=>shows++,now:()=>time})
  assert.equal(wake(other),false)
  assert.equal(shows,0)
  assert.equal(wake(owner),true)
  assert.equal(wake(owner),false)
  time=1000
  enabled=false
  assert.equal(wake(owner),false)
  enabled=true
  assert.equal(wake(owner),true)
  assert.equal(shows,2)
})
