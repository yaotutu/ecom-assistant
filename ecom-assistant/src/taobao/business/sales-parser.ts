/**
 * 销量解析 — 纯函数，无副作用
 * 翻译自 Python parse_sales_number() + extract_sales_from_page()
 */

/** 解析单个销量字符串，如 "7万+人付款" → 70000 */
export function parseSalesNumber(salesStr: string): number {
  const m = salesStr.match(/^(\d+)(万?)(\+?)人(?:付款|看过)/)
  if (!m) return 0
  let num = parseInt(m[1], 10)
  if (m[2] === '万') num *= 10000
  return num
}

/** 从页面文本批量提取销量标记 */
export function extractSalesList(
  pageContent: string
): Array<{ sales: number; salesStr: string }> {
  const results: Array<{ sales: number; salesStr: string }> = []
  const pattern = /(\d+万?\+?人(?:付款|看过))/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(pageContent)) !== null) {
    results.push({
      sales: parseSalesNumber(match[1]),
      salesStr: match[1],
    })
  }
  return results
}
