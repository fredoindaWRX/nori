'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),child=require('node:child_process')
const DRIVER_SHA='b1c8da367d7bfad142f374a95d05f6ce4970ba0074f1453eee51e33199abd706'
const CORE_FILES=['nori/__init__.py','nori/shared/__init__.py','nori/shared/control_plane/__init__.py','nori/shared/control_plane/system_executor.py','nori/shared/control_plane/system_contract.py','nori/shared/control_plane/windows_job.py','nori/shared/control_plane/system_output.py','nori/shared/control_plane/v2.py']
const digest=b=>crypto.createHash('sha256').update(b).digest('hex')
function physical(file,kind){const full=path.resolve(file);for(let p=full;;p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())throw Error('Linked verification path refused');if(p===path.dirname(p))break}if(fs.realpathSync.native(full).toLowerCase()!==full.toLowerCase())throw Error('Redirected verification path refused');const s=fs.statSync(full);if(kind==='file'&&(!s.isFile()||s.nlink!==1)||kind==='directory'&&!s.isDirectory())throw Error('Invalid verification path');return full}
function relativeFile(value){if(typeof value!=='string'||!value||value.length>240||!/^[A-Za-z0-9_./-]+$/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..')||value.startsWith('/'))throw Error('Invalid fixed test file');return value}
function createFixedVerificationBroker({getCore=()=>null,runtime=null,spawn=child.spawn,read=fs.readFileSync,verifyProject=p=>physical(p,'directory'),verifyTest=(project,file)=>{const full=physical(path.join(project,relativeFile(file)),'file');if(!full.toLowerCase().startsWith(project.toLowerCase()+path.sep))throw Error('Test escaped project');return full},inspectExecutable=p=>{const full=physical(p,'file');return{path:full,sha256:digest(read(full))}},randomId=()=>crypto.randomBytes(16).toString('hex'),deadlineMs=300000}={}){
 const approved=new WeakSet(),projects=new Map()
 async function describe(project){
  const root=await verifyProject(project),core=getCore(),env=core?.environment||{},config=runtime||{suiteRoot:env.NORI_ROOT,python:env.NORI_RUNTIME_PYTHON,node:env.NORI_VERIFICATION_NODE}
  if(!config?.suiteRoot||!config.python){projects.delete(root.toLowerCase());return []}
  const driver=read(path.join(__dirname,'fixed-test-driver.py'));if(digest(driver)!==DRIVER_SHA)throw Error('Fixed verification driver changed')
  const hashes={};try{for(const name of CORE_FILES){try{hashes[name]=digest(read(path.join(config.suiteRoot,name)))}catch(error){if(name==='nori/shared/__init__.py'&&error.code==='ENOENT')hashes[name]=null;else throw error}}}catch{projects.delete(root.toLowerCase());return []}
  const python=await inspectExecutable(config.python),runners=new Map([['python-unittest',python]])
  if(config.node)runners.set('node-test',await inspectExecutable(config.node))
  const record={root,suiteRoot:config.suiteRoot,hashes,driver:driver.toString('utf8'),python,runners};projects.set(root.toLowerCase(),record)
  return [...runners].map(([runner,exe])=>({runner,executable:exe.path,executableSha256:exe.sha256,argvTemplate:runner==='python-unittest'?['-I','-B','<Nori fixed unittest driver>',root,'<validated project test files>']:['--test','<validated project test files>'],filePolicy:'Only validated project-relative test files, at most 24; no shell, installs or arbitrary flags. Trusted tests run with your Windows access; not an OS sandbox.'}))
 }
 async function planForScope({project,allowedFiles=[],contextFiles=[]}){
  const root=await verifyProject(project),record=projects.get(root.toLowerCase());if(!record)return null
  const names=[...new Set([...contextFiles,...allowedFiles].map(relativeFile))]
  const python=names.filter(n=>/(?:^|\/)test[^/]*\.py$|(?:^|\/)[^/]*_test\.py$/i.test(n)),node=names.filter(n=>/(?:^|\/)(?:test[^/]*|[^/]*[._-]test)\.(?:mjs|cjs|js)$/i.test(n))
  const runner=python.length?'python-unittest':node.length?'node-test':null,files=python.length?python:node
  if(!runner||!record.runners.has(runner)||files.length>24)return null
  for(const name of files)await verifyTest(root,name)
  const plan=Object.freeze({runner,project:root,files:Object.freeze([...files]),record,executable:record.runners.get(runner),timeoutSeconds:Math.max(1,Math.min(300,Math.floor(deadlineMs/1000)))});approved.add(plan);return plan
 }
 async function run(plan,{signal,onProgress=()=>{}}={}){
  if(!approved.has(plan))throw Error('A host-created fixed verification plan is required')
  signal?.throwIfAborted();const root=await verifyProject(plan.project);if(root!==plan.project)throw Error('Verification project changed')
  const exe=await inspectExecutable(plan.executable.path),python=await inspectExecutable(plan.record.python.path)
  if(exe.sha256!==plan.executable.sha256||python.sha256!==plan.record.python.sha256)throw Error('Consented verification executable changed')
  for(const [name,hash]of Object.entries(plan.record.hashes)){if(hash===null){try{read(path.join(plan.record.suiteRoot,name));throw Error('Public verification namespace changed')}catch(error){if(error.code!=='ENOENT')throw error}}else if(digest(read(path.join(plan.record.suiteRoot,name)))!==hash)throw Error('Public verification dependency changed')}
  for(const file of plan.files)await verifyTest(root,file)
  const request={task_id:randomId(),suite_root:plan.record.suiteRoot,core_hashes:plan.record.hashes,runner:plan.runner,project:root,files:plan.files,executable:exe.path,executable_sha256:exe.sha256,timeout_seconds:plan.timeoutSeconds}
  const encoded=JSON.stringify(request);if(Buffer.byteLength(encoded)>65536)throw Error('Verification request exceeds bound')
  const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','PATH','PATHEXT','TEMP','TMP','COMSPEC','PROCESSOR_ARCHITECTURE'])if(process.env[key])env[key]=process.env[key]
  env.PYTHONNOUSERSITE='1';env.PYTHONDONTWRITEBYTECODE='1'
  const childProcess=spawn(python.path,['-I','-B','-c',plan.record.driver,encoded],{cwd:plan.record.suiteRoot,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']})
  onProgress({status:'running',runner:plan.runner})
  return await new Promise((resolve,reject)=>{
   let stdout=[],stderr=[],outBytes=0,errBytes=0,closed=false,limited=false,stopTimer=null
   const stop=()=>{if(closed)return;try{childProcess.stdin.write('cancel\n')}catch{};if(!stopTimer)stopTimer=setTimeout(()=>{if(!closed)childProcess.kill()},10000)}
   const timer=setTimeout(stop,(plan.timeoutSeconds+15)*1000);signal?.addEventListener('abort',stop,{once:true})
   childProcess.stdout.on('data',chunk=>{const b=Buffer.from(chunk);outBytes+=b.length;if(outBytes>196608){limited=true;stop()}else stdout.push(b)})
   childProcess.stderr.on('data',chunk=>{const b=Buffer.from(chunk);errBytes+=b.length;if(errBytes>16384){limited=true;stop()}else stderr.push(b)})
   const cleanup=()=>{closed=true;clearTimeout(timer);if(stopTimer)clearTimeout(stopTimer);signal?.removeEventListener('abort',stop)}
   childProcess.once('error',error=>{cleanup();reject(Error('Fixed verifier could not start: '+String(error.message).slice(0,200)))})
   childProcess.once('close',code=>{cleanup();if(limited)return reject(Error('Verification driver output exceeded its bound; cleanup is not confirmed'))
    let result;try{result=JSON.parse(Buffer.concat(stdout).toString('utf8'))}catch{return reject(Error('Fixed verifier returned no valid receipt; cleanup is not confirmed'))}
    const r=result?.receipt;if(code!==0||result?.schema!=='nori.fixed-verification-result.v1'||result.task_id!==request.task_id||result.request_sha256!==digest(encoded)||result.runner!==plan.runner||!r||typeof r.process_tree_stopped!=='boolean'||typeof r.stdout!=='string'||typeof r.stderr!=='string'||Buffer.byteLength(r.stdout)>65536||Buffer.byteLength(r.stderr)>65536)return reject(Error('Fixed verification receipt failed validation'))
    const hashes=result.input_hashes_before,after=result.input_hashes_after;if(!hashes||!after||Object.keys(hashes).sort().join('|')!==[...plan.files].sort().join('|')||JSON.stringify(hashes)!==JSON.stringify(after))return reject(Error('Test inputs changed during verification'))
    const passed=r.status==='completed'&&r.executed===true&&r.exit_code===0&&r.process_tree_stopped===true&&r.output_captured===true&&!r.output_truncated
    resolve({status:passed?'passed':r.status==='cancelled'?'cancelled':'failed',runner:plan.runner,exit_code:Number.isInteger(r.exit_code)?r.exit_code:null,stdout:r.stdout,stderr:r.stderr,output_truncated:r.output_truncated===true,process_tree_stopped:r.process_tree_stopped,input_hashes:hashes,executable_sha256:exe.sha256,files:[...plan.files]})
   })
   if(signal?.aborted)stop()
  })
 }
 return Object.freeze({describe,planForScope,run})
}
module.exports={createFixedVerificationBroker,relativeFile,DRIVER_SHA}
