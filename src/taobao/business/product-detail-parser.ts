/**
 * 淘宝商品详情页解析 — 纯函数层
 *
 * 职责：从淘宝 native CLI 返回的原始数据中，
 * 提取出结构化的商品信息（标题、价格、图片、SKU 等）。
 *
 * 设计原则：
 * - 所有函数为纯函数，无副作用，无网络请求
 * - 解析失败时返回尽可能多的已提取数据（空字符串/空数组），不抛异常
 *
 * CLI 实际返回的数据格式（三个数据源）：
 *
 * 1. pageContent（readFullPageContent）：
 *    带标签的文本格式，如：
 *    [商品id] 797195629389
 *    [商品主图] https://img.alicdn.com/...
 *    [商品图] https://img.alicdn.com/...
 *    保联五金品牌企业店4.988VIP好评率98%...
 *    保联钟表螺丝刀手机维修套装...（标题）
 *    券后￥5.8起 卖家优惠￥8起
 *    商品规格\n切换大图模式\n【入门级】6件套螺丝批\n...
 *
 * 2. elementsData（scan_page_elements）：
 *    { result: { dom: "文本 DOM 树字符串", totalElements: 174 } }
 *    dom 是一个格式化的文本树，不是结构化 JSON
 *
 * 3. skuData（get_product_skus）：
 *    { result: { success, hasSku, availableSkus: [{ label, options: [{ text, disabled, selected, image? }] }] } }
 *    每个 availableSku 是一个规格维度（如"商品规格"）
 *    options 是该维度下的选项（如"【入门级】6件套螺丝批"）
 *    注意：部分 options 的 text 为空字符串或 disabled=true，需要过滤
 */

import type { TaobaoProductDetail, TaobaoProductSku } from '../types'
import { stripSizeSuffix } from './image-utils'

// ============================================================
// URL 解析
// ============================================================

/**
 * 从淘宝 URL 中提取商品 ID
 *
 * 支持的 URL 格式：
 * - https://item.taobao.com/item.htm?id=123456789
 * - https://detail.tmall.com/item.htm?id=123456789
 * - https://h5.m.taobao.com/awp/core/detail.htm?id=123456789
 *
 * @param url - 淘宝商品 URL
 * @returns 商品 ID 字符串，提取失败返回空字符串
 */
export const extractItemIdFromUrl = (url: string): string => {
  const match = url.match(/[?&]id=(\d+)/)
  return match?.[1] ?? ''
}

// ============================================================
// 页面文本解析（pageContent — 带标签的文本）
// ============================================================

/**
 * 从页面文本中提取商品 ID
 *
 * 格式：[商品id] 797195629389
 *
 * @param pageContent - readFullPageContent 返回的页面全文
 * @returns 商品 ID，提取失败返回空字符串
 */
export const extractItemIdFromContent = (pageContent: string): string => {
  const match = pageContent.match(/\[商品id\]\s*(\d+)/)
  return match?.[1] ?? ''
}

/**
 * 从页面文本中提取商品标题
 *
 * 页面文本中的标题通常出现在店铺信息之后、价格之前。
 * 例如："保联钟表螺丝刀手机维修套装一字十字拆机工具精密螺丝批改锥起子"
 *
 * 策略：
 * 1. 从「图文详情」标签后提取（最可靠）
 * 2. 回退：在图片标签之后、店铺名之前的长文本
 *
 * @param pageContent - 页面全文
 * @returns 商品标题，提取失败返回空字符串
 */
export const extractTitle = (pageContent: string): string => {
  // 策略 1：「图文详情」后通常紧跟商品标题
  const detailTitleMatch = pageContent.match(/图文详情\s+([\u4e00-\u9fa5\w\s\-\+（）()【】\[\]·、\/]+?)[\n\s]*券后/)
  if (detailTitleMatch) {
    return detailTitleMatch[1].trim()
  }

  // 策略 2：最后一个「[商品图]」行之后，到「券后」或「￥」之前
  const afterImagesMatch = pageContent.match(/(?:\[商品图\][^\n]*\n)*\n*([\u4e00-\u9fa5\w\s\-\+（）()【】\[\]·、\/]{10,150})\n[\s\S]*?券后/)
  if (afterImagesMatch) {
    return afterImagesMatch[1].trim()
  }

  // 策略 3：直接匹配第二个出现的长中文标题（第一个通常是店铺名）
  const titles = pageContent.match(/[\u4e00-\u9fa5\w\s\-\+（）()【】\[\]·、\/]{15,150}/g)
  if (titles && titles.length >= 2) {
    // 过滤掉看起来像店铺名的（包含"店"且较短）
    const filtered = titles.filter(t => t.length > 15 && !t.includes('好评率'))
    if (filtered.length > 0) return filtered[0].trim()
  }

  return ''
}

