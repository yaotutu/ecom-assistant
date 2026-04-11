/**
 * 日志工具 - 主进程专用
 * 
 * 使用方式:
 * import { logger } from '../shared/logger'
 * logger.info('[Store]', '开始搜索店铺:', keyword)
 * logger.timed('[Product]', '采集商品', async () => { ... })
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

class Logger {
  private level: LogLevel = 'info'

  setLevel(level: LogLevel) {
    this.level = level
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.level)
  }

  private formatTime(): string {
    const now = new Date()
    return now.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0')
  }

  private log(level: LogLevel, tag: string, ...args: any[]) {
    if (!this.shouldLog(level)) return

    const prefix = `[${this.formatTime()}] ${level.toUpperCase()} ${tag}`
    
    switch (level) {
      case 'debug':
        console.log(prefix, ...args)
        break
      case 'info':
        console.log(prefix, ...args)
        break
      case 'warn':
        console.warn(prefix, ...args)
        break
      case 'error':
        console.error(prefix, ...args)
        break
    }
  }

  debug(tag: string, ...args: any[]) {
    this.log('debug', tag, ...args)
  }

  info(tag: string, ...args: any[]) {
    this.log('info', tag, ...args)
  }

  warn(tag: string, ...args: any[]) {
    this.log('warn', tag, ...args)
  }

  error(tag: string, ...args: any[]) {
    this.log('error', tag, ...args)
  }

  /**
   * 计时执行函数，自动记录开始、结束和耗时
   */
  async timed<T>(tag: string, taskName: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now()
    this.info(tag, `▶ ${taskName} 开始`)
    
    try {
      const result = await fn()
      const duration = Date.now() - start
      this.info(tag, `✔ ${taskName} 完成 (${duration}ms)`)
      return result
    } catch (error: any) {
      const duration = Date.now() - start
      this.error(tag, `✘ ${taskName} 失败 (${duration}ms):`, error.message)
      throw error
    }
  }

  /**
   * 记录数据量统计
   */
  stats(tag: string, ...stats: { label: string; value: number }[]) {
    const parts = stats.map(s => `${s.label}:${s.value}`)
    this.info(tag, `📊 ${parts.join(', ')}`)
  }

  /**
   * 记录步骤进度
   */
  step(tag: string, current: number, total: number, description: string) {
    const percent = Math.round((current / total) * 100)
    this.info(tag, `⏳ [${current}/${total}] ${percent}% ${description}`)
  }
}

export const logger = new Logger()
