import { useState, useCallback, useEffect } from 'react'
import {
  Card, Input, InputNumber, Button, Space, message, Steps, Descriptions,
  Image, Collapse, Switch, Tag, Empty, Spin, Divider, Typography, Alert,
  Badge, Tooltip,
} from 'antd'
import {
  LinkOutlined, CloudUploadOutlined, EyeOutlined,
  CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined,
  SettingOutlined, UserOutlined, LogoutOutlined, LoginOutlined,
} from '@ant-design/icons'

const { Text, Paragraph } = Typography

// ─── 类型 ──────────────────────────────────────

/** 淘宝商品详情（从 IPC 返回） */
interface TaobaoDetail {
  title: string
  itemId: string
  price: string
  shopName: string
  description: string
  headImageUrls: string[]
  descImageUrls: string[]
  skus: Array<{
    attributes: Array<{ key: string; value: string }>
    price: string
    stock?: number
    imageUrl?: string
  }>
  sourceUrl: string
}

/** CLI 原始数据源（调试用） */
interface RawDataSource {
  pageContent: string
  elementsData: any
  skuData: any
}

/** 上货步骤执行记录 */
interface StepRecord {
  name: string
  success: boolean
  duration: number
  detail?: string
}

// ─── 组件 ──────────────────────────────────────

