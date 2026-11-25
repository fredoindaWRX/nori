import assert from'node:assert/strict'
import{createRequire}from'node:module'
import{readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync}from'node:fs'
import{resolve}from'node:path'
import{createHash}from'node:crypto'
const require=createRequire(import.meta.url),a=require('@electron/asar'),ts=require('typescript'),h=b=>createHash('sha256').update(b).digest('hex')
const archive='C:/Program Files/Nori/resources/app.asar',stage='C:/Nori/.work/composer-voice-button',work=stage+'/code-workspace'
assert.ok(!existsSync(stage),'Existing stage preserved');mkdirSync(stage);mkdirSync(work)
const before=h(readFileSync(archive)),renderer='dist/assets/index-ari1On6a.js'
try{
 a.extractAll(archive,work);let s=readFileSync(work+'/'+renderer,'utf8')
 const changes=[["spellCheck:!1}),ce||g===`speaking`?", "spellCheck:!1}),(0,J.jsx)(`button`,{type:`button`,className:`textbar-attach`,style:{width:44,height:44,flexShrink:0,borderRadius:22,color:P?`inherit`:`#82efd3`,background:P?`transparent`:`#153a36`},\"aria-label\":P?`Enable voice input`:`Disable voice input`,\"aria-pressed\":!P,title:P?`Enable voice input \u2014 then say Hey Nori`:`Turn microphone off`,onClick:()=>le(!P),children:(0,J.jsx)(`svg`,{width:22,height:22,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:2,\"aria-hidden\":!0,children:(0,J.jsx)(`path`,{d:`M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4`})})}),ce||g===`speaking`?"]]
 for(const[x,y]of changes){assert.equal(s.split(x).length,2,x);s=s.replace(x,y)}
 assert.equal(ts.createSourceFile('renderer.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0)
 assert.ok(!s.includes('kQ(`boot`)')&&!s.includes('Systems are now online.'))
 assert.ok(s.includes('kQ(`wake`)')&&s.includes('kQ(`done`)'))
 writeFileSync(work+'/'+renderer,s);await a.createPackage(work,stage+'/app.asar.next')
 const names=a.listPackage(archive);assert.deepEqual(a.listPackage(stage+'/app.asar.next'),names)
 const changed=[]
 for(const name of names){const x=a.statFile(archive,name.slice(1)),y=a.statFile(stage+'/app.asar.next',name.slice(1));for(const key of ['unpacked','executable','link'])assert.deepEqual(x[key],y[key]);if(x.files)continue;if(h(a.extractFile(archive,name.slice(1)))!==h(a.extractFile(stage+'/app.asar.next',name.slice(1))))changed.push(name.slice(1).replaceAll('\\','/'))}
 assert.deepEqual(changed,[renderer])
 writeFileSync(stage+'/plan.json',JSON.stringify({target:archive,source:stage+'/app.asar.next',before,after:h(readFileSync(stage+'/app.asar.next')),verified:true,removed:[],changed,composerVoiceToggleAdded:true},null,2))
 console.log(JSON.stringify({verified:true,changed,composerVoiceToggleAdded:true,installedChanged:false}))
}finally{assert.equal(realpathSync(work).toLowerCase(),resolve(work).toLowerCase());rmSync(work,{recursive:true})}
