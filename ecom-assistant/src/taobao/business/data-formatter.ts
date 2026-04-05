/**
 * 数据格式化输出
 */
import type { Product, FilterOptions } from '../../core/types'

/** 格式化详情文本（人读） */
export function formatDetailText(
  storeName: string,
  products: Product[],
  filterOptions?: FilterOptions
): string {
  const conditions: string[] = []
  if (filterOptions?.minSales != null) conditions.push(`销量>${filterOptions.minSales}`)
  if (filterOptions?.minPrice != null) conditions.push(`价格>=￥${filterOptions.minPrice}`)
  if (filterOptions?.maxPrice != null) conditions.push(`价格<=￥${filterOptions.maxPrice}`)

  const lines: string[] = [
    '='.repeat(60),
    conditions.length > 0
      ? `${storeName} — ${conditions.join(' ')}`
      : storeName,
    `共 ${products.length} 个商品（全店采集）`,
    '='.repeat(60),
    '',
  ]

  products.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.title}`)
    lines.push(`   价格: ￥${p.price}  销量: ${p.salesStr} (${p.sales}人)`)
    lines.push(`   链接: ${p.link}`)
    lines.push('')
  })

  return lines.join('\n')
}

/** 格式化纯链接文本（程序读） */
export function formatLinksText(products: Product[]): string {
  return products.map((p) => p.link).filter(Boolean).join('\n') + '\n'
}
