/**
 * 平台无关的通用类型定义
 * 只有接口和类型，没有任何实现
 */

/** 连接状态 */
export type ConnectionStatus =
  | 'checking'
  | 'connected'
  | 'disconnected'
  | 'error'

/** 连接检查结果 */
export interface ConnectionCheckResult {
  status: ConnectionStatus
  message: string
  suggestion?: string
  detail?: string
}

/** 商品 */
export interface Product {
  title: string
  itemId: string
  price: string
  shopName: string
  sales: number
  salesStr: string
  link: string
}

/** 店铺信息 */
export interface StoreInfo {
  name: string
  shopUrl: string
}

/** 过滤条件 */
export interface FilterOptions {
  minSales?: number
  minPrice?: number
  maxPrice?: number
}

/** 搜索店铺结果 */
export interface SearchStoresResult {
  keyword: string
  stores: StoreInfo[]
}

/** 采集全店商品结果 */
export interface CollectStoreResult {
  store: string
  totalInStore: number
  totalAfterFilter: number
  products: Product[]
}

/**
 * 平台接口 — 所有电商平台必须实现
 *
 * 连接管理是核心中的核心：
 * 连不上 native 客户端，一切业务都无从谈起。
 */
export interface IPlatform {
  /** 平台名称（如：淘宝、京东） */
  readonly name: string
  /** 平台标识（如：taobao、jd） */
  readonly id: string

  /** 连接健康检查 — 最重要 */
  checkConnection(): Promise<ConnectionCheckResult>

  /** 搜索关键词，返回搜索结果中出现的店铺 */
  searchStores(keyword: string): Promise<SearchStoresResult>

  /** 采集指定店铺的全店商品 */
  collectStore(storeName: string, filterOptions?: FilterOptions): Promise<CollectStoreResult>
}
