import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {prepareSelfCodeWorkspace,isSelfCodeRequest} from '../bridge/self-code-workspace.mjs'
import {resolveAiderWorkspace} from '../bridge/aider-tools.mjs'

test('self-code intake matches the actual request, not ordinary questions',()=>{
  assert.equal(isSelfCodeRequest('go thru your project and fix anything that needs connecting'),true)
  assert.equal(isSelfCodeRequest('What is your codebase?'),false)
  assert.equal(isSelfCodeRequest('Do not fix your system'),false)
})

test('self request resolves from installed source into synthetic private state',()=>{
  const suite='C:\\Program Files\\Nori\\resources\\NoriSuite'
  const root=mkdtempSync(join(tmpdir(),'nori-installed-self-code-'))
  try {
    const environment={...process.env,NORI_ROOT:suite,NORI_APP_DATA_ROOT:root}
    delete environment.NORI_AIDER_WORKSPACE_ROOT
    const target=resolveAiderWorkspace('go thru your project and fix anything that needs connecting',environment)
    assert.equal(target,join(root,'development','self-code'))
    assert.ok(existsSync(join(target,'nori','nori_aider.py')))
    assert.ok(existsSync(join(target,'apps','desktop','bridge','local-chat.mjs')))
    assert.equal(existsSync(join(target,'models')),false)
    assert.equal(existsSync(join(target,'integrations')),false)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('source-only self workspace preserves installed files and pending edits',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-self-code-'))
  const suite=join(root,'suite'),state=join(root,'state')
  const gitExecutable='C:\\Program Files\\Nori\\resources\\NoriSuite\\integrations\\aider\\git\\mingw64\\bin\\git.exe'
  try {
    mkdirSync(join(suite,'nori','models'),{recursive:true})
    writeFileSync(join(suite,'nori','example.py'),'value = 1\n')
    writeFileSync(join(suite,'nori','models','private.py'),'not source\n')
    const environment={...process.env,NORI_APP_DATA_ROOT:state}
    const target=prepareSelfCodeWorkspace({suiteRoot:suite,environment,gitExecutable})
    assert.equal(readFileSync(join(target,'nori','example.py'),'utf8'),'value = 1\n')
    assert.equal(existsSync(join(target,'nori','models')),false)
    assert.equal(prepareSelfCodeWorkspace({suiteRoot:suite,environment,gitExecutable}),target)
    writeFileSync(join(suite,'nori','example.py'),'value = 3\n')
    assert.throws(()=>prepareSelfCodeWorkspace({suiteRoot:suite,environment,gitExecutable}),/source changed/)
    writeFileSync(join(suite,'nori','example.py'),'value = 1\n')
    writeFileSync(join(target,'nori','example.py'),'value = 2\n')
    assert.throws(()=>prepareSelfCodeWorkspace({suiteRoot:suite,environment,gitExecutable}),/pending/)
    assert.equal(readFileSync(join(suite,'nori','example.py'),'utf8'),'value = 1\n')
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('"your code" always means Nori herself when the request asks for work on it',()=>{
  for (const text of ['work on your code','fix your code','improve your own code','go through your codebase','clean up your source code','update Nori\'s code','refactor her code','look at your code and tidy it'])
    assert.equal(isSelfCodeRequest(text),true,text)
  for (const text of ['What is your codebase?','what is your code name','do not fix your code','never change your code','work on my code','fix the code in this project','your code looks nice'])
    assert.equal(isSelfCodeRequest(text),false,text)
})
