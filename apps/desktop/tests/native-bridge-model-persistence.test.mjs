import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer,createConnection} from 'node:net'
import {createServer as createHttpServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import WebSocket from 'ws'

test('native local model choice survives a real bridge process restart', {timeout:20000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nori-native-model-restart-'))
  let inferenceRequests = 0
  const inference = createHttpServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat')
    assert.equal(request.headers.authorization, 'Bearer synthetic-native-token')
    let body = ''
    for await (const part of request) body += part
    const parsed = JSON.parse(body)
    assert.equal(parsed.model_id, 'synthetic-owned-model')
    inferenceRequests++
    response.writeHead(200, {'content-type':'text/event-stream'})
    response.end('event: token\ndata: {"text":"SYNTHETIC_LOCAL_OK"}\n\nevent: done\ndata: [DONE]\n\n')
  })
  await new Promise(resolve => inference.listen(0, '127.0.0.1', resolve))
  const baseEnvironment = {
    ...process.env,
    NORI_ROOT: root,
    NORI_SETTINGS_DIR: join(root, 'settings'),
    NORI_LEARNING_FILE: join(root, 'guidance.json'),
    NORI_BRAIN: 'nori-v2',
    NORI_INFERENCE_RUNTIME: 'norllama',
    NORI_ALLOW_WRITES: '0',
    NORI_ALLOWED_ORIGINS: 'http://127.0.0.1:5173',
    NORI_PYTHON: '',
    NORI_WORKSPACE: '',
    NORI_RUNTIME_URL: `http://127.0.0.1:${inference.address().port}`,
    NORI_RUNTIME_API_KEY: 'synthetic-native-token',
    NORI_RUNTIME_MODEL_ID: 'synthetic-owned-model',
  }
  const bridgeEntry = fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))
  const children = []
  const sockets = []
  t.after(async () => {
    for (const socket of sockets) socket.terminate()
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve))
        child.kill()
        await exited
      }
    }
    inference.closeAllConnections()
    await new Promise(resolve => inference.close(resolve))
    await rm(root, {recursive:true, force:true})
  })

  async function freePort() {
    const server = createServer()
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const port = server.address().port
    await new Promise(resolve => server.close(resolve))
    return port
  }

  async function startBridge() {
    const port = await freePort()
    const child = spawn(process.execPath, [bridgeEntry], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {...baseEnvironment, NORI_BRIDGE_PORT:String(port)},
      stdio:['ignore','pipe','pipe'],
      windowsHide:true,
    })
    children.push(child)
    let logs = ''
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`Bridge startup timed out: ${logs.slice(-1000)}`)), 6000)
      child.stdout.on('data', bytes => {
        logs = (logs + bytes.toString()).slice(-4000)
        if (logs.includes('bridge listening')) { clearTimeout(timer); resolve() }
      })
      child.stderr.on('data', bytes => { logs = (logs + bytes.toString()).slice(-4000) })
      child.once('exit', code => { clearTimeout(timer); reject(Error(`Bridge exited ${code}: ${logs.slice(-1000)}`)) })
      child.once('error', error => { clearTimeout(timer); reject(error) })
    })
    const listenDeadline = Date.now() + 3000
    while (true) {
      const listening = await new Promise(resolve => {
        const probe = createConnection({host:'127.0.0.1', port})
        probe.once('connect', () => { probe.destroy(); resolve(true) })
        probe.once('error', () => { probe.destroy(); resolve(false) })
      })
      if (listening) break
      assert.ok(Date.now() < listenDeadline, `Bridge never accepted connections on ${port}`)
      await new Promise(resolve => setTimeout(resolve, 15))
    }
    return {child, port}
  }

  async function connect(port) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {origin:'http://127.0.0.1:5173'})
    sockets.push(socket)
    const frames = []
    socket.on('message', bytes => frames.push(JSON.parse(String(bytes))))
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    const deadline = Date.now() + 3000
    while (!frames.some(frame => frame.type === 'ready')) {
      assert.ok(Date.now() < deadline, `No bridge ready frame: ${JSON.stringify(frames)}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return {socket, frames}
  }

  const first = await startBridge()
  const beforeRestart = await connect(first.port)
  assert.equal(beforeRestart.frames.find(frame => frame.type === 'ready').model, 'nori-auto')
  beforeRestart.socket.send(JSON.stringify({type:'config', model:'synthetic-owned-model', effort:'balanced', fresh:true}))
  await new Promise(resolve => {
    const timer = setTimeout(() => resolve('timeout'), 3000)
    beforeRestart.socket.once('close', () => { clearTimeout(timer); resolve('closed') })
  }).then(result => assert.equal(result, 'closed', 'model change must reconnect the bridge session'))

  const recordName = (await readdir(join(root, 'settings'))).find(name => /^resume-native-.*\.json$/.test(name))
  assert.ok(recordName, 'selected model must be written to Nori settings')
  assert.equal(JSON.parse(await readFile(join(root, 'settings', recordName), 'utf8')).model, 'synthetic-owned-model')
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('First bridge did not exit')), 3000)
    first.child.once('exit', () => { clearTimeout(timer); resolve() })
    first.child.kill()
  })

  const second = await startBridge()
  const afterRestart = await connect(second.port)
  assert.equal(afterRestart.frames.find(frame => frame.type === 'ready').model, 'synthetic-owned-model',
    'the saved temporary local model selection must survive a fresh bridge process')
  afterRestart.socket.send(JSON.stringify({type:'ask', id:'restart-model-check', text:'Reply with the local fixture result.'}))
  const deadline = Date.now() + 4000
  while (!afterRestart.frames.some(frame => frame.type === 'done' && frame.ask === 'restart-model-check')) {
    assert.ok(Date.now() < deadline, `No post-restart local reply: ${JSON.stringify(afterRestart.frames)}`)
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  assert.equal(afterRestart.frames.filter(frame => frame.type === 'text' && frame.ask === 'restart-model-check')
    .map(frame => frame.delta).join(''), 'SYNTHETIC_LOCAL_OK')
  assert.equal(inferenceRequests, 1)
})
