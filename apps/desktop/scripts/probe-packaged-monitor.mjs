import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const candidate=process.argv[2]
if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate??''))throw Error('Safe candidate required')
const root=resolve(import.meta.dirname,`../release/native-desktop-${candidate}/win-unpacked`)
const moduleUrl=pathToFileURL(resolve(root,'resources/NoriSuite/integrations/project-monitor/server.mjs')).href
const code=`
const {createMonitor}=await import(${JSON.stringify(moduleUrl)});
const server=createMonitor();await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
 const base='http://127.0.0.1:'+server.address().port;
 const page=await fetch(base+'/project/'),html=await page.text();
 const response=await fetch(base+'/project/api/status'),data=await response.json();
 if(page.status!==200||response.status!==200||!html.includes('Roadmap release')||
 !data.roadmap.available||data.roadmap.requirementCount!==39||data.readOnly!==true||data.canonical.available!==false)
 throw Error('Packaged dashboard qualification failed');
 console.log(JSON.stringify({pageStatus:page.status,statusStatus:response.status,
 roadmap:data.roadmap,gitAvailable:data.canonical.available,readOnly:data.readOnly}));
}finally{await new Promise(r=>server.close(r));}
`
const result=spawnSync(resolve(root,'Nori.exe'),['--input-type=module','-e',code],{
 cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,
 encoding:'utf8',timeout:15000,maxBuffer:65536,
})
if(result.error||result.status!==0)throw Error(`Packaged monitor failed: ${result.error?.message??result.stderr}`)
const evidence=JSON.parse(result.stdout.trim())
console.log(JSON.stringify({candidate,...evidence,installedSuiteVerified:false}))
