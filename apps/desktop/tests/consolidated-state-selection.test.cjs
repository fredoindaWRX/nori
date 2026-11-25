const test=require('node:test')
const assert=require('node:assert/strict')
const {mkdtempSync,mkdirSync,rmSync,existsSync,readdirSync}=require('node:fs')
const {join}=require('node:path')
const {tmpdir}=require('node:os')
const {spawnSync}=require('node:child_process')
const {consolidatedStateSelection}=require('../desktop/consolidated-state-selection.cjs')

test('default launch does not inspect or create state; unknown opt-in refuses without fallback',()=>{
  assert.equal(consolidatedStateSelection('not-even-an-absolute-path',undefined),null)
  assert.equal(consolidatedStateSelection('not-even-an-absolute-path',''),null)
  assert.throws(()=>consolidatedStateSelection('unused','other'),/Unknown.*no fallback/)
})

test('unprepared consolidated state refuses without creating directories',
  {skip:process.platform!=='win32'},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori-launch-selection-'))
    try{
      assert.throws(()=>consolidatedStateSelection(root,'consolidated-v1'),/missing.*no data created/)
      assert.equal(existsSync(join(root,'state')),false)
      assert.deepEqual(readdirSync(root),[])
    }finally{rmSync(root,{recursive:true,force:true})}
  })

test('explicit selector accepts prepared protected state and rejects widened browser ACLs',
  {skip:process.platform!=='win32',timeout:30000},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori-launch-selection-'))
    const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
    const run=(args,environment={})=>{
      const result=spawnSync(powershell,['-NoProfile',...args],
        {encoding:'utf8',windowsHide:true,shell:false,timeout:10000,env:{...process.env,...environment}})
      assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr)
    }
    try{
      for(const storageClass of ['private','browser'])run(['-File',
        join(__dirname,'../scripts/provision-private-state.ps1'),'-Root',root,'-StorageClass',storageClass,'-Apply'])
      mkdirSync(join(root,'state/private/core'));mkdirSync(join(root,'state/private/desktop'))
      const selected=consolidatedStateSelection(root,'consolidated-v1')
      assert.equal(selected.selected,true);assert.equal(selected.permissionsVerified,true)
      assert.equal(selected.liveMigrationAuthorized,false);assert.equal(selected.activationAuthorized,false)
      assert.equal(selected.desktop,join(root,'state/private/desktop'))
      assert.equal(selected.core,join(root,'state/private/core'))
      assert.equal(selected.browser,join(root,'state/browser'))
      assert.equal(Object.isFrozen(selected),true)
      // Deliberately broaden only this generated synthetic directory. Never
      // grant anything on owner state; the selector must refuse rather than
      // quietly starting with legacy paths.
      run(['-Command',
        "$ErrorActionPreference='Stop';$p=$env:NORI_SYNTHETIC_ACL_TRIAL;$acl=[IO.Directory]::GetAccessControl($p);$sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'ReadAndExecute','Allow');$acl.AddAccessRule($rule);[IO.Directory]::SetAccessControl($p,$acl)"],
        {NORI_SYNTHETIC_ACL_TRIAL:selected.browser})
      assert.throws(()=>consolidatedStateSelection(root,'consolidated-v1'),/permissions refused.*no legacy fallback/)
      assert.equal(existsSync(selected.core),true);assert.equal(existsSync(selected.desktop),true)
    }finally{rmSync(root,{recursive:true,force:true})}
  })
