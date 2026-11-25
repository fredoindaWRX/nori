import { resolve } from 'node:path'
import { vendorMediaPipe } from './mediapipe-assets.mjs'

const result = vendorMediaPipe(resolve(import.meta.dirname, '..'))
console.log(`  bundled the pinned local hand model (${result.modelBytes} bytes) and MediaPipe runtime.`)
