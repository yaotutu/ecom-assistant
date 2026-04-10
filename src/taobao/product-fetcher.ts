/**
 * 淘宝商品详情获取 — 编排层（V1，基于 NativeCli）
 *
 * @deprecated 当前项目使用 V2（product-fetcher-v2.ts，基于 BrowserWindow）。
 * 本文件仅作为参考保留，不应在新功能中调用。
 * V1 依赖淘宝桌面版 native CLI，V2 通过 WebView 直接访问页面，数据更稳定。
 *
 * 完整流程：
 * 1. 从 URL 提取商品 ID
 * 2. 导航到商品详情页
 * 3. 等待页面加载
 * 4. 读取页面内容 + 获取 SKU 数据 + 扫描页面元素
 * 5. 解析页面内容为结构化商品数据
 * 6. 下载图片到本地
 * 7. 返回完整的淘宝商品详情 + 本地图片路径
 *
 * 注意：详情图（图文详情区域）为懒加载，当前无法通过 CLI 获取。
 * 后续会开发独立的详情图获取功能。
 */

import type { NativeCli } from './connection/native-cli'
import type { TaobaoProductDetail, FetchProductDetailResult, FetchStep, FetchProductDetailOptions } from './types'
import { extractItemIdFromUrl, buildProductDetail } from './business/product-detail-parser'
import { downloadImages, filterSuccessfulDownloads } from './business/image-downloader'
import { sleep, timed, ok, fail } from '../shared/utils'

// ============================================================
// 核心流程
// ============================================================

/**
 * 获取淘宝商品详情
 *
 * @param cli - NativeCli 实例（需已连接）
 * @param url - 淘宝商品 URL
 * @param options - 获取选项
 */
export const fetchProductDetail = async (
  cli: NativeCli,
  url: string,
  options?: FetchProductDetailOptions
): Promise<FetchProductDetailResult> => {
  const shouldDownload = options?.downloadImages ?? true
  const steps: FetchStep[] = []
  const push = (step: FetchStep) => steps.push(step)

  try {
    // ---- 步骤 1：提取商品 ID ----
    const itemId = extractItemIdFromUrl(url)
    if (!itemId) {
      throw new Error(`无法从 URL 提取商品 ID: ${url}`)
    }
    push(ok('提取商品 ID', 0, `itemId: ${itemId}`))

    // ---- 步骤 2：导航到商品详情页 ----
    const { duration: navDuration } = await timed(() => cli.navigateToUrl(url))
    push(ok('导航到商品页', navDuration, url))

    // ---- 步骤 3：等待页面加载 ----
    await sleep(3000)
    push(ok('等待页面加载', 3000))

    // ---- 步骤 4：并行读取三个数据源 ----
    const [pageContentResult, skuDataResult, elementsDataResult] = await Promise.all([
      timed(() => cli.readFullPageContent()).catch((e) => ({
        result: '' as string,
        duration: 0,
        error: e,
      })),
      timed(() => cli.getProductSkus().catch(() => null)),
      timed(() => cli.scanPageElements().catch(() => null)),
    ])

    if ('error' in pageContentResult) {
      throw new Error(
        `读取页面内容失败: ${pageContentResult.error instanceof Error ? pageContentResult.error.message : String(pageContentResult.error)}`
      )
    }
    const pageContent = pageContentResult.result as string
    push(ok('读取页面内容', pageContentResult.duration, `${pageContent.length} 字符`))

    const skuData = skuDataResult.result
    push(ok('获取 SKU 数据', skuDataResult.duration, skuData ? '有数据' : '无数据'))

    const elementsData = elementsDataResult.result
    push(ok('扫描页面元素', elementsDataResult.duration, elementsData ? '有数据' : '无数据'))

    // ---- 步骤 5：解析为结构化商品数据 ----
    const { result: detail, duration: parseDuration } = await timed(() =>
      Promise.resolve(buildProductDetail(pageContent, elementsData, skuData, url))
    )
    push(ok('解析商品数据', parseDuration, `标题: ${detail.title}, 主图: ${detail.headImageUrls.length}, 详情图: ${detail.descImageUrls.length}, SKU: ${detail.skus.length}`))

    // ---- 步骤 6：下载图片 ----
    let headImagePaths: string[] = []
    let descImagePaths: string[] = []

    if (shouldDownload) {
      const { result: headResults, duration: headDuration } = await timed(() =>
        downloadImages(detail.headImageUrls, {
          prefix: 'head',
          timeout: options?.imageDownloadTimeout,
        })
      )
      headImagePaths = filterSuccessfulDownloads(headResults)
      push(ok('下载主图', headDuration, `${headImagePaths.length}/${detail.headImageUrls.length} 成功`))

      const { result: descResults, duration: descDuration } = await timed(() =>
        downloadImages(detail.descImageUrls, {
          prefix: 'desc',
          timeout: options?.imageDownloadTimeout,
        })
      )
      descImagePaths = filterSuccessfulDownloads(descResults)
      push(ok('下载详情图', descDuration, `${descImagePaths.length}/${detail.descImageUrls.length} 成功`))
    }

    return {
      success: true,
      detail,
      imagePaths: { headImagePaths, descImagePaths },
      rawData: { pageContent, elementsData, skuData },
      steps,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    push(fail('获取商品详情', 0, errorMsg))
    return { success: false, error: errorMsg, steps }
  }
}
