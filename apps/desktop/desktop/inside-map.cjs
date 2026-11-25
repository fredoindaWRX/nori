'use strict'
// What else is inside Nori besides her memories (owner, 2026-11-17: the city "should represent all the files she has
// access to and the systems she's connected to"). Her face draws one block per item and the summon window shows
// the few facts listed here.
//
// Read-only and bounded: names, counts, dates and yes/no states. Never file contents, never a key or token (only
// whether one is set), nothing from inside the secrets folder. While the owner is streaming (hide() true) project
// and folder paths are left out, like memory titles. Every reader fails soft: a missing file is "not set up".
const fs = require('node:fs')
const path = require('node:path')

const MAX_ITEMS = 220, MAX_WALK = 4000
// The same twelve as bridge/knights.mjs (a test keeps them in step).
const KNIGHTS = Object.freeze([
  ['neo', 'Neo', 'coding'], ['trinity', 'Trinity', 'plugins and skills'], ['morpheus', 'Morpheus', 'project navigation'],
  ['apoc', 'Apoc', 'browser and scouting'], ['oracle', 'Oracle', 'your files and documents'], ['merovingian', 'Merovingian', 'memory and learning'],
  ['architect', 'Architect', 'planning multi-step work'], ['keymaker', 'Keymaker', 'web research'], ['smith', 'Smith', 'running commands'],
  ['tank', 'Tank', 'hardware and devices'], ['machine', 'Machine', 'model status'], ['sentinel', 'Sentinel', 'security checks'],
])
// Folders in her data folder that are the browser engine's, not hers.
const ENGINE = new Set(['cache', 'code cache', 'dips', 'dawngraphitecache', 'dawnwebgpucache', 'gpucache', 'gpupersistentcache', 'grshadercache', 'shadercache',
  'local storage', 'network', 'session storage', 'shared dictionary', 'blob_storage', 'shared_proto_db', 'videodecodestats', 'crashpad', 'partitions', 'webstorage'])
const clean = (value, max = 90) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const slug = value => clean(value, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
const isDir = target => { try { return fs.statSync(target).isDirectory() } catch { return false } }
const isFile = target => { try { return fs.statSync(target).isFile() } catch { return false } }
const day = ms => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '')
const readJson = file => { try { const info = fs.statSync(file); if (!info.isFile() || info.size > 4 * 1024 * 1024) return null; return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
const names = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] } }

/** Files under a folder (two levels deep, capped) and the newest change among them. */
function measure(dir) {
  let files = 0, newest = 0, capped = false
  const visit = (folder, depth) => {
    for (const entry of names(folder)) {
      if (files >= MAX_WALK) { capped = true; return }
      const full = path.join(folder, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { if (depth < 2) visit(full, depth + 1) } else if (entry.isFile()) {
        files++
        try { const m = fs.statSync(full).mtimeMs; if (m > newest) newest = m } catch {}
      }
    }
  }
  visit(dir, 0)
  return { files, newest, capped }
}

/** Absolute Windows folder paths found anywhere in a small settings object. */
function folderPaths(value, out = [], depth = 0) {
  if (out.length >= 12 || depth > 5) return out
  if (typeof value === 'string') { if (/^[A-Za-z]:[\\/]/.test(value) && value.length < 260 && !out.includes(value)) out.push(value) }
  else if (Array.isArray(value)) value.forEach(item => folderPaths(item, out, depth + 1))
  else if (value && typeof value === 'object') Object.values(value).forEach(item => folderPaths(item, out, depth + 1))
  return out
}

// Her own scoreboard (learning/self-tests.jsonl, written by her idle self-tests): what is measured, per model, and
// whether it is moving. Measured, not felt: the same fixed questions each run. Pure: rows in, plain facts out.
function scoreSummary(rows) {
  const runs = (Array.isArray(rows) ? rows : []).filter(run => run && Number.isFinite(run.pass) && run.total > 0 && typeof run.at === 'string').sort((a, b) => a.at.localeCompare(b.at))
  const models = new Map()
  for (const run of runs) { const id = clean(Array.isArray(run.models) ? run.models[0] : '', 40) || 'unknown'; if (!models.has(id)) models.set(id, []); models.get(id).push(run) }
  const perModel = [...models].map(([id, list]) => {
    const last = list.at(-1), first = list[0], best = list.reduce((a, b) => (b.pass / b.total > a.pass / a.total ? b : a))
    const weak = Object.entries(last.byCat && typeof last.byCat === 'object' ? last.byCat : {}).filter(([, v]) => v && v.pass < v.total).map(([name, v]) => `${clean(name, 12)} ${v.pass}/${v.total}`).slice(0, 5)
    return { id, runs: list.length, last: `${last.pass}/${last.total}`, day: last.at.slice(0, 10), release: clean(last.release, 8), first: `${first.pass}/${first.total}`, best: `${best.pass}/${best.total}`,
      change: last.pass - first.pass, weak, seconds: Number.isFinite(last.avgSeconds) ? last.avgSeconds : null, ceiling: best.pass === best.total }
  }).sort((a, b) => b.day.localeCompare(a.day))
  return { runs: runs.length, from: runs[0]?.at.slice(0, 10) ?? '', to: runs.at(-1)?.at.slice(0, 10) ?? '', perModel, ceiling: perModel.some(model => model.ceiling) }
}
function readRuns(file) {
  try { const info = fs.statSync(file); if (!info.isFile() || info.size > 2 * 1024 * 1024) return []; return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean).slice(-400) } catch { return [] }
}

