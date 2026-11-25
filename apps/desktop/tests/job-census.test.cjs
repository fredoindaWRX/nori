const test=require('node:test')
const assert=require('node:assert/strict')
const {jobCensus}=require('../desktop/job-census.cjs')
const context={nonce:'a'.repeat(64),rootPid:100,electronPid:200}
const membership={kind:'owned-job-members',syntheticOnly:true,...context,processIds:[100,200,300,400]}
test('exact Job census excludes an unrelated orphan despite a reused matching parent PID',()=>{
  const records=[{ProcessId:100,ParentProcessId:1,Name:'electron.exe'},
    {ProcessId:200,ParentProcessId:100,Name:'electron.exe'},
    {ProcessId:300,ParentProcessId:200,Name:'python.exe'},
    {ProcessId:400,ParentProcessId:300,Name:'norama-worker.exe'},
    {ProcessId:28604,ParentProcessId:200,Name:'node.exe'},
    {ProcessId:9680,ParentProcessId:28604,Name:'conhost.exe'}]
  assert.deepEqual(jobCensus(records,membership,context),[
    {pid:300,name:'python.exe'},{pid:400,name:'norama-worker.exe'}])
})
test('Job census refuses foreign nonce/root, missing launch roots and malformed membership',()=>{
  for(const changed of [{...membership,nonce:'b'.repeat(64)},{...membership,rootPid:999},
    {...membership,processIds:[100,300]},{...membership,processIds:[100,200,200]},
    {...membership,processIds:[100,200,'300']},{...membership,syntheticOnly:false}])
    assert.throws(()=>jobCensus([],changed,context),/membership required/)
})
test('exited snapshot members need not be in current diagnostics and no ancestry is followed',()=>{
  const records=[{ProcessId:400,ParentProcessId:99999,Name:'norama-worker.exe'},
    {ProcessId:500,ParentProcessId:400,Name:'unrelated.exe'}]
  assert.deepEqual(jobCensus(records,membership,context),[{pid:400,name:'norama-worker.exe'}])
})
