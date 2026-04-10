/**
 * 共享工具函数
 *
 * 提供项目中多处使用的通用异步工具和步骤记录工厂函数，
 * 避免在 product-fetcher、product-fetcher-v2、product-lister 中重复定义。
 */

import type { Step } from '../core/types'

// ============================================================
// 异步工具
// ============================================================

/** 等待指定毫秒 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** 计时工具 — 记录异步操作的耗时 */
export const timed = async <T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> => {
  const start = Date.now()
  const result = await fn()
  return { result, duration: Date.now() - start }
}

// ============================================================
// 步骤记录工厂
// ============================================================

/** 创建成功的步骤记录 */
export const ok = (name: string, duration: number, detail?: string): Step => ({
  name,
  success: true,
  duration,
  detail,
})

/** 创建失败的步骤记录 */
export const fail = (name: string, duration: number, error: string): Step => ({
  name,
  success: false,
  duration,
  detail: error,
})
