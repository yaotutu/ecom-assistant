/**
 * 微信小店上货模块 - 类型定义
 *
 * 本文件定义了微信小店 API 相关的所有类型。
 * 数据来源：微信小店开放平台 API 文档
 * https://developers.weixin.qq.com/doc/store/shop/
 *
 * 设计说明：
 * - ProductInput 是外部模块（如商品信息采集模块）提供给本模块的标准输入格式
 * - AddProductRequest 是微信 API 要求的请求体格式
 * - 本模块负责将 ProductInput 转换为 AddProductRequest 并提交
 */

// ============================================================
// API 基础类型
// ============================================================

/** 微信 API 统一返回结构 */
export interface WechatApiResponse<T = unknown> {
  errcode: number
  errmsg: string
  data?: T
}

// ============================================================
// 图片上传
// ============================================================

/**
 * 上传图片接口的返回数据
 *
 * 注意：
 * - resp_type=1 时返回 img_url（商品相关图片必须用此格式）
 * - 返回的图片链接前缀为 mmecimage.cn/p/，永久有效
 * - 同一张图片无需重复上传
 */
export interface UploadImageResult {
  /** media_id，resp_type=0 时返回 */
  media_id?: string
  /** 支付 media_id，resp_type=0 时返回 */
  pay_media_id?: string
  /** 图片链接（mmecimage.cn/p/ 格式），resp_type=1 时返回 */
  img_url?: string
}

// ============================================================
// 类目相关
// ============================================================

/** 单个类目节点 */
export interface CategoryNode {
  /** 类目 ID */
  cat_id: string
  /** 类目名称 */
  name: string
  /** 父类目 ID（0 表示顶级） */
  f_cat_id: string
  /** 层级：1=一级，2=二级，3+=N 级 */
  level: number
  /** 是否叶子类目（只有叶子类目才能用于添加商品） */
  leaf?: boolean
}

/** 类目 + 资质组合（获取所有类目接口返回） */
export interface CategoryAndQua {
  /** 类目信息 */
  cat: CategoryNode
  /** 该类目下的商品资质要求列表 */
  product_qua_list?: ProductQualification[]
}

/** 获取所有类目接口返回的单个类目条目 */
export interface CategoryItem {
  /** 类目链（从叶子到根的倒序排列） */
  cat_and_qua: CategoryAndQua[]
}

/** 商品资质 */
export interface ProductQualification {
  /** 资质 ID */
  qua_id: string
  /** 是否需要申请 */
  need_to_apply?: boolean
  /** 资质描述/提示信息 */
  tips?: string
  /** 是否必填 */
  mandatory?: boolean
  /** 资质名称 */
  name?: string
}

/** 类目属性（获取类目详情接口返回） */
export interface CategoryAttr {
  /** 是否支持虚拟发货 */
  shop_no_shipment?: boolean
  /** 是否定向准入 */
  access_permit_required?: boolean
  /** 是否支持预售 */
  pre_sale?: boolean
  /** 是否必须支持七天无理由退货 */
  seven_day_return?: boolean
  /** 定准类目品牌列表 */
  brand_list?: Array<{ brand_id: string }>
  /** 类目关联保证金，单位：分 */
  deposit?: number
  /** 产品属性列表（类目必填/选填属性） */
  product_attr_list: CategoryProperty[]
  /** 销售属性列表（SKU 规格属性） */
  sale_attr_list: CategoryProperty[]
  /** 价格下限，单位：分 */
  floor_price?: number
}

/** 类目属性定义（产品属性 & 销售属性共用） */
export interface CategoryProperty {
  /** 属性名称，如 "材质"、"颜色" */
  name: string
  /**
   * 属性类型 v2，共 7 种：
   * - string：文本（自由输入）
   * - select_one：单选（从 value 中选一个）
   * - select_many：多选（从 value 中选多个，用分号 ; 隔开）
   * - integer：整数
   * - decimal4：小数（4 位精度）
   * - integer_unit：整数 + 单位（数值 空格 单位）
   * - decimal4_unit：小数 + 单位
   */
  type_v2: string
  /** 可选项列表（select_one/select_many 时为选项，integer_unit/decimal4_unit 时为单位） */
  value: string
  /** 是否为该类目必填项 */
  is_required: boolean
  /** 输入提示语 */
  hint?: string
  /** 是否允许添加自定义选项（select_one/select_many 时有效） */
  append_allowed?: boolean
}

