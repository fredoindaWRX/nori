import assert from 'node:assert/strict'
import{createRequire}from'node:module'
import vm from'node:vm'
const a=createRequire(import.meta.url)('@electron/asar'),p='C:/Nori/.work/startup-music-removal/app.asar.next'
const s=a.extractFile(p,'dist\\assets\\index-ari1On6a.js').toString()
const start=s.indexOf('var jQ=new Map'),end=s.indexOf('var YQ=',start);assert.ok(start>0&&end>start)
const created=[];let played=0
const context=vm.createContext({Audio:class{constructor(src){this.src=src;this.paused=true;created.push(src)}addEventListener(){}play(){played++;this.paused=false;return Promise.resolve()}pause(){this.paused=true}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},performance:{now:()=>0}})
vm.runInContext(s.slice(start,end),context)
vm.runInContext('HQ();JQ(true);JQ(false)',context)
assert.deepEqual(created,['/audio/work.mp3']);assert.equal(played,0)
vm.runInContext('qQ(true)',context);assert.equal(played,1)
assert.ok(!s.includes('boot-music')&&!s.includes('deep-ambient.wav')&&!s.includes('KQ()'))
console.log(JSON.stringify({passed:true,startupMusicAssets:0,audioCreatedOnEnable:created,startupPlaybackCalls:0,workCueStillPlays:true}))
