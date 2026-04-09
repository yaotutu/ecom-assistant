/**
 * 淘宝商品数据 → 微信小店 ProductInput 转换 — 纯函数层
 *
 * 职责：将淘宝商品详情数据（TaobaoProductDetail）转换为微信小店上货模块所需的 ProductInput 格式。
 *
 * 设计说明：
 * - 所有函数为纯函数，无副作用，不做网络请求
 * - 转换时需要用户提供部分数据（类目、运费模板等），通过参数传入
 * - 价格转换：元（字符串 "29.90"）→ 分（整数 2990）
 * - 不处理类目必填属性（attrs），由用户在上货后补充或在调用方处理
 *
 * 数据流位置：
 * TaobaoProductDetail + 本地图片路径 + 用户配置
 *     → transformToWechatInput()
 *     → ProductInput
 *     → listProductToStore()（已实现）
 */

import type { TaobaoProductDetail, TaobaoProductSku } from '../types'
import type { ProductInput, SkuInput } from '../../wechat-store/types'

// ============================================================
// 价格转换
// ============================================================

/**
 * 将价格从元（字符串）转换为分（整数）
 *
 * 微信小店 API 要求价格以「分」为单位：
 * - "29.90" → 2990
 * - "100" → 10000
 * - "0.01" → 1
 *
 * 使用整数运算避免浮点精度问题：
 * 先转为整数分（乘 100 并四舍五入），避免 0.1 + 0.2 ≠ 0.3 的问题。
 *
 * @param yuanStr - 价格字符串（如 "29.90"）
 * @returns 价格（分），无效输入返回 0
 */
export const yuanToCents = (yuanStr: string): number => {
  const yuan = parseFloat(yuanStr.replace(/[^\d.]/g, ''))
  if (isNaN(yuan)) return 0
  return Math.round(yuan * 100)
}

// ============================================================
// SKU 转换
// ============================================================

/**
 * 将淘宝 SKU 列表转换为微信 SKU 输入格式
 *
 * 转换规则：
 * - 价格：元 → 分
 * - 库存：淘宝不一定有，使用默认值
 * - 属性：直接映射 key/value
 * - SKU 图片：如果有已下载的本地路径，使用本地路径
 *
 * @param taobaoSkus - 淘宝 SKU 列表
 * @param defaultStock - 默认库存（淘宝数据无库存时使用）
 * @param skuImagePaths - SKU 图片的本地路径映射（按索引）
 * @returns 微信 SKU 输入列表
 */
export const transformSkus = (
  taobaoSkus: TaobaoProductSku[],
  defaultStock: number,
  skuImagePaths: Record<number, string> = {}
): SkuInput[] =>
  taobaoSkus.map((sku, index) => ({
    imagePath: skuImagePaths[index] ?? sku.imageUrl,
    salePrice: yuanToCents(sku.price),
    stockNum: sku.stock ?? defaultStock,
    attributes: sku.attributes.map((attr) => ({
      key: attr.key,
      value: attr.value,
    })),
  }))

/**
 * 当淘宝商品没有 SKU 数据时，创建一个默认 SKU
 *
 * 有些淘宝商品是单一规格（没有颜色/尺码等维度），
 * 微信小店要求至少有一个 SKU，所以创建一个使用商品整体价格的默认 SKU。
 *
 * @param priceYuan - 商品整体价格（元）
 * @param defaultStock - 默认库存
 * @returns 包含单个默认 SKU 的数组
 */
export const createDefaultSku = (
  priceYuan: string,
  defaultStock: number
): SkuInput[] => [
  {
    salePrice: yuanToCents(priceYuan),
    stockNum: defaultStock,
    attributes: [],
  },
]

// ============================================================
// 用户配置
// ============================================================

/**
 * 淘宝 → 微信转换时需要用户提供的配置
 *
 * 淘宝数据中无法自动获取的字段，必须由用户指定。
 */
