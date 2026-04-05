/**
 * Preload — 安全桥接主进程与渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('platformAPI', {
  /** 检查平台连接状态 */
  checkConnection(): Promise<{
    status: 'checking' | 'connected' | 'disconnected' | 'error'
    message: string
    suggestion?: string
    detail?: string
  }> {
    return ipcRenderer.invoke('platform:check-connection')
  },

  /** 搜索 TOP 店铺 */
  searchStores(keyword: string, topN = 3): Promise<any> {
    return ipcRenderer.invoke('platform:search-stores', keyword, topN)
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
})
