'use strict'
const {execFile}=require('node:child_process')
const {promisify}=require('node:util')
const run=promisify(execFile)
/** Release idle Comfy allocations before restoring the large local language model. */
async function releaseVideoRuntime(endpoint,{fetcher=fetch,readFreeVRAM=async()=>Number((await run('nvidia-smi',['--query-gpu=memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:10000})).stdout.trim().split(/\r?\n/)[0])*1024**2,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,timeoutMs=120000,
  requiredFreeVramBytes=12*1024**3,isOwnedRuntimeStopped=()=>false}={}){
  if(!Number.isSafeInteger(requiredFreeVramBytes)||requiredFreeVramBytes<1||requiredFreeVramBytes>512*1024**3)throw Error('Invalid model restoration memory requirement')
  if(typeof isOwnedRuntimeStopped!=='function')throw TypeError('Owned runtime exit check required')
  const url=new URL(endpoint)
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Video cleanup requires a local runtime root URL')
  const deadline=now()+timeoutMs
  let freed=false
  while(now()<deadline){
    if(await isOwnedRuntimeStopped()===true){
      if(await readFreeVRAM()>=requiredFreeVramBytes)return
      await sleep(1000);continue
    }
    const response=await fetcher(new URL('/queue',url),{redirect:'error',signal:AbortSignal.timeout(5000)})
    if(!response.ok)throw Error('Video runtime queue is unavailable during restoration')
    const queue=await response.json()
    if(!Array.isArray(queue.queue_running)||!Array.isArray(queue.queue_pending))throw Error('Invalid video queue during restoration')
    if(queue.queue_running.length===0&&queue.queue_pending.length===0){
      if(!freed){
        const unload=await fetcher(new URL('/free',url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({unload_models:true,free_memory:true}),redirect:'error',signal:AbortSignal.timeout(5000)})
        if(!unload.ok)throw Error('Video runtime refused idle model release')
        freed=true
      }
      if(await readFreeVRAM()>=requiredFreeVramBytes)return
    }
    await sleep(1000)
  }
  throw Error('GPU memory did not become available for language-model restoration; no unrelated job was interrupted')
}
module.exports={releaseVideoRuntime}