/** 获取类目详情的返回结构 */
export interface CategoryDetailResponse {
  info: { cat_id: string; name: string }
  attr: CategoryAttr
  product_qua_list: ProductQualification[]
}

// ============================================================
// 运费模板 & 售后地址
// ============================================================

/** 运费模板列表返回 */
export interface FreightTemplateListResponse {
  template_id_list: string[]
  total_num: number
}

/** 售后地址列表返回 */
export interface AfterSaleAddressListResponse {
  address_id_list: string[]
  total_num: number
}

// ============================================================
// 商品输入类型（供外部模块调用）
// ============================================================

/**
 * 商品输入数据 — 上货模块的入口参数
 *
 * 这是商品信息采集模块（待开发）提供给上货模块的标准输入格式。
 * 采集模块负责从各平台（淘宝、1688 等）抓取商品信息，
 * 并转换为此格式后交给本模块上传到微信小店。
 *
 * 使用流程：
 * 1. 采集模块抓取商品数据 → 转换为 ProductInput
 * 2. 本模块上传图片到微信 → 替换为 mmecimage 链接
 * 3. 本模块构建 API 请求体 → 提交到微信小店
 * 4. 可选：自动提交审核上架
 */
export interface ProductInput {
  // ---------- 基本信息 ----------

  /** 商品标题（5-60 字符，不得仅为数字/字母，中文文字/英文字母/数字各算 1 个有效字符） */
  title: string

  /**
   * 商品主图文件路径数组
   * - 最少 3 张（食品饮料和生鲜类目最少 4 张）
   * - 最多 9 张
   * - 不得有重复图片
   * - 支持格式：bmp, jpg, png, webp
   * - 建议尺寸：800x800 以上
   */
  headImagePaths: string[]

  /**
   * 商品详情描述
   * - 不得仅为数字、字母、字符
   */
  description: string

  /**
   * 商品详情图文件路径数组
   * - 最少 1 张（食品饮料和生鲜类目最少 3 张）
   * - 最多 20 张
   */
  descImagePaths: string[]

  // ---------- 类目 & 属性 ----------

  /**
   * 类目 ID 路径（从一级到叶子级）
   * 例如：[545578, 545594, 546178] 表示 家居日用 > 家装软饰 > 钥匙扣
   *
   * 注意：上架后不可修改一级类目
   * 可通过 getAllCategories() 获取可用类目列表
   * 可通过 getCategoryDetail(leafCatId) 查看类目的必填属性
   */
  categoryPath: number[]

  /**
   * 商品属性列表（类目要求的必填/选填属性）
   * 不同类目的必填属性不同，需要通过 getCategoryDetail() 查询
   *
   * 例如钥匙扣类目必填：
   * - { key: "规格", value: "中号" }
   * - { key: "材质", value: "金属" }
   * - { key: "钥匙扣类型", value: "卡通系列" }
   */
  attributes: Array<{ key: string; value: string }>

  // ---------- 物流 ----------

  /**
   * 发货方式：
   * - 0 = 快递发货（需填写 freightTemplateId）
   * - 1 = 无需快递，手机号发货
   * - 3 = 无需快递，可选发货账号类型
   */
  deliverMethod: 0 | 1 | 3

  /**
   * 运费模板 ID（deliverMethod=0 时必填）
   * 可通过 getFreightTemplates() 获取可用模板列表
   */
  freightTemplateId?: string

  // ---------- 品牌 ----------

  /**
   * 品牌 ID
   * - 无品牌填 "2100000000"
   * - 有品牌需先通过品牌资质接口申请
   */
  brandId: string

  // ---------- SKU ----------

  /**
   * SKU 列表（最少 1 个，最多 500 个）
   * 每个 SKU 代表一个规格组合（如：红色-M码）
   */
  skus: SkuInput[]

  // ---------- 售后 & 服务 ----------

  /** 是否支持七天无理由退货（部分类目强制要求） */
  sevenDayReturn: boolean

  /** 是否支持运费险（需商户先开通运费险服务） */
  freightInsurance: boolean

  /**
   * 售后/退货地址 ID
   * 可通过 getAfterSaleAddresses() 获取可用地址列表
   * 不提供时将自动获取列表中第一个地址
   */
  afterSaleAddressId?: number
}

/**
 * SKU 输入数据
 *
 * 每个 SKU 代表商品的一个规格组合，例如：
 * - 颜色：红色 + 尺码：M
 * - 颜色：蓝色 + 尺码：L
 */
