import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const req=createRequire(import.meta.url),a=req('@electron/asar'),ts=req('typescript'),hash=b=>createHash('sha256').update(b).digest('hex');
const target='C:/Program Files/Nori/resources/app.asar',stage='C:/Nori/.work/direct-workspace',work=stage+'/code-workspace';
assert.ok(!existsSync(stage));mkdirSync(stage);mkdirSync(work);
const names=a.listPackage(target),renderer=names.find(x=>x.endsWith('index-ari1On6a.js')).slice(1),html=names.find(x=>/dist[\\/]index.html$/.test(x)).slice(1);
const norm=x=>x.replaceAll('\\','/');
try {
 a.extractAll(target,work);let s=a.extractFile(target,renderer).toString();
 const start=s.indexOf('function iZ({onStart:e,onSkip:t})'),end=s.indexOf('var aZ=',start);assert.ok(start>0&&end>start);
 const gate='function iZ({onSkip:t}){(0,m.useEffect)(()=>{t()},[]);return null}';
 s=s.slice(0,start)+gate+s.slice(end);
 assert.ok(s.includes('onSkip:()=>void ee(!0)'));
 assert.equal(s.split('function HQ(){IQ=!0,PQ.forEach(VQ)}').length,2);
 s=s.replace('function HQ(){IQ=!0,PQ.forEach(VQ)}','function HQ(){IQ=!1}');
 assert.equal(ts.createSourceFile('renderer.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
 const effects=[];let skips=0;const c=vm.createContext({m:{useEffect:f=>effects.push(f)}});vm.runInContext(gate,c);
 c.skip=()=>skips++;assert.equal(vm.runInContext('iZ({onSkip:skip})',c),null);assert.equal(skips,0);effects[0]();assert.equal(skips,1);
 const next='dist/assets/index-'+hash(Buffer.from(s)).slice(0,16)+'.js';
 writeFileSync(work+'/'+next,s);rmSync(work+'/'+norm(renderer));
 let page=a.extractFile(target,html).toString();assert.ok(page.includes('/'+norm(renderer).slice(5)));page=page.replace('/'+norm(renderer).slice(5),'/'+next.slice(5));writeFileSync(work+'/'+norm(html),page);
 const removed=[norm(renderer),'dist/audio/work.mp3','dist/video/nori-entity-startup.mp4','dist/video/nori-startup.mp4'];
 for(const p of removed.slice(1)){assert.ok(existsSync(work+'/'+p));rmSync(work+'/'+p)}
 await a.createPackage(work,stage+'/app.asar.next');
 const afterNames=a.listPackage(stage+'/app.asar.next').map(x=>norm(x.slice(1))),beforeNames=names.map(x=>norm(x.slice(1)));
 assert.deepEqual(afterNames.filter(x=>!beforeNames.includes(x)),[next]);
 assert.deepEqual(beforeNames.filter(x=>!afterNames.includes(x)).sort(),removed.slice().sort());
 for(const n of names){const p=norm(n.slice(1));if(removed.includes(p)||p===norm(html))continue;const x=a.statFile(target,n.slice(1));if(x.files)continue;const nn=a.listPackage(stage+'/app.asar.next').find(z=>norm(z.slice(1))===p);assert.equal(hash(a.extractFile(target,n.slice(1))),hash(a.extractFile(stage+'/app.asar.next',nn.slice(1))),p)}
 const plan={target,source:stage+'/app.asar.next',before:hash(readFileSync(target)),after:hash(readFileSync(stage+'/app.asar.next')),verified:true,removed,changed:[norm(html),next],newRenderer:next,checks:{directWorkspaceEffect:true,noWelcomeGate:true,skipIntroCallbackPreserved:true,syntaxValid:true,unchangedFilesVerified:true,uniqueAssetUrl:true,musicPreloadDisabled:true}};
 writeFileSync(stage+'/plan.json',JSON.stringify(plan,null,2));console.log(JSON.stringify(plan));
}finally{assert.equal(realpathSync(work).toLowerCase(),resolve(work).toLowerCase());rmSync(work,{recursive:true})}
