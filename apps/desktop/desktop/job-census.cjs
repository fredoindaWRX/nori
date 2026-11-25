// Read-only diagnostic names for an exact Job snapshot. PID ancestry is NOT
// ownership: a surviving orphan can retain a parent PID that Windows reuses.
// This census never proves physical shutdown or authorizes termination/release.
function jobCensus(records,membership,{nonce,rootPid,electronPid}){
  if(!Array.isArray(records)||!membership||membership.kind!=='owned-job-members'||
    membership.syntheticOnly!==true||membership.nonce!==nonce||membership.rootPid!==rootPid||
    !Number.isInteger(rootPid)||rootPid<1||!Number.isInteger(electronPid)||electronPid<1||
    !/^[a-f0-9]{64}$/.test(nonce)||!Array.isArray(membership.processIds)||membership.processIds.length>512||
    membership.processIds.some(id=>!Number.isInteger(id)||id<1)||
    new Set(membership.processIds).size!==membership.processIds.length||
    !membership.processIds.includes(rootPid)||!membership.processIds.includes(electronPid))
    throw Error('Exact nonce-bound desktop Job membership required')
  const allowed=new Set(membership.processIds),seen=new Set(),result=[]
  for(const record of records){
    if(!allowed.has(record.ProcessId)||record.ProcessId===rootPid||record.ProcessId===electronPid)continue
    if(seen.has(record.ProcessId)||typeof record.Name!=='string'||record.Name.length>260)
      throw Error('Invalid read-only Job census record')
    seen.add(record.ProcessId);result.push({pid:record.ProcessId,name:record.Name})
  }
  return result
}
module.exports={jobCensus}
