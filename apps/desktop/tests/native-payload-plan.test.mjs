import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,existsSync,renameSync,symlinkSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
import ts from 'typescript'
import {createHash} from 'node:crypto'
import {nativePayloadPlan,nativeResourceFiles,nativeWakeFiles,nativeVisionFiles,nativeSkillReferenceFiles,nativeDesktopModuleFiles,nativeArtCraftAppIds,nativeImageGenerationFiles,nativeGptOssFiles,nativeAiderFiles} from '../scripts/native-payload-plan.mjs'
import {stageNativePayload} from '../scripts/stage-native-payload.mjs'
import {verifyNativePayload} from '../scripts/verify-native-payload.mjs'

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'nori-payload-plan-'))
  const put=(name,content='fixture')=>{const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content)}
  const visionModel='vision model fixture',visionProjector='vision projector fixture'
  for(const path of nativeResourceFiles)put(path)
  for(const path of nativeWakeFiles)put(path)
  for(const path of nativeAiderFiles)put(path,path.endsWith('/METADATA')?'Name: aider-chat\nVersion: 0.86.2\n':'fixture')
  put('integrations/aider/.venv/Lib/site-packages/litellm/__init__.py')
  put('integrations/aider/.venv/pyvenv.cfg','development machine path; never package')
  put('integrations/aider/.venv/Scripts/aider.exe','development launcher; never package')
  for(const path of nativeGptOssFiles)put(path,path.endsWith('MODEL_PROVENANCE.json')
    ?JSON.stringify({schema:'nori.third-party-model-provenance.v1',model_id:'gpt-oss-20b',
      repository:'ggml-org/gpt-oss-20b-GGUF',revision:'a7443ebb00ba299cbbbf7e9b69487670447ae8c0',
      license:'Apache-2.0',weights_trained_by_nori:false})
    :'inert GPT-OSS package fixture')
  for(const path of nativeVisionFiles.filter(path=>path.endsWith('.exe')))put(path)
  put('models/vision/qwen2.5-vl-3b-instruct/manifest.json',JSON.stringify({modelId:'Qwen2.5-VL-3B-Instruct',
    license:'Apache-2.0',requiredWorker:'nori-vision-worker',workerFilename:'llama-mtmd-cli.exe',
    workerSha256:'24348241140a16750888351bf5dd6a1e0d3b9ee19d18fcdc428b68188f6b7535',
    languageModelFilename:'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',languageModelBytes:Buffer.byteLength(visionModel),languageModelSha256:'a'.repeat(64),
    projectorFilename:'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',projectorBytes:Buffer.byteLength(visionProjector),projectorSha256:'b'.repeat(64),
    requiredEngine:'llama.cpp b11396 (2e7c58c5477478c8cf6e199cfaa5dcd5a4319c81)'}))
  put('models/vision/qwen2.5-vl-3b-instruct/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',visionModel)
  put('models/vision/qwen2.5-vl-3b-instruct/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',visionProjector)
  for(const path of nativeSkillReferenceFiles){
    const source=fileURLToPath(new URL(`../../../${path}`,import.meta.url))
    put(path,readFileSync(source))
  }
  for(const path of nativeDesktopModuleFiles)put(path)
  const artcraftApplications=nativeArtCraftAppIds.map(id=>{
    const folder=`apps/${id}/${id}-1.0.0-portable`
    const desktop=`${folder}/${id}.exe`
    const cli=`${folder}/${id}-cli.exe`
    put(`integrations/artcraft/${desktop}`)
    put(`integrations/artcraft/${cli}`)
    return {id,version:'1.0.0',desktop_exe:desktop,cli_exe:cli}
  })
  put('integrations/artcraft/artcraft-apps.json',JSON.stringify({
    schema:'nori.integration.artcraft-apps.v1',applications:artcraftApplications,
  }))
  for(const path of nativeImageGenerationFiles)put(path,path.endsWith('.safetensors')?'model fixture':'fixture')
  for(const path of [
    'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/input/private.png',
    'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/output/private.png',
    'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/user/default/workflow.json',
    'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/tests/private-test.py',
    'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/custom_nodes/private-node.py',
    'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/.git/private-object',
  ])put(path,'must not be packaged')
  put('runtime/norllama/norllama.py')
  put('ROADMAP_TRACKING.json',JSON.stringify({schema_version:1,release_state:'NOT_VERIFIED',requirements:[{}],components:[{}]}))
  put('docs/nori-expanded-owner-roadmap.json',JSON.stringify({schema:'nori.expanded-owner-roadmap.v1',requirements:[]}))
  put('nori/packages/knights/neo/prompts/neo.md','native prompt')
  put('nori/packages/knights/neo/agent.manifest.json','{}')
  for(const name of ['index.html','mobile.css','mobile-client.mjs','mobile-ui.mjs'])put(`nori/mobile_ui/${name}`)
  for(const name of ['index.html','server.mjs','status.mjs','expanded-roadmap.mjs'])put(`integrations/project-monitor/${name}`)
  put('runtime/vision/windows-ocr.ps1')
  for(const name of ['native-screen-text.mjs','screen-text-process.mjs'])put(`apps/desktop/bridge/${name}`)
  for(const path of ['runtime/input/launch_worker.py','runtime/stt/launch_worker.py','runtime/voice/launch_worker.py',
    'python/Python311/python.exe','models/voice/kokoro-v1/model.onnx','models/voice/whisper-base.en/model.bin',
    'engine/norama/norama-worker.exe','engine/norama/norama-tokenizer.exe','models/language/example/model.gguf','nori/main.py',
    'apps/desktop/bridge/system_hand_input.py','apps/desktop/bridge/whisper_stt.py','apps/desktop/bridge/kokoro_tts.py']) put(path)
  for(const path of ['nori/config.native-suite.json','nori/security/hard_floor.yaml','nori/shared/orchestration/knights.json','nori/prompts/covenant.md','nori/prompts/autonomy.md']) put(path)
  for(const name of ['start.mjs','receiver.mjs','latest-location.mjs','launch-private.ps1',
    'control-location.ps1','pair-phone.ps1','private-state-path.ps1','runtime-path.ps1','probe-native.mjs']) put(`integrations/location/${name}`)
  for(const name of ['nori-v2-query.mjs','local-image.mjs','image-intent.mjs','local-location.mjs','local-chat.mjs',
    'screen-perception-contract.mjs','response-profiles.mjs','nori-identity.mjs','nori-ui-commands.mjs','nori-school.mjs',
    'nori-learning.mjs','local-policy.mjs','native-runtime.mjs',
    'context-budget.mjs','installation-paths.mjs','neuralese-intent.mjs','neuralese-app-spec.mjs','neuralese-speech.mjs']) put(`apps/desktop/bridge/${name}`)
  put('apps/desktop/desktop/native-service.cjs')
  put('apps/desktop/desktop/model-hardware-selection.cjs')
  put('apps/desktop/desktop/portable-model-selection.cjs')
  put('runtime/norllama/config.json',JSON.stringify({engine_binary:'engine/norama/norama-worker.exe',model_path:'models/language/example/model.gguf',model_id:'example'}))
  return {root,put,cleanup:()=>rmSync(root,{recursive:true,force:true})}
}

