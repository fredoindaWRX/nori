import test from 'node:test'
import assert from 'node:assert/strict'
import {appRequest,targetOf,listInstalledApps} from '../bridge/app-launcher.mjs'
const apps=[{name:'Calculator',id:'Microsoft.Calculator!App'}]
test('catalog lookup never activates the named app',async()=>{
 let opened=0
 const result=await appRequest('Do I have Calculator installed?',{list:async()=>apps,open:async()=>{opened++}})
 assert.match(result,/Start-menu entry found/);assert.equal(opened,0)
})
test('activation is bound to a catalog ID and does not claim an opened window',async()=>{
 const opened=[]
 const result=await appRequest('open Calculator',{list:async()=>apps,open:async id=>{opened.push(id);return{requested:true,verified:false}}})
 assert.deepEqual(opened,['Microsoft.Calculator!App']);assert.match(result,/launch is not confirmed/)
})
test('ambiguous matches and command-like paths never activate an app',async()=>{
 let opened=0
 await appRequest('open Calculator',{list:async()=>[...apps,{name:'Calculator',id:'Another.App'}],open:async()=>{opened++}})
 assert.equal(opened,0)
 for(const text of ['open C:\\Windows\\cmd.exe','open Calculator; shutdown','do not open Calculator','open https://example.com'])assert.equal(targetOf(text),null)
})
test('catalog validation discards shell-like identifiers and honors cancellation',async()=>{
 const entries=await listInstalledApps({run:async()=>JSON.stringify([{Name:'Safe',AppID:'Safe.App'},{Name:'Bad',AppID:'bad;cmd'}])})
 assert.deepEqual(entries,[{name:'Safe',id:'Safe.App'}])
 const abort=new AbortController();abort.abort(Error('owner canceled'))
 let listed=false
 await assert.rejects(appRequest('open Calculator',{signal:abort.signal,list:async()=>{listed=true;return apps}}),/owner canceled/)
 assert.equal(listed,false)
})
