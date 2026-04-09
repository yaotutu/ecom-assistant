/**
 * 微信小店上货模块 - 统一导出
 *
 * 对外暴露的 API：
 *
 * 核心流程（推荐使用）：
 * - listProductToStore(accessToken, productInput, options?)
 *     完整上货流程：上传图片 → 构建请求 → 添加商品 → 可选上架
 *
 * 构建工具（调试/预览用）：
 * - buildProductRequest(productInput, uploadedData)
 *     仅构建请求体，不提交（用于预览或自定义流程）
 *
 * API 客户端（直接调用微信 API）：
 * - uploadImage(accessToken, filePath)          上传单张图片
 * - getAllCategories(accessToken)                获取所有类目
 * - getCategoryDetail(accessToken, catId)        获取类目详情（含必填属性）
 * - getFreightTemplates(accessToken)             获取运费模板列表
 * - getAfterSaleAddresses(accessToken)           获取售后地址列表
 * - addProduct(accessToken, productRequest)      添加商品
 * - listProduct(accessToken, productId)          上架商品
 *
 * 类型（从 types.ts 导出）：
 * - ProductInput     商品标准输入（外部模块 → 本模块的数据格式）
 * - SkuInput         SKU 标准输入
 * - ListProductResult 上货结果
 * - AddProductRequest 微信 API 请求体格式
 * - ... 其他类型
 */

// 核心流程
export { listProductToStore, buildProductRequest } from './product-lister'

// API 客户端函数
export {
  uploadImage,
  getAllCategories,
  getCategoryDetail,
  getFreightTemplates,
  getAfterSaleAddresses,
  addProduct,
  listProduct,
  getAccessToken,
} from './api-client'

// 类型
export type {
  ProductInput,
  SkuInput,
  ListProductResult,
  ListProductStep,
  ListProductOptions,
  AddProductRequest,
  AddProductSku,
  AddProductResult,
  CategoryItem,
  CategoryNode,
  CategoryProperty,
  CategoryDetailResponse,
  CategoryAttr,
  WechatApiResponse,
} from './types'
