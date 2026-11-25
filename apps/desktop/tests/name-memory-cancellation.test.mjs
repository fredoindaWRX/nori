import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'

for (const mode of ['interrupt', 'close']) {
  test(`${mode} after a name-lookup delta cannot commit a successful reply`, () => {
    const root = mkdtempSync(join(tmpdir(), 'nori-name-cancel-'))
    try {
      const module = new URL('../bridge/nori-v2-query.mjs', import.meta.url).href
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict'
        const {query} = await import(${JSON.stringify(module)})
        const saved = []
        async function* prompt() {
          yield {message:{content:'whats my name'}}
          yield {message:{content:'whats my name'}}
        }
        const stream = query({prompt:prompt(), options:{
          getModel(){assert.fail('Name lookup must not need inference')},
          onConversationUpdate:turns=>saved.push(turns),
        }})
        for (;;) {
          const event = await stream.next()
          assert.equal(event.done, false)
          if (event.value.type === 'stream_event') break
        }
        if (${JSON.stringify(mode)} === 'interrupt') await stream.interrupt()
        else stream.close()
        const rest = []
        for await (const event of stream) rest.push(event)
        if (${JSON.stringify(mode)} === 'interrupt') {
          assert.equal(rest[0].subtype, 'error_during_execution')
          assert.match(rest[0].errors.join(' '), /stopped/)
          assert.equal(rest.filter(e=>e.type==='result' && e.subtype==='success').length, 1)
          assert.equal(saved.length, 1, 'Only the next, uninterrupted reply may be saved')
        } else {
          assert.equal(rest.length, 0)
          assert.equal(saved.length, 0)
        }
      `], {encoding:'utf8', windowsHide:true, timeout:30000, env:{...process.env,
        NORI_LEARNING_FILE:join(root,'learning.json'), NORI_SETTINGS_DIR:root,
        NORI_APP_DATA_ROOT:root, NORI_RUNTIME_CONFIG_PATH:join(root,'absent-config.json')}})
      assert.equal(result.status, 0, result.stderr)
    } finally {rmSync(root, {recursive:true, force:true})}
  })
}
