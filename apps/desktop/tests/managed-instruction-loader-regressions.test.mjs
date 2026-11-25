import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { managedInstructionCatalog: catalog, managedInstructionSkillContext: context } = await import(
  process.env.NORI_LOADER_TEST_MODULE || '../bridge/managed-instruction-skills.mjs')
const sha = value => createHash('sha256').update(value).digest('hex')
const identity = 'a'.repeat(64)
const revision = 'b'.repeat(40)

test('ordinary AI-writing detection questions load the verified detector guidance', t => {
  const f = fixture(t, [
    { name: 'avoid-ai-writing', description: 'Writing style', guide: '# Writing', extra: { 'references/patterns.md': 'pattern '.repeat(5000) } },
    { name: 'ai-writing-detector', description: 'Scan prose patterns', guide: '# Detector\nDETECTOR_FIXTURE_MARKER. Do not equate stylistic patterns with proof of authorship.' },
  ])
  for (const goal of ['Does this sound AI-written?', 'Is this text AI generated?', 'Can you check whether this writing is AI-written?']) {
    const result = context(goal, f.root)
    assert.match(result, /DETECTOR_FIXTURE_MARKER/)
    assert.match(result, /no tool access or authority/)
    assert.ok(result.length <= 32000)
  }
  for (const goal of ['Hello.', 'Is this an AI image?', 'Is this image AI-generated?', 'Is this video AI-generated?', "Do not check whether this is AI-written."]) {
    assert.doesNotMatch(context(goal, f.root), /DETECTOR_FIXTURE_MARKER/)
  }
})

function fixture(t, specs = [{ name: 'weather-research', description: 'Weather forecast research', guide: '# Weather fixture\nRead official weather forecasts.' }], github = false) {
  const root = mkdtempSync(join(tmpdir(), 'nori-loader-regression-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const skills = []
  for (const spec of specs) {
    const base = join(root, 'packages', identity, spec.name)
    const contents = { 'SKILL.md': spec.guide, LICENSE: 'MIT synthetic license', ...(github ? { 'NORI-REPOSITORY-LICENSE.txt': 'MIT synthetic license' } : {}), ...spec.extra }
    const files = {}
    for (const [relative, content] of Object.entries(contents)) {
      const target = join(base, relative)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, content)
      files[relative] = { bytes: Buffer.byteLength(content), sha256: sha(content) }
    }
    skills.push({ name: spec.name, description: spec.description, mode: 'instruction_reference', code_execution_enabled: false, files })
  }
  const record = { archive_sha256: identity, skills, ...(github ? { source_kind: 'github' } : {}) }
  if (github) {
    const skill = skills[0]
    record.source_provenance = { schema: 'nori.github-skill-provenance.v1', repository: 'fixture-owner/fixture-repo', revision,
      archive_sha256: 'c'.repeat(64), skill_name: skill.name, description: skill.description,
      skill_path: `skills/${skill.name}`, source_url: `https://github.com/fixture-owner/fixture-repo/tree/${revision}/skills/${skill.name}`,
      skill_sha256: skill.files['SKILL.md'].sha256, license_sha256: skill.files.LICENSE.sha256,
      package_license_entry: 'bundle/LICENSE', license_copy_path: 'NORI-REPOSITORY-LICENSE.txt',
      files: Object.fromEntries(Object.entries(skill.files).map(([relative, file]) => [relative, file.sha256])) }
  }
  const save = () => writeFileSync(join(root, 'registry.json'), JSON.stringify({ schema: 'nori.instruction-skills.v1', packages: { [identity]: record } }))
  save()
  return { root, record, save }
}

test('valid local ZIP and GitHub skills expose verified provenance without execution', t => {
  for (const github of [false, true]) {
    const f = fixture(t, undefined, github), result = catalog(f.root)
    assert.equal(result.length, 1)
    assert.equal(result[0].sourceKind, github ? 'github' : 'local_zip')
    assert.equal(result[0].packageId, identity)
    assert.equal(result[0].verified, true)
    assert.deepEqual(result[0].sourceProvenance, github ? f.record.source_provenance : null)
    const loaded = context('Use weather-research.', f.root)
    assert.match(loaded, /Weather fixture/)
    assert.match(loaded, /untrusted task guidance only/)
    if (github) assert.match(loaded, new RegExp(`fixture-owner/fixture-repo@${revision}`))
    else assert.match(loaded, /local skill "weather-research"/)
  }
})

test('GitHub provenance failures reject the whole catalog before guidance selection', async t => {
  const mutations = {
    missing: r => { delete r.source_provenance },
    schema: r => { r.source_provenance.schema = 'unknown' },
    repository: r => { r.source_provenance.repository = '../fixture-repo' },
    revision: r => { r.source_provenance.revision = 'main' },
    archiveHash: r => { r.source_provenance.archive_sha256 = 'bad' },
    description: r => { r.source_provenance.description = 'different' },
    skillName: r => { r.source_provenance.skill_name = 'other-skill' },
    skillPath: r => { r.source_provenance.skill_path = '../weather-research' },
    http: r => { r.source_provenance.source_url = 'http://github.com/fixture-owner/fixture-repo/' },
    host: r => { r.source_provenance.source_url = 'https://github.example/fixture-owner/fixture-repo/' },
    credentials: r => { r.source_provenance.source_url = 'https://user:pass@github.com/fixture-owner/fixture-repo/' },
    port: r => { r.source_provenance.source_url = 'https://github.com:8443/fixture-owner/fixture-repo/' },
    ownerMismatch: r => { r.source_provenance.source_url = 'https://github.com/other/fixture-repo/' },
    query: r => { r.source_provenance.source_url += '?secret=fixture' },
    fragment: r => { r.source_provenance.source_url += '#fragment' },
    packageLicense: r => { r.source_provenance.package_license_entry = 'other/LICENSE' },
    licenseCopy: r => { delete r.skills[0].files['NORI-REPOSITORY-LICENSE.txt'] },
    licenseHash: r => { r.source_provenance.license_sha256 = 'd'.repeat(64) },
    guideHash: r => { r.source_provenance.skill_sha256 = 'd'.repeat(64) },
    sourceFiles: r => { r.source_provenance.files = [] },
    emptyFiles: r => { r.source_provenance.files = {} },
    missingReference: r => { r.source_provenance.files['missing.md'] = 'd'.repeat(64) },
  }
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, t => {
    const f = fixture(t, undefined, true)
    mutate(f.record); f.save()
    assert.deepEqual(catalog(f.root), [])
    assert.equal(context('Use weather-research.', f.root), '')
  })
})

