/**
 * LLM 类目匹配 — 通过 SiliconFlow DeepSeek-V3.2 做精准类目匹配
 *
 * 职责：
 * - 封装 SiliconFlow API 调用（OpenAI 兼容格式，原生 fetch）
 * - 提供两种匹配策略：
 *   A. llmMatchLeafInDomain — 已知二级域，从 ~50 个叶子中选最佳
 *   B. llmMatchBroadToNarrow — 无映射时，先选二级再选叶子
 *
 * 环境变量：SILICONFLOW_API_KEY（未配置时所有函数静默返回 null）
 */

// ============================================================
// 类型
// ============================================================

/** LLM 匹配结果 */
interface LLMCategoryResult {
  /** 匹配到的叶子类目 ID */
  catId: number
  /** 匹配到的类目完整名称链 */
  categoryName: string
}

/** 候选类目条目（传入 LLM 匹配函数的格式） */
export interface LeafCandidate {
  catId: number
  /** root→leaf 顺序的类目名数组 */
  pathNames: string[]
}

/** SiliconFlow API 响应体 */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string }
    finish_reason?: string
  }>
  error?: { message: string; code: string }
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

// ============================================================
// 常量
// ============================================================

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const MODEL = 'Pro/deepseek-ai/DeepSeek-V3.2'
const TIMEOUT_MS = 30_000

/** 系统 Prompt（共用） */
const SYSTEM_PROMPT = `你是一个电商类目匹配专家。你的任务是根据商品标题和来源平台类目信息，从候选的微信小店类目列表中选择最匹配的一个类目。

选择原则：
1. 优先匹配商品的核心功能/用途，而非外观材质
2. 商品标题中的关键信息（功能、场景）权重高于类目名称的字面匹配
3. 如果商品明显属于多个类目的交叉领域，选择最窄、最具体的那个
4. 必须从候选列表中选择，不要编造列表中不存在的类目

你必须严格返回 JSON 格式：
{"catId": <选中的类目ID数字>, "reason": "<简短理由，不超过50字>"}`

// ============================================================
// 底层 API 调用
// ============================================================

/**
 * 调用 SiliconFlow Chat Completions API
 *
 * 使用原生 fetch（Electron 34 / Node.js 内置），兼容 OpenAI 格式。
 * API Key 从 process.env.SILICONFLOW_API_KEY 读取。
 *
 * @returns LLM 返回的 content 字符串
 * @throws Error API Key 未配置、网络超时、API 返回错误
 */
