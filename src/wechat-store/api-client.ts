/**
 * 微信小店 API 客户端
 *
 * 封装微信小店所有 REST API 调用，提供函数式接口。
 * 所有函数均为纯 HTTP 调用，不包含业务编排逻辑。
 *
 * 使用方式：
 *   import { uploadImage, getAllCategories, addProduct } from './api-client'
 *   const imgUrl = await uploadImage(token, '/path/to/image.png')
 *
 * 注意：
 * - access_token 由调用方提供，本模块不负责 token 管理
 * - 本模块运行在 Electron 主进程（Node.js 环境），使用 fetch API
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type {
  WechatApiResponse,
  UploadImageResult,
  CategoryItem,
  CategoryDetailResponse,
  FreightTemplateListResponse,
  AfterSaleAddressListResponse,
  AddProductRequest,
  AddProductResult,
} from './types'

// ============================================================
// 常量
// ============================================================

/** 微信小店 API 基础域名 */
const API_BASE = 'https://api.weixin.qq.com'

/**
 * 图片格式 → MIME 类型映射
 * 微信小店支持：bmp, jpg/jpeg, png, svg, webp
 */
const MIME_MAP: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'text/xml',
  '.webp': 'image/webp',
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 发送 GET 请求并解析 JSON 响应
 *
 * @param path - API 路径（不含域名和 access_token 参数）
 * @param accessToken - 接口调用凭证
 * @returns 解析后的 JSON 响应
 */
const get = async <T>(
  path: string,
  accessToken: string
): Promise<WechatApiResponse<T>> => {
  const url = `${API_BASE}${path}?access_token=${accessToken}`
  const resp = await fetch(url)
  return resp.json() as Promise<WechatApiResponse<T>>
}

/**
 * 发送 POST 请求（JSON body）并解析 JSON 响应
 *
 * @param path - API 路径（不含域名和 access_token 参数）
 * @param accessToken - 接口调用凭证
 * @param body - 请求体对象（会被序列化为 JSON）
 * @returns 解析后的 JSON 响应
 */
