// Actual owned runtime + Core client. Synthetic verdict, no inference/tools.
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
const require = createRequire(import.meta.url)
const { startNativeService } = require('../desktop/native-service.cjs')
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const match = args.length === 1 && /^--candidate=([a-z0-9][a-z0-9-]{0,63})$/.exec(args[0])
if (args.length && !match) throw new Error('Expected one safe candidate name')
const root = match ? resolve(sourceRoot, `apps/desktop/release/native-desktop-${match[1]}/win-unpacked/resources/NoriSuite`) : sourceRoot
if (!existsSync(resolve(root, 'runtime/norllama/core_client.py'))) throw new Error('Native Core client missing')
const fixture = 'fixture-bound-proposal-only.txt'
if (existsSync(resolve(root, fixture))) throw new Error('Proposal fixture must remain absent')
const service = await startNativeService({ root })
try {
  const code = `import json, os, sys
sys.path.insert(0, os.path.join(os.getcwd(), 'runtime', 'norllama'))
from core_client import NativeInferenceClient
client = NativeInferenceClient(os.environ['NORI_RUNTIME_URL'], os.environ['NORI_RUNTIME_API_KEY'], os.environ['NORI_RUNTIME_MODEL_ID'])
task = 'Propose reading fixture-bound-proposal-only.txt; do not execute.'
calls = [{'action':'read_file','path':'fixture-bound-proposal-only.txt'}]
prepared = client.prepare_bound_review(task, ['read_file'], calls)
verdict = json.dumps({'binding_sha256':prepared['review_contract']['binding_sha256'], 'decision':'accept', 'issues':[], 'reason':'Synthetic protocol fixture, not model qualification.'})
checked = client.validate_bound_review(verdict, task, ['read_file'], calls)
assert checked['status'] == 'review_accepted'
assert checked['execution_authorized'] is False and checked['executed_tools'] == []
assert prepared['proposal']['model_used'] is False
print(json.dumps({'planner':prepared['proposal']['planner'], 'review_status':checked['status'], 'binding_sha256':checked['binding_sha256'], 'synthetic_verdict':True, 'model_used':False, 'execution_authorized':False, 'executed_tools':[]}))
`
  await new Promise((resolveDone, reject) => {
    const child = spawn(resolve(root, 'python/Python311/python.exe'), ['-B', '-c', code], {
      cwd: root, shell: false, windowsHide: true,
      env: { ...process.env, ...service.environment }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '', error = '', timedOut = false, overflow = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 15000)
    child.stdout.on('data', bytes => {
      if (output.length + bytes.length > 8192) { overflow = true; child.kill(); return }
      output += bytes
    })
    child.stderr.on('data', bytes => { error = (error + bytes).slice(-2048) })
    child.once('error', failure => { clearTimeout(timer); reject(failure) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code !== 0 || timedOut || overflow) reject(new Error('Bound Core client probe failed: ' + error))
      else { console.log(output.trim()); resolveDone() }
    })
  })
  if (existsSync(resolve(root, fixture))) throw new Error('Proposal unexpectedly created a file')
} finally {
  await service.stop()
  console.log(JSON.stringify({ ownedRuntimeStopped: true, taskExecutionQualified: false }))
}
