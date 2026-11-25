import { callThroughNeuralese } from './neuralese-project-tools.mjs'
import { encodeNeuraleseAppSpec, verifyNeuraleseAppSpec } from './neuralese-app-spec.mjs'
import { createLocalAppDraftStore } from './local-app-store.mjs'
import { correctIntentTypos } from './intent-typos.mjs'

const MAX_SPEC_CHARS = 180_000

export const NORI_LOCAL_APP_GENERATION_POLICY = `For this request only, output exactly one raw JSON object and nothing else: a Nori app proposal with keys spec_id,title,description,source:{goal_cell},data_schema,views,workflows,capabilities,unknown_fields,translation_losses. source.goal_cell must reproduce the user's request exactly. Each collection is {id,name,fields}; each field is {id,name,type,required,options,default}, with type one of string,integer,number,boolean,date,enum; options is null except enum, where it is a nonempty string list. Each view is {id,name,type,collection_id,fields}, with type table,form,board,dashboard. Each workflow is {id,name,trigger,collection_id,steps}; each step is {id,action,depends_on}, and actions may only be local_data.read, local_data.create, local_data.update, local_data.delete, nori.assistant.query. capabilities may only contain those same strings, and list only what the user asked for. If any requirement cannot be mapped exactly, preserve its JSON-pointer source location in unknown_fields or translation_losses with {source_pointer,target_pointer,status,reason}; statuses are exact,normalized,unmapped,ambiguous,rejected. Never invent shell commands, code, network access, install steps, credentials, or external actions. Do not include an execution_authorized field. The host validates and hashes this proposal into Neuralese; unsupported requirements stay incomplete.`

export const NORI_LOCAL_APP_TOOL = Object.freeze({
  type: 'function',
  function: Object.freeze({
    name: 'propose_local_app',
    description: 'Validate a Nori-owned local app proposal in Neuralese. May save a pending JSON draft inside Nori; never writes or executes generated code, installs packages, uses the network, or grants action authority. Preserve unsupported requirements as losses.',
    parameters: Object.freeze({
      type: 'object', additionalProperties: false,
      properties: Object.freeze({
        spec_json: Object.freeze({ type: 'string', maxLength: MAX_SPEC_CHARS,
          description: 'JSON proposal with spec_id,title,description,data_schema,views,workflows,capabilities,unknown_fields,translation_losses. Nori fills source.goal_cell from the request herself. Use only supported Neuralese schema fields; no code.' }),
      }),
      required: Object.freeze(['spec_json']),
    }),
  }),
})

// Flat outline variant for small local models; the host builds the spec.
export const NORI_LOCAL_APP_OUTLINE_TOOL = Object.freeze({
  type: 'function',
  function: Object.freeze({
    name: 'propose_local_app',
    description: 'Validate a Nori-owned local app proposal in Neuralese. May save a pending JSON draft inside Nori; never writes or executes generated code, installs packages, uses the network, or grants action authority. Preserve unsupported requirements as losses.',
    parameters: Object.freeze({
      type: 'object', additionalProperties: false,
      properties: Object.freeze({
        title: Object.freeze({ type: 'string', maxLength: 120, description: 'App name.' }),
        description: Object.freeze({ type: 'string', maxLength: 2000, description: 'What the app is for, in one or two sentences.' }),
        collections: Object.freeze({ type: 'array', maxItems: 12,
          description: 'The kinds of records the app keeps, e.g. Servers, Channels, Messages. Nori builds a list and a form for each.',
          items: Object.freeze({ type: 'object', additionalProperties: false, required: Object.freeze(['name', 'fields']),
            properties: Object.freeze({
              name: Object.freeze({ type: 'string', maxLength: 100 }),
              fields: Object.freeze({ type: 'array', maxItems: 24, items: Object.freeze({
                type: 'object', additionalProperties: false, required: Object.freeze(['name', 'type']),
                properties: Object.freeze({
                  name: Object.freeze({ type: 'string', maxLength: 80 }),
                  type: Object.freeze({ type: 'string', enum: Object.freeze(['text', 'number', 'yes_no', 'date', 'choice']) }),
                  choices: Object.freeze({ type: 'array', maxItems: 64, items: Object.freeze({ type: 'string', maxLength: 120 }) }),
                }),
              }) }),
            }),
          }),
        }),
        unsupported_features: Object.freeze({ type: 'array', maxItems: 24, items: Object.freeze({ type: 'string', maxLength: 200 }),
          description: 'Requested features a local record app cannot do (e.g. voice calls, real-time sync, accounts). Listed honestly in the draft.' }),
      }),
      required: Object.freeze(['title', 'description', 'collections']),
    }),
  }),
})

const OUTLINE_FIELD_TYPES = Object.freeze({ text: 'string', number: 'number', yes_no: 'boolean', date: 'date', choice: 'enum' })

