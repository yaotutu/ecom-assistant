/**
 * 淘宝商品详情获取 V2 — 基于 BrowserWindow 的 WebView 方案
 *
 * 完整流程：
 * 1. 检查登录状态（未登录则弹出登录窗口）
 * 2. 创建隐藏的 BrowserWindow（使用持久化 session）
 * 3. 导航到商品详情页
 * 4. 注入 JS 脚本提取商品核心数据（标题、价格、主图、SKU 等）
 * 5. 模拟滚动触发详情图懒加载
 * 6. 提取详情图 URL
 * 7. 下载图片到本地
 * 8. 返回完整的 FetchProductDetailResult
 *
 * 与 V1（基于 native-cli）的区别：
 * - 不依赖淘宝桌面版 CLI
 * - 详情图可通过滚动获取
 * - 数据从页面 JS 变量提取，更稳定
 * - 登录态由用户控制，不依赖桌面版登录
 */

import { BrowserWindow } from 'electron'
import { getTaobaoSession, ensureLoggedIn, RateLimiter, getChromeUserAgent, randomDelay, generateScrollSequence } from './auth'
import {
  EXTRACT_PRODUCT_DATA,
  GET_PAGE_HEIGHT,
  createScrollAndExtractScript,
  parseExtractedData,
  parseDescImages,
} from './business/page-extract-scripts'
import { downloadImages, filterSuccessfulDownloads } from './business/image-downloader'
import type { TaobaoProductDetail, FetchProductDetailResult, FetchStep, FetchProductDetailOptions } from './types'

// ============================================================
// 工具函数
// ============================================================

/** 计时工具 */
const timed = async <T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> => {
  const start = Date.now()
  const result = await fn()
  return { result, duration: Date.now() - start }
}

/** 创建成功的步骤记录 */
const ok = (name: string, duration: number, detail?: string): FetchStep => ({
  name, success: true, duration, detail,
})

/** 创建失败的步骤记录 */
const fail = (name: string, duration: number, error: string): FetchStep => ({
  name, success: false, duration, detail: error,
})

/** 等待指定毫秒 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ============================================================
// 全局限流器
// ============================================================

/** 全局商品详情请求限流器（每次请求间隔 8~15 秒，每小时最多 20 次） */
const rateLimiter = new RateLimiter(8_000, 20)

// ============================================================
// 核心流程
// ============================================================

/**
 * 获取淘宝商品详情（WebView 版本）
 *
 * @param url - 淘宝商品 URL（如 https://item.taobao.com/item.htm?id=xxx）
 * @param parentWindow - 父窗口（用于登录窗口的模态定位），可选
 * @param options - 获取选项
 * @returns FetchProductDetailResult，与 V1 返回格式兼容
 */
