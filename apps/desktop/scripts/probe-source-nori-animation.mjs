// Real native-model source-bridge qualification, separate from installed proof.
import {createRequire} from 'node:module'
import {mkdirSync,existsSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
const revision=process.argv[2]||'r1'
if(!/^r[0-9]+$/.test(revision))throw Error('Safe probe revision required')
const root=resolve(import.meta.dirname,'../../..')
const fixture=join(root,'verification',`source-nori-animation-${revision}`)
const output=fixture+'.json'
if(existsSync(fixture)||existsSync(output))throw Error('Existing qualification evidence preserved')
mkdirSync(fixture)
const {startGptOssService}=createRequire(import.meta.url)('../desktop/gpt-oss-service.cjs')
const report={scope:'source-bridge-real-native-model',syntheticOnly:true,installedVerified:false,previews:[],results:[]}
let service
try {
  console.log(JSON.stringify({phase:'starting-native-model'}))
  service=await startGptOssService({root:join(root,'apps/desktop/release/native-desktop-ui-r1/win-unpacked/resources/NoriSuite'),contextTokens:8192})
  Object.assign(process.env,{NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_LOCAL_CHAT:'1',NORI_GPT_OSS_ENABLED:'1',
    NORI_GPT_OSS_URL:service.endpoint,NORI_GPT_OSS_SERVER_MODEL:service.modelId,NORI_GPT_OSS_CONTEXT_TOKENS:'8192',
    NORI_ROOT:root,NORI_APP_DATA_ROOT:fixture,NORI_SETTINGS_DIR:join(fixture,'settings')})
  const {query}=await import('../bridge/nori-v2-query.mjs')
  const request='Use EffectCraft to create a 2-second animation of a blue circle moving from left to right. Add position keyframes at 0 and 2 seconds, render previews at 0 and 1.9 seconds, and save the editable project as nori-animation-test.ecproj. Do not claim video export.'
  async function* prompt(){yield {message:{content:request}}}
  console.log(JSON.stringify({phase:'submitting-animation',model:service.modelId}))
  for await(const event of query({prompt:prompt(),options:{model:'gpt-oss:20b',responseProfile:'balanced',nativeImage:image=>{
    const bytes=Buffer.from(image.data,'base64'),file=`preview-${report.previews.length}.png`
    writeFileSync(join(fixture,file),bytes,{flag:'wx'})
    report.previews.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
  }}})){
    if(event.type==='result')report.results.push(event)
  }
  report.state=report.results.at(-1)?.subtype==='success'?'completed':'failed'
  report.motionObserved=report.previews.length>=2&&report.previews[0].sha256!==report.previews[1].sha256
  if(report.state!=='completed'||!report.motionObserved)process.exitCode=1
}catch(error){report.state='error';report.error=String(error.message);process.exitCode=1}
finally{
  if(service)await service.stop()
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({phase:'finished',state:report.state,motionObserved:report.motionObserved,output}))
}
