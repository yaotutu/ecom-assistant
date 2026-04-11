# AGENTS.md - 电商助手项目指南

> 本文件为 AI 编码助手提供项目背景、架构说明和开发规范。项目主要使用中文进行注释和文档编写。

## 项目概述

**电商助手（ecom-assistant）** 是一个基于 Electron + React 19 的桌面应用程序，定位为「多平台商品采集与上货工具」。

### 核心功能

1. **淘宝数据采集**：通过淘宝桌面版 Native CLI 采集淘宝C店商品数据
   - **店铺采集**：给定店铺名，采集全店商品并按销量/价格过滤导出
   - **店铺发现**：输入关键词，搜索该品类最热门的店铺
   - **自动模式**：输入关键词，自动搜索热门店铺并依次采集全店商品
   - **淘宝浏览器**：内嵌 WebView 浏览淘宝页面，提取商品详情并一键上货

2. **微信小店里货**：将采集到的商品数据上传到微信小店
   - 通过微信小店 REST API 完成图片上传、商品创建、审核上架的全流程
   - 支持淘宝商品一键转换并上架到微信小店

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 框架 | Electron | 34.x | 桌面应用框架 |
| 构建工具 | electron-vite | 3.x | 支持三进程（main/preload/renderer）并行构建 |
| 前端框架 | React | 19.x | 函数式组件 + Hooks |
| UI 组件库 | Ant Design | 6.x | @ant-design/icons 6.x |
| 类型系统 | TypeScript | 5.7+ | strict 模式，jsx: react-jsx |
| 打包工具 | electron-builder | 25.x | 支持 macOS DMG/ZIP |
| 图像处理 | sharp | 0.34+ | 图片格式转换（GIF→PNG） |
| 配置管理 | dotenv | 17.x | 环境变量加载 |

## 项目结构

```
src/
├── core/                    # 平台无关的共享类型定义
│   └── types.ts             # IPlatform 接口、Product、FilterOptions 等
├── main/                    # Electron 主进程（Node.js）
│   ├── main.ts              # 应用入口：窗口创建、生命周期管理
│   ├── ipc-handlers.ts      # IPC 入口：平台实例创建、handler 注册、资源清理
│   └── ipc/                 # 业务 IPC handlers（按模块拆分）
│       ├── taobao-handlers.ts   # 搜索店铺、采集商品、导出、登录管理
│       └── wechat-handlers.ts   # 商品详情获取、一键上货、类目匹配
├── preload/                 # 预加载脚本（安全沙箱桥接）
│   └── preload.ts           # contextBridge 暴露 window.platformAPI
├── renderer/                # 渲染进程（React 19 SPA）
│   ├── App.tsx              # 主布局：侧边栏导航 + 连接状态管理
│   ├── App.css              # 最小化自定义样式
│   ├── main.tsx             # React 应用入口（createRoot）
│   ├── env.d.ts             # 全局类型声明（Product、PlatformAPI）
│   └── tabs/                # 五个功能标签页
│       ├── StoreCollect.tsx     # 店铺采集
│       ├── StoreDiscover.tsx    # 店铺发现
│       ├── AutoMode.tsx         # 自动模式
│       ├── OneClickList.tsx     # 一键上货
│       └── TaobaoBrowser.tsx    # 淘宝浏览器（WebView）
├── shared/                  # 跨进程共享工具
│   └── utils.ts             # sleep、timed、ok/fail 步骤记录
├── taobao/                  # 淘宝平台实现
│   ├── index.ts             # 统一导出 TaobaoPlatform
│   ├── platform.ts          # TaobaoPlatform（IPlatform 实现）
│   ├── types.ts             # 淘宝平台专属类型
│   ├── product-fetcher.ts   # 商品详情抓取（V1：基于 CLI）
│   ├── product-fetcher-v2.ts # 商品详情抓取（V2：基于 WebView）
│   ├── connection/          # 连接层
│   │   └── native-cli.ts    # NativeCli 封装（CLI 调用 + 心跳管理）
│   ├── business/            # 业务逻辑层（纯函数，无副作用）
│   │   ├── store-search.ts       # 店铺搜索结果提取
│   │   ├── product-collector.ts  # 商品合并、过滤
│   │   ├── sales-parser.ts       # 销量文本解析（"已售 1万+" → 10000）
│   │   ├── data-formatter.ts     # 导出文本格式化
│   │   ├── image-downloader.ts   # 图片下载（支持并发、重试、去重）
│   │   ├── image-utils.ts        # 图片处理工具
│   │   ├── wechat-transform.ts   # 淘宝商品 → 微信小店格式转换
│   │   ├── category-matcher.ts   # 类目智能匹配
│   │   ├── page-extract-scripts.ts # WebView 页面数据提取脚本
│   │   └── taobao-wechat-category-map.json # 淘宝-微信类目映射表
│   └── auth/                # 淘宝登录态管理
│       ├── session-manager.ts   # Cookie 持久化、登录状态检测
│       ├── login-window.ts      # 登录窗口管理
│       └── anti-detection.ts    # 反检测配置
└── wechat-store/            # 微信小店上货模块
    ├── index.ts             # 统一导出
    ├── types.ts             # 微信小店 API 类型定义
    ├── api-client.ts        # 纯 HTTP 调用（图片上传、类目、商品等）
    └── product-lister.ts    # 上货流程编排
```

