import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_BACKGROUND, tidyWorkspaceBackground } from '../bridge/workspace-background.mjs'

test('ordinary tab lists pass through untouched', () => {
  const text = '[Open tabs: 1 "Notes" (text, in front); 2 "Example" (web, https://example.com/page?a=1, open)]'
  assert.equal(tidyWorkspaceBackground(text), text)
  assert.equal(tidyWorkspaceBackground(''), '')
  assert.equal(tidyWorkspaceBackground(undefined), undefined)
  assert.deepEqual(tidyWorkspaceBackground({ not: 'text' }), { not: 'text' })
})

test('a picture on the display no longer makes the next message fail', () => {
  const image = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAA'.repeat(4000)}`
  const text = `[Open tabs: 1 "Imagined portrait" (image, ${image}, in front); 2 "Example" (web, https://example.com, open)]\n\n[Answer only from what is shown.]`
  assert.ok(text.length > MAX_BACKGROUND)
  const tidy = tidyWorkspaceBackground(text)
  assert.ok(tidy.length < 400, String(tidy.length))
  assert.match(tidy, /"Imagined portrait" \(image, embedded image, not shown, in front\)/)
  assert.match(tidy, /https:\/\/example\.com, open/)
  assert.match(tidy, /Answer only from what is shown/)
  assert.ok(!tidy.includes('iVBORw0KGgo'))
})

test('other very long unbroken strings are shortened and the total is capped', () => {
  const tidy = tidyWorkspaceBackground(`[Open tabs: 1 "Blob" (web, https://example.com/${'a'.repeat(5000)}, open)]`)
  assert.ok(tidy.length < 300); assert.match(tidy, /…\(shortened\)/)
  const many = tidyWorkspaceBackground(Array.from({ length: 3000 }, (_, i) => `tab number ${i}`).join('; '))
  assert.ok(many.length <= MAX_BACKGROUND); assert.ok(many.endsWith('…(shortened)'))
})

test('the bridge tidies the background before it checks its length', () => {
  const server = readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8')
  const tidy = server.indexOf("if (typeof msg.context === 'string') msg.context = tidyWorkspaceBackground(msg.context)")
  const check = server.indexOf("if ('context' in msg && (typeof msg.context !== 'string' || msg.context.length > 16000)) {")
  assert.ok(tidy > 0 && check > tidy)
  assert.match(server, /import \{ tidyWorkspaceBackground \} from '\.\/workspace-background\.mjs'/)
})
