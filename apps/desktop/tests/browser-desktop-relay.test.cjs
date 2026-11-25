const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=ts.createSourceFile('main.cjs',fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function relay({fail=false,probe=false,quitting=false}={}){
 let listener;function walk(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='bridge.on'&&node.arguments[0]?.text==='message')listener=node.arguments[1];ts.forEachChild(node,walk);}walk(source);assert.ok(listener);
 const sent=[],calls=[];const context={bridge:{connected:true,send:value=>sent.push(value)},PROBE_SESSION:probe,isQuitting:quitting,browserHost:{call:async(operation,args)=>{calls.push({operation,args});if(fail){fail=false;throw Error('synthetic browser action failure');}return{status:'ready'};}},computerHost:{call:async()=>{throw Error('Wrong worker dispatch');}}};
 vm.runInNewContext('globalThis.invoke='+listener.getText(source),context);return{invoke:context.invoke,sent,calls};
}
const id='12345678-1234-1234-1234-123456789abc';
test('browser messages reach their own worker and return correlated results',async()=>{
 const f=relay();await f.invoke({kind:'nori-browser-call',id,operation:'status',args:{}});assert.equal(f.calls.length,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].kind,'nori-browser-result');assert.equal(f.sent[0].id,id);assert.equal(f.sent[0].result.status,'ready');
});
test('a failed browser action is reported once and the following call recovers',async()=>{
 const f=relay({fail:true});await f.invoke({kind:'nori-browser-call',id,operation:'status'});assert.match(f.sent[0].error,/synthetic browser action failure/);
 await f.invoke({kind:'nori-browser-call',id:'abcdef12-1234-1234-1234-123456789abc',operation:'status'});assert.equal(f.calls.length,2);assert.equal(f.sent.length,2);assert.equal(f.sent[1].result.status,'ready');assert.equal(f.sent[1].error,undefined);
});
test('invalid correlation IDs and disabled owner states cannot dispatch browser actions',async()=>{
 const f=relay();await f.invoke({kind:'nori-browser-call',id:'invalid',operation:'status'});assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);
 for(const options of [{probe:true},{quitting:true}]){const locked=relay(options);await locked.invoke({kind:'nori-browser-call',id,operation:'status'});assert.equal(locked.calls.length,0);assert.match(locked.sent[0].error,/unavailable/);}
});
test('desktop cleanup accounts for the browser stop promise',()=>{
 const stops=[];function walk(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='Promise.allSettled'&&ts.isArrayLiteralExpression(node.arguments[0]))stops.push(...node.arguments[0].elements.map(item=>item.getText(source)));ts.forEachChild(node,walk);}walk(source);
 assert.ok(stops.includes('browserHost?.stop()'));
});
