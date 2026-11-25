import test from 'node:test'
import assert from 'node:assert/strict'
import {parseAction,roomColor,HUE_COLOR_NAMES} from '../bridge/hue.mjs'
import {homeDomains,bindHomeCall} from '../bridge/home-intent-binding.mjs'
import {parseTvAction} from '../bridge/samsung-tv.mjs'

test('Hue parser shares existing off precedence and brightness limits with home binding',()=>{
 assert.deepEqual(parseAction('turn off red room lights'),{on:false})
 assert.deepEqual(parseAction('set lights to 0 percent'),{on:false})
 assert.equal(parseAction('set lights to 999 percent').bri,254)
 assert.deepEqual(parseAction('hello'),{})
})
test('TV parser exposes bounded actions without treating discussion as commands',()=>{
 assert.equal(parseTvAction('what is on TV tonight?'),null)
 assert.equal(parseTvAction('do not turn off the TV'),null)
 assert.equal(parseTvAction('turn the TV volume up 3').keys.length,3)
 assert.ok(parseTvAction('turn the TV volume up 11').unsupported)
})
test('home intent imports resolve and room colors use the same supported palette',()=>{
 for(const color of HUE_COLOR_NAMES){
  assert.equal(roomColor(`office ${color}`),true)
  assert.equal(parseAction(`set office lights to ${color}`).color,color)
  assert.equal(homeDomains(`set office to ${color}`).has('hue'),true)
 }
 assert.equal(roomColor('office chartreuse'),false)
 assert.equal(homeDomains('review my source code').size,0)
 assert.equal(bindHomeCall('unknown',{},'hello').ok,false)
 assert.equal(bindHomeCall('hue_lights',{command:'on',target:'office'},'do not turn on office lights').ok,false)
})
