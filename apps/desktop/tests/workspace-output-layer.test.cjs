const test=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
test('workspace output previews paint above the opaque conversation surface',()=>{
  const css=readFileSync(resolve(__dirname,'../src/index.css'),'utf8')
  const layer=selector=>{
    const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
    const matches=[...css.matchAll(new RegExp(escaped+'\\s*\\{([^}]+)\\}','g'))]
    const value=matches.map(match=>match[1].match(/z-index:\s*(\d+)/)?.[1]).filter(Boolean).at(-1)
    assert.ok(value,selector+' has an explicit layer')
    return Number(value)
  }
  assert.ok(layer('.nori-workspace .blades-stack')>layer('.nori-workspace .log'))
})
