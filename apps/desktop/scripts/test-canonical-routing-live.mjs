import WebSocket from 'ws'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const stage = 'C:/Nori/.work/same-app-update'
const receipt = JSON.parse(readFileSync(`${stage}/receipt.json`, 'utf8'))
const actual = createHash('sha256').update(readFileSync(receipt.canonicalArchive)).digest('hex')
if (actual !== receipt.afterSha256) {
  console.error(JSON.stringify({ status: 'not-installed', expected: receipt.afterSha256,
    actual, promptsSent: 0, modelStarted: false }))
  process.exit(2)
}
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ status: 'archive-matches', archiveSha256: actual, promptsSent: 0 }))
  process.exit(0)
}
const results = []
function save() {
  writeFileSync(`${stage}/live-tests.json`, JSON.stringify({ archiveSha256: actual,
    evidenceScope: 'bridge replies; completion alone does not prove tool execution',
    syntheticRequests: true, screenCaptured: false, results }, null, 2))
}
async function run(name, text) {
  return new Promise(resolve => {
    const socket = new WebSocket('ws://127.0.0.1:18787/', { origin: 'http://127.0.0.1:15188' })
    const id = `canonical-${name}-${randomUUID()}`
    const started = Date.now()
    let sent = false, finished = false, firstTextMs = null, readyMetadata = null
    const events = new Set()
    const announcedTools = new Set()
    const finish = result => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.close()
      const row = { name, id, elapsedMs: Date.now() - started, firstTextMs,
        readyMetadata, eventTypes: [...events], announcedTools: [...announcedTools], ...result }
      results.push(row)
      save()
      console.log(JSON.stringify(row))
      resolve(row)
    }
    const timer = setTimeout(() => finish({ status: 'observation-timeout' }), 180000)
    socket.on('message', raw => {
      let message
      try { message = JSON.parse(raw) } catch {
        finish({ status: 'invalid-bridge-message' }); return
      }
      if (message.type === 'ready' && !sent) {
        readyMetadata = { model: message.model, effort: message.effort }
        sent = true
        socket.send(JSON.stringify({ type: 'ask', id, text }))
        return
      }
      if (message.ask !== id) return
      events.add(message.type)
      // Tool badges are announcements, not independently verified receipts.
      if (message.type === 'tool' && typeof message.name === 'string') {
        announcedTools.add(message.name.slice(0, 128))
      }
      if (firstTextMs === null && message.type === 'text') firstTextMs = Date.now() - started
      if (message.type === 'error') finish({ status: 'error', error: message.message })
      if (message.type === 'done') finish({ status: 'reply-completed', reply: message.text,
        toolExecutionVerified: false })
    })
    socket.on('close', () => finish({ status: 'connection-closed-before-completion' }))
    socket.on('error', error => finish({ status: 'connection-error', error: error.message }))
  })
}
for (const [name, text] of [
  ['source-read', 'Check your code and make sure this is all working for you. Perform a bounded read-only inspection of your chat and tool routing; do not edit files or run shell commands. Report the files you actually read and any limits.'],
  ['web-search', 'Search the web for the official Python beginner tutorial. Read https://docs.python.org/3/tutorial/ and tell me in two sentences where a beginner should start, with a source link. Use read-only research tools; do not install or modify anything.'],
]) {
  const result = await run(name, text)
  if (result.status !== 'reply-completed') { process.exitCode = 1; break }
}
