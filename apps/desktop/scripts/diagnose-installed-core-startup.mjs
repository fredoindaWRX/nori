import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {spawn} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const require=createRequire(pathToFileURL('C:/Program Files/Nori/resources/app.asar/desktop/main.cjs'))
const {startNativeCore}=require('./native-core.cjs')
const {startGptOssService}=require('./gpt-oss-service.cjs')
const production=process.argv.includes('--production-profile')
const root='C:/Program Files/Nori/resources/NoriSuite',stateRoot=production?'C:/Users/Studio/AppData/Local/Nori':mkdtempSync(join(tmpdir(),'nori-core-diagnostic-'))
const environment={...process.env,NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_GPT_OSS_URL:'http://127.0.0.1:18788',
  NORI_GPT_OSS_SERVER_MODEL:'gpt-oss-20b',NORI_RUNTIME_MODEL_ID:'gpt-oss-20b',NORI_ALLOW_WRITES:'0'}
let stderr='',secret='',core,service
try{
  service=await startGptOssService({root,contextTokens:production?8192:4096})
  environment.NORI_GPT_OSS_URL=service.endpoint
  core=await startNativeCore({root,environment,stateRoot,dataRoot:production?join(stateRoot,'state/core'):join(stateRoot,'core'),
    runtime:{environment:{NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_GPT_OSS_URL:environment.NORI_GPT_OSS_URL,NORI_GPT_OSS_SERVER_MODEL:'gpt-oss-20b'},status:{modelId:'gpt-oss-20b'}},
    spawnChild:(executable,args,options)=>{
      secret=options.env.NORI_API_TOKEN
      const child=spawn(executable,args,{...options,stdio:['pipe','pipe','pipe']})
      child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-10000)})
      return child
    }})
  console.log(JSON.stringify({isolatedCoreReady:true,modelInferenceTested:false}))
}catch(error){console.log(JSON.stringify({isolatedCoreReady:false,error:String(error.message),stderr:secret?stderr.replaceAll(secret,'[REDACTED]'):stderr}));process.exitCode=1}
finally{if(core)await core.stop();if(service)await service.stop();if(!production)rmSync(stateRoot,{recursive:true,force:true})}
