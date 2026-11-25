import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,mkdirSync,symlinkSync,linkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
const script=fileURLToPath(new URL('../scripts/recover-state-owner.ps1',import.meta.url))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function fixture(run){
  const root=mkdtempSync(join(tmpdir(),'nori owner recovery ')),marker=join(root,'.nori-state-owner.json')
  const record=JSON.stringify({schema:1,pid:2147483647,owner:randomUUID(),purpose:'desktop'})
  writeFileSync(marker,record)
  const invoke=(args=[],sha=hash(readFileSync(marker)),pid='2147483647',target=root)=>spawnSync('powershell.exe',
    ['-NoProfile','-File',script,'-Root',target,'-ExpectedSha256',sha,'-ExpectedPid',pid,...args],
    {encoding:'utf8',timeout:20000,windowsHide:true})
  try{run({root,marker,record,invoke})}finally{rmSync(root,{recursive:true,force:true})}
}
test('dry-run verifies orphan without changing marker; apply preserves exact bytes as backup',
  {skip:process.platform!=='win32',timeout:45000},()=>fixture(({marker,record,invoke})=>{
    const check=invoke();assert.equal(check.status,0,check.stderr)
    const dry=JSON.parse(check.stdout);assert.equal(dry.Applied,false);assert.equal(dry.ActivationAuthorized,false)
    assert.equal(readFileSync(marker,'utf8'),record)
    const result=invoke(['-Apply']);assert.equal(result.status,0,result.stderr)
    const evidence=JSON.parse(result.stdout)
    assert.equal(evidence.Applied,true);assert.equal(evidence.QuiescenceVerified,false)
    assert.equal(evidence.ActivationAuthorized,false);assert.equal(existsSync(marker),false)
    assert.equal(readFileSync(evidence.BackupPath,'utf8'),record)
  }))
test('live owner, mismatched hash and guardian are preserved',
  {skip:process.platform!=='win32',timeout:65000},()=>fixture(({root,marker,invoke})=>{
    const live=JSON.stringify({schema:1,pid:process.pid,owner:randomUUID(),purpose:'desktop'})
    writeFileSync(marker,live)
    const result=invoke(['-Apply'],hash(live),String(process.pid))
    assert.notEqual(result.status,0);assert.match(result.stderr,/owner process is live/)
    assert.equal(readFileSync(marker,'utf8'),live)
    const mismatch=invoke(['-Apply'],'0'.repeat(64));assert.notEqual(mismatch.status,0)
    assert.match(mismatch.stderr,/record changed/)
    writeFileSync(join(root,'.nori-state-guardian.json'),'do not read')
    const guardian=invoke(['-Apply']);assert.notEqual(guardian.status,0)
    assert.match(guardian.stderr,/guardian present/)
    assert.equal(readFileSync(marker,'utf8'),live)
  }))
test('linked parent and multiply-linked record are refused',
  {skip:process.platform!=='win32',timeout:45000},()=>fixture(({root,marker,invoke})=>{
    const alias=join(root,'alias'),real=join(root,'real');mkdirSync(real)
    symlinkSync(real,alias,'junction')
    const linked=invoke(['-Apply'],hash('fixture'),'2147483647',alias)
    assert.notEqual(linked.status,0);assert.match(linked.stderr,/Linked|Redirected/)
    linkSync(marker,join(root,'record-hardlink.json'))
    const hardlink=invoke(['-Apply']);assert.notEqual(hardlink.status,0)
    assert.match(hardlink.stderr,/multiply-linked/)
    assert.equal(existsSync(marker),true)
  }))

test('a concurrently opened record cannot be renamed underneath its holder',
  {skip:process.platform!=='win32',timeout:25000},()=>fixture(({root,marker,record})=>{
    const quote=value=>"'"+value.replaceAll("'","''")+"'"
    const code=`$ErrorActionPreference='Stop'; $held=[IO.File]::Open(${quote(marker)},[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { & ${quote(script)} -Root ${quote(root)} -ExpectedSha256 ${quote(hash(record))} -ExpectedPid 2147483647 -Apply } finally { $held.Dispose() }`
    const result=spawnSync('powershell.exe',['-NoProfile','-Command',code],{encoding:'utf8',timeout:20000,windowsHide:true})
    assert.notEqual(result.status,0)
    assert.match(result.stderr,/Exclusive\s+recovery path refused/)
    assert.equal(readFileSync(marker,'utf8'),record)
  }))

test('oversized and unsupported records are refused without changing bytes',
  {skip:process.platform!=='win32',timeout:45000},()=>fixture(({marker,invoke})=>{
    for(const bytes of ['x'.repeat(4097),JSON.stringify({schema:1,pid:2147483647,owner:randomUUID(),purpose:'unknown'})]){
      writeFileSync(marker,bytes)
      const result=invoke(['-Apply']);assert.notEqual(result.status,0)
      assert.match(result.stderr,/oversized|Unsupported ownership/)
      assert.equal(readFileSync(marker,'utf8'),bytes)
    }
  }))
