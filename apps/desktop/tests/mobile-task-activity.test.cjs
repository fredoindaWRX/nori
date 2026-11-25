const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { installMobileTaskActivity } = require('../desktop/mobile-task-activity.cjs')

const taskId = 'a'.repeat(32)
const task = { id: taskId, goal: 'Synthetic local coding task', status: 'running', canStop: true, canSteer: true, events: [] }

function fixture(t, options = {}) {
  let active = null
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.value = ''; this.disabled = false; this.hidden = false; this._text = '' }
    contains(node) { return this === node || this.children.some(child => child.contains(node)) }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node) } }
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this._text = ''; this.append(...nodes) }
    remove() { if (!this.parent) return; if (active && this.contains(active)) active = null; const parent = this.parent; parent.children.splice(parent.children.indexOf(this), 1); this.parent = null }
    setAttribute(name, value) { this.attributes[name] = value }
    addEventListener(name, callback) { this.listeners.set(name, callback) }
    removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name) }
    focus() { active = this }
    set textContent(value) { for (const node of [...this.children]) node.remove(); this._text = String(value) }
    get textContent() { return this._text + this.children.map(child => child.textContent).join('') }
  }
  const panel = new Element('details'), list = new Element('div')
  panel.open = options.open !== false
  const document = { get activeElement() { return active }, getElementById: id => id === 'activity-panel' ? panel : id === 'activity-list' ? list : null,
    createElement: tag => new Element(tag) }
  const timers = new Map(), requests = []
  let serial = 0
  const state = { snapshot: { tasks: [structuredClone(task)], unavailableSources: [] }, failGet: false,
    post: async () => ({ ok: true, json: async () => ({ accepted: true, scope_unchanged: true }) }) }
  const context = { document, AbortController, AbortSignal,
    setTimeout(callback) { const id = ++serial; timers.set(id, callback); return id }, clearTimeout(id) { timers.delete(id) },
    fetch: async (path, init) => {
      requests.push({ path, init })
      if (path !== '/activity') return state.post(path, init)
      if (state.get) return state.get(path, init)
      if (state.failGet) throw Error('Synthetic unavailable activity')
      return { ok: true, json: async () => structuredClone(state.snapshot) }
    } }
  vm.createContext(context)
  const install = () => vm.runInContext('(' + installMobileTaskActivity.toString() + ')()', context)
  const controller = install()
  t.after(() => controller.stop())
  const descend = node => [node, ...node.children.flatMap(descend)]
  const row = id => list.children.find(node => node.dataset.taskId === id)
  const area = id => descend(row(id)).find(node => node.tag === 'textarea')
  const button = (id, text) => descend(row(id)).find(node => node.tag === 'button' && node.textContent === text)
  return { controller, panel, list, document, state, requests, timers, row, area, button, descend, install }
}

test('serialized activity installer preserves textarea identity, draft and focus while updating task state', async t => {
  const f = fixture(t)
  await f.controller.refresh()
  const row = f.row(taskId), area = f.area(taskId)
  area.value = 'Keep this direction while I continue typing'
  area.oninput()
  area.focus()
  f.state.snapshot.tasks[0] = { ...task, status: 'awaiting_approval', canSteer: false, response: 'Needs desktop confirmation', events: [{ message: 'Review requested', at: 'synthetic-time' }] }
  await f.controller.refresh()
  assert.equal(f.row(taskId), row)
  assert.equal(f.area(taskId), area)
  assert.equal(area.value, 'Keep this direction while I continue typing')
  assert.equal(f.document.activeElement, area)
  assert.equal(f.button(taskId, 'Send direction').disabled, true)
  assert.match(row.textContent, /awaiting_approval/)
  assert.match(row.textContent, /Needs desktop confirmation/)
  assert.match(row.textContent, /Review requested/)
  assert.equal(f.requests.some(request => request.init.method === 'POST'), false)
})

test('stale steering and stop callbacks consult latest capabilities and cannot dispatch', async t => {
  const f = fixture(t)
  await f.controller.refresh()
  const area = f.area(taskId), send = f.button(taskId, 'Send direction'), stop = f.button(taskId, 'Stop task')
  area.value = 'Synthetic direction'
  area.oninput()
  f.state.snapshot.tasks[0] = { ...task, canStop: false, canSteer: false }
  await f.controller.refresh()
  await send.onclick()
  await stop.onclick()
  assert.equal(send.disabled, true)
  assert.equal(stop.disabled, true)
  assert.equal(f.requests.some(request => request.init.method === 'POST'), false)
})

test('direction requires accepted and unchanged-scope acknowledgement before clearing its draft', async t => {
  const f = fixture(t)
  await f.controller.refresh()
  const area = f.area(taskId), send = f.button(taskId, 'Send direction')
  area.value = '  A bounded task direction  '
  area.oninput()
  f.state.post = async () => ({ ok: true, json: async () => ({ accepted: true, scope_unchanged: false }) })
  await send.onclick()
  assert.equal(area.value, '  A bounded task direction  ')
  assert.match(f.row(taskId).textContent, /Direction not confirmed/)
  const post = f.requests.find(request => request.init.method === 'POST')
  assert.equal(post.path, '/activity/' + taskId + '/steer')
  assert.deepEqual(JSON.parse(post.init.body), { message: 'A bounded task direction' })
  assert.equal(post.init.headers['content-type'], 'application/json')
  f.state.post = async () => ({ ok: true, json: async () => ({ accepted: true, scope_unchanged: true }) })
  await send.onclick()
  assert.equal(area.value, '')
  assert.match(f.row(taskId).textContent, /Scope and approvals are unchanged/)
})

