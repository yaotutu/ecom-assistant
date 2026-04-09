/// <reference types="vite/client" />

/** 连接检测结果 */
interface ConnectionResult {
  status: 'checking' | 'connected' | 'disconnected' | 'error'
  message: string
  suggestion?: string
  detail?: string
}

/** 商品数据 */
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
}

interface Window {
  platformAPI: PlatformAPI
}
