import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'

for(const runtime of ['gpt-oss','norllama']) {
  test(`Aider capability questions reach host tooling with ${runtime}`,()=>{
    const root=mkdtempSync(join(tmpdir(),'nori-aider-capability-'))
    try {
      const queryModule=new URL('../bridge/nori-v2-query.mjs',import.meta.url).href
      const aiderModule=new URL('../bridge/aider-tools.mjs',import.meta.url).href
      const run=spawnSync(process.execPath,['--input-type=module','-e',`
        import assert from 'node:assert/strict'
        const {usesLocalChatRoute}=await import(${JSON.stringify(queryModule)})
        const {isAiderCodeRequest}=await import(${JSON.stringify(aiderModule)})
        for(const goal of ['Can you write code?','Could you code?','Do you have Aider?',
          'Can you do coding work?','Does your coding worker run tests?',
          'Can your Aider worker run tests?']) {
          assert.equal(usesLocalChatRoute({goal}),true,goal)
          assert.equal(isAiderCodeRequest(goal),false,'A status question cannot authorize coding')
        }
      `],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,
        NORI_INFERENCE_RUNTIME:runtime,NORI_LOCAL_CHAT:'1',NORI_SETTINGS_DIR:root,
        NORI_LEARNING_FILE:join(root,'learning.json'),NORI_APP_DATA_ROOT:root,
        NORI_RUNTIME_CONFIG_PATH:join(root,'absent.json')}})
      assert.equal(run.status,0,run.stderr)
    }finally{rmSync(root,{recursive:true,force:true})}
  })
}
