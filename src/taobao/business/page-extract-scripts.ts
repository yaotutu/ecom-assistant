/**
 * 页面数据提取脚本 — 注入到淘宝详情页中提取结构化商品数据
 *
 * 职责：
 * 1. 从淘宝页面的 JS 全局变量中提取完整商品数据
 * 2. 回退到 DOM 查询提取
 * 3. 滚动触发懒加载后提取详情图
 *
 * 设计原则：
 * - 所有导出函数返回的是**字符串**（executeJavaScript 的返回值必须是 JSON 可序列化的）
 * - 提取函数内部使用 try-catch 确保单个字段失败不影响整体
 * - 不依赖任何外部模块，这些代码要在浏览器环境中执行
 */

import type { TaobaoProductDetail, TaobaoProductSku } from '../types'
import { stripSizeSuffix, normalizeImageUrl } from './image-utils'

// ============================================================
// 注入脚本：提取商品核心数据
// ============================================================

/**
 * 提取商品核心数据的 JS 脚本
 *
 * 此函数的返回值会被序列化为字符串，通过 webContents.executeJavaScript() 注入执行。
 * 在浏览器环境中运行，可以访问 DOM 和 window 全局变量。
 *
 * 提取策略优先级：
 * 1. window.runParams（PC 端淘宝常见的数据源）
 * 2. window.g_config / window.itemDo（旧版淘宝）
 * 3. window.__INITIAL_DATA__ / window.$data（H5 版本）
 * 4. DOM 回退查询
 *
 * @returns JSON 字符串，包含提取的商品数据
 */
