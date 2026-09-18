const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    useContentSize: true,
    frame: false,
    show: false,
    transparent: true,
    webPreferences: { offscreen: false }
  })
  await win.loadFile(path.join(__dirname, 'icon-source.html'))
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = await win.webContents.capturePage()

  const outDir = path.join(__dirname, '..', 'resources')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'icon.png'), image.toPNG())

  console.log('icon.png written to', outDir)
  app.quit()
})
