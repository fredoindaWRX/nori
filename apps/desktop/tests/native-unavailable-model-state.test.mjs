import test from 'node:test'
import assert from 'node:assert/strict'
import startup from '../desktop/native-desktop-startup.cjs'
import { nativeModelChoices, nativeModelSelection } from '../bridge/local-chat.mjs'

test('unavailable startup clears credentials and conveys the real model state', () => {
  const environment = { NORI_RUNTIME_MODEL_ID: 'stale', NORI_RUNTIME_API_KEY: 'private',
    NORI_RUNTIME_URL: 'http://127.0.0.1:1', NORI_API_TOKEN: 'private', NORI_COUNCIL_URL: 'http://127.0.0.1:9107',
    NORI_NATIVE_CORE_READY: '1', NORI_NATIVE_TOOLS_QUALIFIED: '1' }
  startup.clearUnavailableRuntimeCredentials(environment)
  // Main-process startup supplies this state after preserving the credential
  // cleanup helper's existing contract.
  environment.NORI_RUNTIME_MODEL_STATE = 'unavailable'
  assert.equal(environment.NORI_ALLOW_WRITES, '0')
  for (const name of ['NORI_RUNTIME_MODEL_ID','NORI_RUNTIME_API_KEY','NORI_RUNTIME_URL','NORI_API_TOKEN',
    'NORI_COUNCIL_URL','NORI_NATIVE_CORE_READY','NORI_NATIVE_TOOLS_QUALIFIED']) {
    assert.equal(environment[name], undefined)
  }
  assert.match(nativeModelChoices(environment)[0].label, /checkpoint unavailable/)
  assert.throws(() => nativeModelSelection('nori-auto', environment),
    error => error.code === 'NORI_MODEL_UNAVAILABLE' && /No replacement model/.test(error.message))
})

test('explicit unavailable state cannot be overridden by a stale model identifier', () => {
  assert.throws(() => nativeModelSelection('stale', {
    NORI_RUNTIME_MODEL_STATE: 'unavailable', NORI_RUNTIME_MODEL_ID: 'stale'
  }), error => error.code === 'NORI_MODEL_UNAVAILABLE')
})