test('native payload includes Aider dependencies, license and bridge without a machine-bound venv launcher',()=>{
  const f=fixture()
  try {
    const files=new Set(nativePayloadPlan(f.root).files.map(file=>file.path))
    for(const path of nativeAiderFiles)assert.ok(files.has(path),path)
    assert.ok(files.has('apps/desktop/bridge/aider-tools.mjs'))
    assert.ok(files.has('integrations/aider/.venv/Lib/site-packages/litellm/__init__.py'))
    assert.ok(!files.has('integrations/aider/.venv/pyvenv.cfg'))
    assert.ok(!files.has('integrations/aider/.venv/Scripts/aider.exe'))
  }finally{f.cleanup()}
})

test('native payload includes every portable ArtCraft app binary but not user workspaces',()=>{
  const f=fixture()
  try {
    const files=new Set(nativePayloadPlan(f.root).files.map(file=>file.path))
    for(const id of nativeArtCraftAppIds){
      assert.ok([...files].some(file=>file.startsWith(`integrations/artcraft/apps/${id}/`)),`missing ArtCraft ${id}`)
    }
    assert.ok(files.has('integrations/artcraft/artcraft-apps.json'))
    assert.ok(![...files].some(file=>file.includes('/workspaces/')))
  }finally{f.cleanup()}
})

