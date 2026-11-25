// Diagnostic owner launcher; never changes the selected desktop or persists keys.
const assert=require('node:assert/strict')
const {resolve,join}=require('node:path')
const {spawnSync}=require('node:child_process')
const packagedRoot=process.argv[3] ? resolve(process.argv[3]) : null
if(packagedRoot)assert.equal(resolve(process.execPath).toLowerCase(),join(packagedRoot,'Nori.exe').toLowerCase())
const {startNativeService}=require(packagedRoot
  ? join(packagedRoot,'resources/app.asar/desktop/native-service.cjs')
  : '../desktop/native-service.cjs')

async function main(){
  const root=resolve(process.argv[2] || '')
  if(!process.argv[2])throw Error('Explicit copied-suite root required')
  const configName='state/private/runtime-resource.json'
  const ledger=()=>{
    const code=`import sys,json,pathlib
root=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(root))
from runtime.compute.private_resource_budget import PrivateResourceBudget
config=json.loads((root/'state/private/runtime-resource.json').read_text())['resource_coordination']
print(json.dumps(PrivateResourceBudget(root/config['database'],root,config['limits']).snapshot()))`
    const result=spawnSync(join(root,'python/Python311/python.exe'),['-I','-B','-c',code,root],{
      cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024})
    if(result.error || result.status!==0)throw Error('Copied private resource snapshot failed')
    return JSON.parse(result.stdout)
  }
  assert.equal(ledger().reservation_count,0)
  const service=await startNativeService({root,
    environment:{...process.env,NORI_RUNTIME_RESOURCE_CONFIG:configName,
      NORI_RUNTIME_RESOURCE_COORDINATION:'1',NORI_MINI_AUTO_MODEL:'0',
      NORI_RUNTIME_PYTHON:join(root,'python/Python311/python.exe')}})
  try{
    assert.equal(service.status.resourceCoordination,true)
    assert.equal(ledger().reservation_count,1)
    const response=await fetch(`${service.environment.NORI_RUNTIME_URL}/v1/chat`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{'content-type':'application/json',Authorization:`Bearer ${service.environment.NORI_RUNTIME_API_KEY}`},
      body:JSON.stringify({model_id:service.status.modelId,messages:[{role:'user',content:'Say hello briefly.'}],
        max_tokens:8,stream:false})})
    assert.equal(response.status,200)
    assert.ok((await response.json()).text.trim())
  }finally{await service.stop()}
  assert.equal(ledger().reservation_count,0)
  console.log(JSON.stringify({root,desktop_launcher_resource_acknowledged:true,
    environment_selected_private_profile:true,
    packaged_executable_and_archived_launcher_used:Boolean(packagedRoot),
    electron_gui_tested:false,
    actual_model_answer_nonempty:true,reservation_observed:true,remaining_reservations:0,
    selected_desktop_changed:false,release_verified:false}))
}
main().catch(()=>{console.error('Desktop resource service probe failed; no credentials logged');process.exitCode=1})
