import { useState, useCallback, useEffect } from 'react'
import { ConfigProvider, Layout, Button, Spin, Menu } from 'antd'
import type { MenuProps } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
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
  const [detectCommand, setDetectCommand] = useState('')
  const [copied, setCopied] = useState(false)

  // ─── 手动重新检测 ────────────────
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

  // ─── 跳过检测 ──────────────────
  const skipCheck = useCallback(async () => {
    try {
      const result = await window.platformAPI.skipConnection()
      setConnection({ status: result.status, message: result.message })
    } catch {
      // 忽略
    }
  }, [])

  // ─── 复制检测命令 ──────────────
  const copyCommand = useCallback(() => {
    navigator.clipboard.writeText(detectCommand).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [detectCommand])

  // ─── 订阅心跳推送 ──────────────
  useEffect(() => {
    const unsubscribe = window.platformAPI.onConnectionChange((result) => {
      setConnection({
        status: result.status,
        message: result.message,
        suggestion: result.suggestion,
      })
      if (result.command) {
        setDetectCommand(result.command)
      }
    })

    // 获取当前状态（防止初始推送在订阅前发出导致丢失）
    window.platformAPI.checkConnection().then((result) => {
      setConnection({
        status: result.status,
        message: result.message,
        suggestion: result.suggestion,
      })
    })

    return unsubscribe
  }, [])

  // ─── 全屏检测页面（未连接时显示） ──
  if (connection.status !== 'connected') {
    const isChecking = connection.status === 'checking'

    return (
      <ConfigProvider locale={zhCN}>
        <div className="detect-screen">
          <div className="detect-card">
            {/* Logo + 标题 */}
            <div className="detect-logo">🛒</div>
            <h2 className="detect-title">电商助手</h2>

            {/* 状态提示 */}
            <div className="detect-status">
              {isChecking ? (
                <>
                  <Spin size="large" />
                  <p className="detect-message">{connection.message}</p>
                </>
              ) : (
                <>
                  <CloseCircleOutlined className="detect-error-icon" />
                  <p className="detect-message">{connection.message}</p>
                  {connection.suggestion && (
                    <p className="detect-suggestion">{connection.suggestion}</p>
                  )}
                </>
              )}
            </div>

            {/* 检测命令（供用户手动验证） */}
            {detectCommand && (
              <div className="detect-command-section">
                <div className="detect-command-label">检测命令</div>
                <div className="detect-command-box">
                  <code className="detect-command-text">{detectCommand}</code>
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={copyCommand}
                    className="detect-copy-btn"
                  >
                    {copied ? '已复制' : '复制'}
                  </Button>
                </div>
                <p className="detect-command-hint">
                  可在终端中手动执行此命令，验证淘宝桌面版是否正常运行
                </p>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="detect-actions">
              {!isChecking && (
                <Button type="primary" onClick={recheck}>
                  重新检测
                </Button>
              )}
              <Button type="link" onClick={skipCheck}>
                跳过检测
              </Button>
            </div>
          </div>
        </div>
      </ConfigProvider>
    )
  }

  // ─── 正常界面（已连接） ────────────
  const menuItems: MenuProps['items'] = MENU_ITEMS.map(item => ({
    key: item.key,
    icon: item.icon,
    label: item.label,
  }))

  const ActiveComponent = TAB_COMPONENTS[activeTab]

  return (
    <ConfigProvider locale={zhCN}>
      <Layout className="app-layout">
        {/* ─── 侧边栏 ──────────────────────────── */}
        <Sider className="app-sider" width={180}>
          <div className="sider-header">
            <div className="sider-logo">🛒</div>
            <span className="sider-title">电商助手</span>
          </div>

          <Menu
            mode="inline"
            selectedKeys={[activeTab]}
            onClick={({ key }) => setActiveTab(key as TabKey)}
            items={menuItems}
            className="sider-menu"
          />

          {/* 连接状态（已连接时仅做简单展示） */}
          <div className="sider-footer">
            <div className="conn-connected-simple">
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
              <span>已连接</span>
            </div>
          </div>
        </Sider>

        {/* ─── 内容区 ────────────────────────── */}
        <Content className="app-content">
          <div className="content-header">
            <span className="content-title">
              {MENU_ITEMS.find(m => m.key === activeTab)?.label}
            </span>
          </div>
          <div className="content-body">
            <ActiveComponent />
          </div>
        </Content>
      </Layout>
    </ConfigProvider>
  )
}

export default App
