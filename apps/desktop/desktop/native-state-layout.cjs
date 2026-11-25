// Shared production path contract. Resolving paths never provisions or activates
// state, changes ACLs, or adopts an existing legacy installation.
const {lstatSync,realpathSync}=require('node:fs')
const {resolve,join,relative,isAbsolute,dirname}=require('node:path')
const normalized=value=>process.platform==='win32'?value.toLowerCase():value
function nativeStateLayout(root){
  if(typeof root!=='string'||!isAbsolute(root))throw Error('Nori layout requires an absolute main folder')
  const requested=resolve(root),canonical=realpathSync(requested)
  if(normalized(requested)!==normalized(canonical)||lstatSync(requested).isSymbolicLink()||!lstatSync(canonical).isDirectory())
    throw Error('Linked or non-directory Nori layout root refused')
  function path(relativePath){
    const target=join(canonical,relativePath)
    const delta=relative(canonical,target)
    if(!delta||delta.startsWith('..')||isAbsolute(delta))throw Error('Nori layout path escapes main folder')
    // Check every existing ancestor, not just the leaf's resolved destination.
    // Dangling links must also be refused instead of treated as absent paths.
    for(let current=target;;current=dirname(current)){
      let info
      try{info=lstatSync(current)}catch(error){if(error.code!=='ENOENT')throw error}
      if(info&&(info.isSymbolicLink()||!info.isDirectory()||normalized(realpathSync(current))!==normalized(current)))
        throw Error('Linked or non-directory Nori state layout path refused')
      if(current===canonical)break
    }
    return target
  }
  return Object.freeze({schema:1,root:canonical,privateRoot:path('state/private'),
    core:path('state/private/core'),desktop:path('state/private/desktop'),
    browser:path('state/browser'),models:path('models'),
    activationAuthorized:false,permissionsVerified:false})
}
module.exports={nativeStateLayout}
