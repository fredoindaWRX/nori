import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appendProjectEvent, journalWorkflow, snapshotProjectHistory } from './project-workflow-journal.mjs'

const appRoot = resolve(import.meta.dirname, '..')
const projectRoot = resolve(appRoot, '../..')
const historyRoot = join(projectRoot, 'verification/project-history/test-input-manifests')

export function desktopTestSourceManifest(root) {
  const app = join(resolve(root), 'apps/desktop')
  const tests = readdirSync(join(app, 'tests'), { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.test\.(?:mjs|cjs)$/.test(entry.name))
    .map(entry => join(app, 'tests', entry.name))
    .sort()
  const paths = [join(app, 'package.json'), join(app, 'package-lock.json'), ...tests]
  // Bind the implementation as well as the tests. A green suite must not be
  // attributed to source edited while that suite was still running.
  const production = []
  const collect = directory => {
    if (!existsSync(directory)) return
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Linked desktop source is not a stable test input')
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Linked desktop source is not a stable test input')
      const path = join(directory, entry.name)
      if (entry.isDirectory()) collect(path)
      else if (entry.isFile() && /\.(?:mjs|cjs|js|ts|tsx|jsx|css|html|json|svg|ps1|py)$/.test(entry.name)) production.push(path)
    }
  }
  for (const directory of ['bridge', 'desktop', 'src', 'scripts']) collect(join(app, directory))
  paths.push(...production.sort())
  const files = paths.map(path => ({
    path: relative(resolve(root), path).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }))
  const sha256 = createHash('sha256').update(JSON.stringify(files)).digest('hex')
  return { schema: 'nori.desktop-test-source-manifest.v1', sha256, files }
}

export function parseNodeTestSummary(outputTail) {
  const value = name => {
    const match = new RegExp(`(?:ℹ\\s*)?${name}\\s+(\\d+)`, 'm').exec(outputTail)
    return match ? Number(match[1]) : null
  }
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']
    .map(name => [name, value(name)]))
}

function runNodeTests(testArgs) {
  return new Promise(resolveRun => {
    const child = spawn(process.execPath, testArgs, {
      cwd: appRoot, env: process.env, shell: false, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'],
    })
    let tail = ''
    let settled = false
    const capture = stream => stream.on('data', chunk => {
      process[stream === child.stdout ? 'stdout' : 'stderr'].write(chunk)
      tail = (tail + chunk.toString('utf8')).slice(-8192)
    })
    const finish = result => {
      if (settled) return
      settled = true
      resolveRun({ ...result, counts: parseNodeTestSummary(tail) })
    }
    capture(child.stdout)
    capture(child.stderr)
    child.once('error', () => finish({ status: null, signal: null, spawnError: true }))
    child.once('close', (status, signal) => finish({ status, signal, spawnError: false }))
  })
}

function persistManifest(manifest, runId, phase) {
  mkdirSync(historyRoot, { recursive: true })
  const path = join(historyRoot, `${runId}-${phase}.json`)
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return relative(projectRoot, path).replaceAll('\\', '/')
}

export async function runJournalledTests(testArgs) {
  if (!Array.isArray(testArgs) || !testArgs.length ||
      testArgs.some(argument => typeof argument !== 'string' || argument.includes('\0'))) {
    throw new Error('Pass the Node test-runner arguments after the script name')
  }

  const runId = randomUUID()
  const before = desktopTestSourceManifest(projectRoot)
  const beforePath = persistManifest(before, runId, 'start')
  let afterPath = beforePath
  let writeCount = 0
  let outcomeSummary = ''
  const journal = (root, kind, summary, evidence) => {
    writeCount++
    const phasePath = writeCount === 1 ? beforePath : afterPath
    return appendProjectEvent(root, kind, `${summary} suite_manifest_sha256=${before.sha256}${outcomeSummary}`,
      [...evidence, phasePath])
  }

  try {
    await journalWorkflow('test', 'desktop-tests', relative(projectRoot, import.meta.filename).replaceAll('\\', '/'), async () => {
      const result = await runNodeTests(testArgs)
      const after = desktopTestSourceManifest(projectRoot)
      afterPath = persistManifest(after, runId, 'end')
      outcomeSummary = ` tests=${result.counts.tests ?? 'unknown'} pass=${result.counts.pass ?? 'unknown'}` +
        ` fail=${result.counts.fail ?? 'unknown'} skipped=${result.counts.skipped ?? 'unknown'}`
      if (after.sha256 !== before.sha256) throw new Error('Desktop implementation, tests or dependency manifests changed during the run')
      if (result.spawnError || result.status !== 0) throw new Error('Desktop test runner returned a nonzero status')
      return { testSourceManifest: before.sha256, exitCode: result.status, counts: result.counts }
    }, { root: projectRoot, write: journal, seal: snapshotProjectHistory })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runJournalledTests(process.argv.slice(2))
}