/** Small local models cannot reliably emit the nested Neuralese spec, so the
 * tool takes a flat outline and the host builds the spec deterministically:
 * one table and one form per collection, local record CRUD only, and every
 * requested feature outside that scope preserved as an unmapped loss. */
function slugId(value, used, fallback) {
  let id = String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56)
  if (!/^[a-z]/.test(id)) id = `${fallback}${id ? `_${id}` : ''}`.slice(0, 56)
  let candidate = id
  for (let n = 2; used.has(candidate); n++) candidate = `${id}_${n}`
  used.add(candidate)
  return candidate
}

function outlineText(value, label, max) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`The app outline needs a ${label}.`)
  return value.trim().slice(0, max)
}

export function proposalFromOutline(outline) {
  if (!outline || typeof outline !== 'object' || Array.isArray(outline)) throw new TypeError('The app outline must be an object.')
  const title = outlineText(outline.title, 'title', 120)
  const description = outlineText(outline.description, 'description', 2000)
  const collections = Array.isArray(outline.collections) ? outline.collections.slice(0, 12) : []
  if (!collections.length) throw new TypeError('The app outline needs at least one collection.')
  const collectionIds = new Set()
  const dataSchema = collections.map((collection, index) => {
    const name = outlineText(collection?.name, `collection ${index + 1} name`, 100)
    const fieldIds = new Set()
    const sourceFields = Array.isArray(collection?.fields) && collection.fields.length ? collection.fields.slice(0, 24) : [{ name: 'Name', type: 'text' }]
    const fields = sourceFields.map((field, fieldIndex) => {
      const spec = typeof field === 'string' ? { name: field, type: 'text' } : field
      const fieldName = outlineText(spec?.name, `field ${fieldIndex + 1} name`, 80)
      const choices = Array.isArray(spec?.choices)
        ? [...new Set(spec.choices.filter(choice => typeof choice === 'string' && choice.trim()).map(choice => choice.trim().slice(0, 120)))].slice(0, 64)
        : []
      let type = Object.hasOwn(OUTLINE_FIELD_TYPES, String(spec?.type)) ? OUTLINE_FIELD_TYPES[spec.type] : 'string'
      if (type === 'enum' && !choices.length) type = 'string'
      return { id: slugId(fieldName, fieldIds, 'field'), name: fieldName, type, required: fieldIndex === 0,
        options: type === 'enum' ? choices : null, default: null }
    })
    return { id: slugId(name, collectionIds, 'collection'), name, fields }
  })
  const viewIds = new Set()
  const views = dataSchema.flatMap(collection => ['table', 'form'].map(type => ({
    id: slugId(`${collection.id}_${type}`, viewIds, 'view'), name: `${collection.name} ${type === 'table' ? 'list' : 'form'}`,
    type, collection_id: collection.id, fields: collection.fields.map(field => field.id),
  })))
  // Keep each feature's index in the original list so its pointer stays exact.
  const features = Array.isArray(outline.unsupported_features)
    ? outline.unsupported_features.map((feature, index) => [feature, index]).filter(([feature]) => typeof feature === 'string' && feature.trim()).slice(0, 24) : []
  return {
    spec_id: slugId(title, new Set(), 'app'), title, description,
    data_schema: dataSchema, views, workflows: [],
    capabilities: ['local_data.read', 'local_data.create', 'local_data.update', 'local_data.delete'],
    unknown_fields: [],
    translation_losses: features.map(([feature, index]) => ({
      source_pointer: `/unsupported_features/${index}`, target_pointer: null, status: 'unmapped',
      reason: `Nori local apps store and edit records only; not supported: ${feature.trim()}`.slice(0, 500),
    })),
  }
}

