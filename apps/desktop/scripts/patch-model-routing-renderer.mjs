// Change only identified render expressions in the current installed bundle.
// Preserve every other byte; do not rebuild an older source tree over newer UI.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,writeFileSync} from 'node:fs'
const require=createRequire(import.meta.url),asar=require('@electron/asar'),ts=require('typescript')
const archive='C:/Program Files/Nori/resources/app.asar'
const matches=asar.listPackage(archive).filter(path=>/dist[\\/]assets[\\/].*\.js$/.test(path))
 .map(path=>path.replace(/^[/\\]/,'')).filter(path=>asar.extractFile(archive,path).includes(Buffer.from('Local model')))
assert.equal(matches.length,1,'Ambiguous renderer')
const path=matches[0],original=asar.extractFile(archive,path).toString()
const source=ts.createSourceFile(path,original,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
assert.equal(source.parseDiagnostics.length,0)
const edits=[];let removedPicker=0,removedManager=0,cardUpdated=0,titleUpdated=0
const property=(node,name)=>node?.properties?.find(item=>item.name?.text===name)?.initializer
function replace(node,text){edits.push({start:node.getStart(source),end:node.end,text})}
function walk(node){
 if(ts.isCallExpression(node)&&ts.isStringLiteralLike(node.arguments[0]??{})){
  const tag=node.arguments[0].text,props=node.arguments[1],className=property(props,'className')?.text
  if(tag==='div'&&className==='settings-row'&&node.getText(source).includes('Local model')){
   replace(node,'null');removedPicker++;return
  }
  if(tag==='button'&&className==='rail-btn model-manager-open'){replace(node,'null');removedManager++;return}
  if(tag==='button'&&className==='workspace-model-card'){
   const children=property(props,'children');assert.ok(ts.isArrayLiteralExpression(children))
   assert.equal(children.elements.length,3)
   for(const [index,text] of ['Nori','Local assistant','Response settings ↗'].entries()){
    const child=property(children.elements[index].arguments[1],'children');assert.ok(child);replace(child,JSON.stringify(text))
   }
   cardUpdated++;return
  }
 }
 if(ts.isStringLiteralLike(node)&&node.text==='Model, effort and session settings'){replace(node,JSON.stringify('Response and session settings'));titleUpdated++}
 ts.forEachChild(node,walk)
}
walk(source)
assert.deepEqual([removedPicker,removedManager,cardUpdated,titleUpdated],[1,1,1,1])
edits.sort((a,b)=>b.start-a.start)
for(let i=1;i<edits.length;i++)assert.ok(edits[i].end<=edits[i-1].start,'Overlapping UI edits')
let patched=original
for(const edit of edits)patched=patched.slice(0,edit.start)+edit.text+patched.slice(edit.end)
assert.equal(ts.createSourceFile(path,patched,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0)
const output='C:/Nori/.work/model-team-integration/patch/renderer.js'
writeFileSync(output,patched)
writeFileSync('C:/Nori/.work/model-team-integration/renderer-patch.json',JSON.stringify({path:path.replaceAll('\\','/'),source:output,edits,originalBytes:Buffer.byteLength(original),patchedBytes:Buffer.byteLength(patched)},null,2))
console.log(JSON.stringify({renderer:path,expressionsChanged:edits.length,removedModelPicker:true,removedModelManagerButton:true,otherSourceBytesPreserved:true}))
