import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync,readFileSync,existsSync,renameSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'

const [payloadArgument,runtimeArgument,evidenceArgument]=process.argv.slice(2)
if(!payloadArgument||!runtimeArgument||!evidenceArgument)throw Error('Expected coder payload, installed suite, and fresh evidence folder')
const payload=resolve(payloadArgument),runtime=resolve(runtimeArgument),evidence=resolve(evidenceArgument)
const retry=process.argv[5]==='--retry'
if(existsSync(evidence)&&!retry)throw Error('Prior coding probe evidence preserved')
if(!existsSync(evidence))mkdirSync(evidence)
const project=join(evidence,'project'),state=join(evidence,'state')
if(!retry){
  mkdirSync(project);mkdirSync(state)
  writeFileSync(join(project,'calculator.py'),'def add(a, b):\n    return a - b\n',{flag:'wx'})
}
const git=(...args)=>execFileSync('git',['-C',project,...args],{encoding:'utf8',windowsHide:true}).trim()
if(!retry){
  git('init','-q');git('config','user.name','Nori local coder probe')
  git('config','user.email','nori-probe@localhost.invalid')
  git('add','calculator.py');git('commit','-qm','synthetic coding fixture')
}else{
  if(git('status','--porcelain')||readFileSync(join(project,'calculator.py'),'utf8')!=='def add(a, b):\n    return a - b\n')
    throw Error('Retry requires the unchanged synthetic fixture')
  const prior=join(evidence,'result.json')
  if(existsSync(prior))renameSync(prior,join(evidence,'result.previous.json'))
}
const require=createRequire(import.meta.url)
const {startGptOssService}=require(join(runtime,'apps/desktop/desktop/gpt-oss-service.cjs'))
let service
const started=Date.now(),events=[]
try{
  console.log('Starting the installed local GPT-OSS runtime for the synthetic coder test.')
  service=await startGptOssService({root:runtime,contextTokens:8192})
  Object.assign(process.env,{
    NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_GPT_OSS_ENABLED:'1',NORI_LOCAL_CHAT:'1',
    NORI_GPT_OSS_URL:service.endpoint,NORI_GPT_OSS_SERVER_MODEL:'gpt-oss-20b',
    NORI_GPT_OSS_CONTEXT_TOKENS:String(service.contextTokens),
    NORI_ROOT:payload,NORI_APP_DATA_ROOT:state,NORI_SETTINGS_DIR:join(state,'settings'),
    NORI_AIDER_PYTHON:join(runtime,'python/Python311/python.exe'),
    NORI_RUNTIME_PYTHON:join(runtime,'python/Python311/python.exe'),
    NORI_RUNTIME_CONFIG_PATH:join(state,'absent-config.json'),
  })
  console.log('Local model ready; sending the coding request through Nori query().')
  const {query}=await import('../bridge/nori-v2-query.mjs')
  const goal=`Use Aider to fix the code in "${project}". In calculator.py, change add(a, b) to return a + b instead of a - b. Only edit calculator.py.`
  async function* prompt(){yield {message:{content:goal}}}
  for await(const event of query({prompt:prompt(),options:{model:'nori-auto',allowWrites:false}})){
    events.push(event)
    if(event.type==='stream_event')process.stdout.write(event.event?.delta?.text||'')
    if(event.type==='result')console.log('\nNori result:',JSON.stringify(event))
  }
  const source=readFileSync(join(project,'calculator.py'),'utf8')
  const diff=git('diff','--','calculator.py')
  const result={schema:'nori.aider.live-chat-probe.v1',model:'gpt-oss-20b',
    localOnly:true,installedDesktopUiTested:false,elapsedMs:Date.now()-started,
    final:events.at(-1),source,diff,events,testsRun:false}
  writeFileSync(join(evidence,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  console.log('\nGenerated source:\n'+source)
  if(result.final?.subtype!=='success'||!diff)process.exitCode=1
}catch(error){
  writeFileSync(join(evidence,'failure.json'),JSON.stringify({error:String(error?.stack||error),elapsedMs:Date.now()-started,events},null,2)+'\n',{flag:'wx'})
  console.error(error);process.exitCode=1
}finally{if(service)await service.stop()}

