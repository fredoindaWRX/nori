import test from 'node:test'
import assert from 'node:assert/strict'
import { readPersonalWriteAccess } from '../bridge/personal-file-access.mjs'

const environment = { NORI_API_TOKEN: 't'.repeat(32), NORI_COUNCIL_URL: 'http://127.0.0.1:9107' }
const verified = () => ({ enabled: true, full_access_available: true, full_access_enabled: true,
  confirmation_floor_active: true, per_task_confirmation_required: false,
  full_access_backup: { verified: true, file_count: 4, total_bytes: 256, path: 'C:\\Nori\\backups\\nori-data\\set-1' } })

test('personal-file write tools require verified Full Access and its backup receipt', async () => {
  let calls = 0
  const fetcher = async () => { calls++; return { ok: true, json: async () => verified() } }
  assert.equal(await readPersonalWriteAccess({ environment, fetcher }), true)
  assert.equal(calls, 1)
  for (const change of [
    { full_access_enabled: false },
    { confirmation_floor_active: false },
    { per_task_confirmation_required: true },
    { full_access_backup: { verified: false, file_count: 4, total_bytes: 256, path: 'C:\\backup' } },
    { full_access_backup: { verified: true, file_count: '4', total_bytes: 256, path: 'C:\\backup' } },
  ]) {
    const body = { ...verified(), ...change }
    assert.equal(await readPersonalWriteAccess({ environment,
      fetcher: async () => ({ ok: true, json: async () => body }) }), false)
  }
})

test('personal-file write tools fail closed when Core is unavailable or unauthenticated', async () => {
  assert.equal(await readPersonalWriteAccess({ environment: {}, fetcher: async () => { throw Error('must not fetch') } }), false)
  assert.equal(await readPersonalWriteAccess({ environment,
    fetcher: async () => ({ ok: false, json: async () => verified() }) }), false)
  assert.equal(await readPersonalWriteAccess({ environment,
    fetcher: async () => { throw Error('offline') } }), false)
})
