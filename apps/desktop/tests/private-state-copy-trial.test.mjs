import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync,constants,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {privateStatePlan} from '../scripts/private-state-plan.mjs'
import {privateStateSnapshot,verifyPrivateStateCopy,verifyPrivateStateSource,verifyPrivateStateMigration,verifyWindowsPrivateStateMigration} from '../scripts/private-state-integrity.mjs'

for(const component of ['desktop','core']) test(`protected synthetic ${component} migration preserves bytes, empty folders and same-account DPAPI`,
  {skip:process.platform!=='win32',timeout:15000},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori private migration ')),source=join(root,'old-profile')
    mkdirSync(join(source,'location-private'),{recursive:true})
    mkdirSync(join(source,'Attachments/empty-session'),{recursive:true})
    writeFileSync(join(source,'settings.json'),'synthetic settings only')
    const quote=value=>"'"+value.replaceAll("'","''")+"'"
    const run=code=>spawnSync('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop'; "+code],
      {encoding:'utf8',timeout:5000,windowsHide:true})
    try {
      const credential=join(source,'location-private/credentials.clixml')
      const prepared=run("$secure=[Security.SecureString]::new(); foreach($character in 'synthetic-secret-test-only'.ToCharArray()){$secure.AppendChar($character)}; $secure.MakeReadOnly(); "+
        "[Management.Automation.PSCredential]::new('fixture',$secure) | Export-Clixml -LiteralPath "+quote(credential))
      assert.equal(prepared.status,0,prepared.stderr)
      const plan=privateStatePlan(root,source,{component}),snapshot=privateStateSnapshot(root,plan)
      assert.equal(verifyPrivateStateSource(root,plan,snapshot).sourceContentMatches,true)
      const provision=fileURLToPath(new URL('../scripts/provision-private-state.ps1',import.meta.url))
      const protectedRoot=run('& '+quote(provision)+' -Root '+quote(root)+' -Apply')
      assert.equal(protectedRoot.status,0,protectedRoot.stderr)
      mkdirSync(plan.destination)
      for(const directory of plan.directories)mkdirSync(join(plan.destination,directory),{recursive:true})
      for(const file of plan.files)copyFileSync(join(source,file.path),join(plan.destination,file.path),constants.COPYFILE_EXCL)
      assert.equal(verifyPrivateStateSource(root,plan,snapshot).sourceContentMatches,true)
      assert.throws(()=>privateStatePlan(root,source,{component}),/destination preserved/)
      assert.equal(verifyPrivateStateCopy(plan.destination,snapshot).contentMatches,true)
      const acceptance=verifyPrivateStateMigration(root,plan,snapshot)
      assert.equal(acceptance.component,component)
      assert.equal(acceptance.copyContentMatches,true)
      assert.equal(acceptance.activationAuthorized,false)
      assert.equal(acceptance.sourceRemovalAuthorized,false)
      writeFileSync(join(plan.destination,'settings.json'),'corrupted synthetic settings')
      assert.throws(()=>verifyPrivateStateMigration(root,plan,snapshot),/integrity mismatch/)
      copyFileSync(join(source,'settings.json'),join(plan.destination,'settings.json'))
      const copiedCredential=join(plan.destination,'location-private/credentials.clixml')
      const checked=run("$acl=[IO.File]::GetAccessControl("+quote(copiedCredential)+
        "); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; "+
        "$allowed=@($sid,'S-1-5-18','S-1-5-32-544'); "+
        "foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { "+
        "if($rule.IdentityReference.Value -notin $allowed -or $rule.AccessControlType -ne 'Allow'){throw 'Unexpected access'} }; "+
        "$credential=Import-Clixml -LiteralPath "+quote(copiedCredential)+
        "; if($credential.GetNetworkCredential().Password -ne 'synthetic-secret-test-only'){throw 'DPAPI mismatch'}; 'PASS'")
      assert.equal(checked.status,0,checked.stderr)
      assert.equal(checked.stdout.trim(),'PASS')
      const aclVerifier=fileURLToPath(new URL('../scripts/verify-private-state-acl.ps1',import.meta.url))
      const verifiedAcl=run('& '+quote(aclVerifier)+' -Root '+quote(join(root,'state/private')))
      assert.equal(verifiedAcl.status,0,verifiedAcl.stderr)
      const windowsAcceptance=verifyWindowsPrivateStateMigration(root,plan,snapshot)
      assert.equal(windowsAcceptance.protectedAclVerified,true)
      assert.equal(windowsAcceptance.quiescenceVerified,false)
      assert.equal(windowsAcceptance.activationAuthorized,false)
      const directoryAclPath=join(plan.destination,'Attachments/empty-session')
      const noInheritance=run('$acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true,$false); '+
        '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($sid); '+
        "foreach($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))){"+
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new($principal,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule)}; "+
        '[IO.Directory]::SetAccessControl('+quote(directoryAclPath)+',$acl)')
      assert.equal(noInheritance.status,0,noInheritance.stderr)
      const refusedInheritance=run('& '+quote(aclVerifier)+' -Root '+quote(join(root,'state/private')))
      assert.notEqual(refusedInheritance.status,0)
      assert.match(refusedInheritance.stderr,/child inheritance incomplete/)
      const restoredInheritance=run('$acl=[IO.Directory]::GetAccessControl('+quote(directoryAclPath)+'); '+
        '$acl.SetAccessRuleProtection($false,$false); foreach($rule in $acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])){$acl.RemoveAccessRuleSpecific($rule)}; '+
        '[IO.Directory]::SetAccessControl('+quote(directoryAclPath)+',$acl)')
      assert.equal(restoredInheritance.status,0,restoredInheritance.stderr)
      const weakened=run('$acl=[IO.File]::GetAccessControl('+quote(copiedCredential)+'); '+
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule); "+
        '[IO.File]::SetAccessControl('+quote(copiedCredential)+',$acl)')
      assert.equal(weakened.status,0,weakened.stderr)
      const refusedAcl=run('& '+quote(aclVerifier)+' -Root '+quote(join(root,'state/private')))
      assert.notEqual(refusedAcl.status,0)
      assert.match(refusedAcl.stderr,/Unexpected private ACL/)
      assert.throws(()=>verifyWindowsPrivateStateMigration(root,plan,snapshot),/permission verification failed/)
      assert.equal(readFileSync(join(source,'settings.json'),'utf8'),'synthetic settings only')
    } finally {rmSync(root,{recursive:true,force:true})}
})
