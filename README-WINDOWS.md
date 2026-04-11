# Windows 开发环境说明

## 已知限制

在 Windows 上直接运行 `electron .` 时，`require('electron')` 会返回路径字符串而非 API 对象。这是 Electron 在 Windows 上的已知行为。

## 推荐的开发方式

### 方式 1：使用 npm run dev（推荐）

```bash
npm run dev
```

此命令会先执行 `npm run build`，然后使用 Electron 运行构建后的代码。

**注意**：首次构建后，应用可能无法正常启动（Windows Electron 限制）。此时请使用方式 2。

### 方式 2：直接运行 Electron（构建后）

```bash
npm run build
.\node_modules\electron\dist\electron.exe .
```

如果应用仍无法启动，这是 Windows 上 Electron 的限制，请尝试方式 3。

### 方式 3：使用 VS Code 调试

1. 安装 VS Code 的 "Debugger for Electron" 扩展
2. 使用 F5 启动调试
3. 这样可以在正确的 Electron 环境中运行主进程

### 方式 4：在 WSL 中开发（推荐用于开发）

在 WSL (Windows Subsystem for Linux) 中开发项目：

```bash
# WSL 中
npm install
npm run dev  # 热重载正常工作
npm run build
```

然后在 Windows 上运行构建后的应用。

## 生产打包

生产环境打包不受影响：

```bash
npm run build
npm run dist
```

打包后的 `.exe` 文件在 Windows 上运行正常。

## 日志查看

运行后，在应用窗口按 `Ctrl+Shift+I` 打开 DevTools 查看控制台日志。

## 技术说明

此问题是 Windows 上 Electron 的 `require('electron')` 行为导致的：
- 在 Windows 上直接运行 JS 文件：`require('electron')` 返回字符串路径
- 在 macOS/Linux 上：返回 Electron API 对象

我们已通过以下方式尝试解决：
1. `scripts/fix-electron.js` - 构建后修补（部分有效）
2. ESM 格式 - 需要 Electron 34+ 和 electron-vite 配合

最终建议：使用 WSL 开发或直接使用生产构建。
