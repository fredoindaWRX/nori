import {readFileSync,writeFileSync,existsSync,copyFileSync,renameSync,lstatSync,realpathSync,constants} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
const stage='C:/Nori/streaming/social-current/deep-roots-motivation-2026-10-26/cinematic-update'
const archive='C:/Program Files/Nori/resources/app.asar'
const candidate=resolve(stage,'app.asar.next'),backup=resolve(stage,'app.asar.rollback'),receipt=resolve(stage,'manifest.json')
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const manifest=JSON.parse(readFileSync(receipt))
const rollbackHash=manifest.rollbackSha256??manifest.archiveBefore
if(manifest.schema!=='nori.cinematic-code-stage.v1'||!manifest.offlineValidated||!manifest.candidate?.payloadPreserved||!manifest.candidate?.modelProfilePreserved)throw Error('Unverified cinematic package refused')
for(const p of [stage,archive])if(lstatSync(p).isSymbolicLink()||realpathSync(p).toLowerCase()!==resolve(p).toLowerCase())throw Error('Linked update path refused')
if(hash(archive)===manifest.candidate.sha256){
 if(!existsSync(backup)||hash(backup)!==rollbackHash)throw Error('Installed candidate has no verified rollback; inspect before continuing')
 manifest.installed=true;writeFileSync(receipt,JSON.stringify(manifest,null,2))
 console.log('Cinematic package is installed; runtime acceptance is still required.');process.exit(0)
}
if(hash(archive)!==manifest.archiveBefore||!existsSync(candidate)||hash(candidate)!==manifest.candidate.sha256)throw Error('Installed or staged package changed; no update applied')
const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
const admin=execFileSync(ps,['-NoProfile','-NonInteractive','-Command','([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{encoding:'utf8',windowsHide:true}).trim()
const live=execFileSync(ps,['-NoProfile','-NonInteractive','-Command',"@(Get-Process -Name Nori -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true}).trim()
if(process.argv.includes('--preflight')){
 console.log(JSON.stringify({stagedHashesVerified:true,installedUnchanged:true,administrator:admin==='True',noriStopped:live==='0',installed:false}));process.exit(0)
}
if(admin!=='True')throw Error('Administrator PowerShell is required to update Program Files. No files changed.')
if(live!=='0')throw Error('Quit Nori before applying this update. No files changed.')
if(existsSync(backup)){if(hash(backup)!==rollbackHash)throw Error('Unknown rollback preserved')}
else copyFileSync(archive,backup,constants.COPYFILE_EXCL)
if(hash(archive)!==manifest.archiveBefore||hash(backup)!==rollbackHash)throw Error('Concurrent update or rollback mismatch; no update applied')
renameSync(candidate,archive)
if(hash(archive)!==manifest.candidate.sha256)throw Error('Installed hash mismatch. Verified rollback is preserved; do not launch Nori.')
manifest.installed=true;manifest.installedAt=new Date().toISOString()
manifest.remaining=['Installed chat-to-render acceptance']
writeFileSync(receipt,JSON.stringify(manifest,null,2))
console.log(JSON.stringify({installed:true,sha256:manifest.candidate.sha256,rollbackVerified:true,liveTested:false}))
