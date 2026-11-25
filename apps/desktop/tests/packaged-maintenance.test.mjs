import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'

const executable=process.env.NORI_PORTABLE_TEST_EXECUTABLE
test('packaged maintenance stages protected synthetic state without source tools',
  {skip:!executable||process.platform!=='win32',timeout:60000},()=>{
    const fixture=mkdtempSync(join(tmpdir(),'nori packaged maintenance '))
    const source=join(fixture,'old-core')
    mkdirSync(source);writeFileSync(join(source,'memory.json'),'synthetic packaged memory')
    const moduleUrl=pathToFileURL(join(dirname(executable),'maintenance/scripts/stage-core-private-state.mjs')).href
    const code=`import {stageCorePrivateState} from ${JSON.stringify(moduleUrl)};
      import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
      const root=${JSON.stringify(fixture)},source=${JSON.stringify(source)};
      const result=stageCorePrivateState(root,source);
      assert.equal(result.protectedAclVerified,true);
      assert.equal(result.cooperativeOwnershipHeldThroughoutCopy,true);
      assert.equal(result.activationAuthorized,false);
      assert.equal(readFileSync(root+'/state/private/core/memory.json','utf8'),'synthetic packaged memory');
      assert.equal(readFileSync(source+'/memory.json','utf8'),'synthetic packaged memory');
      assert.equal(existsSync(source+'/.nori-state-owner.json'),false);
      assert.throws(()=>stageCorePrivateState(root,source),/destination preserved/);
      console.log(JSON.stringify({packagedMaintenanceVerified:true,liveStateUsed:false,activationAuthorized:false}));`
    try{
      const result=spawnSync(executable,['--input-type=module','-e',code],{
        cwd:fixture,encoding:'utf8',timeout:50000,windowsHide:true,
        env:{...process.env,PATH:join(process.env.SystemRoot,'System32'),
          ELECTRON_RUN_AS_NODE:'1',ELECTRON_LOG_FILE:join(fixture,'electron.log')}})
      assert.equal(result.error,undefined)
      assert.equal(result.status,0,result.stderr)
      assert.equal(JSON.parse(result.stdout.trim()).packagedMaintenanceVerified,true)
    }finally{rmSync(fixture,{recursive:true,force:true})}
  })
