/**
 * 淘宝商品 → 微信小店类目 自动匹配
 *
 * 纯函数模块，无副作用，不做网络请求。
 *
 * 匹配策略：
 * 淘宝新版商品页面没有面包屑导航，无法直接获取类目。
 * 改为从商品标题中提取关键词，在微信类目树中查找最匹配的叶子类目。
 *
 * 匹配流程：
 * 1. 将商品标题拆分为 2-4 字的关键词片段
 * 2. 在微信叶子类目名称和完整路径中搜索这些关键词
 * 3. 按匹配度打分，返回得分最高的类目
 *
 * 使用方式：
 *   import { matchCategoryByTitle } from './category-matcher'
 *   const result = matchCategoryByTitle('钟表螺丝刀手机维修套装', wechatCategories)
 *   // → { categoryPath: [...], categoryName: '工具 > 螺丝刀' }
 */

import type { CategoryItem } from '../../wechat-store/types'

// ============================================================
// 类型
// ============================================================

/** 类目匹配结果 */
export interface CategoryMatchResult {
  /** 微信类目路径（root→leaf 顺序的 cat_id 数组） */
  categoryPath: number[]
  /** 匹配到的微信类目完整名称链（如 "工具 > 手动工具 > 螺丝刀"） */
  categoryName: string
}

/** 带分数的匹配候选 */
interface Candidate {
  result: CategoryMatchResult
  score: number
}

// ============================================================
// 工具函数
// ============================================================

/** 从微信 CategoryItem 中提取 root→leaf 顺序的类目信息 */
const extractCategoryChain = (
  item: CategoryItem
): { ids: number[]; names: string[]; leafName: string } => {
  const chain = item.cat_and_qua
  const ids = chain.map(c => Number(c.cat.cat_id)).reverse()
  const names = chain.map(c => c.cat.name).reverse()
  const leafName = chain[0]?.cat.name ?? ''
  return { ids, names, leafName }
}

/**
 * 将中文标题拆分为关键词片段
 *
 * "钟表螺丝刀手机维修套装" → ["钟表", "螺丝", "螺丝刀", "手机", "维修", "套装", ...]
 * 生成 2 字、3 字、4 字的滑动窗口片段
 */
const extractTitleKeywords = (title: string): string[] => {
  const keywords: string[] = []
  // 去掉常见无意义词
  const cleaned = title.replace(/[的了吗呢把被在从和与及或专业级入门级]/g, '')

  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= cleaned.length - len; i++) {
      const word = cleaned.substring(i, i + len)
      // 过滤纯数字和纯符号
      if (/^[\d\s\-_+/\\()*&^%$#@!~`<>{}[\]|\\:;'",.]+$/.test(word)) continue
      keywords.push(word)
    }
  }
  return keywords
}

/**
 * 计算标题关键词在类目链中的匹配得分
 */
const calcScore = (
  titleKeywords: string[],
  leafName: string,
  allNames: string[]
): number => {
  let score = 0
  const fullPath = allNames.join('')

  for (const keyword of titleKeywords) {
    // 叶子类目名称包含关键词（最高权重，越长的关键词权重越高）
    if (leafName.includes(keyword)) {
      score += keyword.length * 15
    }
    // 完整路径中包含关键词
    if (fullPath.includes(keyword)) {
      score += keyword.length * 5
    }
  }

  // 标题包含叶子类目名称（反向包含，加分）
  if (leafName.length >= 2) {
    // 检查标题关键词中是否包含叶子名称的子串
    for (const kw of titleKeywords) {
      if (kw === leafName) {
        score += 200
        break
      }
    }
  }

  return score
}

// ============================================================
// 核心匹配
// ============================================================

/**
 * 从商品标题匹配微信小店类目
 *
 * @param title - 淘宝商品标题（如 "保联钟表螺丝刀手机维修套装"）
 * @param wechatCategories - 微信小店类目列表（getAllCategories 返回值）
 * @returns 匹配结果，包含 categoryPath 和 categoryName；匹配不到返回 null
 */
export const matchCategoryByTitle = (
  title: string,
  wechatCategories: CategoryItem[]
): CategoryMatchResult | null => {
  if (!title || wechatCategories.length === 0) return null

  const titleKeywords = extractTitleKeywords(title)

  let best: Candidate | null = null

  for (const item of wechatCategories) {
    const leafNode = item.cat_and_qua[0]
    if (!leafNode?.cat.leaf) continue

    const { ids, names, leafName } = extractCategoryChain(item)
    const score = calcScore(titleKeywords, leafName, names)

    if (score > 0 && (!best || score > best.score)) {
      best = {
        result: { categoryPath: ids, categoryName: names.join(' > ') },
        score,
      }
    }
  }

  return best?.result ?? null
}
