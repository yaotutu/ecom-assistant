/**
 * 店铺搜索逻辑
 * 翻译自 Python search_top_stores.py
 */
import type { StoreInfo, SearchStoresResult } from '../../core/types'

/** 从 API 数据中提取店铺统计（跳过天猫） */
export function extractStoresFromApi(apiData: any): Map<string, StoreInfo> {
  const r = apiData?.result ?? apiData
  const products: any[] = r?.products ?? []

  const stores = new Map<string, StoreInfo>()

  for (const p of products) {
    const shop: string = p.shopName ?? ''
    const url: string = p.productUrl ?? ''
    if (url.includes('tmall.com') || !shop) continue

    if (!stores.has(shop)) {
      stores.set(shop, {
        name: shop,
        productCount: 0,
        shopUrl: p.shopUrl ?? '',
      })
    }
    stores.get(shop)!.productCount += 1
  }

  return stores
}

/** 按 API 统计的商品数量排序店铺 */
export function rankStores(
  storesMap: Map<string, StoreInfo>,
  topN: number
): StoreInfo[] {
  return [...storesMap.values()]
    .sort((a, b) => b.productCount - a.productCount)
    .slice(0, topN)
}