test('native desktop payload includes the pinned GPT-OSS chat model, runtime, provenance, and license notice',()=>{
  const f=fixture()
  try {
    const files=new Set(nativePayloadPlan(f.root).files.map(file=>file.path))
    for(const path of nativeGptOssFiles)assert.ok(files.has(path),`missing GPT-OSS dependency ${path}`)
    assert.ok(files.has('models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/gpt-oss-20b-mxfp4.gguf'))
    assert.ok(files.has('models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/MODEL_PROVENANCE.json'))
  }finally{f.cleanup()}
})

test('native payload includes local ComfyUI runtime and models but excludes user workspaces',()=>{
  const f=fixture()
  try {
    const codeInput='integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/comfy_api/input/__init__.py'
    const codeOutput='integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/comfy_api/output/__init__.py'
    f.put(codeInput,'class CurvePoint: pass')
    f.put(codeOutput,'runtime_output = True')
    const files=new Set(nativePayloadPlan(f.root).files.map(file=>file.path))
    assert.ok(files.has(codeInput),'nested input package is required Python code')
    assert.ok(files.has(codeOutput),'nested output package is required Python code')
    for(const path of nativeImageGenerationFiles)assert.ok(files.has(path),`missing image runtime dependency ${path}`)
    assert.ok(![...files].some(path=>/\/ComfyUI\/(?:input|output|user|tests|tests-unit|custom_nodes|\.git)(?:\/|$)/.test(path)))
    rmSync(join(f.root,nativeImageGenerationFiles.at(-1)))
    assert.throws(()=>nativePayloadPlan(f.root),/ENOENT/)
  }finally{f.cleanup()}
})

test('unavailable SoN declaration refuses staging even with legacy engine fields present',()=>{
  const f=fixture(),stage=join(f.root,'apps/desktop/release/unavailable-son')
  try {
    f.put('runtime/norllama/config.json',JSON.stringify({status:'UNAVAILABLE',
      model_id:'nori-son-awaiting-qualification',engine_binary:'engine/norama/norama-worker.exe',
      model_path:'models/language/example/model.gguf'}))
    assert.throws(()=>stageNativePayload(f.root,stage),error=>error.code==='NORI_MODEL_UNAVAILABLE')
    assert.equal(existsSync(stage),false)
  }finally{f.cleanup()}
})

test('missing query activity or instruction dependency prevents incomplete staging',()=>{
  for(const name of ['instruction-skills.mjs','neural-event-contract.mjs','neuralese-speech.mjs','native-memory-observation.mjs',
    'work-neural-observations.mjs','neural-origin.mjs']){
    const f=fixture(),stage=join(f.root,'apps/desktop/release/incomplete-query')
    try{
      rmSync(join(f.root,'apps/desktop/bridge',name))
      assert.throws(()=>stageNativePayload(f.root,stage),/ENOENT/)
      assert.equal(existsSync(stage),false)
    }finally{f.cleanup()}
  }
})

