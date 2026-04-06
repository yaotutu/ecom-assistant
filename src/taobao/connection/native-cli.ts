/**
 * 淘宝 native CLI 封装 — 连接层
 *
 * 这是整个工具链中最脆弱的环节，所有异常情况都要处理：
 * - taobao-native 命令不存在（未安装）
 * - 桌面版未启动
 * - 正在初始化（需要等待）
 * - 内测权限问题
 * - 连接超时
 */
import { execFile, exec } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const SOURCE_APP = 'copaw'
const TIMEOUT_MS = 120_000
const PAGE_SLEEP_MS = 2_000

// ─── 错误诊断 ──────────────────────────────────────────────

interface DiagnosticResult {
  userMessage: string
  suggestion: string
}

/** 已知错误 → 用户友好提示 */
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

// ─── CLI 二进制路径 ────────────────────────────────────────

/** macOS 上 taobao-native 可能的路径（按优先级） */
function getCliPaths(): string[] {
  const paths = ['taobao-native']
  if (process.platform === 'darwin') {
    paths.push(
      join(homedir(), 'Library/Application Support/taobao/cli/taobao-runner')
    )
  }
  return paths
}

// ─── 核心执行函数 ──────────────────────────────────────────

export class NativeCli {
  private cliPaths: string[]

  constructor() {
    this.cliPaths = getCliPaths()
  }

  /**
   * 执行 taobao-native 命令
   * 自动尝试所有可用路径
   */
  async exec(
    tool: string,
    args: Record<string, unknown>,
    outputFile?: string
  ): Promise<any> {
    const mergedArgs = { ...args, sourceApp: SOURCE_APP }
    const argArray = [tool, '--args', JSON.stringify(mergedArgs)]
    if (outputFile) argArray.push('-o', outputFile)

    let lastError: Error | null = null

    for (const cliPath of this.cliPaths) {
      try {
        return await this._execOnce(cliPath, argArray, outputFile)
      } catch (err) {
        lastError = err as Error
        // 只在"命令不存在"时尝试下一个路径
        if (!/ENOENT|not found|spawn/i.test(lastError.message)) {
          break
        }
      }
    }

    // 所有路径都失败了
    const diag = diagnose(lastError!)
    const err = new Error(diag.userMessage)
    ;(err as any).suggestion = diag.suggestion
    throw err
  }

  private _execOnce(
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
            const diag = diagnose(error)
            const err = new Error(diag.userMessage)
            ;(err as any).suggestion = diag.suggestion
            reject(err)
            return
          }

          // 优先读 -o 输出文件
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

          // 从 stdout 解析
          try {
            resolve(JSON.parse(stdout))
          } catch {
            resolve(null)
          }
        }
      )
    })
  }

  // ─── 高层 API ──────────────────────────────────────────

  /** 搜索商品 */
  async searchProducts(keyword: string, type = 'pc_taobao'): Promise<any> {
    const tmp = this.tmpFile('search_')
    try {
      return await this.exec('search_products', { keyword, type }, tmp)
    } finally {
      await safeUnlink(tmp)
    }
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

  // ─── 连接健康检查 ────────────────────────────────────

  async ping(): Promise<{
    ok: boolean
    message: string
    suggestion?: string
    latencyMs?: number
  }> {
    const start = Date.now()

    // 第一步：检测 CLI 是否存在（--help 不需要执行层就绪）
    try {
      await this.execHelp()
    } catch {
      return {
        ok: false,
        message: '淘宝桌面版未安装或 CLI 不可用',
        suggestion: '请确认淘宝桌面版已安装，并重启本工具。',
      }
    }

    // 第二步：检测执行层是否就绪
    try {
      await this.exec('get_current_tab', {})
      return {
        ok: true,
        message: `已连接淘宝桌面版 (${Date.now() - start}ms)`,
        latencyMs: Date.now() - start,
      }
    } catch (err: any) {
      const msg = err.message || ''

      // 执行层未就绪 — 尝试自动重启桌面版恢复
      if (msg.includes('未就绪') || msg.includes('未启动') || msg.includes('加载')) {
        return await this.recoverFromNotReady(start)
      }

      return {
        ok: false,
        message: err.message,
        suggestion: err.suggestion,
      }
    }
  }

  /**
   * 执行层未就绪时自动恢复：
   * 1. 杀掉桌面版进程
   * 2. 重新打开桌面版
   * 3. 等待启动完成
   * 4. 再次验证连接
   */
  private async recoverFromNotReady(startTime: number): Promise<{
    ok: boolean
    message: string
    suggestion?: string
    latencyMs?: number
  }> {
    // 杀掉旧进程
    if (process.platform === 'darwin') {
      exec('pkill -f "淘宝桌面版.app"')
    } else {
      exec('taskkill /F /IM "淘宝桌面版.exe"')
    }
    await sleep(3000)

    // 重新打开
    if (process.platform === 'darwin') {
      exec('open -a "/Applications/淘宝桌面版.app"')
    } else {
      // Windows: 尝试常见安装路径
      exec('start "" "淘宝桌面版"')
    }

    // 等待应用启动（最多等 40 秒，每 5 秒检测一次）
    for (let i = 0; i < 8; i++) {
      await sleep(5000)
      try {
        await this.exec('get_current_tab', {})
        return {
          ok: true,
          message: `已自动重连淘宝桌面版 (${Date.now() - startTime}ms)`,
          latencyMs: Date.now() - startTime,
        }
      } catch {
        // 继续等待
      }
    }

    return {
      ok: false,
      message: '淘宝桌面版连接已恢复中，请稍后重试',
      suggestion: '桌面版正在重新启动，请等待约 30 秒后点击"重新检测连接"。',
    }
  }

  /** 执行 --help 检测 CLI 是否存在（不需要执行层就绪） */
  private execHelp(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = this.cliPaths[0]
      execFile(
        cmd,
        ['--help'],
        { timeout: 10_000 },
        (error) => {
          if (error) {
            if (this.cliPaths.length > 1) {
              execFile(
                this.cliPaths[1],
                ['--help'],
                { timeout: 10_000 },
                (err2) => {
                  if (err2) reject(err2)
                  else resolve()
                }
              )
            } else {
              reject(error)
            }
            return
          }
          resolve()
        }
      )
    })
  }

  // ─── 工具方法 ─────────────────────────────────────────

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
