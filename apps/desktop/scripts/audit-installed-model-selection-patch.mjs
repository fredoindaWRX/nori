import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { importedChatSelection, importedChatLabel } from '../bridge/imported-chat-selection.mjs'

// Read-only patch rehearsal: no archive, installed file, or staging mutation.
const asar = createRequire(import.meta.url)('@electron/asar')
const archive = 'C:/Program Files/Nori/resources/app.asar'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const before = hash(readFileSync(archive))
assert.equal(before, '5b527a334b9e7abfe61e4e1471517d3e89aa129059f82494eb12ee7697eb0b53')
const original = asar.extractFile(archive, 'bridge/local-chat.mjs').toString()
let chat = original
function replaceOnce(from, to) {
  assert.equal(chat.split(from).length, 2, `Installed patch anchor changed: ${from.slice(0, 90)}`)
  chat = chat.replace(from, to)
}
replaceOnce('import { importedChatSelection, migrateImportedChatSelection }',
  'import { importedChatSelection, importedChatLabel, migrateImportedChatSelection }')
const choiceStart = chat.indexOf("    if (environment.NORI_GPT_OSS_SERVER_MODEL === 'qwen3.8-27b') {")
assert.ok(choiceStart > 0)
const choiceEnd = chat.indexOf('\n  }', choiceStart)
assert.ok(choiceEnd > choiceStart)
chat = chat.slice(0, choiceStart) +
  '    return [{ id: importedChatSelection(environment), label: `${importedChatLabel(environment)} — local imported model` }]' +
  chat.slice(choiceEnd)
replaceOnce("const importedModelLabel = qwen ? 'Qwen3.8 27B' : 'GPT-OSS 20B'", 'const importedModelLabel = importedChatLabel()')
replaceOnce("'The active local GPT-OSS model has an experimental Heretic adapter applied; this model profile is not behaviorally or safety qualified. Nori action and review controls remain separate and unchanged.'",
  '`The active local ${importedModelLabel} model has an experimental Heretic adapter applied; this model profile is not behaviorally or safety qualified. Nori action and review controls remain separate and unchanged.`')
replaceOnce("'You are using GPT-OSS 20B as a temporary imported local checkpoint.'",
  '`You are using ${importedModelLabel} as a temporary imported local checkpoint.`')
replaceOnce("const currentToolNotice = qwen ? toolNotice.replace('local GPT-OSS 20B', 'local Qwen3.8 27B') : toolNotice",
  "const currentToolNotice = toolNotice.replaceAll('local GPT-OSS 20B', `local ${importedModelLabel}`)")
replaceOnce("${process.env.NORI_GPT_OSS_SERVER_MODEL === 'qwen3.8-27b' ? 'Qwen3.8 27B' : 'GPT-OSS 20B'}",
  '${importedChatLabel()}')
replaceOnce("  const modelNotice = environment.NORI_GPT_OSS_SERVER_MODEL === 'qwen3.8-27b'\n    ? 'Qwen3.8 27B is the active imported local model. It is not Nori-trained. The custom SoN training project has been retired.'\n    : 'GPT-OSS 20B is an imported local model, not a Nori-trained checkpoint. The custom SoN training project has been retired.'",
  '  const modelNotice = `${importedChatLabel(environment)} is the active imported local model. It is not Nori-trained. The custom SoN training project has been retired.`')
const selection = readFileSync(new URL('../bridge/imported-chat-selection.mjs', import.meta.url), 'utf8')
export const proposedInstalledModelModules = { chat, selection }
for (const source of [chat, selection]) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
}
// Evaluate only the two pure metadata functions from the proposed installed
// text. This does not import/start the bridge or invoke inference/tool workers.
function pureFunction(name, nextName) {
  const start = chat.indexOf(`export function ${name}(`)
  const boundary = new RegExp(`(?:export )?function ${nextName}\\(`)
  const following = chat.slice(start + 1).search(boundary)
  const end = following < 0 ? -1 : start + 1 + following
  assert.ok(start >= 0 && end > start)
  const source = chat.slice(start, end).replace(/^export /, '')
  return new Function('importedChatSelection', 'importedChatLabel', 'GPT_OSS_SELECTION',
    `${source}\nreturn ${name}`)(importedChatSelection, importedChatLabel, 'gpt-oss:20b')
}
const choices = pureFunction('nativeModelChoices', 'nativeModelSelection')
const capability = pureFunction('gptOssCapabilityReviewPolicy', 'isNoriReviewSourcePath')
for (const model of ['qwen3.8-27b', 'gpt-oss-20b', 'fixture-local-9b', 'fixture-local-14b']) {
  const environment = { NORI_INFERENCE_RUNTIME: 'gpt-oss', NORI_GPT_OSS_SERVER_MODEL: model }
  assert.equal(choices(environment)[0].id, importedChatSelection(environment))
  assert.ok(choices(environment)[0].label.includes(importedChatLabel(environment)))
  const policy = capability({}, environment)
  assert.ok(policy.includes(`${importedChatLabel(environment)} is the active imported local model`))
  assert.ok(policy.includes('read-only'))
  assert.ok(policy.includes('Never claim a save succeeded unless the verified tool result confirms it'))
}
assert.throws(() => choices({ NORI_INFERENCE_RUNTIME: 'gpt-oss', NORI_GPT_OSS_SERVER_MODEL: '../escape' }), /Invalid/)
assert.equal(hash(readFileSync(archive)), before)
console.log(JSON.stringify({ beforeSha256: before, installedChanged: false, stageChanged: false,
  syntaxChecks: 2, metadataModelCases: 4, invalidModelRejected: true, proposedModuleHashes: {
    'bridge/local-chat.mjs': hash(chat), 'bridge/imported-chat-selection.mjs': hash(selection),
  } }, null, 2))
