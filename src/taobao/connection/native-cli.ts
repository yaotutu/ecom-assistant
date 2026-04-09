/**
 * 淘宝 native CLI 封装 — 连接层
 *
 * 职责：
 * 1. 封装 CLI 调用，处理路径回退
 * 2. 心跳检测 — 定期探测连接存活，崩溃自动恢复
 * 3. 业务层不感知连接问题 — exec() 在恢复中会自动等待
 */
import { execFile, exec } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const SOURCE_APP = 'copaw'
const TIMEOUT_MS = 120_000
const PAGE_SLEEP_MS = 2_000
const HEARTBEAT_DEFAULT_MS = 30_000
const WAIT_RECOVERY_TIMEOUT_MS = 60_000

// ─── 连接状态 ───────────────────────────────────────────

export type ConnState = 'healthy' | 'recovering' | 'dead' | 'unknown'

export interface ConnStateChange {
  state: ConnState
  message: string
  suggestion?: string
  latencyMs?: number
}

type StateListener = (change: ConnStateChange) => void

// ─── 错误诊断 ──────────────────────────────────────────

interface DiagnosticResult {
  userMessage: string
  suggestion: string
}

const ERROR_DIAGNOSIS: Array<{ pattern: RegExp; result: DiagnosticResult }> = [
  {
    pattern: /ENOENT|not found|spawn/i,
    result: {
      userMessage: '淘宝桌面版未安装',
      suggestion: '请安装淘宝桌面版，安装后重启本工具。',
    },
  },
  {
    pattern: /执行层未就绪/i,
    result: {
      userMessage: '淘宝桌面版未启动或正在加载中',
      suggestion: '请打开淘宝桌面版，等待完全加载后再试。',
    },
  },
  {
    pattern: /内测期间仅开放部分用户/i,
    result: {
      userMessage: '淘宝桌面版正在启动中，请稍候',
      suggestion: '客户端需要几秒启动，请等待 10 秒后重试。',
    },
  },
  {
    pattern: /timed out|ETIMEDOUT/i,
    result: {
      userMessage: '连接超时',
      suggestion: '淘宝桌面版可能无响应，请关闭后重新打开。',
    },
  },
]

function diagnose(error: Error): DiagnosticResult {
  for (const { pattern, result } of ERROR_DIAGNOSIS) {
    if (pattern.test(error.message)) return result
  }
  return {
    userMessage: `连接失败: ${error.message}`,
    suggestion: '请确认淘宝桌面版已安装并正在运行。',
  }
}

// ─── CLI 二进制路径 ────────────────────────────────────

function getCliPaths(): string[] {
  const paths = ['taobao-native']

  if (process.platform === 'darwin') {
    paths.push(
      join(homedir(), 'Library/Application Support/taobao/cli/taobao-runner')
    )
  }

  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || ''
    if (appdata) {
      const locationFile = join(appdata, 'taobao', 'install-location.txt')
      try {
        if (existsSync(locationFile)) {
          const installDir = readFileSync(locationFile, 'utf-8').trim()
          if (installDir) {
            paths.push(join(installDir, 'bin', 'taobao-native.cmd'))
          }
        }
      } catch {
        // 读取失败，跳过
      }
    }
  }

  return paths
}

// ─── 路径回退 ──────────────────────────────────────────

async function tryPathsUntil<T>(
  paths: string[],
  fn: (cliPath: string) => Promise<T>
): Promise<T> {
  let lastError: Error | null = null

  for (const p of paths) {
    try {
      return await fn(p)
    } catch (err) {
      lastError = err as Error
      if (!/ENOENT|not found|spawn/i.test(lastError.message)) {
        break
      }
    }
  }

  const diag = diagnose(lastError!)
  const err = new Error(diag.userMessage)
  ;(err as any).suggestion = diag.suggestion
  throw err
}

// ─── NativeCli 核心 ────────────────────────────────────

export class NativeCli {
  private cliPaths: string[]

