// Bind both consumers to the owned model. This does not grant write approval.
const { isAbsolute } = require('node:path')

function workerEnvironment(environment, runtime) {
  if (environment.NORI_AIDER_BACKGROUND !== '1') return {}
  const workspace = environment.NORI_AIDER_WORKSPACE_ROOT?.trim()
  if (!workspace || !isAbsolute(workspace)) throw new Error('Background coding needs an explicit absolute workspace')
  const owned = runtime?.environment
  const native = owned?.NORI_INFERENCE_RUNTIME === 'norllama'
  if (!native && owned?.NORI_INFERENCE_RUNTIME !== 'gpt-oss') throw new Error('Background coding requires an owned local service')
  const endpoint = new URL(native ? owned.NORI_RUNTIME_URL : owned.NORI_GPT_OSS_URL)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port ||
      endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('Background coding requires an owned loopback endpoint')
  }
  const model = native ? owned.NORI_RUNTIME_MODEL_ID : owned.NORI_GPT_OSS_SERVER_MODEL
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(model) || runtime.status?.modelId !== model) {
    throw new Error('Background coding model identity does not match the owned runtime')
  }
  if (native && (runtime.status?.architecture !== 'imported-qwen35' ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(owned.NORI_RUNTIME_API_KEY || ''))) {
    throw new Error('Background coding requires the owned native Qwen identity and private credential')
  }
  return { NORI_AIDER_BACKGROUND: '1', NORI_AIDER_WORKSPACE_ROOT: workspace,
    NORI_AIDER_API_BASE: `${endpoint.origin}${native ? '/openai/v1' : '/v1'}`,
    NORI_AIDER_MODEL: `openai/${model}`,
    ...(native ? { NORI_AIDER_API_KEY: owned.NORI_RUNTIME_API_KEY } : {}) }
}

module.exports = { workerEnvironment }