test('polling during a pending direction preserves focus and does not erase the next draft on acknowledgement', async t => {
  const f = fixture(t)
  await f.controller.refresh()
  const area = f.area(taskId), send = f.button(taskId, 'Send direction')
  area.value = 'First direction'
  area.oninput()
  area.focus()
  let acknowledge
  f.state.post = () => new Promise(resolve => { acknowledge = resolve })
  const sending = send.onclick()
  assert.equal(send.disabled, true)
  await f.controller.refresh()
  assert.equal(f.area(taskId), area)
  assert.equal(f.document.activeElement, area)
  assert.equal(send.disabled, true)
  area.value = 'Next direction typed while waiting'
  area.oninput()
  acknowledge({ ok: true, json: async () => ({ accepted: true, scope_unchanged: true }) })
  await sending
  assert.equal(area.value, 'Next direction typed while waiting')
  assert.equal(send.disabled, false)
  assert.equal(f.requests.filter(request => request.init.method === 'POST').length, 1)
})

test('failed activity refresh retains the draft but disables stale actions until a fresh snapshot arrives', async t => {
  const f = fixture(t)
  await f.controller.refresh()
  const area = f.area(taskId), send = f.button(taskId, 'Send direction')
  area.value = 'Continue drafting offline'
  area.oninput()
  area.focus()
  f.state.failGet = true
  await f.controller.refresh()
  assert.equal(f.area(taskId), area)
  assert.equal(area.value, 'Continue drafting offline')
  assert.equal(f.document.activeElement, area)
  assert.equal(send.disabled, true)
  await send.onclick()
  assert.equal(f.requests.some(request => request.init.method === 'POST'), false)
  assert.match(f.list.textContent, /Activity unavailable/)
  f.state.failGet = false
  await f.controller.refresh()
  assert.equal(send.disabled, false)
})

test('partial snapshots retain unavailable task drafts without retaining their action authority', async t => {
  const f = fixture(t)
  await f.controller.refresh()
  const area = f.area(taskId), send = f.button(taskId, 'Send direction')
  area.value = 'Draft for temporarily unavailable work'
  area.oninput()
  f.state.snapshot = { tasks: [], unavailableSources: ['work'] }
  await f.controller.refresh()
  assert.equal(f.area(taskId), area)
  assert.equal(area.value, 'Draft for temporarily unavailable work')
  assert.equal(send.disabled, true)
  await send.onclick()
  assert.equal(f.requests.some(request => request.init.method === 'POST'), false)
  f.state.snapshot = { tasks: [], unavailableSources: [] }
  await f.controller.refresh()
  assert.equal(f.row(taskId), undefined)
  await send.onclick()
  assert.equal(f.requests.some(request => request.init.method === 'POST'), false)
})

test('stop action stays an explicit bounded cancellation request and does not claim terminal completion', async t => {
  const f = fixture(t)
  await f.controller.refresh()
  await f.button(taskId, 'Stop task').onclick()
  const post = f.requests.find(request => request.init.method === 'POST')
  assert.equal(post.path, '/activity/' + taskId + '/cancel')
  assert.equal(post.init.body, '{}')
  assert.match(f.row(taskId).textContent, /Stop requested; checking final status/)
  assert.equal(f.state.snapshot.tasks[0].status, 'running')
})

test('terminal task snapshots disable actions even if stale capability flags remain true', async t => {
  const f = fixture(t)
  await f.controller.refresh()
  f.area(taskId).value = 'Preserved terminal draft'
  f.area(taskId).oninput()
  f.state.snapshot.tasks[0] = { ...task, status: 'completed' }
  await f.controller.refresh()
  await f.button(taskId, 'Send direction').onclick()
  await f.button(taskId, 'Stop task').onclick()
  assert.equal(f.button(taskId, 'Send direction').disabled, true)
  assert.equal(f.requests.some(request => request.init.method === 'POST'), false)
})

test('installer is idempotent and stop aborts a pending refresh without accepting its late snapshot', async t => {
  const f = fixture(t, { open: false })
  await f.controller.refresh()
  assert.equal(f.install(), f.controller)
  assert.equal(f.requests.length, 0)
  let finish
  f.state.get = () => new Promise(resolve => { finish = resolve })
  f.panel.open = true
  const refreshing = f.controller.refresh()
  const signal = f.requests.at(-1).init.signal
  const stopping = f.controller.stop()
  assert.equal(signal.aborted, true)
  finish({ ok: true, json: async () => ({ tasks: [task], unavailableSources: [] }) })
  await Promise.all([refreshing, stopping])
  assert.equal(f.row(taskId), undefined)
  assert.equal(f.timers.size, 0)
  assert.equal(f.panel.listeners.has('toggle'), false)
})
