// Bind the existing desktop page policy to its owned loopback bridge. Never
// allow a wildcard port or take an endpoint from renderer/page data.
function speechPagePolicy(html, bridgeOrigin) {
  const endpoint = new URL(bridgeOrigin)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      endpoint.username || endpoint.password || endpoint.pathname !== '/' ||
      endpoint.search || endpoint.hash || bridgeOrigin !== endpoint.origin) {
    throw Error('Speech page policy requires the exact owned loopback origin')
  }
  let policyFound = false
  const output = html.replace(
    /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]+)("\s*\/?>)/i,
    (_match, before, policy, after) => {
      let replaced = 0
      const bound = policy.replace(/http:\/\/(?:localhost|127\.0\.0\.1):8787(?=[\s;])/g, () => {
        replaced++
        return endpoint.origin
      })
      if (!replaced || !bound.includes('connect-src ')) throw Error('Desktop speech policy template is missing')
      policyFound = true
      return before + bound + after
    },
  )
  if (!policyFound) throw Error('Desktop page policy is missing')
  return output
}
module.exports = { speechPagePolicy }
