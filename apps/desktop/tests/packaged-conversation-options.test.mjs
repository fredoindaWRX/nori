import test from 'node:test'
import assert from 'node:assert/strict'
import { packagedConversationOptions } from '../scripts/packaged-conversation-options.mjs'
test('candidate qualification does not require changing current selection', () => {
  assert.deepEqual(packagedConversationOptions(['--candidate=unified-native-20261006', '--selected-consolidated-fixture=.native-browser-migration-packaged-fixture', '--verify-corrupt-resume']), {
    candidate: 'unified-native-20261006', fixtureName: '.native-browser-migration-packaged-fixture', verifyCorruptResume: true,
  })
  assert.deepEqual(packagedConversationOptions([]), {})
})
test('qualification rejects unsafe paths, missing fixture and duplicate flags', () => {
  for (const args of [['--candidate=../escape'], ['--candidate=current'], ['--verify-corrupt-resume'], ['--unexpected'],
    ['--selected-consolidated-fixture=real-profile'], ['--candidate=a', '--candidate=b'], ['--verify-corrupt-resume', '--verify-corrupt-resume']]) {
    assert.throws(() => packagedConversationOptions(args))
  }
})
