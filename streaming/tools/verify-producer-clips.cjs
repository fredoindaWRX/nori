const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('C:/Nori/streaming/producer.html','utf8');const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
let now=100000;const saved=new Map();let exported='';
function load(){
 const nodes=new Map();class Element{constructor(){this.value='';this.textContent='';this.children=[];this.dataset={}}replaceChildren(){this.children=[]}append(...xs){this.children.push(...xs)}click(){this.onclick?.()}focus(){}select(){}}
 const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)};
 const ctx={document:{querySelector:get,getElementById:id=>get('#'+id),querySelectorAll:()=>[],createElement:()=>new Element()},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},Date:class extends Date{static now(){return now}},setInterval:()=>0,setTimeout:()=>0,navigator:{clipboard:{writeText:async()=>{}}},URL:{createObjectURL:b=>{exported=b.text;return 'blob:test'},revokeObjectURL:()=>{}},Blob:class{constructor(parts){this.text=parts.join('')}},console};vm.createContext(ctx);vm.runInContext(code,ctx);return {ctx,get};
}
let app=load();app.get('#clip-form').onsubmit({preventDefault(){}});assert.match(app.get('#save-status').textContent,/Start the session/);
app.get('#timer').click();now+=65000;app.get('#clip-label').value='Funny fix';app.get('#clip-form').onsubmit({preventDefault(){}});let state=JSON.parse(saved.get('nori-stream-producer-v1'));assert.equal(state.clips[0].seconds,65);assert.equal(state.clips[0].label,'Funny fix');
app=load();assert.equal(app.get('#timer').textContent,'Pause timer');assert.equal(app.get('#clock').textContent,'00:01:05');assert.match(app.get('#clips').children[0].children[0].textContent,/Funny fix/);
app.get('#timer').click();now+=10000;app=load();assert.equal(app.get('#clock').textContent,'00:01:05');assert.equal(app.get('#timer').textContent,'Resume timer');
app.get('#export').click();assert.match(exported,/CLIP MARKERS\n00:01:05 \| Funny fix \| Starting Soon/);
app.get('#clips').children[0].children[1].click();assert.equal(JSON.parse(saved.get('nori-stream-producer-v1')).clips.length,0);
app.get('#reset').click();app=load();assert.equal(app.get('#clock').textContent,'00:00:00');
const result={status:'passed',checks:['Unstarted clip prompt','Timestamped clip marker','Running timer survives reload','Paused timer survives reload','Clip survives reload','Export includes timestamp and scene','Marker removal persists','Timer reset persists'],visual_browser_review:false,live_connections:false};fs.writeFileSync('C:/Nori/streaming/preview-images/producer-clip-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
