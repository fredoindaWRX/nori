'use strict'
const {createServer}=require('node:http')
const {randomBytes,randomUUID,timingSafeEqual}=require('node:crypto')
const {startVideoModelOwner}=require('./video-model-lease.cjs')
const {startGptOssService}=require('./gpt-oss-service.cjs')

// The desktop owns this ephemeral capability. It is never saved or exposed off-host.
async function startVideoCapableModelService(options,{
  startService=()=>startGptOssService(options),cleanupVideo,leaseTimeoutMs=120000,
}={}){
  if(typeof cleanupVideo!=='function')throw new TypeError('Owned video runtime cleanup is required before model restoration')
  const owner=await startVideoModelOwner(startService)
  const token=randomBytes(32).toString('hex')
  let active=null,stopping=null,busy=false
  const release=async id=>{
    if(!active||active.id!==id)throw Error('Lease mismatch')
    if(busy)throw Error('Lease transition in progress')
    busy=true
    try{await cleanupVideo();await active.lease.release();active=null}
    catch(error){if(owner.state==='unavailable')active=null;throw error}
    finally{busy=false}
  }
  const server=createServer(async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body))}
    const auth=req.headers.authorization??''
    const expected='Bearer '+token
    if(req.headers.origin||req.method!=='POST'||Buffer.byteLength(auth)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected))){req.resume();reply(403,{error:'Forbidden'});return}
    req.resume()
    try{
      if(req.url==='/acquire'){
        if(active||busy||stopping){reply(409,{error:'Video resource lease unavailable'});return}
        busy=true
        try{
          const lease=await owner.acquire()
          active={lease,id:randomUUID(),touched:Date.now()}
          reply(200,{leaseId:active.id})
        }finally{busy=false}
      }else if(req.url==='/heartbeat'){
        if(!active||active.id!==req.headers['x-nori-video-lease']){reply(409,{error:'Lease mismatch'});return}
        active.touched=Date.now();reply(200,{ok:true})
      }else if(req.url==='/release'){
        await release(req.headers['x-nori-video-lease']);reply(200,{ok:true})
      }else reply(404,{error:'Unknown command'})
    }catch{reply(409,{error:'Local model handoff failed'})}
  })
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})}
  catch(error){await owner.stop();throw error}
  const timer=setInterval(()=>{
    if(active&&!busy&&Date.now()-active.touched>leaseTimeoutMs)void release(active.id).catch(()=>{})
  },Math.min(10000,leaseTimeoutMs))
  timer.unref()
  const control={
    exited:owner.exited,
    get environment(){return {...owner.current.environment,NORI_VIDEO_LEASE_URL:`http://127.0.0.1:${server.address().port}`,NORI_VIDEO_LEASE_TOKEN:token}},
    get videoModelState(){return owner.state},
    stop(){
      if(stopping)return stopping
      stopping=(async()=>{
        clearInterval(timer)
        server.closeAllConnections()
        await new Promise(resolve=>server.close(resolve))
        await owner.stop()
      })()
      return stopping
    },
  }
  return new Proxy(control,{get(target,key,receiver){return key in target?Reflect.get(target,key,receiver):owner.current[key]}})
}
module.exports={startVideoCapableModelService}
