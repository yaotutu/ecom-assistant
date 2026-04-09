/**
 * 淘宝认证模块 — 统一导出
 *
 * 对外暴露的 API：
 * - getTaobaoSession() — 获取持久化 session
 * - checkLoginStatus() — 检查是否已登录
 * - clearTaobaoSession() — 清除登录态
 * - ensureLoggedIn() — 确保已登录（必要时弹出登录窗口）
 * - showLoginWindow() — 显示登录窗口
 * - RateLimiter — 请求限流器
 * - getChromeUserAgent() — 获取 Chrome UA
 * - randomDelay() — 随机延迟
 */

export { getTaobaoSession, checkLoginStatus, clearTaobaoSession, getSessionSummary } from './session-manager'
export { showLoginWindow, ensureLoggedIn } from './login-window'
export { RateLimiter, getChromeUserAgent, randomDelay, generateScrollSequence } from './anti-detection'
