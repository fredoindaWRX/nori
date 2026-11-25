import {spawnSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {existsSync} from 'node:fs'
import {nativeResourceFiles} from './native-payload-plan.mjs'

const stage=resolve(process.argv[2]??'')
if(!process.argv[2]||!existsSync(join(stage,'native-payload-receipt.json')))throw Error('Completed staged suite required')
for(const path of nativeResourceFiles)if(!existsSync(join(stage,path)))throw Error(`Missing resource component: ${path}`)
if(existsSync(join(stage,'runtime/norllama/resource-coordination.experimental.json')))throw Error('Diagnostic config leaked into payload')
const code=`import sys,pathlib,json,importlib
root=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(root));sys.path.insert(0,str(root/'runtime/norllama'))
names=['resource_startup','runtime.compute.resource_budget','runtime.compute.budgeted_worker','runtime.compute.private_resource_budget']
for name in names:
 module=importlib.import_module(name)
 if not pathlib.Path(module.__file__).resolve().is_relative_to(root):raise RuntimeError('Import escaped staged suite')
import resource_startup
if resource_startup.resource_launcher({},root) is not None:raise RuntimeError('Default launch changed')
wrapper=root/'runtime/compute/verify-budget-acl.ps1'
verifier=root/'apps/desktop/scripts/verify-private-state-acl.ps1'
if not wrapper.is_file() or not verifier.is_file():raise RuntimeError('Private verifier absent')
print(json.dumps({'modules_imported_from_stage':names,'diagnostic_config_excluded':True,'state_modified':False,'worker_launched':False,'production_enabled':False}))
`
const result=spawnSync(join(stage,'python/Python311/python.exe'),['-I','-B','-c',code,stage],{
  cwd:stage,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024
})
if(result.error||result.status!==0)throw Error(result.error?.message??result.stderr)
console.log(result.stdout.trim())
