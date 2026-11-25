const fs=require('node:fs')
const path=require('node:path')

// Read-only activation plan. Integrity detects corruption, not publisher identity.
async function inspectSelectedWakeApp(root){
  root=fs.realpathSync(root)
  const file=(name,max)=>{
    const target=path.resolve(root,name),actual=fs.realpathSync(target)
    const delta=path.relative(root,actual),stat=fs.lstatSync(target)
    if(delta==='..'||delta.startsWith('..'+path.sep)||path.isAbsolute(delta)||
       stat.isSymbolicLink()||!stat.isFile()||stat.size>max)throw Error('Invalid selected Nori file')
    return actual
  }
  const candidate=fs.readFileSync(file('apps/desktop/release/current-desktop.txt',256),'utf8').trim()
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate))throw Error('Invalid selected Nori candidate')
  const base=`apps/desktop/release/native-desktop-${candidate}`
  const receipt=JSON.parse(fs.readFileSync(file(`${base}/native-desktop-receipt.json`,8*1024*1024),'utf8'))
  if(receipt.schema!==1||receipt.candidate!==candidate||!Array.isArray(receipt.desktopManifest?.files))
    throw Error('Selected Nori receipt mismatch')
  const required=['Nori.exe','resources/app.asar']
  const files=receipt.desktopManifest.files.filter(entry=>required.includes(entry?.path))
  const executable=file(`${base}/win-unpacked/Nori.exe`,512*1024*1024)
  file(`${base}/win-unpacked/resources/app.asar`,2*1024*1024*1024)
  const {verifyComponentManifest}=await import('../scripts/component-integrity.mjs')
  const integrity=verifyComponentManifest(path.dirname(executable),{...receipt.desktopManifest,files},required)
  return {candidate,executable,integrity,activationPerformed:false}
}
async function activateSelectedWakeApp(root){
  const {spawn}=require('node:child_process')
  const plan=await inspectSelectedWakeApp(root)
  const env={...process.env}
  for(const key of Object.keys(env))if(key.toUpperCase()==='ELECTRON_RUN_AS_NODE')delete env[key]
  env.NORI_INFERENCE_RUNTIME='norllama'
  env.NORI_ALLOW_WRITES='0' // Waking does not grant write/tool authorization.
  const child=spawn(plan.executable,['--nori-wake'],{
    cwd:path.dirname(plan.executable),env,shell:false,detached:true,stdio:'ignore',windowsHide:false,
  })
  await new Promise((resolve,reject)=>{
    child.once('error',reject)
    child.once('spawn',resolve)
  })
  child.unref()
  // Acknowledges activation request only; renderer/Core readiness is separate.
  return true
}
module.exports={inspectSelectedWakeApp,activateSelectedWakeApp}
