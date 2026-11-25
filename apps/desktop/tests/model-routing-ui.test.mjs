import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname,resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire('C:/Nori/apps/desktop/package.json'),ts=require('typescript')
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const assetRoot=join(root,'dist/assets')
const assets=readdirSync(assetRoot).filter(name=>name.endsWith('.js')).map(name=>({name,text:readFileSync(join(assetRoot,name),'utf8')}))
const renderer=assets.filter(asset=>asset.text.includes('workspace-model-card'))
assert.equal(renderer.length,1)
const source=ts.createSourceFile(renderer[0].name,renderer[0].text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
const property=(node,name)=>node?.properties?.find(item=>item.name?.text===name)?.initializer
const calls=[]
function walk(node){if(ts.isCallExpression(node)&&ts.isStringLiteralLike(node.arguments[0]??{}))calls.push(node);ts.forEachChild(node,walk)}
walk(source)

test('normal desktop offers response controls without a model picker or model-management button',()=>{
 assert.equal(source.parseDiagnostics.length,0)
 const selects=calls.filter(call=>call.arguments[0].text==='select')
 assert.equal(selects.filter(call=>property(call.arguments[1],'aria-label')?.text==='Local model').length,0)
 assert.equal(selects.filter(call=>property(call.arguments[1],'aria-label')?.text==='Response style').length,1)
 assert.equal(selects.filter(call=>property(call.arguments[1],'aria-label')?.text==='Noise guard').length,1)
 assert.equal(calls.filter(call=>property(call.arguments[1],'className')?.text==='rail-btn model-manager-open').length,0)
 const card=calls.find(call=>property(call.arguments[1],'className')?.text==='workspace-model-card')
 const labels=property(card.arguments[1],'children').elements.map(child=>property(child.arguments[1],'children')?.text)
 assert.deepEqual(labels,['Nori','Local assistant','Response settings ↗'])
})

test('source HUD agrees with the packaged one-assistant interface',()=>{
 const text=readFileSync('C:/Nori/apps/desktop/src/ui/Hud.tsx','utf8')
 assert.doesNotMatch(text,/aria-label="Local model"|model-manager-open|Current model/)
 assert.match(text,/aria-label="Response style"/)
 assert.match(text,/workspace-quit/)
 const parsed=ts.createSourceFile('Hud.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 assert.equal(parsed.parseDiagnostics.length,0)
})
