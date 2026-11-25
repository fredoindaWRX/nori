import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import vm from 'node:vm';
const a=createRequire(import.meta.url)('@electron/asar');
const results=[];
for(const [label,p] of [['before','C:/Program Files/Nori/resources/app.asar'],['after','C:/Nori/.work/no-work-music/app.asar.next']]){
 const s=a.extractFile(p,'dist\\assets\\index-ari1On6a.js').toString();
 const start=s.indexOf('var jQ=new Map'),end=s.indexOf('var YQ=',start);assert.ok(start>0&&end>start);
 let plays=0;const frames=[];
 const c=vm.createContext({Audio:class {constructor(){this.paused=true;this.volume=0}addEventListener(){}play(){plays++;this.paused=false;return Promise.resolve()}pause(){this.paused=true}},requestAnimationFrame:f=>{frames.push(f);return frames.length},cancelAnimationFrame(){},performance:{now:()=>10000}});
 vm.runInContext(s.slice(start,end),c);
 vm.runInContext('HQ();qQ(true);JQ(true);JQ(false);qQ(false);qQ(true)',c);
 assert.equal(plays,label==='before'?1:0);
 for(let i=0;i<frames.length&&i<100;i++)frames[i]();
 if(label==='after')assert.equal(plays,0);
 results.push({label,playCalls:plays,taskMusicPrevented:label==='after'});
}
writeFileSync('C:/Nori/.work/no-work-music/playback-verification.json',JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify({passed:true,results}));
