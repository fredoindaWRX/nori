// An explicitly unavailable model may leave the desktop open for UI work.
// All other startup failures stay fatal; no replacement runtime is started.
const { startNativeStack } = require('./native-stack.cjs')

async function startNativeDesktop(options, { allowUnavailable = false, start = startNativeStack } = {}) {
  if (typeof allowUnavailable !== 'boolean') throw new TypeError('Explicit unavailable-model policy required')
  try { return await start(options) }
  catch (error) {
    if (!allowUnavailable || error?.code !== 'NORI_MODEL_UNAVAILABLE') throw error
    return null
  }
}

function clearUnavailableRuntimeCredentials(environment) {
  for (const name of ['NORI_RUNTIME_API_KEY', 'NORI_RUNTIME_MODEL_ID', 'NORI_RUNTIME_URL', 'NORI_API_TOKEN',
    'NORI_RUNTIME_MAX_PROMPT_TOKENS', 'NORI_COUNCIL_URL', 'NORI_NATIVE_CORE_READY', 'NORI_NATIVE_TOOLS_QUALIFIED']) {
    delete environment[name]
  }
  environment.NORI_ALLOW_WRITES = '0'
}

function nativeCoreEndpoint(nativeStack, unavailableFallback) {
  if (!nativeStack) return unavailableFallback
  const value = nativeStack.environment?.NORI_COUNCIL_URL
  let endpoint
  try { endpoint = new URL(value) } catch { throw new Error('Owned native Core endpoint is missing or invalid') }
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !Number.isInteger(Number(endpoint.port)) || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535) {
    throw new Error('Owned native Core endpoint must be an HTTP loopback service with a valid port')
  }
  return endpoint.href.replace(/\/+$/, '')
}

module.exports = { startNativeDesktop, clearUnavailableRuntimeCredentials, nativeCoreEndpoint }
