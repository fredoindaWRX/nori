import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instructionSkillContext } from '../bridge/instruction-skills.mjs'

// Provenance: exact 1,425-byte UTF-8 + final LF source from
// C:\Nori\skills\nori-rea\skill.json, inspected 2026-10-18. Its existing
// instruction-skills.mjs pin already approved these bytes; pin is unchanged.
// This test makes isolated checkout provenance reproducible without reading
// the mutable live main tree or executing skill.py.
const referencePath = 'skills/nori-rea/skill.json'
const pinnedHash = '40cd7ee4dc0710cba25cc024626bcb1d1ba32765f04871fec99383504bfbd179'
const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url))
const sourceBytes = readFileSync(join(sourceRoot, referencePath))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const request = 'Check REA connection and list available tools.'

test('native payload allowlist includes exactly the pinned REA reference, not executable skill contents', () => {
  // Static closure regression: importing the complete packaging pipeline would
  // require unrelated model/runtime build dependencies in a focused worktree.
  const planner = readFileSync(new URL('../scripts/native-payload-plan.mjs', import.meta.url), 'utf8')
  const block = planner.match(/export const nativeSkillReferenceFiles=Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1]
  assert.ok(block, 'native reference allowlist is present')
  assert.match(planner, /for\(const path of nativeSkillReferenceFiles\)add\(path\)/)
  const nativeSkillReferenceFiles = [...block.matchAll(/'([^']+)'/g)].map(match => match[1])
  assert.equal(sourceBytes.length, 1425)
  assert.equal(sha256(sourceBytes), pinnedHash)
  assert.deepEqual(nativeSkillReferenceFiles.filter(name => name.startsWith('skills/nori-rea/')), [referencePath])
  const manifest = JSON.parse(sourceBytes)
  assert.equal(manifest.schema, 'nori.skill-candidate.v1')
  assert.equal(manifest.name, 'nori-rea')
  assert.equal(manifest.status, 'candidate')
  assert.equal(manifest.authority, 'none')
  assert.equal(manifest.execution, 'plan_only')
  assert.equal(manifest.activation, 'requires_successful_test_and_verified_activation')
  const guidance = instructionSkillContext(request, sourceRoot)
  assert.match(guidance, /Nori checks REA by verifying Node\.js\/package identity/)
  assert.match(guidance, /candidate reference; inactive, non-executable/)
  assert.match(guidance, /plan-only reference and grants no execution authority/)
})

test('a synthetic staged root needs the exact data file; missing or changed bytes remain inert', t => {
  const temporaryRoot = resolve(tmpdir())
  const stage = mkdtempSync(join(temporaryRoot, 'nori-rea-reference-stage-'))
  t.after(() => {
    const bounded = relative(temporaryRoot, resolve(stage))
    assert.ok(bounded && !isAbsolute(bounded) && !bounded.startsWith(`..${sep}`)
      && !bounded.includes(sep) && bounded.startsWith('nori-rea-reference-stage-'))
    rmSync(stage, { recursive: true, force: true })
    assert.equal(existsSync(stage), false)
  })
  assert.equal(instructionSkillContext(request, stage), '')
  const destination = join(stage, referencePath)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, sourceBytes, { flag: 'wx' })
  assert.equal(sha256(readFileSync(destination)), pinnedHash)
  assert.match(instructionSkillContext(request, stage), /server-advertised catalog is not the same as Nori-wired actions/)
  assert.equal(existsSync(join(stage, 'skills/nori-rea/skill.py')), false)
  assert.equal(existsSync(join(stage, 'skills/nori-rea/test_skill.py')), false)
  writeFileSync(destination, sourceBytes.toString('utf8').replace('"authority": "none"', '"authority": "execute"'))
  assert.equal(instructionSkillContext(request, stage), '')
})
