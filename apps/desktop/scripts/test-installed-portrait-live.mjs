import WebSocket from 'ws'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const id = `portrait-acceptance-${randomUUID()}`
const output = `C:/Nori/outputs/${id}.json`
const request = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : 'Create and show an original non-explicit fictional portrait of Nori: a clearly adult feminine AI avatar, fully clothed in an elegant dark jacket, luminous blue and cyan accents with subtle violet and magenta, natural facial proportions, warm expression, detailed cinematic lighting. Head-and-shoulders composition. Generate the actual image locally and save it; do not just describe it.'
if (!request.trim() || Buffer.byteLength(request) > 12000) throw new Error('Invalid bounded image test request')
const events = [], start = Date.now()
const archiveSha256 = createHash('sha256').update(readFileSync('C:/Program Files/Nori/resources/app.asar')).digest('hex')
const socket = new WebSocket('ws://127.0.0.1:18787/', { origin: 'http://127.0.0.1:15188' })
let sent = false, finished = false
function finish(status, detail) {
  if (finished) return
  finished = true
  clearTimeout(deadline)
  clearInterval(progress)
  writeFileSync(output, JSON.stringify({ id, request, status, detail, elapsedMs: Date.now() - start, archiveSha256, events }, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ status, detail, output, elapsedMs: Date.now() - start }))
  socket.close()
  setTimeout(() => socket.terminate(), 1000).unref()
  process.exitCode = status === 'reply-completed' ? 0 : 1
}
const deadline = setTimeout(() => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'interrupt', id }))
  finish('timeout', 'Portrait test exceeded five minutes; completion unverified')
}, 300000)
const progress = setInterval(() => console.log(JSON.stringify({ status: 'waiting', elapsedMs: Date.now() - start, events: events.length })), 20000)
socket.on('message', bytes => {
  let message
  try { message = JSON.parse(bytes) } catch { finish('error', 'Invalid bridge frame'); return }
  if (message.type === 'ready' && !sent) {
    sent = true
    socket.send(JSON.stringify({ type: 'ask', id, text: request }))
    console.log(JSON.stringify({ status: 'sent', id }))
    return
  }
  if (message.ask !== id) return
  if (['error', 'done', 'neural-event', 'workspace', 'tool-result'].includes(message.type)) {
    events.push(JSON.parse(JSON.stringify(message, (key, value) => typeof value === 'string' && value.startsWith('data:') ? '[inline media omitted]' : typeof value === 'string' ? value.slice(0, 6000) : value)))
    console.log(JSON.stringify({ type: message.type, keys: Object.keys(message), text: message.text?.slice(0, 500), error: message.message }))
  }
  if (message.type === 'done') finish('reply-completed', message.text)
  if (message.type === 'error') finish('error', message.message)
})
socket.on('error', error => finish('connection-error', error.message))
socket.on('close', () => finish('closed-before-completion', 'Bridge connection closed'))
