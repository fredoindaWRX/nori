/** Explicit background research only; ordinary questions retain foreground routing. */
export function nativeResearchRequest(text, { background = false } = {}) {
  if (typeof text !== 'string' || text.length > 800 || /[\r\n]/.test(text)) return null
  let value = text.trim(), retain = false, explicitBackground = false
  const stripBackground = () => {
    if (/\s+in\s+the\s+background[.!]?$/i.test(value)) {
      explicitBackground = true
      value = value.replace(/\s+in\s+the\s+background[.!]?$/i, '').trim()
    }
  }
  stripBackground()
  if (/\s+and\s+remember\s+(?:what\s+you\s+find|it|the\s+results)[.!]?$/i.test(value)) {
    retain = true
    value = value.replace(/\s+and\s+remember\s+(?:what\s+you\s+find|it|the\s+results)[.!]?$/i, '').trim()
  }
  stripBackground()
  const match = /^(\*research|\*work\s+research|(?:please\s+)?research)\s+(.+)$/i.exec(value)
  if (!match || !(match[1].startsWith('*') || background || explicitBackground)) return null
  let question = match[2].trim(), maxPages = 3
  const pageBound = /\s+using\s+at\s+most\s+([1-3])\s+pages?[.!]?$/i.exec(question)
  if (pageBound) {
    maxPages = Number(pageBound[1])
    question = question.slice(0, pageBound.index).trim()
  }
  if (/\busing\s+at\s+most\b/i.test(question)) return null
  if (!question || question.length > 512
      || /\b(?:and|then|also)\s+(?:please\s+)?(?:run|execute|install|delete|edit|modify|write|send|post|buy|upload)\b/i.test(question)) return null
  const seed_urls = [...new Set((question.match(/https:\/\/[^\s<>"']+/gi) || []).map(url => url.replace(/[),.;!]+$/, '')))]
  if (seed_urls.length > 3) return null
  return { question, seed_urls, retain, max_pages: maxPages }
}
