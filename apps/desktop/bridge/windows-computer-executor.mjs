import {spawn} from 'node:child_process'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

// Fixed worker and JSON stdin: model text is never interpreted as shell code.
export const WINDOWS_OPERATIONS=Object.freeze(['list_windows','process_windows','inspect','capture','invoke','set_text','toggle','expand',
  'collapse','select','click','double_click','right_click','scroll','drag','type_text','key'])
export function executeWindowsComputerAction(request,{signal}={}){
  if(process.platform!=='win32')return Promise.reject(Error('Windows computer control requires Windows.'))
  if(!WINDOWS_OPERATIONS.includes(request?.operation))return Promise.reject(Error('Unsupported Windows action.'))
  const executable=join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe')
  const worker=import.meta.url.includes('app.asar')
    ? join(process.resourcesPath,'NoriSuite','apps','desktop','bridge','windows-computer-control.ps1')
    : fileURLToPath(new URL('./windows-computer-control.ps1',import.meta.url))
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['-NoProfile','-NonInteractive','-File',worker],{shell:false,windowsHide:true,
      stdio:['pipe','pipe','pipe'],signal,timeout:20000})
    const limit=request.operation==='capture'?12*1024*1024:256*1024
    let output='',error='',settled=false
    const fail=reason=>{if(!settled){settled=true;reject(reason)}}
    child.on('error',fail)
    child.stdin.on('error',()=>{})
    child.stdout.on('data',bytes=>{
      output+=bytes.toString('utf8')
      if(output.length>limit){child.kill();fail(Error('Windows observation exceeded its limit.'))}
    })
    child.stderr.on('data',bytes=>{error=(error+bytes.toString('utf8')).slice(-1000)})
    child.on('close',code=>{
      if(settled)return
      if(code!==0)return fail(Error(error||'Windows action failed.'))
      try{const result=JSON.parse(output);settled=true;resolve(result)}catch{fail(Error('Windows worker returned an invalid observation.'))}
    })
    child.stdin.end(JSON.stringify(request))
  })
}