test('portable staging binds the selected model, worker and supporting library copies',()=>{
  const f=fixture()
  const stage=join(f.root,'apps/desktop/release/portable-fixture/NoriSuite')
  try{
    const configName='runtime/norllama/cpu-profile.json'
    const config={model_id:'cpu-small',compute_backend:'cpu',engine_binary:'engine/norama/cpu-worker.exe',
      model_path:'models/language/cpu-small/model.gguf'}
    f.put(configName,JSON.stringify(config));f.put(config.engine_binary,'CPU worker')
    f.put(config.model_path,'CPU weights');f.put('engine/norama/support.dll','OpenMP fixture')
    const hashes=Object.fromEntries([configName,config.engine_binary,config.model_path,'engine/norama/support.dll',
      'runtime/norllama/norllama.py','python/Python311/python.exe']
      .map(name=>[name,createHash('sha256').update(readFileSync(join(f.root,name))).digest('hex')]))
    const portableCatalog='runtime/norllama/mini-model-catalog.json'
    f.put(portableCatalog,JSON.stringify({schema:1,models:[{id:config.model_id,backend:'norama-cpu',
      qualified:true,bundled:true,configPath:configName,runtimeFiles:['engine/norama/support.dll'],artifactSha256:hashes}]}))
    const receipt=stageNativePayload(f.root,stage,{portableCatalog})
    assert.equal(receipt.portableCatalog,portableCatalog)
    assert.equal(receipt.hardlinked,receipt.files.filter(file=>file.path.startsWith('models/language/')&&
      !file.path.endsWith('/gpt-oss-20b-mxfp4.gguf')).length)
    assert.equal(verifyNativePayload(f.root,stage,{portableCatalog}).stageMatches,true)
    assert.equal(readFileSync(join(stage,config.model_path),'utf8'),'CPU weights')
    assert.equal(statSync(join(f.root,config.model_path)).ino,statSync(join(stage,config.model_path)).ino,
      'qualified portable GGUF is linked only after its catalog hash has been checked')
    assert.notEqual(statSync(join(f.root,'models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/gpt-oss-20b-mxfp4.gguf')).ino,
      statSync(join(stage,'models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/gpt-oss-20b-mxfp4.gguf')).ino,
      'GPT-OSS model has an independent copy for packaged launch')
    assert.throws(()=>verifyNativePayload(f.root,stage),/stale or incomplete/)
    writeFileSync(join(stage,'engine/norama/support.dll'),'tampered DLL')
    assert.throws(()=>verifyNativePayload(f.root,stage,{portableCatalog}))
  }finally{f.cleanup()}
})

test('native payload rejects an internal linked ancestor for a required binary',()=>{
  const f=fixture()
  try{
    renameSync(join(f.root,'engine/norama'),join(f.root,'engine/actual'))
    symlinkSync(join(f.root,'engine/actual'),join(f.root,'engine/norama'),'junction')
    assert.throws(()=>nativePayloadPlan(f.root),/Native payload link/)
  }finally{f.cleanup()}
})

test('wake helper is mandatory and absence prevents incomplete staging',()=>{
  const f=fixture()
  try{
    const files=new Set(nativePayloadPlan(f.root).files.map(file=>file.path))
    for(const required of nativeWakeFiles)assert.ok(files.has(required))
    rmSync(join(f.root,'runtime/wake/nori-microphone.exe'))
    const stage=join(f.root,'apps/desktop/release/missing-wake')
    assert.throws(()=>stageNativePayload(f.root,stage),/ENOENT/)
    assert.equal(existsSync(stage),false)
  }finally{f.cleanup()}
})

test('allowlisted Nori and React references are packaged without activating candidate code or incoming bundles',()=>{
  const f=fixture()
  try{
    const files=new Set(nativePayloadPlan(f.root).files.map(file=>file.path))
    for(const path of nativeSkillReferenceFiles)assert.ok(files.has(path))
    assert.equal(files.has('skills/incoming/vercel-agent-skills/skills/react-best-practices/SKILL.md'),true)
    assert.equal(files.has('skills/incoming/vercel-agent-skills/skills/writing-guidelines/SKILL.md'),true)
    assert.equal(files.has('skills/incoming/vercel-agent-skills/skills/deploy-to-vercel/SKILL.md'),true)
    assert.equal(files.has('skills/quarantine/addyosmani--agent-skills-1401c8b8030e023baeebb31781a6653fe8e93026/skill/SKILL.md'),false)
    assert.equal(files.has('skills/nori-linux-graphics-investigator/skill.py'),false)
    assert.equal(files.has('skills/nori-linux-graphics-investigator/test_skill.py'),false)
    rmSync(join(f.root,nativeSkillReferenceFiles[0]))
    assert.throws(()=>nativePayloadPlan(f.root),/ENOENT/)
  }finally{f.cleanup()}
})

