import { createHash } from 'node:crypto'
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export const HAND_MODEL_BYTES = 7_819_105
export const HAND_MODEL_SHA256 = 'FBC2A30080C3C557093B5DDFC334698132EB341044CCEE322CCF8BCF3607CDE1'

/** Copy pinned, locally owned MediaPipe assets into the renderer's public root. */
export function vendorMediaPipe(appRoot) {
  const wasmSource = resolve(appRoot, 'node_modules/@mediapipe/tasks-vision/wasm')
  const modelSource = resolve(appRoot, 'assets/mediapipe/hand_landmarker.task')
  const noticeSource = resolve(appRoot, 'assets/mediapipe/HAND_LANDMARKER_MODEL_NOTICE.txt')
  const target = resolve(appRoot, 'public/mediapipe')
  if (!existsSync(wasmSource)) throw new Error('MediaPipe runtime is not installed')
  if (!existsSync(modelSource)) throw new Error('Pinned local hand-landmarker model is missing')
  if (!existsSync(noticeSource)) throw new Error('Hand-landmarker model license notice is missing')
  if (!readFileSync(noticeSource, 'utf8').includes('Apache License, Version 2.0')) {
    throw new Error('Hand-landmarker model license notice is incomplete')
  }

  const model = readFileSync(modelSource)
  const digest = createHash('sha256').update(model).digest('hex').toUpperCase()
  if (statSync(modelSource).size !== HAND_MODEL_BYTES || digest !== HAND_MODEL_SHA256) {
    throw new Error(`Pinned hand-landmarker model integrity check failed: ${digest}`)
  }

  mkdirSync(target, { recursive: true })
  cpSync(wasmSource, target, { recursive: true, force: true })
  copyFileSync(modelSource, resolve(target, 'hand_landmarker.task'))
  copyFileSync(noticeSource, resolve(target, 'HAND_LANDMARKER_MODEL_NOTICE.txt'))
  return { modelBytes: HAND_MODEL_BYTES, modelSha256: HAND_MODEL_SHA256 }
}
