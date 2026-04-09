/**
 * Electron 主进程入口
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers, cleanupIpcHandlers } from './ipc-handlers'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '电商助手',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // 启用 <webview> 标签（用于淘宝浏览器标签页）
    },
  })

  // 开发模式加载 dev server
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 禁用后台节流 — 窗口在后台时 JS 定时器/滚动不被暂停
  mainWindow.webContents.setBackgroundThrottling(false)

  // WebView 运行在独立进程，也需单独禁用后台节流
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.setBackgroundThrottling(false)
  })

  // 注册 IPC handlers
  registerIpcHandlers(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  cleanupIpcHandlers()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanupIpcHandlers()
})
