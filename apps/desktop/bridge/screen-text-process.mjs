import {spawn} from 'node:child_process'
import {join} from 'node:path'

// Resolve cancellation only after the exact owned process closes, never after kill dispatch.
export function runScreenTextWorker({root,worker,image,signal,environment=process.env,capabilityProbe=false,
  spawnProcess=spawn,deadlineMs=15000,cleanupMs=2000}) {
  if(!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>15000||
    !Number.isInteger(cleanupMs)||cleanupMs<1||cleanupMs>2000)throw Error('Bounded OCR deadlines required')
  if(signal?.aborted)return Promise.resolve(null)
  return new Promise((resolveResult,reject)=>{
    let child,timer,cleanupTimer,stopping=false,settled=false,bytes=0,output=''
    const settle=(result,error)=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanupTimer)
      signal?.removeEventListener('abort',stop)
      if(error)reject(error);else resolveResult(result)
    }
    const stop=()=>{
      if(settled||stopping)return;stopping=true;clearTimeout(timer)
      signal?.removeEventListener('abort',stop)
      output=''
      if(!child?.pid)return settle(null)
      cleanupTimer=setTimeout(()=>settle(null,Object.assign(Error('Owned screen-text worker did not close'),
        {code:'NORI_OCR_CLEANUP_FAILED'})),cleanupMs)
      try{if(child.exitCode===null)child.kill()}catch{ /* Wait for close; a kill attempt is not drain proof. */ }
    }
    try{child=spawnProcess(join(environment.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-File',worker,...(capabilityProbe?['-Capability']:[])],{cwd:root,windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']})}
    catch{return settle(null)}
    child.on('error',stop);child.stdin.on('error',stop)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data',part=>{
      if(stopping||settled)return
      bytes+=Buffer.byteLength(part)
      if(bytes>32768)return stop()
      output+=part
    })
    child.once('close',code=>settle(!stopping&&code===0?output:null))
    signal?.addEventListener('abort',stop,{once:true})
    timer=setTimeout(stop,deadlineMs)
    if(signal?.aborted)return stop()
    try{child.stdin.end(image)}catch{stop()}
  })
}
