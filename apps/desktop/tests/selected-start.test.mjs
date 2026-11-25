import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectedLauncherOptions } from '../scripts/start.mjs'

test('normal installed start selects local GPT-OSS and removes inherited runtime without mutating environment', () => {
  const env = { Path: 'original', electron_run_as_node: '1', nori_allow_writes: '1', NORI_INFERENCE_RUNTIME: 'ollama-rollback' }
  const result = selectedLauncherOptions(env)
  assert.equal(result.env.Path, 'original')
  assert.equal(result.env.electron_run_as_node, undefined)
  assert.equal(result.env.nori_allow_writes, undefined)
  assert.equal(result.env.NORI_ALLOW_WRITES, '0')
  assert.equal(result.env.NORI_INFERENCE_RUNTIME, 'gpt-oss')
  assert.equal(result.env.NORI_GPT_OSS_ENABLED, '1')
  assert.equal(result.shell, false)
  assert.equal(env.electron_run_as_node, '1')
})
test('writes require explicit flag and inspect does not grant writes', () => {
  assert.equal(selectedLauncherOptions({}, ['--writes']).env.NORI_ALLOW_WRITES, '1')
  assert.equal(selectedLauncherOptions({}, ['--inspect']).env.NORI_ALLOW_WRITES, '0')
  const remote = selectedLauncherOptions({ NORI_REMOTE_CONTROL_ONLY: '0' }, ['--remote-control-only'])
  assert.equal(remote.env.NORI_REMOTE_CONTROL_ONLY, '1')
  assert.equal(remote.env.NORI_ALLOW_WRITES, '0')
  assert.equal(remote.env.NORI_INFERENCE_RUNTIME, 'gpt-oss')
  for (const args of [['--unknown'], ['--writes', '--inspect'], ['--writes', '--writes']]) {
    assert.throws(() => selectedLauncherOptions({}, args))
  }
  assert.throws(() => selectedLauncherOptions({}, ['--writes', '--remote-control-only']))
})
test('normal startup and explicit development mode are separate', () => {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  assert.equal(metadata.scripts.start, 'node scripts/start.mjs')
  assert.equal(metadata.scripts['start:dev'], 'node scripts/start-development.mjs')
  assert.match(readFileSync(new URL('../scripts/start-development.mjs', import.meta.url), 'utf8'), /startNativeStack/)
  assert.match(readFileSync(new URL('../scripts/start.mjs', import.meta.url), 'utf8'), /launch-current-desktop\.vbs/)
})

test('installed GPT-OSS is the default; only an explicit small-model flag selects NorLlama', () => {
  const inherited = { NORI_INFERENCE_RUNTIME: 'gpt-oss', NORI_ALLOW_WRITES: '1', NORI_REMOTE_CONTROL_ONLY: '1' }
  assert.equal(selectedLauncherOptions(inherited).env.NORI_INFERENCE_RUNTIME, 'gpt-oss')
  for (const args of [['--nori-gpt-oss'], ['--inspect', '--nori-gpt-oss']]) {
    const { env } = selectedLauncherOptions(inherited, args)
    assert.equal(env.NORI_INFERENCE_RUNTIME, 'gpt-oss')
    assert.equal(env.NORI_ALLOW_WRITES, '0')
    assert.equal(env.NORI_REMOTE_CONTROL_ONLY, '0')
  }
  assert.equal(selectedLauncherOptions({}, ['--nori-norllama']).env.NORI_INFERENCE_RUNTIME, 'norllama')
  assert.throws(() => selectedLauncherOptions({}, ['--nori-gpt-oss', '--nori-norllama']))
  for (const args of [['--nori-gpt-oss', '--writes'], ['--nori-gpt-oss', '--remote-control-only'],
    ['--nori-gpt-oss', '--nori-gpt-oss']]) assert.throws(() => selectedLauncherOptions({}, args))
})

test('Codex provider is an explicit base-GPT-OSS-only desktop option and never inherited', () => {
  const inherited = { NORI_CODEX_LOCAL_PROVIDER: '1' }
  assert.equal(selectedLauncherOptions(inherited).env.NORI_CODEX_LOCAL_PROVIDER, '0')
  const selected = selectedLauncherOptions({}, ['--nori-gpt-oss', '--nori-codex-provider'])
  assert.equal(selected.env.NORI_INFERENCE_RUNTIME, 'gpt-oss')
  assert.equal(selected.env.NORI_CODEX_LOCAL_PROVIDER, '1')
  assert.equal(selected.env.NORI_ALLOW_WRITES, '0')
  for (const args of [['--nori-codex-provider'], ['--nori-gpt-oss-heretic', '--nori-codex-provider'],
    ['--nori-gpt-oss', '--nori-gpt-oss-heretic', '--nori-codex-provider']]) {
    assert.throws(() => selectedLauncherOptions({}, args))
  }
})

test('Heretic remains opt-in while base GPT-OSS is the normal installed brain', () => {
  const inherited = { NORI_GPT_OSS_HERETIC: '1', NORI_INFERENCE_RUNTIME: 'gpt-oss', NORI_ALLOW_WRITES: '1' }
  const normal = selectedLauncherOptions(inherited)
  assert.equal(normal.env.NORI_INFERENCE_RUNTIME, 'gpt-oss')
  assert.equal(normal.env.NORI_GPT_OSS_HERETIC, '0')
  assert.equal(normal.env.NORI_ALLOW_WRITES, '0')
  const candidate = selectedLauncherOptions({}, ['--nori-gpt-oss-heretic'])
  assert.equal(candidate.env.NORI_INFERENCE_RUNTIME, 'gpt-oss')
  assert.equal(candidate.env.NORI_GPT_OSS_HERETIC, '1')
  assert.equal(candidate.env.NORI_ALLOW_WRITES, '0')
  assert.throws(() => selectedLauncherOptions({}, ['--nori-gpt-oss', '--nori-gpt-oss-heretic']))
  assert.throws(() => selectedLauncherOptions({}, ['--nori-gpt-oss-heretic', '--writes']))
})
