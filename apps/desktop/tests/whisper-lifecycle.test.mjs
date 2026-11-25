import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'

function fixture(environment = { NORI_PYTHON: 'fixture' }) {
  const worker = new EventEmitter()
  worker.stdout = new EventEmitter()
  worker.stderr = new EventEmitter()
  worker.stdin = new EventEmitter()
  worker.stdin.write = () => true
  worker.stdin.end = () => { worker.exitCode = 0; worker.emit('exit',0) }
  worker.kill = () => { worker.killed = true }
  const timers = []
  const removed = []
  const launches = []
  const source = readFileSync(new URL('../bridge/whisper.mjs', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/export function /g, 'function ')
    .replace(/export async function /g, 'async function ')
  const context = vm.createContext({
    process: { env: environment }, console: { log() {}, warn() {} },
    spawn: (python,args) => { launches.push({python,args}); return worker }, existsSync: () => true,
    dirname: () => '.', join: (...parts) => parts.join('/'), fileURLToPath: () => '.',
    tmpdir: () => '/fixture', mkdtempSync: () => '/fixture/nori-stt-owned',
    writeFileSync() {}, rmSync: (path) => removed.push(path),
    setTimeout: (fn) => { timers.push(fn); return fn }, clearTimeout() {},
  })
  vm.runInContext(source.replace('import.meta.url', "'fixture'"), context)
  return { context, worker, timers, removed, launches }
}

test('Whisper default launch uses bundled Python and isolated canonical launcher',()=>{
  const {context,launches}=fixture({})
  context.startWhisper()
  assert.match(launches[0].python,/python\/Python311\/python.exe$/)
  assert.deepEqual(Array.from(launches[0].args).slice(0,3),['-I','-B','-u'])
  assert.match(launches[0].args[3],/runtime\/stt\/launch_worker.py$/)
})
test('packaged Whisper resolves native interpreter and launcher from suite root',()=>{
  const {context,launches}=fixture({NORI_ROOT:'/packaged/NoriSuite'})
  context.startWhisper()
  assert.equal(launches[0].python,'/packaged/NoriSuite/python/Python311/python.exe')
  assert.equal(launches[0].args[3],'/packaged/NoriSuite/runtime/stt/launch_worker.py')
})

test('Parakeet uses its owned interpreter and isolated worker without changing other Python tools',()=>{
  const {context,launches}=fixture({NORI_STT_BACKEND:'parakeet',NORI_PARAKEET_PYTHON:'/owned/image-python.exe',NORI_PYTHON:'/other/worker.exe'})
  context.startWhisper()
  assert.equal(launches[0].python,'/owned/image-python.exe')
  assert.deepEqual(Array.from(launches[0].args).slice(0,3),['-I','-B','-u'])
  assert.match(launches[0].args[3],/parakeet_stt.py$/)
})

test('Parakeet fails closed when its interpreter is absent rather than borrowing another Python',()=>{
  const {context,launches}=fixture({NORI_STT_BACKEND:'parakeet',NORI_PYTHON:'/other/worker.exe'})
  context.startWhisper()
  assert.equal(launches.length,0)
  assert.equal(context.whisperUnavailable(),true)
})

test('explicit Whisper shutdown rejects pending audio and cleans owned recording',async()=>{
  const {context,worker,removed}=fixture()
  context.startWhisper()
  worker.stdout.emit('data',Buffer.from('{"ready":true}\n'))
  const request=context.whisperTranscribe(Buffer.from('audio'),'audio/wav')
  const rejected=assert.rejects(request,/STT stopped/)
  await Promise.resolve()
  await context.stopWhisper()
  await rejected
  assert.equal(context.whisperReady(),false)
  assert.equal(context.whisperUnavailable(),false)
  assert.equal(context.whisperStatus().state,'stopped')
  assert.equal(context.whisperStatus().errorCode,null)
  assert.deepEqual(removed,['/fixture/nori-stt-owned'])
  assert.equal(worker.exitCode,0)
})

test('Whisper spawn failure is handled without an uncaught error', () => {
  const { context, worker } = fixture()
  context.startWhisper()
  worker.emit('error', new Error('ENOENT'))
  assert.equal(context.whisperUnavailable(), true)
  assert.equal(context.whisperReady(), false)
  assert.deepEqual(JSON.parse(JSON.stringify(context.whisperStatus())),
    { state: 'unavailable', errorCode: 'worker_spawn_failed' })
})

test('Whisper timeout rejects, removes owned audio, and stops late-result reuse', async () => {
  const { context, worker, timers, removed } = fixture()
  context.startWhisper()
  worker.stdout.emit('data', Buffer.from('{"ready":true}\n'))
  const request = context.whisperTranscribe(Buffer.from('audio'), 'audio/wav')
  const rejected = assert.rejects(request, /timed out/)
  await Promise.resolve()
  timers[1]()
  await rejected
  assert.equal(worker.killed, true)
  assert.deepEqual(removed, ['/fixture/nori-stt-owned'])
  await assert.rejects(context.whisperTranscribe(Buffer.from('next'), 'audio/wav'), /not ready/)
})

test('Whisper startup deadline stops a worker that never becomes ready', () => {
  const { context, worker, timers } = fixture()
  context.startWhisper()
  timers[0]()
  assert.equal(worker.killed, true)
  assert.equal(context.whisperUnavailable(), true)
  assert.equal(context.whisperReady(), false)
  assert.equal(context.whisperStatus().errorCode,'worker_startup_timeout')
})

test('Whisper readiness prevents startup deadline from killing a healthy worker', () => {
  const { context, worker, timers } = fixture()
  context.startWhisper()
  worker.stdout.emit('data', Buffer.from('{"ready":true}\n'))
  timers[0]()
  assert.equal(context.whisperReady(), true)
  assert.deepEqual(JSON.parse(JSON.stringify(context.whisperStatus())),
    { state: 'ready', errorCode: null })
  assert.notEqual(worker.killed, true)
})

test('successful Whisper transcription removes its temporary audio directory', async () => {
  const { context, worker, removed } = fixture()
  context.startWhisper()
  worker.stdout.emit('data', Buffer.from('{"ready":true}\n'))
  const request = context.whisperTranscribe(Buffer.from('audio'), 'audio/wav')
  await Promise.resolve()
  worker.stdout.emit('data', Buffer.from('{"text":"Nori"}\n'))
  assert.equal(await request, 'Nori')
  assert.deepEqual(removed, ['/fixture/nori-stt-owned'])
  assert.equal(context.whisperReady(), true)
})

test('Whisper input error rejects the current recording without an uncaught pipe error', async () => {
  const { context, worker, removed } = fixture()
  context.startWhisper()
  worker.stdout.emit('data', Buffer.from('{"ready":true}\n'))
  const request = context.whisperTranscribe(Buffer.from('audio'), 'audio/wav')
  const rejected = assert.rejects(request, /input failed/)
  await Promise.resolve()
  worker.stdin.emit('error', new Error('EPIPE'))
  await rejected
  assert.deepEqual(removed, ['/fixture/nori-stt-owned'])
  assert.equal(worker.killed, true)
})
