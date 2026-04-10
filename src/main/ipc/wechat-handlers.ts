/**
 * 微信小店相关 IPC handlers
 *
 * 职责：
 * - 获取 access_token
 * - 一键上货（淘宝 → 微信小店）
 * - 浏览器标签页上传已提取商品
 * - 测试类目匹配
 */

import { BrowserWindow } from 'electron'
import { getAccessToken, getAllCategories, listProductToStore } from '../../wechat-store'
import { fetchProductDetailV2 } from '../../taobao/product-fetcher-v2'
import { transformToWechatInput } from '../../taobao/business/wechat-transform'
import { downloadImages, filterSuccessfulDownloads } from '../../taobao/business/image-downloader'
import { matchCategory } from '../../taobao/business/category-matcher'
import type { WechatTransformOptions } from '../../taobao/business/wechat-transform'
import { handle } from '../ipc-handlers'

const IPC = {
  FETCH_PRODUCT_DETAIL: 'platform:fetch-product-detail',
  TAOBAO_TO_WECHAT: 'platform:taobao-to-wechat',
  GET_WECHAT_TOKEN: 'wechat:get-token',
  UPLOAD_EXTRACTED_PRODUCT: 'taobao:upload-extracted-product',
  TEST_CATEGORY_MATCH: 'wechat:test-category-match',
} as const

// ============================================================
// 凭证获取（消除重复）
// ============================================================

/**
 * 从环境变量获取微信小店凭证并换取 access_token
 *
 * 统一管理 4 处重复的 appid/secret 读取逻辑。
 * @throws 未配置凭证时抛出错误
 */
const getWechatAccessToken = async (): Promise<string> => {
  const appid = process.env.WECHAT_STORE_APPID
  const secret = process.env.WECHAT_STORE_SECRET
  if (!appid || !secret) {
    throw new Error('未配置微信小店凭证，请在 .env 中设置 WECHAT_STORE_APPID 和 WECHAT_STORE_SECRET')
  }
  return await getAccessToken(appid, secret)
}

// ============================================================
// Handler 注册
// ============================================================

export function registerWechatHandlers(win: BrowserWindow): void {

  // ─── 获取淘宝商品详情（V2：基于 WebView） ──
  handle(IPC.FETCH_PRODUCT_DETAIL, async (url: string) => {
    return await fetchProductDetailV2(url, win)
  })

  // ─── 淘宝商品 → 微信小店一键上货 ──────────────────
  handle(IPC.TAOBAO_TO_WECHAT, async (
    url: string,
    transformOptions: WechatTransformOptions,
    listOptions?: { autoList?: boolean }
  ) => {
    const accessToken = await getWechatAccessToken()

    // 获取淘宝商品详情 + 下载图片
    const fetchResult = await fetchProductDetailV2(url, win)
    if (!fetchResult.success || !fetchResult.detail || !fetchResult.imagePaths) {
      throw new Error(fetchResult.error ?? '获取商品详情失败')
    }

    // 转换为微信小店格式
    const productInput = transformToWechatInput(
      fetchResult.detail,
      fetchResult.imagePaths,
      transformOptions
    )

    // 上货到微信小店
    return await listProductToStore(accessToken, productInput, {
      autoList: listOptions?.autoList ?? false,
    })
  })

  // ─── 获取微信小店 access_token ─────────────────────
  handle(IPC.GET_WECHAT_TOKEN, async () => {
    return await getWechatAccessToken()
  })

  // ─── 浏览器标签页：上传已提取的商品到微信小店 ──────
  handle(IPC.UPLOAD_EXTRACTED_PRODUCT, async (
    product: {
      title: string; itemId: string; price: string; shopName: string
      description: string; headImageUrls: string[]; descImageUrls: string[]
      skus: Array<{ attributes: Array<{ key: string; value: string }>; price: string }>
      sourceUrl: string
      categoryNames?: string[]
    },
    transformOptions: any,
    listOptions?: { autoList?: boolean }
  ) => {
    const accessToken = await getWechatAccessToken()

    // 匹配微信小店类目
    const wechatCategories = await getAllCategories(accessToken)
    const taobaoCategoryNames = (product as any).categoryNames || []
    const matched = await matchCategory(product.title, taobaoCategoryNames, wechatCategories)
    if (!matched) {
      throw new Error(`无法匹配微信小店类目，商品标题: ${product.title}，淘宝类目: ${taobaoCategoryNames.join(' > ') || '无'}`)
    }
    console.log(`[类目匹配] 标题: ${product.title}, 淘宝类目: ${taobaoCategoryNames.join('>')} → 微信: ${matched.categoryName} (IDs: ${matched.categoryPath})`)

    // 下载主图
    const headResults = await downloadImages(product.headImageUrls, { prefix: 'head' })
    const headImagePaths = filterSuccessfulDownloads(headResults)
    if (headImagePaths.length < 3) {
      throw new Error(`主图下载不足：需 3 张，仅成功 ${headImagePaths.length} 张`)
    }

    // 下载详情图
    const descResults = await downloadImages(product.descImageUrls, { prefix: 'desc' })
    const descImagePaths = filterSuccessfulDownloads(descResults)

    // 转换为微信小店格式
    const productInput = transformToWechatInput(
      product as any,
      { headImagePaths, descImagePaths },
      {
        categoryPath: matched.categoryPath,
        freightTemplateId: transformOptions.freightTemplateId ?? '1',
        defaultStock: transformOptions.defaultStock ?? 100,
      }
    )

    // 上货
    return await listProductToStore(accessToken, productInput, {
      autoList: listOptions?.autoList ?? false,
    })
  })

  // ─── 测试类目匹配 ──────────────────────────────
  handle(IPC.TEST_CATEGORY_MATCH, async (title: string, categoryNames?: string[]) => {
    const accessToken = await getWechatAccessToken()
    const wechatCategories = await getAllCategories(accessToken)
    const matched = await matchCategory(title, categoryNames || [], wechatCategories)
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
