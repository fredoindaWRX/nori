import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('actual dashboard renders scope counts without claiming completion or worker activity', async()=>{
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8')
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],{
    textContent:'',replaceChildren(...children){this.children=children},
  }]))
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1]
  const document={hidden:true,getElementById:id=>{assert.ok(elements.has(id),id);return elements.get(id)},
    createElement:()=>({textContent:''}),addEventListener(){}}
  const context={document,location:{pathname:'/project/'},setInterval(){},fetch:()=>new Promise(()=>{})}
  runInNewContext(script,context)
  const status={observedAt:null,work:{summary:'Still in progress',blockers:[]},
    roadmap:{available:true,releaseState:'NOT_VERIFIED',requirementCount:39,componentCount:12},
    coordinator:{available:true,head:'140400e97735',cleanTracked:true},canonical:{available:false},evidence:{}}
  context.status=status
  runInNewContext('render(status)',context)
  assert.equal(elements.get('release').textContent,'NOT_VERIFIED')
  assert.match(elements.get('roadmap').textContent,/39 requirements · 12 components/)
  assert.match(elements.get('roadmap').textContent,/not passed checks/)
  assert.match(elements.get('coordinator').textContent,/liveness is not verified/)
  assert.match(elements.get('blockers').children[0].textContent,/empty list does not mean/)
  status.roadmap={available:false};status.coordinator={available:false}
  status.work.blockers=['<img src=x onerror=alert(1)>']
  runInNewContext('render(status)',context)
  assert.equal(elements.get('release').textContent,'No roadmap evidence')
  assert.match(elements.get('coordinator').textContent,/unavailable/)
  assert.equal(elements.get('blockers').children[0].textContent,status.work.blockers[0])
  assert.doesNotMatch(script,/innerHTML/)
})
