const {app}=require('electron')
const fs=require('node:fs')
const path=require('node:path')
const {createWakeLoginSettings}=require('../desktop/wake-login-settings.cjs')

async function main(){
  const requested=process.argv.at(-1)
  if(typeof requested!=='string'||!path.isAbsolute(requested))throw Error('Absolute packaged Nori target required')
  const executable=fs.realpathSync(requested)
  const info=fs.lstatSync(executable)
  if(!info.isFile()||info.isSymbolicLink()||path.basename(executable).toLowerCase()!=='nori.exe')
    throw Error('Physical packaged Nori.exe required')
  await app.whenReady()
  const settings=createWakeLoginSettings({app:{isPackaged:true},executable,platform:process.platform})
  const before=settings.isEnabled()
  if(before)throw Error('Existing exact wake sign-in entry preserved; destructive probe refused')
  let enabled=false
  try{
    settings.setEnabled(true);enabled=settings.isEnabled()
    if(!enabled)throw Error('Exact wake sign-in entry was not enabled')
  }finally{
    if(enabled)settings.setEnabled(false)
  }
  const after=settings.isEnabled()
  if(after)throw Error('Wake sign-in probe cleanup was not confirmed')
  const receipt={schema:'nori.wake-login-probe.v1',target:executable,before,
    enabledReadback:enabled,disabledReadback:!after,persisted:false,
    registry:'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',valueName:'Nori Wake'}
  const receiptPath=process.env.NORI_WAKE_LOGIN_RECEIPT
  if(receiptPath){
    const verification=path.join(fs.realpathSync('C:\\Nori'),'verification')+path.sep
    const physical=path.resolve(receiptPath)
    if(!physical.startsWith(verification)||path.extname(physical)!=='.json')throw Error('Wake receipt path refused')
    fs.writeFileSync(physical,JSON.stringify(receipt,null,2)+'\n',{encoding:'utf8',flag:'wx'})
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
  app.quit()
}
main().catch(error=>{console.error(error.message);app.exit(1)})
