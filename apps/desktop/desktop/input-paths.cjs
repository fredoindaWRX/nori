const {join}=require('node:path')
function nativeInputPaths(root){
  return {python:join(root,'python','Python311','python.exe'),
    args:['-I','-B',join(root,'runtime','input','launch_worker.py')],cwd:root}
}
function handInputPaths({root,packaged,runtimeMode,python,script,cwd}){
  // Packaged GPT-OSS and NorLlama builds share the isolated, suite-owned
  // launcher. Do not fall back to a development script path in production.
  if(packaged || runtimeMode==='norllama') return nativeInputPaths(root)
  return {python:python||'python',args:[script],cwd}
}
module.exports={nativeInputPaths,handInputPaths}
