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
import dotenv from 'dotenv'
import { TaobaoPlatform } from '../taobao'
import { formatDetailText, formatLinksText } from '../taobao/business/data-formatter'
import { fetchProductDetail } from '../taobao/product-fetcher'
import { transformToWechatInput } from '../taobao/business/wechat-transform'
import { listProductToStore, getAccessToken } from '../wechat-store'
import type { FilterOptions } from '../core/types'
import type { WechatTransformOptions } from '../taobao/business/wechat-transform'

// 加载 .env 环境变量（微信小店 AppID / AppSecret 等）
dotenv.config()

const IPC = {
  CHECK_CONNECTION: 'platform:check-connection',
  CONNECTION_STATUS: 'platform:connection-status',
  SEARCH_STORES: 'platform:search-stores',
  COLLECT_STORE: 'platform:collect-store',
  EXPORT: 'platform:export',
  FETCH_PRODUCT_DETAIL: 'platform:fetch-product-detail',
  TAOBAO_TO_WECHAT: 'platform:taobao-to-wechat',
  GET_WECHAT_TOKEN: 'wechat:get-token',
} as const

/** 模块级引用，供状态推送和清理使用 */
let platform: TaobaoPlatform
let win: BrowserWindow

/** 简化 IPC handle 注册 */
const handle = (channel: string, handler: (...args: any[]) => Promise<any>) => {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { success: true, data: await handler(...args) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}

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

  // ─── 获取淘宝商品详情 ──────────────────────────────
  handle(IPC.FETCH_PRODUCT_DETAIL, async (url: string) => {
    return await fetchProductDetail(cli, url)
  })

  // ─── 淘宝商品 → 微信小店一键上货 ──────────────────────
  handle(IPC.TAOBAO_TO_WECHAT, async (
    url: string,
    transformOptions: WechatTransformOptions,
    listOptions?: { autoList?: boolean }
  ) => {
    // 0. 自动获取 access_token
    const appid = process.env.WECHAT_STORE_APPID
    const secret = process.env.WECHAT_STORE_SECRET
    if (!appid || !secret) {
      throw new Error('未配置微信小店凭证，请在 .env 中设置 WECHAT_STORE_APPID 和 WECHAT_STORE_SECRET')
    }
    const accessToken = await getAccessToken(appid, secret)

    // 1. 获取淘宝商品详情 + 下载图片
    const fetchResult = await fetchProductDetail(cli, url)
    if (!fetchResult.success || !fetchResult.detail || !fetchResult.imagePaths) {
      throw new Error(fetchResult.error ?? '获取商品详情失败')
    }

    // 2. 转换为微信小店格式
    const productInput = transformToWechatInput(
      fetchResult.detail,
      fetchResult.imagePaths,
      transformOptions
    )

    // 3. 上货到微信小店
    return await listProductToStore(accessToken, productInput, {
      autoList: listOptions?.autoList ?? false,
    })
  })

  // ─── 获取微信小店 access_token（从环境变量自动获取）───
  handle(IPC.GET_WECHAT_TOKEN, async () => {
    const appid = process.env.WECHAT_STORE_APPID
    const secret = process.env.WECHAT_STORE_SECRET
    if (!appid || !secret) {
      throw new Error('未配置微信小店凭证，请在 .env 中设置 WECHAT_STORE_APPID 和 WECHAT_STORE_SECRET')
    }
    return await getAccessToken(appid, secret)
  })
}

/** 应用退出时清理心跳 */
export function cleanupIpcHandlers(): void {
  platform?.nativeCli.stopHeartbeat()
}
