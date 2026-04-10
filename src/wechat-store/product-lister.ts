/**
 * 微信小店上货流程编排
 *
 * 本模块是上货功能的入口，将完整的上货流程串联起来：
 *   1. 上传所有商品图片（主图 + 详情图 + SKU 图）
 *   2. 获取店铺配置（售后地址，如未指定）
 *   3. 构建 AddProductRequest 请求体
 *   4. 调用添加商品 API
 *   5. 可选：调用上架 API 提交审核
 *
 * 对外暴露两个核心函数：
 * - listProductToStore()  — 完整上货流程（推荐使用）
 * - buildProductRequest() — 仅构建请求体（不提交，用于调试/预览）
 *
 * 使用示例：
 * ```ts
 * import { listProductToStore } from './product-lister'
 *
 * const result = await listProductToStore(accessToken, {
 *   title: "商品标题",
 *   headImagePaths: ["/path/to/img1.jpg", "/path/to/img2.jpg", "/path/to/img3.jpg"],
 *   // ... 其他字段
 * })
 *
 * if (result.success) {
 *   console.log(`商品 ${result.productId} 上架成功`)
 * } else {
 *   console.error(`上货失败: ${result.error}`)
 * }
 * ```
 */

import type {
  ProductInput,
  SkuInput,
  AddProductRequest,
  AddProductSku,
  ListProductResult,
  ListProductStep,
  ListProductOptions,
} from './types'
import {
  uploadImage,
  addProduct,
  listProduct,
  getAfterSaleAddresses,
} from './api-client'
import { timed, ok, fail } from '../shared/utils'

// ============================================================
// 图片批量上传
// ============================================================

/**
 * 批量上传图片到微信小店
 *
 * 将本地图片文件逐个上传，返回对应的 mmecimage URL 数组。
 * 上传顺序与输入顺序一致。
 *
 * @param accessToken - 接口调用凭证
 * @param filePaths - 本地图片文件路径数组
 * @param stepName - 步骤名称（用于日志）
 * @returns { urls, steps } — 上传后的 URL 数组和各步骤记录
 * @throws Error 任一图片上传失败时抛出
 */
const uploadImages = async (
  accessToken: string,
  filePaths: string[],
  stepName: string
): Promise<{ urls: string[]; steps: ListProductStep[] }> => {
  const urls: string[] = []
  const steps: ListProductStep[] = []

  for (const filePath of filePaths) {
    const { result: imgUrl, duration } = await timed(() =>
      uploadImage(accessToken, filePath)
    )
    urls.push(imgUrl)
    steps.push(ok(`${stepName}: ${filePath}`, duration, imgUrl))
  }

  return { urls, steps }
}

// ============================================================
// 请求体构建
// ============================================================

/**
 * 将 SKU 输入数据转换为微信 API 格式
 *
 * @param sku - SKU 输入数据
 * @param uploadedThumbUrl - 已上传的 SKU 小图 URL（可选）
 * @returns 微信 API 格式的 SKU 对象
 */
const buildSkuRequest = (
  sku: SkuInput,
  uploadedThumbUrl?: string
): AddProductSku => ({
  thumb_img: uploadedThumbUrl,
  sale_price: sku.salePrice,
  stock_num: sku.stockNum,
  sku_code: sku.skuCode,
  out_sku_id: sku.outSkuId,
  bar_code: sku.barCode,
  sku_attrs: sku.attributes.map((attr) => ({
    attr_key: attr.key,
    attr_value: attr.value,
  })),
  // 默认现货模式
  sku_deliver_info: { stock_type: 0 },
})

/**
 * 构建 AddProductRequest 请求体
 *
 * 将 ProductInput（标准输入格式）转换为微信 API 要求的请求体。
 * 所有图片 URL 必须是已上传的 mmecimage.cn/p/ 格式。
 *
 * 此函数为纯函数，不做任何网络请求，适合用于：
 * - 调试预览请求体
 * - 单元测试数据构建
 * - 自定义提交流程
 *
 * @param input - 商品标准输入数据
 * @param uploadedData - 已上传的图片 URL 映射
 * @returns 微信 API 格式的添加商品请求体
 *
 * @example
 * const req = buildProductRequest(input, {
 *   headImgUrls: ["https://mmecimage.cn/p/..."],
 *   descImgUrls: ["https://mmecimage.cn/p/..."],
 *   skuImgUrls: { 0: "https://mmecimage.cn/p/..." },
 *   afterSaleAddressId: 87607600002,
 * })
 */
export const buildProductRequest = (
  input: ProductInput,
  uploadedData: {
    /** 已上传的主图 URL 列表（与 headImagePaths 一一对应） */
    headImgUrls: string[]
    /** 已上传的详情图 URL 列表（与 descImagePaths 一一对应） */
    descImgUrls: string[]
    /** 已上传的 SKU 小图 URL（按 SKU 索引映射，索引与 skus 数组对应） */
    skuImgUrls: Record<number, string>
    /** 售后地址 ID */
    afterSaleAddressId: number
  }
): AddProductRequest => {
  // 构建 SKU 列表
  const skuRequests: AddProductSku[] = input.skus.map((sku, index) =>
    buildSkuRequest(sku, uploadedData.skuImgUrls[index])
  )

  return {
    title: input.title,
    head_imgs: uploadedData.headImgUrls,
    desc_info: {
      imgs: uploadedData.descImgUrls,
      desc: input.description,
    },
    deliver_method: input.deliverMethod,
    cats_v2: input.categoryPath.map((catId) => ({
      cat_id: String(catId),
    })),
    attrs: input.attributes.map((attr) => ({
      attr_key: attr.key,
      attr_value: attr.value,
    })),
    express_info: input.freightTemplateId
      ? { template_id: input.freightTemplateId }
      : undefined,
    brand_id: input.brandId,
    extra_service: {
      seven_day_return: input.sevenDayReturn ? 1 : 0,
      freight_insurance: input.freightInsurance ? 1 : 0,
    },
    after_sale_info: {
      after_sale_address_id: uploadedData.afterSaleAddressId,
    },
    skus: skuRequests,
  }
}

