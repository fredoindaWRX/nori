// UI metadata only. Never starts a runtime, installs weights, or enables tools.
function nativeModelStatus(stack, { runtimeMode = 'norllama', gptOssService = null } = {}) {
  if (runtimeMode === 'gpt-oss') {
    const child = gptOssService?.child
    const modelId = gptOssService?.status?.modelId || gptOssService?.modelId || 'gpt-oss-20b'
    const online = Boolean(child && child.exitCode === null && child.signalCode == null)
    if (modelId === 'nori-auto') {
      const routing = gptOssService?.routingStatus
      const ready = routing?.state === 'ready'
      return {installed:false,online:ready,model:modelId,modelId,loadedModel:routing?.modelId || null,
        runtime:'Nori · automatic local models',identity:'Nori-owned routing over imported local models',
        trainedByNori:false,sonCheckpoint:false,toolsQualified:false,executionAuthorized:false,
        contextTokens:65536,automaticRouting:true,
        error:ready?'Local inference is ready; tool permissions are checked separately.':'Local model routing is not ready.'}
    }
    if (modelId === 'qwen3.8-27b' || modelId === 'qwen3.5-9b') return {
      installed: false, online, model: modelId, modelId, loadedModel: modelId,
      runtime: `llama.cpp · imported ${modelId === 'qwen3.5-9b' ? 'Qwen3.5 9B' : 'Qwen3.8 27B'}`,
      identity: 'Imported inference model · not Nori-trained',
      localAgentProvider: gptOssService?.localAgentProvider || null,
      trainedByNori: false, sonCheckpoint: false, toolsQualified: false,
      error: online ? `${modelId} is available locally; tool permissions are checked separately.`
        : `Imported ${modelId} service is not running.`,
    }
    return { installed: false, online, model: modelId, modelId, runtime: 'llama.cpp · imported GPT-OSS',
      loadedModel: modelId, identity: 'Imported inference model · not Nori-trained · not a SoN checkpoint',
      localAgentProvider: gptOssService?.localAgentProvider || null,
      trainedByNori: false, sonCheckpoint: false, toolsQualified: false,
      error: online ? 'GPT-OSS is available for local inference only; Nori SoN is not active.'
        : 'Imported GPT-OSS service is not running; Nori SoN is not active.' }
  }
  const runtimeChild=stack?.runtime?.child,coreChild=stack?.core?.child
  return {installed:false,
    online:Boolean(runtimeChild && coreChild && runtimeChild.exitCode===null && coreChild.exitCode===null &&
      runtimeChild.signalCode==null && coreChild.signalCode==null),
    model:stack?.status?.modelId,runtime:'NorLlama',loadedModel:stack?.status?.modelId,
    error:'SoN model activation is pending.'}
}
module.exports={nativeModelStatus}
