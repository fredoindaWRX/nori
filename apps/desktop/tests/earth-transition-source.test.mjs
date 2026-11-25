import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('Earth transition resets entry location and releases completed timer handles',()=>{
  const source=readFileSync(new URL('../src/scene/Scene.tsx',import.meta.url),'utf8')
  assert.match(source,/if \(destination\) returnLocation\.current = \{ \.\.\.destination \}/)
  assert.match(source,/timers\.current\.delete\(timer\); callback\(\)/)
  assert.match(source,/timers\.current\.forEach\(clearTimeout\); timers\.current\.clear\(\)/)
  assert.doesNotMatch(source,/timers\.current\.push/)
})
