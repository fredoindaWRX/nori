import test from 'node:test'
import assert from 'node:assert/strict'
import { hasUsableAudioTracks, onAudioTrackEnded, stopAudioTracks } from '../src/lib/audio-track-recovery.ts'

function fakeTrack(readyState = 'live') {
  const listeners = new Set()
  return {
    readyState,
    addEventListener(type, listener) {
      if (type === 'ended') listeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'ended') listeners.delete(listener)
    },
    end() {
      this.readyState = 'ended'
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

test('a live microphone track ending reports one recoverable failure and detaches', () => {
  const track = fakeTrack()
  let failures = 0
  const cleanup = onAudioTrackEnded(track, () => { failures++ })

  assert.equal(track.listenerCount(), 1)
  track.end()
  track.end()
  assert.equal(failures, 1)
  assert.equal(track.listenerCount(), 0)
  cleanup()
})

test('cleanup prevents a stopped listener from reacting to a later track end', () => {
  const track = fakeTrack()
  let failures = 0
  const cleanup = onAudioTrackEnded(track, () => { failures++ })
  cleanup()
  track.end()

  assert.equal(failures, 0)
  assert.equal(track.listenerCount(), 0)
})

test('an already-ended microphone track fails immediately without registering a listener', () => {
  const track = fakeTrack('ended')
  let failures = 0
  onAudioTrackEnded(track, () => { failures++ })

  assert.equal(failures, 1)
  assert.equal(track.listenerCount(), 0)
})

test('a partially ended shared stream is unusable and all of its tracks are released', () => {
  const live = { readyState: 'live', stopped: false, stop() { this.stopped = true } }
  const ended = { readyState: 'ended', stopped: false, stop() { this.stopped = true } }
  assert.equal(hasUsableAudioTracks([live]), true)
  assert.equal(hasUsableAudioTracks([live, ended]), false)
  assert.equal(hasUsableAudioTracks([]), false)

  stopAudioTracks([live, ended])
  assert.equal(live.stopped, true)
  assert.equal(ended.stopped, true)
})
