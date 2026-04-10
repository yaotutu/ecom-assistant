/**
 * 淘宝商品 → 微信小店类目 匹配模块
 *
 * 三层匹配策略（优先级从高到低）：
 * 1. 静态映射表 + LLM 精准匹配：面包屑查映射表 → 缩小到二级域 → LLM 选叶子
 * 2. LLM 广泛匹配（无映射时）：先选二级类目 → 再选叶子
 * 3. 关键词滑动窗口（最终兜底）：LLM 失败时的本地匹配
 *
 * 映射表文件：taobao-wechat-category-map.json（一次性 LLM 构建，可人工校正）
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CategoryItem } from '../../wechat-store/types'
import { llmMatchLeafInDomain, llmMatchBroadToNarrow } from './llm-category-matcher'
import type { LeafCandidate } from './llm-category-matcher'

// ============================================================
// 类型
// ============================================================

/** 类目匹配结果 */
export interface CategoryMatchResult {
  /** 微信类目路径（root→leaf 顺序的 cat_id 数组） */
  categoryPath: number[]
  /** 匹配到的微信类目完整名称链（如 "家装建材 > 五金工具 > 手动工具"） */
  categoryName: string
}

/** 映射表文件格式 */
interface CategoryMapFile {
  mappings: Record<string, string[]>
}

// ============================================================
// 工具函数
// ============================================================

/** 清理类目名称（去掉零宽字符、尾部符号等） */
const cleanName = (name: string): string =>
  name
    .replace(/[\u200b\u200c\u200d\ufeff\u00ad]/g, '')
    .replace(/[]/g, '')
    .trim()

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
 * 从标题中提取关键词片段（2~4 字滑动窗口）
 */
const extractTitleKeywords = (title: string): string[] => {
  const keywords: string[] = []
  const cleaned = title.replace(/[的了吗呢把被在从和与及或专业级入门级]/g, '')
  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= cleaned.length - len; i++) {
      const word = cleaned.substring(i, i + len)
      if (/^[\d\s\-_+/\\()*&^%$#@!~`<>{}[\]|\\:;'",.]+$/.test(word)) continue
      keywords.push(word)
    }
  }
  return keywords
}

/**
 * 提取指定微信二级域下的叶子类目候选列表
 *
 * @param level1 - 微信一级类目名
 * @param level2 - 微信二级类目名
 * @param allCategories - 微信所有叶子类目
 */
const extractLeafCandidates = (
  level1: string,
  level2: string,
  allCategories: CategoryItem[]
): LeafCandidate[] => {
  const candidates: LeafCandidate[] = []
  for (const item of allCategories) {
    const leafNode = item.cat_and_qua[0]
    if (!leafNode?.cat.leaf) continue

    const { names } = extractCategoryChain(item)
    if (names[0] !== level1) continue
    if (names.length < 2 || names[1] !== level2) continue

    candidates.push({
      catId: Number(leafNode.cat.cat_id),
      pathNames: names,
    })
  }
  return candidates
}

// ============================================================
// 静态映射表加载
// ============================================================

/** 缓存的映射表 */
let cachedMap: Record<string, string[]> | null = null

/**
 * 加载静态映射表（带缓存）
 *
 * 映射表格式：{ "淘宝类目名": ["微信一级", "微信二级"] }
 */
const loadStaticMap = (): Record<string, string[]> => {
  if (cachedMap) return cachedMap

  try {
    // 映射表文件在同目录下
    const mapPath = join(__dirname, 'taobao-wechat-category-map.json')
    const raw = readFileSync(mapPath, 'utf-8')
    const data = JSON.parse(raw) as CategoryMapFile
    cachedMap = data.mappings || {}
    return cachedMap
  } catch {
    console.warn('[类目映射] 静态映射表加载失败，将使用全局标题匹配')
    cachedMap = {}
    return cachedMap
  }
}

// ============================================================
// 关键词匹配（本地兜底）
// ============================================================

/**
 * 在指定的微信二级域下，用标题关键词匹配叶子类目
 */
