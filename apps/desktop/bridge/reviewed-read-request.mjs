/** Admit only an explicit single-file read, never a compound action request. */
export function reviewedReadRequest(text) {
  if (typeof text !== 'string' || text.length > 400 || /[\r\n]/.test(text)) return null
  const match = /^(?:please\s+)?read\s+(?:the\s+)?(?:file\s+)?(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))\s*$/i.exec(text.trim())
  if (!match) return null
  const path = match[1] ?? match[2] ?? match[3]
  if (!path || path.length > 240 || /[:\x00]/.test(path) || /^[\\/]/.test(path)
      || path.split(/[\\/]/).some(part => !part || part === '..' || part === '.')
      || !/\.[a-z0-9]{1,12}$/i.test(path)) return null
  return { task: text.trim(), expected_path: path }
}
