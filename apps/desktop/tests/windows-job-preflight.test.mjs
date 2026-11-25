import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {prepareOwnedJobFixture} from '../scripts/owned-job-fixture.mjs'
const host=fileURLToPath(new URL('../scripts/probe-windows-owned-job.ps1',import.meta.url))
const windows={skip:process.platform!=='win32',timeout:15000}
function refused(specs){
  const fixture=prepareOwnedJobFixture()
  for(const spec of specs){
    // Only this test's own generated manifest is replaced; no receiver/app,
    // personal state or existing source is changed.
    writeFileSync(join(fixture,'launch-spec.json'),JSON.stringify(spec))
    const result=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-File',host,'-Root',fixture],{encoding:'utf8',windowsHide:true,shell:false,timeout:5000})
    assert.equal(result.error,undefined)
    assert.equal(result.status,1)
    assert.equal(result.stdout.trim(),'','Malformed manifest must refuse before owned-root readiness')
    assert.equal(existsSync(join(fixture,'argv-started.txt')),false)
    assert.equal(existsSync(join(fixture,'desktop-job-acceptance.json')),false)
  }
}
const common={schema:1,nonce:'a'.repeat(64),mode:'desktop',argv:[],fault:'none',timeoutMs:10000}
test('PowerShell refuses null unused selectors and case variants before creating a desktop root',windows,()=>{
  const isolated={...common,desktopLayout:'isolated-v1',profileFixture:'.native-desktop-probe-job-preflight'}
  const consolidated={...common,desktopLayout:'consolidated-v1',layoutFixture:'.native-browser-migration-job-preflight'}
  refused([{...isolated,layoutFixture:null},{...consolidated,profileFixture:null},
    {...isolated,desktopLayout:'ISOLATED-V1'},{...consolidated,desktopLayout:'CONSOLIDATED-V1'},
    {...isolated,mode:'DESKTOP'},{...isolated,fault:'NONE'},{...isolated,nonce:'A'.repeat(64)}])
})
test('PowerShell refuses mistyped envelope and malformed argv before executing the fixed worker',windows,()=>{
  const spec={...common,mode:'argv'}
  refused([{...spec,schema:'1'},{...spec,timeoutMs:'10000'},{...spec,argv:null},
    {...spec,argv:[1]},{...spec,argv:['nul\0argument']},{...spec,argv:['x'.repeat(4097)]},
    {...spec,argv:Array(33).fill('x')}])
})
test('PowerShell refuses foreign, unpaired or mistyped browser continuity before launching a desktop',windows,()=>{
  const spec={...common,desktopLayout:'consolidated-v1',layoutFixture:'.native-browser-migration-job-preflight'}
  const url='http://127.0.0.1:54321/nori-storage-fixture?fixture='+'a'.repeat(64)
  refused([{...spec,browserCookieMode:'seed'}, {...spec,browserFixtureUrl:url},
    {...spec,browserCookieMode:'SEED',browserFixtureUrl:url},
    {...spec,browserCookieMode:'check',browserFixtureUrl:'https://example.com/'},
    {...spec,browserCookieMode:'check',browserFixtureUrl:url.replace('54321','0')},
    {...spec,browserCookieMode:'check',browserFixtureUrl:url.replace('54321','65536')},
    {...spec,BrowserCookieMode:'check',browserFixtureUrl:url}, {...spec,unknown:true}])
})
