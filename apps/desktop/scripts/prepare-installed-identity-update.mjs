// Prepare a minimal app.asar update from the currently installed archive.
// This preserves the installed runtime and changes only hard-coded user-name
// assumptions in the bundled prompts. It never installs or launches Nori.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const installedRoot = 'C:/Program Files/Nori'
const archive = join(installedRoot, 'resources/app.asar')
const output = join(root, 'apps/desktop/verification/installed-identity-update-20261025-r4')
const stagedArchive = join(output, 'app.asar.next')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const require = createRequire(import.meta.url)
const { createPackage, extractAll, extractFile, listPackage } = require('@electron/asar')

function treeHashes(directory, prefix = '') {
  const entries = new Map()
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const relative = prefix ? `${prefix}/${name}` : name
    const info = statSync(path)
    if (info.isDirectory()) {
      for (const [child, digest] of treeHashes(path, relative)) entries.set(child, digest)
    } else if (info.isFile()) entries.set(relative, hash(readFileSync(path)))
    else throw new Error(`Unexpected extracted file type: ${path}`)
  }
  return entries
}

for (const path of [root, installedRoot, dirname(archive)]) {
  if (!existsSync(path) || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) {
    throw new Error(`Missing or linked update path refused: ${path}`)
  }
}
if (existsSync(output)) throw new Error(`Existing update folder preserved: ${output}`)

const changes = {
  'bridge/nori-identity.mjs': [
    ["You are N.O.R.I., Will's continuous desktop intelligence:", 'You are N.O.R.I., one continuous desktop intelligence:'],
    ['Call him Will when natural; never call him Commander, sir, owner or another title.',
      "Do not assume the user's name, gender, or title; use a name only when confirmed in the active profile. Never call the user Commander, sir, owner or another title."],
  ],
  'bridge/identity-output-guard.mjs': [
    ["You're Will, and I know you're building Nori. That's what I can ground from the context here; I won't pretend to know personal details you haven't shared.",
      "I don't have a confirmed name for you in the active profile. I know you're building Nori, but I won't guess your name or other personal details."],
    ["I'm N.O.R.I., Will's one continuous local desktop intelligence.",
      "I'm N.O.R.I., one continuous local desktop intelligence."],
  ],
  'bridge/response-profiles.mjs': [
    ['expand when Will asks.', 'expand when asked.'],
  ],
  'bridge/nori-v2-query.mjs': [
    ["role === 'user' ? 'Will' : 'N.O.R.I.'", "role === 'user' ? 'User' : 'N.O.R.I.'"],
    ["[Will's follow-up]", "[User's follow-up]"],
    ['Do not make Will', 'Do not make the user'],
  ],
  'bridge/local-chat.mjs': [
    ["You are Nori, Will's warm, direct feminine desktop intelligence; never a butler and never call him Commander or sir.",
      "You are Nori, a warm, direct feminine desktop intelligence; never a butler. Do not assume the user's name, gender, or title; use a name only when confirmed in the active profile. Never address the user as Commander or sir."],
    ['A direct action remains an action even when Will phrases it politely.',
      'A direct action remains an action even when the user phrases it politely.'],
  ],
  'bridge/server.mjs': [
    ['- You are talking with Will. Call him Will when a name is natural. Never call',
      '- Do not assume the user\'s name, gender, or title. Use a name only when'],
    ['  him Commander, sir, owner, or any other title. "Commander" is an internal',
      '  the active profile confirms it. Never address the user as Commander or sir.'],
    ["  Council role, not Will's name.", '  Do not invent a name.'],
    ["  Will's energy; become focused for technical work without becoming robotic.",
      "  the user's energy; become focused for technical work without becoming robotic."],
    ["  and casual shorthand as Will's intended meaning. Resolve the most likely",
      "  and casual shorthand as the user's intended meaning. Resolve the most likely"],
    ['  meaning from the active conversation and act on it; do not make him repeat',
      '  meaning from the active conversation and act on it; do not make the user repeat'],
    ['  If Will asked for an image and then says "make it blue" or "make me a WRX",',
      '  If the user asked for an image and then says "make it blue" or "make me a WRX",'],
    ['  he is still talking about that image.', '  they are still talking about that image.'],
  ],
}

mkdirSync(output)
const extracted = join(output, 'archive-source')
extractAll(archive, extracted)
const originalTree = treeHashes(extracted)
const changedFiles = []
for (const [relative, replacements] of Object.entries(changes)) {
  const path = join(extracted, relative)
  let content = readFileSync(path, 'utf8')
  const original = content
  for (const [before, after] of replacements) {
    const count = content.split(before).length - 1
    if (count !== 1) throw new Error(`Expected one exact identity string in ${relative}, found ${count}`)
    content = content.replace(before, after)
  }
  writeFileSync(path, content)
  if (readFileSync(path, 'utf8') === original) throw new Error(`Identity patch did not change ${relative}`)
  changedFiles.push(relative)
}
const updatedTree = treeHashes(extracted)
const treeDeltas = []
for (const path of new Set([...originalTree.keys(), ...updatedTree.keys()])) {
  if (originalTree.get(path) !== updatedTree.get(path)) treeDeltas.push(path.replaceAll('\\', '/'))
}
if (treeDeltas.length !== changedFiles.length || changedFiles.some(path => !treeDeltas.includes(path))) {
  throw new Error(`Unexpected extracted-file delta: ${JSON.stringify(treeDeltas)}`)
}
await createPackage(extracted, stagedArchive)

const beforeNames = listPackage(archive)
const afterNames = listPackage(stagedArchive)
if (beforeNames.length !== afterNames.length) throw new Error('Repacked archive file inventory changed')
for (const name of Object.keys(changes)) {
  const after = extractFile(stagedArchive, name)
  const expected = readFileSync(join(extracted, name))
  if (!after.equals(expected)) throw new Error(`Repacked identity file mismatch: ${name}`)
}

const receipt = {
  schema: 'nori.installed-identity-update.v1',
  createdAt: new Date().toISOString(),
  installedArchive: archive,
  installedArchiveSha256: hash(readFileSync(archive)),
  stagedArchive: stagedArchive,
  stagedArchiveSha256: hash(readFileSync(stagedArchive)),
  stagedArchiveBytes: readFileSync(stagedArchive).length,
  changedFiles,
  originalArchivePreserved: true,
  installed: false,
  liveTested: false,
  modelsCopied: 0,
  userDataChanged: false,
}
writeFileSync(join(output, 'update-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ prepared: true, ...receipt }, null, 2))
