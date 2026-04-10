/**
 * Preload — 安全桥接主进程与渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('platformAPI', {
  /** 手动检查连接（fallback，心跳会自动推送状态） */
  checkConnection(): Promise<{
    status: 'checking' | 'connected' | 'disconnected' | 'error'
    message: string
    suggestion?: string
    detail?: string
  }> {
    return ipcRenderer.invoke('platform:check-connection')
  },

  /**
   * 订阅连接状态变更（主进程心跳推送）
   * 返回取消订阅函数
   */
  onConnectionChange(
    callback: (result: {
      status: 'connected' | 'disconnected' | 'error' | 'checking'
      message: string
      suggestion?: string
    }) => void
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      result: Parameters<typeof callback>[0]
    ) => callback(result)
    ipcRenderer.on('platform:connection-status', handler)
    return () => {
      ipcRenderer.removeListener('platform:connection-status', handler)
    }
  },

  /** 搜索店铺 */
  searchStores(keyword: string): Promise<any> {
    return ipcRenderer.invoke('platform:search-stores', keyword)
  },

  /** 采集店铺全店商品 */
  collectStore(storeName: string, filterOptions: any): Promise<any> {
    return ipcRenderer.invoke('platform:collect-store', storeName, filterOptions)
  },

  /** 导出文件 */
  export(
    storeName: string,
    products: any[],
    filterOptions: any,
    format: 'detail' | 'links'
  ): Promise<any> {
    return ipcRenderer.invoke(
      'platform:export',
      storeName,
      products,
      filterOptions,
      format
    )
  },

  /**
   * 获取淘宝商品详情（含图片下载）
   * @param url - 淘宝商品 URL
   */
  fetchProductDetail(url: string): Promise<any> {
    return ipcRenderer.invoke('platform:fetch-product-detail', url)
  },

  /**
   * 淘宝商品 → 微信小店一键上货
   * 完整流程：获取详情 → 转换格式 → 上货到微信小店
   * access_token 从环境变量自动获取
   *
   * @param url - 淘宝商品 URL
   * @param transformOptions - 数据转换选项（类目、运费模板等）
   * @param listOptions - 上货选项（是否自动上架审核）
   */
  taobaoToWechat(
    url: string,
    transformOptions: any,
    listOptions?: { autoList?: boolean }
  ): Promise<any> {
    return ipcRenderer.invoke(
      'platform:taobao-to-wechat',
      url,
      transformOptions,
      listOptions
    )
  },

  /**
   * 获取微信小店 access_token（从 .env 环境变量自动获取）
   */
  getWechatToken(): Promise<any> {
    return ipcRenderer.invoke('wechat:get-token')
  },

  // ─── 淘宝 WebView 登录管理 ──────────────────────────

  /** 检查淘宝登录状态 */
  checkTaobaoLogin(): Promise<boolean> {
    return ipcRenderer.invoke('taobao:check-login')
  },

  /** 弹出淘宝登录窗口 */
  taobaoLogin(): Promise<boolean> {
    return ipcRenderer.invoke('taobao:login')
  },

  /** 清除淘宝登录态（登出） */
  taobaoLogout(): Promise<boolean> {
    return ipcRenderer.invoke('taobao:logout')
  },

  /** 获取淘宝 session 摘要信息（调试用） */
  getTaobaoSessionInfo(): Promise<{ cookieCount: number; hasLoginCookie: boolean }> {
    return ipcRenderer.invoke('taobao:session-info')
  },

  /**
   * 上传已提取的商品数据到微信小店（浏览器标签页专用）
   *
   * @param product - 从 webview 提取的商品数据
   * @param transformOptions - 微信小店转换选项
   * @param listOptions - 上货选项
   */
  uploadExtractedProduct(
    product: any,
    transformOptions: any,
    listOptions?: { autoList?: boolean }
  ): Promise<any> {
    return ipcRenderer.invoke(
      'taobao:upload-extracted-product',
      product,
      transformOptions,
      listOptions
    )
  },

  /** 测试类目匹配（支持传入淘宝面包屑类目名） */
  testCategoryMatch(title: string, categoryNames?: string[]): Promise<any> {
    return ipcRenderer.invoke('wechat:test-category-match', title, categoryNames)
  },

})
