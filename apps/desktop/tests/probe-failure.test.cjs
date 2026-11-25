const test=require('node:test')
const assert=require('node:assert/strict')
const {mkdtempSync,readFileSync,readdirSync,rmSync}=require('node:fs')
const {tmpdir}=require('node:os')
const {join}=require('node:path')
const {reportProbeFailure}=require('../desktop/probe-failure.cjs')

test('optional fixture failure reporting never recreates state or overwrites an existing report',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-probe-failure-'))
  try{
    assert.equal(reportProbeFailure(null,Error('synthetic')),false)
    assert.equal(reportProbeFailure({directory:join(root,'missing')},Error('synthetic')),false)
    assert.deepEqual(readdirSync(root),[])
    assert.equal(reportProbeFailure({directory:root},Error('first synthetic refusal')),true)
    assert.equal(reportProbeFailure({directory:root},Error('second synthetic refusal')),false)
    assert.deepEqual(JSON.parse(readFileSync(join(root,'desktop-failure.json'),'utf8')),
      {error:'first synthetic refusal'})
    assert.equal(reportProbeFailure({directory:root},{get message(){throw Error('unreadable fixture error')}}),false)
  }finally{rmSync(root,{recursive:true,force:true})}
})
