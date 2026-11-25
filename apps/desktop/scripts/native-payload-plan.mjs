import {createHash} from 'node:crypto'
import {lstatSync, readdirSync, readFileSync, realpathSync} from 'node:fs'
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {createRequire} from 'node:module'
import {portableModelPayload} from './portable-model-payload.mjs'

const require=createRequire(import.meta.url)
const gptOssService=require('../desktop/gpt-oss-service.cjs')

// Planning is read-only. Never copy a checkout wholesale into an installer.
const excluded = new Set(['.git','__pycache__','.pytest_cache','tests','node_modules','state','secrets','logs'])
export const nativeResourceFiles=Object.freeze([
  'runtime/norllama/resource_startup.py',
  'runtime/compute/resource_budget.py','runtime/compute/budgeted_worker.py',
  'runtime/compute/private_resource_budget.py','runtime/compute/verify-budget-acl.ps1',
  'apps/desktop/scripts/verify-private-state-acl.ps1'
])
export const nativeWakeFiles=Object.freeze([
  'runtime/wake/nori-microphone.exe','runtime/wake/transcribe_worker.py'
])
export const nativeAiderFiles=Object.freeze([
  'nori/nori_aider.py',
  'nori/development_workers/aider_adapter.py',
  'integrations/aider/run_aider.py',
  'integrations/aider/aider-nori.conf.yml',
  'integrations/aider/.venv/Lib/site-packages/aider/main.py',
  'integrations/aider/.venv/Lib/site-packages/aider_chat-0.86.2.dist-info/METADATA',
  'integrations/aider/.venv/Lib/site-packages/aider_chat-0.86.2.dist-info/licenses/LICENSE.txt',
  'integrations/aider/git/mingw64/bin/git.exe',
  'integrations/aider/git/LICENSE.txt',
  'integrations/aider/gpt-oss-20b.settings.yml',
])
export const nativeArtCraftAppIds=Object.freeze(['photocraft','vectorcraft','filmcraft','lightcraft','pdfcraft',
  'effectcraft','designcraft','figcraft','wordcraft','soundcraft','deckcraft','cadcraft','gridcraft'])
export const nativeGptOssFiles=Object.freeze([
  gptOssService.MODEL_RELATIVE,
  gptOssService.SERVER_RELATIVE,
  ...gptOssService.RUNTIME_FILES.map(([path])=>path),
  'models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/MODEL_PROVENANCE.json',
  'engine/vision/third_party/llama.cpp/LICENSE'
])
export const nativeImageGenerationFiles=Object.freeze([
  'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/main.py',
  'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/LICENSE',
  'integrations/image-generation/runtime/ComfyUI_windows_portable/python_embeded/python.exe',
  'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/models/diffusion_models/z_image_turbo_int8_convrot.safetensors',
  'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/models/text_encoders/qwen_3_4b_fp8_mixed.safetensors',
  'integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/models/vae/ae.safetensors',
])
const imageGenerationExcluded=new Set(['.git','.ci','.github','__pycache__','tests','tests-unit',
  'node_modules','build','dist'])
const imageMutableRoots=new Set(['input','output','temp','user','custom_nodes'].map(name=>
  `integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/${name}`))
