const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } })
  w.webContents.setAudioMuted(true)
  w.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log(message) })
  await w.loadURL('http://127.0.0.1:5188/')
  console.log(await w.webContents.executeJavaScript(`JSON.stringify([...document.querySelectorAll('button')].map(b=>b.textContent))`))
  await w.webContents.executeJavaScript(`document.querySelector('.ignition')?.click()`)
  for (let i = 0; i < 100; i++) {
    if (await w.webContents.executeJavaScript(`!!document.querySelector('.startup-film[data-frame-ready="true"]')`)) break
    await new Promise(r => setTimeout(r, 50))
  }
  await new Promise(r => setTimeout(r, 100))
  console.log(await w.webContents.executeJavaScript(`JSON.stringify([...document.querySelectorAll('.boot,.boot-video,.startup-film,.startup-film canvas')].map(e=>({tag:e.className,rect:e.getBoundingClientRect().toJSON(),style:getComputedStyle(e).opacity,html:e.outerHTML.slice(0,300)})))`))
  fs.writeFileSync(path.join(__dirname, '..', 'startup-verified.png'), (await w.webContents.capturePage()).toPNG())
  app.quit()
})
