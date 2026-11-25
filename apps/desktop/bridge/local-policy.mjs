/** Inference endpoints are local-only; web browsing/maps are a separate capability. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function localEndpoint(name, value, fallback) {
  let url
  try { url = new URL(value?.trim() || fallback) } catch {
    throw new Error(`${name}: invalid local endpoint`)
  }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error(`${name}: free/local mode requires an HTTP loopback endpoint`)
  }
  return url.href.replace(/\/+$/, '')
}

export function localBrain(value) {
  const brain = value?.trim() || 'nori-v2'
  if (brain !== 'nori-v2') throw new Error('NORI_BRAIN: cloud/paid brains are disabled in free/local mode')
  return brain
}

export async function localFetch(target, options = {}) {
  const url = new URL(target)
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password) {
    throw new Error('Inference request refused: endpoint is not local')
  }
  return fetch(url, { ...options, redirect: 'error' })
}
