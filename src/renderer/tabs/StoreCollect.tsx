import { useState, useMemo, useCallback } from 'react'
import { Card, Input, InputNumber, Button, Table, Space, message, Empty } from 'antd'
import { SearchOutlined, DownloadOutlined, LinkOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

type SortKey = 'price' | 'sales'

/** Tab1: 店铺采集 — 给定店铺名，采集全店商品 */
const StoreCollect = () => {
  const [storeName, setStoreName] = useState('')
  const [minSales, setMinSales] = useState(10)
  const [minPrice, setMinPrice] = useState<number | undefined>(undefined)
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined)

  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [hasCollected, setHasCollected] = useState(false)

  const [products, setProducts] = useState<Product[]>([])
  const [totalInStore, setTotalInStore] = useState(0)
  const [collectedStore, setCollectedStore] = useState('')

  // 排序状态
  const [sortKey, setSortKey] = useState<SortKey>('sales')
  const [sortAsc, setSortAsc] = useState(false)

  const sortedProducts = useMemo(() => {
    const list = [...products]
    const key = sortKey
    const dir = sortAsc ? 1 : -1
    return list.sort((a, b) => {
      const va = parseFloat(a[key] as string) || 0
      const vb = parseFloat(b[key] as string) || 0
      return (va - vb) * dir
    })
  }, [products, sortKey, sortAsc])

  // ─── 采集 ────────────────────────────────────
  const startCollect = useCallback(async () => {
    if (loading || !storeName.trim()) return
    const name = storeName.trim()
    setLoading(true)
    setHasCollected(false)
    setProducts([])
    setCollectedStore(name)

    const hide = message.loading(`正在采集: ${name}...`, 0)

    try {
      const res = await window.platformAPI.collectStore(name, {
        minSales, minPrice, maxPrice,
      })
      hide()
      setLoading(false)

      if (res.success) {
        setProducts(res.data!.products)
        setTotalInStore(res.data!.totalInStore)
        setHasCollected(true)
        message.success(`采集完成: ${res.data!.totalAfterFilter} 个商品`)
      } else if (res.suggestion) {
        message.error(`连接异常: ${res.error}`)
      } else {
        message.error(`采集失败: ${res.error}`)
      }
    } catch (err: any) {
      hide()
      setLoading(false)
      message.error(`采集异常: ${err.message}`)
    }
  }, [loading, storeName, minSales, minPrice, maxPrice])

  // ─── 导出 ────────────────────────────────────
  const doExport = useCallback(
    async (format: 'detail' | 'links') => {
      if (products.length === 0 || exporting) return
      setExporting(true)
      const label = format === 'detail' ? '详情' : '链接'
      const hide = message.loading(`正在导出${label}...`, 0)

      try {
        const res = await window.platformAPI.export(
          collectedStore,
          JSON.parse(JSON.stringify(products)),
          JSON.parse(JSON.stringify({ minSales, minPrice, maxPrice })),
          format
        )
        hide()
        if (res.success) {
          message.success(`已导出${label}: ${res.filePath}`)
        } else if (res.error !== '已取消') {
          message.error(`导出失败: ${res.error}`)
        }
      } catch (err: any) {
        hide()
        message.error(`导出异常: ${err.message}`)
      } finally {
        setExporting(false)
      }
    },
    [products, exporting, collectedStore, minSales, minPrice, maxPrice]
  )

  // ─── 表格列定义 ──────────────────────────────
  const columns: ColumnsType<Product> = [
    { title: '#', width: 48, render: (_, __, i) => i + 1 },
    {
      title: '商品',
      dataIndex: 'title',
      ellipsis: true,
    },
    {
      title: '价格',
      dataIndex: 'price',
      width: 100,
      sorter: true,
      render: v => `￥${v}`,
    },
    {
      title: '销量',
      dataIndex: 'salesStr',
      width: 120,
      sorter: true,
    },
    {
      title: '操作',
      width: 64,
      render: (_, r) => (
        <a href={r.link} target="_blank" rel="noreferrer">打开</a>
      ),
    },
  ]

  return (
    <div className="tab-panel">
      {/* 表单 */}
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div className="form-row">
            <span className="field-label">店铺名称</span>
            <Input
              placeholder="输入淘宝C店名称，如：惠购日用百货"
              value={storeName}
              onChange={e => setStoreName(e.target.value)}
              onPressEnter={startCollect}
              style={{ flex: 1 }}
            />
          </div>

          <div className="filters">
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
              icon={<SearchOutlined />}
              loading={loading}
              disabled={!storeName.trim()}
              onClick={startCollect}
            >
              {loading ? '采集中' : '开始采集'}
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={products.length === 0 || exporting}
              loading={exporting}
              onClick={() => doExport('detail')}
            >
              导出详情
            </Button>
            <Button
              icon={<LinkOutlined />}
              disabled={products.length === 0 || exporting}
              loading={exporting}
              onClick={() => doExport('links')}
            >
              导出链接
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 结果 */}
      {products.length > 0 && (
        <Card
          title={collectedStore}
          extra={
            <span style={{ fontSize: 12, color: '#999' }}>
              全店 {totalInStore} 个 | 筛选后 {products.length} 个
            </span>
          }
        >
          <Table
            rowKey="itemId"
            columns={columns}
            dataSource={sortedProducts}
            size="small"
            pagination={false}
            onChange={(_p, _f, sorter) => {
              if (!Array.isArray(sorter) && sorter.field) {
                const key = sorter.field as SortKey
                if (sortKey === key) {
                  setSortAsc(asc => !asc)
                } else {
                  setSortKey(key)
                  setSortAsc(false)
                }
              }
            }}
          />
        </Card>
      )}

      {!loading && products.length === 0 && hasCollected && (
        <Empty description="没有符合条件的商品" />
      )}
    </div>
  )
}

export default StoreCollect
