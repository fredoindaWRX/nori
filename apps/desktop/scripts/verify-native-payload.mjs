import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {nativePayloadPlan} from './native-payload-plan.mjs'
import {verifyComponentManifest} from './component-integrity.mjs'

export function verifyNativePayload(sourceRoot,stageRoot,{portableCatalog} = {}) {
  const plan=nativePayloadPlan(sourceRoot,{portableCatalog})
  const receipt=JSON.parse(readFileSync(join(stageRoot,'native-payload-receipt.json'),'utf8'))
  const modelCount=plan.files.filter(file=>file.path.startsWith('models/language/')).length
  const copiedModelFiles=receipt.copiedModelFiles??0
  if(receipt.schema!==1 || receipt.copyVerified!==true || receipt.modelId!==plan.modelId ||
    receipt.modelPath!==plan.modelPath || !Number.isSafeInteger(receipt.hardlinked)||receipt.hardlinked<0||
    !Number.isSafeInteger(copiedModelFiles)||copiedModelFiles<0||receipt.hardlinked+copiedModelFiles!==modelCount ||
    receipt.portableCatalog!==plan.portableCatalog ||
    receipt.bytes!==plan.bytes || receipt.copied!==plan.files.length || !receipt.manifest) {
    throw new Error('Native staging receipt is stale or incomplete; rebuild from a fresh destination')
  }
  const paths=plan.files.map(file=>file.path)
  verifyComponentManifest(sourceRoot,receipt.manifest,paths)
  verifyComponentManifest(stageRoot,receipt.manifest,paths)
  return {files:paths.length,bytes:plan.bytes,sourceMatches:true,stageMatches:true,releaseVerified:false}
}
