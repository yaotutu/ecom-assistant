/**
 * 淘宝平台 — IPlatform 实现
 * 组合 connection 层 + business 层
 */
import { NativeCli } from './connection/native-cli'
import { extractStoresFromApi, rankStores } from './business/store-search'
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

  // ─── 连接管理（最核心） ───────────────────────────

  async checkConnection(): Promise<ConnectionCheckResult> {
    const ping = await this.cli.ping()

    if (ping.ok) {
      return { status: 'connected', message: ping.message }
    }

    const msg = ping.message || ''

    if (msg.includes('未安装') || msg.includes('CLI 不可用')) {
      return {
        status: 'disconnected',
        message: '淘宝桌面版未安装',
        suggestion: ping.suggestion,
      }
    }

    if (msg.includes('恢复中') || msg.includes('重新启动')) {
      return {
        status: 'disconnected',
        message: '正在自动重启淘宝桌面版...',
        suggestion: ping.suggestion,
      }
    }

    if (msg.includes('未启动') || msg.includes('未就绪') || msg.includes('加载')) {
      return {
        status: 'disconnected',
        message: '淘宝桌面版未启动或正在加载',
        suggestion: ping.suggestion,
      }
    }

    return {
      status: 'error',
      message: msg,
      suggestion: ping.suggestion,
    }
  }

  // ─── 搜索 TOP 店铺 ──────────────────────────────

  async searchStores(
    keyword: string,
    options?: { top?: number }
  ): Promise<SearchStoresResult> {
    const topN = options?.top ?? 3
    const { apiData } = await this.cli.searchAndWait(keyword, 'pc_taobao')

    const storesMap = extractStoresFromApi(apiData)
    const ranked = rankStores(storesMap, topN)

    return {
      keyword,
      totalStoresFound: storesMap.size,
      stores: ranked,
    }
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
