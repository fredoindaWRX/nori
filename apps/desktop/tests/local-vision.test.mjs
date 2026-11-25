import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeLocalImage, localVisionAssetStatus } from '../bridge/local-vision.mjs'

test('local visual input accepts only bounded image bytes whose MIME matches their signature', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64')
  const jpeg = Buffer.from([255, 216, 255, 0]).toString('base64')
  const webp = Buffer.from('RIFF\x04\x00\x00\x00WEBPdata', 'binary').toString('base64')
  assert.equal(decodeLocalImage({ data: png, mimeType: 'image/png' }).extension, '.png')
  assert.equal(decodeLocalImage({ data: jpeg, mimeType: 'image/jpeg' }).extension, '.jpg')
  assert.equal(decodeLocalImage({ data: webp, mimeType: 'image/webp' }).extension, '.webp')
  for (const frame of [
    { data: 'aGVsbG8=', mimeType: 'image/png' },
    { data: '!!!!', mimeType: 'image/jpeg' },
    { data: png, mimeType: 'image/gif' },
    { data: Buffer.alloc(8 * 1024 * 1024 + 1, 1).toString('base64'), mimeType: 'image/png' },
  ]) assert.throws(() => decodeLocalImage(frame), /local vision|attachment|size/i)
})

test('local vision identifies its pinned model as local but not yet packaged-qualified', () => {
  assert.deepEqual(localVisionAssetStatus(), {
    backend: 'nori-pinned-llama-mtmd-cli',
    modelId: 'Qwen2.5-VL-3B-Instruct',
    mode: 'ephemeral-local-inference',
    qualified: false,
  })
})
