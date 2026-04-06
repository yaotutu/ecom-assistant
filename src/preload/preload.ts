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
})
