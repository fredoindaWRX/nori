import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
test('Windows browser ACL accepts exact derived sandbox scope and rejects widened or foreign permissions',
  {skip:process.platform!=='win32',timeout:30000},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori-browser-acl-'))
    try{
      const result=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile','-File',fileURLToPath(new URL('../scripts/browser-acl-trial.ps1',import.meta.url)),'-Root',root],
        {encoding:'utf8',windowsHide:true,shell:false,timeout:25000})
      assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr)
      const evidence=JSON.parse(result.stdout.trim())
      assert.equal(evidence.SyntheticBrowserAclTrial,true)
      assert.equal(evidence.WidenedCapabilityRejected,true)
      assert.equal(evidence.OutsideScopeRejected,true)
      assert.equal(evidence.ForeignPrincipalRejected,true)
      assert.equal(evidence.ActivationAuthorized,false)
    }finally{rmSync(root,{recursive:true,force:true})}
  })
