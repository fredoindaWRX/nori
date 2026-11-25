import test from 'node:test'
import assert from 'node:assert/strict'
import { listSystemTasks } from '../bridge/system-submit.mjs'

const environment = { NORI_API_TOKEN: 't'.repeat(32), NORI_COUNCIL_URL: 'http://127.0.0.1:9107' }
const status = ({ fullAccess = false } = {}) => ({
  enabled: true,
  full_access_available: true,
  full_access_enabled: fullAccess,
  confirmation_floor_active: fullAccess,
  per_task_confirmation_required: !fullAccess,
  full_access_backup: fullAccess
    ? { verified: true, file_count: 4, total_bytes: 256, path: 'C:\\Nori\\backups\\nori-data\\set-1' }
    : null,
  has_more: false,
  tasks: [{ task_id: 'a'.repeat(32), status: 'awaiting_approval', goal: 'Check exact local status',
    response: '', review: { attempt: 1 } }],
})

test('System task listing accepts only a consistent verified Full Access state', async () => {
  for (const fullAccess of [false, true]) {
    const result = await listSystemTasks({ environment,
      fetcher: async (url, options) => {
        assert.equal(url, 'http://127.0.0.1:9107/work/system')
        assert.equal(options.method, 'GET')
        return new Response(JSON.stringify(status({ fullAccess })), { status: 200 })
      } })
    assert.equal(result.full_access_enabled, fullAccess)
    assert.equal(result.per_task_confirmation_required, !fullAccess)
    assert.equal(result.confirmation_floor_active, fullAccess)
    assert.equal(result.tasks[0].task_id, 'a'.repeat(32))
  }
})

test('System task listing rejects missing, contradictory, or unverified access state', async () => {
  const cases = [
    ({ fullAccess: true, mutate: result => { result.confirmation_floor_active = false } }),
    ({ fullAccess: true, mutate: result => { result.per_task_confirmation_required = true } }),
    ({ fullAccess: true, mutate: result => { result.full_access_backup.verified = false } }),
    ({ fullAccess: false, mutate: result => { delete result.full_access_available } }),
  ]
  for (const item of cases) {
    const body = status({ fullAccess: item.fullAccess })
    item.mutate(body)
    await assert.rejects(listSystemTasks({ environment,
      fetcher: async () => new Response(JSON.stringify(body), { status: 200 }) }), /could not be verified/)
  }
})