// ============================================================
// 核心上货流程
// ============================================================

/**
 * 完整的微信小店上货流程
 *
 * 编排以下步骤：
 * 1. 上传主图（3-9 张）
 * 2. 上传详情图（1-20 张）
 * 3. 上传 SKU 小图（有则上传）
 * 4. 获取售后地址（如未指定）
 * 5. 构建请求体
 * 6. 提交添加商品
 * 7. 可选：提交审核上架
 *
 * @param accessToken - 接口调用凭证（由调用方管理 token 获取和刷新）
 * @param input - 商品标准输入数据
 * @param options - 上货选项（是否自动上架等）
 * @returns 上货结果（含各步骤详情）
 *
 * @example
 * const result = await listProductToStore(token, {
 *   title: "创意金属钥匙扣",
 *   headImagePaths: ["/imgs/1.jpg", "/imgs/2.jpg", "/imgs/3.jpg"],
 *   description: "创意金属钥匙扣，品质保证",
 *   descImagePaths: ["/imgs/detail1.jpg"],
 *   categoryPath: [545578, 545594, 546178],
 *   deliverMethod: 0,
 *   freightTemplateId: "979080438004",
 *   brandId: "2100000000",
 *   attributes: [
 *     { key: "规格", value: "中号" },
 *     { key: "材质", value: "金属" },
 *     { key: "钥匙扣类型", value: "卡通系列" },
 *   ],
 *   skus: [
 *     { salePrice: 990, stockNum: 100, attributes: [{ key: "颜色", value: "银色" }] },
 *   ],
 *   sevenDayReturn: true,
 *   freightInsurance: false,
 * })
 */
export const listProductToStore = async (
  accessToken: string,
  input: ProductInput,
  options?: ListProductOptions
): Promise<ListProductResult> => {
  const steps: ListProductStep[] = []
  const pushStep = (step: ListProductStep) => steps.push(step)

  try {
    // ---- 步骤 1：上传主图 ----
    const { result: headImgUploaded } = await timed(() =>
      uploadImages(accessToken, input.headImagePaths, '上传主图')
    )
    const headImgUrls = headImgUploaded.urls
    headImgUploaded.steps.forEach(pushStep)

    // ---- 步骤 2：上传详情图 ----
    const { result: descImgUploaded } = await timed(() =>
      uploadImages(accessToken, input.descImagePaths, '上传详情图')
    )
    const descImgUrls = descImgUploaded.urls
    descImgUploaded.steps.forEach(pushStep)

    // ---- 步骤 3：上传 SKU 小图（有图片的 SKU 才上传） ----
    const skuImgUrls: Record<number, string> = {}
    for (let i = 0; i < input.skus.length; i++) {
      const sku = input.skus[i]
      if (sku.imagePath) {
        const { result: url, duration } = await timed(() =>
          uploadImage(accessToken, sku.imagePath!)
        )
        skuImgUrls[i] = url
        pushStep(ok(`上传 SKU 图 #${i}`, duration, url))
      }
    }

    // ---- 步骤 4：获取售后地址（如未指定） ----
    let afterSaleAddressId = input.afterSaleAddressId
    if (!afterSaleAddressId) {
      const { result: addresses, duration } = await timed(() =>
        getAfterSaleAddresses(accessToken)
      )
      if (addresses.length === 0) {
        throw new Error('未指定售后地址且店铺没有可用的售后地址，请先在微信小店后台添加售后地址')
      }
      afterSaleAddressId = Number(addresses[0])
      pushStep(ok('获取售后地址', duration, `使用地址 ID: ${afterSaleAddressId}`))
    }

    // ---- 步骤 5：构建请求体 ----
    const requestBody = buildProductRequest(input, {
      headImgUrls,
      descImgUrls,
      skuImgUrls,
      afterSaleAddressId,
    })
    pushStep(ok('构建请求体', 0))

    // ---- 步骤 6：提交添加商品 ----
    const { result: addResult, duration: addDuration } = await timed(() =>
      addProduct(accessToken, requestBody)
    )
    pushStep(ok('添加商品', addDuration, `product_id: ${addResult.product_id}`))

    // ---- 步骤 7：可选 - 提交审核上架 ----
    let listed = false
    if (options?.autoList) {
      const { duration: listDuration } = await timed(() =>
        listProduct(accessToken, addResult.product_id)
      )
      listed = true
      pushStep(ok('提交上架审核', listDuration))
    }

    return {
      success: true,
      productId: addResult.product_id,
      createTime: addResult.create_time,
      listed,
      steps,
    }
  } catch (err) {
    // 捕获异常，返回失败结果
    const errorMsg = err instanceof Error ? err.message : String(err)
    pushStep(fail('上货流程', 0, errorMsg))

    return {
      success: false,
      error: errorMsg,
      steps,
    }
  }
}
