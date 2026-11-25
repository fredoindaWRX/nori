import test from 'node:test'
import assert from 'node:assert/strict'
import { mentionsGraphicsHardware } from '../bridge/hardware-facts.mjs'

test('this PC\'s card readout is attached for questions about his own cards', () => {
  for (const text of ['how much vram is my gpu using', 'what gpus do you have', 'is the helper model on the rx 480',
    'i added a second gpu to the system', 'how much video memory is in use', 'compare my 4080 with the rx 480 in this pc'])
    assert.equal(mentionsGraphicsHardware(text), true, text)
})

test('a general GPU product or web question does not get his own cards attached', () => {
  for (const text of ['search the web for the RTX 5080 power draw, then look up the RTX 4080 Super power draw, then tell me in two lines which uses less',
    'what is the tdp of the rtx 5090', 'rtx 5080 vs 4080 super benchmarks', 'look up the price of a geforce rtx 5070'])
    assert.equal(mentionsGraphicsHardware(text), false, text)
})
