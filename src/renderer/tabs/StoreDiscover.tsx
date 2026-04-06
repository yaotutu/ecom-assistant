import { useState } from 'react'
import { Card, Input, InputNumber, Button, Table, Space, message, Empty, Tag } from 'antd'
import { SearchOutlined, ShopOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

interface StoreRow {
  name: string
  productCount: number
  shopUrl: string
}

/** Tab2: 店铺发现 — 输入关键字，搜索最热门的店铺 */
const StoreDiscover = () => {
  const [keyword, setKeyword] = useState('')
  const [topN, setTopN] = useState(10)
  const [loading, setLoading] = useState(false)
  const [stores, setStores] = useState<StoreRow[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  const handleSearch = async () => {
    if (loading || !keyword.trim()) return
    setLoading(true)
    setHasSearched(false)
    setStores([])

    const hide = message.loading(`正在搜索「${keyword.trim()}」相关店铺...`, 0)

    try {
      const res = await window.platformAPI.searchStores(keyword.trim(), topN)
      hide()
      setLoading(false)
      setHasSearched(true)

      if (res.success) {
        setStores(res.data.stores)
        message.success(`找到 ${res.data.stores.length} 家店铺`)
      } else {
        message.error(res.error || '搜索失败')
      }
    } catch (err: any) {
      hide()
      setLoading(false)
      setHasSearched(true)
      message.error(`搜索异常: ${err.message}`)
    }
  }

  // ─── 表格列 ──────────────────────────────────
  const columns: ColumnsType<StoreRow> = [
    {
      title: '#',
      width: 48,
      render: (_, __, i) => (
        <Tag color="blue" style={{ borderRadius: '50%' }}>{i + 1}</Tag>
      ),
    },
    {
      title: '店铺名称',
      dataIndex: 'name',
      ellipsis: true,
    },
    {
      title: '商品数',
      dataIndex: 'productCount',
      width: 100,
    },
    {
      title: '操作',
      width: 120,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<ShopOutlined />}
            onClick={() => {
              // TODO: 跳转到店铺采集，或直接触发采集
              message.info(`采集「${r.name}」功能待实现`)
            }}
          >
            采集此店
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div className="tab-panel">
      {/* 表单 */}
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div className="form-row">
            <span className="field-label">关键字</span>
            <Input
              placeholder="输入商品关键字，如：收纳盒、手机壳"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onPressEnter={handleSearch}
              style={{ flex: 1 }}
            />
          </div>

          <div className="filters">
            <Space>
              <span className="filter-label">搜索数量 Top</span>
              <InputNumber min={1} max={50} value={topN} onChange={v => setTopN(v ?? 10)} />
            </Space>
          </div>

          <Space>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={loading}
              disabled={!keyword.trim()}
              onClick={handleSearch}
            >
              {loading ? '搜索中' : '搜索店铺'}
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 结果 */}
      {stores.length > 0 && (
        <Card
          title="搜索结果"
          extra={
            <span style={{ fontSize: 12, color: '#999' }}>
              找到 {stores.length} 家店铺
            </span>
          }
        >
          <Table
            rowKey="name"
            columns={columns}
            dataSource={stores}
            size="small"
            pagination={false}
          />
        </Card>
      )}

      {!loading && stores.length === 0 && hasSearched && (
        <Empty description="没有找到符合条件的店铺" />
      )}
    </div>
  )
}

export default StoreDiscover
