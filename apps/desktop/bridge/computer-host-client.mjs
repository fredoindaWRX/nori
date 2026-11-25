import {randomUUID} from 'node:crypto'

export function computerHostCall(operation,args={}, {signal,timeoutMs=120000}={}){
  if(typeof process.send!=='function'||!process.connected)return Promise.reject(Error('Nori’s native computer-control connection is unavailable.'))
  return new Promise((resolve,reject)=>{
    const id=randomUUID()
    let settled=false
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);process.off('message',receive);process.off('disconnect',disconnected);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result)}
    const receive=message=>{if(message?.kind==='nori-computer-result'&&message.id===id)finish(message.error?Error(message.error):null,message.result)}
    const disconnected=()=>finish(Error('The native computer-control connection closed.'))
    const abort=()=>{if(process.connected)try{process.send({kind:'nori-computer-call',id:randomUUID(),operation:'stop',args:{}},()=>{})}catch{};finish(Error('Computer task stopped.'))}
    const timer=setTimeout(()=>{abort()},Math.min(15*60_000,Math.max(1000,timeoutMs)))
    process.on('message',receive)
    process.on('disconnect',disconnected)
    signal?.addEventListener('abort',abort,{once:true})
    if(signal?.aborted)return abort()
    try{process.send({kind:'nori-computer-call',id,operation,args},error=>{if(error)finish(error)})}catch(error){finish(error)}
  })
}