export const EXTRACT_PRODUCT_DATA = `
(() => {
  const result = {
    title: '',
    itemId: '',
    price: '',
    shopName: '',
    description: '',
    headImageUrls: [],
    descImageUrls: [],
    skus: [],
    sourceUrl: window.location.href,
    extractSource: '',  // 标记数据来源
  };

  // ─── 策略 1：从 window.runParams 提取 ────────────
  try {
    const rp = window.runParams;
    if (rp && rp.data) {
      const d = rp.data;
      result.title = d.title || '';
      result.price = d.price || d.reservePrice || '';
      result.itemId = d.itemId || d.id || '';
      result.extractSource = 'runParams';

      // 主图
      if (Array.isArray(d.images)) {
        result.headImageUrls = d.images.map(img => {
          if (typeof img === 'string') return img.startsWith('//') ? 'https:' + img : img;
          return img;
        });
      }

      // SKU
      if (d.skuBase && d.skuList) {
        const skuBase = d.skuBase;
        const propPathMap = {};
        // 构建 属性路径 → 属性值 的映射
        if (Array.isArray(skuBase.props)) {
          for (const prop of skuBase.props) {
            if (Array.isArray(prop.values)) {
              for (const val of prop.values) {
                propPathMap[prop.propPath + ':' + val.vid] = {
                  key: prop.name || prop.propPath,
                  value: val.name || val.vid,
                  imageUrl: val.imageUrl ? (val.imageUrl.startsWith('//') ? 'https:' + val.imageUrl : val.imageUrl) : undefined,
                };
              }
            }
          }
        }

        for (const sku of d.skuList) {
          if (!sku || sku.status === -1) continue;
          const attrs = [];
          if (sku.propPath) {
            const parts = sku.propPath.split(';');
            for (const part of parts) {
              const mapped = propPathMap[part];
              if (mapped) {
                attrs.push({ key: mapped.key, value: mapped.value });
              }
            }
          }
          result.skus.push({
            attributes: attrs,
            price: sku.price || '',
            stock: sku.quantity || undefined,
            imageUrl: sku.imageUrl || undefined,
          });
        }
      }

      // 描述文本
      result.description = d.desc || d.title || '';

      // 详情图 — 从 desc URL 中提取
      if (d.descUrl) {
        result._descUrl = d.descUrl;
      }

      // 如果已经拿到完整数据，直接返回
      if (result.title) return JSON.stringify(result);
    }
  } catch (e) { /* runParams 提取失败，继续下一个策略 */ }

  // ─── 策略 2：从 window.g_config 提取 ────────────
  try {
    const gc = window.g_config;
    if (gc) {
      constidata = gc.idata || gc.item || {};
      if (idata && !result.title) {
        result.title = idata.title || '';
        result.price = idata.price || idata.reservePrice || '';
        result.itemId = idata.itemId || idata.id || '';
        result.extractSource = 'g_config';

        if (Array.isArray(idata.images)) {
          result.headImageUrls = idata.images.map(img =>
            typeof img === 'string' && img.startsWith('//') ? 'https:' + img : img
          );
        }

        result.description = idata.desc || idata.title || '';

        if (result.title) return JSON.stringify(result);
      }
    }
  } catch (e) { /* g_config 提取失败 */ }

  // ─── 策略 3：从 H5 版本数据提取 ────────────
  try {
    const init = window.__INITIAL_DATA__ || window.__NEXT_DATA__;
    if (init) {
      const data = init.props?.pageProps?.data || init.data || init;
      if (data && !result.title) {
        result.title = data.title || data.itemInfo?.title || '';
        result.price = data.price || data.itemInfo?.price || '';
        result.itemId = data.itemId || data.itemInfo?.itemId || '';
        result.extractSource = 'initial_data';

        const imgs = data.images || data.itemInfo?.images || [];
        result.headImageUrls = imgs.map(img =>
          typeof img === 'string' && img.startsWith('//') ? 'https:' + img : img
        );

        if (result.title) return JSON.stringify(result);
      }
    }
  } catch (e) { /* H5 data 提取失败 */ }

  // ─── 策略 4：DOM 回退查询 ──────────────────────
  result.extractSource = 'dom_fallback';

  // 标题
  if (!result.title) {
    const titleEl = document.querySelector('[class*="ItemHeader"] [class*="title"]')
      || document.querySelector('.tb-main-title')
      || document.querySelector('[data-spm="1000983"] .title')
      || document.querySelector('h1')
      || document.querySelector('[class*="ItemTitle"]');
    if (titleEl) result.title = titleEl.textContent?.trim() || '';
  }

  // 价格
  if (!result.price) {
    const priceEl = document.querySelector('[class*="Price"] [class*="priceText"]')
      || document.querySelector('.tb-rmb-num')
      || document.querySelector('[class*="Price--priceText"]')
      || document.querySelector('[data-spm="1000983"] .price');
    if (priceEl) result.price = priceEl.textContent?.trim().replace(/[¥￥,，\\s]/g, '') || '';
  }

  // 商品 ID（从 URL）
  if (!result.itemId) {
    const match = window.location.href.match(/[?&]id=(\\d+)/);
    if (match) result.itemId = match[1];
  }

  // 店铺名
  if (!result.shopName) {
    const shopEl = document.querySelector('[class*="ShopName"] [class*="name"]')
      || document.querySelector('.tb-seller-shop-name a')
      || document.querySelector('[class*="shopName"] a')
      || document.querySelector('[data-spm="1000983"] .shopName a');
    if (shopEl) result.shopName = shopEl.textContent?.trim() || '';
  }

  // 主图 — 从主图区域的 img 标签提取
  if (result.headImageUrls.length === 0) {
    const mainImages = document.querySelectorAll(
      '[class*="MainPic"] img, [class*="PicGallery"] img, .tb-pic img, [class*="mainPic"] img'
    );
    const seen = new Set();
    mainImages.forEach((img) => {
      let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (src.startsWith('//')) src = 'https:' + src;
      // 过滤掉缩略图和占位图
      if (src && !src.includes('spacer') && !src.includes('blank') && !seen.has(src)) {
        seen.add(src);
        result.headImageUrls.push(src);
      }
    });
  }

  return JSON.stringify(result);
})()
`

// ============================================================
// 注入脚本：模拟滚动 + 提取详情图
// ============================================================

/**
 * 滚动到页面底部并提取详情图 URL 的 JS 脚本
 *
 * 分段滚动触发懒加载，每次滚动后等待图片加载，
 * 最终从详情区域提取所有图片 URL。
 *
 * @param steps - 滚动步骤数组 [{ scrollY, delayMs }]
 * @returns JSON 字符串，包含 { descImageUrls: string[] }
 */
