/**
 * 反检测策略 — 限流、随机延迟、User-Agent 管理
 *
 * 目标：让 WebView 的行为尽可能像真实用户操作，
 * 避免被淘宝的反爬虫系统识别为自动化工具。
 *
 * 设计原则：
 * - 所有函数为纯函数或无副作用的工具函数
 * - 不依赖 Electron API，可在任何环境中使用
 */

// ============================================================
// 随机延迟
// ============================================================

/**
 * 随机延迟 — 模拟人类操作间隔
 *
 * @param min - 最小延迟（毫秒）
 * @param max - 最大延迟（毫秒）
 * @returns Promise，在随机时间后 resolve
 */
export const randomDelay = (min = 3000, max = 8000): Promise<void> => {
  const ms = min + Math.random() * (max - min)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================
// 请求限流器
// ============================================================

/**
 * 请求限流器 — 控制商品详情页的访问频率
 *
 * 策略：
 * - 两次请求之间至少间隔 minInterval 毫秒
 * - 每小时最多允许 maxPerHour 次请求
 * - 超出限制时返回需要等待的时间
 */
export class RateLimiter {
  private timestamps: number[] = []
  private lastRequestTime = 0

  constructor(
    /** 两次请求最小间隔（毫秒，默认 8 秒） */
    private minInterval = 8_000,
    /** 每小时最大请求数（默认 20） */
    private maxPerHour = 20,
  ) {}

  /**
   * 等待直到可以发起下一次请求
   *
   * @returns 实际等待的毫秒数
   */
  async waitForSlot(): Promise<number> {
    const now = Date.now()

    // 清理超过 1 小时的旧记录
    this.timestamps = this.timestamps.filter((t) => now - t < 3_600_000)

    // 检查每小时限制
    if (this.timestamps.length >= this.maxPerHour) {
      const oldestInWindow = this.timestamps[0]
      const waitMs = oldestInWindow + 3_600_000 - now
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs))
        return waitMs
      }
    }

    // 检查最小间隔
    const elapsed = now - this.lastRequestTime
    if (elapsed < this.minInterval) {
      const waitMs = this.minInterval - elapsed
      // 加一点随机抖动，避免固定间隔模式
      const jitter = Math.random() * 3000
      const totalWait = waitMs + jitter
      await new Promise((r) => setTimeout(r, totalWait))
      return totalWait
    }

    return 0
  }

  /**
   * 记录一次请求（请求开始时调用）
   */
  recordRequest(): void {
    const now = Date.now()
    this.lastRequestTime = now
    this.timestamps.push(now)
  }

  /**
   * 获取当前状态（调试用）
   */
  getStats(): { requestsInHour: number; maxPerHour: number; canRequest: boolean } {
    const now = Date.now()
    const recent = this.timestamps.filter((t) => now - t < 3_600_000)
    return {
      requestsInHour: recent.length,
      maxPerHour: this.maxPerHour,
      canRequest: recent.length < this.maxPerHour,
    }
  }
}

// ============================================================
// User-Agent 管理
// ============================================================

/**
 * 获取合理的 Chrome User-Agent
 *
 * Electron 默认 UA 包含 "Electron" 字样，容易被识别为自动化工具。
 * 替换为与当前 Chromium 版本匹配的标准 Chrome UA。
 *
 * @param electronVersion - Electron 内置的 Chrome 版本号
 * @returns 标准 Chrome User-Agent 字符串
 */
export const getChromeUserAgent = (electronVersion?: string): string => {
  const chromeVersion = electronVersion || '130.0.0.0'

  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  }

  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  }

  // Linux fallback
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
}

// ============================================================
// 模拟人类滚动参数
// ============================================================

/**
 * 生成一组模拟人类滚动的位置序列
 *
 * 策略：从顶部到底部分多段滚动，每段距离和停顿时间都带有随机性，
 * 避免固定模式被检测。
 *
 * @param totalHeight - 页面总高度
 * @returns 滚动步骤数组 [{ scrollY, delayMs }]
 */
export const generateScrollSequence = (totalHeight: number): Array<{ scrollY: number; delayMs: number }> => {
  const steps: Array<{ scrollY: number; delayMs: number }> = []
  let currentY = 0

  // 每段滚动 300~800 像素
  while (currentY < totalHeight) {
    const stepSize = 300 + Math.random() * 500
    currentY = Math.min(currentY + stepSize, totalHeight)
    // 每段停顿 0.5~2 秒
    const delay = 500 + Math.random() * 1500
    steps.push({ scrollY: Math.round(currentY), delayMs: Math.round(delay) })
  }

  return steps
}
