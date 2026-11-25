'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createInsideMap, KNIGHTS, folderPaths } = require('../desktop/inside-map.cjs')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-inside-')), data = path.join(root, 'data'), suite = path.join(root, 'suite'), project = path.join(root, 'project')
  for (const dir of ['learning', 'settings', 'skills', 'secrets', 'Cache', 'GPUCache', 'hue', 'development/self-code']) fs.mkdirSync(path.join(data, dir), { recursive: true })
  for (const dir of ['integrations/image-generation', 'integrations/aider']) fs.mkdirSync(path.join(suite, dir), { recursive: true })
  fs.mkdirSync(path.join(project, 'src'), { recursive: true }); fs.writeFileSync(path.join(project, 'readme.md'), 'x')
  fs.writeFileSync(path.join(data, 'learning', 'a.jsonl'), 'one'); fs.writeFileSync(path.join(data, 'learning', 'b.json'), 'two')
  fs.writeFileSync(path.join(data, 'secrets', 'zapier-mcp-token.txt'), 'TOKEN-VALUE-THAT-MUST-NEVER-APPEAR')
  fs.writeFileSync(path.join(data, 'secrets', 'other.txt'), 'PRIVATE-FILE-NAME-CONTENT')
  fs.writeFileSync(path.join(data, 'settings', 'worker-workspace.json'), JSON.stringify({ workspace: project }))
  fs.writeFileSync(path.join(data, 'skills', 'registry.json'), JSON.stringify({ schema: 1, packages: { p1: { installed_at: '2026-11-16T10:00:00Z', source_kind: 'local_zip', code_executed: false, skills: [{ name: 'movie-riff-night' }, { name: 'repo-cleanup' }] } } }))
  return { root, data, suite, project }
}
const profiles = id => ({ 'qwen3-14b': { label: 'Huihui Qwen3 14B abliterated', defaultContext: 32768, modelStoreRoot: 'C:/nowhere', relativePath: 'x.gguf' },
  'qwen3.5-9b': { label: 'Huihui Qwen3.5 9B abliterated', defaultContext: 196608, visionProjector: {}, modelStoreRoot: 'C:/nowhere', relativePath: 'y.gguf' } })[id]
const group = (map, id) => map.groups.find(g => g.id === id)
const titles = g => g.items.map(item => item.title)

