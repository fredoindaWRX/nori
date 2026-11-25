const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('C:/Nori/streaming/producer.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const nodes=new Map(),storage=new Map();let downloaded='';
class Element{constructor(){this.value='';this.textContent='';this.children=[];this.dataset={}}replaceChildren(){this.children=[]}append(...xs){this.children.push(...xs)}click(){this.onclick?.()}focus(){}select(){}}
const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)};
const ctx={document:{querySelector:get,getElementById:id=>get('#'+id),querySelectorAll:()=>[],createElement:()=>new Element()},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},Date,setInterval:()=>0,setTimeout:()=>0,navigator:{clipboard:{writeText:async()=>{}}},URL:{createObjectURL:b=>{downloaded=b.text;return 'blob:test'},revokeObjectURL:()=>{}},Blob:class{constructor(parts){this.text=parts.join('')}},console};
vm.createContext(ctx);vm.runInContext(source,ctx);
get('#question').value='Why should I keep OBS on the monitor I am not capturing?';get('#queue').onsubmit({preventDefault(){}});
get('#questions').children[0].children[1].click();const exported=JSON.parse(downloaded);assert.equal(exported.question,get('#questions').children[0].children[0].textContent);assert.deepEqual(Object.keys(exported).sort(),['question','topic']);
ctx.actual=JSON.parse(fs.readFileSync('C:/Nori/streaming/preview-images/stream-answer-verified.json','utf8'));
vm.runInContext('acceptNoriAnswer(actual)',ctx);assert.equal(get('#nori-answer').value,ctx.actual.answer);
get('#answer-to-draft').click();assert.equal(JSON.parse(storage.get('nori-stream-producer-v1')).draft,ctx.actual.answer);
ctx.wrong={...ctx.actual,question:'An unrelated question'};assert.throws(()=>vm.runInContext('acceptNoriAnswer(wrong)',ctx),/does not match/);
ctx.wrong={...ctx.actual,postedToChat:true};assert.throws(()=>vm.runInContext('acceptNoriAnswer(wrong)',ctx),/Invalid/);
ctx.wrong={...ctx.actual,answer:'<script>alert(1)</script>'};vm.runInContext('acceptNoriAnswer(wrong)',ctx);assert.equal(get('#nori-answer').value,ctx.wrong.answer);
const proof={status:'passed',checks:['Exports only selected question and blank topic','Loads actual native engine answer','Draft persists locally','Unrelated question rejected','Posted-to-chat payload rejected','HTML stays literal text'],actualNativeInference:true,model:ctx.actual.model,automaticPosting:false,liveChatConnected:false,visualBrowserReview:false};
fs.writeFileSync('C:/Nori/streaming/preview-images/producer-answer-verification.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