/** Tab: 一键上货 — 淘宝商品 → 微信小店 */
const OneClickList = () => {
  // ─── 输入状态 ──────────────────────────────
  const [taobaoUrl, setTaobaoUrl] = useState('')
  const [freightTemplateId, setFreightTemplateId] = useState<number>(1)
  const [defaultStock, setDefaultStock] = useState(100)
  const [autoList, setAutoList] = useState(false)

  // ─── 淘宝登录状态 ──────────────────────────────
  const [taobaoLoggedIn, setTaobaoLoggedIn] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(true)

  // ─── 流程状态 ──────────────────────────────
  const [fetching, setFetching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [detail, setDetail] = useState<TaobaoDetail | null>(null)
  const [rawData, setRawData] = useState<RawDataSource | null>(null)
  const [uploadSteps, setUploadSteps] = useState<StepRecord[]>([])
  const [fetchSteps, setFetchSteps] = useState<StepRecord[]>([])
  const [productId, setProductId] = useState<string | null>(null)

  const hasDetail = !!detail
  const canUpload = hasDetail && !uploading

  // ─── 检查淘宝登录状态 ──────────────────────────────
  const checkLogin = useCallback(async () => {
    setCheckingLogin(true)
    try {
      const loggedIn = await window.platformAPI.checkTaobaoLogin()
      setTaobaoLoggedIn(loggedIn)
    } catch {
      setTaobaoLoggedIn(false)
    } finally {
      setCheckingLogin(false)
    }
  }, [])

  // 组件挂载时检查登录状态
  useEffect(() => {
    checkLogin()
  }, [checkLogin])

  // ─── 登录/登出操作 ──────────────────────────────
  const handleLogin = useCallback(async () => {
    const success = await window.platformAPI.taobaoLogin()
    if (success) {
      setTaobaoLoggedIn(true)
      message.success('淘宝登录成功')
    } else {
      message.info('已取消登录')
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await window.platformAPI.taobaoLogout()
    setTaobaoLoggedIn(false)
    message.success('已退出淘宝登录')
  }, [])

  // ─── 转换选项（固定默认值，后续可扩展为可配置） ──
  const transformOptions = {
    categoryPath: [[789, '家居生活'], [790, '日用杂物']] as [number, string][],
    freightTemplateId,
    defaultStock,
  }

  // ─── 步骤 1：获取淘宝商品详情 ──────────────
  const handleFetch = useCallback(async () => {
    if (fetching || !taobaoUrl.trim()) return

    // 检查淘宝登录状态
    if (!taobaoLoggedIn) {
      message.warning('请先登录淘宝账号')
      return
    }

    setFetching(true)
    setDetail(null)
    setRawData(null)
    setFetchSteps([])
    setUploadSteps([])
    setProductId(null)

    const hide = message.loading('正在获取商品详情...', 0)

    try {
      const res = await window.platformAPI.fetchProductDetail(taobaoUrl.trim())
      hide()

      if (res.success && res.data) {
        setDetail(res.data.detail)
        setRawData(res.data.rawData ?? null)
        setFetchSteps(res.data.steps ?? [])
        message.success(`获取成功: ${res.data.detail.title}`)
      } else {
        setFetchSteps(res.data?.steps ?? [])
        message.error(res.error ?? '获取商品详情失败')
      }
    } catch (err: any) {
      hide()
      message.error(`获取异常: ${err.message}`)
    } finally {
      setFetching(false)
    }
  }, [fetching, taobaoUrl, taobaoLoggedIn])

  // ─── 步骤 2：上货到微信小店 ─────────────────
  const handleUpload = useCallback(async () => {
    if (!canUpload) return
    setUploading(true)
    setUploadSteps([])
    setProductId(null)

    const hide = message.loading('正在上货到微信小店...', 0)

    try {
      const res = await window.platformAPI.taobaoToWechat(
        taobaoUrl.trim(),
        transformOptions,
        { autoList }
      )
      hide()

      if (res.success && res.data) {
        setUploadSteps(res.data.steps)
        setProductId(res.data.productId)
        message.success(
          `上货成功! 商品ID: ${res.data.productId}`
          + (res.data.autoListed ? ' (已提交上架审核)' : '')
        )
      } else {
        if (res.data?.steps) {
          setUploadSteps(res.data.steps)
        }
        message.error(res.error ?? '上货失败')
      }
    } catch (err: any) {
      hide()
      message.error(`上货异常: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }, [canUpload, taobaoUrl, freightTemplateId, defaultStock, autoList])

  // ─── 一键执行（获取 + 上货） ──────────────
  const handleOneClick = useCallback(async () => {
    if (!taobaoUrl.trim()) return

    // 检查淘宝登录状态
    if (!taobaoLoggedIn) {
      message.warning('请先登录淘宝账号')
      return
    }

    setUploading(true)
    setFetching(true)
    setDetail(null)
    setUploadSteps([])
    setProductId(null)

    const hide = message.loading('一键上货中，请稍候...', 0)

    try {
      const res = await window.platformAPI.taobaoToWechat(
        taobaoUrl.trim(),
        transformOptions,
        { autoList }
      )
      hide()
      setFetching(false)

      if (res.success && res.data) {
        setUploadSteps(res.data.steps)
        setProductId(res.data.productId)
        message.success(`一键上货成功! 商品ID: ${res.data.productId}`)
      } else {
        if (res.data?.steps) {
          setUploadSteps(res.data.steps)
        }
        message.error(res.error ?? '上货失败')
      }
    } catch (err: any) {
      hide()
      message.error(`上货异常: ${err.message}`)
    } finally {
      setFetching(false)
      setUploading(false)
    }
  }, [taobaoUrl, freightTemplateId, defaultStock, autoList, taobaoLoggedIn])

  return (
    <div className="tab-panel">
      {/* ─── 淘宝登录状态栏 ──────────────────── */}
      <Alert
        type={taobaoLoggedIn ? 'success' : 'warning'}
        message={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space>
              <Badge status={taobaoLoggedIn ? 'success' : 'warning'} />
              <span>
                {checkingLogin
                  ? '检测登录状态中...'
                  : taobaoLoggedIn
                    ? '淘宝已登录，可以获取商品详情'
                    : '请先登录淘宝账号以获取商品详情'}
              </span>
            </Space>
            <Space>
              {taobaoLoggedIn ? (
                <Button
                  size="small"
                  icon={<LogoutOutlined />}
                  onClick={handleLogout}
                >
                  退出登录
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="small"
                  icon={<LoginOutlined />}
                  loading={checkingLogin}
                  onClick={handleLogin}
                >
                  登录淘宝
                </Button>
              )}
              <Tooltip title="刷新登录状态">
                <Button
                  size="small"
                  icon={<UserOutlined />}
                  onClick={checkLogin}
                  loading={checkingLogin}
                />
              </Tooltip>
            </Space>
          </div>
        }
        showIcon={false}
        style={{ marginBottom: 16 }}
      />

      {/* ─── 环境变量提示 ─────────────────────── */}
      <Alert
        type="info"
        message="微信小店凭证从 .env 文件自动读取"
        description="请在项目根目录 .env 中配置 WECHAT_STORE_APPID 和 WECHAT_STORE_SECRET，access_token 将自动获取。"
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* ─── 输入区 ─────────────────────────── */}
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {/* 淘宝商品链接 */}
          <div className="form-row">
            <span className="field-label">商品链接</span>
            <Input
              placeholder="粘贴淘宝商品链接，如 https://item.taobao.com/item.htm?id=123456"
              value={taobaoUrl}
              onChange={e => setTaobaoUrl(e.target.value)}
              onPressEnter={handleFetch}
              prefix={<LinkOutlined />}
              style={{ flex: 1 }}
            />
          </div>

          {/* 高级设置 */}
          <Collapse
            size="small"
            items={[{
              key: 'settings',
              label: <span><SettingOutlined /> 高级设置</span>,
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  <div className="form-row">
                    <span className="field-label" style={{ minWidth: 80 }}>运费模板ID</span>
                    <InputNumber
                      min={1}
                      value={freightTemplateId}
                      onChange={v => setFreightTemplateId(v ?? 1)}
                      style={{ width: 160 }}
                    />
                  </div>
                  <div className="form-row">
                    <span className="field-label" style={{ minWidth: 80 }}>默认库存</span>
                    <InputNumber
                      min={1}
                      value={defaultStock}
                      onChange={v => setDefaultStock(v ?? 100)}
                      style={{ width: 160 }}
                    />
                  </div>
                  <div className="form-row">
                    <span className="field-label" style={{ minWidth: 80 }}>自动上架审核</span>
                    <Switch
                      checked={autoList}
                      onChange={setAutoList}
                      checkedChildren="是"
                      unCheckedChildren="否"
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      开启后商品创建后自动提交上架审核
                    </Text>
                  </div>
                </Space>
              ),
            }]}
          />

          {/* 操作按钮 */}
          <Space>
            <Button
              icon={<EyeOutlined />}
              loading={fetching}
              disabled={!taobaoUrl.trim() || uploading || !taobaoLoggedIn}
              onClick={handleFetch}
            >
              {fetching ? '获取中' : '获取详情'}
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              loading={uploading}
              disabled={!canUpload}
              onClick={handleUpload}
            >
              {uploading ? '上货中' : '上货到微信'}
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              loading={uploading || fetching}
              disabled={!taobaoUrl.trim() || !taobaoLoggedIn}
              onClick={handleOneClick}
              style={{ background: '#722ed1', borderColor: '#722ed1' }}
            >
              一键上货
            </Button>
          </Space>
        </Space>
      </Card>

      {/* ─── 商品预览 ───────────────────────── */}
      {detail && (
        <Card
          title="商品预览"
          style={{ marginBottom: 16 }}
          extra={<Tag color="blue">{detail.shopName}</Tag>}
        >
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="商品标题" span={2}>
              <Paragraph copyable style={{ margin: 0 }}>{detail.title}</Paragraph>
            </Descriptions.Item>
            <Descriptions.Item label="商品ID">
              {detail.itemId}
            </Descriptions.Item>
            <Descriptions.Item label="价格">
              <Text strong style={{ color: '#f50', fontSize: 16 }}>
                ¥{detail.price}
              </Text>
            </Descriptions.Item>
          </Descriptions>

          {/* 主图预览 */}
          {detail.headImageUrls.length > 0 && (
            <>
              <Divider style={{ fontSize: 13, margin: '12px 0' }}>
                主图 ({detail.headImageUrls.length})
              </Divider>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {detail.headImageUrls.slice(0, 9).map((url, i) => (
                  <Image
                    key={i}
                    src={url}
                    width={80}
                    height={80}
                    style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #f0f0f0' }}
                    fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN88P/BfwAJhAPk2iJi2AAAAABJRU5ErkJggg=="
                  />
                ))}
                {detail.headImageUrls.length > 9 && (
                  <Tag style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    +{detail.headImageUrls.length - 9}
                  </Tag>
                )}
              </div>
            </>
          )}

          {/* SKU 列表 */}
          {detail.skus.length > 0 && (
            <>
              <Divider style={{ fontSize: 13, margin: '12px 0' }}>
                SKU 规格 ({detail.skus.length})
              </Divider>
              <Space wrap>
                {detail.skus.map((sku, i) => (
                  <Tag key={i} color="blue">
                    {sku.attributes.map(a => `${a.key}:${a.value}`).join(' / ')}
                    {' — ¥'}{sku.price}
                    {sku.stock !== undefined && ` (库存:${sku.stock})`}
                  </Tag>
                ))}
              </Space>
            </>
          )}

          {/* 详情图数量 */}
          {detail.descImageUrls.length > 0 ? (
            <>
              <Divider style={{ fontSize: 13, margin: '12px 0' }}>
                详情图 ({detail.descImageUrls.length} 张)
              </Divider>
              <Text type="secondary">上货时将自动下载并上传到微信小店</Text>
            </>
          ) : (
            <>
              <Divider style={{ fontSize: 13, margin: '12px 0' }}>
                详情图 (0 张)
              </Divider>
              <Text type="warning">淘宝详情图需要滚动加载，当前未获取到。上货时将自动用主图兜底。</Text>
            </>
          )}
        </Card>
      )}

      {/* ─── 获取步骤日志 ────────────────────── */}
      {fetchSteps.length > 0 && (
        <Card title="获取步骤" size="small" style={{ marginBottom: 16 }}>
          <Steps
            direction="vertical"
            size="small"
            current={fetchSteps.length}
            items={fetchSteps.map((step) => ({
              title: step.name,
              description: (
                <Space>
                  <Text type="secondary">{step.duration}ms</Text>
                  {step.detail && <Text type="secondary">{step.detail}</Text>}
                  {step.success
                    ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                  }
                </Space>
              ),
              status: step.success ? 'finish' : 'error',
            }))}
          />
        </Card>
      )}

      {/* ─── 原始数据（调试用） ──────────────── */}
      {rawData && (
        <Card title="原始数据（调试）" style={{ marginBottom: 16 }}>
          <Collapse
            size="small"
            items={[
              {
                key: 'sku',
                label: `SKU 数据 (get_product_skus)`,
                children: (
                  <pre style={{
                    background: '#f5f5f5', padding: 12, borderRadius: 6,
                    fontSize: 12, maxHeight: 400, overflow: 'auto',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {rawData.skuData
                      ? JSON.stringify(rawData.skuData, null, 2)
                      : '(无数据)'}
                  </pre>
                ),
              },
              {
                key: 'elements',
                label: `页面元素 (scan_page_elements)`,
                children: (
                  <pre style={{
                    background: '#f5f5f5', padding: 12, borderRadius: 6,
                    fontSize: 12, maxHeight: 400, overflow: 'auto',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {rawData.elementsData
                      ? JSON.stringify(rawData.elementsData, null, 2)
                      : '(无数据)'}
                  </pre>
                ),
              },
              {
                key: 'pageContent',
                label: `页面文本 (readFullPageContent) — ${rawData.pageContent.length} 字符`,
                children: (
                  <pre style={{
                    background: '#f5f5f5', padding: 12, borderRadius: 6,
                    fontSize: 12, maxHeight: 500, overflow: 'auto',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {rawData.pageContent || '(无数据)'}
                  </pre>
                ),
              },
            ]}
          />
        </Card>
      )}

      {/* ─── 上货进度 ───────────────────────── */}
      {(uploadSteps.length > 0 || uploading) && (
        <Card title="上货进度" style={{ marginBottom: 16 }}>
          {uploadSteps.length > 0 ? (
            <>
              <Steps
                direction="vertical"
                size="small"
                current={uploadSteps.length}
                items={uploadSteps.map((step) => ({
                  title: step.name,
                  description: (
                    <Space>
                      <Text type="secondary">{step.duration}ms</Text>
                      {step.detail && <Text type="secondary">{step.detail}</Text>}
                      {step.success
                        ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      }
                    </Space>
                  ),
                  status: step.success ? 'finish' : 'error',
                }))}
              />
              {productId && (
                <>
                  <Divider />
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label="微信商品ID">
                      <Text copyable strong>{productId}</Text>
                    </Descriptions.Item>
                  </Descriptions>
                </>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Spin indicator={<LoadingOutlined />} />
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">正在执行上货流程...</Text>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ─── 空状态 ─────────────────────────── */}
      {!detail && !fetching && uploadSteps.length === 0 && (
        <Empty
          description="粘贴淘宝商品链接，获取详情后一键上货到微信小店"
          style={{ marginTop: 40 }}
        />
      )}
    </div>
  )
}

export default OneClickList
