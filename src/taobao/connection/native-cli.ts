/**
 * 淘宝 native CLI 封装 — 连接层（精简版）
 *
 * 职责：
 * 1. 封装 CLI 调用，处理路径回退
 * 2. 心跳检测 — 定期探测连接存活，失败时通知 UI
 * 3. 不做自动恢复 — 断开时提示用户重启淘宝桌面版
 */
import { execFile } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const SOURCE_APP = 'copaw'
const TIMEOUT_MS = 120_000
const PAGE_SLEEP_MS = 2_000
const HEARTBEAT_DEFAULT_MS = 30_000

// TODO: 临时禁用连接检测，开发完成后改回 false
const SKIP_CONNECTION_CHECK = true

// ─── 连接状态（三态：健康 / 断开 / 未知） ─────────────────

export type ConnState = 'healthy' | 'disconnected' | 'unknown'

export interface ConnStateChange {
  state: ConnState
  message: string
  suggestion?: string
  latencyMs?: number
}

type StateListener = (change: ConnStateChange) => void

// ─── CLI 二进制路径发现 ────────────────────────────────────

/** 按优先级返回候选 CLI 路径列表 */
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

// ─── 路径回退 ──────────────────────────────────────────────

/**
 * 依次尝试候选路径执行函数
 * 只在 ENOENT（命令不存在）时回退到下一个路径，其他错误直接中断
 */
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
      // 只在 CLI 不存在时尝试下一个路径
      if (!/ENOENT|not found|spawn/i.test(lastError.message)) {
        break
      }
    }
  }

  // 根据最后一个错误生成用户友好的提示
  const msg = lastError?.message ?? ''
  const suggestion = (lastError as any)?.suggestion

  if (/ENOENT|not found|spawn/i.test(msg)) {
    const err = new Error('淘宝桌面版未安装或 CLI 不可用')
    ;(err as any).suggestion = '请安装淘宝桌面版，安装后重启本工具。'
    throw err
  }
  if (/timed out|ETIMEDOUT/i.test(msg)) {
    const err = new Error('连接超时，淘宝桌面版可能无响应')
    ;(err as any).suggestion = '请关闭淘宝桌面版后重新打开，然后点击「重新检测」。'
    throw err
  }
  if (/未就绪|未启动|加载/i.test(msg)) {
    const err = new Error('淘宝桌面版未启动或正在加载中')
    ;(err as any).suggestion = suggestion ?? '请打开淘宝桌面版，等待完全加载后再试。'
    throw err
  }

  // 其他错误：直接透传 CLI 返回的错误信息
  const err = new Error(msg)
  ;(err as any).suggestion = suggestion ?? '请确认淘宝桌面版已安装并正在运行。'
  throw err
}

// ─── NativeCli 核心 ────────────────────────────────────────

export class NativeCli {
  private cliPaths: string[]

  // ─── 连接状态管理 ──────────────────────────────────
  private connState: ConnState = 'unknown'
  private listeners = new Set<StateListener>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

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

  // ─── 核心执行 ──────────────────────────────────────

  /**
   * 执行 CLI 命令
   * - healthy / unknown → 直接执行
   * - disconnected → 拒绝，提示用户重新连接
   */
  async exec(
    tool: string,
    args: Record<string, unknown>,
    outputFile?: string
  ): Promise<any> {
    if (!SKIP_CONNECTION_CHECK && this.connState === 'disconnected') {
      throw new Error('淘宝桌面版连接已断开，请重启淘宝桌面版后点击「重新检测」')
    }

    return this.doExec(tool, args, outputFile)
  }

  /** 实际执行 CLI 命令（路径回退） */
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

  /** 执行单次 CLI 调用 */
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
        async (error, stdout, stderr) => {
          if (error) {
            // CLI 非零退出时，stdout/stderr 中包含实际错误信息（如 {"error":"执行层未就绪"}）
            const output = (stderr || '').trim() || (stdout || '').trim()
            if (output) {
              try {
                const parsed = JSON.parse(output)
                if (parsed.error) {
                  const enriched = new Error(parsed.error)
                  ;(enriched as any).suggestion = parsed.suggestion
                  reject(enriched)
                  return
                }
              } catch {
                // 非 JSON，用原始输出作为错误信息
                reject(new Error(output))
                return
              }
            }
            reject(error)
            return
          }

          // 优先从输出文件读取结果
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

  /** 单次心跳：ping → 更新状态，失败直接标记为断开 */
  private async heartbeatTick(): Promise<void> {
    if (SKIP_CONNECTION_CHECK) {
      this.transitionTo('healthy', {
        state: 'healthy',
        message: '已连接淘宝桌面版（检测已跳过）',
      })
      return
    }

    try {
      const start = Date.now()
      await this.doExec('get_current_tab', {})
      this.transitionTo('healthy', {
        state: 'healthy',
        message: `已连接淘宝桌面版 (${Date.now() - start}ms)`,
        latencyMs: Date.now() - start,
      })
    } catch {
      this.transitionTo('disconnected', {
        state: 'disconnected',
        message: '淘宝桌面版连接已断开',
        suggestion: '请重启淘宝桌面版，然后点击「重新检测」。',
      })
    }
  }

  // ─── 状态切换 & 通知 ──────────────────────────────

  /** 切换连接状态并通知所有监听者 */
  private transitionTo(state: ConnState, change: ConnStateChange): void {
    const prev = this.connState
    this.connState = state

    if (prev !== state) {
      for (const cb of this.listeners) {
        try { cb(change) } catch { /* 防止监听者异常 */ }
      }
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

  // ─── 手动连接检查（UI 点击「重新检测」时触发） ──────

  async ping(): Promise<{
    ok: boolean
    message: string
    suggestion?: string
    latencyMs?: number
  }> {
    // 跳过连接检测时直接返回成功
    if (SKIP_CONNECTION_CHECK) {
      this.transitionTo('healthy', {
        state: 'healthy',
        message: '已连接淘宝桌面版（检测已跳过）',
      })
      return {
        ok: true,
        message: '已连接淘宝桌面版（检测已跳过）',
      }
    }

    // 先检测 CLI 二进制是否存在
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
      const latencyMs = Date.now() - start
      this.transitionTo('healthy', {
        state: 'healthy',
        message: `已连接淘宝桌面版 (${latencyMs}ms)`,
        latencyMs,
      })
      return {
        ok: true,
        message: `已连接淘宝桌面版 (${latencyMs}ms)`,
        latencyMs,
      }
    } catch (err: any) {
      this.transitionTo('disconnected', {
        state: 'disconnected',
        message: '淘宝桌面版连接已断开',
        suggestion: '请重启淘宝桌面版，然后点击「重新检测」。',
      })
      return {
        ok: false,
        message: err.message,
        suggestion: err.suggestion ?? '请重启淘宝桌面版，然后点击「重新检测」。',
      }
    }
  }

  /** 执行 --help 验证 CLI 二进制是否可用 */
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
