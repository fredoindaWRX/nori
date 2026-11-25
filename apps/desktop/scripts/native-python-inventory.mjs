import {lstatSync, realpathSync, readdirSync, openSync, readSync, closeSync, existsSync} from 'node:fs'
import {join, resolve, relative, isAbsolute} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'

// Read installed metadata, never import a package or execute its setup code.
export function nativePythonInventory(suiteRoot) {
  const root = realpathSync(suiteRoot), packages = []
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
  if (normalize(root) !== normalize(resolve(suiteRoot))) throw Error('Linked suite root refused')
  function regular(path, directory) {
    const info = lstatSync(path), physical = realpathSync(path), delta = relative(root, physical)
    if (info.isSymbolicLink() || normalize(path) !== normalize(physical) ||
        delta.startsWith('..') || isAbsolute(delta) ||
        (directory ? !info.isDirectory() : !info.isFile())) throw Error('Unsafe metadata path')
    return info
  }
  function licenseEvidence(folder, reference) {
    // Wheel license files belong to their dist-info directory. Refuse escapes
    // instead of following a metadata-controlled filename into other data.
    if (!reference || reference.includes('\\') || isAbsolute(reference) ||
        reference.split('/').some(part => !part || part === '.' || part === '..') ||
        /[:\x00-\x1f<>"|?*]/.test(reference)) return {reference,status:'unsafe-reference'}
    const path = join(folder, reference)
    if (!existsSync(path)) return {reference,status:'missing'}
    try { regular(path, false) } catch { return {reference,status:'unsafe-path'} }
    const buffer = Buffer.alloc(2 * 1024 * 1024 + 1), fd = openSync(path, 'r')
    let length = 0
    try {
      let size
      while (length < buffer.length && (size = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += size
    } finally { closeSync(fd) }
    if (length > 2 * 1024 * 1024) return {reference,status:'oversized'}
    return {reference,status:length ? 'present' : 'empty',bytes:length,
      resolvedPath:relative(root,path).replaceAll('\\','/'),
      sha256:createHash('sha256').update(buffer.subarray(0,length)).digest('hex')}
  }
  for (const location of ['runtime/stt/packages', 'runtime/voice/packages']) {
    const directory = join(root, location)
    regular(directory, true)
    const entries = readdirSync(directory).filter(name => name.endsWith('.dist-info')).sort()
    if (entries.length > 4096) throw Error('Package inventory limit exceeded')
    for (const entry of entries) {
      const folder = join(directory, entry)
      regular(folder, true)
      const path = join(folder, 'METADATA')
      regular(path, false)
      const buffer = Buffer.alloc(1024 * 1024 + 1), fd = openSync(path, 'r')
      let length = 0
      try {
        let size
        while (length < buffer.length && (size = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += size
      } finally { closeSync(fd) }
      if (length > 1024 * 1024) throw Error('Package metadata exceeds bounds')
      const bytes = buffer.subarray(0, length)
      const header = new TextDecoder('utf-8', {fatal:true}).decode(bytes).split(/\r?\n\r?\n/, 1)[0]
      const fields = key => [...header.matchAll(new RegExp('^' + key + ': ([^\\r\\n]*)', 'gm'))].map(match => match[1].trim())
      const name = fields('Name'), version = fields('Version')
      if (name.length !== 1 || version.length !== 1 || !name[0] || !version[0]) throw Error('Ambiguous package identity')
      const expressions = fields('License-Expression')
      const metadataVersions = fields('Metadata-Version')
      if (metadataVersions.length > 1 || (metadataVersions.length && !/^[12]\.[0-9]+$/.test(metadataVersions[0])))
        throw Error('Unsupported package metadata version')
      // Metadata 2.4 defines references relative to dist-info/licenses,
      // whereas older wheel conventions put these files in dist-info itself.
      const modernLicenseLayout = metadataVersions[0]?.startsWith('2.') && Number(metadataVersions[0].split('.')[1]) >= 4
      const licenseRoot = modernLicenseLayout ? join(folder,'licenses') : folder
      packages.push({location, name:name[0], version:version[0],
        metadataVersion:metadataVersions[0] ?? null,
        newerMetadataMinor:metadataVersions[0]?.startsWith('2.') && Number(metadataVersions[0].split('.')[1]) > 4,
        metadataSha256:createHash('sha256').update(bytes).digest('hex'),
        licenseExpressions:expressions,
        licenseClassifiers:fields('Classifier').filter(value => value.startsWith('License ::')),
        licenseFiles:fields('License-File'),
        licenseEvidence:fields('License-File').map(reference => {
          const evidence=licenseEvidence(licenseRoot,reference)
          // Some surviving installations relocate older wheel notices into
          // licenses/ without updating their 2.1 metadata. Record the actual
          // location explicitly, not a false missing-file or standards claim.
          if (!modernLicenseLayout && evidence.status === 'missing') {
            const relocated=licenseEvidence(join(folder,'licenses'),reference)
            if (relocated.status !== 'missing') return {...relocated,layout:'legacy-relocated'}
          }
          return {...evidence,layout:modernLicenseLayout ? 'modern' : 'legacy'}
        }),
        licenseReviewRequired:true})
    }
  }
  return {schema:1,scope:'bundled-speech-python-metadata',packages,
    importsExecuted:false,completeDependencyInventory:false,
    redistributionApproved:false,releaseVerified:false}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Expected one explicit NoriSuite directory')
  console.log(JSON.stringify(nativePythonInventory(process.argv[2]), null, 2))
}
