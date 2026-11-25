// Fixed disposable acceptance paths only. This is not a production launcher,
// migration authorization, permission verifier, or arbitrary profile selector.
const {lstatSync,realpathSync,readFileSync}=require('node:fs')
const {join,resolve,relative,basename,dirname}=require('node:path')
const {nativeStateLayout}=require('./native-state-layout.cjs')
const {validateStorageFixtureUrl}=require('./browser-storage-fixture.cjs')
const normalized=value=>process.platform==='win32'?value.toLowerCase():value
function unlinkedDirectory(directory){
  for(let current=directory;;current=dirname(current)){
    const info=lstatSync(current)
    if(info.isSymbolicLink()||!info.isDirectory()||normalized(realpathSync(current))!==normalized(resolve(current)))
      throw Error('Unlinked prepared desktop Job directory required')
    if(dirname(current)===current)break
  }
}
function desktopJobPaths(root,spec){
  unlinkedDirectory(root)
  if(spec?.schema!==1||spec.mode!=='desktop'||spec.fault!=='none'||
    !Array.isArray(spec.argv)||spec.argv.length!==0||!/^[a-f0-9]{64}$/.test(spec.nonce))
    throw Error('Fixed desktop Job manifest required')
  const fields=['schema','mode','fault','argv','nonce','timeoutMs','desktopLayout','profileFixture','layoutFixture','browserCookieMode','browserFixtureUrl']
  if(Object.keys(spec).some(key=>!fields.includes(key)))throw Error('Unknown desktop Job manifest field refused')
  const storageMode=Object.hasOwn(spec,'browserCookieMode'),storageUrl=Object.hasOwn(spec,'browserFixtureUrl')
  if(storageMode!==storageUrl||(storageMode&&(spec.desktopLayout!=='consolidated-v1'||!['seed','check'].includes(spec.browserCookieMode))))
    throw Error('Paired consolidated browser storage fixture required')
  if(storageUrl)validateStorageFixtureUrl(spec.browserFixtureUrl)
  const verification=join(root,'verification')
  let desktop,browser,core,layoutRoot,privateRoot
  if(spec.desktopLayout==='isolated-v1'){
    if(typeof spec.profileFixture!=='string'||!/^\.native-desktop-probe-job-[\w-]+$/.test(spec.profileFixture)||
      spec.layoutFixture!==undefined)throw Error('Exact isolated desktop Job profile required')
    desktop=join(verification,spec.profileFixture)
    browser=join(verification,spec.profileFixture.replace('.native-desktop-probe-','.native-browser-session-'))
    core=join(desktop,'core')
  }else if(spec.desktopLayout==='consolidated-v1'){
    if(typeof spec.layoutFixture!=='string'||!/^\.native-browser-migration-job-[\w-]+$/.test(spec.layoutFixture)||
      spec.profileFixture!==undefined)throw Error('Exact consolidated desktop Job layout required')
    const layout=nativeStateLayout(join(verification,spec.layoutFixture))
    ;({desktop,browser,core,privateRoot}=layout);layoutRoot=layout.root
  }else throw Error('Unknown desktop Job layout; no fallback permitted')
  for(const directory of [desktop,browser,core,...(privateRoot?[privateRoot]:[])])unlinkedDirectory(directory)
  return Object.freeze({desktopLayout:spec.desktopLayout,desktop,browser,core,
    guardedDirectories:Object.freeze([desktop,browser,core]),...(layoutRoot?{layoutRoot,privateRoot}:{})})
}
function readDesktopJobSpec(root,fixtureName){
  if(typeof fixtureName!=='string'||!/^\.native-job-guardian-[\w-]+$/.test(fixtureName))
    throw Error('Exact generated desktop Job fixture required')
  const fixture=join(root,'verification',fixtureName)
  if(relative(join(root,'verification'),fixture)!==basename(fixture))throw Error('Desktop Job fixture escapes verification')
  unlinkedDirectory(fixture)
  const path=join(fixture,'launch-spec.json'),info=lstatSync(path)
  if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('Invalid bounded desktop Job manifest')
  const spec=JSON.parse(readFileSync(path,'utf8'))
  return {spec,paths:desktopJobPaths(root,spec)}
}
module.exports={desktopJobPaths,readDesktopJobSpec}
