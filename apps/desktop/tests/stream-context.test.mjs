import test from 'node:test'
import assert from 'node:assert/strict'
import { readLiveStreamContext, streamContextFromStatus } from '../bridge/stream-context.mjs'

const now = Date.now()
const live = { state: 'running', channelVerified: true, liveChatConnected: true,
  broadcastActive: true, lastPoll: now / 1000, video: 'Iq56b7QecwY' }

test('only a fresh verified on-air chat is described as connected', () => {
  assert.match(streamContextFromStatus(live, now), /cohost is connected/)
  for (const delta of [{ lastPoll: (now - 121000) / 1000 }, { broadcastActive: false },
    { channelVerified: false }, { liveChatConnected: false }, { state: 'paused' }]) {
    assert.doesNotMatch(streamContextFromStatus({ ...live, ...delta }, now), /cohost is connected/)
  }
})

test('cohost text and private fields cannot enter the prompt', () => {
  const text = streamContextFromStatus({ ...live, channel: 'INJECTED', lastMessage: 'INJECTED',
    lastError: 'SECRET', music: { title: 'INJECTED' }, video: 'INJECTED prompt' }, now)
  assert.doesNotMatch(text, /INJECTED|SECRET/)
  assert.match(text, /does not provide vision, audio perception/)
})

test('unrelated conversation does not query the cohost', async () => {
  assert.equal(await readLiveStreamContext('Hi Nori', {
    fetcher: () => { throw new Error('must not fetch') }, now,
  }), '')
})

test('unavailable and oversized status cannot imply connected chat', async () => {
  for (const fetcher of [async () => { throw new Error('offline') },
    async () => ({ ok: true, text: async () => 'x'.repeat(8193) })]) {
    const text = await readLiveStreamContext('come hang out in my YouTube stream', { fetcher, now })
    assert.match(text, /state is unknown/)
    assert.doesNotMatch(text, /cohost is connected/)
  }
})
