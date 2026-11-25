import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import {journalWorkflow} from './project-workflow-journal.mjs'

await journalWorkflow('build','renderer','apps/desktop/scripts/build-renderer.mjs',()=>{
  for(const [script,args] of [
    ['scripts/vendor-mediapipe.mjs',[]],['scripts/vendor-cesium.mjs',[]],
    ['node_modules/typescript/bin/tsc',['-b']],['node_modules/vite/bin/vite.js',['build']],
  ]) {
    const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'..',script),...args],
      {cwd:resolve(import.meta.dirname,'..'),shell:false,windowsHide:true,stdio:'inherit'})
    if(result.error||result.status!==0)throw Error('Renderer build step failed: '+script)
  }
})
