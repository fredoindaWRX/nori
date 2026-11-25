const {openSync,writeFileSync,fsyncSync,closeSync,lstatSync,realpathSync,readSync,fstatSync,unlinkSync,renameSync} = require('node:fs')
const {join,dirname} = require('node:path')
const {randomUUID} = require('node:crypto')

// Cooperative ownership, not an OS sandbox. Never steal an existing lease:
// stale records require separate recovery with process-identity evidence.
function acquireRecord(directory,purpose,filename) {
  let ancestor=directory
  while(ancestor){
    if(lstatSync(ancestor).isSymbolicLink())throw Error('Linked state ownership path refused')
    const next=dirname(ancestor);if(next===ancestor)break;ancestor=next
  }
  const root=realpathSync(directory)
  if(!lstatSync(root).isDirectory())throw Error('State ownership root must be a directory')
  const path=join(root,filename)
  const record=JSON.stringify({schema:1,pid:process.pid,owner:randomUUID(),purpose})
  let fd
  try {fd=openSync(path,'wx',0o600);writeFileSync(fd,record);fsyncSync(fd)}
  finally {if(fd!==undefined)closeSync(fd)}
  let released=false
  const assertHeld=()=>{
    if(released)throw Error('State ownership already released')
    const info=lstatSync(path),expected=Buffer.from(record)
    if(!info.isFile()||info.isSymbolicLink()||info.size!==expected.length)
      throw Error('State ownership changed; foreign record preserved')
    // Bound the read even if another process replaces or grows the record.
    // Never read an arbitrarily large foreign file into the Core process.
    const handle=openSync(path,'r')
    try {
      const current=fstatSync(handle),bytes=Buffer.alloc(expected.length+1)
      if(!current.isFile()||current.size!==expected.length||
        readSync(handle,bytes,0,bytes.length,0)!==expected.length||
        !bytes.subarray(0,expected.length).equals(expected))
        throw Error('State ownership changed; foreign record preserved')
    }finally{closeSync(handle)}
    return {directory:root,purpose}
  }
  return {assertHeld,release(){
    if(released)return
    assertHeld()
    unlinkSync(path);released=true
  }}
}
function refuseGuardian(directory) {
  const path=join(directory,'.nori-state-guardian.json')
  try { lstatSync(path) }
  catch(error) { if(error.code==='ENOENT')return;throw error }
  // Its existence blocks migration regardless of contents, age, PID or type.
  // Never read/steal a stale record or follow a foreign guardian link.
  const error=Error('EEXIST: state teardown guardian still holds migration exclusion')
  error.code='EEXIST';throw error
}
function acquireStateOwner(directory,{purpose='core'}={}) {
  if(!['core','desktop','migration'].includes(purpose))throw Error('Unknown state ownership purpose')
  if(purpose==='migration')refuseGuardian(directory)
  const owner=acquireRecord(directory,purpose,'.nori-state-owner.json')
  if(purpose==='migration') {
    // A guardian may have been installed between the first check and our
    // exclusive ordinary record creation. No migration work has begun yet.
    try { refuseGuardian(directory) }
    catch(error) { owner.release();throw error }
  }
  return owner
}
function acquireStateGuardian(directory) {
  // Install under the SAME temporary exclusion migration uses; otherwise a
  // check/create race could admit migration while a guardian is being armed.
  const gate=acquireStateOwner(directory,{purpose:'migration'})
  try {
    const guardian=acquireRecord(directory,'guardian','.nori-state-guardian.json')
    gate.assertHeld()
    return guardian
  } finally { gate.release() }
}
// An abrupt kill leaves the owner record behind and every later start refuses with EEXIST.
// Move such a record aside only on process-identity evidence: a bounded, well-formed record
// whose PID no longer exists, no guardian, no links. The record is renamed, never deleted.
function processExists(pid) {
  try { process.kill(pid,0); return true }
  catch(error) { return error.code!=='ESRCH' }
}
function recoverDeadOwnerRecord(directory,{exists=processExists,now=Date.now}={}) {
  const path=join(directory,'.nori-state-owner.json')
  let info
  try { info=lstatSync(path) } catch(error) { if(error.code==='ENOENT')return {recovered:false,reason:'no-record'};throw error }
  try { lstatSync(join(directory,'.nori-state-guardian.json'));return {recovered:false,reason:'guardian-present'} }
  catch(error) { if(error.code!=='ENOENT')throw error }
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>4096)return {recovered:false,reason:'unexpected-record'}
  if(lstatSync(directory).isSymbolicLink())return {recovered:false,reason:'linked-directory'}
  const handle=openSync(path,'r');let text
  try { const bytes=Buffer.alloc(4097),count=readSync(handle,bytes,0,bytes.length,0);text=bytes.subarray(0,count).toString('utf8') }
  finally { closeSync(handle) }
  let record
  try { record=JSON.parse(text) } catch { return {recovered:false,reason:'unexpected-record'} }
  if(!record||record.schema!==1||!Number.isSafeInteger(record.pid)||record.pid<=0||typeof record.owner!=='string')
    return {recovered:false,reason:'unexpected-record'}
  if(record.pid===process.pid||exists(record.pid))return {recovered:false,reason:'owner-process-exists'}
  const aside=join(directory,`.nori-state-owner.recovered-${now()}-pid${record.pid}.json`)
  renameSync(path,aside)
  return {recovered:true,pid:record.pid,movedTo:aside}
}
module.exports={acquireStateOwner,acquireStateGuardian,recoverDeadOwnerRecord}
