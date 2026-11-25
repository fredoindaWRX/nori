const { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, writeFileSync, writeSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { join, resolve } = require('node:path')

const MAX_BYTES = 300 * 1024
const MAX_RECORD_BYTES = 16 * 1024
const MAX_RECORDS = 2000
const SHA = /^[a-f0-9]{64}$/

function verifyPath(path, kind) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)
    || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error('Nori app draft path is not a plain local filesystem entry.')
  }
  const actual = realpathSync(path)
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
  if (normalize(actual) !== normalize(path)) throw new Error('Nori app draft path resolves outside its declared location.')
  return stat
}

function createWorkspaceAppDrafts({ root, owns, loadVerifier }) {
  if (typeof root !== 'string' || !root || typeof owns !== 'function' || typeof loadVerifier !== 'function') {
    throw new TypeError('A Nori root, owner check, and app-spec verifier loader are required.')
  }
  const noriRoot = resolve(root)
  verifyPath(noriRoot, 'directory')
  const draftsRoot = resolve(noriRoot, 'workspace', 'generated-apps', 'drafts')
  const relative = require('node:path').relative(noriRoot, draftsRoot)
  if (relative.startsWith('..') || require('node:path').isAbsolute(relative)) throw new Error('App draft directory escaped Nori.')
  const registry = new Map()

  function checkedDraftDirectory() {
    return checkedDirectory(['workspace', 'generated-apps', 'drafts'])
  }

  function checkedDirectory(parts, create = false) {
    let current = noriRoot
    for (const part of parts) {
      current = join(current, part)
      let stat
      try { stat = lstatSync(current) }
      catch (error) {
        if (error?.code !== 'ENOENT' || !create) { if (error?.code === 'ENOENT') return null; throw error }
        try { mkdirSync(current) } catch (mkdirError) { if (mkdirError?.code !== 'EEXIST') throw mkdirError }
        stat = lstatSync(current)
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Nori app draft storage contains a non-directory or reparse point.')
      verifyPath(current, 'directory')
    }
    return current
  }

  async function listEntries() {
    const checked = checkedDraftDirectory()
    registry.clear()
    if (!checked) return []
    const allNames = readdirSync(checked)
    const names = allNames.filter(name => /^draft-[a-f0-9]{64}\.json$/.test(name)).sort().slice(0, 128)
    const entries = []
    const module = await loadVerifier()
    if (typeof module?.verifyNeuraleseAppSpec !== 'function') throw new Error('Neuralese app validation is unavailable.')
    for (const name of names) {
      const path = join(checked, name)
      const stat = verifyPath(path, 'file')
      if (stat.size > MAX_BYTES) continue
      let record
      try { record = JSON.parse(readFileSync(path, 'utf8')) } catch { continue }
      const id = name.slice(6, -5)
      if (record?.schema !== 'nori.local-app-draft.v1' || record?.status !== 'pending_review'
        || record?.frame?.frame_sha256 !== id || record?.validation?.frame_sha256 !== id
        || record.execution_authorized !== false || record.external_effects !== false) continue
      let validation
      try { validation = module.verifyNeuraleseAppSpec(record.frame, { expectedGoal: record.frame?.source?.goal_cell }) }
      catch { continue }
      if (validation.frame_sha256 !== id || JSON.stringify(validation) !== JSON.stringify(record.validation)) continue
      registry.set(id, path)
      entries.push({ id, title: String(record.frame.title || 'Untitled app').slice(0, 120),
        description: String(record.frame.description || '').slice(0, 240), status: 'PENDING REVIEW' })
    }
    return entries
  }

  async function read(event, args) {
    if (!owns(event)) return null
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).length !== 1 || typeof args.id !== 'string' || !SHA.test(args.id)) {
      throw new Error('A valid Neuralese app draft identifier is required.')
    }
    await listEntries()
    const path = registry.get(args.id)
    if (!path) return null
    const stat = verifyPath(path, 'file')
    if (stat.size > MAX_BYTES) throw new Error('Nori app draft exceeds its safe read limit.')
    const record = JSON.parse(readFileSync(path, 'utf8'))
    const module = await loadVerifier()
    if (typeof module?.verifyNeuraleseAppSpec !== 'function') throw new Error('Neuralese app validation is unavailable.')
    const validation = module.verifyNeuraleseAppSpec(record.frame, { expectedGoal: record.frame?.source?.goal_cell })
    if (validation.frame_sha256 !== args.id || record.validation?.frame_sha256 !== args.id) {
      throw new Error('Nori app draft integrity check failed.')
    }
    return { id: args.id, status: record.status, frame: record.frame, validation,
      execution_authorized: false, external_effects: false }
  }

  async function listActive() {
    const checked = checkedDirectory(['workspace', 'generated-apps', 'apps'])
    appRegistry.clear()
    if (!checked) return []
    const names = readdirSync(checked).filter(name => /^app-[a-f0-9]{64}\.json$/.test(name)).sort().slice(0, 128)
    const rows = []
    const module = await loadVerifier()
    for (const name of names) {
      const path = join(checked, name)
      const stat = verifyPath(path, 'file')
      if (stat.size > MAX_BYTES) continue
      let app
      try { app = JSON.parse(readFileSync(path, 'utf8')) } catch { continue }
      const id = name.slice(4, -5)
      if (app?.schema !== 'nori.local-app.v1' || app?.status !== 'active' || app?.id !== id
        || app?.frame?.frame_sha256 !== id || app.execution_authorized !== false || app.external_effects !== false) continue
      let validation
      try { validation = module.verifyNeuraleseAppSpec(app.frame, { expectedGoal: app.frame?.source?.goal_cell }) }
      catch { continue }
      if (validation.status !== 'ready_for_local_preview' || validation.frame_sha256 !== id) continue
      appRegistry.set(id, path)
      rows.push({ id, title: String(app.frame.title || 'Untitled app').slice(0, 120),
        description: String(app.frame.description || '').slice(0, 240), status: 'ACTIVE LOCAL APP' })
    }
    return rows
  }

  const appRegistry = new Map()

  async function activate(event, args) {
    if (!owns(event)) return null
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).sort().join(',') !== 'approved,id' || args.approved !== true
      || typeof args.id !== 'string' || !SHA.test(args.id)) throw new Error('Explicit approval of a valid Neuralese app draft is required.')
    const draft = await read(event, { id: args.id })
    if (!draft || draft.validation.status !== 'ready_for_local_preview') throw new Error('Only a complete, verified local app draft can be activated.')
    const directory = checkedDirectory(['workspace', 'generated-apps', 'apps'], true)
    const path = join(directory, `app-${args.id}.json`)
    const record = { schema: 'nori.local-app.v1', id: args.id, status: 'active', frame: draft.frame,
      activated_at: new Date().toISOString(), execution_authorized: false, external_effects: false }
    const content = `${JSON.stringify(record, null, 2)}\n`
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) throw new RangeError('Activated local app manifest exceeds its size limit.')
    let fd
    try {
      fd = openSync(path, 'wx', 0o600)
      writeFileSync(fd, content, 'utf8')
      require('node:fs').fsyncSync(fd)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const existingStat = verifyPath(path, 'file')
      if (existingStat.size > MAX_BYTES) throw new Error('Existing app manifest exceeds the safe size limit.')
      const existing = JSON.parse(readFileSync(path, 'utf8'))
      if (existing?.schema !== record.schema || existing?.id !== args.id
        || existing?.status !== 'active'
        || JSON.stringify(existing.frame) !== JSON.stringify(record.frame)
        || existing.execution_authorized !== false || existing.external_effects !== false) {
        throw new Error('Existing local app manifest does not match the approved draft.')
      }
    } finally { if (fd !== undefined) closeSync(fd) }
    verifyPath(path, 'file')
    return { id: args.id, status: 'ACTIVE LOCAL APP', path: `workspace/generated-apps/apps/app-${args.id}.json`,
      execution_authorized: false, external_effects: false }
  }

  async function readApp(event, args) {
    if (!owns(event)) return null
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).length !== 1 || typeof args.id !== 'string' || !SHA.test(args.id)) {
      throw new Error('A valid local app identifier is required.')
    }
    await listActive()
    const path = appRegistry.get(args.id)
    if (!path) return null
    const stat = verifyPath(path, 'file')
    if (stat.size > MAX_BYTES) throw new Error('Local app manifest exceeds its safe read limit.')
    const app = JSON.parse(readFileSync(path, 'utf8'))
    return { id: args.id, status: app.status, frame: app.frame,
      execution_authorized: false, external_effects: false }
  }

  function validValue(field, value) {
    if (field.type === 'string') return typeof value === 'string' && value.length <= 4000
    if (field.type === 'date') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const date = new Date(`${value}T00:00:00.000Z`)
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    }
    if (field.type === 'integer') return Number.isSafeInteger(value)
    if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value)
    if (field.type === 'boolean') return typeof value === 'boolean'
    if (field.type === 'enum') return typeof value === 'string' && field.options.includes(value)
    return false
  }

  function normalizedRecord(collection, values) {
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.getPrototypeOf(values) !== Object.prototype) {
      throw new Error('Local app record must be a plain object.')
    }
    const fields = collection.fields
    const ids = new Set(fields.map(field => field.id))
    if (Object.keys(values).some(key => !ids.has(key))) throw new Error('Local app record contains an undeclared field.')
    const result = {}
    for (const field of fields) {
      if (Object.hasOwn(values, field.id)) result[field.id] = values[field.id]
      else if (field.default !== null) result[field.id] = field.default
      else if (field.required) throw new Error(`Required local app field is missing: ${field.name}.`)
      else continue
      if (!validValue(field, result[field.id])) throw new Error(`Local app field has an invalid value: ${field.name}.`)
    }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RECORD_BYTES) throw new RangeError('Local app record exceeds its size limit.')
    return result
  }

  async function getActiveCollection(event, args, capability) {
    if (!owns(event)) return null
    const app = await readApp(event, { id: args.app_id })
    if (!app) return null
    if (!app.frame.capabilities.includes(capability)) throw new Error(`This local app has not declared ${capability}.`)
    if (typeof args.collection_id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(args.collection_id)) {
      throw new Error('A declared local app collection identifier is required.')
    }
    const collection = app.frame.data_schema.find(item => item.id === args.collection_id)
    if (!collection) throw new Error('The local app collection is not part of this approved specification.')
    return { app, collection }
  }

  function readRecordLog(appId, collectionId, collection) {
    const directory = checkedDirectory(['workspace', 'generated-apps', 'app-data', appId, collectionId])
    if (!directory) return []
    const file = join(directory, 'records.jsonl')
    let stat
    try { stat = verifyPath(file, 'file') }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    if (stat.size > MAX_RECORD_BYTES * MAX_RECORDS) throw new Error('Local app record store exceeds its bounded limit.')
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n').filter(Boolean)
    if (lines.length > MAX_RECORDS) throw new Error('Local app record count exceeds its limit.')
    const records = new Map()
    for (const line of lines) {
      if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) throw new Error('Local app record log contains an oversized entry.')
      let item
      try { item = JSON.parse(line) } catch { throw new Error('Local app record log is malformed.') }
      if (!item || !['create', 'update', 'delete'].includes(item.op)
        || typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/.test(item.id)) throw new Error('Local app record log contains an invalid event.')
      if (item.op === 'delete') records.delete(item.id)
      else records.set(item.id, { id: item.id, values: normalizedRecord(collection, item.values), updated_at: item.updated_at })
    }
    return [...records.values()]
  }

  function appendRecordEvent(appId, collectionId, event) {
    const directory = checkedDirectory(['workspace', 'generated-apps', 'app-data', appId, collectionId], true)
    const file = join(directory, 'records.jsonl')
    let before
    try { before = verifyPath(file, 'file') }
    catch (error) { if (error?.code !== 'ENOENT') throw error }
    if (before?.size >= MAX_RECORD_BYTES * MAX_RECORDS) throw new Error('Local app record store is full.')
    let fd
    try {
      fd = openSync(file, 'a', 0o600)
      const opened = fstatSync(fd)
      const current = verifyPath(file, 'file')
      if (opened.dev !== current.dev || opened.ino !== current.ino || opened.nlink !== 1) throw new Error('Local app record file changed during validation.')
      const line = `${JSON.stringify(event)}\n`
      if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES || opened.size + Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES * MAX_RECORDS) {
        throw new RangeError('Local app record store size limit reached.')
      }
      writeSync(fd, line, null, 'utf8')
      require('node:fs').fsyncSync(fd)
    } finally { if (fd !== undefined) closeSync(fd) }
    verifyPath(file, 'file')
  }

  async function records(event, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).sort().join(',') !== 'app_id,collection_id') throw new Error('Invalid local app record-list request.')
    const checked = await getActiveCollection(event, args, 'local_data.read')
    if (!checked) return null
    return { app_id: args.app_id, collection_id: args.collection_id,
      records: readRecordLog(args.app_id, args.collection_id, checked.collection), execution_authorized: false }
  }

  async function createRecord(event, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).sort().join(',') !== 'app_id,collection_id,values') throw new Error('Invalid local app record-create request.')
    const checked = await getActiveCollection(event, args, 'local_data.create')
    if (!checked) return null
    const rows = readRecordLog(args.app_id, args.collection_id, checked.collection)
    if (rows.length >= MAX_RECORDS) throw new Error('Local app record count exceeds its limit.')
    const values = normalizedRecord(checked.collection, args.values)
    const entry = { op: 'create', id: randomUUID(), values, updated_at: new Date().toISOString() }
    appendRecordEvent(args.app_id, args.collection_id, entry)
    return { id: entry.id, values, updated_at: entry.updated_at, execution_authorized: false }
  }

  async function updateRecord(event, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).sort().join(',') !== 'app_id,collection_id,record_id,values'
      || typeof args.record_id !== 'string' || !/^[0-9a-f-]{36}$/.test(args.record_id)) {
      throw new Error('Invalid local app record-update request.')
    }
    const checked = await getActiveCollection(event, args, 'local_data.update')
    if (!checked) return null
    const rows = readRecordLog(args.app_id, args.collection_id, checked.collection)
    if (!rows.some(row => row.id === args.record_id)) throw new Error('The local app record no longer exists.')
    const entry = { op: 'update', id: args.record_id, values: normalizedRecord(checked.collection, args.values), updated_at: new Date().toISOString() }
    appendRecordEvent(args.app_id, args.collection_id, entry)
    return { id: entry.id, values: entry.values, updated_at: entry.updated_at, execution_authorized: false }
  }

  async function deleteRecord(event, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).sort().join(',') !== 'app_id,collection_id,record_id'
      || typeof args.record_id !== 'string' || !/^[0-9a-f-]{36}$/.test(args.record_id)) {
      throw new Error('Invalid local app record-delete request.')
    }
    const checked = await getActiveCollection(event, args, 'local_data.delete')
    if (!checked) return null
    const rows = readRecordLog(args.app_id, args.collection_id, checked.collection)
    if (!rows.some(row => row.id === args.record_id)) throw new Error('The local app record no longer exists.')
    const entry = { op: 'delete', id: args.record_id, updated_at: new Date().toISOString() }
    appendRecordEvent(args.app_id, args.collection_id, entry)
    return { id: args.record_id, deleted: true, execution_authorized: false }
  }

  return Object.freeze({
    list: async event => {
      if (!owns(event)) return null
      const apps = await listActive()
      const activeIds = new Set(apps.map(app => app.id))
      const entries = (await listEntries()).filter(entry => !activeIds.has(entry.id))
      return { root: 'workspace/generated-apps', entries, apps, truncated: entries.length >= 128 || apps.length >= 128 }
    },
    read,
    activate,
    readApp,
    records,
    createRecord,
    updateRecord,
    deleteRecord,
  })
}

module.exports = { createWorkspaceAppDrafts }
