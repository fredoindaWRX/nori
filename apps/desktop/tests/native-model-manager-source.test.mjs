import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('SoN maintenance UI reports actual status and offers no external model actions',()=>{
  const source=readFileSync(new URL('../src/ui/LocalModelManager.tsx',import.meta.url),'utf8')
  assert.match(source,/model\.loadedModel \|\| 'NOT REPORTED'/)
  assert.doesNotMatch(source,/NORI-12B SoN/)
  assert.match(source,/NORI-20B SoN/)
  assert.match(source,/NOT ACTIVATED/)
  assert.match(source,/Built with Llama/)
  assert.match(source,/LICENSE|license and acceptable-use notices/i)
  assert.doesNotMatch(source,/installDeep|removeDeep|subscribeProgress|GPT-OSS|INSTALL 20B MODEL|EVERYDAY MODEL · QWEN|About 13 GB/)
})