export const nativeVisionFiles=Object.freeze([
  'models/vision/qwen2.5-vl-3b-instruct/manifest.json',
  'models/vision/qwen2.5-vl-3b-instruct/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',
  'models/vision/qwen2.5-vl-3b-instruct/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',
  'engine/vision/build/upstream-smoke/bin/llama-mtmd-cli.exe',
])
export const nativeSkillReferenceFiles=Object.freeze([
  'skills/bundled/avoid-ai-writing-3.38.0.zip',
  'nori/local_skill_installer.py',
  'skills/nori-linux-graphics-investigator/skill.json',
  'skills/nori-rea/skill.json',
  'skills/incoming/vercel-agent-skills/skills/writing-guidelines/SKILL.md',
  'skills/incoming/vercel-agent-skills/skills/web-design-guidelines/SKILL.md',
  'skills/incoming/vercel-agent-skills/skills/vercel-optimize/SKILL.md',
  'skills/incoming/vercel-agent-skills/skills/vercel-cli-with-tokens/SKILL.md',
  'skills/incoming/vercel-agent-skills/skills/react-view-transitions/SKILL.md',
  'skills/incoming/vercel-agent-skills/skills/react-native-skills/SKILL.md',
  'skills/incoming/vercel-agent-skills/skills/deploy-to-vercel/SKILL.md',
  'skills/incoming/vercel-agent-skills/skills/composition-patterns/SKILL.md',
  'skills/incoming/vercel-agent-skills/skills/react-best-practices/SKILL.md',
  'skills/incoming/vercel-agent-skills/skills/react-best-practices/rules/async-parallel.md',
  'skills/incoming/vercel-agent-skills/skills/react-best-practices/rules/rerender-functional-setstate.md'
])
export const nativeDesktopModuleFiles=Object.freeze([
  ...['nori-v2-query.mjs','stream-context.mjs','stream-dj.mjs','local-image.mjs','ladybug.mjs','conversation-prose.mjs','local-video.mjs','cinematic-video-profile.mjs','video-model-lease.mjs','generated-video-file.mjs','neuralese-video-intent.mjs','video-intent.mjs',
    'video-duration.mjs','local-video-assembly.mjs','local-video-assembly.py','local-vision.mjs','image-intent.mjs','local-location.mjs',
    'local-chat.mjs','aider-tools.mjs','self-code-workspace.mjs','file-claim-output-guard.mjs','vehicle-illustration.mjs','neuralese-attachment.mjs','neuralese-artcraft-plan.mjs','neuralese-artcraft-slot-repair.mjs',
    'screen-perception-contract.mjs','native-screen-text.mjs','screen-text-process.mjs',
    'response-profiles.mjs','nori-identity.mjs','nori-ui-commands.mjs','nori-school.mjs','nori-learning.mjs','rea-tools.mjs',
    'local-policy.mjs','native-runtime.mjs','son-status-output-guard.mjs','identity-output-guard.mjs','context-budget.mjs','installation-paths.mjs','neuralese-app-tools.mjs','local-app-store.mjs','artcraft-tools.mjs','artcraft-mcp-tools.mjs',
    'instruction-skills.mjs','managed-instruction-skills.mjs','skill-installer-tools.mjs','neuralese-image-intent.mjs','neuralese-intent.mjs','neuralese-app-spec.mjs','neuralese-project-tools.mjs','neuralese-speech.mjs','project-tools.mjs','neural-event-contract.mjs','native-memory-observation.mjs',
    'work-neural-observations.mjs','neural-origin.mjs','artcraft-mcp-launch.mjs',
    'computer-agent.mjs','computer-host-client.mjs','computer-control-session.mjs',
    'windows-computer-executor.mjs','windows-computer-control.ps1',
    'personal-name.mjs','skill-catalog-status.mjs','skill-authoring-tools.mjs','semantic-memory.mjs','automatic-vision.mjs',
    'imported-chat-selection.mjs','host-capability-registry.mjs'].map(name=>`apps/desktop/bridge/${name}`),
  ...['native-service.cjs','gpt-oss-service.cjs','nori-local-agent-provider.cjs',
    'model-hardware-selection.cjs','portable-model-selection.cjs','workspace-app-drafts.cjs','skill-installer.cjs',
    'video-model-lease.cjs','video-capable-model.cjs','video-runtime-cleanup.cjs',
    'automatic-text-service.cjs','imported-model-profile.cjs','task-model-router.cjs','vision-payload.cjs']
    .map(name=>`apps/desktop/desktop/${name}`)
])
export function nativePayloadPlan(sourceRoot, {maxBytes = 128 * 1024 ** 3,portableCatalog} = {}) {
  const root = realpathSync(sourceRoot)
  const files = new Map()
  function add(name, sourceOnly = false, excludedEntries = excluded) {
    if (typeof name !== 'string' || !name || isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw new Error('Unsafe native payload path')
    // This development config binds a verification-only database; never install it.
    if(name.replaceAll('\\','/')==='runtime/norllama/resource-coordination.experimental.json')return
    if(sourceOnly&&name.replaceAll('\\','/')==='nori/knights/architect')return
    const target = resolve(root, name)
    const info = lstatSync(target)
    const actual = realpathSync(target)
    const delta = relative(root, actual)
    const normalized=value=>process.platform==='win32'?value.toLowerCase():value
    if (info.isSymbolicLink() || delta.startsWith('..') || isAbsolute(delta) ||
      normalized(actual)!==normalized(target)) throw new Error('Native payload link or root escape')
    if (info.isDirectory()) {
      for (const entry of readdirSync(target).sort()) {
        if (excludedEntries.has(entry) || entry.endsWith('.pyc') || entry.endsWith('.pyo')) continue
        // Only ComfyUI's writable user folders are excluded. Python modules
        // such as comfy_api/input and nested output packages are runtime code.
        if (excludedEntries===imageGenerationExcluded&&imageMutableRoots.has(join(name,entry).replaceAll('\\','/'))) continue
        // Native components use the explicit bundled interpreter and runtime
        // package roots. A developer venv is neither source nor a complete
        // distributable when this walk copies only Python files.
        if (sourceOnly && /^\.venv(?:$|[-_.])/.test(entry)) continue
        add(join(name, entry), sourceOnly, excludedEntries)
      }
    } else if (info.isFile()) {
      if (sourceOnly && !name.endsWith('.py')) return
      if (info.size === 0 && (name.endsWith('.exe') || name.endsWith('.gguf') || name.endsWith('.onnx'))) throw new Error(`Empty native payload binary: ${name}`)
      const path = relative(root, target).replaceAll('\\','/')
      files.set(path, {path, bytes:info.size})
    } else throw new Error('Unsupported native payload entry')
  }
  const config = JSON.parse(readFileSync(join(root,'runtime/norllama/config.json'),'utf8'))
  if(config.status==='UNAVAILABLE')throw Object.assign(
    new Error('No qualified Nori SoN serving checkpoint is selected; suite packaging cannot claim a functioning brain.'),
    {code:'NORI_MODEL_UNAVAILABLE'})
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid suite size limit')
  if (config.engine_binary !== 'engine/norama/norama-worker.exe') throw new Error('Unqualified native engine configuration')
  if (typeof config.model_path!=='string'||!/^models\/language\/[A-Za-z0-9._/-]+\.gguf$/.test(config.model_path)||
      config.model_path.split('/').some(part=>!part||part==='.'||part==='..'))
    throw new Error('Language model must be a safe in-root GGUF path')
  for (const path of ['runtime/norllama','runtime/input','runtime/stt','runtime/voice',
    'python/Python311','models/voice/kokoro-v1','models/voice/whisper-base.en',
    config.engine_binary,'engine/norama/norama-tokenizer.exe',config.model_path]) add(path)
  // Ship the optional GPT-OSS 20B chat brain with its exact llama.cpp runtime
  // and provenance, while retaining the separately identified 3B bridge
  // profile. Both models are local; the GUI selects GPT-OSS by default.
  const gptOssProvenancePath='models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/MODEL_PROVENANCE.json'
  const gptOssProvenance=JSON.parse(readFileSync(join(root,gptOssProvenancePath),'utf8'))
  if(gptOssProvenance.schema!=='nori.third-party-model-provenance.v1'||
    gptOssProvenance.model_id!=='gpt-oss-20b'||
    gptOssProvenance.repository!=='ggml-org/gpt-oss-20b-GGUF'||
    gptOssProvenance.revision!=='a7443ebb00ba299cbbbf7e9b69487670447ae8c0'||
    gptOssProvenance.license!=='Apache-2.0'||
    gptOssProvenance.weights_trained_by_nori!==false)
    throw new Error('GPT-OSS provenance or license metadata is incomplete')
  for(const path of nativeGptOssFiles)add(path)
  // Llama bridge distributions must carry the model's license and use policy;
  // bind each notice to the model provenance instead of copying unchecked files.
  if (config.model_id === 'llama3.2-3b-instruct') {
    const modelDirectory = dirname(config.model_path)
    const provenancePath = join(modelDirectory, 'MODEL_PROVENANCE.json')
    const provenance = JSON.parse(readFileSync(join(root, provenancePath), 'utf8'))
    if (provenance.sha256 !== config.provenance?.sha256 || config.provenance?.nori_trained !== false ||
        provenance.ownership !== 'Imported third-party model, not trained Nori weights' ||
        !Array.isArray(provenance.license_files) || provenance.license_files.length !== 2) {
      throw new Error('Llama bridge provenance or license manifest is incomplete')
    }
    add(provenancePath)
    for (const notice of provenance.license_files) {
      if (!notice || typeof notice.path !== 'string' || basename(notice.path) !== notice.path ||
          !/^[A-Za-z0-9._-]+$/.test(notice.path) || !/^[a-f0-9]{64}$/.test(notice.sha256 ?? '')) {
        throw new Error('Unsafe Llama bridge license manifest entry')
      }
      const noticePath = join(modelDirectory, notice.path)
      const content = readFileSync(join(root, noticePath))
      const actualHash = createHash('sha256').update(content).digest('hex')
      if (actualHash !== notice.sha256) throw new Error(`Llama bridge license hash mismatch: ${notice.path}`)
      add(noticePath)
    }
  }
  // OCR is an explicitly selected text-only backend, with its owned worker
  // inside the suite rather than a dependency on the development checkout.
  add('runtime/vision/windows-ocr.ps1')
  // User-supplied images are understood by a pinned, local Qwen VLM worker.
  // Include the manifest, model, projector, and executable as one payload;
  // no server endpoint, download, or model fallback is required at runtime.
  for (const path of nativeVisionFiles) add(path)
  const visionManifest=JSON.parse(readFileSync(join(root,nativeVisionFiles[0]),'utf8'))
  if(visionManifest.modelId!=='Qwen2.5-VL-3B-Instruct'||visionManifest.license!=='Apache-2.0'||
    visionManifest.requiredWorker!=='nori-vision-worker'||
    visionManifest.workerFilename!=='llama-mtmd-cli.exe'||
    visionManifest.workerSha256!=='24348241140a16750888351bf5dd6a1e0d3b9ee19d18fcdc428b68188f6b7535'||
    visionManifest.languageModelFilename!=='Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf'||
    visionManifest.projectorFilename!=='mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf'||
    !Number.isSafeInteger(visionManifest.languageModelBytes)||!Number.isSafeInteger(visionManifest.projectorBytes)||
    visionManifest.requiredEngine!=='llama.cpp b11396 (2e7c58c5477478c8cf6e199cfaa5dcd5a4319c81)')
    throw new Error('Local vision model manifest is incomplete or not the pinned Nori artifact')
  if(lstatSync(join(root,nativeVisionFiles[1])).size!==visionManifest.languageModelBytes||
    lstatSync(join(root,nativeVisionFiles[2])).size!==visionManifest.projectorBytes)
    throw new Error('Local vision model or projector size differs from its pinned manifest')
  for(const path of nativeResourceFiles)add(path)
  for(const path of nativeWakeFiles)add(path)
  // Ship Aider's Python 3.11 dependency closure with Nori's own interpreter.
  // Do not ship Scripts/, pyvenv.cfg, chat history, or a developer launcher.
  for(const path of nativeAiderFiles)add(path)
  const aiderMetadata=readFileSync(join(root,nativeAiderFiles[5]),'utf8')
  if(!/^Name: aider-chat\r?$/m.test(aiderMetadata)||!/^Version: 0\.86\.2\r?$/m.test(aiderMetadata))
    throw new Error('The bundled Aider dependency version is not the tested 0.86.2 release')
  add('integrations/aider/.venv/Lib/site-packages')
  add('integrations/aider/git')
  // Include reviewed reference cards and the instruction-only installer bundle.
  // Imported scripts remain inert and receive no executable capability.
  for(const path of nativeSkillReferenceFiles)add(path)
  // Ship each pinned portable ArtCraft release with the native desktop. Keep
  // user projects out of the immutable suite; the MCP bridge stores them in
  // NORI_APP_DATA_ROOT/integrations/artcraft/workspaces instead.
  const artcraftManifestPath='integrations/artcraft/artcraft-apps.json'
  const artcraftManifest=JSON.parse(readFileSync(join(root,artcraftManifestPath),'utf8'))
  const artcraftApps=artcraftManifest?.applications
  if(artcraftManifest?.schema!=='nori.integration.artcraft-apps.v1'||!Array.isArray(artcraftApps)||
    artcraftApps.length!==nativeArtCraftAppIds.length||
    new Set(artcraftApps.map(app=>app?.id)).size!==nativeArtCraftAppIds.length||
    nativeArtCraftAppIds.some(id=>!artcraftApps.some(app=>app?.id===id)))
    throw new Error('Native ArtCraft payload must contain the complete, unique installed app inventory')
  add(artcraftManifestPath)
  for(const id of nativeArtCraftAppIds){
    const app=artcraftApps.find(entry=>entry.id===id)
    const desktop=String(app.desktop_exe||'').replaceAll('\\','/')
    const cli=String(app.cli_exe||'').replaceAll('\\','/')
    const prefix=`apps/${id}/`
    if(!desktop.startsWith(prefix)||!desktop.endsWith(`/${id}.exe`)||
      !cli.startsWith(prefix)||!cli.endsWith(`/${id}-cli.exe`)||
      dirname(desktop)!==dirname(cli))
      throw new Error(`Native ArtCraft app paths are not a matched portable release for ${id}`)
    add(join('integrations/artcraft',dirname(desktop)))
  }
  // Nori's local image workflow invokes this exact portable ComfyUI runtime.
  // Package its runtime and model weights, but never copy its user workspace
  // (input/output/user), temporary files, custom nodes, tests, or Git history.
  for(const path of nativeImageGenerationFiles){
    add(path)
    if(lstatSync(join(root,path)).size===0)throw new Error(`Required local image-generation component is empty: ${path}`)
  }
  add('integrations/image-generation/runtime/ComfyUI_windows_portable',false,imageGenerationExcluded)
  add('nori', true)
  for (const name of ['index.html','mobile.css','mobile-client.mjs','mobile-ui.mjs']) add(`nori/mobile_ui/${name}`)
  // Native role packages contain prompts/manifests as well as Python modules.
  // Keep those resources without importing a historical CrewAI development tree.
  add('nori/packages/knights')
  for (const path of ['nori/config.native-suite.json','nori/security/hard_floor.yaml',
    'nori/shared/orchestration/knights.json','nori/prompts/covenant.md','nori/prompts/autonomy.md']) add(path)
  // This companion tree is needed by the isolated speech/input launchers even
  // when Electron keeps the desktop JS bundle in its own ASAR archive.
  for (const name of ['system_hand_input.py','whisper_stt.py','kokoro_tts.py']) add(`apps/desktop/bridge/${name}`)
  // Phone pairing and the receiver are suite components, not dependencies on
  // a developer checkout or a separately installed system Node executable.
  for (const name of ['start.mjs','receiver.mjs','latest-location.mjs',
    'launch-private.ps1','control-location.ps1','pair-phone.ps1',
    'private-state-path.ps1','runtime-path.ps1','probe-native.mjs']) add(`integrations/location/${name}`)
  // Ship the read-only phone dashboard's complete local module closure.
  // Tests, old logs and private monitor state are deliberately not copied.
  for (const name of ['index.html','server.mjs','status.mjs','expanded-roadmap.mjs']) add(`integrations/project-monitor/${name}`)
  // Product roadmap metadata travels with the candidate and is hash-bound
  // like executable content. The monitor publishes only validated counts.
  add('ROADMAP_TRACKING.json')
  add('docs/nori-expanded-owner-roadmap.json')
  // The integration probe exercises the same query adapter as the desktop.
  // Include its local module closure, not unrelated cloud SDK/tool servers.
  for(const path of nativeDesktopModuleFiles)add(path)
  if(portableCatalog){
    for(const path of portableModelPayload(root,portableCatalog).files)add(path)
  }
  const entries = [...files.values()].sort((a,b)=>a.path.localeCompare(b.path))
  const bytes = entries.reduce((sum,file)=>sum+file.bytes,0)
  if (bytes >= maxBytes) throw new Error('Native payload exceeds suite size limit')
  return {schema:1,files:entries,bytes,modelId:config.model_id,
    modelPath:config.model_path,
    ...(portableCatalog ? {portableCatalog} : {}),releaseVerified:false}
}
