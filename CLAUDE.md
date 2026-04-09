# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

电商助手（ecom-assistant）是一个基于 Electron + React 19 的桌面工具，提供两大核心功能：
1. **淘宝数据采集**：通过淘宝桌面版的 native CLI 采集淘宝C店商品数据
   - **店铺采集**：给定店铺名，采集全店商品并按销量/价格过滤导出
   - **店铺发现**：输入关键字，搜索该品类最热门的店铺
   - **自动模式**：输入关键字，自动搜索热门店铺并依次采集全店商品
2. **微信小店里货**：将采集到的商品数据上传到微信小店
   - 通过微信小店 REST API 完成图片上传、商品创建、审核上架的全流程

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
│   └── ipc-handlers.ts      # IPC 通道注册 + 心跳启动 + 状态推送 + 退出清理
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
├── taobao/                  # 淘宝平台实现
│   ├── index.ts             # 统一导出 TaobaoPlatform
│   ├── platform.ts          # TaobaoPlatform（IPlatform 实现，组合层）
│   ├── connection/
│   │   └── native-cli.ts    # NativeCli 封装（调用 taobao-native CLI 二进制）
│   └── business/            # 纯函数层，无副作用，无状态
│       ├── store-search.ts        # 店铺搜索结果提取（去重，保持原始顺序）
│       ├── product-collector.ts   # 商品合并、过滤
│       ├── sales-parser.ts        # 销量文本解析
│       └── data-formatter.ts      # 导出文本格式化
└── wechat-store/            # 微信小店上货模块
    ├── index.ts              # 统一导出
    ├── types.ts              # 类型定义（ProductInput、AddProductRequest 等）
    ├── api-client.ts         # API 客户端（封装所有微信小店 HTTP 请求）
    └── product-lister.ts     # 上货流程编排（上传图片→添加商品→上架）
    ├── index.ts             # 统一导出 TaobaoPlatform
    ├── platform.ts          # TaobaoPlatform（IPlatform 实现，组合层）
    ├── connection/
    │   └── native-cli.ts    # NativeCli 封装（调用 taobao-native CLI 二进制）
    └── business/            # 纯函数层，无副作用，无状态
        ├── store-search.ts        # 店铺搜索结果提取（去重，保持原始顺序）
        ├── product-collector.ts   # 商品合并、过滤
        ├── sales-parser.ts        # 销量文本解析
        └── data-formatter.ts      # 导出文本格式化
```

### 核心数据流

1. **渲染进程** (App.tsx → tabs/*.tsx) 通过 `window.platformAPI.*` 调用 IPC
2. **IPC Handlers** 接收请求，委托给 `TaobaoPlatform`；同时启动心跳循环，通过 `webContents.send()` 推送连接状态
3. **TaobaoPlatform** 组合 connection 层（NativeCli）和 business 层（纯函数），暴露 `nativeCli` getter 供心跳使用
4. **NativeCli** 管理心跳状态机、自动恢复、恢复等待队列，通过 `execFile` 调用本地 CLI 二进制

### IPC API（window.platformAPI）

| 方法 | 说明 |
|------|------|
| `onConnectionChange(callback)` | 订阅心跳推送的连接状态变更（返回取消订阅函数） |
| `checkConnection()` | 手动检查连接（fallback，心跳已自动推送状态） |
| `searchStores(keyword)` | 搜索店铺（返回 CLI 原始顺序，不做排序） |
| `collectStore(storeName, filterOptions)` | 采集全店商品 |
| `export(storeName, products, filterOptions, format)` | 导出文件 |

### 心跳机制 + 自动恢复

连接管理作为基础设施层，业务层不感知连接状态：

```
NativeCli 心跳循环（30s）:
  heartbeatTick()
    ├── ping 成功 → connState = healthy → IPC 推送给渲染进程
    └── ping 失败 → connState = recovering → 自动重启淘宝桌面版
                    ├── 重启成功 → healthy → IPC 推送
                    └── 重启失败 → connState = dead → IPC 推送，提示用户手动处理

业务调用（exec()）:
  ├── healthy → 直接执行
  ├── recovering → 等待恢复（最多 60s），恢复后执行
  └── dead → 直接拒绝，提示用户先处理连接
```

状态映射（NativeCli → 渲染进程）：
- `healthy` → `connected`
- `recovering` / `unknown` → `checking`
- `dead` → `disconnected`

### IPlatform 接口

`src/core/types.ts` 定义了平台无关接口 `IPlatform`，扩展新平台时需实现此接口。

### NativeCli 连接层要点

- 通过 `tryPathsUntil()` 通用回退函数按优先级尝试多个 CLI 路径
- macOS 路径：`taobao-native`（PATH）→ `~/Library/Application Support/taobao/cli/taobao-runner`
- Windows 路径：`taobao-native`（PATH）→ `%APPDATA%\taobao\install-location.txt` 中读取安装目录拼接 `bin\taobao-native.cmd`
- 只在 ENOENT（命令不存在）时回退到下一个路径，其他错误直接抛出
- `_execOnce` 保留原始 Error，不做 `diagnose()` 转换，确保回退逻辑正确匹配 ENOENT
- 所有 CLI 调用有 120 秒超时，输出通过临时 JSON 文件或 stdout 传递
- **心跳机制**：`startHeartbeat(30_000)` 每 30 秒 ping 一次，崩溃后 `attemptRecovery()` 自动重启
- **状态机**：`unknown` → `healthy` / `recovering` → `healthy` / `dead`
- **恢复等待队列**：`exec()` 在 recovering 状态下等待恢复（最多 60s），恢复后自动继续执行
- `onStateChange(cb)` 供 IPC 层订阅状态变更，`stopHeartbeat()` 供应用退出时清理

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

### 微信小店上货模块（src/wechat-store/）

**设计思路**：模块分为三层
1. `types.ts` — 纯类型定义，不含逻辑
2. `api-client.ts` — 纯 HTTP 调用，一个函数对应一个微信 API 端点
3. `product-lister.ts` — 流程编排，将多步 API 调用串联成完整的上货流程

**数据流**：
```
商品信息采集模块（待开发）
        │
        ▼ ProductInput（标准输入格式）
  product-lister.ts
    ├── uploadImage() → 图片本地路径 → mmecimage URL
    ├── getAfterSaleAddresses() → 获取售后地址
    ├── buildProductRequest() → ProductInput → AddProductRequest
    ├── addProduct() → 提交商品（草稿状态）
    └── listProduct() → 提交审核上架
```

**API 端点汇总**：
| 功能 | 方法 | 路径 |
|------|------|------|
| 上传图片 | POST | `/shop/ec/basics/img/upload` |
| 获取所有类目 | GET | `/channels/ec/category/all` |
| 获取类目详情 | POST | `/shop/ec/category/detail` |
| 获取运费模板 | POST | `/channels/ec/merchant/getfreighttemplatelist` |
| 获取售后地址 | POST | `/channels/ec/merchant/address/list` |
| 添加商品 | POST | `/channels/ec/product/add` |
| 上架商品 | POST | `/channels/ec/product/listing` |

**注意事项**：
- access_token 由调用方管理（获取/刷新/缓存），本模块不处理
- 所有图片必须先通过 uploadImage 上传，返回的 mmecimage.cn/p/ 链接才能用于商品 API
- 价格单位统一为「分」（如 990 = 9.90 元）
- 商品添加后为草稿状态，需调用 listProduct 提交审核才正式生效
- 商品上架后不可修改一级类目
