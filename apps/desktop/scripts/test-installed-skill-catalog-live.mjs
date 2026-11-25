import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { managedInstructionCatalog } from '../bridge/managed-instruction-skills.mjs'

const stage = 'C:/Nori/.work/same-app-update'
const output = process.argv[2] || `${stage}/skill-catalog-live-tests.json`
const receipt = JSON.parse(readFileSync(`${stage}/receipt.json`, 'utf8'))
const hash = value => createHash('sha256').update(value).digest('hex')
const archiveHash = hash(readFileSync(receipt.canonicalArchive))
assert.equal(archiveHash, receipt.afterSha256, 'Expected update must be installed before live testing')
const store = 'C:/Users/Studio/AppData/Local/Nori/skills'
const registry = `${store}/registry.json`
const registryBefore = hash(readFileSync(registry))
const expected = managedInstructionCatalog(store).map(skill => skill.name)
assert.ok(expected.length > 0, 'A verified live catalog is required')
const results = []
for (const text of ['Do you like the new packages I installed for you?', 'What skills do you have installed?']) {
  const row = await new Promise(resolve => {
    const socket = new WebSocket('ws://127.0.0.1:18787/', { origin: 'http://127.0.0.1:15188' })
    const id = `catalog-acceptance-${randomUUID()}`, started = Date.now()
    let sent = false, finished = false
    const finish = result => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.close()
      resolve({ request: text, elapsedMs: Date.now() - started, ...result })
    }
    const timer = setTimeout(() => finish({ status: 'timeout' }), 30000)
    socket.on('message', raw => {
      let message
      try { message = JSON.parse(raw) } catch { finish({ status: 'invalid-message' }); return }
      if (message.type === 'ready' && !sent) { sent = true; socket.send(JSON.stringify({ type: 'ask', id, text })); return }
      if (message.ask !== id) return
      if (message.type === 'done') finish({ status: 'reply-completed', reply: message.text })
      if (message.type === 'error') finish({ status: 'error', error: message.message })
    })
    socket.on('error', error => finish({ status: 'connection-error', error: error.message }))
    socket.on('close', () => finish({ status: 'closed-before-completion' }))
  })
  results.push(row)
  if (row.status !== 'reply-completed') break
  assert.ok(expected.every(name => row.reply.includes(name)), 'Reply must contain every actual installed skill')
  assert.match(row.reply, new RegExp(`${expected.length} verified skills`))
  assert.match(row.reply, /code execution is disabled/)
  assert.match(row.reply, /does not inspect system pip\/npm/)
  assert.doesNotMatch(row.reply, /I (?:can't|cannot|don't have).*access.*files/i)
}
assert.equal(hash(readFileSync(registry)), registryBefore, 'Live test must preserve the skill registry')
const passed = results.length === 2 && results.every(row => row.status === 'reply-completed')
writeFileSync(output, JSON.stringify({ passed, installedArchiveSha256: archiveHash,
  expectedSkillNames: expected, registryUnchanged: true, source: 'installed loopback desktop bridge', results }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ passed, results: results.map(({ request, elapsedMs, status }) => ({ request, elapsedMs, status })),
  expectedSkillCount: expected.length, registryUnchanged: true }, null, 2))
if (!passed) process.exitCode = 1
