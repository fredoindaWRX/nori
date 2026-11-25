const test = require('node:test')
const assert = require('node:assert/strict')
const { workspaceLayout, fitWindowBounds } = require('../desktop/workspace-layout.cjs')
const display = (id,x,y,width,height,scaleFactor=1) => ({ id,workArea:{x,y,width,height},scaleFactor })
test('workspace preserves a negative-origin monitor and mixed DPI desktop units', () => {
  const layout = workspaceLayout([display(1,0,0,1920,1040),display(2,-2560,-200,2560,1400,1.5)],1)
  assert.deepEqual(layout.bounds,{x:-2560,y:-200,width:4480,height:1400})
  assert.equal(layout.screens[1].scaleFactor,1.5)
  assert.equal(layout.screens[0].primary,true)
})
test('single display and vertical layouts stay within actual display work areas', () => {
  assert.deepEqual(workspaceLayout([display(1,0,0,1920,1040)],1).bounds,{x:0,y:0,width:1920,height:1040})
  assert.deepEqual(workspaceLayout([display(1,0,0,1920,1040),display(2,0,-1080,1920,1080)],1).bounds,{x:0,y:-1080,width:1920,height:2120})
})
test('restored windows are brought back onto a surviving monitor after unplug',()=>{
  assert.deepEqual(fitWindowBounds({x:-1800,y:200,width:1440,height:940},{x:0,y:0,width:1920,height:1040}),{x:0,y:100,width:1440,height:940})
  assert.deepEqual(fitWindowBounds({x:-1500,y:0,width:3000,height:2000},{x:-1920,y:0,width:1920,height:1032}),{x:-1920,y:0,width:1920,height:1032})
})
