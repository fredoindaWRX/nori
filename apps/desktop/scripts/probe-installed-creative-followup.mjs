// Installed routing test with synthetic generation/delivery callbacks; no GPU or UI claim.
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
assert.equal(process.execPath.toLowerCase(),'c:\\program files\\nori\\nori.exe')
const workspace=mkdtempSync(join(tmpdir(),'nori-installed-followup-'))
try{
  process.env.NORI_APP_DATA_ROOT=workspace
  process.env.NORI_LEARNING_FILE=join(workspace,'memory.json')
  const {query}=await import(pathToFileURL('C:/Program Files/Nori/resources/app.asar/bridge/nori-v2-query.mjs'))
  const prompts=['Create an animated Hallows Eve view through a window at rain and leaves falling.',
    'make it more realistic','yes do it exactly like that']
  async function* prompt(){for(const text of prompts)yield {message:{content:text}}}
  const generated=[],delivered=[],results=[]
  for await(const event of query({prompt:prompt(),options:{
    generateVideo:async intent=>{generated.push(intent);return {path:join(workspace,'synthetic.mp4'),mimeType:'video/mp4'}},
    nativeVideo:async video=>delivered.push(video),nativeImage:()=>assert.fail('Still-image route selected'),
  }}))if(event.type==='result')results.push(event)
  assert.equal(generated.length,3)
  assert.equal(delivered.length,3)
  assert.equal(results.length,3)
  assert.ok(results.every(result=>result.subtype==='success'))
  assert.match(generated[2].payload_cells[0][1],/Hallows Eve/)
  assert.match(generated[2].payload_cells[0][1],/make it more realistic/)
  assert.match(generated[2].payload_cells[0][1],/yes do it exactly like that/)
  console.log(JSON.stringify({passed:true,installedCode:true,syntheticCallbacks:true,dispatches:3,
    sceneAndRefinementsPreserved:true,realVideoGenerated:false,uiVerified:false}))
}finally{rmSync(workspace,{recursive:true,force:true})}
