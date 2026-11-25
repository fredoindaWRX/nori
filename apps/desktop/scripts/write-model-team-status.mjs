import {readFileSync,writeFileSync} from 'node:fs'
const root='C:/Nori',reportRoot=root+'/.work/reports/'
const load=name=>JSON.parse(readFileSync(reportRoot+name,'utf8').replace(/^\uFEFF/,''))
const path=root+'/docs/nori-model-team-2026-10-29.json'
const proposal=JSON.parse(readFileSync(path,'utf8'))
const plan=JSON.parse(readFileSync(root+'/.work/model-team-integration/update-plan.json','utf8'))
proposal.status='three_models_downloaded_and_real_engine_tested_same_app_activation_pending'
proposal.validation={
 everyday:load('model-team-everyday-probe.json'),
 memoryEmbeddings:load('model-team-embedding-probe.json'),
 speechRecognition:load('parakeet-worker-probe.json'),
 voiceOutput:load('kokoro-model-team-probe.json'),
 imageUnderstanding:load('vision-model-team-probe.json'),
 mediaServiceCpuReadiness:load('comfy-model-team-probe.json'),
 imageGenerationAndChatRestoration:load('image-model-team-live.json'),
 videoGenerationAndChatRestoration:load('video-model-team-live-r2.json'),
 referenceGuidedReadiness:load('cinematic-reference-readiness.json'),
 capacityRecoveryWithRealInference:load('model-capacity-recovery-live.json'),
 packagedSpeechWorker:load('packaged-stt-live.json'),
 installerShellPreflight:{passed:2,failed:0,installed:false,log:reportRoot+'model-team-preflight-shells-r7.log'},
 bridgeAutomaticRouting:{passed:1,failed:0,liveInference:false,scope:'actual bridge and router with controlled model responses; original request selects backend, background text does not',log:reportRoot+'staged-chat-regressions-routing-r2.log'},
 chatBridgeRegressions:{passed:58,failed:0,scope:'synthetic loopback and isolated state with explicit code corrections; included in final packaged suite',log:reportRoot+'staged-chat-regressions-r5.log'},
 packagedModules:{passed:plan.testsPassed,failed:0,log:root+'/.work/model-team-integration/package-tests.log'},
 aiderWorkerOverlay:{passed:22,failed:0,skipped:1,liveModelTested:false,log:reportRoot+'automatic-model-aider-contracts.log'},
 automaticEndpoint:load('automatic-text-live-probe-r4.json'),
 fullContextCurrentProfile:load('near-full-64k-profile-probe.json'),
 previousCpuCacheTimeout:load('near-full-64k-context-probe.json'),
 shortPromptGpuRouting:load('task-model-router-gpu-probe.json'),
 structuredToolParser:load('qwen35-native-tools-probe.json'),
 finalAnswerBudget:load('qwen-final-answer-budget-probe.json'),
 existingLargeModel:load('large-model-memory-probe.json'),
}
proposal.activation={installed:false,canonicalApp:'C:/Program Files/Nori/Nori.exe',
 updatePlan:root+'/.work/model-team-integration/update-plan.json',files:plan.updates.length,
 secondNoriInstallationCreated:false,weightsCopiedIntoStage:false,
 everydayDefaultAfterUpdate:'qwen3.5-9b',contextTokensAfterUpdate:65536,
 automaticLargeModelEscalationImplemented:true,automaticLargeModelEscalationInstalledAppVerified:false,full64KPromptCapacityQualified:proposal.validation.fullContextCurrentProfile.passed,installedAppFullContextVerified:false,
 normalDesktopModelPickerRemoved:true,
 awaiting:'Normal Nori quit, Windows UAC approval, and installed-app live acceptance'}
proposal.remainingChecks=[
 'Activate the same-app update and verify GPU-backed text and tool execution.',
 'Verify the installed semantic memory route and Parakeet bridge connection.',
 'Verify the GPU Q8 cache configuration in the installed desktop; the current source profile passed a 64,012-prompt-token request through the installed Core provider in 18.316 seconds.',
 'Verify installed-desktop media generation; isolated real providers generated a 768x1280 image and a five-second 832x480 video, restoring chat after each. The video has three shots, no audio, changing car identity and geometric defects; reference-quality consistency is not qualified.',
 'Verify automatic model escalation and GPU video handoff in the installed desktop app.',
 'Verify effective long-context chat utilization with the active model tokenizer; direct provider allocation passed near-full 64K, while the bridge can fall back to conservative byte counting.',
 'Investigate degraded large-model latency under concurrent GPU load before claiming consistent speed.',
 'Evaluate optional Qwen TTS and heavier media models only after the baseline works.'
]
writeFileSync(path,JSON.stringify(proposal,null,2))
console.log(JSON.stringify({status:proposal.status,installed:false,packagedTestsPassed:plan.testsPassed}))
