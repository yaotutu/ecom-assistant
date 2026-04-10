/**
 * 图片 URL 工具函数
 *
 * 统一处理淘宝图片 URL 的清理和规范化。
 * 合并了原先散落在 image-downloader、product-detail-parser、
 * page-extract-scripts、TaobaoBrowser 中的重复实现。
 */

/**
 * 去除淘宝图片 URL 的尺寸后缀
 *
 * 淘宝 CDN 图片 URL 会带尺寸/质量后缀，如：
 * - `img_400x400.jpg` → `img.jpg`
 * - `img.jpg_q50.jpg_.webp` → `img.jpg`
 * - `img_800x800.jpg` → `img.jpg`
 *
 * @param url - 原始图片 URL
 * @returns 去除尺寸后缀的 URL
 */
export const stripSizeSuffix = (url: string): string => {
  return url
    // `.jpg_q50.jpg_.webp` 这类复合后缀
    .replace(/\.jpg_q\d+\.jpg_\.webp$/i, '.jpg')
    // `.jpg_400x400.jpg` 这类中间尺寸标注
    .replace(/\.jpg_\d+x\d+\.jpg$/i, '.jpg')
    // `_400x400.jpg`、`_800x800.png` 等标准尺寸后缀，保留原始扩展名
    .replace(/_\d+x\d+(\.\w+)?$/i, (match) => {
      const ext = match.match(/\.\w+$/)?.[0]
      return ext ?? ''
    })
    // 残留的 `.webp` 后缀转 `.jpg`（淘宝主图和详情图常见）
    .replace(/\.webp$/i, '.jpg')
}

/**
 * 规范化图片 URL
 *
 * 处理淘宝图片 URL 的常见问题：
 * - 协议省略（`//img.alicdn.com/...`）→ 补全为 `https://`
 * - 空值 → 返回空字符串
 *
 * @param url - 原始图片 URL
 * @returns 规范化后的完整 URL
 */
export const normalizeImageUrl = (url: string): string => {
  if (!url) return ''
  if (url.startsWith('/')) return `https:${url}`
  return url
}
