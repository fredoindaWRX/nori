import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { proposedInstalledModelModules } from './audit-installed-model-selection-patch.mjs'

const asar = createRequire(import.meta.url)('@electron/asar')
const stage = 'C:/Nori/.work/same-app-update'
const archive = 'C:/Program Files/Nori/resources/app.asar'
const next = join(stage, 'app.asar.next')
const workspace = join(stage, 'refresh-code-workspace')
const pending = join(stage, 'app.asar.pending')
const sha = value => createHash('sha256').update(value).digest('hex')
const receipt = JSON.parse(readFileSync(join(stage, 'receipt.json'), 'utf8'))
assert.equal(receipt.installed, false)
assert.equal(sha(readFileSync(archive)), receipt.beforeSha256)
assert.equal(sha(readFileSync(next)), receipt.afterSha256)
assert.ok(!existsSync(join(stage, 'previous')) && !existsSync(join(stage, 'installed-result.json')))
assert.ok(!existsSync(workspace) && !existsSync(pending))
assert.equal(realpathSync(stage).toLowerCase(), resolve(stage).toLowerCase())
let chat = proposedInstalledModelModules.chat
const oldGuard = '  const checkSonStatus = needsSonStatusFactCheck(messages)\n  const identityAnswer = groundedIdentityAnswer(messages)'
assert.equal(chat.split(oldGuard).length, 2)
chat = chat.replace('import { conversationProsePolicy }', 'import { conversationProsePolicy, messagesForCurrentIntent }')
  .replace(oldGuard, '  const factCheckMessages = messagesForCurrentIntent(messages, requestIntent)\n  const checkSonStatus = needsSonStatusFactCheck(factCheckMessages)\n  const identityAnswer = groundedIdentityAnswer(factCheckMessages)')
const changes = new Map([
  ['bridge/local-chat.mjs', Buffer.from(chat)],
  ['bridge/imported-chat-selection.mjs', Buffer.from(proposedInstalledModelModules.selection)],
  ['bridge/conversation-prose.mjs', asar.extractFile(next, 'bridge/conversation-prose.mjs')],
])
const catalogImport = "import { requestsInstalledSkillCatalog, installedSkillCatalogAnswer } from './skill-catalog-status.mjs'"
let query = asar.extractFile(next, 'bridge/nori-v2-query.mjs').toString()
if (!query.includes(catalogImport)) {
  const anchor = '        if (requestsInstructionSkillInstall(rawGoal)) {'
  assert.equal(query.split(anchor).length, 2)
  query = catalogImport + '\n' + query.replace(anchor,
    '        if (requestsInstalledSkillCatalog(rawGoal)) {\n'
    + '          const answer = installedSkillCatalogAnswer()\n'
    + '          remember(rawGoal, answer)\n'
    + "          yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: answer } } }\n"
    + "          yield { type: 'result', subtype: 'success', result: answer, total_cost_usd: 0 }\n"
    + '          continue\n        }\n' + anchor)
}
changes.set('bridge/nori-v2-query.mjs', Buffer.from(query))
changes.set('bridge/skill-catalog-status.mjs', readFileSync(new URL('../bridge/skill-catalog-status.mjs', import.meta.url)))
mkdirSync(workspace)
try {
  asar.extractAll(next, workspace)
  for (const [file, bytes] of changes) writeFileSync(join(workspace, file), bytes)
  const harness = join(workspace, '.acceptance')
  mkdirSync(harness)
  const tests = ['imported-chat-selection.test.mjs', 'managed-instruction-skills.test.mjs', 'skill-installer.test.cjs', 'skill-catalog-status.test.mjs', 'skill-installer-query.test.mjs']
  for (const test of tests) writeFileSync(join(harness, test), readFileSync(new URL(`../tests/${test}`, import.meta.url)))
  const tested = spawnSync(process.execPath, ['--test', ...tests.map(test => join(harness, test))],
    { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 })
  writeFileSync(join(stage, 'model-update-tests.log'), `${tested.stdout || ''}${tested.stderr || ''}`)
  assert.equal(tested.status, 0, tested.stdout || tested.stderr)
  rmSync(harness, { recursive: true })
  await asar.createPackage(workspace, pending)
  const oldEntries = new Set(asar.listPackage(archive))
  const newEntries = asar.listPackage(pending)
  assert.deepEqual(newEntries.filter(entry => !oldEntries.has(entry)).map(entry => entry.replace(/^[/\\]/, '').replaceAll('\\', '/')),
    ['bridge/skill-catalog-status.mjs'])
  assert.ok([...oldEntries].every(entry => newEntries.includes(entry)), 'Existing package entries must be preserved')
  let verified = 0
  const changed = []
  for (const entry of newEntries) {
    const file = entry.replace(/^[/\\]/, '')
    if (asar.statFile(pending, file).files) continue
    verified++
    const bytes = asar.extractFile(pending, file)
    if (!oldEntries.has(entry) || !bytes.equals(asar.extractFile(archive, file))) {
      const normalized = file.replaceAll('\\', '/')
      assert.ok(changes.has(normalized), `Unexpected changed module: ${normalized}`)
      assert.equal(sha(bytes), sha(changes.get(normalized)))
      changed.push(normalized)
    }
  }
  assert.deepEqual(changed.sort(), [...changes.keys()].sort())
  assert.equal(sha(readFileSync(archive)), receipt.beforeSha256)
  const plan = JSON.parse(readFileSync(join(stage, 'update-plan.json'), 'utf8'))
  plan.updates = [{ ...plan.updates[0], after: sha(readFileSync(pending)) }]
  for (const [file, bytes] of changes) {
    const name = file.split('/').at(-1)
    const target = `C:/Program Files/Nori/resources/NoriSuite/apps/desktop/${file}`
    const source = join(stage, `mirror-${name}`)
    writeFileSync(source, bytes)
    plan.updates.push({ target, source, before: existsSync(target) ? sha(readFileSync(target)) : null, after: sha(bytes) })
  }
  let updater = readFileSync(join(stage, 'apply-update.ps1'), 'utf8')
  assert.match(updater, /Count-ne (?:3|4|6)/)
  assert.equal(plan.updates.length, 6)
  updater = updater.replace(/Count-ne (?:3|4|6)/, 'Count-ne 6').replaceAll(/filesVerified=(?:3|4|6)/g, 'filesVerified=6')
  renameSync(pending, next)
  writeFileSync(join(stage, 'update-plan.json'), JSON.stringify(plan, null, 2))
  writeFileSync(join(stage, 'apply-update.ps1'), updater)
  writeFileSync(join(stage, 'receipt.json'), JSON.stringify({ ...receipt,
    afterSha256: plan.updates[0].after, changedFiles: changed, verifiedFiles: verified,
    testExitCode: tested.status, installed: false, updateFiles: plan.updates.length }, null, 2))
  console.log(readFileSync(join(stage, 'receipt.json'), 'utf8'))
} finally {
  assert.equal(realpathSync(workspace).toLowerCase(), resolve(stage, 'refresh-code-workspace').toLowerCase())
  rmSync(workspace, { recursive: true })
}
