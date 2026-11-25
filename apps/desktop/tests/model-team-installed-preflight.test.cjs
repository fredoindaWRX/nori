const test=require('node:test')
const assert=require('node:assert/strict')
const {spawnSync}=require('node:child_process')
const {readFileSync,existsSync}=require('node:fs')
const {createHash}=require('node:crypto')
const archive='C:/Program Files/Nori/resources/app.asar'
const script='C:/Nori/.work/scripts/apply-model-team-update.ps1'
const hash=()=>createHash('sha256').update(readFileSync(archive)).digest('hex')
for(const [name,executable] of [
 ['Windows PowerShell 5','C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'],
 ['bundled PowerShell 7','C:/Users/Studio/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'],
])test(`${name} validates the exact same-app stage without promoting it`,()=>{
 assert.ok(existsSync(executable),'Required installed shell missing')
 const before=hash()
 const result=spawnSync(executable,['-NoProfile','-File',script,'-Preflight'],{windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:16384})
 assert.equal(result.status,0,result.stderr||result.stdout)
 const receipt=JSON.parse(result.stdout.trim())
 assert.equal(receipt.verified,true);assert.equal(receipt.filesVerified,29)
 assert.ok(receipt.testsPassed>=135);assert.equal(receipt.installed,false)
 assert.equal(receipt.modelsCopied,0);assert.equal(receipt.newRuntimeCreated,false)
 assert.equal(hash(),before,'Read-only preflight changed the installed app')
})
