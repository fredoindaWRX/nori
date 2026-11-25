import fs from 'node:fs'

const sampleRate = 44100
const seconds = 10
const count = sampleRate * seconds
const data = Buffer.alloc(count * 2)
const notes = [110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66]
const melody = [220, 261.63, 293.66, 329.63, 293.66, 261.63, 220, 196]
const rnd = (i) => Math.sin(i * 12.9898) * 43758.5453 % 1
for (let i = 0; i < count; i++) {
  const t = i / sampleRate
  const fade = Math.min(1, t / 0.35) * Math.min(1, (seconds - t) / 1.3)
  const beat = t * 0.72
  const n = Math.floor(beat) % notes.length
  const phase = beat % 1
  const pad = (Math.sin(2 * Math.PI * notes[n] * t) + 0.35 * Math.sin(2 * Math.PI * notes[n] * 0.5 * t)) * 0.2
  const swell = (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 8)) * 0.16
  const m = melody[Math.floor(t / 2.6) % melody.length]
  const pianoEnv = Math.exp(-phase * 4.5) * Math.min(1, phase * 22)
  const piano = (Math.sin(2 * Math.PI * m * t) + 0.28 * Math.sin(2 * Math.PI * m * 2 * t)) * pianoEnv * 0.34
  const impact = Math.exp(-Math.max(0, t - 8.55) * 1.7) * Math.sin(2 * Math.PI * 43 * t) * 0.42
  const air = (rnd(i) - 0.5) * 0.003 * (0.5 + 0.5 * Math.sin(t / 9))
  const value = Math.max(-1, Math.min(1, (pad + swell * Math.sin(2 * Math.PI * 55 * t) + piano + impact + air) * fade))
  data.writeInt16LE(Math.round(value * 32767), i * 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20)
header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28)
header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
fs.writeFileSync(new URL('../public/audio/deep-ambient.wav', import.meta.url), Buffer.concat([header, data]))