test('resource coordination closure is mandatory and its diagnostic config is excluded',()=>{
  const f=fixture()
  try {
    f.put('runtime/norllama/resource-coordination.experimental.json','diagnostic-only')
    f.put('runtime/compute/test_resource_budget.py','test-only')
    const paths=new Set(nativePayloadPlan(f.root).files.map(file=>file.path))
    for(const required of nativeResourceFiles)assert.ok(paths.has(required))
    assert.equal(paths.has('runtime/norllama/resource-coordination.experimental.json'),false)
    assert.equal(paths.has('runtime/compute/test_resource_budget.py'),false)
    rmSync(join(f.root,'runtime/compute/private_resource_budget.py'))
    const destination=join(f.root,'apps/desktop/release/missing-resource-closure')
    assert.throws(()=>stageNativePayload(f.root,destination),/ENOENT/)
    assert.equal(existsSync(destination),false)
  } finally {f.cleanup()}
})

test('screen text worker and adapter closure are mandatory and missing files prevent staging',()=>{
  for(const required of ['runtime/vision/windows-ocr.ps1','apps/desktop/bridge/native-screen-text.mjs','apps/desktop/bridge/screen-text-process.mjs']) {
    const f=fixture(),destination=join(f.root,'apps/desktop/release/incomplete-screen-text')
    try {
      assert.ok(nativePayloadPlan(f.root).files.some(file=>file.path===required))
      rmSync(join(f.root,required))
      assert.throws(()=>stageNativePayload(f.root,destination),/ENOENT/)
      assert.equal(existsSync(destination),false)
    }finally{f.cleanup()}
  }
})

test('local image-understanding model and worker are mandatory native payload components',()=>{
  const f=fixture(),destination=join(f.root,'apps/desktop/release/incomplete-vision')
  try{
    const paths=new Set(nativePayloadPlan(f.root).files.map(file=>file.path))
    for(const path of [
      'apps/desktop/bridge/local-vision.mjs',
      'models/vision/qwen2.5-vl-3b-instruct/manifest.json',
      'models/vision/qwen2.5-vl-3b-instruct/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',
      'models/vision/qwen2.5-vl-3b-instruct/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',
      'engine/vision/build/upstream-smoke/bin/llama-mtmd-cli.exe',
    ])assert.ok(paths.has(path),`missing local vision payload ${path}`)
    const model='models/vision/qwen2.5-vl-3b-instruct/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf'
    rmSync(join(f.root,model))
    assert.equal(existsSync(join(f.root,model)),false)
    assert.throws(()=>nativePayloadPlan(f.root),/ENOENT/)
    assert.throws(()=>stageNativePayload(f.root,destination),/ENOENT/)
    assert.equal(existsSync(destination),false)
  }finally{f.cleanup()}
})

