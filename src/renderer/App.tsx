import { useState, useCallback, useEffect } from 'react'
import { ConfigProvider, Tabs, Alert, Space, Badge, Button } from 'antd'
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
} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import StoreCollect from './tabs/StoreCollect'
import StoreDiscover from './tabs/StoreDiscover'
import AutoMode from './tabs/AutoMode'
import OneClickList from './tabs/OneClickList'
import './App.css'

// ─── 类型 ──────────────────────────────────────
type ConnectionStatus = 'checking' | 'connected' | 'disconnected' | 'error'

interface ConnectionState {
  status: ConnectionStatus
  message: string
  suggestion?: string
}

// ─── 主组件 ────────────────────────────────────
const App = () => {
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

  // 连接状态颜色
  const connColor = {
    connected: 'success' as const,
    disconnected: 'error' as const,
    error: 'error' as const,
    checking: 'processing' as const,
  }[connection.status]

  const isConnError = connection.status === 'error' || connection.status === 'disconnected'
  const isRestarting = connection.message.includes('重启') || connection.message.includes('恢复')

  return (
    <ConfigProvider locale={zhCN}>
      <div className="app">
        {/* 头部 */}
        <header className="header">
          <h1>电商助手</h1>
          <Badge status={connColor} />
          <span
            className={`conn-status ${connection.status}`}
            onClick={recheck}
            style={{ cursor: 'pointer' }}
          >
            {connIcon} {connection.message}
            {connection.status === 'checking' && (
              <SyncOutlined spin style={{ marginLeft: 4 }} />
            )}
          </span>
        </header>

        {/* 连接失败/恢复中提示 */}
        {isConnError && (
          <Alert
            type={isRestarting ? 'warning' : 'error'}
            message={connection.message}
            description={connection.suggestion}
            showIcon
            action={
              !isRestarting && (
                <Space>
                  <Button type="link" size="small" onClick={recheck}>
                    重新检测
                  </Button>
                </Space>
              )
            }
            style={{ marginBottom: 20 }}
          />
        )}

        {/* 标签页 */}
        {connection.status === 'connected' && (
          <Tabs
            defaultActiveKey="collect"
            items={[
              {
                key: 'collect',
                label: (
                  <span>
                    <ShopOutlined /> 店铺采集
                  </span>
                ),
                children: <StoreCollect />,
              },
              {
                key: 'discover',
                label: (
                  <span>
                    <SearchOutlined /> 店铺发现
                  </span>
                ),
                children: <StoreDiscover />,
              },
              {
                key: 'auto',
                label: (
                  <span>
                    <ThunderboltOutlined /> 自动模式
                  </span>
                ),
                children: <AutoMode />,
              },
              {
                key: 'oneclick',
                label: (
                  <span>
                    <CloudUploadOutlined /> 一键上货
                  </span>
                ),
                children: <OneClickList />,
              },
            ]}
          />
        )}
      </div>
    </ConfigProvider>
  )
}

export default App