test('the map lists her Knights, brains, systems, skills, folders and projects with facts only', () => {
  const f = fixture()
  const map = createInsideMap({ dataRoot: f.data, suiteRoot: f.suite, profiles, environment: { ANTHROPIC_API_KEY: 'sk-secret-value', LOCALAPPDATA: f.root }, hide: () => false })()
  assert.equal(map.schema, 'nori.inside-map.v1'); assert.equal(map.paths, 'shown')
  assert.equal(group(map, 'knights').items.length, 12)
  assert.deepEqual(titles(group(map, 'brains')), ['Huihui Qwen3 14B abliterated', 'Huihui Qwen3.5 9B abliterated', 'Helper model on the second graphics card', 'Claude (cloud)', 'GPT (cloud)'])
  const rows = Object.fromEntries(group(map, 'brains').items.map(item => [item.title, Object.fromEntries(item.rows)]))
  assert.equal(rows['Claude (cloud)'].key, 'set'); assert.equal(rows['GPT (cloud)'].key, 'not set')
  assert.equal(rows['Huihui Qwen3 14B abliterated'].context, '32K tokens'); assert.equal(rows['Huihui Qwen3.5 9B abliterated']['sees images'], 'yes')
  assert.deepEqual(titles(group(map, 'systems')), ['Your apps through Zapier', 'Lights (Hue)', 'aider', 'image generation'])
  assert.equal(Object.fromEntries(group(map, 'systems').items[0].rows).token, 'saved')
  assert.deepEqual(titles(group(map, 'skills')), ['movie-riff-night', 'repo-cleanup'])
  // Her own folders: the browser engine's caches are left out, secrets is named but never looked into.
  assert.deepEqual(titles(group(map, 'data')).sort(), ['development', 'hue', 'learning', 'secrets', 'settings', 'skills'])
  const learning = Object.fromEntries(group(map, 'data').items.find(item => item.title === 'learning').rows)
  assert.equal(learning.files, '2'); assert.match(learning['last change'], /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(group(map, 'data').items.find(item => item.title === 'secrets').rows, [['contents', 'not shown here, by design']])
  assert.deepEqual(titles(group(map, 'projects')).sort(), ['project', 'self-code'])
  const text = JSON.stringify(map)
  for (const secret of ['TOKEN-VALUE', 'PRIVATE-FILE-NAME', 'sk-secret-value', 'other.txt']) assert.ok(!text.includes(secret), secret)
  for (const item of map.groups.flatMap(g => g.items)) { assert.match(item.id, /^[a-z]+:[a-z0-9-]+$/); assert.ok(item.rows.length <= 6) }
})

test('while streaming, folder and project paths are left out and projects cannot be asked about by path', () => {
  const f = fixture()
  const shown = JSON.stringify(createInsideMap({ dataRoot: f.data, suiteRoot: f.suite, profiles, environment: {}, hide: () => false })())
  assert.ok(shown.includes(JSON.stringify(f.project).slice(1, -1)))
  const map = createInsideMap({ dataRoot: f.data, suiteRoot: f.suite, profiles, environment: {}, hide: () => true })()
  assert.equal(map.paths, 'hidden')
  const hidden = JSON.stringify(map)
  assert.ok(!hidden.includes(JSON.stringify(f.root).slice(1, -1)), 'no path under the test root is sent while hidden')
  assert.ok(group(map, 'projects').items.every(item => item.ask === ''))
  // A hide() that throws counts as hidden.
  assert.equal(createInsideMap({ dataRoot: f.data, environment: {}, hide: () => { throw new Error('x') } })().paths, 'hidden')
})

test('a missing data folder gives an empty-but-valid map, results are cached briefly, and helpers are bounded', () => {
  let clock = 1000, hide = false
  const map = createInsideMap({ dataRoot: path.join(os.tmpdir(), 'nori-inside-missing-' + process.pid), environment: {}, hide: () => hide, now: () => clock })
  const first = map()
  assert.equal(first.schema, 'nori.inside-map.v1'); assert.ok(first.groups.some(g => g.id === 'knights'))
  assert.equal(map(), first, 'same object within the cache window')
  clock += 25_000; assert.notEqual(map(), first)
  hide = true; assert.equal(map().paths, 'hidden')
  assert.throws(() => createInsideMap({}), /data folder/)
  assert.deepEqual(folderPaths({ a: 'C:\\Projects\\One', b: ['D:/Two', 'relative/path', 7], c: { d: 'C:\\Projects\\One' } }), ['C:\\Projects\\One', 'D:/Two'])
  assert.equal(folderPaths(Array.from({ length: 40 }, (_, i) => `C:\\p${i}`)).length, 12)
})

test('the Knight list matches the bridge, and the face server serves the map', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '../bridge/knights.mjs'), 'utf8')
  for (const [id, name, role] of KNIGHTS) assert.ok(bridge.includes(`{ id: '${id}', name: '${name}', role: '${role}'`), id)
  assert.equal(KNIGHTS.length, (bridge.match(/\{ id: '/g) || []).length)
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8')
  assert.match(main, /=== '\/inside-map'\) \{\s+response\.setHeader\('content-type', 'application\/json'\)\s+response\.setHeader\('cache-control', 'no-store'\)\s+response\.end\(JSON\.stringify\(insideMap\(\)\)\)/)
  const made = main.slice(main.indexOf('const insideMap = createInsideMap({'), main.indexOf('const insideMap = createInsideMap({') + 320)
  assert.ok(made.includes('dataRoot: USER_DATA_ROOT, suiteRoot: SUITE_ROOT,'))
  assert.ok(made.includes('hide: () => Boolean(streamMode?.obsRunning) })'), 'paths are hidden while OBS runs, like memory titles')
})

test('her scoreboard: per model latest, change and weak spots come from her saved self-test runs', () => {
  const { scoreSummary } = require('../desktop/inside-map.cjs')
  const run = (at, model, pass, byCat) => ({ at, models: [model], pass, total: 36, release: 'R1', avgSeconds: 1.2, byCat })
  const s = scoreSummary([run('2026-11-09T00:00:00Z', 'big', 35), run('2026-11-07T00:00:00Z', 'small', 30), run('2026-11-17T00:00:00Z', 'small', 32, { reason: { pass: 1, total: 3 }, math: { pass: 4, total: 4 } }),
    run('2026-11-14T00:00:00Z', 'big', 36), { junk: true }, null])
  assert.equal(s.runs, 4); assert.equal(s.from, '2026-11-07'); assert.equal(s.to, '2026-11-17'); assert.equal(s.ceiling, true)
  const small = s.perModel.find(model => model.id === 'small')
  assert.deepEqual([small.last, small.first, small.best, small.change, small.runs], ['32/36', '30/36', '32/36', 2, 2]); assert.deepEqual(small.weak, ['reason 1/3'])
  assert.equal(s.perModel[0].id, 'small', 'most recently tested first')
  assert.deepEqual(scoreSummary('nonsense'), { runs: 0, from: '', to: '', perModel: [], ceiling: false })
  const f = fixture()
  fs.writeFileSync(path.join(f.data, 'learning', 'self-tests.jsonl'), [JSON.stringify(run('2026-11-07T00:00:00Z', 'small', 30)), 'not json', JSON.stringify(run('2026-11-17T00:00:00Z', 'small', 32))].join('\r\n'))
  const progress = group(createInsideMap({ dataRoot: f.data, environment: {}, hide: () => false })(), 'progress')
  assert.deepEqual(titles(progress), ['Self-test scoreboard', 'small on the self-test'])
  assert.equal(Object.fromEntries(progress.items[1].rows).change, '+2 since its first run, over 2 runs')
  assert.equal(group(createInsideMap({ dataRoot: path.join(f.root, 'none'), environment: {}, hide: () => false })(), 'progress'), undefined)
})
