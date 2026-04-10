/**
 * 淘宝 Native CLI 封装
 *
 * 所有 CLI 相关的逻辑都在这里：
 * - 路径发现：按优先级查找 CLI 二进制
 * - 连接检测：ping + 心跳 + 状态管理
 * - 命令执行：路径回退 + 错误解析
 * - 业务 API：搜索、导航、读取页面等高层封装
 */

import { execFile } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { ipcMain, BrowserWindow } from 'electron'
import { sleep } from '../../shared/utils'

// ============================================================
// 常量
// ============================================================

const SOURCE_APP = 'copaw'
const TIMEOUT_MS = 120_000
const PAGE_SLEEP_MS = 2_000
const HEARTBEAT_DEFAULT_MS = 30_000

// TODO: 临时禁用连接检测，开发完成后改回 false
const SKIP_CONNECTION_CHECK = true

// ============================================================
// 类型
// ============================================================

export type ConnState = 'healthy' | 'disconnected' | 'unknown'

export interface ConnStateChange {
  state: ConnState
  message: string
  suggestion?: string
  latencyMs?: number
}

type StateListener = (change: ConnStateChange) => void

// ============================================================
// CLI 路径发现
// ============================================================

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

// ============================================================
// 路径回退 + 错误诊断（唯一的 tryPathsUntil）
// ============================================================

/**
 * 依次尝试候选路径，只在 ENOENT 时回退
 * 非零退出码时从 stdout/stderr 提取实际错误信息
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

  const err = new Error(msg)
  ;(err as any).suggestion = suggestion ?? '请确认淘宝桌面版已安装并正在运行。'
  throw err
}

/** CLI 非零退出时，从 stdout/stderr 中提取实际错误信息 */
function extractCliError(error: Error, stdout: string, stderr: string): Error | null {
  const output = (stderr || '').trim() || (stdout || '').trim()
  if (!output) return null

  try {
    const parsed = JSON.parse(output)
    if (parsed.error) {
      const err = new Error(parsed.error)
      ;(err as any).suggestion = parsed.suggestion
      return err
    }
  } catch {
    return new Error(output)
  }
  return null
}

// ============================================================
// NativeCli
// ============================================================

export class NativeCli {
  private cliPaths: string[]

  // ─── 连接状态 ──────────────────────────────────────
  private connState: ConnState = 'unknown'
  private listeners = new Set<StateListener>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private win: BrowserWindow | null = null

  constructor() {
    this.cliPaths = getCliPaths()
  }

  // ============================================================
  // 连接检测
  // ============================================================

