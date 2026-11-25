import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,rmdirSync,symlinkSync,unlinkSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {suiteComponents} from '../scripts/suite-components.mjs'

test('suite inventory identifies built parts and preserves model provenance',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-components-')),prefix='resources/NoriSuite/'
  const file=path=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),'fixture')}
  try{
    for(const path of ['Nori.exe','resources/app.asar',prefix+'engine/norama/norama-worker.exe',prefix+'models/language/model.gguf'])file(path)
    for(const path of ['runtime/norllama','python/Python311','nori','runtime/stt','runtime/voice','integrations/location','integrations/project-monitor'])mkdirSync(join(root,prefix,path),{recursive:true})
    for(const path of ['runtime/norllama/norllama.py','nori/main.py','python/Python311/python.exe'])file(prefix+path)
    mkdirSync(join(root,'backup-tools'));mkdirSync(join(root,'maintenance'))
    const config=join(root,prefix,'runtime/norllama/config.json')
    const value={engine_binary:'engine/norama/norama-worker.exe',model_path:'models/language/model.gguf',model_id:'imported-fixture'}
    writeFileSync(config,JSON.stringify(value))
    const result=suiteComponents(root)
    assert.equal(result.components.length,13)
    assert.equal(result.components.find(x=>x.id==='project-monitor').kind,'read-only-companion')
    assert.equal(result.releaseVerified,false)
    const core=result.components.find(x=>x.id==='nori-core-and-knights')
    assert.equal(core.execution.compiled,false)
    assert.equal(core.execution.mode,'interpreted-python')
    assert.equal(core.execution.entryPoint,prefix+'nori/main.py')
    assert.equal(core.execution.interpreter,prefix+'python/Python311/python.exe')
    const coreEntry=join(root,prefix+'nori/main.py')
    unlinkSync(coreEntry)
    assert.throws(()=>suiteComponents(root),/ENOENT/,'An empty component directory is not runnable')
    mkdirSync(coreEntry)
    assert.throws(()=>suiteComponents(root),/regular file/,'A directory cannot impersonate a launch script')
    rmdirSync(coreEntry)
    writeFileSync(coreEntry,'')
    assert.throws(()=>suiteComponents(root),/Empty suite component/)
    writeFileSync(coreEntry,'fixture')
    assert.equal(result.privateState.included,false)
    assert.equal(result.components.find(x=>x.id==='language-model').kind,'imported-model-weights')
    assert.equal(result.components.find(x=>x.id==='language-model').modelId,'imported-fixture')
    writeFileSync(config,JSON.stringify({...value,model_path:'models/language/../../secret'}))
    assert.throws(()=>suiteComponents(root),/Unqualified/)
    writeFileSync(config,JSON.stringify(value))
    rmdirSync(join(root,'maintenance'));symlinkSync(join(root,'backup-tools'),join(root,'maintenance'),'junction')
    assert.throws(()=>suiteComponents(root),/Unsafe suite component/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
