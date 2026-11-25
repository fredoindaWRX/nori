const { realpathSync, statSync } = require('node:fs')
const { join, relative, isAbsolute, sep } = require('node:path')

function localPage(requestUrl, root, origin) {
  const fallback = join(root, 'index.html')
  try {
    const pathname = decodeURIComponent(new URL(requestUrl, origin).pathname)
    const candidate = realpathSync(join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')))
    const inside = relative(realpathSync(root), candidate)
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return fallback
    return statSync(candidate).isFile() ? candidate : fallback
  } catch {
    // Invalid escaping, absent assets and inaccessible paths become an SPA
    // fallback, not an exception escaping the HTTP request handler.
    return fallback
  }
}
module.exports = { localPage }
