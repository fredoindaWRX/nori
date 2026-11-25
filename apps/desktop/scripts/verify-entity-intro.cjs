const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.whenReady().then(async () => {
  let server
  try {
    const { createServer } = await import('vite')
    server = await createServer({ root: path.join(__dirname, '..'), server: { host: '127.0.0.1', port: 5191, strictPort: true, watch: { ignored: ['**/public/mediapipe/**','**/dist/**','**/artifacts/**'] } } })
    await server.listen()
    const render8k = process.env.NORI_QA_8K === '1'
    const window = new BrowserWindow({ width: render8k ? 7680 : 1672, height: render8k ? 4320 : 941, useContentSize: true, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } })
    const failures = []
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) failures.push(message) })
    await window.loadURL('http://127.0.0.1:5191/scripts/preview-entity-intro.html')
    const output = path.join(__dirname, '..', 'artifacts', 'entity-intro')
    fs.mkdirSync(output, { recursive: true })
    const states = render8k ? [['galaxy-native-8k', 7.0]] : [['open', .5], ['blink-half', .845], ['blink-closed', 1.0], ['opening', 1.22], ['awaken', 1.75], ['approach', 2.55], ['entering', 3.05], ['galaxy', 7.0]]
    for (const [name, time] of states) {
      await window.webContents.executeJavaScript(`window.renderIntro(${time})`)
      await new Promise(resolve => setTimeout(resolve, 600))
      if (render8k) {
        await window.webContents.executeJavaScript(`Object.assign(document.querySelector('canvas').style, { width: '7680px', height: '4320px' })`)
        await new Promise(resolve => setTimeout(resolve, 1200))
      }
      const ready = await window.webContents.executeJavaScript(`document.querySelector('canvas')?.dataset.frameReady === 'true'`)
      if (!ready) throw new Error('The intro did not render: ' + name)
      if (render8k) {
        const png = await window.webContents.executeJavaScript(`document.querySelector('canvas').toDataURL('image/png').split(',')[1]`)
        fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(png, 'base64'))
      } else fs.writeFileSync(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG())
      console.log('Captured', name)
    }
    if (process.env.NORI_RECORD_INTRO === '1') {
      await window.webContents.executeJavaScript('window.renderIntro(undefined)')
      await new Promise(resolve => setTimeout(resolve, 300))
      const recording = await window.webContents.executeJavaScript(`new Promise(resolve => {
        const stream = document.querySelector('canvas').captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 10000000 });
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' })); stream.getTracks().forEach(track => track.stop()); };
        recorder.start(); setTimeout(() => recorder.stop(), 12700);
      })`)
      fs.writeFileSync(path.join(output, 'nori-entity-intro-preview.webm'), Buffer.from(recording, 'base64'))
      console.log('Recorded continuous animation preview')
    }
    if (failures.length) throw new Error(failures.join('\n'))
    console.log('All facial and galaxy-transition states rendered without browser errors.')
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { await server?.close(); app.quit() }
})
