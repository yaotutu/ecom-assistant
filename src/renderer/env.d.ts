/// <reference types="vite/client" />

/**
 * 渲染进程全局类型声明
 *
 * 注意：渲染进程无法直接 import 主进程的 core/types.ts（不同打包上下文），
 * 所以此文件保留前端侧的类型声明。与后端类型的对应关系：
 * - ConnectionResult  ←→  core/types.ts#ConnectionCheckResult
 * - Product           ←→  core/types.ts#Product
 */

/** 连接检测结果（对应后端 ConnectionCheckResult） */
interface ConnectionResult {
  status: 'checking' | 'connected' | 'disconnected' | 'error'
  message: string
  suggestion?: string
  detail?: string
}

/** 商品数据（对应后端 core/types.ts#Product） */
interface Product {
  title: string
  itemId: string
  price: string
  shopName: string
  sales: number
  salesStr: string
  link: string
}

/** 平台 API（由 preload 脚本注入） */
interface PlatformAPI {
  /** 手动检查连接（fallback，心跳会自动推送状态） */
  checkConnection(): Promise<ConnectionResult>

  /**
   * 订阅连接状态变更（主进程心跳推送）
   * 返回取消订阅函数
   */
  onConnectionChange(
    callback: (result: {
      status: 'connected' | 'disconnected' | 'error' | 'checking'
      message: string
      suggestion?: string
    }) => void
  ): () => void

  /** 搜索店铺 */
  searchStores(keyword: string): Promise<any>

  /** 采集店铺全店商品 */
  collectStore(
    storeName: string,
    filterOptions: { minSales?: number; minPrice?: number; maxPrice?: number }
  ): Promise<{
    success: boolean
    data?: {
      store: string
      totalInStore: number
      totalAfterFilter: number
      products: Product[]
    }
    error?: string
    suggestion?: string
  }>

  /** 导出文件 */
  export(
    storeName: string,
    products: any[],
    filterOptions: any,
    format: 'detail' | 'links'
  ): Promise<{ success: boolean; filePath?: string; error?: string }>

  /**
   * 获取淘宝商品详情（含图片下载）
   * @param url - 淘宝商品 URL（如 https://item.taobao.com/item.htm?id=xxx）
   */
  fetchProductDetail(url: string): Promise<{
    success: boolean
    data?: {
      detail: {
        title: string
        itemId: string
        price: string
        shopName: string
        description: string
        headImageUrls: string[]
        descImageUrls: string[]
        skus: Array<{
          attributes: Array<{ key: string; value: string }>
          price: string
          stock?: number
          imageUrl?: string
        }>
        sourceUrl: string
      }
      imagePaths: {
        headImagePaths: string[]
        descImagePaths: string[]
      }
      rawData?: {
        pageContent: string
        elementsData: any
        skuData: any
      }
      steps: Array<{
        name: string
        success: boolean
        duration: number
        detail?: string
      }>
    }
    error?: string
  }>

  /**
   * 淘宝商品 → 微信小店一键上货
   * 完整流程：获取详情 → 转换格式 → 上货到微信小店
   * access_token 从 .env 环境变量自动获取
   *
   * @param url - 淘宝商品 URL
   * @param transformOptions - 数据转换选项
   * @param transformOptions.categoryPath - 微信小店类目路径（如 [[一级类目ID, 名称], [二级类目ID, 名称]]）
   * @param transformOptions.freightTemplateId - 运费模板 ID
   * @param transformOptions.brandId - 品牌 ID（默认 "2100000000" 无品牌）
   * @param transformOptions.defaultStock - 默认库存（默认 100）
   * @param listOptions - 上货选项
   * @param listOptions.autoList - 是否自动提交上架审核（默认 false）
   */
  taobaoToWechat(
    url: string,
    transformOptions: {
      categoryPath: [number, string][]
      freightTemplateId: number
      brandId?: string
      defaultStock?: number
    },
    listOptions?: { autoList?: boolean }
  ): Promise<{
    success: boolean
    data?: {
      productId: string
      images: { headImgUrls: string[]; descImgUrls: string[] }
      autoListed: boolean
      steps: Array<{ name: string; success: boolean; duration: number; detail?: string }>
    }
    error?: string
  }>

  /**
   * 获取微信小店 access_token（从 .env 自动获取）
   */
  getWechatToken(): Promise<{
    success: boolean
    data?: string
    error?: string
  }>

  // ─── 淘宝 WebView 登录管理 ──────────────────────────

  /** 检查淘宝登录状态 */
  checkTaobaoLogin(): Promise<boolean>

  /** 弹出淘宝登录窗口，登录成功返回 true */
  taobaoLogin(): Promise<boolean>

  /** 清除淘宝登录态（登出） */
  taobaoLogout(): Promise<boolean>

  /** 获取淘宝 session 摘要信息（调试用） */
  getTaobaoSessionInfo(): Promise<{ cookieCount: number; hasLoginCookie: boolean }>

  /**
   * 上传已提取的商品数据到微信小店（浏览器标签页专用）
   *
   * @param product - 从 webview 提取的商品数据
   * @param transformOptions - 微信小店转换选项
   * @param listOptions - 上货选项
   */
  uploadExtractedProduct(
    product: any,
    transformOptions: any,
    listOptions?: { autoList?: boolean }
  ): Promise<{
    success: boolean
    data?: {
      productId: string
      images: { headImgUrls: string[]; descImgUrls: string[] }
      autoListed: boolean
      steps: Array<{ name: string; success: boolean; duration: number; detail?: string }>
    }
    error?: string
  }>

  /** 测试类目匹配（映射表优先，标题关键词兜底） */
  testCategoryMatch(title: string, categoryNames?: string[]): Promise<{
    success: boolean
    data?: {
      matched: boolean
      categoryName?: string
      categoryPath?: number[]
      message?: string
    }
    error?: string
  }>

}

interface Window {
  platformAPI: PlatformAPI
}