test('mobile workspace ships its full static UI and refuses a missing client module',()=>{
  const f=fixture()
  try{
    const paths=new Set(nativePayloadPlan(f.root).files.map(file=>file.path))
    for(const name of ['index.html','mobile.css','mobile-client.mjs','mobile-ui.mjs'])assert.ok(paths.has(`nori/mobile_ui/${name}`))
    rmSync(join(f.root,'nori/mobile_ui/mobile-client.mjs'))
    assert.throws(()=>nativePayloadPlan(f.root),/ENOENT/)
  }finally{f.cleanup()}
})
test('native plan selects runtime components without private state or legacy runtimes',()=>{
  const f=fixture()
  try {
    f.put('nori/__init__.py','')
    f.put('nori/.venv-architect/Lib/site-packages/developer_only.py')
    f.put('nori/.venv/Lib/site-packages/another_developer.py')
    f.put('nori/knights/architect/lib/development_only.py')
    f.put('nori/secrets/password.txt');f.put('runtime/norllama/state/private.json')
    f.put('ollama/ollama.exe');f.put('verification/private.json');f.put('nori/tests/test_example.py')
    const result=nativePayloadPlan(f.root)
    assert.equal(result.releaseVerified,false)
    assert.ok(result.files.some(file=>file.path==='nori/__init__.py'))
    assert.ok(result.files.some(file=>file.path==='integrations/location/start.mjs'))
    assert.ok(result.files.some(file=>file.path==='integrations/project-monitor/server.mjs'))
    assert.ok(result.files.some(file=>file.path==='ROADMAP_TRACKING.json'))
    assert.ok(result.files.some(file=>file.path==='engine/norama/norama-tokenizer.exe'))
    assert.ok(result.files.some(file=>file.path==='apps/desktop/bridge/context-budget.mjs'))
    assert.ok(result.files.some(file=>file.path==='apps/desktop/bridge/screen-perception-contract.mjs'))
    assert.ok(result.files.some(file=>file.path==='apps/desktop/bridge/installation-paths.mjs'))
    assert.ok(result.files.some(file=>file.path==='integrations/location/runtime-path.ps1'))
    assert.ok(result.files.every(file=>!/(^|\/)(secrets|state|ollama|verification|tests)(\/|$)/.test(file.path)))
    assert.ok(result.files.every(file=>!file.path.includes('/.venv') ||
      file.path.startsWith('integrations/aider/.venv/Lib/site-packages/')))
    assert.ok(result.files.every(file=>!file.path.startsWith('nori/knights/architect/')))
    assert.ok(result.files.some(file=>file.path==='nori/packages/knights/neo/prompts/neo.md'))
    assert.ok(result.files.some(file=>file.path==='nori/packages/knights/neo/agent.manifest.json'))
    assert.equal(result.bytes,result.files.reduce((sum,file)=>sum+file.bytes,0))
    assert.deepEqual(nativePayloadPlan(f.root),result)
  } finally {f.cleanup()}
})

