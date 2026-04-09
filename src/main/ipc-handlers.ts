/**
 * IPC 通道处理 — 连接渲染进程与淘宝平台
 *
 * 职责：
 * 1. 注册 IPC handlers（请求-响应）
 * 2. 启动心跳，监听连接状态变更并推送给渲染进程
 * 3. 管理淘宝 WebView 登录态
 * 4. 应用退出时清理心跳
 */
import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import dotenv from 'dotenv'
import { TaobaoPlatform } from '../taobao'
import { formatDetailText, formatLinksText } from '../taobao/business/data-formatter'
import { fetchProductDetail } from '../taobao/product-fetcher'
import { fetchProductDetailV2 } from '../taobao/product-fetcher-v2'
import { transformToWechatInput } from '../taobao/business/wechat-transform'
import { downloadImages, filterSuccessfulDownloads } from '../taobao/business/image-downloader'
import { listProductToStore, getAccessToken, getAllCategories } from '../wechat-store'
import { checkLoginStatus, showLoginWindow, clearTaobaoSession, getSessionSummary } from '../taobao/auth'
import type { FilterOptions } from '../core/types'
import type { WechatTransformOptions } from '../taobao/business/wechat-transform'
import { matchCategoryByTitle } from '../taobao/business/category-matcher'

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
  // 淘宝 WebView 登录相关
  TAOBAO_CHECK_LOGIN: 'taobao:check-login',
  TAOBAO_LOGIN: 'taobao:login',
  TAOBAO_LOGOUT: 'taobao:logout',
  TAOBAO_SESSION_INFO: 'taobao:session-info',
  // 浏览器标签页：上传已提取的商品数据到微信小店
  UPLOAD_EXTRACTED_PRODUCT: 'taobao:upload-extracted-product',
  // 测试类目匹配
  TEST_CATEGORY_MATCH: 'wechat:test-category-match',
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
    // 推送连接状态到渲染进程（三态：connected / disconnected / checking）
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.CONNECTION_STATUS, {
        status: change.state === 'healthy' ? 'connected'
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

  // ─── 获取淘宝商品详情（V2：基于 WebView，不依赖 CLI） ──
  handle(IPC.FETCH_PRODUCT_DETAIL, async (url: string) => {
    return await fetchProductDetailV2(url, win)
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

    // 1. 获取淘宝商品详情 + 下载图片（使用 V2 WebView 方案）
    const fetchResult = await fetchProductDetailV2(url, win)
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

  // ─── 淘宝 WebView 登录管理 ──────────────────────────

  /** 检查淘宝登录状态 */
  handle(IPC.TAOBAO_CHECK_LOGIN, async () => {
    return await checkLoginStatus()
  })

  /** 弹出淘宝登录窗口 */
  handle(IPC.TAOBAO_LOGIN, async () => {
    return await showLoginWindow(win)
  })

  /** 清除淘宝登录态（登出） */
  handle(IPC.TAOBAO_LOGOUT, async () => {
    await clearTaobaoSession()
    return true
  })

  /** 获取淘宝 session 摘要信息（调试用） */
  handle(IPC.TAOBAO_SESSION_INFO, async () => {
    return await getSessionSummary()
  })

  // ─── 浏览器标签页：上传已提取的商品到微信小店 ──────

  /**
   * 接收从 webview 提取的商品数据，下载图片后上货到微信小店
   *
   * 流程：提取数据(已完成) → 自动匹配类目 → 下载图片 → 转换格式 → 上货
   */
  handle(IPC.UPLOAD_EXTRACTED_PRODUCT, async (
    product: {
      title: string; itemId: string; price: string; shopName: string
      description: string; headImageUrls: string[]; descImageUrls: string[]
      skus: Array<{ attributes: Array<{ key: string; value: string }>; price: string }>
      sourceUrl: string
    },
    transformOptions: any,
    listOptions?: { autoList?: boolean }
  ) => {
    // 0. 获取微信 access_token
    const appid = process.env.WECHAT_STORE_APPID
    const secret = process.env.WECHAT_STORE_SECRET
    if (!appid || !secret) {
      throw new Error('未配置微信小店凭证，请在 .env 中设置 WECHAT_STORE_APPID 和 WECHAT_STORE_SECRET')
    }
    const accessToken = await getAccessToken(appid, secret)

    // 1. 从商品标题自动匹配微信小店类目
    const wechatCategories = await getAllCategories(accessToken)
    const matched = matchCategoryByTitle(product.title, wechatCategories)
    if (!matched) {
      throw new Error(`无法匹配微信小店类目，商品标题: ${product.title}`)
    }
    const categoryPath = matched.categoryPath
    console.log(`[类目匹配] 标题: ${product.title} → 微信: ${matched.categoryName} (IDs: ${categoryPath})`)

    // 2. 下载主图到本地
    const headResults = await downloadImages(product.headImageUrls, { prefix: 'head' })
    const headImagePaths = filterSuccessfulDownloads(headResults)
    if (headImagePaths.length < 3) {
      throw new Error(`主图下载不足：需 3 张，仅成功 ${headImagePaths.length} 张`)
    }

    // 3. 下载详情图到本地
    const descResults = await downloadImages(product.descImageUrls, { prefix: 'desc' })
    const descImagePaths = filterSuccessfulDownloads(descResults)

    // 4. 转换为微信小店格式
    const productInput = transformToWechatInput(
      product as any, // ExtractedProduct 兼容 TaobaoProductDetail
      { headImagePaths, descImagePaths },
      {
        categoryPath,
        freightTemplateId: transformOptions.freightTemplateId ?? '1',
        defaultStock: transformOptions.defaultStock ?? 100,
      }
    )

    // 5. 上货
    return await listProductToStore(accessToken, productInput, {
      autoList: listOptions?.autoList ?? false,
    })
  })

  // ─── 测试类目匹配 ──────────────────────────────────
  handle(IPC.TEST_CATEGORY_MATCH, async (title: string) => {
    const appid = process.env.WECHAT_STORE_APPID
    const secret = process.env.WECHAT_STORE_SECRET
    if (!appid || !secret) {
      throw new Error('未配置微信小店凭证')
    }
    const accessToken = await getAccessToken(appid, secret)
    const wechatCategories = await getAllCategories(accessToken)
    const matched = matchCategoryByTitle(title, wechatCategories)
    if (!matched) {
      return { matched: false, message: `未找到匹配类目，标题: ${title}` }
    }
    return {
      matched: true,
      categoryName: matched.categoryName,
      categoryPath: matched.categoryPath,
    }
  })
}

/** 应用退出时清理心跳 */
export function cleanupIpcHandlers(): void {
  platform?.nativeCli.stopHeartbeat()
}
