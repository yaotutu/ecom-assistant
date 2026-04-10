/**
 * 淘宝相关 IPC handlers
 *
 * 职责：
 * - 搜索店铺、采集商品、导出文件
 * - 淘宝 WebView 登录管理（检查、登录、登出、session 信息）
 */

import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { TaobaoPlatform } from '../../taobao'
import { formatDetailText, formatLinksText } from '../../taobao/business/data-formatter'
import { checkLoginStatus, showLoginWindow, clearTaobaoSession, getSessionSummary } from '../../taobao/auth'
import type { FilterOptions } from '../../core/types'

const IPC = {
  SEARCH_STORES: 'platform:search-stores',
  COLLECT_STORE: 'platform:collect-store',
  EXPORT: 'platform:export',
  TAOBAO_CHECK_LOGIN: 'taobao:check-login',
  TAOBAO_LOGIN: 'taobao:login',
  TAOBAO_LOGOUT: 'taobao:logout',
  TAOBAO_SESSION_INFO: 'taobao:session-info',
} as const

export function registerTaobaoHandlers(win: BrowserWindow, platform: TaobaoPlatform): void {

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

  // ─── 淘宝 WebView 登录管理 ──────────────────────────

  /** 检查淘宝登录状态 */
  ipcMain.handle(IPC.TAOBAO_CHECK_LOGIN, async () => {
    return await checkLoginStatus()
  })

  /** 弹出淘宝登录窗口 */
  ipcMain.handle(IPC.TAOBAO_LOGIN, async () => {
    return await showLoginWindow(win)
  })

  /** 清除淘宝登录态 */
  ipcMain.handle(IPC.TAOBAO_LOGOUT, async () => {
    await clearTaobaoSession()
    return true
  })

  /** 获取淘宝 session 摘要信息（调试用） */
  ipcMain.handle(IPC.TAOBAO_SESSION_INFO, async () => {
    return await getSessionSummary()
  })
}
