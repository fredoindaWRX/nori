function acquireDesktopStateOwners({desktopDirectory,browserDirectory,acquireStateOwner}) {
  let desktopOwner=null
  let browserOwner=null
  try {
    desktopOwner=acquireStateOwner(desktopDirectory,{purpose:'desktop'})
    browserOwner=acquireStateOwner(browserDirectory,{purpose:'desktop'})
    return {desktopOwner,browserOwner,error:null}
  } catch(error) {
    for(const owner of [browserOwner,desktopOwner]) {
      try { owner?.release() } catch {}
    }
    return {desktopOwner:null,browserOwner:null,error}
  }
}

module.exports={acquireDesktopStateOwners}
