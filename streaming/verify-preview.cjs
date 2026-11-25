const { chromium } = require('C:/Users/Studio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
(async()=>{
 const root=__dirname; fs.mkdirSync(path.join(root,'preview-images'),{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 const failures=[]; page.on('pageerror',e=>failures.push(e.message));
 const collection=JSON.parse(fs.readFileSync(path.join(root,'obs/Nori-Animated-Monitors.json'),'utf8'));
 if(collection.scene_order.length!==10)throw Error('Wrong scene count');
 for(const source of collection.sources.filter(s=>s.id==='browser_source')){
  if(!fs.existsSync(source.settings.local_file))throw Error('Missing graphic');
  await page.goto(pathToFileURL(source.settings.local_file).href); await page.waitForFunction(()=>[...document.images].every(x=>x.complete&&x.naturalWidth>0));
  const geometry=await page.evaluate(()=>{const s=document.querySelector('.stage').getBoundingClientRect();const h=document.querySelector('.hero h1').getBoundingClientRect();return {w:s.width,h:s.height,titleRight:h.right,live:document.body.classList.contains('live'),background:getComputedStyle(document.querySelector('.stage')).backgroundColor}});
  if(geometry.w!==1920||geometry.h!==1080)throw Error('Incorrect stage geometry');
  if(geometry.live&&geometry.background!=='rgba(0, 0, 0, 0)')throw Error('Live scene is not transparent');
  if(!geometry.live){const before=await page.locator('.hero-symbol').evaluate(e=>getComputedStyle(e).transform);await page.waitForTimeout(250);const after=await page.locator('.hero-symbol').evaluate(e=>getComputedStyle(e).transform);if(before===after)throw Error('Symbol animation is not advancing');}
  await page.screenshot({path:path.join(root,'preview-images',path.basename(source.settings.local_file,'.html')+'.png')});
 }
 await page.goto(pathToFileURL(path.join(root,'preview.html')).href);
 for(const button of await page.locator('button').all()){await button.click();await page.locator('iframe').contentFrame().locator('.brand').waitFor()}
 await page.goto(pathToFileURL(path.join(root,'producer.html')).href);
 await page.getByRole('button',{name:'Break',exact:true}).click();
 if(!await page.locator('#cue').textContent().then(x=>x.includes('mute MIC and GUESTS')))throw Error('Break cue missing');
 await page.locator('#question').fill('How does Nori remember context?');await page.getByRole('button',{name:'Add',exact:true}).click();
 await page.getByRole('button',{name:'Answered',exact:true}).click();
 if(await page.locator('.item.done').count()!==1)throw Error('Question queue not working');
 await page.getByRole('button',{name:'Remove',exact:true}).click();
 await page.getByRole('button',{name:'Welcome',exact:true}).click();
 if(!(await page.locator('#draft').inputValue()).includes('Welcome!'))throw Error('Draft not loaded');
 await page.getByRole('button',{name:'Start timer',exact:true}).click();await page.waitForTimeout(1150);
 if(await page.locator('#clock').textContent()==='00:00:00')throw Error('Timer not advancing');
 await page.getByRole('button',{name:'Reset timer',exact:true}).click();
 await page.getByRole('button',{name:'Coding',exact:true}).click();
 await page.screenshot({path:path.join(root,'preview-images/producer.png'),fullPage:true});
 if(failures.length)throw Error(failures.join('\n'));
 console.log('Verified ten animated scene graphics and image loads, transparent coding/demo stages, advancing symbol animation, preview navigation, producer cues/question queue/drafts/timer. OBS import and monitor capture were also checked separately in the OBS app; guest sound remains untested.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
