// Isolated acceptance only: never relocate an existing owner's browser profile.
const {existsSync,mkdirSync,realpathSync,lstatSync}=require('node:fs')
const {join,relative,isAbsolute,basename,resolve}=require('node:path')
function probeSessionData(root,profile){
  const canonical=realpathSync(root),verification=join(canonical,'verification')
  const privateProfile=realpathSync(profile),delta=relative(verification,privateProfile)
  if(isAbsolute(delta)||delta.startsWith('..')||delta!==basename(privateProfile)||
    !/^\.native-desktop-probe-[\w-]+$/.test(delta)||resolve(profile)!==privateProfile)
    throw Error('Browser session separation requires an isolated unlinked probe profile')
  if(realpathSync(verification)!==verification)throw Error('Linked verification directory refused')
  const directory=join(verification,delta.replace('.native-desktop-probe-','.native-browser-session-'))
  if(existsSync(directory)&&(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()||realpathSync(directory)!==directory))
    throw Error('Linked or non-directory browser session refused')
  mkdirSync(directory,{recursive:true})
  if(realpathSync(directory)!==directory)throw Error('Linked browser session refused')
  return directory
}
module.exports={probeSessionData}