const matchLeafInDomain = (
  titleKeywords: string[],
  level1: string,
  level2: string,
  allCategories: CategoryItem[]
): CategoryMatchResult | null => {
  let bestResult: CategoryMatchResult | null = null
  let bestScore = 0

  for (const item of allCategories) {
    const leafNode = item.cat_and_qua[0]
    if (!leafNode?.cat.leaf) continue

    const { ids, names, leafName } = extractCategoryChain(item)
    if (names[0] !== level1) continue
    if (names.length < 2 || names[1] !== level2) continue

    const fullPath = names.join('')
    let score = 0
    const seen = new Set<string>()

    for (const kw of titleKeywords) {
      if (seen.has(kw)) continue
      seen.add(kw)
      const len = kw.length
      const inLeaf = leafName.includes(kw)
      const inPath = fullPath.includes(kw)
      if (inLeaf) score += len * len * 15
      else if (inPath) score += len * len * 5
      if (inLeaf && inPath) {
        const matchLevels = names.filter(n => n.includes(kw)).length
        if (matchLevels >= 2) score += len * len * 10
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestResult = { categoryPath: ids, categoryName: names.join(' > ') }
    }
  }

  return bestResult
}

/**
 * 全局标题关键词匹配（最终兜底）
 */
const matchByTitleGlobal = (
  title: string,
  allCategories: CategoryItem[]
): CategoryMatchResult | null => {
  const titleKeywords = extractTitleKeywords(title)
  let bestResult: CategoryMatchResult | null = null
  let bestScore = 0

  for (const item of allCategories) {
    const leafNode = item.cat_and_qua[0]
    if (!leafNode?.cat.leaf) continue

    const { ids, names, leafName } = extractCategoryChain(item)
    const fullPath = names.join('')
    let score = 0
    const seen = new Set<string>()

    for (const kw of titleKeywords) {
      if (seen.has(kw)) continue
      seen.add(kw)
      const len = kw.length
      const inLeaf = leafName.includes(kw)
      const inPath = fullPath.includes(kw)
      if (inLeaf) score += len * len * 15
      else if (inPath) score += len * len * 5
      if (inLeaf && inPath) {
        const matchLevels = names.filter(n => n.includes(kw)).length
        if (matchLevels >= 2) score += len * len * 10
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestResult = { categoryPath: ids, categoryName: names.join(' > ') }
    }
  }

  return bestResult
}

// ============================================================
// 导出的匹配函数
// ============================================================

/**
 * 综合匹配（映射表 → LLM → 关键词兜底）
 *
 * 匹配流程：
 *   1. 面包屑查映射表 → 缩小到微信二级域 → LLM 在域内选叶子
 *   2. 无映射 → LLM 两阶段匹配（先选二级再选叶子）
 *   3. LLM 失败 → 关键词滑动窗口全局匹配
 *
 * @param title - 商品标题
 * @param taobaoCategoryNames - 淘宝面包屑类目名数组（如 ["家居日用", "收纳整理", "钥匙扣"]）
 * @param wechatCategories - 微信小店所有类目
 * @returns 匹配结果；无匹配返回 null
 */
export const matchCategory = async (
  title: string,
  taobaoCategoryNames: string[],
  wechatCategories: CategoryItem[]
): Promise<CategoryMatchResult | null> => {
  const staticMap = loadStaticMap()

  // ── 策略 1：映射表 + LLM ──
  for (let i = (taobaoCategoryNames?.length || 0) - 1; i >= 0; i--) {
    const name = cleanName(taobaoCategoryNames[i])
    const wechatPath = staticMap[name]
    if (!wechatPath) continue

    const [level1, level2] = wechatPath
    const candidates = extractLeafCandidates(level1, level2, wechatCategories)

    // 1a: LLM 在域内精准匹配
    if (candidates.length > 0) {
      const llmResult = await llmMatchLeafInDomain(title, taobaoCategoryNames, candidates)
      if (llmResult) {
        // 从 catId 查找完整 categoryPath
        const fullItem = wechatCategories.find(item =>
          Number(item.cat_and_qua[0]?.cat.cat_id) === llmResult.catId
        )
        if (fullItem) {
          const { ids, names } = extractCategoryChain(fullItem)
          console.log(`[类目匹配] LLM命中(有映射): "${name}" → ${names.join(' > ')}`)
          return { categoryPath: ids, categoryName: names.join(' > ') }
        }
      }
    }

    // 1b: LLM 失败，回退到关键词匹配
    const titleKeywords = extractTitleKeywords(title)
    const result = matchLeafInDomain(titleKeywords, level1, level2, wechatCategories)
    if (result) {
      console.log(`[类目匹配] 关键词命中(有映射): "${name}" → ${result.categoryName}`)
      return result
    }

    // 1c: 域内无匹配，取第一个叶子兜底
    const firstLeaf = wechatCategories.find(item => {
      const names = item.cat_and_qua.map(c => c.cat.name).reverse()
      return names[0] === level1 && names.length >= 2 && names[1] === level2 && item.cat_and_qua[0]?.cat.leaf
    })
    if (firstLeaf) {
      const { ids, names } = extractCategoryChain(firstLeaf)
      console.log(`[类目匹配] 取域内首个叶子: "${name}" → ${names.join(' > ')}`)
      return { categoryPath: ids, categoryName: names.join(' > ') }
    }
  }

  // ── 策略 2：无映射，LLM 两阶段匹配 ──
  const allLeafCandidates: LeafCandidate[] = wechatCategories
    .filter(item => item.cat_and_qua[0]?.cat.leaf)
    .map(item => {
      const { names } = extractCategoryChain(item)
      return {
        catId: Number(item.cat_and_qua[0].cat.cat_id),
        pathNames: names,
      }
    })

  const llmResult = await llmMatchBroadToNarrow(title, taobaoCategoryNames, allLeafCandidates)
  if (llmResult) {
    const fullItem = wechatCategories.find(item =>
      Number(item.cat_and_qua[0]?.cat.cat_id) === llmResult.catId
    )
    if (fullItem) {
      const { ids, names } = extractCategoryChain(fullItem)
      console.log(`[类目匹配] LLM命中(无映射): ${names.join(' > ')}`)
      return { categoryPath: ids, categoryName: names.join(' > ') }
    }
  }

  // ── 策略 3：全局标题关键词匹配（最终兜底） ──
  console.log('[类目匹配] LLM失败，使用全局标题匹配')
  return matchByTitleGlobal(title, wechatCategories)
}

/**
 * 兼容旧接口：从标题匹配微信小店类目
 */
export const matchCategoryByTitle = (
  title: string,
  wechatCategories: CategoryItem[]
): Promise<CategoryMatchResult | null> => {
  return matchCategory(title, [], wechatCategories)
}
