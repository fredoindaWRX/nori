import WebSocket from 'ws'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { evaluateResearchAcceptance } from './research-acceptance-evidence.mjs'

// Fail before submitting work if this exact combined repair is not installed.
const stage = 'C:/Nori/.work/research-repair'
const plan = JSON.parse(readFileSync(stage + '/combined-plan.json', 'utf8'))
for (const file of plan.updates) {
  if (createHash('sha256').update(readFileSync(file.target)).digest('hex') !== file.after) {
    throw Error('The reviewed combined repair is not installed; no research task was submitted.')
  }
}
const requestedId = process.argv[2]
if (requestedId !== undefined && !/^[a-f0-9]{32}$/.test(requestedId)) throw Error('Exact existing task ID required')
async function submit() {
  const socket = new WebSocket('ws://127.0.0.1:18787/', { origin: 'http://127.0.0.1:15188' })
  const id = 'research-acceptance-' + randomUUID()
  try {
    return await new Promise((resolve, reject) => {
      let sent = false
      const timer = setTimeout(() => reject(Error('Chat acknowledgement timed out; no automatic resubmission.')), 30000)
      const finish = (error, taskId) => { clearTimeout(timer); error ? reject(error) : resolve(taskId) }
      socket.on('error', error => finish(error))
      socket.on('message', raw => {
        const event = JSON.parse(raw)
        if (event.type === 'ready' && !sent) {
          sent = true
          socket.send(JSON.stringify({ type: 'ask', id, text: 'Research official Python documentation. Read https://docs.python.org/3/ and give a brief cited beginner recommendation. Use only docs.python.org and www.python.org for page reads. Do not retain this test in research memory using at most 1 page.' }))
        }
        if (event.ask !== id) return
        if (event.type === 'error') finish(Error(event.message))
        if (event.type === 'done') {
          const taskId = event.text?.match(/Task:\s*([a-f0-9]{32})\b/)?.[1]
          if (!taskId) finish(Error('No native research task ID was returned; completion is not established.'))
          else finish(null, taskId)
        }
      })
    })
  } finally { socket.close(); setTimeout(() => socket.terminate(), 1000).unref() }
}
const taskId = requestedId || await submit()
console.log(JSON.stringify({ phase: 'observing-specific-task', taskId, submitted: !requestedId }))
const started = Date.now()
let result = { passed: false, status: 'pending' }
while (Date.now() - started < 180000) {
  const state = JSON.parse(readFileSync(`C:/Users/Studio/AppData/Local/Nori/state/core/work-sessions/${taskId}.json`, 'utf8'))
  result = evaluateResearchAcceptance(state, { taskId })
  if (result.status !== 'pending') break
  await delay(1000)
}
if (result.status === 'pending') result = { passed: false, status: 'observation-timeout', resumeWithTaskId: taskId }
const output = `C:/Nori/.work/reports/installed-research-acceptance-${randomUUID()}.json`
writeFileSync(output, JSON.stringify({ ...result, taskId, elapsedMs: Date.now() - started,
  scope: 'installed native task state, completed execution receipts and citation-scope checks', automaticReplay: false }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ ...result, output }))
if (!result.passed) process.exitCode = 1

