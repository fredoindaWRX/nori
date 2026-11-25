// Refresh only Electron/renderer files in an unfinished candidate; reuse the
// already staged native suite rather than making another model/runtime copy.
import {build,Platform,Arch} from 'electron-builder'
import {existsSync,lstatSync,realpathSync,cpSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {nativeBuilderConfig} from './package-native-desktop.mjs'
import {inspectSingleAppPolicy,verifyPackagedAppIdentity} from './single-app-package-policy.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {buildComponentManifest,verifyComponentManifest} from './component-integrity.mjs'

const root=resolve(import.meta.dirname,'../../..'),app=join(root,'apps/desktop')
const candidate=process.argv[2]
if(typeof candidate!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate))throw Error('Safe existing candidate required')
const revision=process.argv[3]||candidate
if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(revision))throw Error('Safe shell revision required')
const output=join(app,`release/shell-${revision}`),destination=join(app,`release/native-desktop-${candidate}/win-unpacked`)
if(existsSync(output)||existsSync(join(destination,'../native-desktop-receipt.json')))throw Error('Existing build/receipt preserved')
if(!lstatSync(destination).isDirectory()||lstatSync(destination).isSymbolicLink()||realpathSync(destination).toLowerCase()!==destination.toLowerCase())throw Error('Unsafe candidate directory')
const config={...nativeBuilderConfig(app,'unused-native-suite',output),extraResources:[]}
await build({projectDir:app,config,publish:'never',targets:Platform.WINDOWS.createTarget('dir',Arch.x64)})
const shell=join(output,'win-unpacked'),policy=inspectSingleAppPolicy(root)
verifyPackagedAppIdentity(shell,policy)
const manifest=buildComponentManifest(shell,desktopArtifactPaths(shell))
cpSync(shell,destination,{recursive:true,force:true})
verifyComponentManifest(destination,manifest)
verifyPackagedAppIdentity(destination,policy)
console.log(JSON.stringify({phase:'shell-refreshed',candidate,files:manifest.files.length,nativeSuiteCopied:false,selected:false}))
