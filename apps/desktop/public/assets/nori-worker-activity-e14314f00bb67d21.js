/* Original Nori activity consumer. Read-only bridge status; approval stays native. */
;(function () {
  'use strict'
  const ID = /^[a-f0-9]{32}$/
  const STATES = new Set(['awaiting_approval', 'queued', 'planning', 'running', 'answering', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted', 'blocked'])
  const HISTORY = new Set(['completed', 'cancelled'])
  const PANEL_ID = 'nori-neurons-activity'

  function activityUrl(connection) {
    if (!connection || typeof connection.bridgeUrl !== 'string') throw Error('Nori’s owned activity connection is unavailable.')
    if (!/^ws:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/?$/.test(connection.bridgeUrl)) throw Error('Nori’s owned activity connection is invalid.')
    const url = new URL(connection.bridgeUrl)
    if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !url.port
        || Number(url.port) < 1 || Number(url.port) > 65535 || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) throw Error('Nori’s owned activity connection is invalid.')
    url.protocol = 'http:'; url.pathname = '/work-activity'
    return url.href
  }

  function fileList(values) {
    if (!Array.isArray(values) || values.length > 24 || values.some(value => typeof value !== 'string'
        || !value || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value))) throw Error('Nori returned an invalid file-review scope.')
    return [...values]
  }

  function validateSnapshot(value) {
    if (!value || value.schema !== 'nori.work-activity.v1' || typeof value.observedAt !== 'string'
        || !Number.isFinite(Date.parse(value.observedAt)) || !Array.isArray(value.tasks) || value.tasks.length > 20) throw Error('Nori returned an invalid activity snapshot.')
    const ids = new Set()
    const tasks = value.tasks.map(task => {
      if (!task || !ID.test(task.id) || ids.has(task.id) || !STATES.has(task.status)
          || typeof task.goal !== 'string' || task.goal.length > 1200) throw Error('Nori returned an invalid saved task.')
      ids.add(task.id)
      let review = null
      if (task.review !== null && task.review !== undefined) {
        const source = task.review
        if (!/^[a-f0-9]{64}$/.test(source.binding) || !Number.isSafeInteger(source.attempt) || source.attempt < 1) throw Error('Nori returned an invalid task-review record.')
        review = { attempt: source.attempt, editableFiles: fileList(source.editableFiles), contextFiles: fileList(source.contextFiles) }
      }
      return { id: task.id, goal: task.goal, status: task.status, review }
    })
    // resumeEnabled is deliberately ignored: it is not coder permission.
    return { observedAt: value.observedAt, tasks }
  }

  function install(document, window) {
    if (window !== window.top || document.getElementById(PANEL_ID)) return null
    const api = window.noriWorkerWorkspace
    const panel = document.createElement('section')
    panel.id = PANEL_ID; panel.setAttribute('aria-label', 'Neurons activity')
    panel.dataset.version = '20261031'
    const style = document.createElement('style')
    style.textContent = `aside.rail-right:has(> #${PANEL_ID}){overflow-y:auto;overflow-x:hidden;pointer-events:auto}#${PANEL_ID}{pointer-events:auto;color:#dbe4ec;background:#171c22;border:1px solid #2c3a42;border-radius:12px;padding:14px;margin:0 0 18px;font:12px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}#${PANEL_ID} h2{font-size:14px;color:#dfeaf2;margin:0 0 6px}#${PANEL_ID} p{margin:5px 0 10px}#${PANEL_ID} .nwa-muted{color:#9bacb9}#${PANEL_ID} .nwa-controls{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}#${PANEL_ID} button{font:inherit;border:1px solid #355750;background:#1b3432;color:#b9f3e4;border-radius:7px;padding:7px 9px;cursor:pointer;max-width:100%;text-align:left}#${PANEL_ID} button:disabled{opacity:.55;cursor:default}#${PANEL_ID} button:focus-visible,#${PANEL_ID} summary:focus-visible{outline:2px solid #81dcce;outline-offset:3px}#${PANEL_ID} .nwa-task{border-top:1px solid #2b3740;padding:12px 0}#${PANEL_ID} .nwa-state{font-size:11px;font-weight:650;color:#9ddfce}#${PANEL_ID} .nwa-scope{margin:8px 0;padding-left:16px}#${PANEL_ID} code{font:10px/1.5 ui-monospace,monospace;white-space:normal;overflow-wrap:anywhere;color:#c1d7e3}#${PANEL_ID} .nwa-list{max-height:52vh;overflow:auto;scrollbar-width:thin}#${PANEL_ID} .nwa-feedback{color:#f0d7a9}#${PANEL_ID} summary{cursor:pointer;color:#a9bdca;margin:9px 0}#${PANEL_ID} .nwa-project{font-size:11px}#${PANEL_ID} .nwa-review{margin-top:8px;width:100%}`
    panel.appendChild(style)
    const node = (tag, text, className) => {
      const element = document.createElement(tag)
      if (text !== undefined) element.textContent = text
      if (className) element.className = className
      return element
    }
    panel.appendChild(node('h2', 'Neurons · Activity'))
    panel.appendChild(node('p', 'Nori stays your assistant. Review each coding attempt here before file edits.', 'nwa-muted'))
    const project = node('div', 'Coding project: checking…', 'nwa-project')
    panel.appendChild(project)
    const controls = node('div', undefined, 'nwa-controls')
    const choose = node('button', 'Choose coding project'); choose.type = 'button'
    const refreshButton = node('button', 'Refresh tasks'); refreshButton.type = 'button'
    controls.appendChild(choose); controls.appendChild(refreshButton); panel.appendChild(controls)
    panel.appendChild(node('p', 'Project selection does not approve edits or enable a worker. Pending tasks may prevent switching.', 'nwa-muted'))
    const feedback = node('div', '', 'nwa-feedback')
    feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); panel.appendChild(feedback)
    const freshness = node('p', 'Saved task status has not been checked.', 'nwa-muted'); panel.appendChild(freshness)
    const list = node('div', undefined, 'nwa-list'), current = node('div'), history = node('details')
    history.open = false
    const historyLabel = node('summary', 'Completed and canceled history'), historyList = node('div')
    history.appendChild(historyLabel); history.appendChild(historyList)
    list.appendChild(current); list.appendChild(history); panel.appendChild(list)
    const empty = node('p', 'No saved tasks are in this bounded view.', 'nwa-muted'); current.appendChild(empty)
    panel.appendChild(node('p', 'Activity shows at most 20 saved tasks. Native review rechecks the full current goal and file scope. Completion is reported from refreshed task status.', 'nwa-muted'))
    const state = { tasks: [], fresh: false, actionBusy: false, readBusy: false, projectGeneration: 0, cards: new Map(), disposed: false }
    let controller = null
    const canReview = task => task.status === 'awaiting_approval' && task.review?.editableFiles.length > 0
    function updateButtons() {
      choose.disabled = state.actionBusy || state.readBusy || typeof api?.select !== 'function'
      refreshButton.disabled = state.readBusy || state.actionBusy
      for (const [id, card] of state.cards) {
        const task = state.tasks.find(item => item.id === id)
        card.button.disabled = !state.fresh || state.readBusy || state.actionBusy || !task || !canReview(task) || typeof api?.confirm !== 'function'
      }
    }
    function makeCard(task) {
      const root = node('article', undefined, 'nwa-task'), status = node('div', '', 'nwa-state'), goal = node('p'), id = node('code')
      root.dataset.taskId = task.id
      root.appendChild(status); root.appendChild(goal); root.appendChild(id)
      const scope = node('div'); root.appendChild(scope)
      const button = node('button', 'Review and confirm…', 'nwa-review'); button.type = 'button'
      button.dataset.reviewTaskId = task.id
      button.addEventListener('click', () => reviewTask(task.id)); root.appendChild(button)
      return { root, status, goal, id, scope, button, signature: '' }
    }
    function render() {
      const ids = new Set(state.tasks.map(task => task.id))
      for (const [id, card] of state.cards) if (!ids.has(id)) { card.root.remove(); state.cards.delete(id) }
      for (const task of state.tasks) {
        let card = state.cards.get(task.id)
        if (!card) { card = makeCard(task); state.cards.set(task.id, card) }
        const signature = JSON.stringify(task)
        if (card.signature !== signature) {
          card.status.textContent = task.status.replaceAll('_', ' ')
          card.goal.textContent = task.goal; card.id.textContent = task.id
          card.scope.replaceChildren()
          if (task.review) {
            card.scope.appendChild(node('div', `Attempt ${task.review.attempt} · Editable files`))
            for (const [label, files] of [['Editable files', task.review.editableFiles], ['Read-only context', task.review.contextFiles]]) {
              if (label !== 'Editable files') card.scope.appendChild(node('div', label))
              const scopeList = node('ul', undefined, 'nwa-scope')
              for (const file of files) { const row = node('li'); row.appendChild(node('code', file)); scopeList.appendChild(row) }
              if (!files.length) scopeList.appendChild(node('li', 'None'))
              card.scope.appendChild(scopeList)
            }
          } else if (task.status === 'awaiting_approval') card.scope.appendChild(node('p', 'A valid coding-file review scope is unavailable; review is disabled.'))
          card.button.hidden = !canReview(task)
          card.signature = signature
        }
        const destination = HISTORY.has(task.status) ? historyList : current
        if (card.root.parentNode !== destination) destination.appendChild(card.root)
      }
      const historical = state.tasks.filter(task => HISTORY.has(task.status)).length
      historyLabel.textContent = `Completed and canceled history (${historical})`
      history.hidden = historical === 0
      empty.hidden = state.tasks.some(task => !HISTORY.has(task.status))
      updateButtons()
    }
    async function refresh() {
      if (state.disposed || state.readBusy || state.actionBusy) return
      state.readBusy = true; state.fresh = false; updateButtons()
      const requestController = new AbortController()
      controller = requestController
      const timeout = window.setTimeout(() => requestController.abort(), 12000)
      try {
        const endpoint = activityUrl(window.noriConnection)
        const response = await window.fetch(endpoint, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: requestController.signal })
        if (!response.ok || !response.body?.getReader) throw Error('Nori’s saved activity is unavailable.')
        const reader = response.body.getReader(), chunks = []
        let bytes = 0
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > 2 * 1024 * 1024) throw Error('Oversized activity snapshot.')
            chunks.push(value)
          }
        } finally { await reader.cancel().catch(() => {}) }
        const body = new Uint8Array(bytes)
        let offset = 0
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(body)
        const snapshot = validateSnapshot(JSON.parse(raw))
        if (state.disposed) return
        state.tasks = snapshot.tasks; state.fresh = true
        freshness.textContent = 'Last checked: ' + new Date(snapshot.observedAt).toLocaleTimeString()
        render()
      } catch {
        if (!state.disposed) {
          state.fresh = false
          freshness.textContent = 'Activity unavailable. Previously shown tasks may be stale; review is disabled until refresh succeeds.'
        }
      } finally { window.clearTimeout(timeout); state.readBusy = false; controller = null; updateButtons() }
    }
    function projectResult(value) {
      if (!value || (value.workspace !== null && typeof value.workspace !== 'string') || (value.workspace?.length || 0) > 32767) throw Error('Project status unavailable.')
      project.textContent = 'Coding project: ' + (value.workspace || 'Not selected')
      if (value.error) feedback.textContent = 'Project status could not be verified.'
      else if (value.warning) feedback.textContent = String(value.warning).slice(0, 300)
      else if (value.restartRequired) feedback.textContent = 'Project is saved but not active in this session.'
      // approvalGranted:false never means the coder is disabled or enabled.
    }
    async function readProject() {
      const generation = ++state.projectGeneration
      try {
        if (typeof api?.read !== 'function') throw Error('Unavailable')
        const result = await api.read()
        if (!state.disposed && !state.actionBusy && generation === state.projectGeneration) projectResult(result)
      } catch { if (!state.disposed && !state.actionBusy && generation === state.projectGeneration) project.textContent = 'Coding project: unavailable in this window.' }
    }
    async function reviewTask(id) {
      const task = state.tasks.find(item => item.id === id)
      if (!ID.test(id) || !state.fresh || state.readBusy || state.actionBusy || !task || !canReview(task) || typeof api?.confirm !== 'function') return
      state.actionBusy = true; updateButtons()
      feedback.textContent = 'Opening Nori’s native task review. No approval has been submitted.'
      try {
        const receipt = await api.confirm(id)
        if (!receipt || typeof receipt.confirmed !== 'boolean' || (receipt.confirmed && receipt.completed !== false)) throw Error('Invalid review acknowledgement')
        feedback.textContent = receipt.confirmed ? 'Review accepted. Check task progress below; completion is not yet confirmed.' : 'Review canceled. No task approval was submitted.'
      } catch { feedback.textContent = 'Nori could not complete that review. Refresh task status before trying again.' }
      finally { state.actionBusy = false; updateButtons(); await refresh() }
    }
    choose.addEventListener('click', async () => {
      if (state.actionBusy || state.readBusy || typeof api?.select !== 'function') return
      state.actionBusy = true; state.projectGeneration++; updateButtons()
      feedback.textContent = ''
      try { projectResult(await api.select()); feedback.textContent ||= 'Project selection checked. Each coding task still requires its own review.' }
      catch { feedback.textContent = 'Project switching was not accepted. Finish or cancel pending coding tasks before switching.' }
      finally { state.actionBusy = false; updateButtons(); await refresh() }
    })
    refreshButton.addEventListener('click', () => { void refresh(); void readProject() })
    function mount() {
      if (state.disposed || panel.isConnected) return
      const rail = document.querySelector('aside.rail-right')
      if (!rail) return
      rail.insertBefore(panel, rail.firstChild)
      void readProject(); void refresh()
    }
    const observer = new window.MutationObserver(mount)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    const timer = window.setInterval(() => { if (!document.hidden && panel.isConnected) void refresh() }, 5000)
    window.addEventListener('pagehide', () => { state.disposed = true; controller?.abort(); observer.disconnect(); window.clearInterval(timer) }, { once: true })
    mount(); updateButtons()
    return { panel, refresh }
  }
  if (typeof module === 'object' && module.exports) module.exports = { activityUrl, validateSnapshot, install }
  if (typeof window === 'object' && typeof document === 'object') install(document, window)
})()
