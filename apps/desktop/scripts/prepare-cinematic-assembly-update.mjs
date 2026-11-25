import {createRequire} from 'node:module'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,dirname} from 'node:path'
const asar=createRequire(import.meta.url)('@electron/asar')
const stage='C:/Nori/streaming/social-current/deep-roots-motivation-2026-10-26/cinematic-update'
const archive='C:/Program Files/Nori/resources/app.asar',hash=b=>createHash('sha256').update(b).digest('hex')
const prior=JSON.parse(readFileSync(resolve(stage,'manifest.json'))),before=hash(readFileSync(archive))
if(!prior.installed||before!==prior.candidate.sha256)throw Error('Installed package changed; inspect before preparing')
const files=['bridge/local-video-assembly.mjs','bridge/local-video-assembly.py'].map(path=>({path,before:hash(asar.extractFile(archive,path)),bytes:readFileSync(new URL('../'+path,import.meta.url))}))
if(hash(readFileSync(archive))!==before)throw Error('Concurrent installed update')
for(const f of files){const p=resolve(stage,f.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,f.bytes)}
const manifest={schema:'nori.cinematic-code-stage.v1',archiveBefore:before,rollbackSha256:prior.rollbackSha256??prior.archiveBefore,
 installed:false,localOnly:true,deploymentReady:false,reason:'Qualify fixed 121-frame, 704x1280/24fps cinematic shots in both assembly validators; retain legacy profile and no-padding checks',
 files:files.map(f=>({path:f.path,before:f.before,after:hash(f.bytes),bytes:f.bytes.length})),createdAt:new Date().toISOString(),remaining:['Package validation','Administrator installation','Installed normal-chat delivery acceptance']}
writeFileSync(resolve(stage,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(JSON.stringify({staged:files.length,bytes:files.reduce((s,f)=>s+f.bytes.length,0),installed:false}))
