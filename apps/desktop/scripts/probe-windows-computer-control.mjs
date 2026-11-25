import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createComputerControlSession} from '../bridge/computer-control-session.mjs'
import {executeWindowsComputerAction} from '../bridge/windows-computer-executor.mjs'

const executable=join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe')
const fixture=spawn(executable,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./computer-control-fixture.ps1',import.meta.url))],
  {shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:35000})
const exited=new Promise(resolve=>fixture.once('exit',code=>resolve(code)))
let session
try{
  const lines=createInterface({input:fixture.stdout})
  const iterator=lines[Symbol.asyncIterator]()
  const first=await iterator.next()
  assert.equal(first.done,false)
  const target=JSON.parse(first.value)
  assert.equal(target.processId,fixture.pid)
  session=createComputerControlSession({...target,approved:true,execute:executeWindowsComputerAction,
    confirmAction:async request=>request.processId===fixture.pid})
  let observed,field
  for(let attempt=0;attempt<10;attempt++){
    observed=await session.call('inspect')
    field=observed.elements.find(element=>element.canSetText)
    if(field)break
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  assert.ok(field,'Synthetic text control must expose ValuePattern: '+JSON.stringify(observed.elements))
  await session.call('set_text',{snapshotId:observed.snapshotId,elementId:field.id,text:'NORI_COMPUTER_CONTROL_OK'})
  observed=await session.call('inspect')
  const button=observed.elements.find(element=>element.name==='Verify synthetic text'&&element.canInvoke)
  assert.ok(button,'Synthetic button must expose InvokePattern')
  await session.call('invoke',{snapshotId:observed.snapshotId,elementId:button.id})
  const result=JSON.parse((await iterator.next()).value)
  assert.equal(result.verifiedText,'NORI_COMPUTER_CONTROL_OK')
  lines.close()
  assert.equal(await exited,0)
  console.log(JSON.stringify({passed:true,realWindowsAutomation:true,syntheticWindowOnly:true,
    typedTextReadBack:true,buttonInvoked:true,screenCaptured:false,installedChatConnected:false}))
}finally{
  session?.stop()
  if(fixture.exitCode===null)fixture.kill()
}
