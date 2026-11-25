// Installer-owned launch policy only. Never creates state, changes ACLs,
// migrates profiles or interprets caller-supplied state locations.
const {lstatSync,realpathSync,openSync,readSync,fstatSync,closeSync}=require('node:fs')
const {dirname,join,resolve,isAbsolute}=require('node:path')
const {createHash}=require('node:crypto')
const normalize=value=>process.platform==='win32'?value.toLowerCase():value
function installedStatePolicy({executable,suiteRoot}){
  if(typeof executable!=='string'||typeof suiteRoot!=='string')throw Error('Installed state policy needs explicit paths')
  const directory=dirname(resolve(executable)),marker=join(directory,'nori-install-layout.json')
  let info
  try{info=lstatSync(marker)}catch(error){if(error.code==='ENOENT')return null;throw error}
  if(!isAbsolute(executable)||!isAbsolute(suiteRoot)||info.isSymbolicLink()||!info.isFile()||info.size===0||info.size>4096||
    normalize(realpathSync(marker))!==normalize(marker))throw Error('Unsafe installed state policy; no fallback')
  if(normalize(resolve(suiteRoot))!==normalize(join(directory,'resources/NoriSuite')))
    throw Error('Installed state policy suite differs from packaged location; no fallback')
  let policy,bytes,fd
  try{
    fd=openSync(marker,'r')
    const opened=fstatSync(fd)
    if(!opened.isFile()||opened.ino!==info.ino||opened.dev!==info.dev||opened.size!==info.size)
      throw Error('Policy identity changed')
    // Bound the actual read as well as the initial metadata check. A file that
    // grows or is replaced between inspection and opening must not turn this
    // tiny launch policy into an unbounded allocation or a redirected read.
    const buffer=Buffer.alloc(4097)
    let length=0,count
    while(length<buffer.length&&(count=readSync(fd,buffer,length,buffer.length-length,null))>0)length+=count
    const after=fstatSync(fd),current=lstatSync(marker)
    if(length===0||length>4096||length!==opened.size||after.size!==opened.size||
      current.isSymbolicLink()||current.ino!==opened.ino||current.dev!==opened.dev||
      normalize(realpathSync(marker))!==normalize(marker))throw Error('Policy changed during read')
    bytes=buffer.subarray(0,length);policy=JSON.parse(bytes.toString('utf8'))
  }catch{throw Error('Unreadable installed state policy; no fallback')}
  finally{if(fd!==undefined)closeSync(fd)}
  if(!policy||Array.isArray(policy)||Object.keys(policy).sort().join(',')!=='schema,stateLayout,suiteRelativePath'||
    policy.schema!=='nori.installed-state-policy.v1'||policy.stateLayout!=='consolidated-v1'||
    policy.suiteRelativePath!=='resources/NoriSuite')throw Error('Invalid installed state policy; no fallback')
  return Object.freeze({mode:policy.stateLayout,marker,preparedStateRequired:true,
    byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
}
module.exports={installedStatePolicy}
