// Only called by explicit sensor-denied workspace acceptance, never production.
function validateStorageFixtureUrl(value){
  if(typeof value!=='string'||!/^http:\/\/127\.0\.0\.1:\d{1,5}\/nori-storage-fixture\?fixture=[a-f0-9]{64}$/.test(value))
    throw Error('Browser storage acceptance requires its owned loopback fixture')
  let parsed
  try{parsed=new URL(value)}catch{throw Error('Browser storage fixture URL invalid')}
  if(!Number.isInteger(Number(parsed.port))||Number(parsed.port)<1||Number(parsed.port)>65535)
    throw Error('Browser storage fixture port invalid')
  return value
}
async function browserStorageFixture({BrowserWindow,session,mode,url}){
  if(!['seed','check'].includes(mode))throw Error('Invalid browser storage acceptance mode')
  validateStorageFixtureUrl(url)
  const window=new BrowserWindow({show:false,width:320,height:200,webPreferences:{
    contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,session}})
  // A loopback-shaped initial URL is not proof of the final storage origin.
  // Refuse redirect/navigation changes before accepting persistent state.
  const exactNavigation=(event,target)=>{if(target!==url)event.preventDefault()}
  window.webContents.on('will-redirect',exactNavigation)
  window.webContents.on('will-navigate',exactNavigation)
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  try{
    await window.loadURL(url)
    if(window.webContents.getURL()!==url)throw Error('Synthetic browser storage left its exact loopback origin')
    const result=await window.webContents.executeJavaScript(`(async()=>{
      if(document.querySelector('meta[name="nori-synthetic-fixture"]')?.content!=='storage-v1')
        throw Error('Owned synthetic storage page missing');
      const mode=${JSON.stringify(mode)},key='nori.migration.synthetic',value='synthetic-storage-v1';
      if(mode==='seed')localStorage.setItem(key,value);
      if(localStorage.getItem(key)!==value)throw Error('Synthetic localStorage continuity failed');
      const database=await new Promise((resolve,reject)=>{
        const request=indexedDB.open('nori-migration-synthetic',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('fixture');
        request.onerror=()=>reject(Error('Synthetic IndexedDB open failed'));
        request.onblocked=()=>reject(Error('Synthetic IndexedDB blocked'));
        request.onsuccess=()=>resolve(request.result);
      });
      try{
        await new Promise((resolve,reject)=>{
          const transaction=database.transaction('fixture',mode==='seed'?'readwrite':'readonly');
          const store=transaction.objectStore('fixture');
          if(mode==='seed')store.put(value,key);
          const request=store.get(key);
          let matches=false;
          request.onsuccess=()=>{matches=request.result===value;};
          transaction.onerror=()=>reject(Error('Synthetic IndexedDB transaction failed'));
          transaction.onabort=()=>reject(Error('Synthetic IndexedDB aborted'));
          transaction.oncomplete=()=>matches?resolve():reject(Error('Synthetic IndexedDB continuity failed'));
        });
      }finally{database.close();}
      return {localStorageVerified:true,indexedDbVerified:true,remoteNetworkUsed:false,loopbackFixtureUsed:true};
    })()`)
    if(window.webContents.getURL()!==url)throw Error('Synthetic browser storage origin changed during acceptance')
    session.flushStorageData()
    return result
  }finally{window.destroy()}
}
module.exports={validateStorageFixtureUrl,browserStorageFixture}