## 架构设计

### Electron 三进程架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        主进程 (main)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ TaobaoPlatform│  │  NativeCli   │  │  IPC Handlers        │   │
│  │  (IPlatform)  │  │ (连接管理层)  │  │  (业务路由)          │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│         └─────────────────┴──────────────────────┘               │
│                           │                                      │
│                           ▼                                      │
│              execFile('taobao-native') ──→ 淘宝桌面版             │
└─────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   preload     │   │   preload     │   │   preload     │
│  (安全桥接)    │   │  (安全桥接)    │   │  (安全桥接)    │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   renderer    │   │   renderer    │   │   renderer    │
│  (React SPA)  │   │  (React SPA)  │   │  (WebView)    │
│  - App.tsx    │   │  - Tabs       │   │  - 淘宝页面    │
└───────────────┘   └───────────────┘   └───────────────┘
```

### 核心数据流

1. **渲染进程** (App.tsx → tabs/*.tsx) 通过 `window.platformAPI.*` 调用 IPC
2. **IPC Handlers** 接收请求，委托给 `TaobaoPlatform`；同时启动心跳循环，通过 `webContents.send()` 推送连接状态
3. **TaobaoPlatform** 组合 connection 层（NativeCli）和 business 层（纯函数），暴露 `nativeCli` getter 供心跳使用
4. **NativeCli** 管理心跳状态机、自动恢复、通过 `execFile` 调用本地 CLI 二进制

### IPlatform 接口

所有电商平台必须实现此接口（位于 `src/core/types.ts`）：

```typescript
export interface IPlatform {
  readonly name: string
  readonly id: string
  checkConnection(): Promise<ConnectionCheckResult>
  searchStores(keyword: string): Promise<SearchStoresResult>
  collectStore(storeName: string, filterOptions?: FilterOptions): Promise<CollectStoreResult>
}
```

### 连接管理（心跳机制）

```
NativeCli 心跳循环（30s）:
  heartbeatTick()
    ├── ping 成功 → connState = healthy → IPC 推送到渲染进程
    └── ping 失败 → connState = disconnected → IPC 推送错误提示

业务调用（exec()）:
  ├── healthy → 直接执行
  └── disconnected → 拒绝执行，提示用户先处理连接
```

状态映射（NativeCli → 渲染进程）：
- `healthy` → `connected`
- `unknown` → `checking`
- `disconnected` → `disconnected`

## 开发命令

```bash
# 安装依赖
npm install

# 启动开发模式（热重载）
npm run dev

# 构建生产版本
npm run build

# TypeScript 类型检查
npm run typecheck

