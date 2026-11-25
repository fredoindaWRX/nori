import {readFileSync,lstatSync,realpathSync} from 'node:fs'
import {resolve,join,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
const identityFiles = [
  'verification/single-app-development-contract.json',
  'apps/desktop/package.json',
  'apps/desktop/desktop/main.cjs',
  'apps/desktop/native-suite-installer.iss',
  'apps/desktop/scripts/build-native-installer.mjs',
]
const fail = message => { throw Error('Single-app packaging policy: '+message) }

/** Source identity only. Never authorizes installation, state migration or tool use. */
export function inspectSingleAppPolicy(sourceRoot) {
  const root = resolve(sourceRoot)
  if (normalize(realpathSync(root)) !== normalize(root)) fail('linked source root')
  const files = identityFiles.map(path => {
    let current = root
    for (const part of path.split('/')) {
      current = join(current,part)
      if (lstatSync(current).isSymbolicLink()) fail('linked identity path: '+path)
    }
    const info = lstatSync(current)
    if (!info.isFile() || info.size > 2*1024*1024) fail('invalid identity file: '+path)
    const bytes = readFileSync(current)
    return {path,sha256:sha256(bytes),text:bytes.toString('utf8').replace(/^\uFEFF/,'')}
  })
  const text = path => files.find(file => file.path === path).text
  const contract = JSON.parse(text(identityFiles[0]))
  const metadata = JSON.parse(text(identityFiles[1]))
  if (contract?.schema !== 'nori.single-app-development-contract.v1' ||
      contract.desktop_product !== 'N.O.R.I.' ||
      contract.desktop_entrypoint !== 'apps/desktop/desktop/main.cjs') fail('owner identity contract differs')
  if (metadata?.name !== 'nori' || metadata.productName !== 'N.O.R.I.' ||
      metadata.main !== 'desktop/main.cjs') fail('desktop identity or entrypoint differs')
  if (metadata.scripts?.['package:windows'] !== 'npm run package:windows:suite --' ||
      metadata.scripts?.['package:windows:suite'] !== 'node scripts/build-native-installer.mjs')
    fail('default Windows packaging bypasses the native suite')
  let section = ''
  const directives = new Map()
  for (const raw of text(identityFiles[3]).split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) section = line.toLowerCase()
    else if (section === '[setup]' && line.includes('=') && !line.startsWith(';')) {
      const index = line.indexOf('='), key = line.slice(0,index).toLowerCase()
      if (directives.has(key)) fail('duplicate installer directive: '+key)
      directives.set(key,line.slice(index+1))
    }
  }
  const expected = {
    appid:'{{6CB18C76-1A3F-4A15-AF16-FF098C2B91B4}',appname:'N.O.R.I.',
    defaultdirname:'{autopf}\\Nori',uninstallable:'yes',
    appmodifypath:'"{app}\\Nori.exe" --manage-installation',
    uninstalldisplayicon:'{app}\\Nori.exe',
  }
  for (const [key,value] of Object.entries(expected))
    if (directives.get(key) !== value) fail('installer '+key+' differs')
  return {schema:'nori.single-app-package-policy.v1',
    files:files.map(({path,sha256})=>({path,sha256})),releaseVerified:false}
}

export function recheckSingleAppPolicy(root,before) {
  const after = inspectSingleAppPolicy(root)
  if (JSON.stringify(after) !== JSON.stringify(before)) fail('identity inputs changed during build; output preserved')
  return after
}

/** Check the actual shipped Electron metadata and entry, not just source declarations. */
export function verifyPackagedAppIdentity(desktopRoot,policy) {
  const {extractFile} = createRequire(import.meta.url)('@electron/asar')
  const archive = join(desktopRoot,'resources/app.asar')
  const metadata = JSON.parse(extractFile(archive,'package.json').toString('utf8'))
  if (metadata?.name !== 'nori' || metadata.productName !== 'N.O.R.I.' ||
      metadata.main !== 'desktop/main.cjs') fail('packaged desktop identity differs')
  const expected = policy.files.find(file=>file.path==='apps/desktop/desktop/main.cjs')
  if (!expected || sha256(extractFile(archive,['desktop','main.cjs'].join(sep))) !== expected.sha256)
    fail('packaged desktop entry differs from checked source')
  return {identityVerified:true,releaseVerified:false}
}
