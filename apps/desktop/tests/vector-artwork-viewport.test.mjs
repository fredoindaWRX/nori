import test from 'node:test'
import assert from 'node:assert/strict'
import {vectorArtworkViewport} from '../bridge/artcraft-mcp-tools.mjs'

test('vector canvas follows root pixel dimensions and viewBox fallback',()=>{
  assert.deepEqual(vectorArtworkViewport('<svg width="240" height="160">'),{width:240,height:160})
  assert.deepEqual(vectorArtworkViewport("<svg width='320px' height='200px'>"),{width:320,height:200})
  assert.deepEqual(vectorArtworkViewport('<svg viewBox="0 0 640 480">'),{width:640,height:480})
  assert.deepEqual(vectorArtworkViewport('<svg>'),{width:1200,height:800})
})

test('invalid or unbounded vector dimensions are rejected before dispatch',()=>{
  for(const svg of ['<svg width="100%">','<svg width="0">','<svg height="8193">','<svg width="1.5">','<svg viewBox="0 0 NaN 3">']) {
    assert.throws(()=>vectorArtworkViewport(svg))
  }
})
