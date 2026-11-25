import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {join} from 'node:path'
const installedCode=process.argv.includes('--installed')
const modulePath=name=>installedCode?pathToFileURL('C:/Program Files/Nori/resources/app.asar/bridge/'+name):new URL('../bridge/'+name,import.meta.url)
const [{createComputerControlSession},{executeWindowsComputerAction},{runComputerTask}]=await Promise.all([
  import(modulePath('computer-control-session.mjs')),import(modulePath('windows-computer-executor.mjs')),import(modulePath('computer-agent.mjs'))])

const suite='C:/Program Files/Nori/resources/NoriSuite'
const require=createRequire(pathToFileURL('C:/Program Files/Nori/resources/app.asar/desktop/main.cjs'))
const {startGptOssService}=require('./gpt-oss-service.cjs')
Object.assign(process.env,{NORI_ROOT:suite,NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_HERETIC:'0'})
let service,fixture,session
const report={passed:false,installedCode,syntheticWindowOnly:true,screenCaptured:false,installedChatConnected:false}
try{
  service=await startGptOssService({root:suite,contextTokens:4096})
  process.env.NORI_GPT_OSS_URL=service.endpoint
  fixture=spawn(join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./computer-control-fixture.ps1',import.meta.url)),'-KeepOpen'],
    {shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:185000})
  const lines=createInterface({input:fixture.stdout}),iterator=lines[Symbol.asyncIterator]()
  const target=JSON.parse((await iterator.next()).value)
  if(target.processId!==fixture.pid)throw Error('Synthetic fixture identity mismatch')
  let writes=0
  session=createComputerControlSession({...target,approved:true,execute:executeWindowsComputerAction,
    confirmAction:async action=>action.processId===fixture.pid&&action.operation==='set_text'
      &&action.text==='NORI_AGENT_CONTROL_OK'&&writes++===0})
  const hostCall=async(operation,args)=>operation==='status'?{active:true,sessionId:session.id,title:'Synthetic Nori control test'}:session.call(operation,args)
  const parts=[]
  const signal=AbortSignal.timeout(160000)
  for await(const part of runComputerTask('Use my computer to type exactly NORI_AGENT_CONTROL_OK in Synthetic text, then stop. Do not press any button.',{hostCall,signal}))parts.push(part)
  if(writes!==1)throw Error('The model did not perform exactly one approved text action')
  report.passed=true;report.realLocalGptOss=true;report.realWindowsTextReadback=true;report.trace=parts.join('').slice(-3000)
}catch(error){report.error=String(error.stack||error).slice(0,4000);process.exitCode=1}
finally{
  session?.stop()
  if(fixture&&fixture.exitCode===null)fixture.kill()
  if(service)await service.stop()
  console.log(JSON.stringify(report))
}
