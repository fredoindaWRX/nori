import assert from 'node:assert/strict'
import test from 'node:test'
import { attachCameraPreview } from '../src/lib/camera-preview.mjs'

test('camera preview attaches the live stream before explicitly starting playback', async () => {
  const stream = { id: 'local-camera' }
  const order = []
  const video = {
    srcObject: null,
    async play() {
      assert.equal(this.srcObject, stream)
      order.push('play')
    },
  }

  await attachCameraPreview(video, stream)

  assert.equal(video.srcObject, stream)
  assert.deepEqual(order, ['play'])
})

test('camera preview propagates autoplay failure so the UI can report it and release its hold', async () => {
  const video = {
    srcObject: null,
    async play() { throw new DOMException('play denied', 'NotAllowedError') },
  }

  await assert.rejects(attachCameraPreview(video, { id: 'local-camera' }), /play denied/)
})
