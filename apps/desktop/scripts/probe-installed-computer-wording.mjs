import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const receipt=JSON.parse(readFileSync('C:/Nori/verification/computer-control-wording-rollback/prepared.json'))
for(const item of receipt.updates){
  const bytes=readFileSync(receipt.installedRoot+'/'+item.relative)
  if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Installed hash mismatch: '+item.relative)
}
const code=`
const {requestsComputerControl,runComputerTask}=await import('file:///C:/Program%20Files/Nori/resources/app.asar/bridge/computer-agent.mjs');
const goal='use my computer work with codex in the nori core work 1';
if(!requestsComputerControl(goal))throw Error('Exact command not recognized');
try{for await(const part of runComputerTask(goal))void part;throw Error('Unapproved task unexpectedly succeeded')}
catch(error){if(!error.message.includes('choose a window and allow it first'))throw error;process.send({kind:'probe-complete'})}
`
const child=spawn(receipt.installedRoot+'/Nori.exe',['--input-type=module','-e',code],{
  env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],timeout:15000})
let completed=false,error='',calls=0
child.stderr.on('data',bytes=>{error+=bytes.toString()})
child.on('message',message=>{
  if(message.kind==='nori-computer-call'){
    if(message.operation!=='status'){child.kill();return}
    calls++
    child.send({kind:'nori-computer-result',id:message.id,result:{active:false}})
  }
  if(message.kind==='probe-complete')completed=true
})
const exitCode=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)})
if(exitCode!==0||!completed||calls!==1)throw Error('Installed exact-command test failed: '+error)
console.log(JSON.stringify({passed:true,installedFilesVerified:receipt.updates.length,exactUserWordingRecognized:true,
  installedElectronHostIpc:true,missingApprovalBlocked:true,desktopActions:0,screenCaptured:false,attendedUiVerified:false}))
