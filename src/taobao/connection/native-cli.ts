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

const MAX_DETECT_RETRIES = 10
const RETRY_INTERVAL_MS = 10_000

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
  private detecting = false
  private lastMessage = ''
  private lastSuggestion: string | undefined
  private detectCommand = ''

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
   * - 启动初始检测（带重试）
   * - 检测成功后自动启动心跳循环
   */
  startDetection(mainWindow: BrowserWindow): void {
    this.win = mainWindow

    // 检测/重试 handler
    ipcMain.handle('platform:check-connection', async () => {
      // 已连接：返回当前状态
      if (this.connState === 'healthy') {
        return { status: 'connected', message: this.lastMessage }
      }
      // 检测进行中：返回 checking
      if (this.detecting) {
        return { status: 'checking', message: '正在检测淘宝桌面版连接...' }
      }
      // 未连接且未检测中：触发重新检测
      this.initialDetection()
      return { status: 'checking', message: '正在检测淘宝桌面版连接...' }
    })

    // 跳过检测 handler
    ipcMain.handle('platform:skip-connection', async () => {
      this.skipDetection()
      return { status: 'connected', message: '已跳过检测（淘宝 CLI 功能不可用）' }
    })

    // 启动初始检测
    this.initialDetection()
  }

  /** 跳过检测，直接标记为已连接（不启动心跳） */
  skipDetection(): void {
    this.detecting = false
    this.stopHeartbeat()
    this.transitionTo('healthy', {
      state: 'healthy',
      message: '已跳过检测（淘宝 CLI 功能不可用）',
    })
  }

  /** 停止连接检测（应用退出时调用） */
  stopDetection(): void {
    this.detecting = false
    this.stopHeartbeat()
    this.win = null
  }

  /**
   * 初始检测：最多重试 MAX_DETECT_RETRIES 次
   *
   * 流程：
   * 1. 检查 CLI 二进制是否存在（只查一次）
   * 2. 调用 get_current_tab 检测执行层是否就绪
   * 3. 就绪 → 标记 healthy，启动心跳
   * 4. 未就绪 → 等 10s 重试，最多 10 次
   * 5. 全部失败 → 标记 disconnected，提示用户重启
   */
  private async initialDetection(): Promise<void> {
    this.detecting = true
    this.stopHeartbeat()

    // 第一步：查找 CLI 路径并解析为绝对路径（只做一次）
    let cliPath: string
    try {
      cliPath = await this.resolveCliPath()
      this.detectCommand = `${cliPath} get_current_tab --args '{"sourceApp":"copaw"}'`
    } catch {
      this.detectCommand = ''
      this.transitionTo('disconnected', {
        state: 'disconnected',
        message: '淘宝桌面版未安装或 CLI 不可用',
        suggestion: '请确认淘宝桌面版已安装，并重启本工具。',
      })
      this.detecting = false
      return
    }

    this.pushToRenderer('checking', '正在检测淘宝桌面版连接...', undefined, this.detectCommand)

    // 第二步：执行层是否就绪（最多重试 MAX_DETECT_RETRIES 次）
    for (let attempt = 1; attempt <= MAX_DETECT_RETRIES; attempt++) {
      if (!this.detecting) return // 被中止（用户点击重试）

      try {
        const start = Date.now()
        await this.execPing()
        const latencyMs = Date.now() - start
        this.transitionTo('healthy', {
          state: 'healthy',
          message: `已连接淘宝桌面版 (${latencyMs}ms)`,
          latencyMs,
        })
        this.startHeartbeat()
        this.detecting = false
        return
      } catch {
        if (attempt < MAX_DETECT_RETRIES && this.detecting) {
          this.pushToRenderer('checking',
            `正在等待淘宝桌面版启动... (${attempt}/${MAX_DETECT_RETRIES})`,
            undefined, this.detectCommand)
          await sleep(RETRY_INTERVAL_MS)
        }
      }
    }

    // 所有重试均失败
    if (!this.detecting) return
    this.transitionTo('disconnected', {
      state: 'disconnected',
      message: '淘宝桌面版连接失败，请重启淘宝桌面版',
      suggestion: '请重启淘宝桌面版，然后点击「重新检测」。',
    })
    this.detecting = false
  }

  /** 启动心跳循环（仅在检测成功后调用） */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTick()
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), HEARTBEAT_DEFAULT_MS)
  }

  /** 直接推送状态到渲染进程（不经过状态机 prev===state 判断） */
  private pushToRenderer(status: string, message: string, suggestion?: string, command?: string): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('platform:connection-status', { status, message, suggestion, command })
    }
  }

  /** 获取当前连接状态 */
  get state(): ConnState {
    return this.connState
  }

  /** 订阅连接状态变更 */
  onStateChange(cb: StateListener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** 手动检测（ping）— 单次检测，不重试 */
  async ping(): Promise<{
    ok: boolean
    message: string
    suggestion?: string
    latencyMs?: number
  }> {
    // 第一步：CLI 二进制是否存在
    try {
      await this.execHelp()
    } catch {
      return { ok: false, message: '淘宝桌面版未安装或 CLI 不可用', suggestion: '请确认淘宝桌面版已安装，并重启本工具。' }
    }

    // 第二步：执行层是否就绪
    try {
      const start = Date.now()
      await this.execPing()
      const latencyMs = Date.now() - start
      return { ok: true, message: `已连接淘宝桌面版 (${latencyMs}ms)`, latencyMs }
    } catch (err: any) {
      return { ok: false, message: err.message, suggestion: err.suggestion }
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
    this.lastMessage = change.message
    this.lastSuggestion = change.suggestion

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
        command: this.detectCommand || undefined,
        suggestion: change.suggestion,
      })
    }
  }

  // ─── CLI 路径解析 ──────────────────────────────────

  /**
   * 查找可用的 CLI 路径并解析为绝对路径
   * 遍历候选路径列表，返回第一个可用的完整路径
   */
  private async resolveCliPath(): Promise<string> {
    for (const cliPath of this.cliPaths) {
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(cliPath, ['--help'], { timeout: 10_000 }, (error) => {
            if (error) reject(error)
            else resolve()
          })
        })
        // 已是绝对路径（Unix /开头 或 Windows 盘符开头），直接返回
        if (cliPath.startsWith('/') || /^[A-Z]:/i.test(cliPath)) return cliPath
        // 相对路径（如 taobao-native）：通过 which/where 解析完整路径
        return await this.whichResolve(cliPath)
      } catch (err: any) {
        if (!/ENOENT|not found|spawn/i.test(err.message)) break
      }
    }
    throw new Error('未找到 CLI')
  }

  /** 通过 which/where 命令解析 CLI 的完整绝对路径 */
  private whichResolve(cmd: string): Promise<string> {
    return new Promise((resolve) => {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which'
      execFile(whichCmd, [cmd], { timeout: 5_000 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(cmd) // 解析失败，返回原始命令名
        } else {
          resolve(stdout.trim().split('\n')[0])
        }
      })
    })
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
    if (this.connState === 'disconnected') {
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
