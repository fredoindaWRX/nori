'use strict'
const {execFile}=require('node:child_process')
const {readFileSync}=require('node:fs')
const {join}=require('node:path')

// Stream mode (owner-approved 2026-11-07): while OBS is running, text tasks prefer the 24B-A4B
// over the 35B. Measured live that night: with OBS encoding on the same 16 GB card the 35B wrote
// ~15 tok/s (half its normal speed) and the stream cohost's replies timed out. The owner can turn
// the mode off from chat ("turn off stream mode"), which writes learning/stream-mode.json.
// Detection is a process check only (obs64.exe); nothing here reads OBS or the stream.
const DEFAULTS=Object.freeze({enabled:true})
function readStreamModeSettings(dataRoot){
 try{
  const saved=JSON.parse(readFileSync(join(dataRoot,'learning','stream-mode.json'),'utf8'))
  return {enabled:typeof saved?.enabled==='boolean'?saved.enabled:DEFAULTS.enabled}
 }catch{return {...DEFAULTS}}
}
function obsRunning(signal){
 return new Promise(resolve=>execFile('C:/Windows/System32/tasklist.exe',['/FI','IMAGENAME eq obs64.exe','/NH','/FO','CSV'],
  {windowsHide:true,timeout:5000,maxBuffer:65536,signal},(error,stdout)=>resolve(!error&&/"obs64\.exe"/i.test(String(stdout)))))
}
function createStreamModeDetector({dataRoot,probe=obsRunning,settings=()=>readStreamModeSettings(dataRoot),intervalMs=30_000,onChange}={}){
 if(typeof dataRoot!=='string'||!dataRoot)throw new TypeError('Stream mode needs the data folder for its settings')
 if(!Number.isInteger(intervalMs)||intervalMs<1000)throw new RangeError('Stream mode probe interval must be at least one second')
 let active=false,obs=false,enabled=DEFAULTS.enabled,timer=null,ticking=null
 const tick=()=>{
  if(ticking)return ticking
  ticking=(async()=>{
   try{obs=await probe()}catch{obs=false}
   enabled=settings().enabled
   const next=Boolean(obs&&enabled)
   if(next!==active){active=next;try{onChange?.(active,{obs,enabled})}catch{}}
   return active
  })().finally(()=>{ticking=null})
  return ticking
 }
 const detector={tick,isActive:()=>active,get obsRunning(){return obs},get enabled(){return enabled},
  start(){if(!timer){timer=setInterval(()=>{void tick()},intervalMs);timer.unref?.()}return detector},
  stop(){clearInterval(timer);timer=null}}
 return Object.freeze(detector)
}
module.exports={createStreamModeDetector,readStreamModeSettings,obsRunning,DEFAULTS}
