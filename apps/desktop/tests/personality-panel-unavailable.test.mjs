import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const panel = readFileSync(new URL('../src/ui/PersonalityPanel.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/ui/personality.css', import.meta.url), 'utf8')

test('affect bars distinguish unavailable bridge state from a real zero score', () => {
  assert.match(panel, /role=\{state \? 'meter' : 'img'\}/)
  assert.match(panel, /aria-label=\{state \? `Live \$\{key\}` : `Live \$\{key\} unavailable`\}/)
  assert.match(panel, /\{state && <span className="nori-personality-fill" style=\{\{ width: `\$\{state\.affect\[key\]\}%` \}\} \/>\}/)
  assert.doesNotMatch(panel, /state\?\.affect\[key\] \?\? 0/)
  assert.match(panel, /<output>\{state \? state\.affect\[key\] : '—'\}<\/output>/)
  assert.match(styles, /\.nori-personality-meter-unavailable \{[^}]*repeating-linear-gradient/)
})
