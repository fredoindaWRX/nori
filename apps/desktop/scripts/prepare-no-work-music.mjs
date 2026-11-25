import assert from'node:assert/strict'
import{createRequire}from'node:module'
import{readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync}from'node:fs'
import{resolve}from'node:path'
import{createHash}from'node:crypto'
const require=createRequire(import.meta.url),a=require('@electron/asar'),ts=require('typescript'),h=b=>createHash('sha256').update(b).digest('hex')
const archive='C:/Program Files/Nori/resources/app.asar',stage='C:/Nori/.work/no-work-music',work=stage+'/code-workspace'
assert.ok(!existsSync(stage),'Existing stage preserved');mkdirSync(stage);mkdirSync(work)
const before=h(readFileSync(archive)),renderer='dist/assets/index-ari1On6a.js'
try{
 a.extractAll(archive,work);let s=readFileSync(work+'/'+renderer,'utf8')
 const changes=[['function qQ(e){GQ(`work`,e?LQ.work:0,e?900:1400)}','function qQ(e){GQ(`work`,0,1400)}']]
 for(const[x,y]of changes){assert.equal(s.split(x).length,2,x);s=s.replace(x,y)}
 assert.equal(ts.createSourceFile('renderer.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0)
 assert.ok(!s.includes('kQ(`boot`)')&&!s.includes('Systems are now online.'))
 assert.ok(s.includes('kQ(`wake`)')&&s.includes('kQ(`done`)'))
 writeFileSync(work+'/'+renderer,s);await a.createPackage(work,stage+'/app.asar.next')
 const names=a.listPackage(archive);assert.deepEqual(a.listPackage(stage+'/app.asar.next'),names)
 const changed=[]
 for(const name of names){const x=a.statFile(archive,name.slice(1)),y=a.statFile(stage+'/app.asar.next',name.slice(1));for(const key of ['unpacked','executable','link'])assert.deepEqual(x[key],y[key]);if(x.files)continue;if(h(a.extractFile(archive,name.slice(1)))!==h(a.extractFile(stage+'/app.asar.next',name.slice(1))))changed.push(name.slice(1).replaceAll('\\','/'))}
 assert.deepEqual(changed,[renderer])
 writeFileSync(stage+'/plan.json',JSON.stringify({target:archive,source:stage+'/app.asar.next',before,after:h(readFileSync(stage+'/app.asar.next')),verified:true,removed:[],changed,automaticWorkMusicDisabled:true},null,2))
 console.log(JSON.stringify({verified:true,changed,automaticWorkMusicDisabled:true,installedChanged:false}))
}finally{assert.equal(realpathSync(work).toLowerCase(),resolve(work).toLowerCase());rmSync(work,{recursive:true})}
