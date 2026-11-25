const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const sourcePath = process.env.NORI_PHONE_CLIENT_SOURCE || [join(__dirname, '../desktop/remote-control-service.cjs'), join(__dirname, '../../apps/desktop/desktop/remote-control-service.cjs')].find(existsSync)
const source = readFileSync(sourcePath, 'utf8')
const match = source.match(/<script>\r?\n([\s\S]*?)(?:const activityPanel=|\(\$\{installMobileTaskActivity\.toString\(\)\}\))/)
assert.ok(match, 'phone client script boundary exists')
const script = match[1].replace(/\r?\nfetchConversation\(\);\r?\n/, '\n')
function client() {
 const elements = new Map()
 const node = () => ({ value: '', disabled: false, textContent: '', style: {}, scrollHeight: 100, clientHeight: 100, scrollTop: 0, addEventListener() {}, classList: { add() {}, remove() {} } })
 const context = { document: { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, node()); return elements.get(selector) } }, AbortSignal, AbortController, innerHeight: 844, setTimeout() { return 1 }, clearTimeout() {}, fetch: async () => response([]) }
 vm.createContext(context)
 vm.runInContext(script + '\nrender=()=>{};', context)
 return { context, elements, run: code => vm.runInContext(code, context) }
}
const response = messages => ({ ok: true, json: async () => ({ messages }) })
const oldUser = { id: 'old-user', role: 'user', text: 'Previous synthetic question', complete: true }
const oldReply = { id: 'old-a', role: 'nori', text: 'Previous synthetic conversation', complete: true }
const newUser = { id: 'new-user', role: 'user', text: 'Synthetic fast-reply question', complete: true }
const newReply = { id: 'new-b', role: 'nori', text: 'New synthetic reply', complete: true }
const oldHistory = [oldUser, oldReply]

test('phone replaces authoritative snapshots when desktop conversation resets', async () => {
 const c = client()
 c.context.fetch = async () => response(oldHistory)
 await c.run('fetchConversation()')
 c.context.fetch = async () => response([])
 await c.run('fetchConversation()')
 assert.deepEqual(JSON.parse(c.run('JSON.stringify(remoteOrder)')), [], 'desktop clear removes previous phone conversation')
 c.context.fetch = async () => response([newUser, newReply])
 await c.run('fetchConversation()')
 assert.deepEqual(JSON.parse(c.run('JSON.stringify(remoteOrder)')), ['new-user', 'new-b'], 'new desktop conversation cannot contain old phone messages')
})

test('a reply polled before send acknowledgement cannot leave phone Send disabled', async () => {
 const c = client()
 c.context.fetch = async () => response(oldHistory)
 await c.run('fetchConversation()')
 c.elements.get('#prompt').value = 'Synthetic fast-reply question'
 let completePost
 const post = new Promise(resolve => { completePost = resolve })
 c.context.fetch = async url => url === '/input' ? post : response([...oldHistory, newUser, newReply])
 const sending = c.run('submitMessage()')
 await c.run('fetchConversation()')
 completePost({ ok: true, json: async () => ({ ok: true }) })
 await sending
 await c.run('fetchConversation()')
 assert.equal(c.elements.get('#send').disabled, false, 'completed response must release the composer even if POST acknowledgement arrives later')
})

test('phone submission deadline releases Send and preserves the unsent draft without automatic replay', async () => {
 const c = client()
 const draft = 'Synthetic stalled connection'
 c.elements.get('#prompt').value = draft
 const deadlines = []
 c.context.AbortSignal = { timeout(ms) {
   const controller = new AbortController()
   deadlines.push({ ms, fire: () => controller.abort(Object.assign(new Error('Synthetic request deadline'), { name: 'TimeoutError' })) })
   return controller.signal
 }, any: AbortSignal.any.bind(AbortSignal) }
 let options, requestCount = 0
 c.context.fetch = (_, value) => {
   options = value
   requestCount++
   return new Promise((_, reject) => {
     if (value.signal?.aborted) reject(value.signal.reason)
     value.signal?.addEventListener('abort', () => reject(value.signal.reason), { once: true })
   })
 }
 const sending = c.run('submitMessage()')
 await Promise.resolve()
 assert.ok(options?.signal && typeof options.signal.addEventListener === 'function', 'a stalled send requires a bounded abortable request rather than an unbounded disabled composer')
 assert.ok(deadlines.some(deadline => Number.isSafeInteger(deadline.ms) && deadline.ms > 0 && deadline.ms <= 30000), 'submission creates a bounded timeout rather than a signal that is never canceled')
 assert.equal(c.elements.get('#send').disabled, true)
 for (const deadline of deadlines) deadline.fire()
 await sending
 assert.equal(c.elements.get('#send').disabled, false, 'deadline rejection releases composer')
 assert.equal(c.elements.get('#prompt').value, draft, 'unconfirmed text remains available for an explicit retry')
 assert.equal(requestCount, 1, 'uncertain submissions are not automatically replayed')
 assert.doesNotMatch(c.elements.get('#state').textContent, /^Sending to Nori/)
})

