// Nori app layout v2 (owner, 2026-11-16): a sidebar of her real functions and a composer with a + menu and a
// connections menu. Every control drives something that already exists in her app; nothing here adds an
// ability or a permission, and each approval dialog she already shows still appears. The React app's own
// nodes are never moved: this script adds its own sidebar and popover, and marks a few nodes with classes.
// Ctrl+Shift+L (or More > Classic layout) switches back. Text from her data is always set as textContent.
(() => {
  'use strict'
  const KEY = 'nori.layout'
  const wanted = () => { try { return localStorage.getItem(KEY) !== 'classic' } catch { return true } }
  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
  const ICONS = {
    task: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    library: '<path d="M5 4v16M9 4v16M13 5l5 15"/>',
    web: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
    auto: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M10 7h4a3 3 0 0 1 3 3v4"/>',
    plugin: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    project: '<path d="M4 7h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M4 7l2-3h12l2 3M10 11h4"/>',
    local: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 20h20"/>',
    file: '<path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4L15.5 8.8"/>',
    skill: '<path d="M10 3h4v3a2 2 0 1 0 4 0h3v5h-3a2 2 0 1 0 0 4h3v5h-5v-3a2 2 0 1 0-4 0v3H7v-5H4a2 2 0 1 1 0-4h3V6h3Z"/>',
    link: '<path d="M7 4v5a3 3 0 0 0 6 0V4M17 20v-5a3 3 0 0 0-6 0v5M10 12v0"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  }
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`
  function make(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node }
  function button(cls, icon, label, onClick) {
    const b = make('button', cls); b.type = 'button'
    if (icon) b.insertAdjacentHTML('beforeend', svg(icon))   // fixed markup from ICONS above, never data
    b.append(make('span', '', label)); b.addEventListener('click', onClick); return b
  }
  const say = error => String(error?.message || error || 'not available').slice(0, 160)
  const short = (value, n = 60) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

  // ---- her existing controls ----
  const railButton = text => $$('.rail-left button').find(b => b.textContent.trim().toLowerCase().includes(text))
  const newTask = () => $('.rail-left .nori-new-chat')?.click()
  const useComputer = () => railButton('use my computer')?.click()
  const bridgeHttp = () => { const u = window.noriConnection?.bridgeUrl; return typeof u === 'string' ? u.replace(/^ws/, 'http').replace(/\/+$/, '') : null }
  async function readTasks() {
    const base = bridgeHttp(); if (!base) throw Error('her bridge address is not available in this window')
    const res = await fetch(`${base}/work-activity`, { cache: 'no-store' }); const body = await res.json()
    if (!res.ok) throw Error(body?.error || `status ${res.status}`)
    return Array.isArray(body.tasks) ? body.tasks : []
  }
  async function readProject() {
    const value = await window.noriWorkerWorkspace?.read?.()
    const path = [value?.name, value?.label, value?.path, value?.root, value?.workspace?.path, value?.workspace?.root].find(v => typeof v === 'string' && v)
    return path ? path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : ''
  }
  const chooseProject = async () => { try { await window.noriWorkerWorkspace?.select?.() } catch {} refresh() }

  // ---- popover ----
  let pop = null, popAnchor = null
  function closePop() { pop?.classList.remove('open'); popAnchor?.classList.remove('on'); popAnchor = null }
  function openPop(anchor, build, side = 'right') {
    if (popAnchor === anchor) { closePop(); return null }
    closePop(); pop.replaceChildren(); build(pop)
    pop.classList.add('open'); popAnchor = anchor; anchor.classList.add('on')
    const a = anchor.getBoundingClientRect(), p = pop.getBoundingClientRect()
    let x = side === 'right' ? a.right + 8 : a.left, y = side === 'right' ? a.top : a.top - p.height - 8
    pop.style.left = `${Math.max(8, Math.min(innerWidth - p.width - 8, x))}px`
    pop.style.top = `${Math.max(8, Math.min(innerHeight - p.height - 8, y))}px`
    return pop
  }
  const row = (icon, label, onClick) => button('nv2-row', icon, label, () => { closePop(); onClick() })
  function lines(root, title, items, empty) {
    root.append(make('h3', '', title))
    if (!items.length) { root.append(make('p', '', empty)); return }
    for (const [text, note] of items) { const line = make('div', 'nv2-line'); line.append(make('span', '', text)); if (note) line.append(make('small', '', note)); root.append(line) }
  }

  // ---- sidebar actions ----
  function searchPanel(anchor) {
    const root = openPop(anchor, r => {
      r.append(make('h3', '', 'Search this conversation'))
      const input = make('input'); input.type = 'search'; input.placeholder = 'Find in the conversation'; r.append(input)
      const note = make('p', '', 'Shows only the messages that contain your words. Clear it to see everything.'); r.append(note)
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase(); let hits = 0
        for (const line of $$('.log-line')) { const miss = Boolean(q) && !line.textContent.toLowerCase().includes(q); line.classList.toggle('nv2-miss', miss); if (q && !miss) hits++ }
        note.textContent = q ? `${hits} message${hits === 1 ? '' : 's'} match.` : 'Shows only the messages that contain your words. Clear it to see everything.'
      })
    })
    root?.querySelector('input')?.focus()
  }
  function websitePanel(anchor) {
    const root = openPop(anchor, r => {
      r.append(make('h3', '', 'Open a website with Nori'))
      const input = make('input'); input.type = 'url'; input.placeholder = 'https://'; r.append(input)
      const note = make('p', '', 'She asks for your approval before opening it and before each action on it.'); r.append(note)
      input.addEventListener('keydown', async event => {
        if (event.key !== 'Enter') return
        let url = input.value.trim(); if (!url) return
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`
        if (!window.noriBrowser?.start) { note.textContent = 'Her browser is not available in this window.'; return }
        note.textContent = 'Asking her to open it…'
        try { const result = await window.noriBrowser.start({ url }); note.textContent = result?.error ? short(result.error, 160) : result?.ok === false ? 'She did not open it.' : 'Requested.' } catch (error) { note.textContent = say(error) }
      })
    })
    root?.querySelector('input')?.focus()
  }
  function automationPanel(anchor) {
    openPop(anchor, r => {
      r.append(make('h3', '', 'Automations')); const status = make('p', '', 'Reading her routines…'); r.append(status)
      Promise.resolve().then(() => window.noriProactive?.read ? window.noriProactive.read() : Promise.reject(Error('not available in this window'))).then(value => {
        if (popAnchor !== anchor) return
        const pick = key => (Array.isArray(value?.[key]) ? value[key] : []).map(item => [short(item?.goal || item?.name || item?.title || item?.id), short(item?.status || item?.state || '', 18)])
        status.remove()
        lines(r, 'Routines', pick('routines'), 'None yet.'); lines(r, 'Monitors', pick('monitors'), 'None yet.')
        r.append(make('p', '', 'To add one, ask her in the box, for example "check this every hour". She asks before creating it.'))
      }).catch(error => { status.textContent = `Could not read them: ${say(error)}` })
    })
  }
  function pluginPanel(anchor) {
    openPop(anchor, r => {
      r.append(make('h3', '', 'Skills'))
      r.append(row('list', 'Show installed skills', () => window.noriSkills?.showInstalled?.()))
      r.append(row('skill', 'Install a skill from a ZIP', () => window.noriSkills?.openInstaller?.()))
      r.append(make('p', '', 'Skills are the only add-ons she has. Naming a skill ZIP or GitHub link in the box also installs it.'))
    })
  }
  function drawer(name) { const on = !document.body.classList.contains(name); document.body.classList.remove('nv2-more', 'nv2-inspect'); if (on) document.body.classList.add(name); closePop() }
  function setLayout(on) {
    try { localStorage.setItem(KEY, on ? 'v2' : 'classic') } catch {}
    document.body.classList.toggle('nv2', on); if (!on) { document.body.classList.remove('nv2-more', 'nv2-inspect'); closePop(); for (const line of $$('.nv2-miss')) line.classList.remove('nv2-miss') }
    dispatchEvent(new Event('resize')); if (on) refresh()
  }

  // ---- build the sidebar ----
  let side = null, stateText = null, projectRow = null, projectChipText = null, taskList = null
  function build() {
    side = make('nav'); side.id = 'nv2-side'; side.setAttribute('aria-label', 'Nori')
    const brand = make('div', 'nv2-brand'); brand.append(make('span', 'nv2-dot'), make('span', '', 'Nori')); stateText = make('span', 'nv2-state', ''); brand.append(stateText); side.append(brand)
    const item = (icon, label, act) => { const b = button('nv2-item', icon, label, () => act(b)); side.append(b); return b }
    item('task', 'New task', () => { closePop(); newTask() })
    item('computer', 'Computers', () => { closePop(); useComputer() })
    item('search', 'Search', searchPanel)
    item('library', 'Library', () => drawer('nv2-inspect'))
    item('web', 'Websites', websitePanel)
    item('auto', 'Automations', automationPanel)
    item('plugin', 'Plugins', pluginPanel)
    item('more', 'More', () => drawer('nv2-more'))
    side.append(make('div', 'nv2-label', 'Projects'))
    projectRow = button('nv2-item', 'project', 'Choose project', chooseProject); side.append(projectRow)
    side.append(make('div', 'nv2-label', 'Tasks'))
    taskList = make('div'); side.append(taskList)
    const foot = make('div', 'nv2-foot', 'Runs on this PC. '); const classic = make('a', '', 'Classic layout'); classic.href = '#'; classic.addEventListener('click', event => { event.preventDefault(); setLayout(false) }); foot.append(classic); side.append(foot)
    pop = make('div'); pop.id = 'nv2-pop'
    document.body.append(side, pop)
  }
  async function refresh() {
    if (!document.body.classList.contains('nv2')) return
    try { const name = await readProject(); const label = name || 'Choose project'; projectRow.lastChild.textContent = label; if (projectChipText) projectChipText.textContent = label } catch {}
    try {
      const tasks = await readTasks(); taskList.replaceChildren()
      if (!tasks.length) taskList.append(make('div', 'nv2-empty', 'No saved tasks.'))
      for (const task of tasks.slice(0, 8)) { const b = button('nv2-item nv2-sub', null, short(task.goal, 80) || task.id, () => { document.body.classList.remove('nv2-more'); document.body.classList.add('nv2-inspect') }); b.title = short(task.goal, 300); b.append(make('small', 'nv2-badge', short(task.status, 12))); taskList.append(b) }
    } catch (error) { taskList.replaceChildren(make('div', 'nv2-empty', `Tasks unavailable: ${say(error)}`)) }
  }

  // ---- composer ----
  function plusMenu(anchor) {
    openPop(anchor, r => {
      r.append(row('skill', 'Use skills', () => window.noriSkills?.showInstalled?.()))
      r.append(row('list', 'Recent tasks', () => { document.body.classList.remove('nv2-more'); document.body.classList.add('nv2-inspect') }))
      r.append(row('library', 'Library', () => { document.body.classList.remove('nv2-more'); document.body.classList.add('nv2-inspect') }))
      r.append(row('file', 'Local files', () => $('form.textbar input[type="file"]')?.click()))
    }, 'up')
  }
  function connectionMenu(anchor) {
    openPop(anchor, r => {
      const systems = $$('.rail-left .rail-list .rail-item:not(.dim)').map(node => [short(node.textContent, 50), 'connected']).filter(([text]) => text)
      lines(r, 'Connected systems', systems, 'None linked.')
      r.append(row('computer', 'Use my computer', useComputer))
      r.append(row('web', 'Open a website', () => { const target = $$('#nv2-side .nv2-item')[4]; if (target) websitePanel(target) }))
      r.append(make('p', '', 'These are the connections she has today. She has no account connectors (mail, GitHub, phone) yet.'))
    }, 'up')
  }
  function dressComposer() {
    const form = $('form.textbar'); if (!form) return
    const attach = $$(':scope > button.textbar-attach', form)
    const mic = attach.find(b => /voice/i.test(b.getAttribute('aria-label') || '')), plus = attach.find(b => b !== mic && b.id !== 'nori-skill-zip-upload')
    plus?.classList.add('nv2-plus'); mic?.classList.add('nv2-mic')
    if (!$(':scope > .nv2-chips', form)) {
      const chips = make('div', 'nv2-chips')
      const local = button('nv2-chip', 'local', 'This PC', () => {}); local.title = 'Nori runs on this PC, not in a cloud'
      const project = button('nv2-chip', 'project', projectRow?.lastChild.textContent || 'Choose project', chooseProject); projectChipText = project.lastChild
      chips.append(local, project); form.prepend(chips)
    }
    if (!$(':scope > .nv2-round', form)) { const link = make('button', 'nv2-round'); link.type = 'button'; link.title = 'Connections'; link.setAttribute('aria-label', 'Connections'); link.insertAdjacentHTML('beforeend', svg('link')); link.addEventListener('click', () => connectionMenu(link)); (plus || form.firstChild).after(link) }
    const box = $('.textbar-input', form); if (box && document.body.classList.contains('nv2') && box.placeholder !== PLACEHOLDER) { box.dataset.nv2Was ??= box.placeholder; box.placeholder = PLACEHOLDER }
  }
  const PLACEHOLDER = 'Assign a task or type what you want'
  // The + button opens her menu; "Local files" in it presses her real file picker.
  document.addEventListener('click', event => {
    if (!document.body.classList.contains('nv2')) return
    const plus = event.target.closest?.('form.textbar > button.nv2-plus')
    if (plus && event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); plusMenu(plus); return }
    if (pop?.classList.contains('open') && !pop.contains(event.target) && !popAnchor?.contains(event.target)) closePop()
    if (!event.target.closest?.('#nv2-side, #nv2-pop, .rail-left, .rail-right, form.textbar')) document.body.classList.remove('nv2-more', 'nv2-inspect')
  }, true)
  addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyL') { event.preventDefault(); setLayout(!document.body.classList.contains('nv2')) }
    else if (event.key === 'Escape') { closePop(); document.body.classList.remove('nv2-more', 'nv2-inspect') }
  })

  function start() {
    build()
    document.body.classList.toggle('nv2', wanted())
    dispatchEvent(new Event('resize'))
    let queued = false
    new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; dressComposer() }) }).observe(document.body, { childList: true, subtree: true })
    setInterval(() => { const text = $('.status-text')?.textContent || ''; if (stateText && stateText.textContent !== text) stateText.textContent = text }, 500)
    dressComposer(); refresh(); setInterval(refresh, 15000)
    window.noriLayout = { set: setLayout, active: () => document.body.classList.contains('nv2'), refresh }
  }
  if (document.body) start(); else addEventListener('DOMContentLoaded', start, { once: true })
})()
