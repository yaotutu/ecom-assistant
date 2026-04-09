/**
 * 登录窗口管理 — 创建和管理淘宝登录 BrowserWindow
 *
 * 职责：
 * 1. 创建独立的 BrowserWindow 用于淘宝登录
 * 2. 检测登录成功（URL 变化 + Cookie 出现）
 * 3. 登录成功后自动关闭窗口
 * 4. 支持取消登录（用户关闭窗口）
 *
 * 数据流：
 *   showLoginWindow()
 *     → 创建 BrowserWindow（使用 persist:taobao partition）
 *     → 导航到淘宝登录页
 *     → 用户手动登录
 *     → 检测到登录成功（URL 不再是登录页）
 *     → 自动关闭窗口 → resolve(true)
 *
 *     如果用户关闭窗口 → resolve(false)
 */

import { BrowserWindow } from 'electron'
import { getTaobaoSession, checkLoginStatus } from './session-manager'
import { getChromeUserAgent } from './anti-detection'

/** 淘宝登录页 URL */
const LOGIN_URL = 'https://login.taobao.com/'

/** 登录成功后的目标页面（用于检测） */
const LOGIN_SUCCESS_URL = 'https://i.taobao.com/my_taobao.htm'

/**
 * 检测 URL 是否为淘宝登录页面
 */
const isLoginPage = (url: string): boolean => {
  return url.includes('login.taobao.com') || url.includes('login.tmall.com')
}

/**
 * 显示淘宝登录窗口
 *
 * 创建一个独立窗口让用户登录淘宝。
 * 登录成功后自动关闭窗口并返回 true。
 * 用户手动关闭窗口则返回 false。
 *
 * @param parentWindow - 父窗口（用于模态窗口定位），可选
 * @returns true = 登录成功，false = 用户取消
 */
export const showLoginWindow = (parentWindow?: BrowserWindow): Promise<boolean> => {
  return new Promise((resolve) => {
    const ses = getTaobaoSession()
    const userAgent = getChromeUserAgent()

    const loginWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: '淘宝登录 — 电商助手',
      parent: parentWindow ?? undefined,
      modal: !!parentWindow,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        // 不需要 preload，登录窗口只用于用户交互
      },
    })

    // 设置 UA，去掉 Electron 标识
    loginWin.webContents.setUserAgent(userAgent)

    // 已 resolved 标记，防止多次 resolve
    let resolved = false

    const doResolve = (value: boolean) => {
      if (resolved) return
      resolved = true
      if (!loginWin.isDestroyed()) {
        loginWin.close()
      }
      resolve(value)
    }

    // 窗口关闭事件（用户手动关闭）
    loginWin.on('closed', () => {
      doResolve(false)
    })

    // 导航事件 — 检测登录成功
    loginWin.webContents.on('did-navigate', async (_event, url) => {
      // 如果离开了登录页面，说明登录可能成功
      if (!isLoginPage(url)) {
        // 等待一小段时间让 Cookie 写入
        await new Promise((r) => setTimeout(r, 2000))
        const isLoggedIn = await checkLoginStatus()
        if (isLoggedIn) {
          doResolve(true)
        }
      }
    })

    // 处理页面内跳转（某些登录流程是 SPA 内跳转）
    loginWin.webContents.on('did-navigate-in-page', async (_event, url) => {
      if (!isLoginPage(url)) {
        await new Promise((r) => setTimeout(r, 2000))
        const isLoggedIn = await checkLoginStatus()
        if (isLoggedIn) {
          doResolve(true)
        }
      }
    })

    // 加载淘宝登录页
    loginWin.loadURL(LOGIN_URL)
  })
}

/**
 * 检查登录状态并在必要时弹出登录窗口
 *
 * 流程：
 * 1. 先检查当前 session 是否有效
 * 2. 如果有效 → 直接返回 true
 * 3. 如果无效 → 弹出登录窗口等待用户登录
 *
 * @param parentWindow - 父窗口
 * @returns true = 已登录（之前就有效或刚登录成功），false = 登录失败或取消
 */
export const ensureLoggedIn = async (parentWindow?: BrowserWindow): Promise<boolean> => {
  // 先检查现有 session
  const isLoggedIn = await checkLoginStatus()
  if (isLoggedIn) {
    return true
  }

  // session 无效，弹出登录窗口
  return showLoginWindow(parentWindow)
}