/**
 * 从页面文本中提取价格
 *
 * 页面文本中的价格格式：
 * - "券后￥5.8起" → 券后价格 5.8
 * - "卖家优惠￥8起" → 卖家原价 8
 *
 * 优先取「卖家优惠」价格（更接近实际售价），回退取第一个 ￥ 价格。
 *
 * @param pageContent - 页面全文
 * @returns 价格字符串（如 "5.8"、"8"），提取失败返回空字符串
 */
export const extractPrice = (pageContent: string): string => {
  // 优先匹配「卖家优惠￥XX」
  const sellerPriceMatch = pageContent.match(/卖家优惠\s*￥\s*(\d+\.?\d*)/)
  if (sellerPriceMatch) {
    return sellerPriceMatch[1]
  }

  // 回退：匹配第一个「￥XX」
  const priceMatch = pageContent.match(/￥\s*(\d+\.?\d*)/)
  if (priceMatch) {
    return priceMatch[1]
  }

  return ''
}

/**
 * 从页面文本中提取店铺名称
 *
 * 店铺名通常紧跟在图片标签后面，如：
 * "保联五金品牌企业店4.988VIP好评率98%..."
 *
 * 策略：匹配「店」字结尾的连续文字，提取店铺名。
 *
 * @param pageContent - 页面全文
 * @returns 店铺名称，提取失败返回空字符串
 */
export const extractShopName = (pageContent: string): string => {
  // 匹配 X店、X旗舰店、X专营店 等格式
  const shopMatch = pageContent.match(/([\u4e00-\u9fa5\w]{2,30}(?:店|铺))[\d\.]*(?:好评率|评分)/)
  if (shopMatch) {
    return shopMatch[1]
  }

  // 回退：匹配「进店」前的文字
  const enterShopMatch = pageContent.match(/([\u4e00-\u9fa5\w]{2,30}(?:店|铺))[\s]*进店/)
  if (enterShopMatch) {
    return enterShopMatch[1]
  }

  return ''
}

/**
 * 从页面文本中提取商品描述/参数信息
 *
 * 格式：
 * 参数信息
 * 中国大陆产地
 * 保联品牌
 * 铬钒合金钢材质
 * ...
 *
 * @param pageContent - 页面全文
 * @returns 描述文本，提取失败返回空字符串
 */
export const extractDescription = (pageContent: string): string => {
  const descMatch = pageContent.match(/参数信息\s*\n([\s\S]{0,2000}?)(?:图文详情|商品规格|$)/)
  if (descMatch) {
    return descMatch[1].replace(/\n{3,}/g, '\n\n').trim()
  }

  return ''
}

// ============================================================
// 图片 URL 提取
// ============================================================

/**
 * 从页面文本中提取主图 URL 列表
 *
 * 页面文本格式：
 * [商品主图] https://img.alicdn.com/imgextra/.../xxx.jpg_q50.jpg_.webp
 * [商品图] https://img.alicdn.com/imgextra/.../xxx.jpg_q50.jpg_.webp
 *
 * [商品主图] 是第一张主图，[商品图] 是其余主图（通常 4-8 张）
 *
 * @param pageContent - 页面全文文本
 * @returns 主图 URL 列表（去重，去掉尺寸后缀，最多 9 张）
 */
export const extractHeadImageUrls = (
  pageContent: string,
  _elementsData?: any
): string[] => {
  const urls: string[] = []
  const seen = new Set<string>()

  // 匹配 [商品主图] 和 [商品图] 标签后的 alicdn URL
  const imgRegex = /\[(?:商品主图|商品图)\]\s*(https?:\/\/[^\s]+)/g
  let match: RegExpExecArray | null

  while ((match = imgRegex.exec(pageContent)) !== null) {
    const rawUrl = match[1]
    // 去掉淘宝的尺寸后缀（如 _q50.jpg_.webp → 原图）
    const cleanUrl = stripSizeSuffix(rawUrl)
    if (!seen.has(cleanUrl)) {
      seen.add(cleanUrl)
      urls.push(cleanUrl)
    }
  }

  return urls.slice(0, 9)
}

/**
 * 从页面文本中提取详情图 URL 列表
 *
 * 详情图通常在「图文详情」区域，但 readFullPageContent 可能无法获取到
 * 详情区域的图片（需要滚动加载）。当前实现为占位，返回空数组。
 *
 * @param pageContent - 页面全文文本
 * @returns 详情图 URL 列表
 */
export const extractDescImageUrls = (
  pageContent: string,
  _elementsData?: any
): string[] => {
  // 详情图通常需要滚动到页面底部才能加载
  // readFullPageContent 可能获取不到，先从文本中尝试提取
  const descSection = pageContent.match(/图文详情([\s\S]*)/)
  if (!descSection) return []

  const urlRegex = /https?:\/\/(?:img|gw|imgextra)\.alicdn\.com\/[^\s]+/g
  const matches = descSection[1].match(urlRegex) ?? []

  const seen = new Set<string>()
  const urls: string[] = []
  for (const url of matches) {
    const cleanUrl = stripSizeSuffix(url)
    if (!seen.has(cleanUrl)) {
      seen.add(cleanUrl)
      urls.push(cleanUrl)
    }
  }

  return urls.slice(0, 20)
}

