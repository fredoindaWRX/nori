import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('screen-share help text preserves Nori identity and accurately describes sharing', () => {
  const hud = readFileSync(new URL('../src/ui/Hud.tsx', import.meta.url), 'utf8')
  assert.match(hud, /Nori sees a screenshot with each message while you share\./)
  assert.doesNotMatch(hud, /He sees it with every message while it is shared\./)
})
