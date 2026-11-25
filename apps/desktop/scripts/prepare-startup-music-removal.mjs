import assert from 'node:assert/strict'
import{createRequire}from'node:module'
import{readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync}from'node:fs'
import{resolve}from'node:path'
import{createHash}from'node:crypto'
const require=createRequire(import.meta.url),asar=require('@electron/asar'),ts=require('typescript'),hash=b=>createHash('sha256').update(b).digest('hex')
const archive='C:/Program Files/Nori/resources/app.asar',stage='C:/Nori/.work/startup-music-removal',work=stage+'/code-workspace'
assert.ok(!existsSync(stage),'Existing stage preserved');mkdirSync(stage);mkdirSync(work)
const before=hash(readFileSync(archive)),removed=['dist/audio/boot-music.mp3','dist/audio/ambient.mp3']
try{
 asar.extractAll(archive,work)
 const renderer='dist/assets/index-ari1On6a.js';let s=readFileSync(work+'/'+renderer,'utf8')
 const edits=[
 ['PQ=[`boot-music`,`ambient`,`work`]','PQ=[`work`]'],
 ['FQ={"boot-music":`boot-music.mp3`,ambient:`deep-ambient.wav`,work:`work.mp3`}','FQ={work:`work.mp3`}'],
 ['LQ={"boot-music":.85,ambient:.58,work:.11}','LQ={work:.11}'],
 ['RQ={"boot-music":0,ambient:0,work:0}','RQ={work:0}'],
 ['return zQ&&e!==`boot-music`?RQ[e]*BQ:RQ[e]','return zQ?RQ[e]*BQ:RQ[e]'],
 ['function KQ(){let e=VQ(`ambient`);e&&(NQ.delete(`ambient`),e.el.currentTime=0,GQ(`ambient`,LQ.ambient,900))}',''],
 ['HQ(),KQ()','HQ()'],['[`ambient`,`work`].forEach','[`work`].forEach'],
 ]
 for(const[a,b]of edits){assert.equal(s.split(a).length,2,a);s=s.replace(a,b)}
 assert.ok(!s.includes('boot-music')&&!s.includes('deep-ambient.wav'))
 assert.equal(ts.createSourceFile('renderer.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0)
 writeFileSync(work+'/'+renderer,s)
 writeFileSync(work+'/dist/audio/CREDITS.md',readFileSync('C:/Nori/apps/desktop/public/audio/CREDITS.md'))
 for(const path of removed){const full=resolve(work,path);assert.ok(full.startsWith(resolve(work)));rmSync(full)}
 await asar.createPackage(work,stage+'/app.asar.next')
 const oldNames=asar.listPackage(archive),newNames=asar.listPackage(stage+'/app.asar.next'),changed=[]
 assert.deepEqual(newNames,oldNames.filter(n=>!removed.includes(n.slice(1).replaceAll('\\','/'))))
 for(const name of newNames){const x=asar.statFile(archive,name.slice(1)),y=asar.statFile(stage+'/app.asar.next',name.slice(1));for(const key of ['unpacked','executable','link'])assert.deepEqual(x[key],y[key]);if(x.files)continue
  if(hash(asar.extractFile(archive,name.slice(1)))!==hash(asar.extractFile(stage+'/app.asar.next',name.slice(1))))changed.push(name.slice(1).replaceAll('\\','/'))
 }
 assert.deepEqual(changed.sort(),[renderer,'dist/audio/CREDITS.md'].sort())
 writeFileSync(stage+'/plan.json',JSON.stringify({archive,target:archive,source:stage+'/app.asar.next',before,after:hash(readFileSync(stage+'/app.asar.next')),removed,changed,verified:true},null,2))
 console.log(JSON.stringify({verified:true,removed,changed,installedChanged:false}))
}finally{assert.equal(realpathSync(work).toLowerCase(),resolve(work).toLowerCase());rmSync(work,{recursive:true})}
