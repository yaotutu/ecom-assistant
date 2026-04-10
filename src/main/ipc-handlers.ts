/**
 * IPC 通道处理 — 入口文件
 *
 * 职责：
 * 1. 创建平台实例，启动连接检测
 * 2. 注册所有子模块的 IPC handlers
 * 3. 应用退出时清理资源
 *
 * 业务 handler 拆分在 ipc/ 子目录：
 * - taobao-handlers.ts — 搜索店铺、采集商品、导出、登录管理
 * - wechat-handlers.ts — 商品详情获取、一键上货、类目匹配
 */

import { ipcMain, BrowserWindow } from 'electron'
import dotenv from 'dotenv'
import { TaobaoPlatform } from '../taobao'
import { registerTaobaoHandlers } from './ipc/taobao-handlers'
import { registerWechatHandlers } from './ipc/wechat-handlers'

// 加载 .env 环境变量
dotenv.config()

/** 模块级引用，供清理使用 */
let platform: TaobaoPlatform

/**
 * 简化 IPC handle 注册（供子模块使用）
 * 自动包裹 { success, data } / { success, error } 响应格式
 */
export const handle = (channel: string, handler: (...args: any[]) => Promise<any>) => {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { success: true, data: await handler(...args) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  platform = new TaobaoPlatform()

  // 启动连接检测（心跳 + 状态推送 + check-connection handler）
  platform.nativeCli.startDetection(mainWindow)

  // 注册业务 handlers
  registerTaobaoHandlers(mainWindow, platform)
  registerWechatHandlers(mainWindow)
}

/** 应用退出时清理 */
export function cleanupIpcHandlers(): void {
  platform?.nativeCli.stopDetection()
}
