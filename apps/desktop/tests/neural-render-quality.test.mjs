import test from 'node:test'
import assert from 'node:assert/strict'
import { neuralRenderQuality } from '../src/scene/neural-render-quality.ts'

test('4K detail is capped at 3840 by 2160 rather than using an 8K allocation', () => {
  const result = neuralRenderQuality(1920,1080,1,16384,true)
  assert.deepEqual(result,{dpr:2,width:3840,height:2160,hardwareLimited:false})
  const portrait = neuralRenderQuality(1080,1920,1,16384,true)
  assert.equal(portrait.width,2160); assert.equal(portrait.height,3840)
})
test('render sizing respects hardware limit, aspect and total pixel budget', () => {
  const limited = neuralRenderQuality(1920,1080,1,3000,true)
  assert.equal(limited.width,3000);assert.ok(limited.height<=3000);assert.equal(limited.hardwareLimited,true)
  const tall = neuralRenderQuality(644,1244,2,8192,true)
  assert.ok(tall.width*tall.height<=8_294_400)
  assert.ok(Math.abs(tall.width/tall.height-644/1244)<.001)
  assert.throws(()=>neuralRenderQuality(0,1080,1,8192,true))
})
test('native mode retains native display density', () => {
  assert.equal(neuralRenderQuality(1920,1080,1.5,8192,false).dpr,1.5)
})
test('brain navigation temporarily uses native density and restores selected detail', () => {
  const moving = neuralRenderQuality(1920,1080,2,8192,true,true)
  assert.equal(moving.dpr,1)
  assert.deepEqual(neuralRenderQuality(1920,1080,2,8192,true),{dpr:2,width:3840,height:2160,hardwareLimited:false})
})
