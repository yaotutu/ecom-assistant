/**
 * IPC 通道处理 — 连接渲染进程与淘宝平台
 *
 * 职责：
 * 1. 注册 IPC handlers（请求-响应）
 * 2. 启动心跳，监听连接状态变更并推送给渲染进程
 * 3. 应用退出时清理心跳
 */
import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { TaobaoPlatform } from '../taobao'
import { formatDetailText, formatLinksText } from '../taobao/business/data-formatter'
import type { FilterOptions } from '../core/types'

const IPC = {
  CHECK_CONNECTION: 'platform:check-connection',
  CONNECTION_STATUS: 'platform:connection-status',
  SEARCH_STORES: 'platform:search-stores',
  COLLECT_STORE: 'platform:collect-store',
  EXPORT: 'platform:export',
} as const

/** 模块级引用，供状态推送和清理使用 */
let platform: TaobaoPlatform
let win: BrowserWindow

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  win = mainWindow
  platform = new TaobaoPlatform()
  const cli = platform.nativeCli

  // ─── 启动心跳 + 监听状态变更 ────────────────────
  cli.startHeartbeat()
  cli.onStateChange((change) => {
    // 推送连接状态到渲染进程
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.CONNECTION_STATUS, {
        status: change.state === 'healthy' ? 'connected'
          : change.state === 'recovering' ? 'checking'
          : change.state === 'unknown' ? 'checking'
          : 'disconnected',
        message: change.message,
        suggestion: change.suggestion,
      })
    }
  })

  // ─── 连接检查（手动触发，保留作为 fallback） ──────
  ipcMain.handle(IPC.CHECK_CONNECTION, async () => {
    return platform.checkConnection()
  })

  // ─── 搜索店铺 ──────────────────────────────────
  ipcMain.handle(
    IPC.SEARCH_STORES,
    async (_event, keyword: string) => {
      try {
        const result = await platform.searchStores(keyword)
        return { success: true, data: result }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // ─── 采集全店商品 ──────────────────────────────
  ipcMain.handle(
    IPC.COLLECT_STORE,
    async (_event, storeName: string, filterOptions: FilterOptions) => {
      try {
        const result = await platform.collectStore(storeName, filterOptions)
        return { success: true, data: result }
      } catch (err: any) {
        return { success: false, error: err.message, suggestion: err.suggestion }
      }
    }
  )

  // ─── 导出文件 ──────────────────────────────────
  ipcMain.handle(
    IPC.EXPORT,
    async (
      _event,
      storeName: string,
      products: any[],
      filterOptions: FilterOptions,
      format: 'detail' | 'links'
    ) => {
      try {
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
          title: '选择导出目录',
          properties: ['openDirectory', 'createDirectory'],
        })

        if (canceled || filePaths.length === 0) {
          return { success: false, error: '已取消' }
        }

        const outputDir = filePaths[0]
        mkdirSync(outputDir, { recursive: true })
        const base = join(outputDir, storeName)

        let filePath: string
        if (format === 'detail') {
          filePath = `${base}_详情.txt`
          writeFileSync(
            filePath,
            formatDetailText(storeName, products, filterOptions),
            'utf-8'
          )
        } else {
          filePath = `${base}_链接.txt`
          writeFileSync(filePath, formatLinksText(products), 'utf-8')
        }

        return { success: true, filePath }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )
}

/** 应用退出时清理心跳 */
export function cleanupIpcHandlers(): void {
  platform?.nativeCli.stopHeartbeat()
}
