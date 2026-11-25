import test from 'node:test'
import assert from 'node:assert/strict'
import {desktopJobEnvironment} from '../scripts/owned-job-fixture.mjs'
test('real Job probe strips case-insensitive overrides and duplicate Node/sandbox/temp spellings',()=>{
  const source={Path:'synthetic-path',SystemRoot:'synthetic-Windows',
    NORI_ROOT:'other',nori_tts_worker:'unapproved',Nori_Runtime_Python:'outside',
    letta_api_key:'synthetic-secret',node_options:'--trace-warnings',Node_Path:'outside-module',
    electron_disable_sandbox:'1',ELECTRON_DISABLE_SANDBOX:'1',
    electron_run_as_node:'0',ELECTRON_RUN_AS_NODE:'0',
    PythonPath:'outside',pythonhome:'outside',PYTHONSTARTUP:'outside',temp:'old',TMP:'old'}
  const before={...source},env=desktopJobEnvironment(source,'isolated-compile')
  assert.deepEqual(source,before)
  assert.deepEqual(env,{Path:'synthetic-path',SystemRoot:'synthetic-Windows',
    TEMP:'isolated-compile',TMP:'isolated-compile',ELECTRON_RUN_AS_NODE:'1'})
})