test('repeated identical user text must match a new user row rather than old history', async () => {
 const c = client()
 c.context.fetch = async () => response(oldHistory)
 await c.run('fetchConversation()')
 c.elements.get('#prompt').value = oldUser.text
 c.context.fetch = async url => url === '/input' ? { ok: true, json: async () => ({ ok: true }) } : response(oldHistory)
 await c.run('submitMessage()')
 const unrelatedReply = { id: 'unrelated-reply', role: 'nori', text: 'A separate completed reply', complete: true }
 c.context.fetch = async () => response([...oldHistory, unrelatedReply])
 await c.run('fetchConversation()')
 assert.equal(c.elements.get('#send').disabled, true, 'old identical user text does not authorize completion from a different Nori row')
 const repeatedUser = { ...oldUser, id: 'repeated-user-new-id' }
 c.context.fetch = async () => response([...oldHistory, unrelatedReply, repeatedUser, newReply])
 await c.run('fetchConversation()')
 assert.equal(c.elements.get('#send').disabled, false, 'new matching user row followed by its completed reply releases composer')
})

test('a different new desktop user message cannot complete the pending phone message', async () => {
 const c = client()
 c.context.fetch = async () => response(oldHistory)
 await c.run('fetchConversation()')
 c.elements.get('#prompt').value = newUser.text
 c.context.fetch = async url => url === '/input' ? { ok: true, json: async () => ({ ok: true }) } : response(oldHistory)
 await c.run('submitMessage()')
 const desktopUser = { id: 'desktop-only-user', role: 'user', text: 'A different desktop request', complete: true }
 const desktopReply = { id: 'desktop-only-reply', role: 'nori', text: 'Desktop-only answer', complete: true }
 c.context.fetch = async () => response([...oldHistory, desktopUser, desktopReply])
 await c.run('fetchConversation()')
 assert.equal(c.elements.get('#send').disabled, true, 'unrelated desktop exchange must not clear the pending phone send')
 c.context.fetch = async () => response([...oldHistory, desktopUser, desktopReply, newUser, newReply])
 await c.run('fetchConversation()')
 assert.equal(c.elements.get('#send').disabled, false)
})

test('desktop reset releases a pending phone send after its user row was observed', async () => {
 const c = client()
 c.context.fetch = async () => response(oldHistory)
 await c.run('fetchConversation()')
 c.elements.get('#prompt').value = newUser.text
 c.context.fetch = async url => url === '/input' ? { ok: true, json: async () => ({ ok: true }) } : response([...oldHistory, newUser])
 await c.run('submitMessage()')
 await c.run('fetchConversation()')
 assert.equal(c.elements.get('#send').disabled, true)
 c.context.fetch = async () => response([])
 await c.run('fetchConversation()')
 assert.equal(c.elements.get('#send').disabled, false, 'desktop reset must release the pending composer')
 assert.deepEqual(JSON.parse(c.run('JSON.stringify(remoteOrder)')), [])
})

test('desktop reset cannot leave a pending acknowledged send waiting for a user row that was cleared before polling', async () => {
 const c = client()
 c.context.fetch = async () => response(oldHistory)
 await c.run('fetchConversation()')
 c.elements.get('#prompt').value = newUser.text
 c.context.fetch = async url => url === '/input' ? { ok: true, json: async () => ({ ok: true }) } : response([])
 await c.run('submitMessage()')
 await c.run('fetchConversation()')
 assert.equal(c.elements.get('#send').disabled, false, 'known desktop history clearing cannot wait forever for the unseen submitted user row')
 assert.deepEqual(JSON.parse(c.run('JSON.stringify(remoteOrder)')), [])
})

test('editing the next draft before send acknowledgement does not lose or submit that draft', async () => {
 const c = client()
 c.context.fetch = async () => response(oldHistory)
 await c.run('fetchConversation()')
 c.elements.get('#prompt').value = newUser.text
 let completePost, requests = 0
 const post = new Promise(resolve => { completePost = resolve })
 c.context.fetch = async url => { if (url === '/input') { requests++; return post }; return response([...oldHistory, newUser, newReply]) }
 const sending = c.run('submitMessage()')
 c.elements.get('#prompt').value = 'Next synthetic draft, typed before acknowledgement'
 await c.run('fetchConversation()')
 completePost({ ok: true, json: async () => ({ ok: true }) })
 await sending
 assert.equal(c.elements.get('#prompt').value, 'Next synthetic draft, typed before acknowledgement')
 assert.equal(c.elements.get('#send').disabled, false)
 assert.equal(requests, 1)
})

test('timeout after the matching user and reply were observed does not invite a duplicate retry', async () => {
 const c = client()
 c.context.fetch = async () => response(oldHistory)
 await c.run('fetchConversation()')
 c.elements.get('#prompt').value = newUser.text
 const deadlines = []
 c.context.AbortSignal = { timeout(ms) {
   const controller = new AbortController()
   deadlines.push({ ms, fire: () => controller.abort(Object.assign(new Error('Synthetic lost acknowledgement'), { name: 'TimeoutError' })) })
   return controller.signal
 }, any: AbortSignal.any.bind(AbortSignal) }
 let requests = 0
 c.context.fetch = (url, options) => {
   if (url !== '/input') return Promise.resolve(response([...oldHistory, newUser, newReply]))
   requests++
   return new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
 }
 const sending = c.run('submitMessage()')
 await c.run('fetchConversation()')
 assert.ok(deadlines.length, 'request has a controlled deadline')
 for (const deadline of deadlines) deadline.fire()
 await sending
 assert.equal(c.elements.get('#send').disabled, false)
 assert.equal(c.elements.get('#prompt').value, '', 'observed delivery must not leave the delivered text ready to replay')
 assert.equal(requests, 1)
 assert.doesNotMatch(c.elements.get('#state').textContent, /retry|not confirmed/i)
})
