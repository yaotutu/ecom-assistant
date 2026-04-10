import { useState, useCallback, useEffect } from 'react'
import { ConfigProvider, Layout, Menu, Alert, Badge, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  SyncOutlined,
  ShopOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  CloudUploadOutlined,
  ChromeOutlined,
} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import StoreCollect from './tabs/StoreCollect'
import StoreDiscover from './tabs/StoreDiscover'
import AutoMode from './tabs/AutoMode'
import OneClickList from './tabs/OneClickList'
import TaobaoBrowser from './tabs/TaobaoBrowser'
import './App.css'

const { Sider, Content } = Layout

// ─── 类型 ──────────────────────────────────────
type ConnectionStatus = 'checking' | 'connected' | 'disconnected' | 'error'

interface ConnectionState {
  status: ConnectionStatus
  message: string
  suggestion?: string
}

/** 侧边栏菜单项 key */
type TabKey = 'collect' | 'discover' | 'auto' | 'oneclick' | 'browser'

/** 侧边栏菜单配置 */
const MENU_ITEMS: { key: TabKey; icon: React.ReactNode; label: string }[] = [
  { key: 'collect',  icon: <ShopOutlined />,       label: '店铺采集' },
  { key: 'discover', icon: <SearchOutlined />,      label: '店铺发现' },
  { key: 'auto',     icon: <ThunderboltOutlined />, label: '自动模式' },
  { key: 'oneclick', icon: <CloudUploadOutlined />, label: '一键上货' },
  { key: 'browser',  icon: <ChromeOutlined />,      label: '淘宝浏览器' },
]

/** 菜单 key → 组件映射 */
const TAB_COMPONENTS: Record<TabKey, React.FC> = {
  collect:  StoreCollect,
  discover: StoreDiscover,
  auto:     AutoMode,
  oneclick: OneClickList,
  browser:  TaobaoBrowser,
}

// ─── 主组件 ────────────────────────────────────
const App = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('collect')
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'checking',
    message: '正在检测淘宝桌面版连接...',
  })

  // ─── 手动重新检测（fallback） ────────────────
  const recheck = useCallback(async () => {
    setConnection({ status: 'checking', message: '正在检测淘宝桌面版连接...' })
    try {
      const result = await window.platformAPI.checkConnection()
      setConnection(result)
    } catch (err: any) {
      setConnection({
        status: 'error',
        message: `检测失败: ${err.message}`,
        suggestion: '请确认淘宝桌面版已安装并正在运行。',
      })
    }
  }, [])

  // ─── 订阅心跳推送（核心：主进程自动管理连接状态） ──
  useEffect(() => {
    const unsubscribe = window.platformAPI.onConnectionChange((result) => {
      setConnection({
        status: result.status,
        message: result.message,
        suggestion: result.suggestion,
      })
    })

    return unsubscribe
  }, [])

  // 连接状态图标
  const connIcon = {
    connected: <CheckCircleOutlined />,
    disconnected: <CloseCircleOutlined />,
    error: <ExclamationCircleOutlined />,
    checking: <LoadingOutlined />,
  }[connection.status]

  // 连接状态文本
  const connText = {
    connected: '已连接',
    disconnected: '未连接',
    error: '连接异常',
    checking: '检测中',
  }[connection.status]

  const isConnError = connection.status === 'error' || connection.status === 'disconnected'

  // ─── 侧边栏菜单 ──────────────────────────────
  const menuItems: MenuProps['items'] = MENU_ITEMS.map(item => ({
    key: item.key,
    icon: item.icon,
    label: item.label,
  }))

  // 当前激活的标签页组件
  const ActiveComponent = TAB_COMPONENTS[activeTab]

  return (
    <ConfigProvider locale={zhCN}>
      <Layout className="app-layout">
        {/* ─── 侧边栏 ──────────────────────────── */}
        <Sider className="app-sider" width={180}>
          {/* Logo + 标题 */}
          <div className="sider-header">
            <div className="sider-logo">🛒</div>
            <span className="sider-title">电商助手</span>
          </div>

          {/* 导航菜单 */}
          <Menu
            mode="inline"
            selectedKeys={[activeTab]}
            onClick={({ key }) => setActiveTab(key as TabKey)}
            items={menuItems}
            className="sider-menu"
          />

          {/* 底部连接状态 */}
          <div className="sider-footer">
            <Tooltip title={connection.message + (connection.suggestion ? ` ${connection.suggestion}` : '')}>
              <div
                className={`conn-badge conn-${connection.status}`}
                onClick={recheck}
              >
                <Badge status={
                  connection.status === 'connected' ? 'success' :
                  connection.status === 'checking' ? 'processing' : 'error'
                } />
                <span className="conn-label">
                  {connIcon} {connText}
                </span>
                {connection.status === 'checking' && <SyncOutlined spin style={{ fontSize: 10 }} />}
              </div>
            </Tooltip>
          </div>
        </Sider>

        {/* ─── 内容区 ────────────────────────── */}
        <Content className="app-content">
          {/* 顶部标题栏 */}
          <div className="content-header">
            <span className="content-title">
              {MENU_ITEMS.find(m => m.key === activeTab)?.label}
            </span>
          </div>

          {/* 连接失败提示 */}
          {isConnError && (
            <div className="content-body">
              <Alert
                type="error"
                message={connection.message}
                description={connection.suggestion}
                showIcon
                action={
                  <a onClick={recheck}>重新检测</a>
                }
              />
            </div>
          )}

          {/* 标签页内容 */}
          {connection.status === 'connected' && (
            <div className="content-body">
              <ActiveComponent />
            </div>
          )}
        </Content>
      </Layout>
    </ConfigProvider>
  )
}

export default App
