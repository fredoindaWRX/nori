'use strict'
const {execFile}=require('node:child_process')
const {promisify}=require('node:util')
const {freemem}=require('node:os')
const {importedModelProfile}=require('./imported-model-profile.cjs')
const execute=promisify(execFile),MIB=1024**2,GIB=1024**3
const AUTOMATIC_PROFILES=['qwen3.5-9b','qwen3.8-27b','qwen3.6-35b','qwen3-24b-freedom','qwen3-14b']
// 2026-11-14 (Wil: "Yes, fix it"): Nori kept dying right after the 35B loaded. Its RAM floor (10 GiB) is
// about what it uses, so the check passed with ~12 GiB free and left ~0.5 GiB; then Windows hit its commit
// limit ("low virtual memory", 01:35 and 22:09) and the app crashed. A model now loads only if, after
// loading, RAM_HEADROOM is still free AND Windows' commit limit can take the model plus COMMIT_HEADROOM.
// Otherwise the router uses its smaller fallback (9B) instead of risking the whole app.
const RAM_HEADROOM=4*GIB,COMMIT_HEADROOM=6*GIB
// Measured commit per engine (2026-11-14 low-memory reports: 35B 17.5 GB). Others: RAM floor + 4 GiB.
const COMMIT_NEED={'qwen3.6-35b':18*GIB}
async function readAvailableCommit(signal){
 const {stdout}=await execute('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',
  '$m=Get-CimInstance Win32_PerfRawData_PerfOS_Memory;[string]($m.CommitLimit-$m.CommittedBytes)'],{windowsHide:true,timeout:8000,signal,maxBuffer:4096})
 const value=Number(String(stdout).trim())
 if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid commit measurement')
 return value
}

function createModelCapacityCheck({readFreeRam=freemem,readCommit=readAvailableCommit,queryGpu=async signal=>{
 const {stdout}=await execute('C:/Windows/System32/nvidia-smi.exe',['--query-gpu=memory.free','--format=csv,noheader,nounits'],
  {windowsHide:true,timeout:5000,signal,maxBuffer:4096})
 return stdout
}}={}){
 const check=async(profile,{current,contextTokens,signal}={})=>{
  if(!AUTOMATIC_PROFILES.includes(profile))throw Error('Unknown automatic model profile')
  const target=importedModelProfile(profile),fallback=(target.fallbackContexts??[]).find(item=>item.context===contextTokens)
  if(contextTokens!==target.defaultContext&&!fallback)throw Error('Automatic routing requires the model\'s qualified context')
  signal?.throwIfAborted()
  if(current?.modelId===profile&&current.contextTokens===contextTokens&&current.child?.exitCode===null&&current.child.signalCode==null)return true
  const ram=readFreeRam()
  if(!Number.isSafeInteger(ram)||ram<0)throw Error('Invalid free-memory measurement')
  // MoE profiles keep part of their experts in RAM, so they state their own RAM floor; headroom must remain after it.
  const floor=target.minimumFreeRamMiB?target.minimumFreeRamMiB*MIB:(profile==='qwen3.8-27b'?6:3)*GIB
  if(ram<floor+RAM_HEADROOM)return false
  // An unreadable commit counter does not block loading; a readable one that is too low does.
  let commit=null
  try{commit=await readCommit(signal)}catch{}
  signal?.throwIfAborted()
  if(commit!==null&&commit<(COMMIT_NEED[profile]??floor+4*GIB)+COMMIT_HEADROOM)return false
  const output=(await queryGpu(signal)).trim()
  if(!/^\d+$/.test(output))throw Error('Automatic routing requires one verified GPU inventory row')
  const free=Number(output)
  if(!Number.isSafeInteger(free)||free<0||free>1048576)throw Error('Invalid free GPU memory measurement')
  // Conservative estimate, not a claim of exact process VRAM accounting.
  // Only the owned engine's known weights may count as reclaimable capacity.
  // An MoE engine holds only part of its weights on the GPU; never count more than its GPU share.
  const ownedProfile=current&&AUTOMATIC_PROFILES.includes(current.modelId)&&current.child?.exitCode===null?importedModelProfile(current.modelId):null
  const owned=ownedProfile?Math.floor(Math.min(ownedProfile.bytes*0.9,(ownedProfile.minimumFreeVramMiB??Infinity)*MIB)):0
  const minimum=fallback?.minimumFreeVramMiB??target.minimumFreeVramMiB
  const required=minimum?minimum*MIB:target.bytes+GIB
  return free*MIB+owned>=required
 }
 // Re-measure after releasing an owned engine rather than treating an
 // uncertain reclaim estimate as proof the preferred model cannot fit.
 check.recheckAfterUnload=true
 return check
}
module.exports={createModelCapacityCheck}
