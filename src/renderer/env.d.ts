/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ConnectionResult {
  status: 'checking' | 'connected' | 'disconnected' | 'error'
  message: string
  suggestion?: string
  detail?: string
}

interface Product {
  title: string
  itemId: string
  price: string
  shopName: string
  sales: number
  salesStr: string
  link: string
}

interface PlatformAPI {
  checkConnection(): Promise<ConnectionResult>
  searchStores(keyword: string, topN?: number): Promise<any>
  collectStore(
    storeName: string,
    filterOptions: { minSales?: number; minPrice?: number; maxPrice?: number }
  ): Promise<{
    success: boolean
    data?: {
      store: string
      totalInStore: number
      totalAfterFilter: number
      products: Product[]
    }
    error?: string
    suggestion?: string
  }>
  export(
    storeName: string,
    products: any[],
    filterOptions: any,
    format: 'detail' | 'links'
  ): Promise<{ success: boolean; filePath?: string; error?: string }>
}

interface Window {
  platformAPI: PlatformAPI
}
