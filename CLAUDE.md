# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

电商助手（ecom-assistant）是一个基于 Electron + React 19 的桌面工具，通过淘宝桌面版的 native CLI 采集淘宝C店商品数据。提供三种工作模式：
- **店铺采集**：给定店铺名，采集全店商品并按销量/价格过滤导出
- **店铺发现**：输入关键字，搜索该品类最热门的店铺
- **自动模式**：输入关键字，自动搜索热门店铺并依次采集全店商品

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 启动开发模式（electron-vite dev server）
npm run build        # 构建生产版本
npm run typecheck    # TypeScript 类型检查（tsc --noEmit）
```

无测试框架，暂无测试命令。

## 架构

项目采用标准 Electron 三进程架构，使用 electron-vite 构建：

```
src/
├── main/                    # 主进程（Node.js）
│   ├── main.ts              # 窗口创建、应用生命周期
│   └── ipc-handlers.ts      # IPC 通道注册，桥接渲染进程与平台模块
├── preload/                 # 预加载脚本（安全沙箱桥接）
│   └── preload.ts           # contextBridge 暴露 window.platformAPI
├── renderer/                # 渲染进程（React 19 SPA）
│   ├── App.tsx              # 主布局：header + antd Tabs 导航
│   ├── App.css              # 最小化自定义样式（布局、连接状态）
│   ├── main.tsx             # React 应用入口（createRoot）
│   ├── env.d.ts             # 全局类型声明（Product、PlatformAPI、Window）
│   └── tabs/                # 三个标签页组件
│       ├── StoreCollect.tsx  # Tab1: 店铺采集（功能完整）
│       ├── StoreDiscover.tsx # Tab2: 店铺发现（布局就绪，逻辑 TODO）
│       └── AutoMode.tsx      # Tab3: 自动模式（布局就绪，逻辑 TODO）
├── core/                    # 跨平台共享类型
│   └── types.ts             # IPlatform 接口及所有 DTO 类型
└── taobao/                  # 淘宝平台实现
    ├── index.ts             # 统一导出 TaobaoPlatform
    ├── platform.ts          # TaobaoPlatform（IPlatform 实现，组合层）
    ├── connection/
    │   └── native-cli.ts    # NativeCli 封装（调用 taobao-native CLI 二进制）
    └── business/            # 纯函数层，无副作用，无状态
        ├── store-search.ts        # 店铺搜索与排名
        ├── product-collector.ts   # 商品合并、过滤
        ├── sales-parser.ts        # 销量文本解析
        └── data-formatter.ts      # 导出文本格式化
```

### 核心数据流

1. **渲染进程** (App.tsx → tabs/*.tsx) 通过 `window.platformAPI.*` 调用 IPC
2. **IPC Handlers** 接收请求，委托给 `TaobaoPlatform`
3. **TaobaoPlatform** 组合 connection 层（NativeCli）和 business 层（纯函数）
4. **NativeCli** 通过 `execFile` 调用本地 CLI 二进制，解析 JSON 输出

### IPC API（window.platformAPI）

| 方法 | 说明 |
|------|------|
| `checkConnection()` | 连接健康检查 |
| `searchStores(keyword, topN)` | 搜索 TOP 店铺 |
| `collectStore(storeName, filterOptions)` | 采集全店商品 |
| `export(storeName, products, filterOptions, format)` | 导出文件 |

### IPlatform 接口

`src/core/types.ts` 定义了平台无关接口 `IPlatform`，扩展新平台时需实现此接口。

### NativeCli 连接层要点

- 通过 `tryPathsUntil()` 通用回退函数按优先级尝试多个 CLI 路径
- macOS 路径：`taobao-native`（PATH）→ `~/Library/Application Support/taobao/cli/taobao-runner`
- Windows 路径：`taobao-native`（PATH）→ `%APPDATA%\taobao\install-location.txt` 中读取安装目录拼接 `bin\taobao-native.cmd`
- 只在 ENOENT（命令不存在）时回退到下一个路径，其他错误直接抛出
- `_execOnce` 保留原始 Error，不做 `diagnose()` 转换，确保回退逻辑正确匹配 ENOENT
- 执行层未就绪时自动重启桌面版（macOS 用 `osascript quit`，Windows 用 `taskkill`）
- 所有 CLI 调用有 120 秒超时，输出通过临时 JSON 文件或 stdout 传递

## 技术栈

- Electron 34 + electron-vite 3
- React 19（函数式组件 + Hooks）
- Ant Design 6（antd）+ @ant-design/icons 6
- TypeScript 5（strict 模式，jsx: react-jsx）
- electron-builder 打包（macOS DMG/ZIP）

## 编码约定

- 业务逻辑层（`business/`）全部为纯函数，无副作用，无状态
- JS/TS 代码优先使用函数式编程范式
- UI 组件使用 antd 组件库，避免自定义 CSS 实现已有组件
- 中文注释，IPC 通道名采用 `platform:动作` 格式
- 类型定义集中在 `src/core/types.ts`（后端）和 `src/renderer/env.d.ts`（前端），不与实现混放