export const fetchProductDetailV2 = async (
  url: string,
  parentWindow?: BrowserWindow,
  options?: FetchProductDetailOptions
): Promise<FetchProductDetailResult> => {
  const shouldDownload = options?.downloadImages ?? true
  const steps: FetchStep[] = []
  const push = (step: FetchStep) => steps.push(step)
  let fetchWin: BrowserWindow | null = null

  try {
    // ---- 步骤 0：限流等待 ----
    const { result: waitMs, duration: waitDuration } = await timed(() => rateLimiter.waitForSlot())
    rateLimiter.recordRequest()
    push(ok('限流等待', waitDuration, `等待 ${Math.round(waitMs)}ms`))

    // ---- 步骤 1：确保已登录 ----
    const { duration: loginDuration } = await timed(async () => {
      const loggedIn = await ensureLoggedIn(parentWindow)
      if (!loggedIn) {
        throw new Error('淘宝登录失败或已取消，请重试')
      }
    })
    push(ok('登录检查', loginDuration, 'session 有效'))

    // ---- 步骤 2：创建隐藏 BrowserWindow ----
    const ses = getTaobaoSession()
    const userAgent = getChromeUserAgent()

    fetchWin = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false, // 隐藏窗口，用户看不到
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        // 允许加载图片等资源（不拦截，模拟正常浏览）
        images: true,
        javascript: true,
      },
    })

    // 设置 UA，去掉 Electron 标识
    fetchWin.webContents.setUserAgent(userAgent)

    // 阻止新窗口弹出（广告、推荐等）
    fetchWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    push(ok('创建抓取窗口', 0))

    // ---- 步骤 3：导航到商品详情页 ----
    const { duration: navDuration } = await timed(() =>
      fetchWin!.webContents.loadURL(url)
    )
    push(ok('导航到商品页', navDuration, url))

    // ---- 步骤 4：等待页面加载 ----
    // 等待 dom-ready 后额外等待 JS 执行和数据加载
    await sleep(3000)
    push(ok('等待页面加载', 3000))

    // 检查是否被重定向到登录页（session 可能在请求间过期）
    const currentUrl = fetchWin.webContents.getURL()
    if (currentUrl.includes('login.taobao.com') || currentUrl.includes('login.tmall.com')) {
      throw new Error('登录态已过期，请重新登录')
    }

    // ---- 步骤 5：注入 JS 提取商品核心数据 ----
    const { result: rawJson, duration: extractDuration } = await timed(() =>
      fetchWin!.webContents.executeJavaScript(EXTRACT_PRODUCT_DATA)
    )
    push(ok('提取商品数据', extractDuration, `数据来源: ${JSON.parse(rawJson).extractSource || 'unknown'}`))

    const detail: TaobaoProductDetail = parseExtractedData(rawJson, url)
    push(ok('解析商品数据', 0, `标题: ${detail.title}, 主图: ${detail.headImageUrls.length}, SKU: ${detail.skus.length}`))

    // ---- 步骤 6：模拟滚动 + 提取详情图 ----
    const { result: pageHeight, duration: heightDuration } = await timed(() =>
      fetchWin!.webContents.executeJavaScript(GET_PAGE_HEIGHT)
    )
    push(ok('获取页面高度', heightDuration, `${pageHeight}px`))

    let descImageUrls: string[] = detail.descImageUrls

    if (pageHeight > 1000) {
      // 生成滚动步骤并执行
      const scrollSteps = generateScrollSequence(pageHeight)
      const scrollScript = createScrollAndExtractScript(scrollSteps)

      const { result: scrollResult, duration: scrollDuration } = await timed(() =>
        fetchWin!.webContents.executeJavaScript(scrollScript)
      )

      const scrollImages = parseDescImages(scrollResult)
      if (scrollImages.length > 0) {
        descImageUrls = scrollImages
      }
      push(ok('滚动提取详情图', scrollDuration, `${descImageUrls.length} 张详情图`))
    } else {
      push(ok('滚动提取详情图', 0, '页面较短，跳过滚动'))
    }

    // 合并详情图到 detail
    const fullDetail: TaobaoProductDetail = {
      ...detail,
      descImageUrls,
    }

    // ---- 步骤 7：关闭抓取窗口 ----
    if (!fetchWin.isDestroyed()) {
      fetchWin.close()
    }
    fetchWin = null
    push(ok('关闭抓取窗口', 0))

    // ---- 步骤 8：下载图片 ----
    let headImagePaths: string[] = []
    let descImagePaths: string[] = []

    if (shouldDownload) {
      const { result: headResults, duration: headDuration } = await timed(() =>
        downloadImages(fullDetail.headImageUrls, {
          prefix: 'head',
          timeout: options?.imageDownloadTimeout,
        })
      )
      headImagePaths = filterSuccessfulDownloads(headResults)
      push(ok('下载主图', headDuration, `${headImagePaths.length}/${fullDetail.headImageUrls.length} 成功`))

      const { result: descResults, duration: descDuration } = await timed(() =>
        downloadImages(fullDetail.descImageUrls, {
          prefix: 'desc',
          timeout: options?.imageDownloadTimeout,
        })
      )
      descImagePaths = filterSuccessfulDownloads(descResults)
      push(ok('下载详情图', descDuration, `${descImagePaths.length}/${fullDetail.descImageUrls.length} 成功`))
    }

    return {
      success: true,
      detail: fullDetail,
      imagePaths: { headImagePaths, descImagePaths },
      rawData: {
        pageContent: rawJson,
        elementsData: null,
        skuData: null,
      },
      steps,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    push(fail('获取商品详情', 0, errorMsg))

    // 确保窗口被关闭
    if (fetchWin && !fetchWin.isDestroyed()) {
      fetchWin.close()
    }

    return { success: false, error: errorMsg, steps }
  }
}
