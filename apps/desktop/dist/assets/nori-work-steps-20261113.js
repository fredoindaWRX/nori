/* R87 live work steps (owner 2026-11-13: "show it the same way you do, in her text area", "auto-update and not wait
   for me"). Listens read-only to frames from Nori's own loopback bridge socket and draws each tool step under her
   current reply as it happens: what she is doing, then a tick or cross, with the result preview one click away.
   Display only: it sends nothing, grants nothing and never touches the conversation. */
;(function () {
  'use strict'
  if (window.noriWorkSteps) return
  const BRIDGE = /^ws:\/\/127\.0\.0\.1:\d{1,5}\/?$/
  const turns = new Map()          // ask id -> turn
  const order = []                 // ask ids, oldest first
  const KEEP = 4
  let root = null, observer = null

  // --- tap the bridge socket (the app bundle creates it after this script runs) ---------------------------
  const Native = window.WebSocket
  if (typeof Native === 'function') {
    class TappedSocket extends Native {
      constructor(url, protocols) {
        super(url, protocols)
        try { if (BRIDGE.test(String(url))) this.addEventListener('message', event => { try { receive(JSON.parse(event.data)) } catch { /* not ours */ } }) } catch { /* never break the socket */ }
      }
    }
    window.WebSocket = TappedSocket
  }

  // --- rendering -------------------------------------------------------------------------------------------
  const STYLE = `
#nori-work-steps{margin:10px 0 4px;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:#d7e6ff}
#nori-work-steps .nws-turn{margin:10px 0}
#nori-work-steps .nws-steps{border:1px solid rgba(120,170,255,.2);border-radius:14px;background:rgba(7,13,26,.72);padding:10px 14px;margin:0 0 8px}
#nori-work-steps .nws-step{margin:2px 0}
#nori-work-steps .nws-row{display:flex;gap:10px;align-items:center;cursor:pointer;background:none;border:0;color:inherit;font:inherit;padding:3px 0;text-align:left;width:100%}
#nori-work-steps .nws-icon{width:15px;height:15px;flex:none;box-sizing:border-box;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1}
#nori-work-steps .nws-label{flex:none;font-weight:500}
#nori-work-steps .nws-detail{font-size:13px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
#nori-work-steps .nws-time{flex:none;font-size:12px;opacity:.5}
#nori-work-steps .running .nws-icon{border:2px solid rgba(143,192,255,.25);border-top-color:#8fc0ff;animation:nws-spin .9s linear infinite}
#nori-work-steps .running .nws-label{color:#f0f6ff}
#nori-work-steps .ok .nws-icon{color:#6fd3a6}
#nori-work-steps .ok .nws-row,#nori-work-steps .stopped .nws-row{color:#9fb8e6}
#nori-work-steps .failed .nws-icon{color:#ff8a8a}
#nori-work-steps .stopped .nws-icon{border:1.5px dashed #5f7fb0}
#nori-work-steps .nws-head{display:flex;gap:10px;align-items:center;cursor:pointer;user-select:none;background:none;border:0;color:#9fb8e6;font:inherit;padding:2px 2px;width:100%;text-align:left}
#nori-work-steps .nws-head:focus-visible{outline:1px solid #8fc0ff;border-radius:6px}
#nori-work-steps .nws-dots{flex:none;width:16px;height:14px;background:radial-gradient(circle,#ff9a6a 2px,transparent 2.5px) 0 0/8px 7px;opacity:.95}
#nori-work-steps .nws-head:not(.done) .nws-dots{animation:nws-pulse 1.2s ease-in-out infinite}
#nori-work-steps .nws-head.done .nws-dots{background:radial-gradient(circle,#6fd3a6 2px,transparent 2.5px) 0 0/8px 7px}
#nori-work-steps .nws-now{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#nori-work-steps .nws-elapsed{flex:none;font-size:13px;opacity:.75}
#nori-work-steps .nws-chev{flex:none;opacity:.6;transition:transform .15s}
#nori-work-steps .nws-head.open .nws-chev{transform:rotate(90deg)}
#nori-work-steps pre{margin:4px 0 6px 25px;padding:8px 10px;max-height:18rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,Consolas,monospace;background:rgba(0,0,0,.32);border-radius:8px}
#nori-work-steps pre .add{color:#4ade80}#nori-work-steps pre .del{color:#f87171}#nori-work-steps pre .hunk{color:#8fc0ff}
#nori-work-steps .nws-steps[hidden],#nori-work-steps pre[hidden]{display:none}
@keyframes nws-spin{to{transform:rotate(360deg)}}
@keyframes nws-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){#nori-work-steps .running .nws-icon,#nori-work-steps .nws-dots{animation:none}}`

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
  const secs = ms => ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round(ms % 60000 / 1000)} s`
  const text = (value, limit) => { const s = typeof value === 'string' ? value : ''; return s.length > limit ? s.slice(0, limit - 1) + '…' : s }

  function ensureRoot() {
    if (!root) {
      root = el('section'); root.id = 'nori-work-steps'; root.setAttribute('aria-live', 'polite'); root.setAttribute('aria-label', 'What Nori is doing')
      const style = el('style'); style.textContent = STYLE; document.head.appendChild(style)
    }
    mount()
    return root
  }

  function mount() {
    if (!root) return
    const host = document.getElementById('nori-inline-coding-host')
    if (host && root.parentNode !== host) host.insertBefore(root, host.firstChild)
  }

  function nearBottom(node) {
    for (let p = node?.parentElement; p; p = p.parentElement) {
      if (p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) return { box: p, near: p.scrollHeight - p.scrollTop - p.clientHeight < 160 }
    }
    return null
  }

  function follow() {
    if (!root?.isConnected) return
    const s = nearBottom(root)
    if (s?.near) s.box.scrollTop = s.box.scrollHeight
  }

  function paintPreview(pre, preview) {
    pre.replaceChildren()
    const lines = String(preview || '(no output)').split('\n')
    const diff = lines.filter(l => /^(\+|-|@@)/.test(l)).length >= 2
    for (const line of lines) {
      const span = el('span', diff ? (/^@@/.test(line) ? 'hunk' : /^\+(?!\+\+)/.test(line) ? 'add' : /^-(?!--)/.test(line) ? 'del' : '') : '', line + '\n')
      pre.appendChild(span)
    }
  }

  function turnFor(ask) {
    let turn = turns.get(ask)
    if (turn) return turn
    const box = el('div', 'nws-turn'), head = el('button', 'nws-head'), list = el('div', 'nws-steps')
    head.type = 'button'
    // Like a coding assistant's progress view (owner, 2026-11-16): the steps in a card, then one line saying what she
    // is doing right now with a running clock. The line opens and closes the card.
    const headText = el('span', 'nws-now'), headTime = el('span', 'nws-elapsed')
    head.append(el('span', 'nws-dots'), headText, headTime, el('span', 'nws-chev', '›'))
    turn = { ask, box, head, headText, headTime, list, steps: new Map(), started: Date.now(), done: false, open: true, clock: 0 }
    turn.clock = window.setInterval(() => { if (turn.done || !box.isConnected) window.clearInterval(turn.clock); else header(turn) }, 1000)
    head.addEventListener('click', () => { turn.open = !turn.open; list.hidden = !turn.open; header(turn) })
    box.appendChild(list); box.appendChild(head)
    turns.set(ask, turn); order.push(ask)
    while (order.length > KEEP) { const old = turns.get(order.shift()); old?.box.remove(); turns.delete(old?.ask) }
    ensureRoot().appendChild(box)
    header(turn)
    return turn
  }

  function header(turn) {
    const all = [...turn.steps.values()], n = all.length, failed = all.filter(s => s.state === 'failed').length
    const running = all.filter(s => s.state === 'running').pop()
    turn.headText.textContent = turn.done
      ? `Worked through ${n} step${n === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`
      : running ? running.summary : n ? 'Working…' : 'Starting…'
    turn.headTime.textContent = turn.done ? secs(turn.ended - turn.started) : `${Math.max(0, Math.round((Date.now() - turn.started) / 1000))}s`
    turn.head.classList.toggle('done', turn.done); turn.head.classList.toggle('open', turn.open)
    turn.head.setAttribute('aria-expanded', String(turn.open))
  }

  function paintStep(s) {
    s.row.parentElement.className = `nws-step ${s.state}`
    s.icon.textContent = s.state === 'ok' ? '✓' : s.state === 'failed' ? '✕' : ''   // running is a spinner, stopped a dashed ring
    s.time.textContent = s.state === 'running' ? '' : s.ended ? secs(s.ended - s.started) : ''
  }

  function startStep(turn, step) {
    const id = text(step.id, 80) || `s${turn.steps.size + 1}`
    if (turn.steps.has(id)) return
    const wrap = el('div', 'nws-step running'), row = el('button', 'nws-row'), icon = el('span', 'nws-icon'), pre = el('pre')
    row.type = 'button'; pre.hidden = true
    const label = el('span', 'nws-label', text(step.label, 60) || 'Working')
    const detail = el('span', 'nws-detail', text(step.detail, 200))
    if (step.knight) detail.title = `${text(step.knight, 60)} · ${text(step.tool, 80)}`
    const time = el('span', 'nws-time')
    row.append(icon, label, detail, time); wrap.append(row, pre)
    const s = { id, row, icon, time, pre, state: 'running', started: Number(step.at) || Date.now(), ended: 0,
      summary: [label.textContent, detail.textContent].filter(Boolean).join(': ') }
    row.addEventListener('click', () => { pre.hidden = !pre.hidden; row.setAttribute('aria-expanded', String(!pre.hidden)) })
    row.setAttribute('aria-expanded', 'false')
    paintPreview(pre, 'Still running…')
    turn.steps.set(id, s); turn.list.appendChild(wrap)
    paintStep(s); header(turn); follow()
  }

  function endStep(turn, step) {
    const id = text(step.id, 80)
    let s = turn.steps.get(id)
    if (!s) { startStep(turn, { ...step, label: step.tool, detail: '' }); s = turn.steps.get(id) || [...turn.steps.values()].pop() }
    if (!s || s.state !== 'running') return
    s.state = step.ok === true ? 'ok' : 'failed'
    s.ended = Number(step.at) || Date.now()
    paintPreview(s.pre, text(step.preview, 1500))
    paintStep(s); header(turn); follow()
  }

  function finish(turn) {
    if (turn.done) return
    turn.done = true; turn.ended = Date.now(); window.clearInterval(turn.clock)
    for (const s of turn.steps.values()) if (s.state === 'running') { s.state = 'stopped'; s.ended = turn.ended; paintPreview(s.pre, 'The turn ended before this step reported back.'); paintStep(s) }
    // Long step lists fold away once she has answered; one click opens them again.
    if (turn.steps.size > 6) { turn.open = false; turn.list.hidden = true }
    header(turn); follow()
  }

  function receive(frame) {
    if (!frame || typeof frame !== 'object' || typeof frame.ask !== 'string' || frame.ask.length > 80) return
    if (frame.type === 'step' && frame.step && typeof frame.step === 'object') {
      const turn = turnFor(frame.ask)
      if (frame.step.phase === 'start') startStep(turn, frame.step)
      else if (frame.step.phase === 'end') endStep(turn, frame.step)
      return
    }
    if ((frame.type === 'done' || frame.type === 'error') && turns.has(frame.ask)) finish(turns.get(frame.ask))
  }

  function watch() {
    if (observer || !document.body) return
    observer = new MutationObserver(() => { if (root && !root.isConnected) mount() })
    observer.observe(document.body, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true }); else watch()

  window.noriWorkSteps = Object.freeze({ receive, version: '20261116' })
})()
