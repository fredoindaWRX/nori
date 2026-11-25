export const PROJECT_REVIEW_READS = Object.freeze([
  Object.freeze({ entry: 'project-tools.mjs', startLine: 198, maxLines: 90 }),
  Object.freeze({ entry: 'local-chat.mjs', startLine: 620, maxLines: 90 }),
])
const SHA = /^[a-f0-9]{64}$/
function check(signal) { signal?.throwIfAborted() }
function source(value, spec) {
  if (!value || Object.keys(value).sort().join(',') !== 'content,entry_bytes,entry_sha256,excerpt_sha256,omitted,path,returned_lines,start_line'
      || value.path !== `bridge/${spec.entry}` || value.start_line !== spec.startLine
      || !Number.isSafeInteger(value.returned_lines) || value.returned_lines < 1 || value.returned_lines > spec.maxLines
      || typeof value.content !== 'string' || !value.content.trim() || value.content.length > 32768
      || new TextEncoder().encode(value.content).byteLength > 32768
      || value.content.split('\n').length !== value.returned_lines || typeof value.omitted !== 'boolean'
      || !SHA.test(value.entry_sha256) || !SHA.test(value.excerpt_sha256)
      || !Number.isSafeInteger(value.entry_bytes) || value.entry_bytes < 1 || value.entry_bytes > 256 * 1024
      || new TextEncoder().encode(value.content).byteLength > value.entry_bytes) return null
  return Object.freeze({ ...value })
}
function evidence(batch, expectedHostModuleUrl) {
  if (!batch || Object.keys(batch).sort().join(',') !== 'container,container_bytes,container_identity,container_sha256,container_unchanged,host_module_url,provider,release_attested,results,root'
      || batch.provider !== 'nori.active-packaged-own-code.v1'
      || batch.host_module_url !== expectedHostModuleUrl || typeof expectedHostModuleUrl !== 'string'
      || !expectedHostModuleUrl.startsWith('file:') || batch.container_unchanged !== true
      || batch.release_attested !== false || !SHA.test(batch.container_sha256)
      || typeof batch.root !== 'string' || typeof batch.container !== 'string'
      || !Number.isSafeInteger(batch.container_bytes) || batch.container_bytes < 1 || batch.container_bytes > 768 * 1024 * 1024
      || !Array.isArray(batch.results) || batch.results.length > PROJECT_REVIEW_READS.length) return null
  const sources = []
  for (const spec of PROJECT_REVIEW_READS) {
    const matches = batch.results.filter(item => item?.path === `bridge/${spec.entry}`)
    if (matches.length > 1) return null
    const item = matches.length === 1 ? source(matches[0], spec) : null
    if (item) sources.push(item)
  }
  if (batch.results.some(item => !PROJECT_REVIEW_READS.some(spec => item?.path === `bridge/${spec.entry}`))) return null
  return sources.length ? { sources, batch } : null
}
function interpretations(raw, sources) {
  let data
  try { data = JSON.parse(raw) } catch { return [] }
  if (!data || Object.keys(data).join(',') !== 'findings' || !Array.isArray(data.findings) || data.findings.length > 3) return []
  for (const item of data.findings) {
    if (!item || Object.keys(item).sort().join(',') !== 'line,path,quote,suggestion'
        || typeof item.quote !== 'string' || item.quote.length < 8 || item.quote.length > 200
        || typeof item.suggestion !== 'string' || item.suggestion.length < 8 || item.suggestion.length > 400
        || /[\r\n]/.test(item.quote + item.suggestion) || !Number.isSafeInteger(item.line)
        || !/^(?:Consider|Prefer|Investigate|Compare|Add|Use|Check|Validate|Document|Refactor|Simplify|Guard|Bound|Handle|Avoid|Separate|Rename)\b/i.test(item.suggestion)
        || /\b(?:i|we)\s+(?:have\s+)?(?:ran|tested|verified|fixed|deleted|installed|completed|reviewed)\b|\b(?:everything|all\s+(?:code|features|tools))\s+(?:is|are|works?)\b|\b(?:no|zero)\s+(?:bugs|issues|errors)\b|\b(?:entire|whole)\s+(?:project|codebase|system)\b|\b(?:all\s+)?tests?\s+(?:pass(?:ed)?|succeeded|ran|completed)\b/i.test(item.suggestion)
        || /\b(?:delet(?:e|ing|ion)|remov(?:e|ing|al)|clean(?:ing)?\s*up|consolidat(?:e|ing|ion)|uninstall(?:ing)?)\b.{0,90}(?:\b(?:installation|candidates?|runtimes?|rollback|archives?)\b|\.previous\b)|\b(?:install|uninstall)(?:ing)?\b/i.test(item.suggestion)
        || /\b(?:active|running|loaded|executing|installed|live)\b.{0,48}\b(?:application|module|nori|code|version)\b|\b(?:code|module|file|bytes)\b.{0,64}\b(?:used|loaded|executed|running|active|installed)\b/i.test(item.suggestion)) return []
    const file = sources.find(file => file.path === item.path), index = file && item.line - file.start_line
    if (!file || index < 0 || index >= file.returned_lines || !file.content.split('\n')[index].includes(item.quote)) return []
  }
  return data.findings
}
function textBlock(text) {
  const safe = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '\uFFFD')
  const fence = '`'.repeat(Math.max(3, ...[...safe.matchAll(/`+/g)].map(match => match[0].length + 1)))
  return `${fence}text\n${safe}\n${fence}`
}
export async function boundedProjectReview({ acquire, summarize, signal, expectedHostModuleUrl }) {
  check(signal)
  let captured
  try { captured = evidence(await acquire(PROJECT_REVIEW_READS), expectedHostModuleUrl) } catch { check(signal) }
  check(signal)
  if (!captured) return Object.freeze({ text: 'I could not verify a successful read of my active packaged source. I cannot present a code review. No files were changed or tests run.',
    receipt: Object.freeze({ schema: 'nori.project-review-evidence.v1', status: 'unverified', sourceReads: [] }) })
  let suggested = []
  try { suggested = interpretations(await summarize(captured.sources), captured.sources) } catch { check(signal) }
  check(signal)
  const { sources, batch } = captured
  const output = [`I inspected these bounded packaged-source excerpts (container ${batch.container_sha256.slice(0, 12)}). No files were changed or tests run.`]
  for (const item of sources) output.push(`\n${item.path}:${item.start_line}–${item.start_line + item.returned_lines - 1}${item.omitted ? ' (partial file)' : ''}`,
    textBlock(item.content.split('\n').slice(0, 4).map((line, i) => `${item.start_line + i}: ${line}`).join('\n')))
  if (suggested.length) for (const item of suggested) output.push(`\nSuggestion, not a verified defect — ${item.path}:${item.line}:`, textBlock(item.quote), textBlock(item.suggestion))
  else output.push('\nNo source-matched improvement was established by the model from these excerpts.')
  if (sources.length < PROJECT_REVIEW_READS.length) output.push('\nSome requested source ranges remain unverified.')
  output.push('\nThe rest of the project remains unchecked; this is not a complete health check.')
  return Object.freeze({ text: output.join('\n'), receipt: Object.freeze({
    schema: 'nori.project-review-evidence.v1', status: 'observed', acquisition: Object.freeze({ ...batch,
      results: Object.freeze(batch.results.map(({ content, ...metadata }) => Object.freeze(metadata))),
    }),
    sourceReads: Object.freeze(sources), sourceMatchedSuggestions: Object.freeze(suggested),
    wholeProjectReviewed: false, testsRun: false, filesChanged: false,
  }) })
}

// This only excludes the fixed own-code preflight. It never grants access to a target.
export function hasExplicitProjectReviewTarget(value) {
  if (typeof value !== 'string' || value.length > 20000) return true
  return /\b[A-Za-z]:[\\/]|\\\\|\bfile\s*:/i.test(value)
}
