import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
test('native bridge does not instantiate unused vendor tool servers',()=>{
  const source=readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8')
  assert.doesNotMatch(source,/from\s+['"]\.\/(?:chrome|panels|ui|vision)\.mjs['"]|@anthropic-ai/)
  assert.doesNotMatch(source,/\b(?:displayServer|uiServer|chromeServer|visionServer|chromeAvailable)\s*\(/)
  assert.match(source,/mcpServers:\s*MCP_SERVERS/)
  const query=readFileSync(new URL('../bridge/nori-v2-query.mjs',import.meta.url),'utf8')
  assert.match(query,/options\.nativeUi\(operation,\s*args,\s*origin\)/,
    'the request-bound origin must reach the UI callback')
  assert.match(source,/nativeUi:\s*\(op,\s*args,\s*origin\)\s*=>\s*\{[\s\S]*?ownsNeuralObservation\(origin,\s*activeNeuralOrigin\)/,
    'UI commands must be scoped to the active request owner')
  assert.doesNotMatch(source,/publishLegacyEvent|NORI_EVENT_BUS_URL|9390\/publish/)
  assert.doesNotMatch(source,/pathToClaudeCodeExecutable|allowDangerouslySkipPermissions|permissionMode:/)
  assert.match(source,/settingSources:\s*\[\]/)
})
test('native distribution excludes vendor SDK and preserved unused adapters',()=>{
  const config=require('js-yaml').load(readFileSync(new URL('../electron-builder.native.yml',import.meta.url),'utf8'))
  assert.ok(config.files.includes('!node_modules/@anthropic-ai/**/*'))
  assert.ok(config.files.includes('!bridge/{chrome,panels,ui,vision}.mjs'))
})