// ============================================================
// SKU 数据解析
// ============================================================

/**
 * 解析 get_product_skus 返回的 SKU 数据
 *
 * 实际数据格式：
 * {
 *   result: {
 *     success: true,
 *     hasSku: true,
 *     availableSkus: [
 *       {
 *         label: "商品规格切换大图模式",  // 规格维度名称
 *         options: [
 *           { text: "【入门级】6件套螺丝批", disabled: false, image: "https://..." },
 *           { text: "", disabled: false },  // 空 text，需过滤
 *           { text: "【入门级】6件套螺丝批+加磁器", disabled: true },  // 已下架，需过滤
 *         ]
 *       }
 *     ]
 *   }
 * }
 *
 * 处理规则：
 * - 过滤掉 text 为空的选项
 * - 过滤掉 disabled=true 的选项
 * - 去重（text 相同的选项只保留第一个）
 * - 每个有效选项生成一个 TaobaoProductSku
 * - 单维度 SKU：attributes 为 [{ key: "规格", value: "选项文本" }]
 * - 多维度 SKU：每个维度组合生成一个 SKU（暂不处理，实际淘宝多维度场景需特殊处理）
 *
 * 注意：SKU 数据中不含价格，价格从页面文本中提取（全局价格或需要用户选择后获取）
 *
 * @param skuRawData - get_product_skus 返回的原始 JSON
 * @returns 解析后的 SKU 列表
 */
export const parseSkuData = (skuRawData: any): TaobaoProductSku[] => {
  if (!skuRawData) return []

  // 解包：支持 { result: { availableSkus } } 或直接 { availableSkus }
  const result = skuRawData?.result ?? skuRawData
  const availableSkus = result?.availableSkus
  if (!Array.isArray(availableSkus) || availableSkus.length === 0) return []

  const skus: TaobaoProductSku[] = []
  const seenTexts = new Set<string>()

  // 处理单维度 SKU（最常见的情况）
  if (availableSkus.length === 1) {
    const group = availableSkus[0]
    const options = group?.options
    if (!Array.isArray(options)) return []

    // 维度名称：去掉"切换大图模式"等后缀
    const dimensionName = (group.label ?? '规格').replace(/切换大图模式$/, '').trim() || '规格'

    for (const opt of options) {
      if (!opt || typeof opt !== 'object') continue
      if (opt.disabled) continue
      const text = (opt.text ?? '').trim()
      if (!text) continue
      if (seenTexts.has(text)) continue
      seenTexts.add(text)

      skus.push({
        attributes: [{ key: dimensionName, value: text }],
        price: '',  // SKU 级别的价格不在 availableSkus 中
        imageUrl: opt.image ?? undefined,
      })
    }
    return skus
  }

  // 多维度 SKU：组合各维度选项
  // 例如：颜色 × 尺码 → 每个组合一个 SKU
  // TODO: 暂不实现多维度组合，只处理单维度

  return skus
}

// ============================================================
// 合并构建
// ============================================================

/**
 * 合并所有数据源，构建完整的商品详情
 *
 * 优先级：
 * - 商品 ID：pageContent 的 [商品id] 标签 > URL 参数
 * - 标题/价格/店铺名：pageContent 解析
 * - 主图/详情图：pageContent 的 [商品主图]/[商品图] 标签
 * - SKU：skuData 的 availableSkus
 *
 * @param pageContent - readFullPageContent 返回的页面全文
 * @param _elementsData - scan_page_elements 返回的数据（当前未使用，预留）
 * @param skuData - get_product_skus 返回的 SKU 数据
 * @param url - 原始商品 URL
 * @returns 结构化的淘宝商品详情
 */
export const buildProductDetail = (
  pageContent: string,
  _elementsData: any,
  skuData: any,
  url: string
): TaobaoProductDetail => {
  // 商品 ID：优先从页面文本提取，回退到 URL 参数
  const itemId = extractItemIdFromContent(pageContent) || extractItemIdFromUrl(url)
  const title = extractTitle(pageContent)
  const price = extractPrice(pageContent)
  const shopName = extractShopName(pageContent)
  const description = extractDescription(pageContent)
  const headImageUrls = extractHeadImageUrls(pageContent)
  const descImageUrls = extractDescImageUrls(pageContent)
  const skus = parseSkuData(skuData)

  // 将全局价格赋给没有价格的 SKU
  const skusWithPrice = price
    ? skus.map(sku => ({ ...sku, price: sku.price || price }))
    : skus

  return {
    title,
    itemId,
    price,
    shopName,
    description,
    headImageUrls,
    descImageUrls,
    skus: skusWithPrice,
    sourceUrl: url,
  }
}
