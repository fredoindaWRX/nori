const test=require('node:test'),assert=require('node:assert/strict');
const {createBrowserHost}=require('../desktop/browser-host.cjs');
function fixture({close,load,stopTimeoutMs=1000,backendActive=()=>true}={}){
 const window={},event={};let closes=0,starts=0;
 const backend={status:()=>({active:backendActive()}),close:async()=>{closes++;await close?.();}};
 const host=createBrowserHost({dialog:{showMessageBox:async()=>({response:0})},getWindow:()=>window,owns:value=>value===event,stopTimeoutMs,load:load||(async()=>({chromium:{},startOwnedBrowser:async()=>{starts++;return backend;}}))});
 return{host,event,closes:()=>closes,starts:()=>starts};
}
test('overlapping stops wait for the same owned browser close',async()=>{
 let finish;const closed=new Promise(resolve=>{finish=resolve;});const f=fixture({close:()=>closed});await f.host.start(f.event,{url:'https://docs.python.org/'});
 let firstDone=false,secondDone=false;const first=f.host.stop().then(()=>{firstDone=true;}),second=f.host.stop().then(()=>{secondDone=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(firstDone,false);assert.equal(secondDone,false);assert.equal(f.closes(),1);
 await assert.rejects(f.host.start(f.event,{url:'https://docs.python.org/'}),/cannot start/);
 finish();await Promise.all([first,second]);assert.equal(firstDone,true);assert.equal(secondDone,true);assert.equal(f.closes(),1);
});
test('stop waits for pending startup to quiesce without opening a browser afterward',async()=>{
 let finishLoad,starts=0;const loading=new Promise(resolve=>{finishLoad=resolve;});const f=fixture({load:()=>loading});
 const startup=f.host.start(f.event,{url:'https://docs.python.org/'});const startupRejected=assert.rejects(startup,/owner changed/);
 let stopped=false;const stop=f.host.stop().then(()=>{stopped=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);
 finishLoad({chromium:{},startOwnedBrowser:async()=>{starts++;return{status:()=>({active:true}),close:async()=>{}};}});await startupRejected;await stop;assert.equal(starts,0);assert.equal(stopped,true);
});
test('reading inactive status preserves the outstanding cleanup handle',async()=>{
 let active=true,finish;const closed=new Promise(resolve=>{finish=resolve;}),f=fixture({backendActive:()=>active,close:()=>closed});await f.host.start(f.event,{url:'https://docs.python.org/'});
 active=false;assert.equal(f.host.status().active,false);let done=false;const stop=f.host.stop().then(()=>{done=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);assert.equal(f.closes(),1);finish();await stop;
});
test('a browser shutdown deadline fails honestly and blocks replacement sessions',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const f=fixture({close:()=>pending,stopTimeoutMs:20});await f.host.start(f.event,{url:'https://docs.python.org/'});
 await assert.rejects(f.host.stop(),/shutdown deadline/);await assert.rejects(f.host.stop(),/shutdown deadline/);await assert.rejects(f.host.start(f.event,{url:'https://docs.python.org/'}),/cannot start/);assert.equal(f.closes(),1);finish();
 await new Promise(resolve=>setImmediate(resolve));await f.host.start(f.event,{url:'https://docs.python.org/'});assert.equal(f.starts(),2);await f.host.stop();
});
