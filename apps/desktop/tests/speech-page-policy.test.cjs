const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { speechPagePolicy } = require('../desktop/speech-page-policy.cjs')
const html = readFileSync(join(__dirname, '../index.html'), 'utf8')

test('desktop speech policy names the exact preview port without wildcarding loopback', () => {
  const output = speechPagePolicy(html, 'http://127.0.0.1:55324')
  const policy = output.match(/content="([^"]+)"/g).find(value => value.includes('connect-src'))
  assert.match(policy, /connect-src[^;]*http:\/\/127\.0\.0\.1:55324/)
  assert.doesNotMatch(policy, /http:\/\/(localhost|127\.0\.0\.1):8787/)
  assert.doesNotMatch(policy, /http:\/\/(localhost|127\.0\.0\.1):\*/)
  assert.match(policy, /default-src 'self';/)
  assert.match(policy, /object-src 'none';/)
  assert.match(policy, /media-src 'self' data: blob: http:\/\/127\.0\.0\.1:55324/)
})
test('packaged speech port is bound too, while other page bytes stay unchanged', () => {
  const output = speechPagePolicy(html, 'http://127.0.0.1:18787')
  const policyOnly = source => source.replace(/(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]+("\s*\/?>)/i, '$1POLICY$2')
  assert.equal(policyOnly(output), policyOnly(html))
  assert.match(output, /connect-src[^;]*http:\/\/127\.0\.0\.1:18787/)
})
test('non-owned origins and URL injection are refused', () => {
  for (const origin of ['https://127.0.0.1:55324', 'http://example.com:55324',
    'http://localhost:55324', 'http://127.0.0.1:55324/path',
    'http://127.0.0.1:55324?x=1', 'http://user:pass@127.0.0.1:55324',
    'http://127.0.0.1:*', 'http://127.0.0.1:55324/']) {
    assert.throws(() => speechPagePolicy(html, origin))
  }
})
test('missing or drifted policy fails closed rather than serving a less restricted page', () => {
  assert.throws(() => speechPagePolicy('<html>No policy</html>', 'http://127.0.0.1:55324'))
  assert.throws(() => speechPagePolicy(html.replaceAll(':8787', ':9999'), 'http://127.0.0.1:55324'))
})
test('desktop server applies policy before returning its generated index page', () => {
  const main = readFileSync(join(__dirname, '../desktop/main.cjs'), 'utf8')
  assert.match(main, /speechPagePolicy\(readFileSync\(file, 'utf8'\), new URL\(BRIDGE_URL\)\.origin\)/)
})
test('desktop delegates initial bounds and visibility to the tested event binding', () => {
  const main = readFileSync(join(__dirname, '../desktop/main.cjs'), 'utf8')
  assert.match(main, /bindWindowStartup\(window, \{ probe: Boolean\(PROBE_SESSION\), currentIcon, arrangeWorkspace, showNori \}\)/)
  assert.doesNotMatch(main, /window\.once\('ready-to-show'/)
})