const post = async <T>(
  path: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<WechatApiResponse<T>> => {
  const url = `${API_BASE}${path}?access_token=${accessToken}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return resp.json() as Promise<WechatApiResponse<T>>
}

/**
 * 检查 API 返回是否成功，失败时抛出错误
 *
 * @param response - API 返回的原始数据
 * @param action - 操作描述（用于错误消息）
 * @returns 解包后的 data 字段
 * @throws Error 当 errcode 不为 0 时
 */
const checkResponse = <T>(
  response: WechatApiResponse<T>,
  action: string
): T => {
  if (response.errcode !== 0) {
    throw new Error(`${action}失败 [${response.errcode}]: ${response.errmsg}`)
  }
  return response.data ?? ({} as T)
}

/**
 * 从本地图片文件读取尺寸（仅支持 PNG 和 JPEG）
 *
 * PNG: IHDR chunk 在文件头，直接读取 width/height
 * JPEG: 查找 SOF0/SOF2 marker 读取尺寸
 *
 * @param filePath - 本地图片文件路径
 * @returns { width, height } 或 null（无法解析时）
 */
const readImageDimensions = (
  filePath: string
): { width: number; height: number } | null => {
  const buf = readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()

  // PNG: 文件头 8 字节签名 + 4 字节长度 + 4 字节类型('IHDR') + 4 字节 width + 4 字节 height
  if (ext === '.png') {
    if (buf.length < 24) return null
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    }
  }

  // JPEG: 遍历 marker 查找 SOF0 (0xFFC0) 或 SOF2 (0xFFC2)
  if (ext === '.jpg' || ext === '.jpeg') {
    let offset = 2 // 跳过 SOI marker (0xFFD8)
    while (offset < buf.length - 9) {
      if (buf[offset] !== 0xff) break
      const marker = buf[offset + 1]
      // SOF0 或 SOF2：高 2 字节 + 宽 2 字节
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
        }
      }
      // 其他 marker：跳过（0xD8/0xD9 等无长度的 marker）
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
      } else {
        const segLen = buf.readUInt16BE(offset + 2)
        offset += 2 + segLen
      }
    }
  }

  return null
}

// ============================================================
// 图片上传
// ============================================================

/**
 * 上传图片到微信小店
 *
 * 所有商品相关图片（主图、详情图、SKU 图等）都必须先通过此接口上传，
 * 返回的 mmecimage.cn/p/ 链接才能在商品 API 中使用。
 *
 * 支持格式：bmp, jpg/jpeg, png, svg, webp
 * 大小限制：resp_type=1 时最大 10MB
 *
 * @param accessToken - 接口调用凭证
 * @param filePath - 本地图片文件路径
 * @returns 上传后的图片 URL（mmecimage.cn/p/ 格式）
 * @throws Error 上传失败或图片格式不支持时
 *
 * @example
 * const imgUrl = await uploadImage(token, '/path/to/product.jpg')
 * // → "https://mmecimage.cn/p/wx.../xxxxx"
 */
export const uploadImage = async (
  accessToken: string,
  filePath: string
): Promise<string> => {
  // 1. 读取文件
  const fileBuffer = readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const mimeType = MIME_MAP[ext]
  if (!mimeType) {
    throw new Error(
      `不支持的图片格式: ${ext}，仅支持 bmp/jpg/png/svg/webp`
    )
  }

  // 2. 自动获取图片尺寸
  const dimensions = readImageDimensions(filePath)
  if (!dimensions) {
    throw new Error(`无法读取图片尺寸: ${filePath}`)
  }

  // 3. 构建 multipart/form-data 上传请求
  const blob = new Blob([fileBuffer], { type: mimeType })
  const formData = new FormData()
  formData.append('media', blob, `image${ext}`)

  const url = new URL(`${API_BASE}/shop/ec/basics/img/upload`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('upload_type', '0')     // 二进制流上传
  url.searchParams.set('resp_type', '1')        // 返回图片链接（商品图片必须用此模式）
  url.searchParams.set('height', String(dimensions.height))
  url.searchParams.set('width', String(dimensions.width))

  const resp = await fetch(url.toString(), {
    method: 'POST',
    body: formData,
  })
  const result = (await resp.json()) as WechatApiResponse<UploadImageResult>

  const data = checkResponse(result, '上传图片')

  if (!data.img_url) {
    throw new Error('上传图片成功但未返回 img_url')
  }
  return data.img_url
}

// ============================================================
// 类目管理
// ============================================================

/**
 * 获取店铺可用的所有类目列表
 *
 * 返回的类目树结构中，每个条目包含从叶子到根的完整类目链。
 * 叶子类目（leaf=true）才能用于添加商品。
 *
 * @param accessToken - 接口调用凭证
 * @returns 类目条目数组
 *
 * @example
 * const cats = await getAllCategories(token)
 * // 找到叶子类目的完整路径
 * cats.forEach(item => {
 *   const names = item.cat_and_qua.map(c => c.cat.name).reverse()
 *   console.log(names.join(' > '))  // "家居日用 > 家装软饰 > 钥匙扣"
 * })
 */
export const getAllCategories = async (
  accessToken: string
): Promise<CategoryItem[]> => {
  const result = await get<{ cats: CategoryItem[] }>(
    '/channels/ec/category/all',
    accessToken
  )
  return checkResponse(result, '获取类目列表').cats ?? []
}

/**
 * 获取叶子类目的详细信息（包含必填属性、资质要求等）
 *
 * 添加商品前必须先调用此接口了解类目的必填属性。
 * 返回的 product_attr_list 中 is_required=true 的属性必须在商品中填写。
 *
 * @param accessToken - 接口调用凭证
 * @param catId - 叶子类目 ID
 * @returns 类目详情（含属性列表、资质要求等）
 *
 * @example
 * const detail = await getCategoryDetail(token, 546178)
 * detail.attr.product_attr_list.forEach(attr => {
 *   if (attr.is_required) {
 *     console.log(`必填: ${attr.name} (${attr.type_v2})`)
 *   }
 * })
 */
export const getCategoryDetail = async (
  accessToken: string,
  catId: number
): Promise<CategoryDetailResponse> => {
  const result = await post<CategoryDetailResponse>(
    '/shop/ec/category/detail',
    accessToken,
    { cat_id: catId }
  )
  return checkResponse(result, '获取类目详情')
}

// ============================================================
// 运费模板
// ============================================================

/**
 * 获取店铺的运费模板 ID 列表
 *
 * 添加商品时 express_info.template_id 需要引用有效的运费模板。
 * 运费模板需在微信小店后台预先创建。
 *
 * @param accessToken - 接口调用凭证
 * @returns 运费模板 ID 数组
 *
 * @example
 * const templates = await getFreightTemplates(token)
 * // → ["979080438004", "979080498004"]
 */
export const getFreightTemplates = async (
  accessToken: string
): Promise<string[]> => {
  const result = await post<FreightTemplateListResponse>(
    '/channels/ec/merchant/getfreighttemplatelist',
    accessToken,
    { limit: 100, offset: 0 }
  )
  return checkResponse(result, '获取运费模板').template_id_list ?? []
}

// ============================================================
// 售后地址
// ============================================================

/**
 * 获取售后/退货地址 ID 列表
 *
 * 添加商品时 after_sale_info.after_sale_address_id 需要引用有效的售后地址。
 * 售后地址需在微信小店后台预先创建。
 *
 * @param accessToken - 接口调用凭证
 * @returns 售后地址 ID 数组
 *
 * @example
 * const addresses = await getAfterSaleAddresses(token)
 * // → ["87607600002"]
 */
export const getAfterSaleAddresses = async (
  accessToken: string
): Promise<string[]> => {
  const result = await post<AfterSaleAddressListResponse>(
    '/channels/ec/merchant/address/list',
    accessToken,
    { limit: 100 }
  )
  return checkResponse(result, '获取售后地址').address_id_list ?? []
}

// ============================================================
// 商品管理
// ============================================================

/**
 * 添加商品到微信小店
 *
 * 商品添加后处于「草稿」状态，需要调用 listProduct() 提交审核上架。
 * 也可以在请求中设置 listing=1 一步完成添加+提交审核。
 *
 * 注意：
 * - 所有图片 URL 必须是 mmecimage.cn/p/ 格式（通过 uploadImage 获取）
 * - cats_v2 按一级→二级→...→N 级顺序排列
 * - 商品上架后不可修改一级类目
 * - SKU 数量超过 25 时 API 会异步处理
 *
 * @param accessToken - 接口调用凭证
 * @param product - 完整的商品请求体（符合微信 API 格式）
 * @returns 商品 ID 和创建时间
 *
 * @example
 * const result = await addProduct(token, {
 *   title: "商品标题",
 *   head_imgs: ["https://mmecimage.cn/p/..."],
 *   // ... 其他必填字段
 * })
 * console.log(result.product_id)  // "10000678236436"
 */
export const addProduct = async (
  accessToken: string,
  product: AddProductRequest
): Promise<AddProductResult> => {
  const result = await post<AddProductResult>(
    '/channels/ec/product/add',
    accessToken,
    product as unknown as Record<string, unknown>
  )
  return checkResponse(result, '添加商品')
}

/**
 * 上架商品（提交审核）
 *
 * 将草稿商品提交审核，审核通过后草稿数据覆盖线上数据正式生效。
 *
 * 注意：
 * - 频繁调用上架接口会被封禁
 * - 每店铺每天有提审次数限制
 * - 商品正在审核中（edit_status=7）时调用会返回 10020067 错误
 * - 建议先检查商品状态，审核中不要重复提交
 *
 * @param accessToken - 接口调用凭证
 * @param productId - 商品 ID（由 addProduct 返回）
 *
 * @example
 * await listProduct(token, "10000678236436")
 */
export const listProduct = async (
  accessToken: string,
  productId: string
): Promise<void> => {
  const result = await post<unknown>(
    '/channels/ec/product/listing',
    accessToken,
    { product_id: productId }
  )
  checkResponse(result, '上架商品')
}

// ============================================================
// Access Token 管理
// ============================================================

/**
 * 通过 AppID + AppSecret 获取微信小店 access_token
 *
 * 微信文档：https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Get_access_token.html
 * 注意：access_token 有效期 7200 秒（2 小时），需要定期刷新。
 *       暂时不做缓存，每次调用都重新获取。
 *
 * @param appid - 微信公众号/小程序的 AppID
 * @param secret - 对应的 AppSecret
 * @returns access_token 字符串
 * @throws Error 获取失败时
 *
 * @example
 * const token = await getAccessToken('wx1234', 'secret123')
 * // → "73_abc123..."
 */
export const getAccessToken = async (
  appid: string,
  secret: string
): Promise<string> => {
  const url = `${API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`
  const resp = await fetch(url)
  const result = (await resp.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }

  if (result.errcode) {
    throw new Error(`获取 access_token 失败 [${result.errcode}]: ${result.errmsg}`)
  }
  if (!result.access_token) {
    throw new Error('获取 access_token 失败: 返回数据中无 access_token')
  }
  return result.access_token
}
