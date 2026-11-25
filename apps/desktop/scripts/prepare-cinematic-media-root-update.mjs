import {createRequire} from 'node:module'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,dirname} from 'node:path'
const asar=createRequire(import.meta.url)('@electron/asar')
const stage='C:/Nori/streaming/social-current/deep-roots-motivation-2026-10-26/cinematic-update'
const archive='C:/Program Files/Nori/resources/app.asar',hash=b=>createHash('sha256').update(b).digest('hex')
const prior=JSON.parse(readFileSync(resolve(stage,'manifest.json'))),before=hash(readFileSync(archive))
if(!prior.installed||before!==prior.candidate.sha256)throw Error('Installed package differs from the verified first update; inspect before preparing')
const name='desktop/main.cjs',original=asar.extractFile(archive,name)
let main=original.toString()
const anchor="const imageState=join(USER_DATA_ROOT,'image-runtime')"
if(main.split(anchor).length!==2)throw Error('Media startup anchor changed')
main="process.env.NORI_VIDEO_OUTPUT_ROOT='C:/Nori/media-runtime/output'\n"+main.replace(anchor,"const imageState='C:/Nori/media-runtime'")
const files=[{path:name,before:hash(original),bytes:Buffer.from(main)}]
for(const path of ['bridge/local-video.mjs','bridge/generated-video-file.mjs'])files.push({path,before:hash(asar.extractFile(archive,path)),bytes:readFileSync(new URL('../'+path,import.meta.url))})
for(const f of files){const p=resolve(stage,f.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,f.bytes)}
for(const dir of ['input','output','temp','user'])mkdirSync(resolve('C:/Nori/media-runtime',dir),{recursive:true})
if(hash(readFileSync(archive))!==before)throw Error('Concurrent installed update')
const manifest={schema:'nori.cinematic-code-stage.v1',archiveBefore:before,rollbackSha256:prior.rollbackSha256??prior.archiveBefore,
 installed:false,localOnly:true,deploymentReady:false,reason:'Use canonical media directories outside Windows AppData redirection; preserve containment checks and existing private state',
 files:files.map(f=>({path:f.path,before:f.before,after:hash(f.bytes),bytes:f.bytes.length})),createdAt:new Date().toISOString(),remaining:['Package validation','Administrator installation','Installed chat-to-render acceptance']}
writeFileSync(resolve(stage,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(JSON.stringify({staged:files.length,bytes:files.reduce((s,f)=>s+f.bytes.length,0),installed:false}))
