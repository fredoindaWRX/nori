import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Only source code is read from disk; all memory/token/network operations are fixtures.
const ROOT = fileURLToPath(new URL('../../bridge/', import.meta.url))
const FILE = 'C:\\fixture\\memory.json'
function evaluate(code, globals, names, label) {
  const source = code.replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^export\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^export\s+/gm, '').replaceAll('import.meta.url', JSON.stringify('file:///C:/fixture/module.mjs'))
  const context = vm.createContext({ Buffer, AbortController, AbortSignal, TextDecoder, URL,
    setTimeout, clearTimeout, setImmediate, queueMicrotask, ...globals })
  vm.runInContext(source + '\nthis.result = {' + names.join(',') + '}', context, { filename: label })
  return context.result
}
const personal = evaluate(readFileSync(ROOT + '/personal-name.mjs', 'utf8'), {}, ['nameDeclaration', 'savedNameAnswer'], 'installed-personal-name.mjs')

export function memoryFixture({ version = 'source', disk = new Map(), failWrite = false, failRename = false } = {}) {
  const state = { failWrite, failRename, writes: 0, commits: 0, warnings: [] }
  const code = readFileSync(ROOT + '/nori-learning.mjs', 'utf8')
  const check = file => { if (file !== FILE && !file.startsWith(FILE + '.')) throw Error('Virtual filesystem escape') }
  const api = evaluate(code, { ...personal, dirname, createHash, randomUUID,
    process: { pid: version === 'installed' ? 101 : 102 }, bridgeLearningPath: () => FILE,
    console: { warn: (...args) => state.warnings.push(args.map(String).join(' ')) },
    readFileSync(file) { check(file); if (!disk.has(file)) throw Object.assign(Error('Not found'), { code: 'ENOENT' }); return disk.get(file) },
    mkdirSync(directory) { if (directory !== dirname(FILE)) throw Error('Virtual directory escape') },
    writeFileSync(file, text) { check(file); if (state.failWrite) throw Error('Synthetic disk write failure'); state.writes++; disk.set(file, text) },
    renameSync(from, to) { check(from); check(to); if (state.failRename) throw Error('Synthetic atomic commit failure'); if (!disk.has(from)) throw Error('Missing temp file'); disk.set(to, disk.get(from)); disk.delete(from); state.commits++ },
  }, ['learnFromUserText', 'learnedContext', 'listLearnedMemory', 'editLearnedMemory', 'deleteLearnedMemory'], version + '-nori-learning.mjs')
  return { api, disk, state, file: FILE, restart: () => memoryFixture({ version, disk }) }
}

export function queryFixture({ version = 'source', memory, contextHook = async () => '', active = () => true, globals: extraGlobals = {} } = {}) {
  const updates = [], experiences = []
  const no = () => false, nil = () => null
  const unexpected = name => () => { throw Error('Unexpected fixture dependency: ' + name) }
  const globals = { ...memory.api, ...personal, randomUUID, dirname, resolve, fileURLToPath,
    process: { env: { NORI_LOCAL_CHAT: '1', NORI_INFERENCE_RUNTIME: 'gpt-oss' } },
    readFileSync: unexpected('private token read'), fetch: unexpected('network request'),
    localEndpoint: (_name, value, fallback) => value || fallback,
    NORI_IDENTITY: { id: 'nori' }, NEURAL_EVENT_SCHEMA: 'fixture.neural-event',
    readStreamDjContext: contextHook, readLiveStreamContext: async () => '', instructionSkillContext: () => '',
    startStreamDj: async () => null, applyNoriUiCommand: nil, needsCouncil: no,
    recordExperience: (_root, entry) => experiences.push(entry), requestsLearningReport: no, requestsTv: no,
    imagesOf: () => [], imageFramesOf: () => [], resolveImageRequest: nil,
    neuralOriginOf: () => ({ turnId: 'fixture-turn' }),
    recoverNeuraleseIntent: (_frame, goal) => ({ goal }), attachNeuralOrigin: event => event,
    requestsInstalledSkillCatalog: no, requestsInstructionSkillInstall: no, requestsInstructionSkillAuthoring: no,
    locationControl: nil, isLocationQuestion: no, command: nil, capabilityRequest: nil,
    nativeRuntimeMode: () => 'gpt-oss', resolveAiderCodingRequest: () => '',
    reviewedReadRequest: nil, nativeResearchRequest: nil, semanticMemorySearchIntent: nil,
    requestsResearch: no, isAiderCodeRequest: no, requestsNoriRea: no, resolveNoriReaIntent: value => value,
    requestsNoriLocalAppBuild: no, isVideoRequest: no, requestsNoriArtCraftOperation: no,
    observeLocalMemoryContext: read => read(), ...extraGlobals,
  }
  // Optional code-only candidate seam. Default always reads authoritative Source;
  // version changes fixture labels/PID only, never selects installed app state.
  const code = readFileSync(process.env.NORI_MEMORY_QUERY_TEST_SOURCE || ROOT + '/nori-v2-query.mjs', 'utf8')
  const { query } = evaluate(code, globals, ['query'], version + '-nori-v2-query.mjs')
  return { updates, experiences, create(text, options = {}) {
    async function* prompt() { for (const content of Array.isArray(text) ? text : [text]) yield { message: { content } } }
    return query({ prompt: prompt(), options: { isRequestActive: active,
      getModel: unexpected('model inference'), onConversationUpdate: turns => updates.push(turns), ...options } })
  } }
}

export async function firstDelta(stream) {
  for (;;) { const next = await stream.next(); if (next.done) throw Error('No text delta'); if (next.value.type === 'stream_event') return next.value }
}
