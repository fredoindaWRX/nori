import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8')
for(const name of ['startLegacyBus','startComfy']){
  test(`native startup does not probe or spawn legacy ${name}`,async()=>{
    const match=source.match(new RegExp(`async function ${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`))
    assert.ok(match)
    const forbidden=()=>{throw new Error('Legacy service reached in native mode')}
    const context=vm.createContext({RUNTIME_MODE:'norllama',REMOTE_CONTROL_ONLY:true,PROBE_SESSION:null,
      waitForComfyStartup:forbidden,legacyBusIsUp:forbidden,
      comfyIsUp:forbidden,existsSync:forbidden,spawn:forbidden})
    await vm.runInContext(`(async()=>{${match[1]}})()`,context)
  })
}

test('bridge receives the owned Core endpoint selected at readiness, not the legacy fixed port',()=>{
  assert.match(source, /NORI_COUNCIL_URL:\s*REMOTE_CONTROL_ONLY\s*\?\s*COUNCIL_URL\s*:\s*nativeCoreEndpoint\(nativeService,\s*COUNCIL_URL\)/)
})

test('packaged image sidecar startup retains bounded stderr diagnostics on failure', () => {
  const match = source.match(/async function startComfy\(\) \{([\s\S]*?)\n\}/)
  assert.ok(match)
  assert.match(match[1], /stdio:\s*\['ignore',\s*'ignore',\s*'pipe'\]/)
  assert.match(match[1], /stderrTail\s*=\s*\(stderrTail\s*\+\s*chunk\.toString\('utf8'\)\)\.slice\(-4096\)/)
  assert.match(match[1], /startup\.error\?\.message[\s\S]*stderrTail\.trim\(\)/)
  assert.match(source, /if\s*\(app\.isPackaged\s*&&\s*!PROBE_SESSION\)\s*void\s+startComfy\(\)\.catch/)
})
