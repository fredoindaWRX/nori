import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'
import { noriRoot, voiceProbeRoot, syntheticVoiceClip, voiceBridge } from '../scripts/voice-probe-paths.mjs'

test('voice recovery evidence and temporary root are contained in Nori', () => {
  for (const path of [voiceProbeRoot, syntheticVoiceClip, voiceBridge('kokoro_tts.py'), voiceBridge('whisper_stt.py')]) {
    const offset = relative(noriRoot, path)
    assert.ok(offset && !offset.startsWith('..') && !isAbsolute(offset))
  }
  assert.throws(() => voiceBridge('../../outside.py'), /Unknown/)
})
test('voice probes no longer depend on caller cwd or external generated clip', async () => {
  for (const name of ['verify-usb-kokoro.mjs', 'verify-usb-whisper.mjs']) {
    const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8')
    assert.ok(!source.includes('NoriLabs'))
    assert.ok(!source.includes("resolve('bridge/"))
    assert.ok(source.includes('syntheticVoiceClip'))
  }
})
