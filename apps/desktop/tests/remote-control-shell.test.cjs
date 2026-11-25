const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const source = readFileSync(join(__dirname, '../desktop/main.cjs'), 'utf8')
const launcher = readFileSync(join(__dirname, '../scripts/start-remote-control-only.ps1'), 'utf8')

test('remote shell starts Nori-native chat while keeping Core tools and writes disabled', () => {
  const remoteBlock = source.match(/if \(REMOTE_CONTROL_ONLY\) \{([\s\S]*?)\n  \} else if \(RUNTIME_MODE === 'norllama'\)/)?.[1]
  assert.ok(remoteBlock, 'remote-only startup branch exists')
  const nativeImports = source.match(/const \{([^}]+)\} = require\('\.\/native-service\.cjs'\)/)?.[1]
  assert.ok(nativeImports, 'native service imports exist')
  assert.ok(nativeImports.split(',').map(name => name.trim()).includes('nativeRuntimeMode'))
  assert.ok(nativeImports.split(',').map(name => name.trim()).includes('startNativeService'))
  assert.match(remoteBlock, /nativeService = await startNativeService\(\{ root: SUITE_ROOT, signal: desktopStartupOwner\.signal \}\)/)
  assert.match(remoteBlock, /Object\.assign\(process\.env, nativeService\.environment\)/)
  assert.match(remoteBlock, /process\.env\.NORI_ALLOW_WRITES = '0'/)
  assert.match(remoteBlock, /process\.env\.NORI_NATIVE_CORE_READY = '0'/)
  assert.match(source, /NORI_COUNCIL_URL:\s*REMOTE_CONTROL_ONLY\s*\?\s*COUNCIL_URL\s*:\s*nativeCoreEndpoint\(gptOssCore \|\| nativeService,\s*COUNCIL_URL\)/)
  assert.doesNotMatch(remoteBlock, /startNativeCore|startNativeDesktop|clearUnavailableRuntimeCredentials/)
  assert.match(remoteBlock, /microphone, Core tools, and writes are disabled/)
})

test('remote launcher enables Nori portable model selection without enabling writes', () => {
  assert.match(launcher, /\$env:NORI_MINI_AUTO_MODEL = '1'/)
  assert.match(launcher, /\$env:NORI_REMOTE_CONTROL_ONLY = '1'/)
  assert.match(launcher, /\$env:NORI_ALLOW_WRITES = '0'/)
  assert.match(launcher, /\$env:NORI_INFERENCE_RUNTIME = 'norllama'/)
})

test('remote shell does not acquire microphone, display capture, input helper, or legacy services', () => {
  assert.match(source, /if \(!PROBE_SESSION && !REMOTE_CONTROL_ONLY && process\.platform === 'win32'[\s\S]*?acquireForegroundMicrophoneLease/)
  assert.match(source, /!REMOTE_CONTROL_ONLY && !app\.isPackaged && !PROBE_SESSION/)
  assert.match(source, /!REMOTE_CONTROL_ONLY && !PROBE_SESSION/)
  assert.match(source, /PROBE_SESSION \|\| REMOTE_CONTROL_ONLY\s*\? \['fullscreen', 'pointerLock'\]/)
  assert.match(source, /!PROBE_SESSION && !REMOTE_CONTROL_ONLY\) installDisplayMediaHandler/)
})

test('remote shell still starts the owner-authenticated Nori window service', () => {
  assert.match(source, /if \(!PROBE_SESSION\) \{\s*remoteControl = require\('\.\/private-phone-channel\.cjs'\)\.createPrivatePhoneChannel/)
  assert.match(source, /getContext: \(\) => require\('\.\/tailscale-remote-context\.cjs'\)\.tailscaleRemoteContextAsync\(\)/)
  assert.match(source, /createRemoteControlServer\(\{ window, ownerLogin, origin, activity, voice \}\)/)
})
