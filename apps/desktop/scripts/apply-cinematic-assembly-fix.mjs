// Narrow two-module fix. Rebuild from the fresh installed package; never replace newer unrelated code.
import {createRequire} from 'node:module'
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync,unlinkSync,lstatSync,realpathSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
const require=createRequire(import.meta.url),asar=require('@electron/asar')
const {Pickle}=require('../node_modules/@electron/asar/lib/pickle.js')
const root='C:/Nori/streaming/social-current/deep-roots-motivation-2026-10-26/assembly-fix'
const archive='C:/Program Files/Nori/resources/app.asar',receipt=resolve(root,'manifest.json')
const hash=b=>createHash('sha256').update(b).digest('hex')
const names=['bridge/local-video-assembly.mjs','bridge/local-video-assembly.py']
const expected=['7751a7940bc458d1e2cce5a59c18aa319b6ff60d7a722db2298c504622176223','8f2acef3274690ac59c9622e9a136810f114e1ecca6e83d2916fd8a3fac384da']
function regular(path){if(lstatSync(path).isSymbolicLink()||realpathSync(path).toLowerCase()!==resolve(path).toLowerCase())throw Error('Redirected update path refused: '+path)}
regular(archive)
if(process.argv.includes('--prepare')){
 mkdirSync(root,{recursive:true})
 const before=hash(readFileSync(archive))
 const files=names.map((path,i)=>{
  if(hash(asar.extractFile(archive,path))!==expected[i])throw Error('Installed assembler changed; inspect before preparing')
  const bytes=readFileSync(new URL('../'+path,import.meta.url)),file='module-'+i
  writeFileSync(resolve(root,file),bytes)
  return {path,file,before:expected[i],after:hash(bytes),bytes:bytes.length}
 })
 if(hash(readFileSync(archive))!==before)throw Error('Concurrent update during preparation')
 writeFileSync(receipt,JSON.stringify({schema:'nori.cinematic-assembly-fix.v1',files,observedArchive:before,installed:false},null,2))
 console.log(JSON.stringify({prepared:true,files:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0)}));process.exit(0)
}
const report=JSON.parse(readFileSync(receipt))
if(report.schema!=='nori.cinematic-assembly-fix.v1'||report.files.length!==2||report.files.some((f,i)=>f.path!==names[i]||f.before!==expected[i]))throw Error('Assembly fix manifest refused')
const original=readFileSync(archive),before=hash(original)
regular(root);regular(receipt)
for(const [i,f] of report.files.entries()){if(f.file!=='module-'+i)throw Error('Invalid staged module path');regular(resolve(root,f.file))}
if(report.installed&&before===report.afterArchive&&!process.argv.includes('--rollback')){console.log(JSON.stringify({installed:true,alreadyInstalled:true,liveTested:false}));process.exit(0)}
const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
const command=s=>execFileSync(ps,['-NoProfile','-NonInteractive','-Command',s],{encoding:'utf8',windowsHide:true}).trim()
const admin=command('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)')==='True'
const stopped=command("@(Get-Process -Name Nori -ErrorAction SilentlyContinue).Count")==='0'
if(process.argv.includes('--preflight')){
 const modules=report.files.every(f=>hash(asar.extractFile(archive,f.path))===f.before&&hash(readFileSync(resolve(root,f.file)))===f.after)
 console.log(JSON.stringify({moduleGuardsPassed:modules,preservesCurrentPackage:true,administrator:admin,noriStopped:stopped,installed:false}));process.exit(0)
}
const validationOnly=process.argv.includes('--validate')
if(!validationOnly&&(!admin||!stopped))throw Error('Quit Nori and run this command from Administrator PowerShell. No installed files changed.')
const raw=asar.getRawHeader(archive),payload=original.subarray(8+raw.headerSize)
const candidate=resolve(root,'app.asar.next')
if(existsSync(candidate))throw Error('Existing candidate requires inspection; no update applied')
if(process.argv.includes('--rollback')){
 if(!report.installed||before!==report.afterArchive)throw Error('Installed package changed after the fix; rollback refused')
 const restored=Buffer.concat([readFileSync(resolve(root,'rollback-header.bin')),payload.subarray(0,report.oldPayloadBytes)])
 if(hash(restored)!==report.beforeArchive)throw Error('Exact rollback reconstruction failed')
 writeFileSync(candidate,restored)
 if(hash(readFileSync(archive))!==before)throw Error('Concurrent update; rollback refused')
 renameSync(candidate,archive);report.installed=false;report.rolledBack=true
 writeFileSync(receipt,JSON.stringify(report,null,2));console.log(JSON.stringify({rolledBack:true,sha256:hash(readFileSync(archive))}));process.exit(0)
}
const changes=report.files.map(f=>{
 const bytes=readFileSync(resolve(root,f.file))
 if(hash(asar.extractFile(archive,f.path))!==f.before||hash(bytes)!==f.after)throw Error('Assembler module changed; no update applied')
 return {file:f,bytes}
})
let offset=payload.length
for(const {file,bytes} of changes){raw.header.files.bridge.files[file.path.split('/').at(-1)]={size:bytes.length,offset:String(offset),integrity:{algorithm:'SHA256',hash:file.after,blockSize:4194304,blocks:[file.after]}};offset+=bytes.length}
const header=Pickle.createEmpty();header.writeString(JSON.stringify(raw.header))
const size=Pickle.createEmpty();size.writeUInt32(header.toBuffer().length)
const next=Buffer.concat([size.toBuffer(),header.toBuffer(),payload,...changes.map(c=>c.bytes)])
writeFileSync(candidate,next);asar.uncache(candidate)
for(const f of report.files)if(hash(asar.extractFile(candidate,f.path))!==f.after)throw Error('Candidate assembler verification failed')
const nextHeader=asar.getRawHeader(candidate)
const reconstructed=Buffer.concat([original.subarray(0,8+raw.headerSize),next.subarray(8+nextHeader.headerSize,8+nextHeader.headerSize+payload.length)])
if(hash(reconstructed)!==before)throw Error('Exact prior-package reconstruction failed')
if(validationOnly){
 if(hash(readFileSync(archive))!==before)throw Error('Concurrent package change during validation')
 unlinkSync(candidate)
 report.validation={candidateModulesVerified:true,rollbackReconstructionVerified:true,unchangedPayloadVerified:true,installedArchiveUnchanged:true,archiveSha256:before,at:new Date().toISOString()}
 writeFileSync(receipt,JSON.stringify(report,null,2))
 console.log(JSON.stringify({validated:true,...report.validation,installed:false}));process.exit(0)
}
// Keep only a small header plus length: the unchanged prior payload remains inside the installed candidate.
writeFileSync(resolve(root,'rollback-header.bin'),original.subarray(0,8+raw.headerSize))
Object.assign(report,{beforeArchive:before,afterArchive:hash(next),oldPayloadBytes:payload.length,rollbackReconstructionVerified:true})
writeFileSync(receipt,JSON.stringify(report,null,2))
if(hash(readFileSync(archive))!==before)throw Error('Concurrent package update; no update applied')
renameSync(candidate,archive)
if(hash(readFileSync(archive))!==report.afterArchive)throw Error('Installed hash mismatch; recovery metadata is preserved')
report.installed=true;writeFileSync(receipt,JSON.stringify(report,null,2))
console.log(JSON.stringify({installed:true,files:2,unrelatedPayloadPreserved:true,rollbackReconstructionVerified:true,liveTested:false}))