const callSiliconFlow = async (
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Promise<string> => {
  const apiKey = process.env.SILICONFLOW_API_KEY
  if (!apiKey) {
    throw new Error('SILICONFLOW_API_KEY 未配置')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`SiliconFlow API 错误 [${resp.status}]: ${text.substring(0, 200)}`)
    }

    const data = await resp.json() as ChatCompletionResponse

    if (data.error) {
      throw new Error(`SiliconFlow API 错误: ${data.error.message}`)
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('LLM 返回内容为空')
    }

    return content
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================
// 候选列表格式化
// ============================================================

/**
 * 将候选叶子类目格式化为 LLM 可读的列表文本
 *
 * 每行格式：`catId | 叶子名 > 二级名 > 一级名`
 * 控制候选项数量以节省 token。
 */
const formatCandidateList = (
  candidates: LeafCandidate[],
  maxItems = 80
): string => {
  return candidates
    .slice(0, maxItems)
    .map(c => {
      const path = [...c.pathNames].reverse().join(' > ')
      return `${c.catId} | ${path}`
    })
    .join('\n')
}

/**
 * 解析 LLM 返回的 JSON，提取 catId
 */
const parseLLMResponse = (content: string): number | null => {
  try {
    // 尝试直接解析
    const parsed = JSON.parse(content)
    const catId = Number(parsed.catId)
    if (Number.isFinite(catId) && catId > 0) return catId
  } catch {
    // 尝试从文本中提取 JSON 块
    const jsonMatch = content.match(/\{[\s\S]*?"catId"\s*:\s*(\d+)[\s\S]*?\}/)
    if (jsonMatch) {
      const catId = Number(jsonMatch[1])
      if (Number.isFinite(catId) && catId > 0) return catId
    }
  }
  return null
}

// ============================================================
// 策略 A：已知二级域，LLM 选叶子
// ============================================================

/**
 * LLM 精准叶子类目匹配（已知二级域）
 *
 * 使用场景：静态映射表已将淘宝类目映射到微信二级域，
 * 在该二级域下的叶子类目（通常 ~50 个）中选择最匹配的。
 *
 * @param title - 商品标题
 * @param taobaoCategoryNames - 淘宝面包屑类目名数组
 * @param leafCandidates - 二级域下的叶子类目候选列表
 * @returns 匹配结果；失败返回 null
 */
export const llmMatchLeafInDomain = async (
  title: string,
  taobaoCategoryNames: string[],
  leafCandidates: LeafCandidate[]
): Promise<LLMCategoryResult | null> => {
  if (leafCandidates.length === 0) return null

  const candidateText = formatCandidateList(leafCandidates)
  const categoryPath = taobaoCategoryNames.length > 0
    ? taobaoCategoryNames.join(' > ')
    : '（无）'

  const userPrompt = `商品标题：${title}
来源类目：${categoryPath}

候选微信小店叶子类目（共 ${leafCandidates.length} 个）：
${candidateText}

请选择最匹配的类目，返回 JSON。`

  try {
    const content = await callSiliconFlow([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ])

    const catId = parseLLMResponse(content)
    if (catId === null) {
      console.warn('[LLM匹配] 返回格式无法解析:', content.substring(0, 100))
      return null
    }

    // 验证 catId 在候选列表中
    const matched = leafCandidates.find(c => c.catId === catId)
    if (!matched) {
      console.warn(`[LLM匹配] 返回的 catId ${catId} 不在候选列表中`)
      return null
    }

    return {
      catId,
      categoryName: [...matched.pathNames].reverse().join(' > '),
    }
  } catch (err: any) {
    console.warn('[LLM匹配] 策略A失败:', err.message)
    return null
  }
}

// ============================================================
// 策略 B：无映射，LLM 两阶段匹配
// ============================================================

/** 按二级类目分组的信息 */
interface Level2Group {
  level1: string
  level2: string
  /** 该二级下的叶子类目 */
  leaves: LeafCandidate[]
}

/**
 * 从全量微信类目中按二级类目分组
 */
const groupByLevel2 = (leaves: LeafCandidate[]): Level2Group[] => {
  const map = new Map<string, Level2Group>()
  for (const leaf of leaves) {
    // pathNames 是 root→leaf 顺序
    const level1 = leaf.pathNames[0] || ''
    const level2 = leaf.pathNames[1] || ''
    if (!level1 || !level2) continue

    const key = `${level1}>${level2}`
    if (!map.has(key)) {
      map.set(key, { level1, level2, leaves: [] })
    }
    map.get(key)!.leaves.push(leaf)
  }
  return Array.from(map.values())
}

/**
 * LLM 两阶段类目匹配（无映射时的兜底）
 *
 * 第一轮：发送 ~200 个二级类目，LLM 选出最匹配的二级类目
 * 第二轮：在该二级域下的叶子类目中，LLM 选出最佳叶子
 *
 * @param title - 商品标题
 * @param taobaoCategoryNames - 淘宝面包屑类目名数组
 * @param allLeafCandidates - 微信所有叶子类目候选
 * @returns 匹配结果；失败返回 null
 */
export const llmMatchBroadToNarrow = async (
  title: string,
  taobaoCategoryNames: string[],
  allLeafCandidates: LeafCandidate[]
): Promise<LLMCategoryResult | null> => {
  const groups = groupByLevel2(allLeafCandidates)
  if (groups.length === 0) return null

  const categoryPath = taobaoCategoryNames.length > 0
    ? taobaoCategoryNames.join(' > ')
    : '（无）'

  // ── 第一轮：从二级类目中选 ──
  const level2List = groups.map((g, i) => `${i} | ${g.level2} > ${g.level1}`).join('\n')

  const level2Prompt = `你是电商类目匹配专家。根据商品标题和来源类目，从候选的微信小店二级类目中选择最匹配的1个。

选择原则：优先匹配商品核心功能/用途。必须从候选列表中选择。
返回 JSON: {"index": <选中的序号数字>, "reason": "<简短理由>"}

商品标题：${title}
来源类目：${categoryPath}

候选二级类目（共 ${groups.length} 个）：
${level2List}`

  let selectedGroup: Level2Group | null = null
  try {
    const content = await callSiliconFlow([
      { role: 'system', content: '你是一个电商类目匹配专家，返回严格的JSON格式。' },
      { role: 'user', content: level2Prompt },
    ])

    const parsed = JSON.parse(content)
    const idx = Number(parsed.index)
    if (Number.isFinite(idx) && idx >= 0 && idx < groups.length) {
      selectedGroup = groups[idx]
    }
  } catch (err: any) {
    console.warn('[LLM匹配] 策略B第一轮失败:', err.message)
    return null
  }

  if (!selectedGroup || selectedGroup.leaves.length === 0) {
    console.warn('[LLM匹配] 策略B: 未选到二级类目或二级域下无叶子')
    return null
  }

  console.log(`[LLM匹配] 策略B第一轮选中: ${selectedGroup.level2} > ${selectedGroup.level1} (${selectedGroup.leaves.length} 个叶子)`)

  // ── 第二轮：在选中的二级域下选叶子 ──
  return await llmMatchLeafInDomain(title, taobaoCategoryNames, selectedGroup.leaves)
}
