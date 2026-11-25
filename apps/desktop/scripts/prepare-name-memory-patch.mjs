import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {existsSync,mkdirSync,writeFileSync,copyFileSync} from 'node:fs'
const a=createRequire(import.meta.url)('@electron/asar'),archive='C:/Program Files/Nori/resources/app.asar',stage='C:/Nori/.work/name-memory-repair'
assert.ok(!existsSync(stage),'Existing patch preserved');mkdirSync(stage)
for(const file of ['nori-learning.mjs','nori-v2-query.mjs']){
 const name=a.listPackage(archive).find(x=>x.endsWith(String.fromCharCode(92)+file))
 let text=a.extractFile(archive,name.slice(1)).toString()
 if(file==='nori-learning.mjs'){
  text="import {nameDeclaration} from './personal-name.mjs'\n"+text
  const anchor='  const knowledge = input.match(KNOWLEDGE)';assert.equal(text.split(anchor).length,2)
  text=text.replace(anchor,"  const name = nameDeclaration(input)\n  if (name) return { kind: 'name', name, saved: add('knowledge', `User-provided name: ${name}`) }\n"+anchor)
 }else{
  text="import {savedNameAnswer} from './personal-name.mjs'\n"+text
  const anchor="        if (learning.kind === 'cleared') {";assert.equal(text.split(anchor).length,2)
  text=text.replace(anchor,`        const nameAnswer = learning.kind === 'name'
          ? learning.saved ? \`I saved the name you provided: \${learning.name}.\` : \`You told me your name is \${learning.name}, but I could not save it to local memory.\`
          : savedNameAnswer(rawGoal, listLearnedMemory().entries)
        if (nameAnswer) {
          remember(rawGoal, nameAnswer)
          yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: nameAnswer } } }
          yield { type: 'result', subtype: 'success', result: nameAnswer, total_cost_usd: 0 }
          continue
        }
`+anchor)
 }
 writeFileSync(stage+'/'+file,text)
}
copyFileSync('C:/Nori/apps/desktop/bridge/personal-name.mjs',stage+'/personal-name.mjs')
console.log(JSON.stringify({patchedModules:3,installedChanged:false}))