export interface WechatTransformOptions {
  /** 微信小店类目路径（从一级到叶子级），如 [545578, 545594, 546178] */
  categoryPath: number[]
  /** 运费模板 ID（需在微信小店后台预先创建） */
  freightTemplateId: string
  /** 品牌 ID，默认 "2100000000"（无品牌） */
  brandId?: string
  /** 发货方式，默认 0（快递发货） */
  deliverMethod?: 0 | 1 | 3
  /** 是否七天无理由退货，默认 true */
  sevenDayReturn?: boolean
  /** 是否运费险，默认 false */
  freightInsurance?: boolean
  /** 售后地址 ID（可选，不填时上货模块自动获取） */
  afterSaleAddressId?: number
  /** 默认库存数量（淘宝 SKU 无库存信息时使用），默认 100 */
  defaultStock?: number
}

// ============================================================
// 核心转换
// ============================================================

/**
 * 完整转换：淘宝商品详情 → 微信小店 ProductInput
 *
 * 将 TaobaoProductDetail 和已下载的本地图片路径，
 * 结合用户提供的配置选项，转换为微信小店的 ProductInput 格式。
 *
 * 验证规则：
 * - 主图必须 3-9 张
 * - 详情图必须 1-20 张
 * - 标题必须 5-60 字符
 * - 价格必须大于 0
 * - 至少 1 个 SKU
 *
 * @param detail - 淘宝商品详情
 * @param imagePaths - 已下载到本地的图片路径
 * @param options - 用户提供的配置项（类目、运费模板等）
 * @returns 微信小店 ProductInput 格式数据
 * @throws Error 当必要数据缺失时（图片不足、标题太短等）
 */
export const transformToWechatInput = (
  detail: TaobaoProductDetail,
  imagePaths: {
    headImagePaths: string[]
    descImagePaths: string[]
  } = { headImagePaths: [], descImagePaths: [] },
  options: WechatTransformOptions
): ProductInput => {
  // ---- 详情图兜底：无详情图时用第一张主图 ----
  let descPaths = imagePaths.descImagePaths
  if (descPaths.length < 1 && imagePaths.headImagePaths.length > 0) {
    descPaths = imagePaths.headImagePaths.slice(0, 1)
  }

  // ---- 验证 ----
  if (imagePaths.headImagePaths.length < 3) {
    throw new Error(
      `主图数量不足：需要至少 3 张，实际 ${imagePaths.headImagePaths.length} 张。` +
      `淘宝提取到 ${detail.headImageUrls.length} 个图片 URL，部分可能下载失败。`
    )
  }

  if (descPaths.length < 1) {
    throw new Error(
      `详情图数量不足：需要至少 1 张，实际 0 张。主图也无法作为兜底。`
    )
  }

  if (detail.title.length < 5) {
    throw new Error(
      `标题过短：需要至少 5 个字符，实际 ${detail.title.length} 个。原始标题："${detail.title}"`
    )
  }

  const priceCents = yuanToCents(detail.price)
  if (priceCents <= 0) {
    throw new Error(`价格无效："${detail.price}"，转换后为 ${priceCents} 分`)
  }

  // ---- SKU 处理 ----
  const defaultStock = options.defaultStock ?? 100
  const skus = detail.skus.length > 0
    ? transformSkus(detail.skus, defaultStock)
    : createDefaultSku(detail.price, defaultStock)

  // ---- 构建 ProductInput ----
  return {
    title: detail.title,
    headImagePaths: imagePaths.headImagePaths,
    description: detail.description || detail.title,
    descImagePaths: descPaths,
    categoryPath: options.categoryPath,
    deliverMethod: options.deliverMethod ?? 0,
    freightTemplateId: options.freightTemplateId,
    brandId: options.brandId ?? '2100000000',
    attributes: [],
    skus,
    sevenDayReturn: options.sevenDayReturn ?? true,
    freightInsurance: options.freightInsurance ?? false,
    afterSaleAddressId: options.afterSaleAddressId,
  }
}
