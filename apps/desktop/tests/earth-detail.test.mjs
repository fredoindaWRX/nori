import test from 'node:test'
import assert from 'node:assert/strict'
import {earthTileError} from '../src/scene/earth-detail.ts'

test('Earth close navigation requests finer 3D detail without changing far-view budget',()=>{
  assert.equal(earthTileError(3),2)
  assert.equal(earthTileError(10000),2)
  assert.equal(earthTileError(55000),5)
  assert.equal(earthTileError(100000),8)
  assert.equal(earthTileError(25000000),8)
  for(const value of [NaN,Infinity,-1])assert.equal(earthTileError(value),8)
})
