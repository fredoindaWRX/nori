import test from 'node:test'
import assert from 'node:assert/strict'
import { planVideoDuration, resolveVideoDurationSeconds } from '../bridge/video-duration.mjs'

test('duration planner defaults, whole frames, and long jobs have no two-second ceiling', () => {
  assert.equal(resolveVideoDurationSeconds('Create a video of a red 1993 Del Sol at 16 fps.'), 8)
  assert.deepEqual(planVideoDuration(8), { totalFrames: 128, durationSeconds: 8, segmentCount: 4 })
  assert.deepEqual(planVideoDuration(0.001), { totalFrames: 1, durationSeconds: 0.0625, segmentCount: 1 })
  assert.deepEqual(planVideoDuration(3600), { totalFrames: 57600, durationSeconds: 3600, segmentCount: 1746 })
  assert.ok(Object.isFrozen(planVideoDuration(10)))
})

test('numeric, spelled, fractional, and compound user durations are understood', () => {
  const examples = [
    ['Create a 30-second video.', 30], ['Create a 2.5 minute clip.', 150],
    ['A video for thirty seconds.', 30], ['A twenty-five second video.', 25],
    ['Make it half a minute.', 30], ['Make it half minute.', 30],
    ['Make a one and a half minute video.', 90], ['Make it an hour and a half.', 5400],
    ['Make it 1 minute 30 seconds.', 90], ['Make it 1min30sec.', 90],
    ['Make it one minute and thirty seconds.', 90], ['Make it 1 hour, 2 minutes, and 3 seconds.', 3723],
    ['Make it a quarter minute.', 15], ['Make it two hundred and thirty seconds.', 230],
    ['Make a 30s video of a 1993 Honda accelerating at 60 mph.', 30],
    ['Create a 30 second video; the clip should be 0.5 minutes.', 30],
    ['Create a 1e2 second video.', 100],
    ['Create a 1/2 minute video.', 30], ['Create a one-and-a-half minute video.', 90],
  ]
  for (const [prompt, expected] of examples) assert.equal(resolveVideoDurationSeconds(prompt), expected, prompt)
})

test('the last explicit user refinement wins without assistant duration contamination', () => {
  assert.equal(resolveVideoDurationSeconds('Create a 5-second video.\nRequested refinement: Make it thirty seconds.\nRequested refinement: Make it realistic.\nVisual reference from the preceding discussion: use a 2-second animation.'), 30)
  assert.equal(resolveVideoDurationSeconds('Create a 5-second video.\nRequested refinement: Make it realistic.'), 5)
  assert.equal(resolveVideoDurationSeconds('Create a video.\nVisual reference from the preceding discussion: generate it for 120 seconds.'), 8)
  assert.equal(resolveVideoDurationSeconds('Create a -5 second video.\nRequested refinement: Make it 10 seconds.'), 10)
  assert.equal(resolveVideoDurationSeconds('Create a 5-second video.\nRequested refinement: Make it realistic.\nVisual reference from the preceding discussion: use a 2-second animation.\nRequested refinement: Make it sixty seconds.'), 60)
  assert.throws(() => resolveVideoDurationSeconds('Create a 5 second video.\nRequested refinement: Make it zero seconds.'), /positive, finite/)
})

test('explicit video clock durations work without treating a scene clock as duration', () => {
  assert.equal(resolveVideoDurationSeconds('Create a 1:30 video of a red car.'), 90)
  assert.equal(resolveVideoDurationSeconds('Create a video, duration 01:30.'), 90)
  assert.equal(resolveVideoDurationSeconds('Create a video with duration: 01:02:03.'), 3723)
  assert.equal(resolveVideoDurationSeconds('Create a video.\nRequested refinement: Make it 1:30.'), 90)
  assert.equal(resolveVideoDurationSeconds('Create a 1:30 video.\nRequested refinement: Make it thirty seconds.'), 30)
  assert.equal(resolveVideoDurationSeconds('Create a video of a clock showing 1:30.'), 8)
  assert.equal(resolveVideoDurationSeconds('Create a video at 18:30 on a rainy street.'), 8)
  assert.throws(() => resolveVideoDurationSeconds('Create a video, duration 1:99.'), /clock duration/)
  assert.throws(() => resolveVideoDurationSeconds('Create a video, duration -1:30.'), /clock duration/)
  assert.throws(() => resolveVideoDurationSeconds('Create a 1:30 video, duration 60 seconds.'), /Conflicting/)
})

test('invalid and conflicting explicit durations fail rather than silently falling back or clamping', () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity, 1e308, Number.MAX_SAFE_INTEGER, '30', null, undefined]) {
    assert.throws(() => planVideoDuration(value), /positive, finite|too large/, String(value))
  }
  for (const prompt of ['Make a -5 second video.', 'Make a −5 second video.', 'Make it minus five seconds.', 'Make it negative five seconds.', 'Make a 1/0 second video.', 'Make a zero second video.', 'Make a NaN second video.', 'Make an Infinity second video.', 'Make a 1e308 hour video.']) {
    assert.throws(() => resolveVideoDurationSeconds(prompt), /positive, finite|too large/, prompt)
  }
  for (const prompt of ['Make a 5 second or 10 second video.', 'Make a 5-10 second video.', 'Make a 5 to 10 minute video.', 'Make it forever.']) {
    assert.throws(() => resolveVideoDurationSeconds(prompt), /Conflicting|finite/, prompt)
  }
  assert.throws(() => resolveVideoDurationSeconds('Make a 1 1/2 minute video.'), /ambiguous/)
})
