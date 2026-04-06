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
  /** 检查平台连接状态 */
  checkConnection(): Promise<ConnectionResult>
  /** 搜索 TOP 店铺 */
  searchStores(keyword: string, topN?: number): Promise<any>
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
}

interface Window {
  platformAPI: PlatformAPI
}
