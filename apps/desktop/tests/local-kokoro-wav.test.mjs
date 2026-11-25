import test from 'node:test'
import assert from 'node:assert/strict'
import { wavDetails } from '../scripts/verify-local-kokoro.mjs'

function fixture() {
  const wav = Buffer.alloc(4844)
  wav.write('RIFF'); wav.writeUInt32LE(4836, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
  wav.writeUInt32LE(4800, 40)
  for (let offset = 44; offset < wav.length; offset += 2) wav.writeInt16LE(100, offset)
  return wav
}
test('local speech evidence requires real nonempty mono PCM and consistent extents', () => {
  assert.deepEqual(wavDetails(fixture()), { durationSeconds: 0.1, rms: 100, rate: 24000, channels: 1, bits: 16 })
  for (const offset of [0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40]) {
    const bad = fixture(); bad[offset] ^= 1
    assert.throws(() => wavDetails(bad), /Invalid/)
  }
  const silent = fixture(); silent.fill(0, 44)
  assert.throws(() => wavDetails(silent), /Silent/)
  assert.throws(() => wavDetails(Buffer.alloc(43)), /Invalid/)
})
