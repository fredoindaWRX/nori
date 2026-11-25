import test from 'node:test'
import assert from 'node:assert/strict'
import {SphereGeometry,Vector3} from 'three'
import {earthLocationFromUV,earthDirection,parseEarthDestination} from '../src/scene/earth-coordinates.ts'

test('globe texture UV handoff and return direction agree with actual sphere vertices',()=>{
  const geometry=new SphereGeometry(1,32,16)
  try{
    const uv=geometry.attributes.uv,position=geometry.attributes.position
    for(let i=0;i<uv.count;i++){
      const location=earthLocationFromUV(uv.getX(i),uv.getY(i))
      assert.ok(location)
      const direction=new Vector3(...earthDirection(location.latitude,location.longitude))
      assert.ok(direction.distanceTo(new Vector3().fromBufferAttribute(position,i))<1e-6)
    }
  }finally{geometry.dispose()}
})

test('direct geographic navigation validates latitude and longitude without guessing blanks',()=>{
  assert.deepEqual(parseEarthDestination('42.3601','-71.0589'),{latitude:42.3601,longitude:-71.0589})
  assert.deepEqual(parseEarthDestination('-90','180'),{latitude:-90,longitude:180})
  for(const [lat,lon] of [['','0'],['0',' '],['91','0'],['0','181'],['NaN','0'],['0','Infinity']])
    assert.equal(parseEarthDestination(lat,lon),null)
})

test('coordinate conversion rejects invalid data and wraps repeating texture seams',()=>{
  assert.deepEqual(earthLocationFromUV(.5,.5),{latitude:0,longitude:0})
  assert.deepEqual(earthLocationFromUV(1.25,.5),{latitude:0,longitude:-90})
  for(const [u,v] of [[NaN,.5],[.5,Infinity],[.5,-.1],[.5,1.1]])assert.equal(earthLocationFromUV(u,v),null)
  assert.throws(()=>earthDirection(91,0),/Invalid/)
})
