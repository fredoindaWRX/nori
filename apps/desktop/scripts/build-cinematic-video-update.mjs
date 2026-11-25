// One bounded ASAR candidate; preserve the installed payload and unrelated entries.
import {createRequire} from 'node:module'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
const require=createRequire(import.meta.url),asar=require('@electron/asar')
const {Pickle}=require('../node_modules/@electron/asar/lib/pickle.js')
const stage='C:/Nori/streaming/social-current/deep-roots-motivation-2026-10-26/cinematic-update'
const archive='C:/Program Files/Nori/resources/app.asar'
const hash=b=>createHash('sha256').update(b).digest('hex')
const manifest=JSON.parse(readFileSync(resolve(stage,'manifest.json')))
const original=readFileSync(archive)
if(manifest.archiveBefore!==hash(original)||manifest.installed!==false)throw Error('Installed app changed; restage before building')
const raw=asar.getRawHeader(archive),payload=original.subarray(8+raw.headerSize),additions=[]
let offset=payload.length
for(const file of manifest.files){
 const bytes=readFileSync(resolve(stage,file.path))
 if(hash(bytes)!==file.after)throw Error('Staged module changed: '+file.path)
 let previous=null
 try{previous=hash(asar.extractFile(archive,file.path))}catch{}
 if(previous!==file.before)throw Error('Installed module changed: '+file.path)
 const parts=file.path.split('/');let parent=raw.header
 for(const part of parts.slice(0,-1)){
  if(!parent.files[part]?.files)throw Error('Unexpected archive parent')
  parent=parent.files[part]
 }
 parent.files[parts.at(-1)]={size:bytes.length,offset:String(offset),integrity:{algorithm:'SHA256',hash:file.after,blockSize:4194304,blocks:[file.after]}}
 additions.push(bytes);offset+=bytes.length
}
const header=Pickle.createEmpty();header.writeString(JSON.stringify(raw.header))
const size=Pickle.createEmpty();size.writeUInt32(header.toBuffer().length)
const candidate=resolve(stage,'app.asar.next')
writeFileSync(candidate,Buffer.concat([size.toBuffer(),header.toBuffer(),payload,...additions]))
asar.uncache(candidate)
const rebuilt=readFileSync(candidate),rh=asar.getRawHeader(candidate)
if(!rebuilt.subarray(8+rh.headerSize,8+rh.headerSize+payload.length).equals(payload))throw Error('Original installed payload was not preserved')
for(const f of manifest.files)if(hash(asar.extractFile(candidate,f.path))!==f.after)throw Error('Candidate module mismatch')
// The selected imported-model profile is deliberately retained byte-for-byte.
const profile='desktop/imported-model-profile.cjs'
if(!asar.extractFile(candidate,profile).equals(asar.extractFile(archive,profile)))throw Error('Imported-model profile changed')
if(hash(readFileSync(archive))!==manifest.archiveBefore)throw Error('Concurrent installed update')
manifest.candidate={path:candidate,sha256:hash(rebuilt),bytes:rebuilt.length,payloadPreserved:true,modelProfilePreserved:true}
manifest.offlineValidated=true
manifest.remaining=['Transactional installation with Nori stopped','Installed chat-to-render acceptance']
writeFileSync(resolve(stage,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(JSON.stringify({candidateBytes:rebuilt.length,modules:manifest.files.length,payloadPreserved:true,modelProfilePreserved:true,installed:false}))
