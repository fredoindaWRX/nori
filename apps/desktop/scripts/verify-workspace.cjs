const { app, BrowserWindow, ipcMain, screen, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { workspaceLayout } = require('../desktop/workspace-layout.cjs')
const { WebSocketServer } = require('ws')
// Keep this renderer-only test separate from the owner's actual app profile.
const verification=path.resolve(__dirname,'../../../verification')
fs.mkdirSync(verification,{recursive:true})
const fixture=fs.mkdtempSync(path.join(verification,'.workspace-renderer-'))
app.setPath('userData',fixture)
app.setPath('sessionData',fixture)
let bridgeUrl='ws://127.0.0.1:65534'
ipcMain.on('nori:connection:read',event=>{
  event.returnValue={bridgeUrl,handInputUrl:'http://127.0.0.1:65533/input',workspaceProbe:true}
})
const deadline=setTimeout(()=>{console.error('Workspace renderer test exceeded 45 second deadline');app.exit(1)},45000)
app.whenReady().then(async () => {
  let server,bridge
  try {
    console.log('Actual read-only display topology:',JSON.stringify(workspaceLayout(screen.getAllDisplays(),screen.getPrimaryDisplay().id)))
    // Test the built renderer through its ordinary bridge protocol, not a
    // development-only store hook. No Core, model, or real tools are dispatched.
    const { preview } = await import('vite')
    server = await preview({root:path.join(__dirname,'..'),preview:{host:'127.0.0.1',port:5194,strictPort:true}})
    bridge=new WebSocketServer({host:'127.0.0.1',port:0})
    await new Promise((done,reject)=>{bridge.once('listening',done);bridge.once('error',reject)})
    bridgeUrl=`ws://127.0.0.1:${bridge.address().port}`
    bridge.on('connection',socket=>socket.send(JSON.stringify({type:'ready',servers:['workspace-test'],model:'fixture',models:[],efforts:[]})))
    session.defaultSession.setPermissionRequestHandler((_wc,_permission,done)=>done(false))
    const window = new BrowserWindow({width:2560,height:900,useContentSize:true,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'..','desktop','workspace-preload.cjs')}})
    let state={enabled:true,spanning:true,bounds:{x:0,y:0,width:2560,height:900},viewport:{x:0,y:0,width:2560,height:900},screens:[{id:'left',label:'Left',primary:true,x:0,y:0,width:1280,height:900,scaleFactor:1},{id:'right',label:'Right',primary:false,x:1280,y:0,width:1280,height:900,scaleFactor:1.5}]}
    ipcMain.handle('nori:workspace:read',()=>state)
    ipcMain.handle('nori:workspace:command',()=>state)
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
    await window.loadURL('http://127.0.0.1:5194/')
    await wait(1800)
    assert.ok(bridge.clients.size>0,'Built renderer must connect to its test bridge')
    // Explicit workspace probe boot already supplies two synthetic panels.
    // Close A through its shipped button, leaving B for the cross-screen drag.
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.bl').length`),2)
    await window.webContents.executeJavaScript(`(()=>{const panel=Array.from(document.querySelectorAll('.bl')).find(p=>p.querySelector('.bl-title')?.textContent==='Workspace test panel A');if(!panel)throw Error('Missing seeded panel A');panel.querySelector('button[title="Close (X)"]').click()})()`)
    await wait(1800)
    const snapshot=()=>window.webContents.executeJavaScript(`JSON.stringify({mode:document.documentElement.dataset.workspace,panels:document.querySelectorAll('.bl').length,scene:document.querySelector('.scene').getBoundingClientRect().toJSON(),toolbars:document.querySelectorAll('.workspace-toolbar').length,panel:document.querySelector('.bl')?.getBoundingClientRect().toJSON()})`).then(JSON.parse)
    let result=await snapshot()
    assert.equal(result.mode,'span');assert.equal(result.toolbars,2);assert.equal(result.panels,1)
    assert.ok(result.scene.x<1280);assert.ok(result.panel.x>1280)
    console.log('Initial two-screen layout:',JSON.stringify(result))
    await window.webContents.executeJavaScript(`(()=>{const header=document.querySelector('.bl-head');const rect=header.getBoundingClientRect();const x=rect.x+100,y=rect.y+15;header.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:9000,clientX:x,clientY:y,buttons:1}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',pointerId:9000,clientX:x-1280,clientY:y,buttons:1}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',pointerId:9000,clientX:x-1280,clientY:y,buttons:0}));})()`)
    await wait(3200)
    result=await snapshot()
    assert.ok(result.panel.x<1280);assert.ok(result.scene.x>=1280)
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.scene').length`),1)
    console.log('Synthetic hand drag and Nori relocation:',JSON.stringify(result))
    const output=path.join(fixture,'artifacts');fs.mkdirSync(output,{recursive:true})
    fs.writeFileSync(path.join(output,'two-display-workspace.png'),(await window.webContents.capturePage()).toPNG())
    window.setContentSize(1280,900)
    state={...state,enabled:false,viewport:{x:0,y:0,width:1280,height:900},screens:[state.screens[0]]}
    window.webContents.send('nori:workspace:changed',state)
    await wait(800)
    result=await snapshot()
    assert.equal(result.mode,'single');assert.equal(result.toolbars,1)
    assert.ok(result.panel.x>=0 && result.panel.right<=1280,'panel must remain reachable after monitor removal')
    console.log('Single-monitor fallback:',JSON.stringify(result))
    console.log('Workspace integration checks passed')
    fs.writeFileSync(path.join(fixture,'workspace-receipt.json'),JSON.stringify({
      rendererIntegration:'PASS',syntheticDisplays:true,syntheticTouchDrag:true,
      panelMovedBetweenDisplays:true,oneEntityRelocated:true,monitorRemovalFallback:true,
      sensorsDenied:true,liveHandTrackingTested:false,physicalWindowSpanTested:false,
      screenshot:path.join(output,'two-display-workspace.png'),releaseVerified:false,
    },null,2)+'\n',{flag:'wx'})
    console.log('Evidence:',fixture)
  } catch(error) {console.error(error);process.exitCode=1}
  finally {clearTimeout(deadline);if(bridge){for(const socket of bridge.clients)socket.terminate();await new Promise(done=>bridge.close(done))}if(server)await new Promise(done=>server.httpServer.close(done));app.exit(process.exitCode || 0)}
})
