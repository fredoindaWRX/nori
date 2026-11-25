import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const appRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const suiteRoot=resolve(appRoot,'../..')
const scenarios=['happy','late-failure','cancelled','wrong-peer','wrong-mac','replay',
  'skipped-sequence','ready-twice','sticky-failure','normal-upgrade','oversized','non-ascii',
  'ownership-without-cleanup','terminal-before-quitting','cancel-connect','cancel-read']

test('native named pipe authenticates only original Job root and bounds failures/cancellation',
  {skip:process.platform!=='win32',timeout:60000},()=>{
    const fixture=mkdtempSync(join(suiteRoot,'verification/.native-desktop-session-pipe-'))
    const executable=join(fixture,'desktop-session-pipe-fixture.exe')
    const compiler=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
    const compile=spawnSync(compiler,['/nologo','/target:exe',`/out:${executable}`,
      ...['windows-owned-job.cs','windows-desktop-session-pipe.cs','windows-desktop-session-pipe-fixture.cs']
        .map(name=>join(appRoot,'scripts',name))],
      {cwd:fixture,shell:false,windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:16384})
    assert.equal(compile.error,undefined,'Native pipe fixture compilation failed to run')
    assert.equal(compile.status,0,compile.stderr+compile.stdout)
    for(const scenario of scenarios){
      const result=spawnSync(executable,[scenario,process.execPath,
        join(appRoot,'scripts/windows-desktop-session-pipe-peer-fixture.cjs'),fixture],
        {cwd:fixture,shell:false,windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:16384})
      assert.equal(result.error,undefined,`Native scenario failed to run: ${scenario}`)
      assert.equal(result.status,0,`${scenario}: ${result.stderr}${result.stdout}`)
      const evidence=JSON.parse(result.stdout.trim())
      assert.equal(evidence.scenario,scenario)
      assert.equal(evidence.passed,true)
    }
  })
