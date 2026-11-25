import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { nativeSkillReferenceFiles, nativeDesktopModuleFiles } from '../scripts/native-payload-plan.mjs'

test('portable payload includes the complete managed-instruction installer and pinned writing bundle', () => {
  const required = [
    'nori/local_skill_installer.py',
    'skills/bundled/avoid-ai-writing-3.38.0.zip',
    'apps/desktop/bridge/managed-instruction-skills.mjs',
    'apps/desktop/bridge/skill-installer-tools.mjs',
    'apps/desktop/desktop/skill-installer.cjs',
  ]
  const planned = new Set([...nativeSkillReferenceFiles, ...nativeDesktopModuleFiles])
  for (const path of required) {
    assert.ok(planned.has(path), `Missing portable dependency: ${path}`)
    const source = fileURLToPath(new URL(`../../../${path}`, import.meta.url))
    assert.ok(statSync(source).isFile(), `Missing source dependency: ${path}`)
  }
  const bundle = readFileSync(new URL('../../../skills/bundled/avoid-ai-writing-3.38.0.zip', import.meta.url))
  assert.equal(createHash('sha256').update(bundle).digest('hex'),
    '4ba9334113f500b18abbbf4fe7e3625281a48a7e8a7b0bddb17e0087d167a292')
})
