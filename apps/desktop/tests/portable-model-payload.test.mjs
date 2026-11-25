import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {portableModelPayload} from '../scripts/portable-model-payload.mjs'
test('portable package includes the full selected model closure and refuses broken declarations',()=>{
  for(const mode of ['valid','unqualified','missing','corrupt','escape','identity','unbound-launcher','corrupt-python']){
    const root=mkdtempSync(join(tmpdir(),'Nori portable payload '))
    try{
      const hashes={}
      const put=(name,text)=>{const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);
        hashes[name]=createHash('sha256').update(text).digest('hex')}
      put('engine/worker.exe','worker');put('engine/support.dll','dependency');put('models/local.gguf','model')
      put('runtime/norllama/norllama.py','launcher');put('python/Python311/python.exe','python')
      put('runtime/cpu.json',JSON.stringify({model_id:mode==='identity'?'wrong':'small',compute_backend:'cpu',
        engine_binary:'engine/worker.exe',model_path:'models/local.gguf'}))
      const profile={id:'small',backend:'norama-cpu',qualified:mode!=='unqualified',bundled:true,
        configPath:mode==='escape'?'../outside.json':'runtime/cpu.json',runtimeFiles:['engine/support.dll'],artifactSha256:hashes}
      if(mode==='missing')profile.runtimeFiles=['engine/missing.dll']
      if(mode==='corrupt')writeFileSync(join(root,'engine/support.dll'),'changed')
      if(mode==='unbound-launcher')delete hashes['runtime/norllama/norllama.py']
      if(mode==='corrupt-python')writeFileSync(join(root,'python/Python311/python.exe'),'changed')
      put('catalog.json',JSON.stringify({schema:1,models:[profile]}))
      if(mode==='valid'){
        const result=portableModelPayload(root,'catalog.json')
        assert.deepEqual(result.files,['catalog.json','engine/support.dll','engine/worker.exe','models/local.gguf','python/Python311/python.exe','runtime/cpu.json','runtime/norllama/norllama.py'])
        assert.deepEqual(result.models,['small']);assert.equal(result.qualificationVerified,false)
      }else assert.throws(()=>portableModelPayload(root,'catalog.json'))
    }finally{assert.equal(resolve(dirname(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})}
  }
})
