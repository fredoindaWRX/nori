import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {prepareOwnedJobFixture,runOwnedJobFixture,prepareGuardedDesktopRestartState} from '../scripts/owned-job-fixture.mjs'
test('runner rejects serialized/path-shaped restart authority before manifest creation or state launch',
  {skip:process.platform!=='win32'},async()=>{
    const fixture=prepareOwnedJobFixture()
    for(const handle of [{}, {syntheticOnly:true,desktopLayout:'consolidated-v1'}, {layoutRoot:'C:\\Nori\\state'}]){
      await assert.rejects(runOwnedJobFixture({fixture,mode:'desktop',desktopLayout:'consolidated-v1',desktopRestartState:handle}),/process-local/)
      assert.equal(existsSync(join(fixture,'launch-spec.json')),false)
    }
    await assert.rejects(runOwnedJobFixture({fixture,mode:'argv',desktopRestartState:{}}),/contract/)
  })
test('preparation refuses foreign/unpaired storage URLs before provisioning anything',()=>{
  for(const url of [undefined,'https://example.com/','http://localhost:1234/nori-storage-fixture?fixture='+'a'.repeat(64)])
    assert.throws(()=>prepareGuardedDesktopRestartState({browserFixtureUrl:url}),/fixture|Windows/)
})