# 预览生产构建
npm run preview
```

**无测试框架**，暂无测试命令。

## 编码规范

### 通用原则

1. **业务逻辑层**（`business/`）全部为**纯函数**，无副作用，无状态
2. **JS/TS 代码**优先使用**函数式编程范式**
3. **UI 组件**使用 antd 组件库，避免自定义 CSS 实现已有组件
4. **中文注释**，IPC 通道名采用 `platform:动作` 格式
5. **类型定义**集中在 `src/core/types.ts`（后端）和 `src/renderer/env.d.ts`（前端），不与实现混放

### 文件组织

- **主进程**：`src/main/` — Node.js 环境，可直接使用 fs、child_process 等
- **预加载**：`src/preload/` — 桥接层，谨慎使用 contextBridge
- **渲染进程**：`src/renderer/` — 浏览器环境，使用 window.platformAPI 访问主进程能力
- **平台实现**：`src/taobao/`、`src/wechat-store/` — 按平台拆分

### IPC 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 平台通用 | `platform:动作` | `platform:search-stores` |
| 淘宝专用 | `taobao:动作` | `taobao:check-login` |
| 微信专用 | `wechat:动作` | `wechat:get-token` |
| 状态推送 | `platform:connection-status` | 主进程 → 渲染进程 |

### 错误处理

- IPC handler 统一使用 `try/catch` 包裹，返回 `{ success, data }` 或 `{ success, error }` 格式
- 业务错误应携带 `suggestion` 字段，指导用户如何修复

## 配置说明

### 环境变量（.env）

```bash
# 微信小店 API 凭证
WECHAT_STORE_APPID=your_appid
WECHAT_STORE_SECRET=your_secret
```

### 淘宝桌面版 CLI

应用依赖本地安装的 **淘宝桌面版** 及其 CLI 工具 `taobao-native`：

- **macOS**：`taobao-native`（PATH）→ `~/Library/Application Support/taobao/cli/taobao-runner`
- **Windows**：`taobao-native`（PATH）→ `%APPDATA%\taobao\install-location.txt` 中读取安装目录

CLI 调用协议：
```bash
taobao-native <工具名> --args '<JSON 参数>'
```

## 关键模块说明

### NativeCli（src/taobao/connection/native-cli.ts）

淘宝桌面版 CLI 的封装层，职责包括：

1. **路径发现**：按优先级查找 CLI 二进制（支持 PATH 和固定安装路径）
2. **连接检测**：ping + 心跳 + 状态管理
3. **命令执行**：路径回退 + 错误解析
4. **业务 API**：搜索、导航、读取页面等高层封装

### 微信小店上货流程（src/wechat-store/）

模块分为三层：
1. `types.ts` — 纯类型定义，不含逻辑
2. `api-client.ts` — 纯 HTTP 调用，一个函数对应一个微信 API 端点
3. `product-lister.ts` — 流程编排，将多步 API 调用串联成完整上货流程

**数据流**：
```
商品信息采集 → ProductInput → 上传图片 → 构建请求体 → 添加商品 → 上架审核
```

### 淘宝商品 → 微信小店转换（src/taobao/business/wechat-transform.ts）

- 价格转换：元（字符串 "29.90"）→ 分（整数 2990）
- SKU 映射：淘宝规格属性 → 微信 sku_attrs
- 图片处理：本地路径保持，上传阶段再处理
- 验证规则：主图 3-9 张、详情图 1-20 张、标题 5-60 字符

## 安全注意事项

1. **微信小店凭证**：存储在 `.env` 文件，不提交到版本控制
2. **淘宝登录态**：使用 Electron `persist:taobao` partition 持久化 Cookie，应用重启后自动恢复
3. **Preload 安全**：所有主进程能力通过 `contextBridge` 暴露，渲染进程无法直接访问 Node.js API
4. **WebView 安全**：淘宝浏览器标签页使用独立 partition，与主应用隔离

## 打包与部署

### electron-builder 配置（electron-builder.yml）

```yaml
appId: com.ecom.finder-app
productName: 电商助手
directories:
  output: release
mac:
  category: public.app-category.utilities
  target:
    - dmg
    - zip
```

### 输出目录

- 开发构建：`dist/`（main/preload/renderer 子目录）
- 生产包：`release/`（dmg、zip 等安装包）

## 依赖的外部技能

项目依赖以下 Claude Skills（位于 `.claude/skills/`）：

1. **taobao-native**：淘宝桌面客户端操作指南
2. **taobao-product-finder**：淘宝C店商品链接采集工具说明

## 常见问题

### 淘宝桌面版连接失败

1. 确认淘宝桌面版已安装
2. 确认淘宝桌面版正在运行
3. 检查 `taobao-native` CLI 是否在 PATH 中
4. 查看应用内「检测命令」输出，手动执行验证

### 微信小店上货失败

1. 确认 `.env` 中 `WECHAT_STORE_APPID` 和 `WECHAT_STORE_SECRET` 已配置
2. 确认 access_token 有效（2 小时过期）
3. 检查类目是否已配置且为叶子类目
4. 检查运费模板和售后地址是否已在微信小店后台创建
