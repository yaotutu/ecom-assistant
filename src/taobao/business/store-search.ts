/**
 * 店铺搜索逻辑 — 从搜索结果中提取去重后的店铺列表
 */
import type { StoreInfo, SearchStoresResult } from '../../core/types'

/**
 * 从 API 搜索结果中提取去重店铺（保持首次出现顺序）
 * 跳过天猫店铺
 */
export function extractStoresFromApi(apiData: any): StoreInfo[] {
  const r = apiData?.result ?? apiData
  const products: any[] = r?.products ?? []

  const seen = new Set<string>()
  const stores: StoreInfo[] = []

  for (const p of products) {
    const shop: string = p.shopName ?? ''
    const url: string = p.productUrl ?? ''
    if (url.includes('tmall.com') || !shop || seen.has(shop)) continue

    seen.add(shop)
    stores.push({
      name: shop,
      shopUrl: p.shopUrl ?? '',
    })
  }

  return stores
}