function createInsideMap({ dataRoot, suiteRoot, environment = process.env, profiles = null, hide = () => false, now = Date.now } = {}) {
  if (typeof dataRoot !== 'string' || !dataRoot) throw new TypeError('The inside map needs her data folder')
  let cached = null, cachedAt = 0, cachedHidden = null
  const set = name => Boolean(String(environment[name] ?? '').trim())

  function build(hidden) {
    const groups = []
    const item = (group, id, title, kind, rows, ask) => {
      group.items.push({ id: `${group.id}:${slug(id)}`, title: clean(title, 80), kind, rows: rows.filter(row => row && row[1] !== undefined && row[1] !== '').slice(0, 6).map(([name, value]) => [clean(name, 14), clean(value, 110)]), ask: clean(ask, 200) })
    }
    const start = (id, title) => { const group = { id, title, items: [] }; groups.push(group); return group }

    const knights = start('knights', 'Her Knights')
    for (const [id, name, role] of KNIGHTS) item(knights, id, name, 'knight', [['role', role], ['state', 'part of her; works in the background']], `What does your Knight ${name} do, and when did you last use it?`)

    const brains = start('brains', 'Her brains')
    for (const id of ['qwen3-14b', 'qwen3.5-9b']) {
      let profile = null
      try { profile = profiles ? profiles(id) : null } catch {}
      if (!profile) continue
      const file = profile.modelStoreRoot && profile.relativePath ? path.join(profile.modelStoreRoot, profile.relativePath) : ''
      item(brains, id, profile.label || id, 'model', [['runs', 'on this PC'], ['context', `${Math.round((profile.defaultContext || 0) / 1024)}K tokens`], ['sees images', profile.visionProjector ? 'yes' : 'no'],
        ['file', file && isFile(file) ? 'on disk' : 'missing']], `Which model are you running on right now, and why?`)
    }
    const local = environment.LOCALAPPDATA || ''
    item(brains, 'helper', 'Helper model on the second graphics card', 'model', [['role', 'answers when the main model cannot'], ['state', local && isFile(path.join(local, 'NoriHelper', 'helper.pid')) ? 'set up' : 'not set up']], 'Is your helper model on the second graphics card running?')
    item(brains, 'claude', 'Claude (cloud)', 'cloud', [['key', set('ANTHROPIC_API_KEY') ? 'set' : 'not set'], ['used for', 'hard questions, checking her work, coaching']], 'Claude status')
    item(brains, 'openai', 'GPT (cloud)', 'cloud', [['key', set('OPENAI_API_KEY') ? 'set' : 'not set'], ['used for', 'when you ask for GPT by name']], 'Is OpenAI on, and how much has it cost today?')

    const systems = start('systems', 'Connected systems')
    const zapier = set('NORI_ZAPIER_TOKEN') || isFile(path.join(dataRoot, 'secrets', 'zapier-mcp-token.txt'))
    item(systems, 'zapier', 'Your apps through Zapier', 'connector', [['token', zapier ? 'saved' : 'not saved'], ['rule', 'reads run directly; anything that sends or changes asks you first']], 'What connected apps do you have through Zapier?')
    for (const [folder, title, ask] of [['hue', 'Lights (Hue)', 'What can you do with my lights?'], ['samsung-tv', 'TV (Samsung)', 'What can you do with my TV?'], ['location-private', 'Location', 'What do you know about where this PC is?'], ['mentor-connection', 'Mentor connection', 'What is your mentor connection for?']]) {
      if (isDir(path.join(dataRoot, folder))) item(systems, folder, title, 'device', [['state', 'set up on this PC']], ask)
    }
    if (suiteRoot) {
      for (const entry of names(path.join(suiteRoot, 'integrations')).filter(entry => entry.isDirectory()).slice(0, 20)) {
        item(systems, `integration-${entry.name}`, entry.name.replace(/-/g, ' '), 'integration', [['state', 'installed with her app']], `What can you do with your ${entry.name.replace(/-/g, ' ')} integration?`)
      }
    }
    if (local && isDir(path.join(local, 'NoriUltron'))) item(systems, 'hub', 'Shared memory hub', 'service', [['shared with', 'the other agents on this PC'], ['holds', 'technical notes only']], 'What is the shared memory hub and what is in it?')

    const score = scoreSummary(readRuns(path.join(dataRoot, 'learning', 'self-tests.jsonl')))
    if (score.runs) {
      const progress = start('progress', 'Her scoreboard')
      item(progress, 'all', 'Self-test scoreboard', 'score', [['runs', String(score.runs)], ['from', score.from], ['to', score.to], ['measures', 'the same fixed questions each run, checked by rule'],
        ['limit', score.ceiling ? 'a model has already scored full marks, so this test cannot show much more progress' : '']], 'How did your last self-test go, and what did you get wrong?')
      for (const model of score.perModel.slice(0, 8)) {
        item(progress, `model-${model.id}`, `${model.id} on the self-test`, 'score', [['latest', `${model.last} on ${model.day}${model.release ? ` (${model.release})` : ''}`], ['first run', model.runs > 1 ? model.first : ''], ['best', model.best],
          ['change', model.runs > 1 ? `${model.change > 0 ? '+' : ''}${model.change} since its first run, over ${model.runs} runs` : 'one run so far'], ['weak at', model.weak.join(', ') || 'nothing in the last run'],
          ['speed', model.seconds === null ? '' : `${model.seconds} s a question`]], `What do you keep getting wrong on your self-test with ${model.id}?`)
      }
    }

    const skills = start('skills', 'Installed skills')
    const registry = readJson(path.join(dataRoot, 'skills', 'registry.json'))
    const seen = new Set()
    for (const pack of Object.values(registry?.packages ?? {})) {
      for (const skill of Array.isArray(pack?.skills) ? pack.skills : []) {
        const name = clean(skill?.name ?? skill?.id, 60)
        if (!name || seen.has(name) || seen.size >= 60) continue
        seen.add(name)
        item(skills, name, name, 'skill', [['installed', clean(pack.installed_at, 10)], ['source', clean(pack.source_kind, 20).replace(/_/g, ' ')], ['runs code', pack.code_executed ? 'yes, with your approval' : 'no, instructions only']], `What does your ${name} skill do?`)
      }
    }

    const data = start('data', 'Her own files')
    for (const entry of names(dataRoot).filter(entry => entry.isDirectory() && !ENGINE.has(entry.name.toLowerCase())).slice(0, 30)) {
      if (entry.name.toLowerCase() === 'secrets') { item(data, 'secrets', 'secrets', 'folder', [['contents', 'not shown here, by design']], ''); continue }
      const size = measure(path.join(dataRoot, entry.name))
      item(data, entry.name, entry.name, 'folder', [['files', `${size.files}${size.capped ? ' or more' : ''}`], ['last change', day(size.newest)], ['where', hidden ? '' : path.join(dataRoot, entry.name)]], `What do you keep in your ${entry.name} folder?`)
    }

    const projects = start('projects', 'Projects she can work in')
    const roots = [...folderPaths(readJson(path.join(dataRoot, 'settings', 'worker-workspace.json'))), ...folderPaths(readJson(path.join(dataRoot, 'settings', 'coding-grants.json'))),
      path.join(dataRoot, 'development', 'self-code')]
    const listed = new Set()
    for (const root of roots) {
      const key = path.resolve(root).toLowerCase()
      if (listed.has(key) || listed.size >= 12 || !isDir(root)) continue
      listed.add(key)
      const top = names(root)
      item(projects, key, path.basename(root) || root, 'project', [['folders', String(top.filter(entry => entry.isDirectory()).length)], ['files at top', String(top.filter(entry => entry.isFile()).length)], ['where', hidden ? '' : root]],
        hidden ? '' : `What is in the project at ${root}, and what did you last do there?`)
    }

    let budget = MAX_ITEMS
    for (const group of groups) { group.items = group.items.slice(0, Math.max(0, budget)); budget -= group.items.length }
    return { schema: 'nori.inside-map.v1', at: now(), paths: hidden ? 'hidden' : 'shown', groups: groups.filter(group => group.items.length) }
  }

  return function insideMap() {
    let hidden = true
    try { hidden = Boolean(hide()) } catch {}
    // Folder counts are walked from disk: at most once every 20 seconds.
    if (!cached || hidden !== cachedHidden || now() - cachedAt > 20_000) { try { cached = build(hidden) } catch { cached = { schema: 'nori.inside-map.v1', at: now(), paths: hidden ? 'hidden' : 'shown', groups: [] } } cachedAt = now(); cachedHidden = hidden }
    return cached
  }
}

module.exports = { scoreSummary, createInsideMap, KNIGHTS, folderPaths }
