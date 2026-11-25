import test from 'node:test'
import assert from 'node:assert/strict'
import { localScreenVisionCapability, localVisionTempLocation, LOCAL_VISION_MODEL_ID, LOCAL_SCREEN_VISION_BACKEND_ID } from '../bridge/local-vision.mjs'

test('missing assets cannot advertise working screen vision', async () => {
  const capability = await localScreenVisionCapability({ root: 'C:/Nori/__nonexistent_vision_fixture__' })
  assert.deepEqual(capability, { available: false, backendId: LOCAL_SCREEN_VISION_BACKEND_ID,
    modelId: LOCAL_VISION_MODEL_ID, imageCapable: false, structuredOutput: false, errorCode: 'vision_assets_unavailable' })
})

test('packaged image scratch uses explicit owner profile instead of Program Files', () => {
  const location = localVisionTempLocation({ appDataRoot: 'C:/synthetic-profile', root: 'C:/Program Files/Nori' })
  assert.equal(location.root.replaceAll('\\', '/'), 'C:/synthetic-profile')
  assert.equal(location.relativePath, 'vision-temp')
})
