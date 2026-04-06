# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

电商助手（ecom-assistant）是一个基于 Electron + Vue 3 的桌面工具，用于通过淘宝桌面版的 native CLI 采集淘宝C店商品数据（搜索店铺、采集全店商品、按销量/价格过滤、导出文件）。

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 启动开发模式（electron-vite dev server）
npm run build        # 构建生产版本
npm run typecheck    # TypeScript 类型检查（vue-tsc --noEmit）
```

无测试框架，暂无测试命令。

## 架构

项目采用标准 Electron 三进程架构，使用 electron-vite 构建：

```
src/
├── main/           # 主进程（Node.js）
│   ├── main.ts           # 窗口创建、应用生命周期
│   └── ipc-handlers.ts   # IPC 通道注册，桥接渲染进程与平台模块
├── preload/        # 预加载脚本（安全沙箱桥接）
│   └── preload.ts        # contextBridge 暴露 window.platformAPI
├── renderer/       # 渲染进程（Vue 3 SPA）
│   └── App.vue           # 单页面应用，包含全部 UI 逻辑
├── core/           # 跨平台共享类型
│   └── types.ts          # IPlatform 接口及所有 DTO 类型
└── taobao/         # 淘宝平台实现
    ├── index.ts           # 统一导出
    ├── platform.ts        # TaobaoPlatform（IPlatform 实现，组合层）
    ├── connection/
    │   └── native-cli.ts  # NativeCli 封装（调用 taobao-native CLI 二进制）
    └── business/
        ├── store-search.ts      # 店铺搜索与排名（纯函数）
        ├── product-collector.ts # 商品合并、过滤（纯函数）
        ├── sales-parser.ts      # 销量文本解析（纯函数）
        └── data-formatter.ts    # 导出文本格式化（纯函数）
```

### 核心数据流

1. **渲染进程** (App.vue) 通过 `window.platformAPI.*` 调用 IPC
2. **IPC Handlers** 接收请求，委托给 `TaobaoPlatform`
3. **TaobaoPlatform** 组合 connection 层（NativeCli）和 business 层（纯函数）
4. **NativeCli** 通过 `execFile` 调用本地 `taobao-native` CLI 二进制，解析 JSON 输出

### IPlatform 接口

`src/core/types.ts` 定义了平台无关接口 `IPlatform`，包含三个核心方法：
- `checkConnection()` — 连接健康检查
- `searchStores(keyword)` — 搜索 TOP 店铺
- `collectStore(storeName, filterOptions)` — 采集全店商品

扩展新平台时需实现此接口。

### NativeCli 连接层要点

- 自动尝试多个 CLI 路径（系统 PATH + macOS Application Support 路径）
- 执行层未就绪时会自动杀掉并重启淘宝桌面版进程
- 所有 CLI 调用有 120 秒超时，输出通过临时 JSON 文件或 stdout 传递
- 错误诊断通过 `ERROR_DIAGNOSIS` 表将技术错误映射为用户友好提示

## 技术栈

- Electron 34 + electron-vite 3
- Vue 3（Composition API，`<script setup>`）
- TypeScript 5（strict 模式）
- electron-builder 打包（macOS DMG/ZIP）

## 编码约定

- 业务逻辑层（`business/`）全部为纯函数，无副作用，无状态
- JS/TS 代码优先使用函数式编程范式
- 中文注释，IPC 通道名采用 `platform:动作` 格式
- 类型定义集中在 `src/core/types.ts`，不与实现混放
