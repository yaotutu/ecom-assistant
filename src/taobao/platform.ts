/**
 * 淘宝平台 — IPlatform 实现
 * 组合 connection 层 + business 层
 */
import { NativeCli } from './connection/native-cli'
import { extractStoresFromApi } from './business/store-search'
import { extractSalesList } from './business/sales-parser'
import { buildCollectResult } from './business/product-collector'
import type {
  IPlatform,
  ConnectionCheckResult,
  SearchStoresResult,
  CollectStoreResult,
  FilterOptions,
} from '../core/types'

export class TaobaoPlatform implements IPlatform {
  readonly name = '淘宝'
  readonly id = 'taobao'
  private cli: NativeCli

  constructor() {
    this.cli = new NativeCli()
  }

  /** 暴露底层 CLI 实例（供 ipc-handlers 注册心跳监听器） */
  get nativeCli(): NativeCli {
    return this.cli
  }

  // ─── 连接管理（最核心） ───────────────────────────

  async checkConnection(): Promise<ConnectionCheckResult> {
    const ping = await this.cli.ping()

    if (ping.ok) {
      return { status: 'connected', message: ping.message }
    }

    // 所有失败情况统一返回 disconnected
    return {
      status: 'disconnected',
      message: ping.message,
      suggestion: ping.suggestion,
    }
  }

  // ─── 搜索店铺 ──────────────────────────────────

  async searchStores(keyword: string): Promise<SearchStoresResult> {
    // 使用 shop 类型搜索店铺（CLI 支持的搜索类型：all/shop/tmall/pc_taobao 等）
    const { apiData } = await this.cli.searchAndWait(keyword, 'shop')
    const stores = extractStoresFromApi(apiData)

    return { keyword, stores }
  }

  // ─── 采集全店商品 ──────────────────────────────

  async collectStore(
    storeName: string,
    filterOptions?: FilterOptions
  ): Promise<CollectStoreResult> {
    const { apiData, pageContent } = await this.cli.searchAndWait(storeName, 'pc_taobao')

    const r = apiData?.result ?? apiData
    const apiProducts: any[] = r?.products ?? []

    const salesList = extractSalesList(pageContent)

    return buildCollectResult(storeName, apiProducts, salesList, filterOptions)
  }
}
