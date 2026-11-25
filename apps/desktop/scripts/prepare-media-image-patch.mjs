import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,writeFileSync} from 'node:fs'
const asar=createRequire(import.meta.url)('@electron/asar'),archive='C:/Program Files/Nori/resources/app.asar'
const name=asar.listPackage(archive).find(name=>name.slice(1).replaceAll('\\','/')==='bridge/local-image.mjs')
let text=asar.extractFile(archive,name.slice(1)).toString()
console.log(JSON.stringify({sourceMatchesInstalled:text===readFileSync(new URL('../bridge/local-image.mjs',import.meta.url),'utf8')}))
text="import { withLocalVideoModelLease } from './video-model-lease.mjs'\n"+text
const tag='export async function generateImage(frame, options = {}) {'
assert.equal(text.split(tag).length,2)
text=text.replace(tag,'async function generateImageOwned(frame, options = {}) {')
text+='\nexport async function generateImage(frame, options = {}) {\n  options.signal?.throwIfAborted()\n  decodeNeuraleseImageIntent(frame)\n  return withLocalVideoModelLease(()=>generateImageOwned(frame,options),{signal:options.signal,mediaKind:"image"})\n}\n'
writeFileSync('C:/Nori/.work/model-team-integration/patch/local-image.mjs',text)
