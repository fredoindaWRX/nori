import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNoriAiderTools, isAiderCodeRequest, resolveAiderCodingRequest, resolveAiderWorkspace, isAiderCapabilityQuestion, aiderCapabilityAnswer, aiderRuntimeCapabilitySummary, localAiderModel, isAiderFollowupContextIncomplete } from '../bridge/aider-tools.mjs'

test('Aider binds to the selected local model and rejects unknown profiles', () => {
  assert.deepEqual(localAiderModel({ NORI_GPT_OSS_SERVER_MODEL: 'qwen3.8-27b' }), {
    id: 'openai/qwen3.8-27b', label: 'local Qwen3.8 27B',
  })
  assert.deepEqual(localAiderModel({ NORI_GPT_OSS_SERVER_MODEL: 'gpt-oss-20b' }), {
    id: 'openai/gpt-oss-20b', label: 'local GPT-OSS 20B',
  })
  assert.throws(() => localAiderModel({ NORI_GPT_OSS_SERVER_MODEL: 'unknown-local-model' }), /no fallback/)
})

test('Aider executable version does not establish model or chat readiness', () => {
  const answer = aiderRuntimeCapabilitySummary('0.86.2')
  assert.match(answer, /does not verify the selected model/)
  assert.match(answer, /chat’s coding connection/)
  assert.doesNotMatch(answer, /configured for GPT-OSS|model server is ready/)
  assert.throws(() => aiderRuntimeCapabilitySummary('unverified'))
})

test('Aider route requires an imperative coding request, not a capability question', () => {
  assert.equal(isAiderCodeRequest('Can you fix the bug in my app?'), true)
  assert.equal(isAiderCodeRequest('Use Aider to implement this code change.'), true)
  assert.equal(isAiderCodeRequest('What coder does Nori have?'), false)
  assert.equal(isAiderCodeRequest('Tell me how Aider works.'), false)
  assert.equal(isAiderCodeRequest('Create me a picture using the photo app.'), false)
  assert.equal(isAiderCodeRequest('Create a two-second test video.'), false)
  assert.equal(isAiderCodeRequest('Create a FilmCraft project.'), false)
  assert.equal(isAiderCodeRequest('Use WordCraft to write a script for my video.'), false)
  assert.equal(isAiderCodeRequest('Use WordCraft to create a document titled "code refactor".'), false)
  assert.equal(isAiderCodeRequest('Write a Python script to edit a video.'), true)
  assert.equal(isAiderCodeRequest('Build me a new desktop app.'), true)
  assert.equal(isAiderCodeRequest('Use Aider to update README.md.'), true)
  assert.equal(isAiderCodeRequest('Can you code?'), false)
  assert.equal(isAiderCapabilityQuestion('Who does your coding?'), true)
  assert.equal(isAiderCapabilityQuestion('Use Aider to fix the bug.'), false)
})

test('Aider workspace is bound to the user-mentioned local folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori aider project '))
  try {
    const request = `Use Aider to fix the bug in my app at "${root}".`
    assert.equal(resolveAiderWorkspace(request), root)
    assert.throws(() => resolveAiderWorkspace(request, { NORI_AIDER_WORKSPACE_ROOT: join(root, 'other') }), /differs/)
    assert.equal(resolveAiderWorkspace('Fix the code in my app.'), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Aider follows a short confirmation only after Nori explicitly offered to run the latest coding request', () => {
  const prior = 'Create a Python function in "C:\\projects\\demo" that converts Celsius to Fahrenheit.'
  const turns = [
    { role: 'user', text: prior },
    { role: 'nori', text: 'I have the implementation plan. Would you like me to run it with Aider?' },
  ]
  const resolved = resolveAiderCodingRequest('sure run it', turns)
  assert.match(resolved, /Create a Python function/)
  assert.match(resolved, /User explicitly confirmed/)
  assert.equal(resolveAiderCodingRequest('sure run it', [
    { role: 'user', text: prior },
    { role: 'nori', text: 'Aider can edit code in a selected Git project.' },
  ]), '')
  assert.equal(resolveAiderCodingRequest('sure run it', [
    ...turns,
    { role: 'user', text: 'What is the weather today?' },
  ]), '')
  assert.equal(resolveAiderCodingRequest('I agree', turns), '')
})

test('coding tools include the ordinary project reader and the bounded Aider worker only with packaged runtime files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nori aider fixture '))
  const suite = join(root, 'suite')
  const project = join(root, 'project')
  const put = (relative, content = 'fixture') => {
    const file = join(suite, relative)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content)
  }
  try {
    mkdirSync(project)
    put('python/Python311/python.exe')
    put('nori/nori_aider.py')
    put('integrations/aider/run_aider.py')
    put('integrations/aider/aider-nori.conf.yml')
    put('integrations/aider/.venv/Lib/site-packages/aider/__init__.py')
    put('integrations/aider/git/mingw64/bin/git.exe')
    const userRequest = `Use Aider to update the code in "${project}".`
    const tools = createNoriAiderTools({ userRequest, apiBase: 'http://127.0.0.1:18788/v1', suiteRoot: suite })
    assert.equal(tools.aiderWorker, true)
    const names = tools.definitions.map(item => item.function.name)
    assert.ok(names.includes('read_file'))
    assert.ok(names.includes('list_dir'))
    assert.ok(names.includes('aider_code_task'))
    assert.match(await aiderCapabilityAnswer({},suite),/could not start the bundled worker|not ready/i,
      'fixture paths are not evidence that the executable Aider runtime works')
    assert.throws(() => createNoriAiderTools({ userRequest,
      apiBase: 'https://model.example/v1', suiteRoot: suite }), /loopback/)
    tools.close()
    const exact = createNoriAiderTools({ userRequest:userRequest+' Only edit calculator.py.',
      apiBase:'http://127.0.0.1:18788/v1',suiteRoot:suite })
    assert.deepEqual(exact.definitions.map(tool=>tool.function.name),['aider_code_task'])
    await assert.rejects(exact.call('aider_code_task',{allowed_files:['other.py']}),/exact file/)
    exact.close()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('generated code can be prepared after a short run confirmation without granting approval', () => {
  const request = 'Generate a Python function that adds two numbers.'
  const turns = [{role:'user',text:request},{role:'nori',text:'Would you like me to run it with Aider?'}]
  assert.match(resolveAiderCodingRequest('sure run it',turns), /Generate a Python function/)
  assert.equal(isAiderFollowupContextIncomplete('sure run it',turns),false)
})
for (const offer of ['Would you like me to create a shopping list?', 'Would you like me to write a script for your YouTube stream?', 'Would you like me to create a source list for this research?']) {
  test('ordinary legacy-length history remains conversation: '+offer, () => {
    const turns=[{role:'user',text:'Help me plan my garden. '.padEnd(1800,' ')},{role:'nori',text:offer}]
    assert.equal(resolveAiderCodingRequest('sure run it',turns),'')
    assert.equal(isAiderFollowupContextIncomplete('sure run it',turns),false)
  })
}
test('incomplete coding scope cannot be used as a follow-up action request', () => {
  const turns=[{role:'user',text:'Use Aider to fix the code. '.padEnd(1800,' ')},{role:'nori',text:'Would you like me to run it with Aider?'}]
  assert.equal(resolveAiderCodingRequest('sure run it',turns),'')
  assert.equal(isAiderFollowupContextIncomplete('sure run it',turns),true)
})