test('Llama bridge payload includes hash-verified model provenance and license notices',()=>{
  const f=fixture()
  try {
    const modelDir='models/language/example'
    const license='Llama Community License fixture'
    const policy='Llama Acceptable Use Policy fixture'
    f.put(`${modelDir}/model.gguf`,'fixture weights')
    f.put(`${modelDir}/LICENSE-1.txt`,license)
    f.put(`${modelDir}/LICENSE-2.txt`,policy)
    const hash=value=>createHash('sha256').update(value).digest('hex')
    const provenance={sha256:'a'.repeat(64),ownership:'Imported third-party model, not trained Nori weights',license_files:[
      {path:'LICENSE-1.txt',sha256:hash(license)},{path:'LICENSE-2.txt',sha256:hash(policy)}]}
    f.put(`${modelDir}/MODEL_PROVENANCE.json`,JSON.stringify(provenance))
    f.put('runtime/norllama/config.json',JSON.stringify({engine_binary:'engine/norama/norama-worker.exe',
      model_path:`${modelDir}/model.gguf`,model_id:'llama3.2-3b-instruct',
      provenance:{sha256:provenance.sha256,nori_trained:false}}))
    const plan=nativePayloadPlan(f.root)
    const paths=new Set(plan.files.map(file=>file.path))
    for(const path of [`${modelDir}/MODEL_PROVENANCE.json`,`${modelDir}/LICENSE-1.txt`,`${modelDir}/LICENSE-2.txt`])
      assert.ok(paths.has(path),`missing packaged notice ${path}`)

    f.put(`${modelDir}/LICENSE-2.txt`,'changed policy')
    assert.throws(()=>nativePayloadPlan(f.root),/license hash mismatch/)
  } finally {f.cleanup()}
})
test('staging verification rejects equal-size source changes and damaged copies',()=>{
  const f=fixture()
  const destination=join(f.root,'apps/desktop/release/test-hash-payload')
  try {
    stageNativePayload(f.root,destination)
    f.put('nori/main.py','changed') // Same length as fixture: sizes alone cannot catch this.
    assert.throws(()=>verifyNativePayload(f.root,destination),/integrity mismatch/)
    f.put('nori/main.py','fixture')
    writeFileSync(join(destination,'nori/main.py'),'changed')
    assert.throws(()=>verifyNativePayload(f.root,destination),/integrity mismatch/)
  } finally {f.cleanup()}
})
test('payload plan refuses unsafe engine, empty weights, and excess size',()=>{
  const f=fixture()
  try {
    assert.throws(()=>nativePayloadPlan(f.root,{maxBytes:1}),/size limit/)
    f.put('models/language/example/model.gguf','')
    assert.throws(()=>nativePayloadPlan(f.root),/Empty native payload binary/)
    f.put('runtime/norllama/config.json',JSON.stringify({engine_binary:'../external.exe',model_path:'models/language/example/model.gguf'}))
    assert.throws(()=>nativePayloadPlan(f.root),/Unqualified native engine/)
  } finally {f.cleanup()}
})
test('fresh staging verifies copies, preserves source, and refuses destination reuse',()=>{
  const f=fixture()
  const destination=join(f.root,'apps/desktop/release/test-payload')
  try {
    const result=stageNativePayload(f.root,destination)
    assert.equal(result.copyVerified,true)
    assert.equal(result.hardlinked,result.files.filter(file=>file.path.startsWith('models/language/')&&
      !file.path.endsWith('/gpt-oss-20b-mxfp4.gguf')).length)
    assert.equal(result.copiedModelFiles,1)
    assert.equal(verifyNativePayload(f.root,destination).stageMatches,true)
    assert.equal(statSync(join(f.root,'models/language/example/model.gguf')).ino,
      statSync(join(destination,'models/language/example/model.gguf')).ino)
    assert.equal(result.startupVerified,false)
    assert.equal(result.releaseVerified,false)
    for(const file of result.files) assert.deepEqual(readFileSync(join(destination,file.path)),readFileSync(join(f.root,file.path)))
    assert.throws(()=>stageNativePayload(f.root,destination),/existing files preserved/)
    assert.ok(existsSync(join(destination,'native-payload-receipt.json')))
  } finally {f.cleanup()}
})
test('cross-volume model staging falls back to a receipt-verified copy',()=>{
  const f=fixture()
  const destination=join(f.root,'apps/desktop/release/cross-volume-payload')
  try {
    const result=stageNativePayload(f.root,destination,{
      createHardlink(){throw Object.assign(new Error('different volume'),{code:'EXDEV'})}
    })
    assert.equal(result.hardlinked,0)
    assert.equal(result.copiedModelFiles,result.files.filter(file=>file.path.startsWith('models/language/')).length)
    assert.equal(verifyNativePayload(f.root,destination).stageMatches,true)
    assert.deepEqual(readFileSync(join(destination,'models/language/example/model.gguf')),
      readFileSync(join(f.root,'models/language/example/model.gguf')))
    assert.notEqual(statSync(join(f.root,'models/language/example/model.gguf')).ino,
      statSync(join(destination,'models/language/example/model.gguf')).ino)
  }finally{f.cleanup()}
})
test('staging cannot target a source component and creates nothing on rejection',()=>{
  const f=fixture()
  try {
    const destination=join(f.root,'runtime/new-output')
    assert.throws(()=>stageNativePayload(f.root,destination),/restricted/)
    assert.equal(existsSync(destination),false)
  } finally {f.cleanup()}
})

