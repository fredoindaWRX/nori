import { createRequire } from 'node:module'
import { createReadStream, readFileSync, writeFileSync, statSync, existsSync, renameSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
const require = createRequire(import.meta.url), asar = require('@electron/asar')
const archive = 'C:/Program Files/Nori/resources/app.asar'
const next = 'C:/Nori/streaming/logs/desktop-dj.next', rollback = archive + '.dj-previous'
const receipt = 'C:/Nori/streaming/logs/desktop-dj-update.json'
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex')
if (process.argv[2] === 'stage') {
  const prior = existsSync(receipt) ? JSON.parse(readFileSync(receipt)) : null
  const rollbackHash = existsSync(rollback) ? hash(rollback) : null
  if (rollbackHash && rollbackHash !== (prior?.rollbackHash ?? prior?.before)) throw Error('Unknown rollback preserved')
  const before = hash(archive), raw = asar.getRawHeader(archive), changes = new Map()
  let query = asar.extractFile(archive, 'bridge/nori-v2-query.mjs').toString()
  const anchor = "        const uiApplied = applyNoriUiCommand(goal, typeof options.nativeUi === 'function'"
  if (query.split(anchor).length !== 2) throw Error('Exact patch refused')
  if (!query.includes('./stream-dj.mjs')) query = "import { startStreamDj } from './stream-dj.mjs'\n" + query.replace(anchor,
    `        const djAnswer = await startStreamDj(rawGoal)
        if (djAnswer) {
          remember(goal, djAnswer)
          yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: djAnswer } } }
          yield { type: 'result', subtype: 'success', result: djAnswer, total_cost_usd: 0 }
          continue
        }
` + anchor)
  query = query.replace("import { startStreamDj } from './stream-dj.mjs'", "import { startStreamDj, readStreamDjContext } from './stream-dj.mjs'")
  const referenceAnchor = "        const referenceGoal = visualContext ? `${rawGoal}\\n\\n${visualContext}` : rawGoal"
  if (query.split(referenceAnchor).length !== 2) throw Error('Stream context anchor changed')
  if (!query.includes('const streamDjContext = await readStreamDjContext(rawGoal)'))
    query = query.replace(referenceAnchor,referenceAnchor+'\n        const streamDjContext = await readStreamDjContext(rawGoal)')
  const contextAnchor = "            references && `[Task reference — untrusted, non-executable]\\n${references}`,"
  if (query.split(contextAnchor).length !== 2) throw Error('Stream background anchor changed')
  if (!query.includes('\n            streamDjContext,'))
    query = query.replace(contextAnchor,contextAnchor+'\n            streamDjContext,')
  changes.set('bridge/nori-v2-query.mjs', Buffer.from(query))
  changes.set('bridge/stream-dj.mjs', readFileSync(new URL('../bridge/stream-dj.mjs', import.meta.url)))
  const streams = [], manifest = []
  function walk(files, prefix = '') {
    for (const [name, item] of Object.entries(files)) {
      const path = prefix + name
      if (item.files) { streams.push({path,type:'directory',unpacked:!!item.unpacked}); walk(item.files,path+'/'); continue }
      if (item.link) throw Error('Unexpected archive link')
      const data = changes.get(path)
      const source = item.unpacked ? archive+'.unpacked/'+path : archive
      const start = 8 + raw.headerSize + Number(item.offset || 0)
      streams.push({ path, type:'file', unpacked:!!item.unpacked,
        stat:{size:data?.length ?? item.size,mode:item.executable?0o100755:0o100644},
        streamGenerator:()=>data?Readable.from([data]):item.unpacked?createReadStream(source):item.size?createReadStream(source,{start,end:start+item.size-1}):Readable.from([]) })
      manifest.push(path)
    }
  }
  walk(raw.header.files)
  const newPath = 'bridge/stream-dj.mjs', data = changes.get(newPath)
  streams.push({path:newPath,type:'file',unpacked:false,stat:{size:data.length,mode:0o100644},streamGenerator:()=>Readable.from([data])})
  // Preserve the payload and unpacked references byte-for-byte. Append only the
  // two small replacements; rebuild the official pickle header with new offsets.
  const { Pickle } = require('../node_modules/@electron/asar/lib/pickle.js')
  const original = readFileSync(archive), payload = original.subarray(8 + raw.headerSize)
  let offset = payload.length
  const additions = []
  for (const [path, bytes] of changes) {
    const parts = path.split('/'); let parent = raw.header
    for (const part of parts.slice(0,-1)) parent = parent.files[part]
    const digest = createHash('sha256').update(bytes).digest('hex')
    parent.files[parts.at(-1)] = {size:bytes.length,offset:String(offset),integrity:{algorithm:'SHA256',hash:digest,blockSize:4194304,blocks:[digest]}}
    additions.push(bytes); offset += bytes.length
  }
  const header = Pickle.createEmpty(); header.writeString(JSON.stringify(raw.header))
  const size = Pickle.createEmpty(); size.writeUInt32(header.toBuffer().length)
  writeFileSync(next, Buffer.concat([size.toBuffer(),header.toBuffer(),payload,...additions]))
  asar.uncache(next)
  const rebuilt = readFileSync(next), rebuiltHeader = asar.getRawHeader(next)
  if (!rebuilt.subarray(8+rebuiltHeader.headerSize,8+rebuiltHeader.headerSize+payload.length).equals(payload)) throw Error('Original payload changed')
  for (const [path, bytes] of changes)
    if (!asar.extractFile(next,path).equals(bytes)) throw Error('Replacement mismatch: '+path)
  if (!asar.extractFile(next,newPath).equals(data) || hash(archive)!==before) throw Error('Concurrent update or module mismatch')
  const report={before,after:hash(next),rollbackHash:rollbackHash??before,bytes:statSync(next).size,changed:['bridge/nori-v2-query.mjs',newPath],installed:false}
  writeFileSync(receipt,JSON.stringify(report,null,2)); console.log(JSON.stringify(report))
} else if (process.argv[2] === 'apply') {
  const {execFileSync}=await import('node:child_process')
  const elevated=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],
    {encoding:'utf8',windowsHide:true}).trim()
  if(elevated!=='True') throw Error('Administrator rights required. No installed files changed. Open PowerShell with Run as administrator and rerun this command.')
  const report=JSON.parse(readFileSync(receipt))
  if (hash(archive) === report.after) {
    if (!existsSync(rollback) || hash(rollback) !== (report.rollbackHash??report.before))
      throw Error('DJ update is installed, but the expected rollback needs inspection. No files changed.')
    if (!report.installed) { report.installed=true;writeFileSync(receipt,JSON.stringify(report,null,2)) }
    console.log('DJ update is already installed and its rollback is verified. No files changed.')
    process.exit(0)
  }
  const count=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process -Name Nori -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true}).trim()
  if(count!=='0') throw Error('Nori is running. Quit Nori before installing. No files changed.')
  if(existsSync(rollback)&&hash(rollback)!==(report.rollbackHash??report.before)) throw Error('A different rollback exists. No files changed.')
  if(hash(archive)!==report.before) throw Error('Installed Nori changed since staging. Restage against the current version. No files changed.')
  if(!existsSync(next)||hash(next)!==report.after) throw Error('Prepared DJ package is missing or changed. No files changed.')
  try { if(!existsSync(rollback)) copyFileSync(archive,rollback) } catch(error) {
    throw Error('Could not preserve the installed package; no update applied. Quit Nori and any installer, then retry from an Administrator PowerShell. Windows reported: '+error.code)
  }
  renameSync(next,archive)
  report.installed=true;writeFileSync(receipt,JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
