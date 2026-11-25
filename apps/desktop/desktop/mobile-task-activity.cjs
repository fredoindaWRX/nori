// Serialized into the authenticated phone page. Keep all browser dependencies
// inside this function; it must not acquire desktop approval or start work.
function installMobileTaskActivity() {
  const panel = document.getElementById('activity-panel')
  const list = document.getElementById('activity-list')
  if (!panel || !list) return null
  if (panel.__noriMobileActivity) return panel.__noriMobileActivity
  const rows = new Map()
  const lifecycle = new AbortController()
  const warning = document.createElement('p')
  warning.setAttribute('role', 'status')
  const empty = document.createElement('p')
  empty.textContent = 'No saved tasks.'
  list.replaceChildren(warning, empty)
  let timer = null, inFlight = null, stopped = false

  function capabilities(view) {
    const terminal = ['completed', 'cancelled', 'canceled', 'failed', 'stopped'].includes(view.task?.status)
    return { stop: view.fresh && !view.removed && !terminal && view.task?.canStop === true,
      steer: view.fresh && !view.removed && !terminal && view.task?.canSteer === true }
  }
  function syncControls(view) {
    const allowed = capabilities(view)
    view.stop.hidden = !allowed.stop && !view.stopping
    view.stop.disabled = !allowed.stop || view.stopping
    view.editor.hidden = !(allowed.steer || view.area.value || document.activeElement === view.area)
    view.send.disabled = !allowed.steer || view.sending || !view.area.value.trim()
    view.note.textContent = allowed.steer
      ? 'Direction cannot expand project, file scope, permissions, or approvals.'
      : 'Task direction is currently unavailable. Any draft stays on this page; it has not been sent.'
  }
  function request(path, options = {}) {
    return fetch(path, { ...options, signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15000)]) })
  }
  async function stopTask(view) {
    if (stopped || view.stopping || !capabilities(view).stop) return
    view.stopping = true
    syncControls(view)
    try {
      const response = await request('/activity/' + view.id + '/cancel', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })
      if (!response.ok) throw Error()
      view.feedback.textContent = 'Stop requested; checking final status…'
    } catch {
      if (!stopped) view.feedback.textContent = 'Stop could not be confirmed. Check task status.'
    } finally {
      view.stopping = false
      syncControls(view)
    }
  }
  async function sendDirection(view) {
    const message = view.area.value.trim()
    if (stopped || view.sending || !capabilities(view).steer || !message || message.length > 2000) return
    view.sending = true
    syncControls(view)
    try {
      const response = await request('/activity/' + view.id + '/steer', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.accepted !== true || result.scope_unchanged !== true) throw Error()
      // The owner can type the next direction while acknowledgement is pending.
      if (view.area.value.trim() === message) view.area.value = ''
      view.feedback.textContent = 'Direction queued for the next safe checkpoint. Scope and approvals are unchanged.'
    } catch {
      if (!stopped) view.feedback.textContent = 'Direction not confirmed. Check the task status and try again.'
    } finally {
      view.sending = false
      syncControls(view)
    }
  }
  function createRow(id) {
    const row = document.createElement('div')
    row.dataset.taskId = id
    const label = document.createElement('p'), response = document.createElement('p')
    const stop = document.createElement('button'), editor = document.createElement('div')
    const area = document.createElement('textarea'), note = document.createElement('p')
    const send = document.createElement('button'), feedback = document.createElement('p')
    const events = document.createElement('ol')
    stop.type = send.type = 'button'
    stop.textContent = 'Stop task'
    send.textContent = 'Send direction'
    area.maxLength = 2000
    area.placeholder = 'Guide the next checkpoint within the original task…'
    feedback.setAttribute('role', 'status')
    events.setAttribute('aria-label', 'Task progress')
    editor.append(area, note, send)
    row.append(label, response, stop, editor, feedback, events)
    const view = { id, row, label, response, stop, editor, area, note, send, feedback, events,
      fresh: false, removed: false, stopping: false, sending: false, task: null, eventsKey: null }
    area.oninput = () => syncControls(view)
    stop.onclick = () => stopTask(view)
    send.onclick = () => sendDirection(view)
    rows.set(id, view)
    // Existing rows never get detached/re-appended during polling: that would
    // dismiss the mobile keyboard even if their text were copied back later.
    list.append(row)
    return view
  }
  function renderSnapshot(data) {
    if (!data || !Array.isArray(data.tasks)) throw Error()
    const unavailable = (Array.isArray(data.unavailableSources) ? data.unavailableSources : [])
      .filter(source => source === 'work' || source === 'system')
    warning.textContent = unavailable.length
      ? 'Some task status is unavailable: ' + unavailable.map(source => source === 'system' ? 'system tasks' : 'coding and background work').join(', ') + '. Available tasks are shown below.'
      : ''
    const seen = new Set()
    for (const task of data.tasks.slice(0, 20)) {
      if (!task || typeof task.id !== 'string' || !/^[a-f0-9]{32}$/.test(task.id) || seen.has(task.id)) continue
      seen.add(task.id)
      const view = rows.get(task.id) || createRow(task.id)
      view.task = task
      view.fresh = true
      view.label.textContent = String(task.goal || '').slice(0, 1200) + ' — ' + String(task.status || '')
      view.response.textContent = String(task.response || '').slice(0, 16000)
      view.response.hidden = !view.response.textContent
      view.area.setAttribute('aria-label', 'Direction for ' + String(task.goal || '').slice(0, 1200))
      const events = (Array.isArray(task.events) ? task.events : []).slice(-8)
        .filter(event => event && typeof event.message === 'string')
        .map(event => ({ message: event.message.slice(0, 1500), at: typeof event.at === 'string' ? event.at.slice(0, 64) : '' }))
      const key = JSON.stringify(events)
      if (key !== view.eventsKey) {
        view.events.replaceChildren()
        for (const event of events) {
          const item = document.createElement('li')
          item.textContent = (event.at ? event.at + ' · ' : '') + event.message
          view.events.append(item)
        }
        view.eventsKey = key
      }
      view.events.hidden = !events.length
      syncControls(view)
    }
    for (const [id, view] of rows) {
      if (seen.has(id)) continue
      // Partial-source outages must not erase an owner's draft or an action
      // acknowledgement, but passive stale rows must not accumulate forever.
      if (unavailable.length && (view.area.value || document.activeElement === view.area || view.sending || view.stopping)) {
        view.fresh = false
        syncControls(view)
        continue
      }
      view.removed = true
      view.fresh = false
      syncControls(view)
      view.row.remove()
      rows.delete(id)
    }
    empty.hidden = rows.size > 0 || unavailable.length > 0
  }
  function schedule() {
    if (!stopped) timer = setTimeout(() => { timer = null; void refresh() }, 4000)
  }
  function refresh() {
    if (stopped) return Promise.resolve()
    if (inFlight) return inFlight
    if (timer !== null) { clearTimeout(timer); timer = null }
    inFlight = (async () => {
      if (!panel.open) return
      try {
        const response = await request('/activity', { cache: 'no-store' })
        if (!response.ok) throw Error()
        const data = await response.json()
        if (!stopped) renderSnapshot(data)
      } catch {
        if (stopped) return
        warning.textContent = 'Activity unavailable. Current task status is not confirmed.'
        empty.hidden = true
        for (const view of rows.values()) { view.fresh = false; syncControls(view) }
      }
    })().finally(() => { inFlight = null; schedule() })
    return inFlight
  }
  const onToggle = () => { if (panel.open) void refresh() }
  const controller = Object.freeze({ refresh, stop() {
    if (!stopped) {
      stopped = true
      lifecycle.abort()
      if (timer !== null) { clearTimeout(timer); timer = null }
      panel.removeEventListener('toggle', onToggle)
      for (const view of rows.values()) { view.fresh = false; syncControls(view) }
      if (panel.__noriMobileActivity === controller) delete panel.__noriMobileActivity
    }
    return inFlight || Promise.resolve()
  } })
  panel.__noriMobileActivity = controller
  panel.addEventListener('toggle', onToggle)
  void refresh()
  return controller
}

module.exports = { installMobileTaskActivity }
