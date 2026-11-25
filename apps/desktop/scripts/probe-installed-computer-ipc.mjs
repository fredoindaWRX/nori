import {spawn} from 'node:child_process'
const moduleUrl='file:///C:/Program%20Files/Nori/resources/app.asar/bridge/computer-host-client.mjs'
const code=`const {computerHostCall}=await import(${JSON.stringify(moduleUrl)});const result=await computerHostCall('status');if(result.active!==false)throw Error('Unexpected host status');process.send({kind:'probe-complete',passed:true});`
const child=spawn('C:/Program Files/Nori/Nori.exe',['--input-type=module','-e',code],{
  env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},shell:false,windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],timeout:10000})
let observed=false,completed=false,error=''
child.stderr.on('data',bytes=>{error=(error+bytes.toString()).slice(-1000)})
child.on('message',message=>{
  if(message.kind==='nori-computer-call'){
    if(message.operation!=='status')throw Error('Unexpected computer action')
    observed=true
    child.send({kind:'nori-computer-result',id:message.id,result:{active:false}})
  }
  if(message.kind==='probe-complete'&&message.passed===true)completed=true
})
const exitCode=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)})
if(exitCode!==0||!observed||!completed)throw Error('Installed computer IPC probe failed: '+error)
console.log(JSON.stringify({passed:true,installedElectronIpc:true,installedBridgeClient:true,desktopActionExecuted:false}))