test('missing phone runtime helper prevents staging an incomplete suite',()=>{
  const f=fixture()
  const destination=join(f.root,'apps/desktop/release/incomplete-phone-payload')
  try {
    rmSync(join(f.root,'integrations/location/runtime-path.ps1'))
    assert.throws(()=>stageNativePayload(f.root,destination),/ENOENT/)
    assert.equal(existsSync(destination),false)
  } finally {f.cleanup()}
})

test('missing dashboard dependency prevents any incomplete staging output',()=>{
  const f=fixture(),destination=join(f.root,'apps/desktop/release/incomplete-monitor')
  try {
    rmSync(join(f.root,'integrations/project-monitor/status.mjs'))
    assert.throws(()=>stageNativePayload(f.root,destination),/ENOENT/)
    assert.equal(existsSync(destination),false)
  }finally{f.cleanup()}
})

test('candidate roadmap changes invalidate the stage instead of silently changing release evidence',()=>{
  const f=fixture(),destination=join(f.root,'apps/desktop/release/roadmap-candidate')
  try {
    stageNativePayload(f.root,destination)
    f.put('ROADMAP_TRACKING.json',JSON.stringify({schema_version:1,release_state:'NOT_VERIFIED',requirements:[{},{}],components:[{}]}))
    assert.throws(()=>verifyNativePayload(f.root,destination),/stale or incomplete|integrity mismatch/)
  }finally{f.cleanup()}
})

test('current staged desktop modules include every static relative JS dependency',()=>{
  // Parse, never execute product modules or access devices. Fixture-only module
  // text cannot catch a new real import omitted from the explicit shipping list.
  const root=fileURLToPath(new URL('../../../',import.meta.url))
  const paths=new Set(nativeDesktopModuleFiles)
  for(const path of paths) {
    if(!/^apps\/desktop\/.*\.(?:mjs|cjs)$/.test(path))continue
    const file=ts.createSourceFile(path,readFileSync(join(root,path),'utf8'),
      ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
    function visit(node) {
      let specifier
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))specifier=node.moduleSpecifier
      else if(ts.isCallExpression(node)&&node.arguments.length===1&&
        (node.expression.kind===ts.SyntaxKind.ImportKeyword||
          ts.isIdentifier(node.expression)&&node.expression.text==='require'))specifier=node.arguments[0]
      if(specifier&&ts.isStringLiteral(specifier)&&specifier.text.startsWith('.')) {
        const dependency=resolve(dirname(join(root,path)),specifier.text).slice(root.length).replaceAll('\\','/').replace(/^\//,'')
        assert.ok(paths.has(dependency),`${path} imports unstaged ${dependency}`)
      }
      ts.forEachChild(node,visit)
    }
    visit(file)
  }
})

test('real query adapter imports from relocated shipping module closure without inference',()=>{
  const source=fileURLToPath(new URL('../../../',import.meta.url)),f=fixture()
  try{
    for(const name of nativeDesktopModuleFiles)f.put(name,readFileSync(join(source,name)))
    const entry=pathToFileURL(join(f.root,'apps/desktop/bridge/nori-v2-query.mjs')).href
    const result=spawnSync(process.execPath,['--input-type=module','-e',
      'const module=await import(process.argv[1]); if(typeof module.query!=="function")throw Error("Missing query export");console.log("QUERY_IMPORT_OK");',entry],
      {cwd:f.root,shell:false,windowsHide:true,timeout:10000,encoding:'utf8',
        env:{...process.env,NODE_OPTIONS:''}})
    assert.ifError(result.error)
    assert.equal(result.status,0,result.stderr)
    assert.match(result.stdout,/QUERY_IMPORT_OK/)
  }finally{f.cleanup()}
})

test('missing prompt tokenizer prevents staging a silently degraded chat candidate',()=>{
  const f=fixture(),destination=join(f.root,'apps/desktop/release/incomplete-tokenizer')
  try {
    rmSync(join(f.root,'engine/norama/norama-tokenizer.exe'))
    assert.throws(()=>stageNativePayload(f.root,destination),/ENOENT/)
    assert.equal(existsSync(destination),false)
  }finally{f.cleanup()}
})