  /**
   * 启动连接检测服务（主进程调用一次）
   *
   * - 注册 platform:check-connection IPC handler
   * - 启动心跳循环，状态变更自动推送到渲染进程
   */
  startDetection(mainWindow: BrowserWindow): void {
    this.win = mainWindow

    // 手动检测 handler
    ipcMain.handle('platform:check-connection', async () => {
      const pingResult = await this.ping()
      if (pingResult.ok) {
        return { status: 'connected', message: pingResult.message }
      }
      return { status: 'disconnected', message: pingResult.message, suggestion: pingResult.suggestion }
    })

    // 启动心跳
    this.stopHeartbeat()
    this.heartbeatTick()
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), HEARTBEAT_DEFAULT_MS)
  }

  /** 停止连接检测（应用退出时调用） */
  stopDetection(): void {
    this.stopHeartbeat()
    this.win = null
  }

  /** 获取当前连接状态 */
  get state(): ConnState {
    return this.connState
  }

  /** 是否已跳过检测（开发模式） */
  get isCheckSkipped(): boolean {
    return SKIP_CONNECTION_CHECK
  }

  /** 订阅连接状态变更 */
  onStateChange(cb: StateListener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** 手动检测（ping） */
  async ping(): Promise<{
    ok: boolean
    message: string
    suggestion?: string
    latencyMs?: number
  }> {
    if (SKIP_CONNECTION_CHECK) {
      this.transitionTo('healthy', { state: 'healthy', message: '已连接淘宝桌面版（检测已跳过）' })
      return { ok: true, message: '已连接淘宝桌面版（检测已跳过）' }
    }

    // 第一步：CLI 二进制是否存在
    try {
      await this.execHelp()
    } catch {
      const result = { ok: false, message: '淘宝桌面版未安装或 CLI 不可用', suggestion: '请确认淘宝桌面版已安装，并重启本工具。' }
      this.transitionTo('disconnected', { state: 'disconnected', message: result.message, suggestion: result.suggestion })
      return result
    }

    // 第二步：执行层是否就绪
    try {
      const start = Date.now()
      await this.execPing()
      const latencyMs = Date.now() - start
      const msg = `已连接淘宝桌面版 (${latencyMs}ms)`
      this.transitionTo('healthy', { state: 'healthy', message: msg, latencyMs })
      return { ok: true, message: msg, latencyMs }
    } catch (err: any) {
      const suggestion = err.suggestion ?? '请重启淘宝桌面版，然后点击「重新检测」。'
      this.transitionTo('disconnected', { state: 'disconnected', message: '淘宝桌面版连接已断开', suggestion })
      return { ok: false, message: err.message, suggestion }
    }
  }

  // ─── 心跳 ─────────────────────────────────────────

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private async heartbeatTick(): Promise<void> {
    if (SKIP_CONNECTION_CHECK) {
      this.transitionTo('healthy', { state: 'healthy', message: '已连接淘宝桌面版（检测已跳过）' })
      return
    }

    try {
      const start = Date.now()
      await this.execPing()
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

  // ─── 状态切换 ──────────────────────────────────────

  private transitionTo(state: ConnState, change: ConnStateChange): void {
    const prev = this.connState
    this.connState = state

    if (prev === state) return

    // 通知内部监听者
    for (const cb of this.listeners) {
      try { cb(change) } catch { /* ignore */ }
    }

    // 推送到渲染进程
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('platform:connection-status', {
        status: state === 'healthy' ? 'connected'
          : state === 'unknown' ? 'checking'
          : 'disconnected',
        message: change.message,
        suggestion: change.suggestion,
      })
    }
  }

  // ─── CLI 探测（只用于检测，不做业务） ──────────────

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

  private execPing(): Promise<void> {
    return tryPathsUntil(
      this.cliPaths,
      (cliPath) =>
        new Promise((resolve, reject) => {
          const args = ['get_current_tab', '--args', JSON.stringify({ sourceApp: SOURCE_APP })]
          execFile(cliPath, args, { timeout: 10_000 }, (error, stdout, stderr) => {
            if (error) {
              const extracted = extractCliError(error, stdout, stderr)
              reject(extracted ?? error)
              return
            }
            resolve()
          })
        })
    )
  }

  // ============================================================
  // CLI 命令执行
  // ============================================================

  /**
   * 执行 CLI 命令
   * - disconnected 时拒绝（检测跳过时忽略）
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
        async (error, stdout, stderr) => {
          if (error) {
            const extracted = extractCliError(error, stdout, stderr)
            reject(extracted ?? error)
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

  // ============================================================
  // 业务 API
  // ============================================================

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

  /** 导航到指定 URL */
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

  /** 扫描当前页面的 DOM 元素 */
  async scanPageElements(): Promise<any> {
    const tmp = this.tmpFile('elements_')
    try {
      return await this.exec('scan_page_elements', {}, tmp)
    } finally {
      await safeUnlink(tmp)
    }
  }

  // ============================================================
  // 工具方法
  // ============================================================

  tmpFile(prefix = 'tb_'): string {
    return join(tmpdir(), `${prefix}${Date.now()}.json`)
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try { await unlink(filePath) } catch { /* ignore */ }
}
