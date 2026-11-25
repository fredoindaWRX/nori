import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

test('Windows backup launcher accepts real candidate and fails a bad receipt',
  {skip:process.platform!=='win32'||!process.env.NORI_PORTABLE_TEST_EXECUTABLE,timeout:120000},t=>{
    const root=mkdtempSync(join(tmpdir(),'nori backup launcher '))
    try {
      for(const name of ['check-native-backup.ps1','verify-portable-native.mjs','component-integrity.mjs',
        'desktop-artifacts.mjs','native-distribution-inventory.mjs'])
        copyFileSync(fileURLToPath(new URL('../scripts/'+name,import.meta.url)),join(root,name))
      const desktop=dirname(process.env.NORI_PORTABLE_TEST_EXECUTABLE)
      const run=receipt=>spawnSync('powershell.exe',['-NoProfile','-File',join(root,'check-native-backup.ps1'),
        '-DesktopRoot',desktop,'-ReceiptPath',receipt,'-VerificationTimeoutSeconds','100'],{encoding:'utf8',timeout:110000,windowsHide:true})
      const acceptedStarted=Date.now()
      const accepted=run(join(dirname(desktop),'native-desktop-receipt.json'))
      const acceptedElapsedMs=Date.now()-acceptedStarted
      assert.equal(accepted.status,0,JSON.stringify({error:accepted.error?.message,
        stdout:accepted.stdout?.slice(-8000),stderr:accepted.stderr?.slice(-8000)}))
      assert.match(accepted.stdout,/Backup file integrity passed/)
      assert.match(accepted.stdout,/Backup verification phase: native-hashes/)
      assert.match(accepted.stdout,/Backup verification phase: size-check/)
      t.diagnostic(JSON.stringify({backupAcceptedElapsedMs:acceptedElapsedMs,
        phases:[...accepted.stdout.matchAll(/Backup verification phase: ([a-z-]+) \(([0-9]+) ms\)/g)]
          .map(match=>({phase:match[1],elapsedMs:Number(match[2])}))}))
      const phases=[...accepted.stdout.matchAll(/Backup verification phase: ([a-z-]+)/g)].map(match=>match[1])
      assert.equal(new Set(phases).size,phases.length,'Each phase should be reported once')
      const bad=join(root,'bad-receipt.json');writeFileSync(bad,'{}')
      const rejectedStarted=Date.now()
      const rejected=run(bad)
      t.diagnostic(JSON.stringify({backupRejectedElapsedMs:Date.now()-rejectedStarted}))
      assert.notEqual(rejected.status,0)
      assert.match(rejected.stderr,/Backup verification failed/)
    }finally{rmSync(root,{recursive:true,force:true})}
})

test('Windows backup launcher stops its own never-finishing verifier at its internal deadline',
  {skip:process.platform!=='win32'||!process.env.NORI_PORTABLE_TEST_EXECUTABLE,timeout:15000},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori bounded verifier '))
    try {
      copyFileSync(fileURLToPath(new URL('../scripts/check-native-backup.ps1',import.meta.url)),join(root,'check-native-backup.ps1'))
      writeFileSync(join(root,'verify-portable-native.mjs'),"import {writeFileSync} from 'node:fs';writeFileSync(new URL('./verifier-pid.txt',import.meta.url),String(process.pid));setInterval(()=>{},1000)")
      const desktop=dirname(process.env.NORI_PORTABLE_TEST_EXECUTABLE)
      const started=Date.now()
      const result=spawnSync('powershell.exe',['-NoProfile','-File',join(root,'check-native-backup.ps1'),
        '-DesktopRoot',desktop,'-ReceiptPath',join(dirname(desktop),'native-desktop-receipt.json'),
        '-VerificationTimeoutSeconds','1'],{encoding:'utf8',timeout:10000,windowsHide:true})
      assert.equal(result.error,undefined)
      assert.notEqual(result.status,0)
      assert.match(result.stderr,/timed out after 1 seconds/)
      assert.ok(Date.now()-started<10000)
      const ownedPid=Number(readFileSync(join(root,'verifier-pid.txt'),'utf8'))
      assert.ok(Number.isInteger(ownedPid)&&ownedPid>0)
      assert.throws(()=>process.kill(ownedPid,0),'Timed-out owned helper must not remain running')
    }finally{rmSync(root,{recursive:true,force:true})}
})
