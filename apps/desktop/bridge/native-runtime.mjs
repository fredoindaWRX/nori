import { localEndpoint, localFetch } from './local-policy.mjs'
import { correctUnsupportedSonStatusClaim, needsSonStatusFactCheck } from './son-status-output-guard.mjs'
import { correctUnsupportedFileClaim } from './file-claim-output-guard.mjs'
import { groundedIdentityAnswer } from './identity-output-guard.mjs'

async function boundedRuntimeError(response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks = []
  let size = 0
  try {
    while (size < 2048) {
      const { value, done } = await reader.read()
      if (done) break
      const part = value.subarray(0, 2048 - size)
      chunks.push(part)
      size += part.byteLength
      if (part.byteLength !== value.byteLength) break
    }
  } catch {
    return ''
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  try {
    const body = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))
    if (typeof body?.message !== 'string' || body.message.length > 1024) return ''
    return body.message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240)
  } catch {
    return ''
  }
}

function waitForRuntimeRetry(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(finish, 350)
    function finish() {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal.reason || new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function nativeRuntimeHealth({ endpoint, apiKey, modelId, signal } = {}) {
  if (!apiKey || !modelId) return { ready: false, state: 'not_configured', backend: 'norama-independent' }
  try {
    const base = localEndpoint('NORI_RUNTIME_URL', endpoint, 'http://127.0.0.1:11435')
    const response = await localFetch(`${base}/health`, { headers: { Authorization: `Bearer ${apiKey}` },
      signal: signal || AbortSignal.timeout(1000) })
    const body = await response.json()
    if (!response.ok || body.ready !== true || body.backend !== 'norama-independent' || body.model_id !== modelId) {
      return { ready: false, state: 'unavailable', backend: 'norama-independent' }
    }
    // Explicit public allowlist. Never forward arbitrary fields or any key.
    return { ready: true, state: 'ready', backend: body.backend, modelId,
      importedWeights: body.imported_weights === true, noriTrainedModel: body.nori_trained_model === true }
  } catch { return { ready: false, state: 'unavailable', backend: 'norama-independent' } }
}

export async function* nativeRuntimeChat({ endpoint, apiKey, modelId, messages, maxTokens = 240, signal, requireNaturalStop = false }) {
  if (typeof requireNaturalStop !== 'boolean') throw new TypeError('requireNaturalStop must be boolean')
  const base = localEndpoint('NORI_RUNTIME_URL', endpoint, 'http://127.0.0.1:11435')
  if (!apiKey || !modelId) throw new Error('Nori native runtime credentials and model must be configured')
  const request = {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model_id: modelId, messages, max_tokens: maxTokens, stream: true }),
  }
  let response = await localFetch(`${base}/v1/chat`, request)
  if (!response.ok) {
    const detail = await boundedRuntimeError(response)
    // A bounded retry is appropriate only for the runtime's explicit busy
    // response. Protocol/worker errors are not retried or hidden as success.
    if (response.status === 503 && /native request queue (?:is full|deadline exceeded)/i.test(detail)) {
      await waitForRuntimeRetry(signal)
      response = await localFetch(`${base}/v1/chat`, request)
      if (!response.ok) {
        const retryDetail = await boundedRuntimeError(response)
        throw new Error(`Nori native runtime request failed (${response.status})${retryDetail ? `: ${retryDetail}` : ''}`)
      }
    } else {
      throw new Error(`Nori native runtime request failed (${response.status})${detail ? `: ${detail}` : ''}`)
    }
  }
  if (!response.body) throw new Error('Nori native runtime response stream is unavailable')
  const requestHeader = response.headers.get('x-nori-request-id')
  const requestId = requestHeader && /^[1-9][0-9]{0,9}$/.test(requestHeader) ? Number(requestHeader) : null
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const checkSonStatus = needsSonStatusFactCheck(messages)
  const identityAnswer = groundedIdentityAnswer(messages)
  const holdForFactCheck = checkSonStatus || identityAnswer !== null
  const heldStatusTokens = []
  let buffer = ''
  let complete = false
  let emittedContent = false
  let finishReason = null
  try {
    while (!complete) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      if (buffer.length > 1024 * 1024) throw new Error('Nori native stream record is too large')
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const lines = event.split('\n')
        const kinds = lines.filter(line => line.startsWith('event:'))
        if (kinds.length > 1) throw new Error('Ambiguous native runtime stream event')
        const kind = kinds[0]?.slice(6).trim()
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (kind === 'done' || data === '[DONE]') {
          if (kind !== 'done' || data !== '[DONE]') throw new Error('Invalid native runtime completion event')
          complete = true
          break
        }
        if (kind === 'token') {
          const token = JSON.parse(data)
          if (typeof token.text !== 'string') throw new Error('Invalid native runtime token')
          if (holdForFactCheck) heldStatusTokens.push(token.text)
          else {
            if (token.text.trim()) emittedContent = true
            yield token.text
          }
        } else if (kind === 'error') {
          const failure = JSON.parse(data)
          if (typeof failure.message !== 'string' || failure.message.length > 1024) throw new Error('Invalid native runtime error')
          throw new Error(`Nori native runtime: ${failure.message}`)
        } else if (kind === 'metrics' && requireNaturalStop) {
          const metrics = JSON.parse(data)
          if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) throw new Error('Invalid native terminal metrics')
          if (Object.hasOwn(metrics, 'finish_reason')) {
            if (finishReason !== null || !['stop', 'length'].includes(metrics.finish_reason)) throw new Error('Invalid native finish reason')
            finishReason = metrics.finish_reason
          }
        } else if (kind !== 'metrics' && data) {
          throw new Error('Unsupported native runtime stream contract')
        }
      }
      if (done && !complete) throw new Error('Nori native runtime stream ended before completion')
    }
    if (requireNaturalStop && finishReason !== 'stop') {
      throw new Error('Native coding proposal did not finish normally; no task may be submitted.')
    }
    if (holdForFactCheck) {
      const responseText = heldStatusTokens.join('')
      const finalText = identityAnswer ?? correctUnsupportedSonStatusClaim(messages, responseText)
        ?? correctUnsupportedFileClaim(messages, responseText) ?? responseText
      if (!finalText.trim()) throw new Error('Nori native runtime completed without response text')
      yield finalText
    } else if (!emittedContent) {
      throw new Error('Nori native runtime completed without response text')
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
    // A disconnected browser reader alone need not stop GPU generation.
    // Cancel only this server-issued request, using an independent bounded signal.
    if (!complete && requestId !== null && requestId <= 0xffffffff) {
      await localFetch(`${base}/v1/cancel`, {
        method: 'POST', signal: AbortSignal.timeout(3000),
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ request_id: requestId }),
      }).then(result => result.body?.cancel()).catch(() => {})
    }
  }
}
