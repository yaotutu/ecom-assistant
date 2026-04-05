/**
 * IPC 通道处理 — 连接渲染进程与淘宝平台
 */
import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { TaobaoPlatform } from '../taobao'
import { formatDetailText, formatLinksText } from '../taobao/business/data-formatter'
import type { FilterOptions } from '../core/types'

const IPC = {
  CHECK_CONNECTION: 'platform:check-connection',
  SEARCH_STORES: 'platform:search-stores',
  COLLECT_STORE: 'platform:collect-store',
  EXPORT: 'platform:export',
} as const

export function registerIpcHandlers(_win: BrowserWindow) {
  const platform = new TaobaoPlatform()

  // ─── 连接检查 ──────────────────────────────────
  ipcMain.handle(IPC.CHECK_CONNECTION, async () => {
    return platform.checkConnection()
  })

  // ─── 搜索 TOP 店铺 ──────────────────────────────
  ipcMain.handle(
    IPC.SEARCH_STORES,
    async (_event, keyword: string, topN = 3) => {
      try {
        const result = await platform.searchStores(keyword, { top: topN })
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
        const { canceled, filePaths } = await dialog.showOpenDialog(_win, {
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
