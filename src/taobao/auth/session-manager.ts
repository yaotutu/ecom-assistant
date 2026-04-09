/**
 * Session 管理器 — 淘宝登录态持久化
 *
 * 职责：
 * 1. 通过 Electron 的 partition 机制实现 Cookie 持久化
 * 2. 检测登录状态是否有效（仅通过 Cookie 判断）
 * 3. 提供 session 对象供登录窗口和抓取窗口共享
 *
 * 核心原理：
 * - Electron 的 `persist:xxx` partition 会将 Cookie 写入磁盘
 * - 同一 partition 的所有窗口共享 Cookie
 * - 应用重启后 Cookie 自动恢复
 *
 * 登录判断策略：
 * - 淘宝登录后会设置 `cookie2` 和 `sgcookie` 这两个关键 Cookie
 * - 这两个 Cookie 有过期时间，过期后浏览器不再发送
 * - 所以只要这两个 Cookie 存在且未过期，就认为已登录
 * - 不使用 HTTP 请求验证（避免 net.fetch 使用错误 session 的问题）
 *
 * 设计原则：
 * - 单例模式，整个应用只有一个 Taobao session
 * - Cookie 持久化由 Electron 自动管理，不需要手动序列化
 */

import { session } from 'electron'

/** 持久化 partition 名称，Cookie 会自动写入磁盘 */
const TAOBAO_PARTITION = 'persist:taobao'

/**
 * 获取淘宝专用的 Electron Session
 *
 * 使用 `persist:taobao` partition，Cookie 自动持久化到磁盘。
 * 所有使用此 session 的窗口共享同一份 Cookie。
 */
export const getTaobaoSession = () => session.fromPartition(TAOBAO_PARTITION)

/**
 * 检查淘宝登录状态
 *
 * 判断依据：`cookie2` 或 `sgcookie` 是否存在且未过期。
 * 这两个 Cookie 是淘宝登录后才会设置的关键 Cookie：
 * - `cookie2`：登录成功后由服务端 Set-Cookie 设置，包含加密的登录凭证
 * - `sgcookie`：淘宝的 session gateway cookie，同样只有登录后才有
 *
 * 注意：不检查 `_m_h5_tk`，它只是淘宝的 CSRF/跟踪 token，
 * 访问任何淘宝页面都会设置，与登录无关。
 *
 * @returns true = 已登录，false = 未登录
 */
export const checkLoginStatus = async (): Promise<boolean> => {
  try {
    const ses = getTaobaoSession()
    const cookies = await ses.cookies.get({ domain: '.taobao.com' })

    // 调试日志：打印所有淘宝 Cookie 的名称
    console.log('[taobao-auth] 淘宝 Cookie 总数:', cookies.length)
    console.log('[taobao-auth] Cookie 名称列表:', cookies.map(c => `${c.name}=${c.value?.substring(0, 10)}...(过期:${c.expirationDate})`).join(', '))

    const now = Date.now() / 1000 // Electron cookie 的 expiry 是秒级时间戳

    // 检查 cookie2 或 sgcookie 是否存在且未过期
    const hasValidLoginCookie = cookies.some((c) => {
      if (c.name !== 'cookie2' && c.name !== 'sgcookie') return false
      // 如果没有 expiry 或 expiry 为 -1，说明是 session cookie，仍然有效
      if (!c.expirationDate || c.expirationDate === -1) return true
      // 检查是否过期
      return c.expirationDate > now
    })

    console.log('[taobao-auth] 登录判断结果:', hasValidLoginCookie)
    return hasValidLoginCookie
  } catch (e) {
    console.log('[taobao-auth] 检查登录状态异常:', e)
    return false
  }
}

/**
 * 清除淘宝登录态（用户主动登出时调用）
 */
export const clearTaobaoSession = async (): Promise<void> => {
  const ses = getTaobaoSession()
  // 分别清理淘宝和天猫的存储数据
  await ses.clearStorageData({
    storages: ['cookies', 'localstorage'],
  })
}

/**
 * 获取当前 session 的 Cookie 摘要（调试用）
 *
 * @returns Cookie 数量的简要统计
 */
export const getSessionSummary = async (): Promise<{
  cookieCount: number
  hasLoginCookie: boolean
}> => {
  const cookies = await getTaobaoSession().cookies.get({ domain: '.taobao.com' })
  return {
    cookieCount: cookies.length,
    hasLoginCookie: cookies.some(
      (c) => c.name === 'cookie2' || c.name === 'sgcookie'
    ),
  }
}
