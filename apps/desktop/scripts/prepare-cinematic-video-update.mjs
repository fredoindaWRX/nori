// Code-only staging against the installed archive. No deployment or runtime changes.
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,dirname} from 'node:path'
const asar=createRequire(import.meta.url)('@electron/asar')
const archive='C:/Program Files/Nori/resources/app.asar'
const destination='C:/Nori/streaming/social-current/deep-roots-motivation-2026-10-26/cinematic-update'
const hash=b=>createHash('sha256').update(b).digest('hex')
const before=hash(await readFile(archive))
const readInstalled=name=>asar.extractFile(archive,name)
const replaceOnce=(text,from,to)=>{if(text.split(from).length!==2)throw Error('Installed anchor changed: '+from.slice(0,70));return text.replace(from,to)}
const queryName='bridge/nori-v2-query.mjs'
const originalQuery=readInstalled(queryName)
let query=originalQuery.toString().replace(/\r\n/g,'\n')
query="import {resolveCinematicVideoRequest,encodeCinematicVideoIntent,decodeCinematicVideoIntent} from './cinematic-video-profile.mjs'\n"+query
query="import {withLocalVideoModelLease} from './video-model-lease.mjs'\n"+query
query=replaceOnce(query,'        const videoGoal = resolveVideoRequest(goal, turns)',`        let cinematicRequest
        try{cinematicRequest=resolveCinematicVideoRequest(goal)}catch(error){
          yield {type:'result',subtype:'error_during_execution',error_code:'NORI_LOCAL_VIDEO_FAILED',errors:[String(error.message)]}
          continue
        }
        const videoGoal = cinematicRequest?.prompt??resolveVideoRequest(goal, turns)`)
query=replaceOnce(query,'            const intent = encodeNeuraleseVideoIntent(videoGoal)','            const intent = cinematicRequest?await encodeCinematicVideoIntent(cinematicRequest):encodeNeuraleseVideoIntent(videoGoal)')
query=replaceOnce(query,'            const planned = decodeNeuraleseVideoIntent(intent)','            const planned = cinematicRequest?decodeCinematicVideoIntent(intent):decodeNeuraleseVideoIntent(intent)')
query=replaceOnce(query,`            const video = await (options.generateVideo ?? generateLocalVideo)(intent, {
              signal: localAbort.signal,
              onProgress: progress => options.nativeVideoProgress?.(progress, origin),
            })`,`            const video = await withLocalVideoModelLease(()=>(options.generateVideo ?? generateLocalVideo)(intent, {
              signal: localAbort.signal,
              onProgress: progress => options.nativeVideoProgress?.(progress, origin),
            }),{signal:localAbort.signal})`)
const mainName='desktop/main.cjs',originalMain=readInstalled(mainName)
let main=originalMain.toString().replace(/\r\n/g,'\n')
main="const {startVideoCapableModelService}=require('./video-capable-model.cjs')\nconst {releaseVideoRuntime}=require('./video-runtime-cleanup.cjs')\n"+main
main=replaceOnce(main,'gptOssService = await startGptOssService({','gptOssService = await startVideoCapableModelService({')
main=replaceOnce(main,'      localAgentProvider: CODEX_LOCAL_PROVIDER })',"      localAgentProvider: CODEX_LOCAL_PROVIDER },{cleanupVideo:()=>releaseVideoRuntime(`http://127.0.0.1:${COMFY_PORT}`)})")
main=replaceOnce(main,'    userDirectory: imageFolders.user,\n    port: COMFY_PORT,',"    userDirectory: imageFolders.user,\n    extraModelPaths: existsSync('C:/Nori/models/video/wan2.2/extra-model-paths.yaml')?'C:/Nori/models/video/wan2.2/extra-model-paths.yaml':undefined,\n    port: COMFY_PORT,")
const providerName='bridge/local-video.mjs'
const provider=readInstalled(providerName)
if(hash(provider)!=='2f8cbd5fe49ce6656e1aa33ebeef14bbda721ba5ea13118f875f16a8796843a6')throw Error('Installed video provider changed; inspect before staging')
const files=[{name:queryName,before:hash(originalQuery),bytes:Buffer.from(query)},
 {name:mainName,before:hash(originalMain),bytes:Buffer.from(main)},
 {name:providerName,before:hash(provider),bytes:await readFile(new URL('../bridge/local-video.mjs',import.meta.url))},
 {name:'bridge/cinematic-video-profile.mjs',before:null,bytes:await readFile(new URL('../bridge/cinematic-video-profile.mjs',import.meta.url))}]
for(const name of ['bridge/video-model-lease.mjs','desktop/video-model-lease.cjs','desktop/video-capable-model.cjs','desktop/video-runtime-cleanup.cjs','desktop/comfy-startup.cjs']){
 let previous=null;try{previous=hash(readInstalled(name))}catch{}
 files.push({name,before:previous,bytes:await readFile(new URL('../'+name,import.meta.url))})
}
if(hash(await readFile(archive))!==before)throw Error('Concurrent installed update; no staging performed')
for(const file of files){const p=resolve(destination,file.name);await mkdir(dirname(p),{recursive:true});await writeFile(p,file.bytes)}
const manifest={schema:'nori.cinematic-code-stage.v1',archiveBefore:before,installed:false,localOnly:true,
 deploymentReady:false,remaining:['Package validation and transactional installation','Installed chat-to-render acceptance'],
 files:files.map(f=>({path:f.name,before:f.before,after:hash(f.bytes),bytes:f.bytes.length})),createdAt:new Date().toISOString()}
await writeFile(resolve(destination,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(JSON.stringify({staged:files.length,bytes:files.reduce((s,f)=>s+f.bytes.length,0),installed:false,deploymentReady:false}))
