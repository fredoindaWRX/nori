import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
test('Windows private-state test provisions owner-only ACL and removes only its empty fixture',
  {skip:process.platform!=='win32'},()=>{
    const root=resolve(import.meta.dirname,'../../..')
    const script=resolve(import.meta.dirname,'../scripts/provision-private-state.ps1')
    const result=spawnSync('powershell.exe',['-NoProfile','-File',script,'-Root',root,'-Apply','-TestOnly'],
      {encoding:'utf8',timeout:10000,windowsHide:true})
    assert.equal(result.error,undefined)
    assert.equal(result.status,0,result.stderr)
    for(const field of ['AclProtected','OwnerVerified','TestFolderRemoved']) assert.match(result.stdout,new RegExp(field+'\\s+: True'))
    for(const field of ['CredentialsCopied','ExistingStateModified']) assert.match(result.stdout,new RegExp(field+'\\s+: False'))
})
