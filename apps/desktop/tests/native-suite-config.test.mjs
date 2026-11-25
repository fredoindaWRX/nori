import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
const root=resolve(import.meta.dirname,'../../..')
test('portable native Core configuration validates without legacy endpoint aliases',()=>{
  const config=JSON.parse(readFileSync(resolve(root,'nori/config.native-suite.json'),'utf8'))
  assert.equal(Object.keys(config.knights).length,12)
  assert.equal(new Set(config.startup_order).size,12)
  assert.deepEqual(config.sensors,[])
  assert.equal(config.owner,undefined)
  assert.equal(config.ollama_url,undefined)
  assert.equal(config.memory.letta_agent_id,undefined)
  assert.deepEqual(config.memory,{backend:'nori-sqlite'})
  for(const knight of Object.values(config.knights)) {
    assert.ok(Array.isArray(knight.tools))
    assert.ok(Array.isArray(knight.grants))
  }
  const result=spawnSync(resolve(root,'python/Python311/python.exe'),['-B',resolve(root,'nori/main.py'),
    '--config',resolve(root,'nori/config.native-suite.json'),'--check'],{cwd:root,encoding:'utf8',timeout:10000})
  assert.equal(result.error,undefined)
  assert.equal(result.status,0,result.stderr)
  assert.match(result.stdout,/Validated twelve Knights/)
})
