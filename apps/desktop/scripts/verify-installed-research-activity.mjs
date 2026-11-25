import WebSocket from 'ws'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'


// Fail before submitting work if this exact combined repair is not installed.
const stage = 'C:/Nori/.work/name-memory-promote'
const plan = JSON.parse(readFileSync(stage + '/promotion-plan.json', 'utf8'))
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
          socket.send(JSON.stringify({ type: 'ask', id, text: 'Research official Python documentation. Read https://docs.python.org/3/ and give a brief cited beginner recommendation. Use only docs.python.org and www.python.org for page reads. Do not retain this test in research memory.' }))
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
console.log(JSON.stringify({ phase: 'observing-specific-task', taskId, submitted: !requestedId }));writeFileSync('C:/Nori/.work/research-installed-current/active-task.json',JSON.stringify({taskId,submitted:!requestedId}),{flag:requestedId?'w':'wx'})
const started = Date.now()
let result = { passed: false, status: 'pending' }
while (Date.now() - started < 180000) {
  const response = await fetch('http://127.0.0.1:18787/work-activity', {headers:{origin:'http://127.0.0.1:15188'},signal:AbortSignal.timeout(15000)})
  if(!response.ok) throw Error('Installed activity endpoint unavailable; retain task ID, do not resubmit.')
  const body=await response.json(),state=body.tasks?.find(t=>t.id===taskId)
  if(!state){result={passed:false,status:'pending',reason:'Task not yet visible in bounded activity list'}}
  else if(!['completed','failed','blocked','cancelled','interrupted'].includes(state.status)){result={passed:false,status:'pending',taskStatus:state.status}}
  else {
    const links=[...state.response.matchAll(/https:\/\/[^\s)\]<>"']+/g)].map(m=>m[0])
    const citedOfficial=links.length>0&&links.every(u=>{try{return ['docs.python.org','www.python.org'].includes(new URL(u).hostname)}catch{return false}})
    result={passed:state.status==='completed'&&citedOfficial,status:state.status,response:state.response,events:state.events,citedOfficial,limitation:'Activity projection does not expose raw execution receipts; this checks live completion and visible citations only.'}
  }
  if (result.status !== 'pending') break
  await delay(1000)
}
if (result.status === 'pending') result = { passed: false, status: 'observation-timeout', resumeWithTaskId: taskId }
const output = `C:/Nori/.work/reports/installed-research-acceptance-${randomUUID()}.json`
writeFileSync(output, JSON.stringify({ ...result, taskId, elapsedMs: Date.now() - started,
  scope: 'installed native Activity API; task completion and visible citations; raw execution receipts not available', automaticReplay: false }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ ...result, output }))
if (!result.passed) process.exitCode = 1
