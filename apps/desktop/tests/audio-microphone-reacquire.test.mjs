import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function fakeStream() {
  const track = {
    readyState: 'live',
    enabled: true,
    stopCalls: 0,
    stop() { this.stopCalls++ },
  }
  return { track, getAudioTracks: () => [track] }
}

test('getMic replaces an ended shared stream once for concurrent wake retries', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const first = fakeStream()
  const replacement = fakeStream()
  let acquisitions = 0
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: {
      getSupportedConstraints: () => ({}),
      getUserMedia: async () => ++acquisitions === 1 ? first : replacement,
    } },
  })

  try {
    const helper = ts.transpileModule(
      readFileSync(new URL('../src/lib/audio-track-recovery.ts', import.meta.url), 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
    ).outputText
    const helperUrl = `data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`
    const source = readFileSync(new URL('../src/lib/audio.ts', import.meta.url), 'utf8')
      .replace("import { hasUsableAudioTracks, stopAudioTracks } from './audio-track-recovery.ts'",
        `import { hasUsableAudioTracks, stopAudioTracks } from '${helperUrl}'`)
    const code = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText
    const { getMic } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

    assert.equal(await getMic(), first)
    first.track.readyState = 'ended'

    const [recoveredA, recoveredB] = await Promise.all([getMic(), getMic()])
    assert.equal(recoveredA, replacement)
    assert.equal(recoveredB, replacement)
    assert.equal(first.track.stopCalls, 1, 'the stale shared track is released once')
    assert.equal(replacement.track.enabled, false, 'reacquisition must preserve the startup mute')
    assert.equal(acquisitions, 2, 'concurrent retries share one microphone acquisition')
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globalThis.navigator
  }
})
