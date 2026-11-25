import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync,unlinkSync,existsSync,statSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join,dirname,relative} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {stageNativePayload} from '../scripts/stage-native-payload.mjs'
import {packageNativeDesktop,nativeMaintenanceScripts} from '../scripts/package-native-desktop.mjs'
import {nativeInstallerPlan,verifyNativeDesktopCandidate} from '../scripts/native-installer-plan.mjs'
import {seedSingleAppPolicy,seedSingleAppArchive} from './fixtures/single-app-policy.mjs'
import {nativeResourceFiles,nativeWakeFiles,nativeVisionFiles,nativeSkillReferenceFiles,nativeDesktopModuleFiles,nativeAiderFiles,nativeGptOssFiles,nativeImageGenerationFiles} from '../scripts/native-payload-plan.mjs'

test('synthetic packaged receipt enables read-only preflight and rejects same-size executable corruption',async()=>{
  const workspace=fileURLToPath(new URL('../../../',import.meta.url))
  const root=mkdtempSync(join(workspace,'verification','.nori-build-receipt-'))
  const put=(path,text='fixture')=>{const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text)}
  for(const path of nativeResourceFiles)put(path)
  for(const path of nativeAiderFiles)put(path,path.endsWith('/METADATA')?'Name: aider-chat\nVersion: 0.86.2\n':'fixture')
  for(const path of [...nativeGptOssFiles,...nativeImageGenerationFiles])
    put(path,path.endsWith('MODEL_PROVENANCE.json') ? readFileSync(join(workspace,path)) : 'inert-package-fixture')
  const installedArtCraft=JSON.parse(readFileSync(join(workspace,'integrations/artcraft/artcraft-apps.json'),'utf8'))
  const artCraftFixture={schema:installedArtCraft.schema,applications:installedArtCraft.applications.map(app=>({
    id:app.id,desktop_exe:app.desktop_exe,cli_exe:app.cli_exe,
  }))}
  for(const app of artCraftFixture.applications){
    put(`integrations/artcraft/${app.desktop_exe}`)
    put(`integrations/artcraft/${app.cli_exe}`)
  }
  put('integrations/artcraft/artcraft-apps.json',JSON.stringify(artCraftFixture))
  for(const path of nativeWakeFiles)put(path)
  for(const path of nativeVisionFiles.filter(path=>path.endsWith('.exe')))put(path)
  const visionModel='vision model fixture',visionProjector='vision projector fixture'
  put('models/vision/qwen2.5-vl-3b-instruct/manifest.json',JSON.stringify({modelId:'Qwen2.5-VL-3B-Instruct',
    license:'Apache-2.0',requiredWorker:'nori-vision-worker',workerFilename:'llama-mtmd-cli.exe',
    workerSha256:'24348241140a16750888351bf5dd6a1e0d3b9ee19d18fcdc428b68188f6b7535',
    languageModelFilename:'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',languageModelBytes:Buffer.byteLength(visionModel),languageModelSha256:createHash('sha256').update(visionModel).digest('hex'),
    projectorFilename:'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',projectorBytes:Buffer.byteLength(visionProjector),projectorSha256:createHash('sha256').update(visionProjector).digest('hex'),
    requiredEngine:'llama.cpp b11396 (2e7c58c5477478c8cf6e199cfaa5dcd5a4319c81)'}))
  put('models/vision/qwen2.5-vl-3b-instruct/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',visionModel)
  put('models/vision/qwen2.5-vl-3b-instruct/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',visionProjector)
  for(const path of nativeSkillReferenceFiles)put(path,readFileSync(join(workspace,path)))
  put('ROADMAP_TRACKING.json',JSON.stringify({schema_version:1,release_state:'NOT_VERIFIED',requirements:[{}],components:[{}]}))
  put('nori/packages/knights/neo/prompts/neo.md','native prompt')
  for(const name of ['index.html','mobile.css','mobile-client.mjs','mobile-ui.mjs'])put(`nori/mobile_ui/${name}`)
  for(const name of ['index.html','server.mjs','status.mjs','expanded-roadmap.mjs'])put(`integrations/project-monitor/${name}`)
  put('docs/nori-expanded-owner-roadmap.json',JSON.stringify({schema:'nori.expanded-owner-roadmap.v1',requirements:[]}))
  try{
    seedSingleAppPolicy(root)
    for (const name of nativeMaintenanceScripts) {
      const target = join(root, 'apps/desktop/scripts', name)
      if (!existsSync(target)) put(`apps/desktop/scripts/${name}`, readFileSync(new URL(`../scripts/${name}`, import.meta.url)))
    }
    for(const path of ['runtime/input/worker.py','runtime/stt/worker.py','runtime/voice/worker.py','runtime/vision/windows-ocr.ps1',
      'python/Python311/python.exe','models/voice/kokoro-v1/model.onnx','models/voice/whisper-base.en/model.bin',
      'engine/norama/norama-worker.exe','engine/norama/norama-tokenizer.exe','models/language/example/model.gguf','nori/main.py','runtime/norllama/norllama.py',
      'nori/config.native-suite.json','nori/security/hard_floor.yaml','nori/shared/orchestration/knights.json',
      'nori/prompts/covenant.md','nori/prompts/autonomy.md','apps/desktop/desktop/native-service.cjs',
      'apps/desktop/desktop/model-hardware-selection.cjs','apps/desktop/desktop/portable-model-selection.cjs',
      'apps/desktop/dist/index.html','compiler-fixture.exe'])put(path)
    for(const path of nativeDesktopModuleFiles)put(path,readFileSync(join(workspace,path)))
    for(const name of ['system_hand_input.py','whisper_stt.py','kokoro_tts.py'])
      put(`apps/desktop/bridge/${name}`)
    for(const name of ['start.mjs','receiver.mjs','latest-location.mjs','launch-private.ps1',
      'control-location.ps1','pair-phone.ps1','private-state-path.ps1','runtime-path.ps1','probe-native.mjs'])
      put('integrations/location/'+name)
    put('runtime/norllama/config.json',JSON.stringify({engine_binary:'engine/norama/norama-worker.exe',
      model_path:'models/language/example/model.gguf',model_id:'example'}))
    put('apps/desktop/electron-builder.native.yml',readFileSync(new URL('../electron-builder.native.yml',import.meta.url),'utf8'))
    put('apps/desktop/release/current-desktop.txt','owner-selected\n')
    const stage=join(root,'apps/desktop/release/native-suite-fixture/NoriSuite')
    stageNativePayload(root,stage)
    const fakeBuild=async options=>{
      const output=options.config.directories.output
      const packagePayload=join(output,'win-unpacked/resources/NoriSuite')
      cpSync(stage,packagePayload,{recursive:true,errorOnExist:true,force:false,filter:source=>{
        const path=relative(stage,source).replaceAll('\\','/')
        return !path.startsWith('models/language/')&&path!=='native-payload-receipt.json'
      }})
      writeFileSync(join(output,'win-unpacked/Nori.exe'),'fixture')
      await seedSingleAppArchive(root,join(output,'win-unpacked'))
      writeFileSync(join(output,'win-unpacked/runtime.dll'),'fixture')
    }
    const result=await packageNativeDesktop(root,fakeBuild,{candidate:'fixture'})
    assert.equal(result.packagedPayloadMatches,true)
    assert.equal(result.currentSelected,false,'Building alone does not replace the owner-selected app')
    assert.equal(readFileSync(join(root,'apps/desktop/release/current-desktop.txt'),'utf8'),'owner-selected\n')
    assert.equal(verifyNativeDesktopCandidate(root,{candidate:'fixture'}).desktopIntegrityVerified,true)
    const options={candidate:'fixture',compiler:join(root,'compiler-fixture.exe')}
    assert.equal(nativeInstallerPlan(root,options).compiled,false,'No fixture compiler is executed')
    assert.equal(nativeInstallerPlan(root,options).totalBytes,result.totalBytes)
    const receiptPath='apps/desktop/release/native-desktop-fixture/native-desktop-receipt.json'
    const receipt=JSON.parse(readFileSync(join(root,receiptPath),'utf8'))
    assert.equal(receipt.packagedModels.length,1+nativeGptOssFiles.filter(path=>path.startsWith('models/language/')).length)
    assert.equal(receipt.packagedModels.find(file=>file.path==='models/language/example/model.gguf').status,'linked')
    const gptOssModel=receipt.packagedModels.find(file=>file.path.endsWith('/gpt-oss-20b-mxfp4.gguf'))
    assert.equal(gptOssModel.status,'copied')
    assert.equal(statSync(join(result.output,'win-unpacked/resources/NoriSuite',gptOssModel.path)).nlink,1)
    assert.equal(statSync(join(stage,'models/language/example/model.gguf')).ino,
      statSync(join(result.output,'win-unpacked/resources/NoriSuite/models/language/example/model.gguf')).ino,
      'packaged GGUF is a same-volume hard link to the hash-verified stage file')
    assert.equal(receipt.nativeSdkIsolated,true,'Real archive passes SDK isolation without bypassing the gate')
    assert.equal(receipt.packagedAppIdentityVerified,true)
    assert.equal(receipt.singleAppPolicy.files.length,5)
    assert.equal(receipt.singleAppPolicy.releaseVerified,false)
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/scripts/stage-core-private-state.mjs'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/desktop/state-owner.cjs'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/desktop/native-state-layout.cjs'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/desktop/desktop-state-selection.cjs'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/desktop/consolidated-state-selection.cjs'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/desktop/probe-packaged-consolidated.cjs'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/desktop/probe-deadlines.cjs'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/scripts/stage-desktop-state-layout.mjs'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/scripts/verify-browser-state-acl.ps1'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='maintenance/scripts/browser-capability-sid.ps1'))
    assert.ok(receipt.desktopManifest.files.some(file=>file.path==='nori-components.json'))
    const components=JSON.parse(readFileSync(join(result.output,'win-unpacked/nori-components.json'),'utf8'))
    assert.equal(components.components.length,13)
    assert.equal(components.components.find(x=>x.id==='project-monitor').path,'resources/NoriSuite/integrations/project-monitor')
    assert.equal(components.releaseVerified,false)
    const relocated=await import(pathToFileURL(join(root,'apps/desktop/release/native-desktop-fixture/win-unpacked/maintenance/scripts/stage-core-private-state.mjs')).href)
    assert.equal(typeof relocated.stageCorePrivateState,'function','Maintenance dependency closure imports without source paths')
    const split=await import(pathToFileURL(join(result.output,'win-unpacked/maintenance/scripts/stage-desktop-state-layout.mjs')).href)
    assert.equal(typeof split.stageDesktopStateLayout,'function','Split maintenance dependency closure imports after relocation')
    put(receiptPath,JSON.stringify({...receipt,totalBytes:1}))
    assert.throws(()=>nativeInstallerPlan(root,options),/size receipt is inconsistent/)
    put(receiptPath,JSON.stringify(receipt))
    const unexpected='apps/desktop/release/native-desktop-fixture/win-unpacked/resources/NoriSuite/unexpected.exe'
    put(unexpected)
    await assert.rejects(async()=>nativeInstallerPlan(root,options),/required components/)
    unlinkSync(join(root,unexpected))
    put('apps/desktop/release/native-desktop-fixture/win-unpacked/Nori.exe','changed')
    await assert.rejects(async()=>nativeInstallerPlan(root,options),/integrity mismatch/)
    put('apps/desktop/release/native-desktop-fixture/win-unpacked/Nori.exe')
    put('apps/desktop/release/native-desktop-fixture/win-unpacked/runtime.dll','changed')
    await assert.rejects(async()=>nativeInstallerPlan(root,options),/integrity mismatch/)
    put('apps/desktop/release/native-desktop-fixture/win-unpacked/runtime.dll')
    put('apps/desktop/release/native-desktop-fixture/win-unpacked/unexpected.dll')
    await assert.rejects(async()=>nativeInstallerPlan(root,options),/required components/)
    await assert.rejects(packageNativeDesktop(root,async options=>{
      await fakeBuild(options)
      const metadata=join(root,'apps/desktop/package.json')
      writeFileSync(metadata,readFileSync(metadata,'utf8')+'\n')
    },{candidate:'changed-identity',stageCandidate:'fixture'}),/identity inputs changed during build/)
    assert.equal(existsSync(join(root,'apps/desktop/release/native-desktop-changed-identity/win-unpacked/Nori.exe')),true)
    assert.equal(existsSync(join(root,'apps/desktop/release/native-desktop-changed-identity/native-desktop-receipt.json')),false)
    assert.equal(readFileSync(join(root,'apps/desktop/release/current-desktop.txt'),'utf8'),'owner-selected\n')
  }finally{rmSync(root,{recursive:true,force:true})}
})