export interface SkuInput {
  /** SKU 小图文件路径（本地文件，可选） */
  imagePath?: string

  /**
   * 售卖价格，单位：分
   * 例如 990 表示 9.90 元
   * 不超过 1000000000（1000 万元）
   */
  salePrice: number

  /** 库存数量 */
  stockNum: number

  /** 商家自定义 SKU 编码（最多 100 字符，可选） */
  skuCode?: string

  /** 商家自定义商品编码（最多 128 字符，添加后不可修改，可选） */
  outSkuId?: string

  /** SKU 条形码（可选） */
  barCode?: string

  /**
   * SKU 规格属性
   * 例如：[{ key: "颜色", value: "红色" }, { key: "尺码", value: "M" }]
   * - 同一 key 下不能超过 100 个不同 value
   * - key 最多 40 字符，value 最多 40 字符
   */
  attributes: Array<{ key: string; value: string }>
}

// ============================================================
// 添加商品 API 请求体（微信 API 要求的格式）
// ============================================================

/** 添加商品 API 请求体 */
export interface AddProductRequest {
  /** 商品标题 */
  title: string
  /** 商品主图 URL 列表（mmecimage.cn/p/ 格式） */
  head_imgs: string[]
  /** 商品详情 */
  desc_info: {
    imgs: string[]
    desc: string
  }
  /** 发货方式：0=快递，1=手机号发货，3=可选 */
  deliver_method: number
  /** 发货账号类型（deliver_method=3 时有效）：1=微信openid，2=QQ号，3=手机号，4=邮箱 */
  deliver_acct_type?: number[]
  /** 新版类目（优先使用） */
  cats_v2: Array<{ cat_id: string }>
  /** 商品属性 */
  attrs: Array<{ attr_key: string; attr_value: string }>
  /** 运费信息 */
  express_info?: { template_id: string }
  /** 品牌 ID */
  brand_id: string
  /** 额外服务（七天无理由、运费险等） */
  extra_service: {
    /** 0=不支持，1=支持，2=支持(定制商品除外)，3=支持(使用后不支持) */
    seven_day_return: number
    /** 0=不支持，1=支持 */
    freight_insurance: number
  }
  /** 售后地址信息 */
  after_sale_info?: { after_sale_address_id: number }
  /** SKU 列表 */
  skus: Array<AddProductSku>
  /** 添加后是否立即上架：1=是，0=否（默认） */
  listing?: number
}

/** 添加商品 API 中的 SKU 结构 */
export interface AddProductSku {
  /** SKU 小图 URL（mmecimage.cn/p/ 格式） */
  thumb_img?: string
  /** 售卖价格，单位：分 */
  sale_price: number
  /** 库存 */
  stock_num: number
  /** SKU 编码 */
  sku_code?: string
  /** 商家自定义 SKU ID */
  out_sku_id?: string
  /** 条形码 */
  bar_code?: string
  /** 规格属性 */
  sku_attrs?: Array<{ attr_key: string; attr_value: string }>
  /** 库存信息 */
  sku_deliver_info?: { stock_type: number }
}

// ============================================================
// 添加商品 API 返回
// ============================================================

/** 添加商品成功返回数据 */
export interface AddProductResult {
  /** 商品 ID */
  product_id: string
  /** 创建时间 */
  create_time: string
}

// ============================================================
// 上货结果
// ============================================================

/**
 * 上货操作的最终结果
 *
 * 包含完整的流程执行信息：
 * - 成功时包含 product_id 和各步骤状态
 * - 失败时包含失败步骤和错误信息
 */
export interface ListProductResult {
  /** 是否成功 */
  success: boolean
  /** 商品 ID（添加成功后有值） */
  productId?: string
  /** 创建时间 */
  createTime?: string
  /** 是否已提交上架审核 */
  listed?: boolean
  /** 错误信息（失败时有值） */
  error?: string
  /** 各步骤执行详情 */
  steps: ListProductStep[]
}

/** 单个步骤的执行结果（兼容别名，底层使用统一的 Step 类型） */
export type ListProductStep = import('../core/types').Step

// ============================================================
// 上货选项
// ============================================================

/** 上货配置选项 */
export interface ListProductOptions {
  /**
   * 是否添加后立即提交审核上架
   * 默认 false（仅添加为草稿）
   *
   * 注意：
   * - 上架操作会提交审核，审核通过后草稿数据才会覆盖线上数据
   * - 每店铺每天有提审次数限制
   */
  autoList?: boolean
}
