import {localEndpoint,localFetch} from './local-policy.mjs'

/** Shared GPU handoff is optional for old installs, mandatory when desktop advertises it. */
export async function withLocalVideoModelLease(work,{signal,fetcher=localFetch,environment=process.env,mediaKind='video'}={}){
  if(!['image','video'].includes(mediaKind))throw Error('Unsupported local media resource kind')
  if(!environment.NORI_VIDEO_LEASE_URL&&!environment.NORI_VIDEO_LEASE_TOKEN)return work()
  const url=localEndpoint('NORI_VIDEO_LEASE_URL',environment.NORI_VIDEO_LEASE_URL,'')
  const token=environment.NORI_VIDEO_LEASE_TOKEN
  if(!/^[a-f0-9]{64}$/.test(token??''))throw Error('Invalid local video resource capability')
  const request=(path,leaseId,timeout=120000)=>fetcher(url+path,{method:'POST',headers:{authorization:'Bearer '+token,...(leaseId?{'x-nori-video-lease':leaseId}:{})},signal:AbortSignal.timeout(timeout)})
  signal?.throwIfAborted()
  // Do not abort an unacknowledged acquisition: the desktop may already be pausing.
  const response=await request('/acquire')
  const ack=await response.json()
  if(!response.ok||!/^[-a-f0-9]{36}$/.test(ack.leaseId??''))throw Error(`Desktop could not lend the GPU to this ${mediaKind} request`)
  const timer=setInterval(()=>{void request('/heartbeat',ack.leaseId,10000).catch(()=>{})},15000)
  timer.unref()
  let result,failure
  try{signal?.throwIfAborted();result=await work()}catch(error){failure=error}
  finally{
    clearInterval(timer)
    // Cleanup may take 120s and the model's normal startup budget is 90s.
    try{const restored=await request('/release',ack.leaseId,300000);if(!restored.ok)throw Error('Desktop could not restore the local language model')}
    catch(error){failure=failure?new AggregateError([failure,error],'Video and local-model restoration failed'):error}
  }
  if(failure)throw failure
  return result
}
