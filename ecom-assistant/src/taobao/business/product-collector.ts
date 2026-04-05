/**
 * 全店商品采集 + 过滤
 * 翻译自 Python collect_store.py
 */
import { extractSalesList } from './sales-parser'
import type { Product, CollectStoreResult, FilterOptions } from '../../core/types'

/** API 商品 + 页面销量 → 按位置一一对应合并 */
export function mergeProductsWithSales(
  apiProducts: any[],
  salesList: Array<{ sales: number; salesStr: string }>
): Product[] {
  const count = Math.min(apiProducts.length, salesList.length)
  const merged: Product[] = []
  for (let i = 0; i < count; i++) {
    const ap = apiProducts[i]
    const sl = salesList[i]
    merged.push({
      title: ap.title ?? '',
      itemId: ap.itemId ?? '',
      price: String(ap.price ?? ''),
      shopName: ap.shopName ?? '',
      sales: sl.sales,
      salesStr: sl.salesStr,
      link: `https://item.taobao.com/item.htm?id=${ap.itemId ?? ''}`,
    })
  }
  return merged
}

/** 按店铺名精确过滤 */
export function filterByStore(products: Product[], storeName: string): Product[] {
  return products.filter((p) => p.shopName === storeName)
}

/** 按销量/价格过滤并按销量降序 */
export function applyFilters(
  products: Product[],
  opts?: FilterOptions
): Product[] {
  if (!opts) return products.sort((a, b) => b.sales - a.sales)
  return products
    .filter((p) => opts.minSales == null || p.sales > opts.minSales)
    .filter((p) => opts.minPrice == null || parseFloat(p.price) >= opts.minPrice)
    .filter((p) => opts.maxPrice == null || parseFloat(p.price) <= opts.maxPrice)
    .sort((a, b) => b.sales - a.sales)
}

/** 从原始搜索结果构建完整采集结果 */
export function buildCollectResult(
  storeName: string,
  apiProducts: any[],
  salesList: Array<{ sales: number; salesStr: string }>,
  filterOpts?: FilterOptions
): CollectStoreResult {
  const merged = mergeProductsWithSales(apiProducts, salesList)
  const storeProducts = filterByStore(merged, storeName)
  const filtered = applyFilters(storeProducts, filterOpts)
  return {
    store: storeName,
    totalInStore: storeProducts.length,
    totalAfterFilter: filtered.length,
    products: filtered,
  }
}
