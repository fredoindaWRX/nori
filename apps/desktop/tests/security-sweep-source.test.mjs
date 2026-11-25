import test from 'node:test'
import assert from 'node:assert/strict'
import { securityFindings, securitySweepReply, collectSecurityFacts } from '../bridge/security-sweep.mjs'
import { execFileSync } from 'node:child_process'

test('missing measurements cannot become positive security findings', () => {
  const result = securityFindings({})
  assert.equal(result.good.length, 0)
  assert.match(result.check.join('\n'), /Remote Desktop state/)
  assert.match(result.check.join('\n'), /User Account Control state/)
  assert.match(result.check.join('\n'), /listening-port inventory/)
  assert.throws(() => securityFindings(null), /unavailable/)
})

test('explicit measurements support only their corresponding findings', () => {
  const result = securityFindings({ rdpEnabled: false, uac: { enabled: true, prompt: 5 }, listeners: [] })
  assert.match(result.good.join('\n'), /Remote Desktop is off/)
  assert.match(result.good.join('\n'), /User Account Control is on/)
  assert.match(result.good.join('\n'), /No program is listening/)
})

test('report uses injected facts without running a Windows sweep', async () => {
  let called = 0
  const text = await securitySweepReply({ collect: async () => { called++; return { rdpEnabled: true } } })
  assert.equal(called, 1)
  assert.match(text, /Remote Desktop is turned ON/)
  assert.match(text, /could not read the User Account Control/)
})

test('failed process cannot return success even with valid partial JSON', async () => {
  await assert.rejects(collectSecurityFacts({ runner: (_exe, _args, _options, callback) => callback(Error('timeout'), '{}') }), /did not finish/)
})

test('PowerShell parses full collector and failed check blocks preserve unknown values', async () => {
  let script
  await collectSecurityFacts({ runner: (_exe, args, _options, callback) => { script = args.at(-1); callback(null, '{}') } })
  const encoded = Buffer.from(script).toString('base64')
  const parse = `$s = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $t=$null; $e=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$t,[ref]$e); if($e.Count){throw ($e | Out-String)}; 'parsed'`
  assert.match(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parse], { encoding: 'utf8', windowsHide: true }), /parsed/)
  const start = script.indexOf('try { $r.listeners')
  const end = script.indexOf('$r.accounts')
  assert.ok(start >= 0 && end > start)
  const fixture = `$r=@{}; function Get-NetTCPConnection { throw 'fixture unavailable' }; function Get-ItemProperty { throw 'fixture unavailable' };\n${script.slice(start, end)}\n$r | ConvertTo-Json -Compress`
  const facts = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', fixture], { encoding: 'utf8', windowsHide: true }))
  assert.deepEqual(facts, { listeners: null, rdpEnabled: null, uac: null })
  assert.equal(securityFindings(facts).good.length, 0)
})
