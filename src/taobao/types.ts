/**
 * 淘宝商品详情类型定义
 *
 * 本文件定义了从淘宝商品详情页提取的结构化数据类型。
 * 这些类型仅描述淘宝侧的数据，与微信小店无关。
 *
 * 数据来源：
 * - taobao-native CLI 的 read_page_content → 页面文本
 * - taobao-native CLI 的 get_product_skus → SKU JSON
 * - taobao-native CLI 的 scan_page_elements → 页面元素
 *
 * 转换目标：
 * - 最终通过 wechat-transform.ts 转换为 ProductInput（微信小店格式）
 */

// ============================================================
// 淘宝商品详情
// ============================================================

/**
 * 淘宝商品详情 — 从商品详情页提取的完整数据
 *
 * 这是淘宝商品信息的中间表示（IR），连接「数据采集」和「格式转换」两个阶段。
 * - 采集阶段：CLI 工具获取原始数据 → parser 解析为 TaobaoProductDetail
 * - 转换阶段：TaobaoProductDetail + 用户配置 → ProductInput
 */
export interface TaobaoProductDetail {
  /** 商品标题 */
  title: string
  /** 商品 ID（从 URL 中提取） */
  itemId: string
  /** 价格（元，字符串格式，如 "29.90"、"100"） */
  price: string
  /** 店铺名称 */
  shopName: string
  /** 商品描述文本 */
  description: string
  /** 主图 URL 列表（淘宝 CDN 链接，通常 3-9 张） */
  headImageUrls: string[]
  /** 详情图 URL 列表（淘宝 CDN 链接，通常 1-20 张） */
  descImageUrls: string[]
  /** SKU 列表（可能为空，表示单一规格商品） */
  skus: TaobaoProductSku[]
  /** 原始淘宝商品 URL */
  sourceUrl: string
}

/**
 * 淘宝商品 SKU 规格数据
 *
 * 淘宝 SKU 通常按规格维度组织：
 * - 颜色维度：红色、蓝色、黑色...
 * - 尺码维度：S、M、L、XL...
 * - 每个（颜色, 尺码）组合对应一个 SKU，有独立的价格和库存
 */
export interface TaobaoProductSku {
  /** SKU 规格属性，如 [{ key: "颜色", value: "红色" }, { key: "尺码", value: "M" }] */
  attributes: Array<{ key: string; value: string }>
  /** 价格（元，字符串格式，如 "29.90"） */
  price: string
  /** 库存数量（不一定能获取到） */
  stock?: number
  /** SKU 图片 URL（可选，通常只有颜色维度有图） */
  imageUrl?: string
}

// ============================================================
// 商品详情获取相关类型
// ============================================================

/** 商品详情获取选项 */
export interface FetchProductDetailOptions {
  /** 是否下载图片到本地（默认 true） */
  downloadImages?: boolean
  /** 图片下载超时（毫秒，默认 30000） */
  imageDownloadTimeout?: number
}

/** 商品详情获取结果 */
export interface FetchProductDetailResult {
  /** 是否成功 */
  success: boolean
  /** 商品详情（成功时有值） */
  detail?: TaobaoProductDetail
  /** 已下载的本地图片路径（成功且有图片时有值） */
  imagePaths?: {
    /** 主图本地路径列表 */
    headImagePaths: string[]
    /** 详情图本地路径列表 */
    descImagePaths: string[]
  }
  /** 原始数据源（调试用：CLI 返回的原始数据） */
  rawData?: {
    /** readFullPageContent 返回的页面全文 */
    pageContent: string
    /** scan_page_elements 返回的结构化元素 */
    elementsData: any
    /** get_product_skus 返回的 SKU JSON */
    skuData: any
  }
  /** 错误信息（失败时有值） */
  error?: string
  /** 各步骤执行详情 */
  steps: FetchStep[]
}

/** 单个步骤的执行结果 */
export interface FetchStep {
  /** 步骤名称 */
  name: string
  /** 是否成功 */
  success: boolean
  /** 耗时（毫秒） */
  duration: number
  /** 详情/错误信息 */
  detail?: string
}
