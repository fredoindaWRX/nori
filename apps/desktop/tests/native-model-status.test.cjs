const test=require('node:test')
const assert=require('node:assert/strict')
const {nativeModelStatus}=require('../desktop/native-model-status.cjs')

test('model maintenance understands the owned Core/runtime stack rather than legacy child shape',()=>{
  const stack={runtime:{child:{exitCode:null}},core:{child:{exitCode:null}},status:{modelId:'imported-test-model'}}
  const result=nativeModelStatus(stack)
  assert.equal(result.online,true)
  assert.equal(result.loadedModel,'imported-test-model')
  assert.equal(result.runtime,'NorLlama')
  assert.equal(result.installed,false)
  assert.equal(result.model,'imported-test-model')
})

test('missing or stopped native parts produce offline metadata without exceptions',()=>{
  for(const stack of [null,{}, {child:{exitCode:null}}, {runtime:{},core:{}},
    {runtime:{child:{exitCode:0}},core:{child:{exitCode:null}}},
    {runtime:{child:{exitCode:null}},core:{child:{exitCode:1}}},
    {runtime:{child:{exitCode:null,signalCode:'SIGTERM'}},core:{child:{exitCode:null}}}]){
    const result=nativeModelStatus(stack)
    assert.equal(result.online,false)
    assert.equal(result.installed,false)
    assert.match(result.error,/SoN model activation is pending/)
  }
})

test('GPT-OSS status identifies the imported inference model and never calls it SoN',()=>{
  const service={modelId:'gpt-oss-20b',child:{exitCode:null,signalCode:null},
    localAgentProvider:{endpoint:'http://127.0.0.1:1234/v1',port:1234}}
  const result=nativeModelStatus(null,{runtimeMode:'gpt-oss',gptOssService:service})
  assert.equal(result.online,true)
  assert.equal(result.loadedModel,'gpt-oss-20b')
  assert.equal(result.modelId,'gpt-oss-20b')
  assert.match(result.runtime,/llama\.cpp.*imported GPT-OSS/)
  assert.match(result.identity,/not Nori-trained.*not a SoN checkpoint/)
  assert.equal(result.trainedByNori,false)
  assert.equal(result.sonCheckpoint,false)
  assert.equal(result.toolsQualified,false)
  assert.deepEqual(result.localAgentProvider,service.localAgentProvider)
})

test('stopped GPT-OSS remains named but is not reported online',()=>{
  const result=nativeModelStatus(null,{runtimeMode:'gpt-oss',gptOssService:{
    modelId:'gpt-oss-20b',child:{exitCode:0,signalCode:null},
  }})
  assert.equal(result.online,false)
  assert.equal(result.loadedModel,'gpt-oss-20b')
  assert.equal(result.modelId,'gpt-oss-20b')
  assert.match(result.error,/not running/)
  assert.equal(result.sonCheckpoint,false)
})
