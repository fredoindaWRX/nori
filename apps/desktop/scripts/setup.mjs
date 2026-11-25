#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.env.NORI_COUNCIL_URL ?? 'http://127.0.0.1:9107'
const tokenFile = process.env.NORI_API_TOKEN_FILE ?? resolve(here, '../../../nori/runtime-data/secrets/council-token')
const line = (tag, message) => console.log(`[${tag.padEnd(4)}] ${message}`)

console.log('\nN.O.R.I. v2 preflight — read-only; nothing is changed')
console.log('----------------------------------------------------')

const major = Number(process.versions.node.split('.')[0])
line(major >= 20 ? 'ok' : 'note', `Node.js ${process.versions.node}${major >= 20 ? '' : ' (20+ required)'}`)

let token = process.env.NORI_API_TOKEN?.trim() ?? ''
if (!token) {
  try { token = readFileSync(tokenFile, 'utf8').trim() } catch { /* reported below */ }
}
line(token.length >= 32 ? 'ok' : 'note', token.length >= 32
  ? 'Council credential is available to the server-side bridge.'
  : `Council credential is missing or too short. Set NORI_API_TOKEN or NORI_API_TOKEN_FILE.`)

try {
  const response = await fetch(`${base}/health`)
  const health = await response.json().catch(() => ({}))
  line(response.ok ? 'ok' : 'note', response.ok
    ? `Nori v2 Council is reachable at ${base} (${health.status ?? 'ready'}).`
    : `Council returned HTTP ${response.status} at ${base}.`)
} catch {
  line('note', `Nori v2 Council is not reachable at ${base}. Start Nori before the bridge.`)
}

line(process.env.ELEVENLABS_API_KEY ? 'ok' : '·', process.env.ELEVENLABS_API_KEY
  ? 'Optional ElevenLabs voice is configured.'
  : 'Using browser speech; set ELEVENLABS_API_KEY server-side for a premium voice.')

console.log('\nStart N.O.R.I.:')
console.log('  1) npm run bridge   # Nori v2 brain connection')
console.log('  2) npm run dev      # interface at http://127.0.0.1:5173')
console.log('\nText input requires no device permissions. Say “Hey Nori” after INITIALISE for voice.\n')
