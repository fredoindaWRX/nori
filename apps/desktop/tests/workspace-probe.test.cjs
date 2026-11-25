const test=require('node:test')
const assert=require('node:assert/strict')
const {mkdtempSync,mkdirSync,rmSync,symlinkSync}=require('node:fs')
const {tmpdir}=require('node:os')
const {join}=require('node:path')
const {workspaceProbe}=require('../desktop/workspace-probe.cjs')
test('workspace probe requires explicit argv and an isolated existing directory inside verification',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-probe-fixture-'))
  try {
    const verification=join(root,'verification');mkdirSync(verification)
    const state=mkdtempSync(join(verification,'.native-desktop-probe-'))
    const owner={NORI_WORKSPACE_PROBE_OWNER_URL:'http://127.0.0.1:54321/owner',NORI_WORKSPACE_PROBE_OWNER_KEY:'fixture-private-owner-key-0123456789'}
    assert.equal(workspaceProbe(root,[],{}),null)
    assert.deepEqual(workspaceProbe(root,['--workspace-probe'],{...owner,NORI_WORKSPACE_PROBE_STATE:state}),{directory:state,ownerUrl:owner.NORI_WORKSPACE_PROBE_OWNER_URL,ownerKey:owner.NORI_WORKSPACE_PROBE_OWNER_KEY})
    assert.throws(()=>workspaceProbe(root,['--workspace-probe'],{NORI_WORKSPACE_PROBE_STATE:state}),/heartbeat/)
    for(const candidate of [root,verification,tmpdir()]) assert.throws(()=>workspaceProbe(root,['--workspace-probe'],{NORI_WORKSPACE_PROBE_STATE:candidate}),/isolated/)
    assert.throws(()=>workspaceProbe(root,['--workspace-probe'],{}),/isolated/)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('consolidated workspace probe accepts only its exact unlinked generated layout',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-probe-fixture-'))
  const verification=join(root,'verification');mkdirSync(verification)
  const layout=mkdtempSync(join(verification,'.native-browser-migration-'))
  const state=join(layout,'state/private/desktop');mkdirSync(state,{recursive:true})
  const owner={NORI_WORKSPACE_PROBE_OWNER_URL:'http://127.0.0.1:54321/owner',NORI_WORKSPACE_PROBE_OWNER_KEY:'fixture-private-owner-key-0123456789'}
  const environment={...owner,NORI_WORKSPACE_PROBE_STATE:state,NORI_WORKSPACE_PROBE_LAYOUT_ROOT:layout}
  const argv=['--workspace-probe','--consolidated-layout-probe']
  try{
    assert.deepEqual(workspaceProbe(root,argv,environment),{
      directory:state,ownerUrl:owner.NORI_WORKSPACE_PROBE_OWNER_URL,ownerKey:owner.NORI_WORKSPACE_PROBE_OWNER_KEY,layoutRoot:layout})
    assert.throws(()=>workspaceProbe(root,argv,{...environment,NORI_WORKSPACE_PROBE_LAYOUT_ROOT:root}),/generated fixture/)
    assert.throws(()=>workspaceProbe(root,argv,{...environment,NORI_WORKSPACE_PROBE_LAYOUT_ROOT:'relative'}),/layout root/)
    assert.throws(()=>workspaceProbe(root,['--workspace-probe'],environment),/isolated/)
    const sibling=join(layout,'state/private/core');mkdirSync(sibling)
    assert.throws(()=>workspaceProbe(root,argv,{...environment,NORI_WORKSPACE_PROBE_STATE:sibling}),/generated fixture/)
    const alias=join(verification,'.native-browser-migration-alias')
    symlinkSync(layout,alias,'junction')
    assert.throws(()=>workspaceProbe(root,argv,{...environment,NORI_WORKSPACE_PROBE_LAYOUT_ROOT:alias}),/Linked/)
    const stateAlias=join(layout,'state/private/alias');symlinkSync(state,stateAlias,'junction')
    assert.throws(()=>workspaceProbe(root,argv,{...environment,NORI_WORKSPACE_PROBE_STATE:stateAlias}),/unlinked/)
    assert.equal(workspaceProbe(root,[],environment),null)
    assert.throws(()=>workspaceProbe(root,['--consolidated-layout-probe'],environment),/explicit workspace-probe/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
