import {existsSync,lstatSync,realpathSync} from 'node:fs'
import {isAbsolute,join,dirname,relative,resolve} from 'node:path'
import {verifyNativePayload} from './verify-native-payload.mjs'
import {readFileSync} from 'node:fs'
import {verifyComponentManifest} from './component-integrity.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'

// Read-only plan. Never execute setup or provision private state here.
export function nativeInstallerPlan(sourceRoot,{candidate,stageCandidate=candidate,compiler}={}) {
  for(const name of [candidate,stageCandidate])
    if(typeof name!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))throw Error('Unsafe installer candidate name')
  const root=realpathSync(sourceRoot),app=join(root,'apps/desktop')
  const output=join(app,`release/native-installer-${candidate}`)
  if(existsSync(output))throw Error('Installer output exists; previous files preserved')
  let ancestor=dirname(output)
  while(!existsSync(ancestor))ancestor=dirname(ancestor)
  const physical=realpathSync(ancestor),delta=relative(root,physical)
  const normalized=value=>process.platform==='win32'?value.toLowerCase():value
  if(!lstatSync(ancestor).isDirectory()||delta.startsWith('..')||isAbsolute(delta)||
    normalized(physical)!==normalized(ancestor))throw Error('Unsafe installer output ancestor')
  if(typeof compiler!=='string'||!isAbsolute(compiler)||!existsSync(compiler))throw Error('Explicit installed Inno compiler is required; no download or install attempted')
  if(lstatSync(compiler).isSymbolicLink()||!lstatSync(compiler).isFile()||
    normalized(realpathSync(compiler))!==normalized(resolve(compiler)))throw Error('Compiler must be an unlinked file')
  const verified=verifyNativeDesktopCandidate(root,{candidate,stageCandidate})
  return {compiler:realpathSync(compiler),argv:[`/DNativeDesktopRoot=${verified.desktop}`,
    `/DNativeInstallerOutput=${output}`,join(app,'native-suite-installer.iss')],
    output,desktop:verified.desktop,totalBytes:verified.totalBytes,payloadVerified:true,compiled:false,installedSuiteVerified:false}
}

export function verifyNativeDesktopCandidate(sourceRoot,{candidate,stageCandidate=candidate}={}) {
  for(const name of [candidate,stageCandidate])
    if(typeof name!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))throw Error('Unsafe desktop verification candidate name')
  const root=realpathSync(sourceRoot),app=join(root,'apps/desktop')
  const stage=join(app,`release/native-suite-${stageCandidate}/NoriSuite`)
  const desktop=join(app,`release/native-desktop-${candidate}/win-unpacked`)
  const buildReceipt=JSON.parse(readFileSync(join(app,`release/native-desktop-${candidate}/native-desktop-receipt.json`),'utf8'))
  if(buildReceipt.schema!==1||buildReceipt.candidate!==candidate||buildReceipt.stageCandidate!==stageCandidate||
    buildReceipt.packagedPayloadMatches!==true)throw Error('Desktop build receipt missing or inconsistent')
  verifyComponentManifest(desktop,buildReceipt.desktopManifest,desktopArtifactPaths(desktop))
  const verified=verifyNativePayload(root,stage)
  const totalBytes=verified.bytes+buildReceipt.desktopManifest.files.reduce((sum,file)=>sum+file.bytes,0)
  if(!Number.isSafeInteger(totalBytes)||totalBytes!==buildReceipt.totalBytes||totalBytes>=128_000_000_000)
    throw Error('Complete suite size receipt is inconsistent or exceeds limit')
  const receipt=JSON.parse(readFileSync(join(stage,'native-payload-receipt.json'),'utf8'))
  const suite=join(desktop,'resources/NoriSuite')
  verifyComponentManifest(suite,receipt.manifest,nativeDistributionPaths(suite))
  for(const path of ['Nori.exe','resources/app.asar']){
    const file=join(desktop,path)
    if(!existsSync(file)||lstatSync(file).isSymbolicLink()||!lstatSync(file).isFile()||lstatSync(file).size===0)
      throw Error('Packaged desktop entry is missing or unsafe')
  }
  return {desktop,totalBytes,desktopIntegrityVerified:true,payloadVerified:verified.stageMatches,
    installedSuiteVerified:false,publisherAuthenticated:false}
}
