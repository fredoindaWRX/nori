import {join,resolve} from 'node:path'
import {lstatSync,readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {verifyComponentManifest} from './component-integrity.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'
const require=createRequire(import.meta.url)
const {installedStatePolicy}=require('../desktop/installed-state-policy.cjs')
const {consolidatedStateSelection}=require('../desktop/consolidated-state-selection.cjs')

// Installed layout differs from a pristine portable package by ONE fixed policy
// marker. Never mutate the receipt, broaden exclusions, read memory contents or
// claim that unsigned hashes establish installer authority or a working release.
export function verifyInstalledNative(desktopRoot,receipt){
  if(process.platform!=='win32')throw Error('Installed Nori requires Windows permission verification')
  if(!receipt||receipt.schema!==1||receipt.packagedPayloadMatches!==true||!receipt.nativeManifest)
    throw Error('Installed native receipt is missing or incomplete')
  const root=resolve(desktopRoot),suite=join(root,'resources/NoriSuite')
  const executable=join(root,'Nori.exe')
  const policy=installedStatePolicy({executable,suiteRoot:suite})
  if(!policy)throw Error('Installed state policy missing; no portable fallback')
  const expected=Buffer.from(JSON.stringify({schema:'nori.installed-state-policy.v1',
    stateLayout:'consolidated-v1',suiteRelativePath:'resources/NoriSuite'})+'\n')
  if(policy.byteLength!==expected.length||policy.sha256!==createHash('sha256').update(expected).digest('hex'))
    throw Error('Installed state policy bytes differ from publication contract')
  const allDesktop=desktopArtifactPaths(root)
  if(!allDesktop.includes('nori-install-layout.json'))throw Error('Installed policy missing from physical inventory')
  const desktopPaths=allDesktop.filter(path=>path!=='nori-install-layout.json')
  verifyComponentManifest(root,receipt.desktopManifest,desktopPaths)
  const nativePaths=nativeDistributionPaths(suite)
  verifyComponentManifest(suite,receipt.nativeManifest,nativePaths)
  const totalBytes=[...receipt.desktopManifest.files,...receipt.nativeManifest.files]
    .reduce((sum,file)=>sum+file.bytes,0)
  if(!Number.isSafeInteger(totalBytes)||totalBytes!==receipt.totalBytes||totalBytes>=128_000_000_000)
    throw Error('Installed native size receipt is inconsistent')
  // Verify shipped script bytes BEFORE executing the Windows ACL checks.
  const selection=consolidatedStateSelection(suite,policy.mode,{scriptsRoot:join(root,'maintenance/scripts')})
  if(!selection?.permissionsVerified)throw Error('Installed state permissions not verified')
  const afterPolicy=installedStatePolicy({executable,suiteRoot:suite})
  if(!afterPolicy||afterPolicy.sha256!==policy.sha256||afterPolicy.byteLength!==policy.byteLength||
    JSON.stringify(desktopArtifactPaths(root))!==JSON.stringify(allDesktop)||
    JSON.stringify(nativeDistributionPaths(suite))!==JSON.stringify(nativePaths))
    throw Error('Installed layout changed during verification')
  return {desktopIntegrityVerified:true,payloadIntegrityVerified:true,
    installedPolicyBytesVerified:true,preparedStateAclVerified:true,totalBytes,
    installedPolicyBytes:policy.byteLength,sourceTreeRequired:false,
    privateStateContentsRead:false,privateStateIntegrityVerified:false,
    quiescenceVerified:false,originalInstallerOwnerVerified:false,
    codeRootPermissionsVerified:false,publisherAuthenticated:false,
    installedSuiteVerified:false,releaseVerified:false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.versions.electron)process.noAsar=true
  try{
    const args=process.argv.slice(2)
    if(args.length!==2)throw Error('Usage: verify-installed-native.mjs <installed directory> <receipt.json>')
    const receiptPath=resolve(args[1]),info=lstatSync(receiptPath)
    if(info.isSymbolicLink()||!info.isFile()||info.size>32*1024*1024)throw Error('Unsafe or oversized installed receipt')
    console.log(JSON.stringify(verifyInstalledNative(args[0],JSON.parse(readFileSync(receiptPath,'utf8')))))
  }catch(error){console.error(JSON.stringify({verified:false,error:error.message}));process.exitCode=1}
}