export const createScrollAndExtractScript = (steps: Array<{ scrollY: number; delayMs: number }>): string => {
  return `
(async () => {
  const steps = ${JSON.stringify(steps)};

  // 分段滚动
  for (const step of steps) {
    window.scrollTo(0, step.scrollY);
    await new Promise(r => setTimeout(r, step.delayMs));
  }

  // 额外等待最后一批图片加载
  await new Promise(r => setTimeout(r, 2000));

  // 提取详情图
  const descImageUrls = [];

  // 策略 1：从详情区域（通常是 ke-post 或 desc 区域）提取
  const descContainer = document.querySelector('.ke-post')
    || document.querySelector('#description')
    || document.querySelector('[class*="DescDetail"]')
    || document.querySelector('[class*="detail"]')
    || document.querySelector('#J_DivItemDesc');

  if (descContainer) {
    const images = descContainer.querySelectorAll('img');
    const seen = new Set();
    images.forEach((img) => {
      let src = img.getAttribute('src')
        || img.getAttribute('data-src')
        || img.getAttribute('data-ks-lazyload')
        || '';
      if (src.startsWith('//')) src = 'https:' + src;
      // 过滤非淘宝 CDN 图片和已存在的 URL
      if (src && (src.includes('alicdn.com') || src.includes('taobaocdn.com')) && !seen.has(src)) {
        seen.add(src);
        descImageUrls.push(src);
      }
    });
  }

  // 策略 2：如果上面没找到，尝试从所有带 data-src 的图片中过滤详情图
  if (descImageUrls.length === 0) {
    const allLazyImages = document.querySelectorAll('img[data-src]');
    const seen = new Set();
    allLazyImages.forEach((img) => {
      let src = img.getAttribute('data-src') || '';
      if (src.startsWith('//')) src = 'https:' + src;
      // 详情图通常在 imgextra 或 tbcdn 域名下，且尺寸较大
      if (src && (src.includes('imgextra') || src.includes('tbcdn'))
        && !seen.has(src) && !descImageUrls.includes(src)) {
        seen.add(src);
        descImageUrls.push(src);
      }
    });
  }

  return JSON.stringify({ descImageUrls });
})()
`
}

// ============================================================
// 注入脚本：提取页面高度（用于规划滚动步骤）
// ============================================================

/** 获取页面总高度的脚本 */
export const GET_PAGE_HEIGHT = `
document.body.scrollHeight || document.documentElement.scrollHeight
`

// ============================================================
// 结果解析
// ============================================================

/**
 * 解析注入脚本返回的 JSON 字符串为 TaobaoProductDetail
 *
 * @param jsonStr - executeJavaScript 返回的 JSON 字符串
 * @param url - 原始商品 URL
 * @returns 结构化的淘宝商品详情
 */
export const parseExtractedData = (
  jsonStr: string,
  url: string
): TaobaoProductDetail => {
  const data = JSON.parse(jsonStr) as {
    title: string
    itemId: string
    price: string
    shopName: string
    description: string
    headImageUrls: string[]
    descImageUrls: string[]
    skus: TaobaoProductSku[]
    sourceUrl: string
    extractSource: string
    _descUrl?: string
  }

  return {
    title: data.title || '',
    itemId: data.itemId || '',
    price: data.price || '',
    shopName: data.shopName || '',
    description: data.description || '',
    headImageUrls: data.headImageUrls.map(stripSizeSuffix),
    descImageUrls: data.descImageUrls.map(stripSizeSuffix),
    skus: data.skus,
    sourceUrl: url,
  }
}

/**
 * 解析滚动提取脚本返回的详情图 URL 列表
 */
export const parseDescImages = (jsonStr: string): string[] => {
  const data = JSON.parse(jsonStr) as { descImageUrls: string[] }
  return (data.descImageUrls || []).map((u) => stripSizeSuffix(normalizeImageUrl(u)))
}