test('unknown source kinds fail closed while omitted legacy local ZIP kind remains valid', t => {
  const f = fixture(t)
  assert.equal(catalog(f.root).length, 1)
  f.record.source_kind = 'unrecognized-network-source'; f.save()
  assert.deepEqual(catalog(f.root), [])
})

test('verified generic guides support explicit names and relevant terms, without loading on unrelated conversation', t => {
  const f = fixture(t)
  for (const goal of ['Use weather-research.', 'Use weather research.', 'Check the weather forecast.']) {
    const loaded = context(goal, f.root)
    assert.match(loaded, /Weather fixture/)
    assert.match(loaded, /untrusted task guidance only/)
    assert.match(loaded, /no tool access or authority/)
    assert.match(loaded, /code is never run/)
  }
  for (const goal of ['Hi.', 'What is the weather?', 'Use weather-researcher.']) assert.equal(context(goal, f.root), '')
})

test('current shipped nori-capabilities selector survives the source merge', t => {
  const f = fixture(t, [{ name: 'nori-capabilities', description: 'Local functions overview', guide: '# Capability fixture' }])
  for (const goal of ['What can you do?', 'What are you capable of?', 'Can you inspect a local app?']) assert.match(context(goal, f.root), /Capability fixture/)
})

test('explicit investigator and actual research intents retain their question-matrix reference once', t => {
  const f = fixture(t, [{ name: 'nori-5w1h-investigator', description: 'Evidence investigation questions', guide: '# Investigator fixture', extra: { 'references/question-matrix.md': '# Question matrix fixture' } }])
  for (const goal of ['Use nori-5w1h-investigator.', 'Use nori 5w1h investigator.', 'Research why the fixture failed.', 'Investigate the fixture failure.', 'Perform an investigation of the fixture failure.', 'Fact-check the failure cause.']) {
    const loaded = context(goal, f.root)
    assert.match(loaded, /Investigator fixture/)
    assert.match(loaded, /Question matrix fixture/)
    assert.equal(loaded.match(/Investigator fixture/g).length, 1)
  }
})

test('greetings capability queries catalog queries and unrelated W/H questions do not load interrogation guidance', t => {
  const f = fixture(t, [
    { name: 'nori-5w1h-investigator', description: 'Evidence investigation questions', guide: '# Investigator fixture', extra: { 'references/question-matrix.md': '# Question matrix fixture' } },
    { name: 'nori-capabilities', description: 'Local functions overview', guide: '# Capability fixture' },
  ])
  for (const goal of ['how are you', 'How are you?', 'what can you do', 'What can you do?', 'What skills do you have installed?', 'Show your skill catalog.', 'Why is the sky blue?', 'Where am I?', 'Who are you?', 'When is lunch?', 'Which color is blue?', 'Explain what you can do.']) {
    const loaded = context(goal, f.root)
    assert.doesNotMatch(loaded, /Investigator fixture|Question matrix fixture/, goal)
  }
  assert.match(context('What can you do?', f.root), /Capability fixture/)
})

test('generic instruction context is bounded including labels and explicit truncation notices', t => {
  const specs = ['first-guide', 'second-guide', 'third-guide', 'fourth-guide'].map(name => ({ name, description: 'Synthetic documentation', guide: name + '\n' + 'X'.repeat(60000) }))
  const f = fixture(t, specs)
  const loaded = context('Use first-guide, second-guide, third-guide, fourth-guide.', f.root)
  assert.ok(loaded.length <= 32000, String(loaded.length))
  assert.match(loaded, /truncated for length/)
  assert.doesNotMatch(loaded, /fourth-guide/)
})

test('large writing guides cannot evade the aggregate context budget', t => {
  const f = fixture(t, [{ name: 'avoid-ai-writing', description: 'Writing guidance', guide: '# Writing fixture\n' + 'G'.repeat(60000), extra: { 'references/patterns.md': 'P'.repeat(150000) } }])
  const loaded = context('Rewrite this paragraph.', f.root)
  assert.ok(loaded.length <= 32000, String(loaded.length))
  assert.match(loaded, /truncated for length/)
  assert.doesNotMatch(loaded, /Complete bundled/)
})

test('tampered registered generic guide never becomes usable context', t => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'packages', identity, 'weather-research', 'SKILL.md'), '# Tampered')
  assert.deepEqual(catalog(f.root), [])
  assert.equal(context('Use weather-research.', f.root), '')
})
