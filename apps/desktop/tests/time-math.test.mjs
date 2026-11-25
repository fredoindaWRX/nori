// 2026-11-19: clock times, time zones and weekdays are computed by code and handed to her as an app fact.
import test from 'node:test'
import assert from 'node:assert/strict'
import { clockTimes, durations, timeMathBlock, TIME_MATH_HEADER } from '../bridge/time-math.mjs'

const now = new Date('2026-11-19T19:30:00')
const lines = text => timeMathBlock(text, { now }).split('\n').slice(1).join('\n')

test('clock times and durations are read in order', () => {
  assert.deepEqual(clockTimes('from 10:47 PM to 6:15 AM, or 02:10 and 12 AM').map(t => t.minutes), [1367, 375, 130, 0])
  assert.deepEqual(durations('lasts 2 hours 45 minutes, then a 20-minute break, 1.5 h').map(d => d.minutes), [120, 45, 20, 90])
})

test('spans between times, across midnight', () => {
  assert.match(lines('How many minutes from 10:47 PM to 6:15 AM the next day?'), /is 448 minutes \(7 h 28 min\)/)
  assert.match(lines('How long from 9:20 AM to 1:05 PM?'), /225 minutes/)
})

test('a start time plus durations, and a time before', () => {
  assert.match(lines('A meeting starts at 10:40 AM and lasts 95 minutes, then there is a 20-minute break, then another 50 minutes. What time does it end? Reply like 1:05 PM.'), /= 1:25 PM\./)
  assert.match(lines('My flight leaves at 11:50 PM and takes 3 hours 20 minutes. When do I land?'), /= 3:10 AM \(next day\)/)
  assert.match(lines('I need to leave 40 minutes before 8:15 AM. What time do I leave?'), /= 7:35 AM/)
})

test('evenly spaced times, time zones, least common multiple, minutes to hours', () => {
  assert.match(lines('Errors at 02:10, 02:25 and 02:40. If the pattern holds, when is the 7th error?'), /7th is 03:40/)
  assert.match(lines('Convert 3:45 PM Eastern Standard Time (UTC-5) to UTC.'), /is 20:45 \(8:45 PM\) at UTC\+0/)
  assert.match(lines('What time is 9 AM PST in GMT?'), /17:00/)
  assert.match(lines('A backup runs every 6 days and a scan every 8 days. In how many days do they run on the same day?'), /after 24 days/)
  assert.match(lines('How many hours and minutes is 400 minutes?'), /6 h 40 min/)
})

test('weekdays from a stated today, a stated date, the real calendar and the real today', () => {
  assert.match(lines('If today is Friday, what day is it 100 days from now?'), /is a Sunday/)
  assert.match(lines('2026-11-17 is a Tuesday. What weekday is 2026-12-25?'), /2026-12-25 is a Friday/)
  assert.match(lines('What day of the week was July 4, 1976?'), /1976-07-04 is a Sunday/)
  assert.match(lines('How many days until December 25, 2026 from November 19, 2026?'), /is 36 days/)
  assert.match(lines('What day is it 45 days from today?'), /Today is Thursday 2026-11-19; 45 days from today is Sunday 2027-01-03/)
})

// Clock-hand angles are computed since 2026-11-21 (reason-math.test.mjs); other clock-shows questions still get nothing.
test('nothing for ordinary messages, non-angle clock puzzles, or ambiguous times', () => {
  for (const text of ['Remind me at 5 PM', 'What is 37 * 46?', 'A clock shows 3:15. Which hand is longer?',
    'Write a poem about Friday.', 'How many minutes from 9:20 to 1:05?', ''])
    assert.equal(timeMathBlock(text, { now }), '', text)
  assert.ok(timeMathBlock('If today is Monday, what day is it in 3 days?', { now }).startsWith(TIME_MATH_HEADER))
})
