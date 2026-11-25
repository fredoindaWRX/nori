const test=require('node:test'),assert=require('node:assert/strict');
const {nativeCompatiblePayload}=require('../desktop/automatic-text-service.cjs');
const offered=name=>({type:'function',function:{name,parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}});
test('named selection retains only the requested schema without mutating input or granting execution',()=>{
 const selected=offered('read_file'),other=offered('write_file');
 const body={model:'nori-auto',messages:[{role:'user',content:'Inspect a file'}],tools:[other,selected],tool_choice:{type:'function',function:{name:'read_file'}},parallel_tool_calls:false};
 const snapshot=structuredClone(body),result=nativeCompatiblePayload(body);
 assert.deepEqual(body,snapshot);assert.equal(result.tool_choice,'required');assert.deepEqual(result.tools,[selected]);
 assert.equal(result.tools[0].function.parameters,selected.function.parameters);assert.equal(result.messages,body.messages);assert.equal(result.parallel_tool_calls,false);assert.equal(result.executionAuthorized,undefined);
});
test('unavailable or ambiguous named functions fail closed',()=>{
 for(const tools of [undefined,[],[offered('other')],[offered('read_file'),offered('read_file')]])assert.throws(()=>nativeCompatiblePayload({tools,tool_choice:{type:'function',function:{name:'read_file'}}}),/one offered/);
});
test('ordinary and automatic selection remain unchanged',()=>{
 for(const choice of [undefined,'auto','none','required']){const body={tool_choice:choice};assert.equal(nativeCompatiblePayload(body),body);}
});
test('malformed selectors are rejected and cannot pollute the following turn',()=>{
 for(const choice of [null,'unknown',[],{type:'function',function:{name:'read_file',extra:true}},{type:'function',function:{name:'../shell'}},{type:'function',function:{name:'read_file'},executionAuthorized:true}])assert.throws(()=>nativeCompatiblePayload({tools:[offered('read_file')],tool_choice:choice}),/Invalid/);
 const following={messages:[{role:'user',content:'Good evening'}]};assert.equal(nativeCompatiblePayload(following),following);assert.equal(following.tools,undefined);
});
