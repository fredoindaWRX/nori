import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {providerFailureGate} from '../src/scene/earth-provider-policy.ts'

test('Earth provider callbacks are bound to active sources and fallback resets provider label',()=>{
  const source=readFileSync(new URL('../src/scene/CesiumSurface.tsx',import.meta.url),'utf8')
  assert.match(source,/live\.imageryLayers\.get\(0\)\.imageryProvider === imagery/)
  assert.match(source,/terrainFallback\(live\.terrainProvider === terrain\)/)
  assert.match(source,/instance\.scene\.globe\.show = true\s+setConnection\(baseProvider\.current\)/)
})

test('provider errors trigger one fallback and ignore stale provider events',()=>{
  const gate=providerFailureGate(3)
  assert.equal(gate(false),false)
  assert.equal(gate(true),false)
  assert.equal(gate(false),false)
  assert.equal(gate(true),false)
  assert.equal(gate(true),true)
  assert.equal(gate(true),false)
  assert.equal(gate(false),false)
  for(const value of [0,-1,1.5,NaN])assert.throws(()=>providerFailureGate(value),/Invalid/)
})