export function requestsNoriLocalAppBuild(goal) {
  // Quoted examples, code and paths are data, not app-creation instructions.
  const unquoted = String(goal ?? '').replace(/```[\s\S]*?(?:```|(?![\s\S]))|`[^`\r\n]*(?:`|$)|"[^"\r\n]*(?:"|$)|“[^”\r\n]*(?:”|$)|‘[^’\r\n]*(?:’|$)|(?<![\p{L}\p{N}_])'[^'\r\n]*(?:'|$)|^\s*>.*$/gmu, ' ')
  const text = correctIntentTypos(unquoted).replace(/[’‘]/g, "'")
  // A prohibition in one sentence must not activate the app builder when
  // the user positively requested an unrelated capability such as REA.
  const affirmativeText = text.split(/[.!?;\n]+|\b(?:but|however)\b|(?=\b(?:do\s+not|don't|dont|never|avoid|stop|cancel|no|not\s+to)\b)/i)
    .filter(clause => !/^\s*(?:do\s+not|don't|dont|never|avoid|stop|cancel|no|not\s+to)\b/i.test(clause))
    .join(' ')
  return /\b(?:build|create|make|design|generate)\s+(?:me\s+|us\s+)?(?:an?|new|my\s+own|our\s+own)\s+(?:[\w-]+\s+){0,4}(?:local\s+)?(?:app|application|dashboard)\b|\b(?:app|application)\s+builder\b/i.test(affirmativeText)
    || /\bengineer\s+(?:me\s+)?(?:an?|new|my\s+own)\s+(?:[\w-]+\s+){0,3}(?:app|application)\b/i.test(affirmativeText)
    || /\b(?:app|application)\b.{0,80}\b(?:call|name)\s+it\b|\b(?:call|name)\s+it\b.{0,40}\b(?:app|application)\b/i.test(affirmativeText)
}

/** A bounded capability surface that may persist a verified JSON proposal in
 * Nori's draft store; arbitrary file creation and app execution are absent. */
export function createNoriAppProposalTools(goal, { noriRoot = null, outline = false } = {}) {
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 20_000) throw new TypeError('A bounded user app request is required.')
  return Object.freeze({
    appProposal: true,
    definitions: Object.freeze([outline ? NORI_LOCAL_APP_OUTLINE_TOOL : NORI_LOCAL_APP_TOOL]),
    async call(name, args) {
      if (name !== 'propose_local_app' || !args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Invalid local app proposal tool call.')
      const keys = Object.keys(args)
      const fullSpec = !outline
      if (fullSpec ? keys.length !== 1 || typeof args.spec_json !== 'string' || args.spec_json.length > MAX_SPEC_CHARS
        : keys.some(key => !['title', 'description', 'collections', 'unsupported_features'].includes(key))
          || JSON.stringify(args).length > MAX_SPEC_CHARS) throw new TypeError('Invalid local app proposal tool call.')
      const proposal = fullSpec ? JSON.parse(args.spec_json) : proposalFromOutline(args)
      if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new TypeError('The app proposal must be a JSON object.')
      // The model cannot see the exact request text Nori holds, so the host
      // writes the binding itself; a proposal can never name another goal.
      proposal.source = { goal_cell: goal }
      const frame = encodeNeuraleseAppSpec(proposal)
      const validation = verifyNeuraleseAppSpec(frame, { expectedGoal: goal })
      const draftPath = noriRoot ? createLocalAppDraftStore(noriRoot).save(frame, validation) : null
      return JSON.stringify({ receipt: { spec_id: frame.spec_id, frame_sha256: frame.frame_sha256 },
        status: validation.status, findings: validation.findings,
        left_out: frame.translation_losses.filter(loss => loss.source_pointer.startsWith('/unsupported_features/'))
          .map(loss => loss.reason.replace(/^Nori local apps store and edit records only; not supported: /, '')).slice(0, 24),
        execution_authorized: false, materialized: false,
        draft_id: draftPath ? frame.frame_sha256 : null,
        note: draftPath ? 'Saved as a pending local draft; no app/code/actions executed.'
          : 'Proposal only; no app/code/actions executed.' })
    },
  })
}

/** Validate the tool call and round-trip its untrusted result through the same
 * Neuralese task/result integrity boundary used by Nori project tools. */
export async function callNeuraleseAppProposal(tools, name, args, options, callId, requestIntent) {
  if (name !== 'propose_local_app') throw new Error('Unregistered Nori app-builder action.')
  return callThroughNeuralese(tools, name, args, { ...options, enforceRequestedPath: false }, callId, requestIntent)
}

/** Accept plain model JSON only after the same Neuralese validation and host
 * draft-store path used by the GPT-OSS native function-call route. */
export async function acceptNoriLocalAppGeneration({ goal, output, noriRoot, callId }) {
  if (typeof output !== 'string' || !output.trim() || output.length > MAX_SPEC_CHARS) {
    throw new TypeError('Nori app generator returned an empty or oversized response; no draft was saved.')
  }
  let proposal
  try { proposal = JSON.parse(output) }
  catch { throw new TypeError('Nori app generator did not return strict JSON; no draft was saved.') }
  const tools = createNoriAppProposalTools(goal, { noriRoot })
  const result = await callNeuraleseAppProposal(tools, 'propose_local_app',
    { spec_json: JSON.stringify(proposal) }, { maxBytes: 8192 }, callId, goal)
  const decoded = JSON.parse(result)
  if (decoded?.executed === false) throw new Error(String(decoded.error || 'Neuralese app proposal was rejected.'))
  if (!decoded || typeof decoded.draft_id !== 'string' || !/^[a-f0-9]{64}$/.test(decoded.draft_id)
    || typeof decoded.status !== 'string' || decoded.execution_authorized !== false) {
    throw new Error('Neuralese did not return a verified, persisted local app draft.')
  }
  return decoded
}
