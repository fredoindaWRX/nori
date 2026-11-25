const UNAVAILABLE = Object.freeze({ available: false, url: null })
const TAILNET_DNS = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/i

function remoteAccessStatus(event, { owns, serviceActive, origin } = {}) {
  if (typeof owns !== 'function' || !owns(event)) return null
  if (serviceActive !== true || typeof origin !== 'string') return UNAVAILABLE
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.port !== '8444' || url.pathname !== '/' ||
        url.search || url.hash || url.username || url.password || !TAILNET_DNS.test(url.hostname)) return UNAVAILABLE
    return { available: true, url: url.origin }
  } catch { return UNAVAILABLE }
}

module.exports = { remoteAccessStatus }
