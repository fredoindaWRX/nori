import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { win32 as path } from 'node:path'
import vm from 'node:vm'

const script = readFileSync(new URL('../scripts/prepare-computer-control-update.mjs', import.meta.url), 'utf8')
const manifest = readFileSync(new URL('../../../skills/nori-rea/skill.json', import.meta.url))
const installer = readFileSync(new URL('../../../verification/vector-canvas-update.iss', import.meta.url), 'utf8')
const pin = '40cd7ee4dc0710cba25cc024626bcb1d1ba32765f04871fec99383504bfbd179'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const newBridge = ['artcraft-tools.mjs', 'image-intent.mjs', 'rea-tools.mjs']
const bridgeFiles = [...script.match(/const bridgeFiles=\[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(match => match[1])
const archiveFiles = ['desktop/main.cjs', 'desktop/workspace-preload.cjs', 'desktop/computer-host.cjs',
  'bridge/server.mjs', ...bridgeFiles.map(name => 'bridge/' + name)]
const root = 'C:\\fixture\\Nori'
const app = path.join(root, 'apps/desktop')
const installed = 'C:\\Program Files\\Nori'
const rollbackName = 'computer-control-routing-closure-rollback'
const rollback = path.join(root, 'verification', rollbackName)
const key = value => path.resolve(value).toLowerCase()
const bytesFor = relative => Buffer.from(`synthetic source: ${relative}`)

// Evaluate the unchanged updater body against an entirely in-memory host.
// No installer, process census, archive extraction, directory creation, or
// installed-file reads/writes actually occur in these tests.
function simulate({ tampered = false, priorRollback = false, extraArchive = false, existingData = false } = {}) {
  const files = new Map()
  const reads = [], mutations = [], output = []
  const shell = path.join(root, 'verification/routing-closure-shell-refresh/win-unpacked')
  for (const relative of archiveFiles) files.set(key(path.join(app, relative)), bytesFor(relative))
  for (const relative of ['Nori.exe', 'resources/app.asar']) files.set(key(path.join(shell, relative)), bytesFor(relative))
  for (const name of bridgeFiles) files.set(key(path.join(installed, 'resources/NoriSuite/apps/desktop/bridge', name)), Buffer.from(`old ${name}`))
  for (const relative of ['Nori.exe', 'resources/app.asar']) files.set(key(path.join(installed, relative)), Buffer.from(`old ${relative}`))
  files.set(key(path.join(root, 'skills/nori-rea/skill.json')), tampered ? Buffer.concat([manifest, Buffer.from(' ')]) : manifest)
  if (existingData) files.set(key(path.join(installed, 'resources/NoriSuite/skills/nori-rea/skill.json')), Buffer.from('old reference data'))
  const directories = new Set(priorRollback ? [key(rollback)] : [])
  const read = file => {
    reads.push(key(file))
    if (!files.has(key(file))) throw Error('Unexpected fixture read: ' + file)
    return files.get(key(file))
  }
  const context = {
    Buffer, createHash, join: path.join, dirname: path.dirname, resolve: path.resolve, sep: path.sep,
    readFileSync: read, existsSync: file => files.has(key(file)) || directories.has(key(file)),
    realpathSync: file => path.resolve(file),
    mkdirSync: file => { mutations.push(['mkdir', key(file)]); directories.add(key(file)) },
    copyFileSync: (source, destination) => { mutations.push(['copy', key(destination)]); files.set(key(destination), Buffer.from(read(source))) },
    writeFileSync: (file, content, options) => {
      assert.equal(options?.flag, 'wx')
      assert.equal(files.has(key(file)), false)
      mutations.push(['write', key(file)]); files.set(key(file), Buffer.from(content))
    },
    execFileSync: () => '0',
    extractFile: (archive, relative) => {
      relative = relative.replaceAll('\\', '/')
      const before = key(archive) === key(path.join(installed, 'resources/app.asar'))
      if (relative === 'bridge/unapproved.mjs') return before ? Buffer.from('old') : Buffer.from('new')
      return before && newBridge.some(name => relative === 'bridge/' + name) ? Buffer.from('old ' + relative) : bytesFor(relative)
    },
    listPackage: () => [...archiveFiles, ...(extraArchive ? ['bridge/unapproved.mjs'] : [])].map(name => '/' + name),
    statFile: () => ({}),
    process: { argv: ['node', 'prepare.mjs', rollbackName], env: { SystemRoot: 'C:\\Windows' }, platform: 'win32' },
    console: { log: value => output.push(value) },
  }
  const body = script.replace(/^import .*\r?\n/gm, '')
    .replace(/^const \{extractFile,listPackage,statFile\}=createRequire[^\r\n]*\r?\n/m, '')
    .replaceAll('import.meta.dirname', JSON.stringify(path.join(app, 'scripts')))
  let error
  try { vm.runInNewContext(body, context, { timeout: 1000 }) } catch (caught) { error = caught }
  const receiptBytes = files.get(key(path.join(rollback, 'prepared.json')))
  return { error, mutations, reads, files, output, receipt: receiptBytes && JSON.parse(receiptBytes) }
}

test('maintenance update contains the three router modules and only one pinned data addition', () => {
  for (const name of newBridge) assert.equal(bridgeFiles.filter(value => value === name).length, 1)
  assert.equal(bridgeFiles.length, 18, '15 previous bridge modules plus three routing modules')
  const run = simulate()
  assert.equal(run.error, undefined)
  assert.equal(run.receipt.updates.length, 21)
  assert.deepEqual(run.receipt.changedArchiveFiles.sort(), newBridge.map(name => 'bridge/' + name).sort())
  const data = run.receipt.updates.filter(item => item.relative.includes('/skills/'))
  assert.equal(data.length, 1)
  assert.equal(data[0].relative, 'resources/NoriSuite/skills/nori-rea/skill.json')
  assert.equal(data[0].sha256, pin)
  assert.equal(data[0].bytes, 1425)
  assert.equal(data[0].beforeSha256, null, 'new data has no fabricated prior version')
  assert.equal(run.receipt.installed, false)
  assert.equal(run.receipt.uiVerified, false)
  assert.equal(run.receipt.modelsCopied, 0)
})

test('existing files and existing reference data retain verified rollback bytes and hashes', () => {
  const run = simulate({ existingData: true })
  assert.equal(run.error, undefined)
  for (const item of run.receipt.updates) {
    assert.equal(item.beforeSha256, hash(run.files.get(key(path.join(installed, item.relative)))))
    assert.equal(hash(run.files.get(key(path.join(rollback, item.relative)))), item.beforeSha256)
  }
})

test('tampered pinned reference fails before any rollback directory or receipt write', () => {
  const run = simulate({ tampered: true })
  assert.match(run.error?.message || '', /Pinned reference data mismatch/)
  assert.deepEqual(run.mutations, [])
  assert.equal(run.receipt, undefined)
})

test('existing rollback and unapproved archive changes are preserved and rejected without writes', () => {
  for (const [options, message] of [[{ priorRollback: true }, /rollback already exists/],
    [{ extraArchive: true }, /Unexpected archive update: bridge\/unapproved\.mjs/]]) {
    const run = simulate(options)
    assert.match(run.error?.message || '', message)
    assert.deepEqual(run.mutations, [])
  }
})

test('ISS matches the narrow updater file set with no recursive skill copy', () => {
  const entries = [...installer.matchAll(/^Source: "([^"]+)"; DestDir: "([^"]+)"; Flags: ([^\r\n]+)/gm)]
  assert.equal(entries.length, 21)
  assert.equal(entries[0][1], 'routing-closure-shell-refresh\\win-unpacked\\Nori.exe')
  assert.equal(entries[1][1], 'routing-closure-shell-refresh\\win-unpacked\\resources\\app.asar')
  assert.doesNotMatch(script + installer, /tool-routing-shell-refresh/)
  for (const name of newBridge) assert.equal(entries.filter(([, source, destination]) =>
    source === `..\\apps\\desktop\\bridge\\${name}` && destination === '{app}\\resources\\NoriSuite\\apps\\desktop\\bridge').length, 1)
  const skillEntries = entries.filter(([, source]) => source.includes('\\skills\\'))
  assert.equal(skillEntries.length, 1)
  assert.equal(skillEntries[0][1], '..\\skills\\nori-rea\\skill.json')
  assert.equal(skillEntries[0][2], '{app}\\resources\\NoriSuite\\skills\\nori-rea')
  for (const [, source, , flags] of entries) {
    assert.doesNotMatch(source, /\*/)
    assert.doesNotMatch(flags, /recursesubdirs|createallsubdirs/i)
  }
})
