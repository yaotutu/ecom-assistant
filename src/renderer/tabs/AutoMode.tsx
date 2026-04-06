import { useState } from 'react'
import {
  Card, Input, InputNumber, Button, Table, Space,
  Progress, Collapse, Empty, Tag, message,
} from 'antd'
import { ThunderboltOutlined, PauseOutlined, DownloadOutlined, LinkOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

/** Tab3: 自动模式 — 关键字 → 搜店 → 依次采集 */
const AutoMode = () => {
  const [keyword, setKeyword] = useState('')
  const [topN, setTopN] = useState(5)
  const [minSales, setMinSales] = useState(10)
  const [minPrice, setMinPrice] = useState<number | undefined>(undefined)
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [currentStep, setCurrentStep] = useState(0)
  const [totalSteps, setTotalSteps] = useState(0)

  // 每个店铺的采集结果
  const [results, setResults] = useState<
    { storeName: string; totalInStore: number; filteredCount: number; products: Product[] }[]
  >([])

  const handleStart = () => {
    if (running || !keyword.trim()) return
    // TODO: 自动流程 — 搜索店铺 → 排序 → 依次采集
    setRunning(true)
    setResults([])
    setCurrentStep(0)
    setTotalSteps(0)
    setProgress(`正在搜索「${keyword.trim()}」相关店铺...`)
  }

  const handleStop = () => {
    setRunning(false)
    setProgress('已停止')
    message.warning('自动采集已停止')
  }

  // 商品表格列
  const productColumns: ColumnsType<Product> = [
    { title: '#', width: 48, render: (_, __, i) => i + 1 },
    { title: '商品', dataIndex: 'title', ellipsis: true },
    { title: '价格', dataIndex: 'price', width: 90, render: v => `￥${v}` },
    { title: '销量', dataIndex: 'salesStr', width: 100 },
    {
      title: '操作', width: 64,
      render: (_, r) => <a href={r.link} target="_blank" rel="noreferrer">打开</a>,
    },
  ]

  const totalProducts = results.reduce((s, r) => s + r.filteredCount, 0)

  return (
    <div className="tab-panel">
      {/* 表单 */}
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div className="form-row">
            <span className="field-label">关键字</span>
            <Input
              placeholder="输入商品关键字，自动找店并采集"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onPressEnter={handleStart}
              style={{ flex: 1 }}
            />
          </div>

          <div className="filters">
            <Space>
              <span className="filter-label">店铺 Top</span>
              <InputNumber min={1} max={20} value={topN} onChange={v => setTopN(v ?? 5)} />
            </Space>
            <Space>
              <span className="filter-label">销量 ≥</span>
              <InputNumber min={0} value={minSales} onChange={v => setMinSales(v ?? 0)} />
            </Space>
            <Space>
              <span className="filter-label">价格 ≥ ￥</span>
              <InputNumber
                min={0} step={0.01} placeholder="不限"
                value={minPrice}
                onChange={v => setMinPrice(v ?? undefined)}
              />
            </Space>
            <Space>
              <span className="filter-label">价格 ≤ ￥</span>
              <InputNumber
                min={0} step={0.01} placeholder="不限"
                value={maxPrice}
                onChange={v => setMaxPrice(v ?? undefined)}
              />
            </Space>
          </div>

          <Space>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={running}
              disabled={!keyword.trim()}
              onClick={handleStart}
            >
              {running ? '自动采集中' : '开始自动采集'}
            </Button>
            {running && (
              <Button icon={<PauseOutlined />} danger onClick={handleStop}>
                停止
              </Button>
            )}
          </Space>
        </Space>
      </Card>

      {/* 进度 */}
      {(running || results.length > 0) && (
        <Card style={{ marginBottom: 16 }} size="small">
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500 }}>采集进度</span>
              {totalSteps > 0 && (
                <span style={{ fontSize: 12, color: '#999' }}>
                  {currentStep} / {totalSteps} 家店铺
                </span>
              )}
            </div>
            {totalSteps > 0 && (
              <Progress
                percent={Math.round((currentStep / totalSteps) * 100)}
                size="small"
                status={running ? 'active' : undefined}
              />
            )}
            {progress && <span style={{ fontSize: 12, color: '#666' }}>{progress}</span>}
          </Space>
        </Card>
      )}

      {/* 结果 */}
      {results.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Space>
              <span style={{ fontSize: 16, fontWeight: 600 }}>采集结果</span>
              <Tag color="blue">共 {totalProducts} 个商品</Tag>
            </Space>
            <Space>
              <Button
                icon={<DownloadOutlined />}
                disabled={running}
                onClick={() => message.info('全部导出详情 — 待实现')}
              >
                全部导出详情
              </Button>
              <Button
                icon={<LinkOutlined />}
                disabled={running}
                onClick={() => message.info('全部导出链接 — 待实现')}
              >
                全部导出链接
              </Button>
            </Space>
          </div>

          <Collapse
            items={results.map((r, idx) => ({
              key: r.storeName,
              label: (
                <Space>
                  <Tag color="blue" style={{ borderRadius: '50%' }}>{idx + 1}</Tag>
                  <span style={{ fontWeight: 500 }}>{r.storeName}</span>
                  <span style={{ fontSize: 12, color: '#999' }}>
                    全店 {r.totalInStore} 个 | 筛选后 {r.filteredCount} 个
                  </span>
                </Space>
              ),
              children: r.products.length > 0 ? (
                <Table
                  rowKey="itemId"
                  columns={productColumns}
                  dataSource={r.products}
                  size="small"
                  pagination={false}
                />
              ) : (
                <Empty description="没有符合条件的商品" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ),
            }))}
            defaultActiveKey={results.map(r => r.storeName)}
          />
        </>
      )}

      {!running && results.length === 0 && !progress && (
        <Empty description="输入关键字开始自动采集" />
      )}
    </div>
  )
}

export default AutoMode