  // ─── 连接状态管理 ──────────────────────────────────
  private connState: ConnState = 'unknown'
  private listeners = new Set<StateListener>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // 恢复中等待队列：业务 exec() 在 recovering 状态时挂起的 Promise
  private recoveryResolvers: Array<{
    resolve: () => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  constructor() {
    this.cliPaths = getCliPaths()
  }

  // ─── 心跳管理 ─────────────────────────────────────

  /** 启动心跳循环（由主进程调用一次） */
  startHeartbeat(intervalMs = HEARTBEAT_DEFAULT_MS): void {
    this.stopHeartbeat()
    // 首次立即检测一次
    this.heartbeatTick()
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), intervalMs)
  }

  /** 停止心跳（应用退出时调用） */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** 订阅连接状态变更，返回取消订阅函数 */
  onStateChange(cb: StateListener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** 获取当前连接状态 */
  getState(): ConnState {
    return this.connState
  }

  // ─── 核心执行（带状态感知） ────────────────────────

  /**
   * 执行 CLI 命令
   * - healthy → 直接执行
   * - recovering → 等待恢复后执行（最多 60s）
   * - dead → 直接拒绝
   */
  async exec(
    tool: string,
    args: Record<string, unknown>,
    outputFile?: string
  ): Promise<any> {
    // 如果正在恢复中，等待恢复完成
    if (this.connState === 'recovering') {
      await this.waitForRecovery()
    }

    // dead 状态直接拒绝
    if (this.connState === 'dead') {
      throw new Error('淘宝桌面版连接已断开，请重启桌面版后重试')
    }

    return this.doExec(tool, args, outputFile)
  }

  /** 实际执行 CLI 命令（路径回退 + 错误诊断） */
  private async doExec(
    tool: string,
    args: Record<string, unknown>,
    outputFile?: string
  ): Promise<any> {
    const mergedArgs = { ...args, sourceApp: SOURCE_APP }
    const argArray = [tool, '--args', JSON.stringify(mergedArgs)]
    if (outputFile) argArray.push('-o', outputFile)

    return tryPathsUntil(this.cliPaths, (cliPath) =>
      this.execOnce(cliPath, argArray, outputFile)
    )
  }

  private execOnce(
    cmd: string,
    argArray: string[],
    outputFile?: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      execFile(
        cmd,
        argArray,
        { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        async (error, stdout) => {
          if (error) {
            reject(error)
            return
          }

          if (outputFile) {
            try {
              const content = await readFile(outputFile, 'utf-8')
              if (content.trim()) {
                resolve(JSON.parse(content))
                return
              }
            } catch {
              // fallback 到 stdout
            }
          }

          try {
            resolve(JSON.parse(stdout))
          } catch {
            resolve(null)
          }
        }
      )
    })
  }

  // ─── 心跳检测 ─────────────────────────────────────

  /** 单次心跳：ping → 更新状态 → 自动恢复（如果需要） */
  private async heartbeatTick(): Promise<void> {
    try {
      const start = Date.now()
      await this.doExec('get_current_tab', {})
      this.transitionTo('healthy', {
        state: 'healthy',
        message: `已连接淘宝桌面版 (${Date.now() - start}ms)`,
        latencyMs: Date.now() - start,
      })
    } catch {
      // 连接异常，尝试自动恢复
      await this.attemptRecovery()
    }
  }

  /** 尝试自动恢复淘宝桌面版 */
  private async attemptRecovery(): Promise<void> {
    this.transitionTo('recovering', {
      state: 'recovering',
      message: '检测到淘宝桌面版连接异常，正在自动重启...',
    })

    // 杀掉旧进程
    if (process.platform === 'darwin') {
      exec('osascript -e \'quit app "淘宝桌面版"\'')
    } else {
      exec('taskkill /F /IM "淘宝桌面版.exe"')
    }
    await sleep(3000)

    // 重新打开
    if (process.platform === 'darwin') {
      exec('open -a "/Applications/淘宝桌面版.app"')
    } else {
      exec('start "" "淘宝桌面版"')
    }

    // 等待启动完成（最多 40 秒，每 5 秒检测一次）
    for (let i = 0; i < 8; i++) {
      await sleep(5000)
      try {
        const start = Date.now()
        await this.doExec('get_current_tab', {})
        this.transitionTo('healthy', {
          state: 'healthy',
          message: `已自动重连淘宝桌面版 (${Date.now() - start}ms)`,
          latencyMs: Date.now() - start,
        })
        return
      } catch {
        // 继续等待
      }
    }

    // 恢复失败
    this.transitionTo('dead', {
      state: 'dead',
      message: '淘宝桌面版自动重启失败，请手动处理',
      suggestion: '请手动打开淘宝桌面版并确认已登录，然后点击「重新检测」。',
    })
  }

  // ─── 状态切换 & 通知 ──────────────────────────────

  /** 切换连接状态并通知所有监听者 */
  private transitionTo(state: ConnState, change: ConnStateChange): void {
    const prev = this.connState
    this.connState = state

    // 状态变化时通知监听者
    if (prev !== state) {
      for (const cb of this.listeners) {
        try { cb(change) } catch { /* 防止监听者异常 */ }
      }

      // 恢复成功时，唤醒所有等待中的业务调用
      if (state === 'healthy' && prev === 'recovering') {
        this.resolveRecoveryWaiters()
      }

      // 彻底失败时，拒绝所有等待中的业务调用
      if (state === 'dead' && prev === 'recovering') {
        this.rejectRecoveryWaiters()
      }
    }
  }

  // ─── 恢复等待队列 ────────────────────────────────

  /** 业务 exec() 在 recovering 状态时调用，等待恢复 */
  private waitForRecovery(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // 超时还没恢复
        this.removeWaiter(entry)
        reject(new Error('等待淘宝桌面版恢复超时，请稍后重试'))
      }, WAIT_RECOVERY_TIMEOUT_MS)

      const entry = { resolve, reject, timer }
      this.recoveryResolvers.push(entry)
    })
  }

  private removeWaiter(entry: typeof this.recoveryResolvers[number]): void {
    const idx = this.recoveryResolvers.indexOf(entry)
    if (idx >= 0) this.recoveryResolvers.splice(idx, 1)
    clearTimeout(entry.timer)
  }

  /** 恢复成功，唤醒所有等待者 */
  private resolveRecoveryWaiters(): void {
    const waiters = [...this.recoveryResolvers]
    this.recoveryResolvers = []
    for (const w of waiters) {
      clearTimeout(w.timer)
      w.resolve()
    }
  }

  /** 恢复失败，拒绝所有等待者 */
  private rejectRecoveryWaiters(): void {
    const waiters = [...this.recoveryResolvers]
    this.recoveryResolvers = []
    for (const w of waiters) {
      clearTimeout(w.timer)
      w.reject(new Error('淘宝桌面版自动重启失败，请手动处理'))
    }
  }

  // ─── 高层 API ──────────────────────────────────────

  /** 搜索商品 */
  async searchProducts(keyword: string, type = 'pc_taobao'): Promise<any> {
    const tmp = this.tmpFile('search_')
    try {
      return await this.exec('search_products', { keyword, type }, tmp)
    } finally {
      await safeUnlink(tmp)
    }
  }

  /** 搜索并等待页面加载 */
  async searchAndWait(
    keyword: string,
    type = 'pc_taobao'
  ): Promise<{ apiData: any; pageContent: string }> {
    const apiData = await this.searchProducts(keyword, type)
    await sleep(PAGE_SLEEP_MS)
    const pageContent = await this.readFullPageContent()
    return { apiData, pageContent }
  }

  /** 分段读取完整页面内容 */
  async readFullPageContent(): Promise<string> {
    let allContent = ''
    let offset = 0

    for (let i = 0; i < 10; i++) {
      const tmp = this.tmpFile('page_')
      let result: any
      try {
        result = await this.exec('read_page_content', { offset }, tmp)
      } finally {
        await safeUnlink(tmp)
      }

      if (!result) break

      const r = result.result ?? result
      const content: string = r.content ?? ''
      const total: number = r.totalLength ?? 0
      offset = (r.offset ?? 0) + content.length
      allContent += content

      if (offset >= total) break
    }

    return allContent
  }

  // ─── 商品详情获取 ──────────────────────────────────────

  /** 导航到指定 URL（用于打开淘宝商品详情页） */
  async navigateToUrl(url: string): Promise<any> {
    return this.exec('navigate_to_url', { url })
  }

  /** 获取当前页面的 SKU 规格数据 */
  async getProductSkus(): Promise<any> {
    const tmp = this.tmpFile('skus_')
    try {
      return await this.exec('get_product_skus', {}, tmp)
    } finally {
      await safeUnlink(tmp)
    }
  }

  /** 扫描当前页面的 DOM 元素（图片、按钮等结构化数据） */
  async scanPageElements(): Promise<any> {
    const tmp = this.tmpFile('elements_')
    try {
      return await this.exec('scan_page_elements', {}, tmp)
    } finally {
      await safeUnlink(tmp)
    }
  }

  // ─── 连接检查（UI 手动触发） ──────────────────────

  async ping(): Promise<{
    ok: boolean
    message: string
    suggestion?: string
    latencyMs?: number
  }> {
    // 先检测 CLI 是否存在
    try {
      await this.execHelp()
    } catch {
      return {
        ok: false,
        message: '淘宝桌面版未安装或 CLI 不可用',
        suggestion: '请确认淘宝桌面版已安装，并重启本工具。',
      }
    }

    // 检测执行层是否就绪
    try {
      const start = Date.now()
      await this.doExec('get_current_tab', {})
      this.transitionTo('healthy', {
        state: 'healthy',
        message: `已连接淘宝桌面版 (${Date.now() - start}ms)`,
        latencyMs: Date.now() - start,
      })
      return {
        ok: true,
        message: `已连接淘宝桌面版 (${Date.now() - start}ms)`,
        latencyMs: Date.now() - start,
      }
    } catch (err: any) {
      // 手动 ping 不触发自动恢复（心跳循环会处理）
      return {
        ok: false,
        message: err.message,
        suggestion: err.suggestion,
      }
    }
  }

  private execHelp(): Promise<void> {
    return tryPathsUntil(
      this.cliPaths,
      (cliPath) =>
        new Promise((resolve, reject) => {
          execFile(cliPath, ['--help'], { timeout: 10_000 }, (error) => {
            if (error) reject(error)
            else resolve(undefined)
          })
        })
    )
  }

  // ─── 工具方法 ──────────────────────────────────────

  tmpFile(prefix = 'tb_'): string {
    return join(tmpdir(), `${prefix}${Date.now()}.json`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function safeUnlink(filePath: string): Promise<void> {
  try { await unlink(filePath) } catch { /* ignore */ }
}
