import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { HAND_MODEL_BYTES, HAND_MODEL_SHA256, vendorMediaPipe } from '../scripts/mediapipe-assets.mjs'

const appRoot = path.resolve(import.meta.dirname, '..')
const modelPath = path.join(appRoot, 'assets', 'mediapipe', 'hand_landmarker.task')

test('pinned hand model matches the declared byte count and SHA-256', () => {
  const bytes = readFileSync(modelPath)
  assert.equal(bytes.byteLength, HAND_MODEL_BYTES)
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), HAND_MODEL_SHA256)
})

test('vendor step copies the pinned model and local WASM into public assets', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nori-mediapipe-vendor-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const wasm = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
  mkdirSync(wasm, { recursive: true })
  writeFileSync(path.join(wasm, 'vision_wasm_internal.wasm'), 'local-wasm-fixture')
  mkdirSync(path.join(root, 'assets', 'mediapipe'), { recursive: true })
  cpSync(modelPath, path.join(root, 'assets', 'mediapipe', 'hand_landmarker.task'))
  cpSync(path.join(appRoot, 'assets', 'mediapipe', 'HAND_LANDMARKER_MODEL_NOTICE.txt'), path.join(root, 'assets', 'mediapipe', 'HAND_LANDMARKER_MODEL_NOTICE.txt'))

  const receipt = vendorMediaPipe(root)
  const copiedModel = path.join(root, 'public', 'mediapipe', 'hand_landmarker.task')
  assert.equal(receipt.modelBytes, HAND_MODEL_BYTES)
  assert.equal(receipt.modelSha256, HAND_MODEL_SHA256)
  assert.deepEqual(readFileSync(copiedModel), readFileSync(modelPath))
  assert.match(readFileSync(path.join(root, 'public', 'mediapipe', 'HAND_LANDMARKER_MODEL_NOTICE.txt'), 'utf8'), /Apache License, Version 2\.0/)
  assert.equal(existsSync(path.join(root, 'public', 'mediapipe', 'vision_wasm_internal.wasm')), true)
})

test('vendor step rejects a modified model before writing public assets', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nori-mediapipe-invalid-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), { recursive: true })
  mkdirSync(path.join(root, 'assets', 'mediapipe'), { recursive: true })
  cpSync(path.join(appRoot, 'assets', 'mediapipe', 'HAND_LANDMARKER_MODEL_NOTICE.txt'), path.join(root, 'assets', 'mediapipe', 'HAND_LANDMARKER_MODEL_NOTICE.txt'))
  writeFileSync(path.join(root, 'assets', 'mediapipe', 'hand_landmarker.task'), 'not the pinned model')
  assert.throws(() => vendorMediaPipe(root), /integrity check failed/)
  assert.equal(existsSync(path.join(root, 'public')), false)
})

test('hand tracker loads weights only from Nori local assets', () => {
  const source = readFileSync(path.join(appRoot, 'src', 'lib', 'hands.ts'), 'utf8')
  assert.match(source, /const MODEL_URL\s*=\s*['"]\/mediapipe\/hand_landmarker\.task['"]/)
  assert.match(source, /modelAssetBuffer/)
  assert.equal((source.match(/modelAssetBuffer:\s*modelAssetBuffer\.slice\(\)/g) ?? []).length, 2)
  assert.doesNotMatch(source, /https:\/\/storage\.googleapis\.com\/mediapipe-models/)
})
