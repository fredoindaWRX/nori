import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {localAiderModel} from '../bridge/aider-tools.mjs'
import {importedChatSelection,importedChatLabel,migrateImportedChatSelection} from '../bridge/imported-chat-selection.mjs'
const require=createRequire(import.meta.url)
test('the packaged bridge receives the suite root without relocating the persistent skill registry',()=>{
 const ts=createRequire('C:/Nori/apps/desktop/package.json')('typescript')
 const file=ts.createSourceFile('main.cjs',readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 const start=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='startBridge')
 assert.ok(start,'Desktop bridge startup function missing')
 const declarations=[]
 function walk(node){if(ts.isVariableDeclaration(node)&&node.name?.text==='env')declarations.push(node);ts.forEachChild(node,walk)}
 walk(start);assert.equal(declarations.length,1)
 const properties=declarations[0].initializer.properties
 assert.equal(properties.find(item=>item.name?.text==='NORI_SUITE_ROOT')?.initializer.getText(file),'SUITE_ROOT')
 assert.equal(properties.find(item=>item.name?.text==='NORI_SKILL_STORE')?.initializer.getText(file),"join(USER_DATA_ROOT, 'skills')")
})
const {nativeModelStatus}=require('../desktop/native-model-status.cjs')
test('everyday model identity reaches chat and coding without granting permissions',()=>{
  const environment={NORI_GPT_OSS_SERVER_MODEL:'qwen3.5-9b'}
  assert.equal(importedChatSelection(environment),'qwen3.5-9b')
  assert.equal(importedChatLabel(environment),'Qwen3.5 9B')
  assert.equal(migrateImportedChatSelection('qwen3.8:27b',environment),'qwen3.5-9b')
  assert.throws(()=>migrateImportedChatSelection('unknown-stale-model',environment),/does not match/)
  assert.deepEqual(localAiderModel(environment),{id:'openai/qwen3.5-9b',label:'local Qwen3.5 9B'})
  const status=nativeModelStatus(null,{runtimeMode:'gpt-oss',gptOssService:{modelId:'qwen3.5-9b',child:{exitCode:null,signalCode:null}}})
  assert.equal(status.modelId,'qwen3.5-9b')
  assert.match(status.runtime,/Qwen3.5 9B/)
  assert.equal(status.toolsQualified,false)
  assert.equal(status.trainedByNori,false)
})

test('automatic logical identity reaches chat and Aider without granting tool authority',()=>{
  const environment={NORI_GPT_OSS_SERVER_MODEL:'nori-auto'}
  assert.equal(importedChatSelection(environment),'nori-auto')
  assert.equal(importedChatLabel(environment),'Nori automatic local models')
  for(const prior of ['gpt-oss:20b','qwen3.8:27b','qwen3.5-9b'])assert.equal(migrateImportedChatSelection(prior,environment),'nori-auto')
  assert.throws(()=>migrateImportedChatSelection('unknown-stale-model',environment),/does not match/)
  assert.deepEqual(localAiderModel(environment),{id:'openai/nori-auto',label:'Nori automatic local coder'})
  const status=nativeModelStatus(null,{runtimeMode:'gpt-oss',gptOssService:{modelId:'nori-auto',routingStatus:{state:'ready',modelId:'qwen3.5-9b'}}})
  assert.equal(status.online,true);assert.equal(status.modelId,'nori-auto');assert.equal(status.loadedModel,'qwen3.5-9b')
  assert.equal(status.toolsQualified,false);assert.equal(status.executionAuthorized,false)
  assert.equal(status.contextTokens,65536)
})
