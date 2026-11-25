import assert from 'node:assert/strict'
import{readFileSync,writeFileSync}from'node:fs'
import{createRequire}from'node:module'
const ts=createRequire(import.meta.url)('typescript'),path='C:/Nori/apps/desktop/src/lib/music.ts'
let text=readFileSync(path,'utf8')
const parsed=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const removals=parsed.statements.filter(n=>ts.isFunctionDeclaration(n)&&['playBoot','startAmbient'].includes(n.name?.text)).map(n=>[n.getFullStart(),n.end])
assert.equal(removals.length,2)
for(const[start,end]of removals.sort((a,b)=>b[0]-a[0]))text=text.slice(0,start)+text.slice(end)
text=text.replace(/^\/\*\*[\s\S]*?\*\//,'/** Local work cue only. Startup music has been removed. */')
const replacements=[
 ["type Cue = 'boot-music' | 'ambient' | 'work'","type Cue = 'work'"],
 ["const ALL: Cue[] = ['boot-music', 'ambient', 'work']","const ALL: Cue[] = ['work']"],
 ["  'boot-music': 'boot-music.mp3',\n  ambient: 'deep-ambient.wav',\n",''],
 ["const want: Record<Cue, number> = { 'boot-music': 0, ambient: 0, work: 0 }","const want: Record<Cue, number> = { work: 0 }"],
 ["ducked && cue !== 'boot-music'","ducked"],
 [";(['ambient', 'work'] as Cue[])",";(['work'] as Cue[])"],
]
text=text.replaceAll('\r\n','\n')
for(const[before,after]of replacements){assert.equal(text.split(before).length,2,before);text=text.replace(before,after)}
text=text.replace(/const LEVEL: Record<Cue, number> = \{[\s\S]*?\n\}/,'const LEVEL: Record<Cue, number> = { work: 0.11 }')
text=text.replace(/\/\*\* The boot cue's own dissolve,[\s\S]*?let dissolve:[^\n]*\n/,'')
text=text.replace(/  if \(dissolve\) \{\n    clearTimeout\(dissolve\)\n    dissolve = null\n  \}\n/,'')
writeFileSync(path,text)
const app='C:/Nori/apps/desktop/src/App.tsx';let s=readFileSync(app,'utf8').replaceAll('\r\n','\n')
assert.ok(s.includes('    music.startAmbient()'))
s=s.replace(/    \/\/ Start the music bed[\s\S]*?    music.enable\(\)\n    music.startAmbient\(\)/,'    // Initialize the optional work cue without playing a startup score.\n    music.enable()')
writeFileSync(app,s)
console.log('Removed startup music source hooks; work cue preserved')
