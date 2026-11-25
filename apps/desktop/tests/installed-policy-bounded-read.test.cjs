const test=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {join}=require('node:path')
const {runInNewContext}=require('node:vm')
const source=readFileSync(join(__dirname,'../desktop/installed-state-policy.cjs'),'utf8')
const bytes=Buffer.from(JSON.stringify({schema:'nori.installed-state-policy.v1',stateLayout:'consolidated-v1',suiteRelativePath:'resources/NoriSuite'})+'\n')
function simulated({growing=false,swapped=false}={}){
  const info={size:bytes.length,ino:4,dev:2,isFile:()=>true,isSymbolicLink:()=>false}
  let offset=0,closed=0,readBytes=0
  const mockFs={
    lstatSync:()=>info,realpathSync:value=>value,openSync:()=>123,
    fstatSync:()=>({...info,ino:swapped?5:4}),closeSync:()=>closed++,
    readSync:(_fd,buffer,target,length)=>{
      const available=growing?Buffer.alloc(10000,32):bytes
      const count=Math.min(length,available.length-offset)
      if(count>0)available.copy(buffer,target,offset,offset+count)
      offset+=count;readBytes+=count;return count
    }
  }
  const context={Buffer,process:{platform:process.platform},module:{exports:{}},
    require:name=>name==='node:fs'?mockFs:require(name)}
  runInNewContext(source,context)
  const root=join(__dirname,'synthetic-uncreated')
  return {read:()=>context.module.exports.installedStatePolicy({executable:join(root,'Nori.exe'),suiteRoot:join(root,'resources/NoriSuite')}),
    counts:()=>({closed,readBytes})}
}
test('bounded policy reader closes its descriptor and reports exact bytes',()=>{
  const fixture=simulated(),policy=fixture.read()
  assert.equal(policy.byteLength,bytes.length);assert.match(policy.sha256,/^[a-f0-9]{64}$/)
  assert.deepEqual(fixture.counts(),{closed:1,readBytes:bytes.length})
})
test('growth after metadata inspection is bounded and refused',()=>{
  const fixture=simulated({growing:true})
  assert.throws(fixture.read,/Unreadable installed/)
  assert.deepEqual(fixture.counts(),{closed:1,readBytes:4097})
})
test('replacement between metadata inspection and open is refused before reading',()=>{
  const fixture=simulated({swapped:true})
  assert.throws(fixture.read,/Unreadable installed/)
  assert.deepEqual(fixture.counts(),{closed:1,readBytes:0})
})
