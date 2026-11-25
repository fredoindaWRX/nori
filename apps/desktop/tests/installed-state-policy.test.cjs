const test=require('node:test')
const assert=require('node:assert/strict')
const {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,symlinkSync,copyFileSync}=require('node:fs')
const {join,resolve}=require('node:path')
const {tmpdir}=require('node:os')
const {spawnSync}=require('node:child_process')
const {installedStatePolicy}=require('../desktop/installed-state-policy.cjs')
const {desktopStateSelection}=require('../desktop/desktop-state-selection.cjs')
const policy={schema:'nori.installed-state-policy.v1',stateLayout:'consolidated-v1',suiteRelativePath:'resources/NoriSuite'}
function fixture(run){
  const root=mkdtempSync(join(tmpdir(),'nori-installed-policy-'))
  const context={packaged:true,executable:join(root,'Nori.exe'),suiteRoot:join(root,'resources/NoriSuite'),appRoot:join(root,'resources/app.asar')}
  const marker=join(root,'nori-install-layout.json')
  try{run({root,context,marker})}finally{rmSync(root,{recursive:true,force:true})}
}
test('absent installation policy preserves existing profile choice without state creation',()=>fixture(({context,root})=>{
  assert.equal(installedStatePolicy(context),null)
  assert.equal(desktopStateSelection(context,()=>assert.fail('must not select')),null)
  assert.throws(()=>readFileSync(join(root,'resources')),{code:'ENOENT'})
}))
test('valid policy selects physical prepared layout without environment override',()=>fixture(({context,marker})=>{
  writeFileSync(marker,JSON.stringify(policy))
  const calls=[],select=(...args)=>{calls.push(args);return {selected:true}}
  assert.equal(desktopStateSelection(context,select).selected,true)
  assert.deepEqual(calls,[[context.suiteRoot,'consolidated-v1',{scriptsRoot:join(join(context.executable,'..'),'maintenance/scripts')}]])
  assert.equal(installedStatePolicy(context).preparedStateRequired,true)
}))
test('policy does not bypass missing prepared state and never falls back',()=>fixture(({context,marker})=>{
  writeFileSync(marker,JSON.stringify(policy))
  assert.throws(()=>desktopStateSelection(context),/ENOENT|missing|root/)
  assert.equal(readFileSync(marker,'utf8'),JSON.stringify(policy))
}))
test('installed policy rejects conflicting environment modes including empty override',()=>fixture(({context,marker})=>{
  writeFileSync(marker,JSON.stringify(policy))
  for(const mode of ['', 'legacy', 'unknown', null])assert.throws(()=>desktopStateSelection({...context,stateLayout:mode}),/conflicts.*no fallback/)
  assert.equal(desktopStateSelection({...context,stateLayout:'consolidated-v1'},()=>({selected:true})).selected,true)
}))
test('malformed, unsupported, extra-field and redirected policies fail closed',()=>fixture(({context,marker})=>{
  for(const value of ['{', 'null', '[]', JSON.stringify({...policy,schema:'unknown'}), JSON.stringify({...policy,stateLayout:'legacy'}),
    JSON.stringify({...policy,suiteRelativePath:'../outside'}),JSON.stringify({...policy,owner:'someone'}),'x'.repeat(4097)]){
    writeFileSync(marker,value)
    assert.throws(()=>desktopStateSelection(context),/policy.*no fallback/)
  }
  writeFileSync(marker,JSON.stringify(policy))
  assert.throws(()=>installedStatePolicy({...context,suiteRoot:join(context.suiteRoot,'elsewhere')}),/differs/)
}))
test('marker directories are refused',()=>fixture(({context,marker})=>{
  mkdirSync(marker)
  assert.throws(()=>installedStatePolicy(context),/Unsafe/)
}))
test('linked marker parent is refused before policy adoption',()=>fixture(({context,root})=>{
  const real=join(root,'real'),alias=join(root,'alias')
  mkdirSync(real);writeFileSync(join(real,'nori-install-layout.json'),JSON.stringify(policy))
  symlinkSync(real,alias,process.platform==='win32'?'junction':'dir')
  assert.throws(()=>installedStatePolicy({...context,executable:join(alias,'Nori.exe'),suiteRoot:join(alias,'resources/NoriSuite')}),/Unsafe/)
}))
test('actual Windows ACL checks accept marker-selected prepared state and reject broadened state',
  {skip:process.platform!=='win32',timeout:30000},()=>{
    const root=mkdtempSync(join(resolve(__dirname,'../../../verification'),'.installed-state-policy-'))
    const suiteRoot=join(root,'resources/NoriSuite'),scripts=join(root,'maintenance/scripts')
    const context={packaged:true,executable:join(root,'Nori.exe'),suiteRoot,appRoot:join(root,'resources/app.asar')}
    const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
    const run=(args,env={})=>{
      const result=spawnSync(powershell,['-NoProfile',...args],{shell:false,windowsHide:true,
        encoding:'utf8',timeout:10000,env:{...process.env,...env}})
      assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr)
    }
    try{
      mkdirSync(suiteRoot,{recursive:true});mkdirSync(scripts,{recursive:true})
      for(const name of ['verify-private-state-acl.ps1','verify-browser-state-acl.ps1','browser-capability-sid.ps1'])
        copyFileSync(join(__dirname,'../scripts',name),join(scripts,name))
      for(const storageClass of ['private','browser'])run(['-File',join(__dirname,'../scripts/provision-private-state.ps1'),
        '-Root',suiteRoot,'-StorageClass',storageClass,'-Apply'])
      mkdirSync(join(suiteRoot,'state/private/core'));mkdirSync(join(suiteRoot,'state/private/desktop'))
      writeFileSync(join(root,'nori-install-layout.json'),JSON.stringify(policy))
      const selected=desktopStateSelection(context)
      assert.equal(selected.permissionsVerified,true)
      assert.equal(selected.desktop,join(suiteRoot,'state/private/desktop'))
      assert.equal(selected.liveMigrationAuthorized,false)
      run(['-Command',"$ErrorActionPreference='Stop';$p=$env:NORI_POLICY_ACL_FIXTURE;$acl=[IO.Directory]::GetAccessControl($p);$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'ReadAndExecute','Allow'));[IO.Directory]::SetAccessControl($p,$acl)"],
        {NORI_POLICY_ACL_FIXTURE:selected.browser})
      assert.throws(()=>desktopStateSelection(context),/permissions refused.*no legacy fallback/)
      assert.equal(readFileSync(join(root,'nori-install-layout.json'),'utf8'),JSON.stringify(policy))
    }finally{rmSync(root,{recursive:true,force:true})}
  })
