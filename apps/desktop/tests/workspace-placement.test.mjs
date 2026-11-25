import test from 'node:test'
import assert from 'node:assert/strict'
import {visibleScreens,workspaceKey,occupiedArea,placeEntity} from '../src/workspace/placement.ts'
const left={id:'left',label:'Left',primary:true,scaleFactor:1,x:0,y:0,width:1000,height:800}
const right={...left,id:'right',label:'Right',primary:false,x:1000}
const previous={selected:'left',movedAt:0,compact:false,corner:0}
const state={screens:[left,right],bounds:{x:0,y:0,width:2000,height:800},viewport:{x:0,y:0,width:2000,height:800},spanning:true,enabled:true}
test('stacked panels count their covered pixels once and ignore off-screen/invalid rectangles',()=>{
  const panel={x:0,y:0,width:400,height:400}
  assert.equal(occupiedArea(left,[panel,panel]),160000)
  assert.equal(occupiedArea(left,[panel,{...panel,x:200}]),240000)
  assert.equal(occupiedArea(left,[{...panel,x:-200},{...panel,x:2000},{...panel,width:NaN}]),80000)
})
test('entity chooses clear second display after dwell without bouncing on small changes',()=>{
  const busy=[{x:0,y:0,width:1000,height:600}]
  assert.equal(placeEntity([left,right],busy,previous,2000).presence.selected,'left')
  const next=placeEntity([left,right],busy,previous,3000)
  assert.equal(next.presence.selected,'right')
  assert.deepEqual(next.view,{x:1000,y:0,width:1000,height:800})
  assert.equal(placeEntity([left,right],[{x:1000,y:0,width:1000,height:600}],next.presence,3500).presence.selected,'right')
})
test('entity compacts with hysteresis and remains inside selected display when both are busy',()=>{
  const panels=[{x:0,y:0,width:1000,height:500},{x:1000,y:0,width:1000,height:500}]
  const next=placeEntity([left,right],panels,previous,3000)
  assert.equal(next.presence.compact,true)
  assert.ok(next.view.x>=0 && next.view.y>=0 && next.view.x+next.view.width<=1000 && next.view.y+next.view.height<=800)
  assert.equal(placeEntity([left],[{x:0,y:0,width:1000,height:100}],next.presence,3500).presence.compact,true)
  assert.equal(placeEntity([left],[],next.presence,4000).presence.compact,false)
})
test('unplug/identity changes choose a surviving display; no display gives no placement',()=>{
  assert.equal(placeEntity([right],[],previous,3000).presence.selected,'right')
  assert.equal(placeEntity([],[],previous,3000),null)
})
test('monitor rearrangement at identical viewport size changes reset key while enumeration reorder does not',()=>{
  assert.notEqual(workspaceKey(state,2000,800),workspaceKey({...state,screens:[{...left,x:1000},{...right,x:0}]},2000,800))
  assert.notEqual(workspaceKey(state,2000,800),workspaceKey({...state,screens:[left,{...right,id:'new'}]},2000,800))
  assert.equal(workspaceKey(state,2000,800),workspaceKey({...state,screens:[right,left]},2000,800))
})
test('negative-origin and vertically offset displays map and clip to renderer DIPs',()=>{
  const s={...state,viewport:{x:-1000,y:-200,width:2000,height:1000},screens:[{...left,x:0},{...right,x:-1000,y:-200}]}
  assert.deepEqual(visibleScreens(s,2000,1000).map(d=>[d.id,d.x,d.y,d.width,d.height]),[['left',1000,200,1000,800],['right',0,0,1000,800]])
  assert.deepEqual(visibleScreens({...state,viewport:{x:200,y:0,width:800,height:800}},800,800).map(d=>[d.id,d.x,d.width]),[['left',0,800]])
})
