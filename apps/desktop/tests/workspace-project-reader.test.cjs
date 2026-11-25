const test = require('node:test')
const assert = require('node:assert/strict')
const { createWorkspaceProjectReader } = require('../desktop/workspace-project-reader.cjs')

test('spatial workspace project access is owner-bound and delegates only to registered read-only tools', async () => {
  const calls = []
  let loads = 0
  const reader = createWorkspaceProjectReader({
    root: 'C:\\Nori',
    owns: event => event?.owner === 'nori-main-frame',
    loadTools: async () => {
      loads++
      return { createNoriProjectTools: root => {
        assert.equal(root, 'C:\\Nori')
        return { call: async (name, args) => {
          calls.push([name, args])
          return JSON.stringify(name === 'list_dir'
            ? { path: args.path, entries: [{ name: 'docs', kind: 'directory' }], truncated: false }
            : { path: args.path, start_line: args.start_line, returned_lines: 1, content: 'Nori locally.', omitted: false })
        } }
      } }
    },
  })
  assert.equal(await reader.list({ owner: 'other-webContents' }, { path: '.' }), null)
  assert.deepEqual(calls, [])
  assert.deepEqual(await reader.list({ owner: 'nori-main-frame' }, { path: '.' }), {
    path: '.', entries: [{ name: 'docs', kind: 'directory' }], truncated: false,
  })
  assert.deepEqual(await reader.read({ owner: 'nori-main-frame' }, { path: 'README.md', start_line: 1, max_lines: 1 }), {
    path: 'README.md', start_line: 1, returned_lines: 1, content: 'Nori locally.', omitted: false,
  })
  assert.deepEqual(calls.map(([name]) => name), ['list_dir', 'read_file'])
  assert.equal(loads, 1)
})
