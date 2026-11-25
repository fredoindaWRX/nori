import { submitSystemCommand, readSystemTask, listSystemTasks } from './system-submit.mjs'
export function explicitSystemTaskRead(text) {
  const value = String(text).trim()
  const match = /^(?:please\s+)?(?:check|inspect|show)\s+(?:the\s+)?system neuron task\s+([a-f0-9]{32})\b/i.exec(value)
  if (!match || (value.match(/\b[a-f0-9]{32}\b/ig) || []).length !== 1) return null
  return match[1].toLowerCase()
}

export async function systemTaskReadAnswer(taskId, { signal } = {}) {
  const result = await readSystemTask({ task_id: taskId }, { signal })
  return [`System task ${result.task_id}: ${result.status} (attempt ${result.attempt}).`,
    `Exit code: ${result.exit_code ?? 'not available'}.`,
    result.output_captured ? 'Captured output:' : 'No complete captured output is available.',
    `stdout: ${JSON.stringify(result.stdout)}`, `stderr: ${JSON.stringify(result.stderr)}`,
    ...(result.output_truncated ? ['Output is truncated; this is not the full transcript.'] : []),
    'This reports the command receipt, not independent verification of the broader task.'].join('\n')
}

export function explicitSystemTaskList(text) {
  const value = String(text).trim()
  const resource = /\b(?:system\s+neuron|system\s+tasks?|system\s+activity)\b/i.test(value)
  const intent = /\b(?:list|show|check|inspect|status|activity|completed|pending|active|running|what|which)\b/i.test(value)
  const actionRequest = /\b(?:run|execute|launch|submit|approve|delete|remove|clear)\b/i.test(value)
  return resource && intent && !actionRequest
}

export async function systemTaskListAnswer({ signal, list = listSystemTasks } = {}) {
  const result = await list({ signal })
  if (!result.tasks.length) {
    return `System Neuron is ${result.enabled ? 'enabled' : 'disabled'}. No recent System tasks are listed.`
  }
  const rows = result.tasks.map(task => `- ${task.status}: ${task.goal} (task ${task.task_id})`)
  return [
    `System Neuron is ${result.enabled ? 'enabled' : 'disabled'}; each command still requires separate approval.`,
    'Recent System tasks:', ...rows,
    ...(result.has_more ? ['The list is limited to the 16 newest tasks; more are available in Activity.'] : []),
    'This is task metadata only; no commands were run or approved.',
  ].join('\n')
}

export function requestsSystemCommand(text) {
  return /\b(?:use|ask|have|with|check|inspect)\b.{0,50}\bsystem neuron\b/i.test(String(text))
    && !/\b(?:don't|do not|never)\b.{0,30}\b(?:use|run|system neuron)\b/i.test(String(text))
}
export function createSystemTools({ submit = submitSystemCommand, read = readSystemTask, list = listSystemTasks } = {}) {
  const attempts = new Map()
  return {
    systemWorker: true,
    definitions: [{ type: 'function', function: { name: 'list_system_tasks',
      description: 'List recent System Neuron task metadata, including status and task ID. Read-only; does not expose command output, approve, run or delete tasks.',
      parameters: { type: 'object', additionalProperties: false, properties: {} } } },
      { type: 'function', function: { name: 'submit_system_command',
      description: 'Propose one local Windows executable command for owner review. Does not execute or approve it.',
      parameters: { type: 'object', additionalProperties: false,
        required: ['executable', 'arguments', 'working_directory', 'effects', 'timeout_seconds'],
        properties: { executable: { type: 'string', description: 'Explicit absolute local .exe path, never guess.' },
          arguments: { type: 'array', items: { type: 'string' }, maxItems: 64 },
          working_directory: { type: 'string', description: 'Explicit absolute local working folder.' },
          effects: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 24 },
          timeout_seconds: { type: 'integer', minimum: 1, maximum: 3600 } } } } },
      { type: 'function', function: { name: 'read_system_task',
        description: 'Read current status and bounded output of an exact existing System task. Does not run, approve or retry anything.',
        parameters: { type: 'object', additionalProperties: false, required: ['task_id'],
          properties: { task_id: { type: 'string', pattern: '^[a-f0-9]{32}$' } } } } }],
    async call(name, args) {
      if (name === 'list_system_tasks') {
        if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw Error('list_system_tasks takes no arguments')
        return JSON.stringify(await list())
      }
      if (name === 'read_system_task') return JSON.stringify(await read(args))
      if (name !== 'submit_system_command') throw Error('Unknown System tool')
      const key = JSON.stringify(args)
      if (!attempts.has(key)) attempts.set(key, Promise.resolve().then(() => submit(JSON.parse(key))))
      return JSON.stringify(await attempts.get(key))
    },
  }
}
