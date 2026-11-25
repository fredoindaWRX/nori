const {realpathSync,lstatSync}=require('node:fs')
const {resolve,relative,isAbsolute}=require('node:path')
const {pathToFileURL}=require('node:url')

// In-process ownership: no detached child, borrowed listener, or port takeover.
async function startProjectMonitor({root,port=8790,signal}={}) {
  if(signal?.aborted)throw Error('Project monitor startup cancelled')
  if(!Number.isInteger(port)||port<0||port>65535||(port!==0&&port<1024))throw Error('Invalid project monitor port')
  const physicalRoot=realpathSync(root),entry=resolve(physicalRoot,'integrations/project-monitor/server.mjs')
  const actual=realpathSync(entry),delta=relative(physicalRoot,actual)
  if(lstatSync(entry).isSymbolicLink()||delta.startsWith('..')||isAbsolute(delta)||actual.toLowerCase()!==entry.toLowerCase())
    throw Error('Project monitor entry is linked or outside Nori')
  const {createMonitor}=await import(pathToFileURL(actual).href)
  const server=createMonitor()
  let stopping,rejectStartup
  const stop=()=>stopping??=new Promise((resolveStop,reject)=>{
    server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolveStop())
    server.closeIdleConnections?.()
    server.closeAllConnections?.()
  }).finally(()=>signal?.removeEventListener('abort',abort))
  const abort=()=>{rejectStartup?.(Error('Project monitor startup cancelled'));void stop().catch(()=>{})}
  signal?.addEventListener('abort',abort,{once:true})
  try {
    if(signal?.aborted)throw Error('Project monitor startup cancelled')
    await new Promise((ready,reject)=>{
      rejectStartup=reject
      const failed=error=>{server.removeListener('listening',listening);reject(error)}
      const listening=()=>{server.removeListener('error',failed);ready()}
      server.once('error',failed);server.once('listening',listening)
      server.listen(port,'127.0.0.1')
    })
    rejectStartup=undefined
    if(signal?.aborted)throw Error('Project monitor startup cancelled')
    return {endpoint:`http://127.0.0.1:${server.address().port}`,stop}
  }catch(error){await stop();throw error}
}
module.exports={startProjectMonitor}
