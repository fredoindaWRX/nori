import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
const require=createRequire(import.meta.url),ts=require('typescript')
function load(path,mocks={}){
 const source=readFileSync(new URL(path,import.meta.url),'utf8')
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
 const exports={};const context=vm.createContext({exports,require:name=>{assert.ok(name in mocks,`Unexpected dependency: ${name}`);return mocks[name]},Audio:class{constructor(){throw Error('Automatic music is forbidden')}},AudioContext:class{constructor(){throw Error('Automatic audio context is forbidden')}}})
 vm.runInContext(js,context);return exports
}
test('startup gate renders no overlay and opens workspace only through skip callback',()=>{
 const effects=[];let opened=0,intros=0
 const {Ignition}=load('../src/ui/Ignition.tsx',{react:{useRef:value=>({current:value}),useEffect:callback=>effects.push(callback)}})
 assert.equal(Ignition({onStart:()=>intros++,onSkip:()=>opened++}),null)
 assert.equal(opened,0);assert.equal(effects.length,1);effects[0]()
 assert.equal(opened,1);assert.equal(intros,0)
})
test('music compatibility API cannot construct or play audio through any task transition',()=>{
 const music=load('../src/lib/music.ts')
 music.enable();music.working(true);music.duck(true);music.duck(false);music.working(false);music.working(true);music.stopAll()
})
