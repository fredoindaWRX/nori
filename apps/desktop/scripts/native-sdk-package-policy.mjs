import {createRequire} from 'node:module'
import {existsSync,lstatSync,realpathSync} from 'node:fs'
import {join,resolve} from 'node:path'
const require=createRequire(import.meta.url)

// Artifact inspection only. Does not execute dependencies or certify tools.
export function verifyNativeSdkIsolation(desktopRoot,{reader=require('@electron/asar')}={}) {
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value
  const root=realpathSync(desktopRoot)
  if(normalize(root)!==normalize(resolve(desktopRoot)))throw Error('Linked desktop root refused')
  const archive=join(root,'resources/app.asar'),info=lstatSync(archive)
  if(!info.isFile()||info.isSymbolicLink()||normalize(realpathSync(archive))!==normalize(archive))
    throw Error('Unsafe native desktop archive')
  const paths=reader.listPackage(archive)
  if(paths.length>100000)throw Error('Native archive inventory exceeds bounds')
  for(const raw of paths) {
    if(typeof raw!=='string')throw Error('Invalid native archive entry')
    const path=raw.replaceAll('\\','/').replace(/^\//,'')
    if(path.split('/').includes('@anthropic-ai')||/^bridge\/(chrome|panels|ui|vision)\.mjs$/.test(path))
      throw Error('Excluded vendor SDK or adapter reappeared in native archive')
  }
  if(existsSync(join(root,'resources/app.asar.unpacked/node_modules/@anthropic-ai')))
    throw Error('Excluded vendor SDK reappeared in unpacked native dependencies')
  return {nativeSdkIsolated:true,archiveEntries:paths.length,releaseVerified:false}
}
