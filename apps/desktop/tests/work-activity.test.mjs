import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkActivityClient } from '../bridge/work-activity.mjs'

const task = (id, goal, status) => ({
  task_id: id.repeat(32), goal, status,
  created_at: '2026-10-26T12:00:00.000Z',
  updated_at: '2026-10-26T12:01:00.000Z',
  response: 'local result', review: null, events: [],
})

function clientFor(tasks) {
  return createWorkActivityClient({
    environment: {
      NORI_API_TOKEN: 'x'.repeat(40),
      NORI_COUNCIL_URL: 'http://127.0.0.1:9107',
    },
    fetcher: async () => new Response(JSON.stringify({ tasks }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  })
}

test('hides only terminal System Neuron rows from the activity sidebar', async () => {
  const tasks = [
    task('1', 'System Neuron: inspect local status', 'completed'),
    task('2', 'System Neuron: list running services', 'failed'),
    task('3', 'System Neuron: inspect another service', 'running'),
    task('4', 'Implement calculator addition', 'completed'),
  ]

  const result = await clientFor(tasks)()

  assert.deepEqual(result.tasks.map(({ id, status }) => ({ id, status })), [
    { id: '3'.repeat(32), status: 'running' },
    { id: '4'.repeat(32), status: 'completed' },
  ])
})

test('still validates malformed tasks instead of hiding them', async () => {
  const result = clientFor([
    task('5', 'System Neuron: malformed state', 'not-a-real-state'),
  ])

  await assert.rejects(result(), /invalid_task_state/)
})
