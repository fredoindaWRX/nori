'use strict'
const {appendFileSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync}=require('node:fs')
const {join}=require('node:path')

// Persists the text service's per-request speed records (numbers only, no prompt or reply text)
// to <data>/learning/model-timings.jsonl so slow or timed-out replies can be explained after a
// restart. Bounded: past maxBytes the older half is dropped. A write failure never affects a reply.
function createBoundedLog(dataRoot,name,{maxBytes=512*1024}={}){
 if(typeof dataRoot!=='string'||!dataRoot)throw TypeError('Model timing log requires a data folder')
 const dir=join(dataRoot,'learning'),file=join(dir,name)
 return record=>{
  try{
   mkdirSync(dir,{recursive:true})
   appendFileSync(file,`${JSON.stringify(record)}\n`,'utf8')
   if(statSync(file).size>maxBytes){
    const lines=readFileSync(file,'utf8').trim().split('\n')
    writeFileSync(`${file}.tmp`,`${lines.slice(Math.floor(lines.length/2)).join('\n')}\n`,'utf8')
    renameSync(`${file}.tmp`,file)
   }
  }catch{}
 }
}
const createModelTimingLog=(dataRoot,options)=>createBoundedLog(dataRoot,'model-timings.jsonl',options)
// R84: model loads, failures with the engine's last error lines, exits, stalls and watchdog resets.
const createModelEventLog=(dataRoot,options)=>createBoundedLog(dataRoot,'model-events.jsonl',options)
module.exports={createModelTimingLog,createModelEventLog}
