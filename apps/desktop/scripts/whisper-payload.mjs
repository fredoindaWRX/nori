import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {assertRequiredFiles} from './suite-preflight.mjs'

export const whisperFiles=['config.json','model.bin','tokenizer.json','vocabulary.txt']
export function whisperSource(cacheHome,override){
  if(override){assertRequiredFiles(whisperFiles.map(name=>join(override,name)));return override}
  const repository=join(cacheHome,'models--Systran--faster-whisper-base.en')
  const revision=readFileSync(join(repository,'refs','main'),'utf8').trim()
  if(!/^[a-f0-9]{40}$/i.test(revision))throw new Error('Invalid cached Whisper revision')
  const source=join(repository,'snapshots',revision)
  assertRequiredFiles(whisperFiles.map(name=>join(source,name)))
  return source
}
