# 日志规范文档

> 本文档定义电商助手项目的日志输出规范，确保日志统一、可读、便于调试。

## 日志系统架构

### 核心模块

```typescript
import { logger } from '../shared/logger'
```

### 日志级别

| 级别 | 用途 | 输出颜色 |
|------|------|---------|
| `DEBUG` | 详细调试信息，开发时使用 | 灰色 |
| `INFO` | 关键流程节点、状态变化 | 白色 |
| `WARN` | 警告、非致命错误 | 黄色 |
| `ERROR` | 错误、异常 | 红色 |

默认日志级别为 `INFO`，可通过 `logger.setLevel('debug')` 调整。

---

## 日志标签规范

所有日志必须带标签，格式：`[分类]`

### 标准标签列表

| 标签 | 用途 | 示例 |
|------|------|------|
| `[CLI]` | CLI 连接检测、命令执行 | `[CLI] 开始查找路径` |
| `[Store]` | 店铺搜索、采集 | `[Store] 🔍 开始搜索店铺` |
| `[Image]` | 图片下载 | `[Image] ⬇️ 开始下载 12 张图片` |
| `[Wechat]` | 微信小店上货 | `[Wechat] 🛒 开始上货` |
| `[Export]` | 文件导出 | `[Export] 💾 导出 50 个商品` |
| `[Auth]` | 登录认证 | `[Auth] 检查登录状态` |
| `[IPC]` | IPC 通信（调试用） | `[IPC] 收到搜索店铺请求` |

### 标签使用原则

1. **单一职责**：一个模块只使用一个标签
2. **大写规范**：标签统一大写，如 `[Store]` 而非 `[store]`
3. **简洁明确**：标签长度控制在 4-8 个字符

---

## 日志内容规范

### 1. 流程节点日志

**规则**：关键流程的开始和结束必须记录

```typescript
// ✅ 正确
logger.info('[Store]', `🔍 开始搜索店铺: "${keyword}"`)
const result = await searchStores(keyword)
logger.info('[Store]', `✅ 找到 ${result.length} 家店铺`)

// ✅ 使用 timed 自动记录
await logger.timed('[Image]', '下载商品图片', async () => {
  return await downloadImages(urls)
})
```

### 2. 进度日志

**规则**：耗时操作（>3秒）需要显示进度

```typescript
// ✅ 每 5 个或最后更新进度
if (completed % 5 === 0 || completed === total) {
  logger.step('[Image]', completed, total, failed > 0 ? `失败:${failed}` : '下载中...')
}

// 输出示例：
// [14:30:25] INFO [Image] ⏳ [5/12] 42% 下载中...
```

### 3. 统计数据

**规则**：操作完成后输出统计信息

```typescript
logger.stats('[Store]',
  { label: '原始商品', value: totalCount },
  { label: '符合过滤', value: filteredCount }
)

// 输出示例：
// [14:30:25] INFO [Store] 📊 原始商品:150, 符合过滤:42
```

### 4. 错误日志

**规则**：异常必须记录，包含上下文

```typescript
try {
  await riskyOperation()
} catch (err: any) {
  // ✅ 包含操作名称和错误信息
  logger.error('[Wechat]', `❌ 上货失败: ${err.message}`)
  throw err
}
```

---

## 图标规范

使用 emoji 图标增强可读性：

| 图标 | 含义 | 使用场景 |
|------|------|---------|
| 🔍 | 搜索/查找 | 开始搜索店铺、查找 CLI |
| ⬇️ | 下载 | 开始下载图片 |
| ⬆️ | 上传 | 上传图片到微信 |
| ✅ | 成功完成 | 操作成功结束 |
| ❌ | 失败/错误 | 操作失败 |
| ⏳ | 进行中 | 进度提示 |
| 📝 | 构建/处理 | 构建请求体、处理数据 |
| 🚀 | 提交 | 提交 API 请求 |
| 📤 | 发送 | 提交审核 |
| 💾 | 保存 | 导出文件 |
| 📊 | 统计 | 输出统计数据 |
| 🎉 | 完成 | 整个流程完成 |
| 🛒 | 商品 | 上货相关 |
| ⚠️ | 警告 | 警告信息 |
| 🔧 | 修复/补丁 | fix 脚本 |

---

## API 使用示例

### 基础日志

```typescript
import { logger } from '../shared/logger'

logger.debug('[CLI]', '详细调试信息')
logger.info('[Store]', '普通信息')
logger.warn('[Auth]', '警告信息')
logger.error('[Wechat]', '错误信息')
```

### 计时执行

```typescript
const result = await logger.timed('[Store]', '采集店铺', async () => {
  return await platform.collectStore(name)
})
// 自动输出：
// [14:30:25] INFO [Store] ▶ 采集店铺 开始
// [14:30:35] INFO [Store] ✔ 采集店铺 完成 (10234ms)
```

### 进度显示

```typescript
for (let i = 0; i < items.length; i++) {
  await processItem(items[i])
  logger.step('[Image]', i + 1, items.length, '处理中...')
}
```

### 统计数据

```typescript
logger.stats('[Store]',
  { label: '总数', value: 100 },
  { label: '成功', value: 95 },
  { label: '失败', value: 5 }
)
```

---

## 查看日志

### 开发环境

1. 启动应用后，按 `Ctrl+Shift+I` 打开 DevTools
2. 切换到 **Console** 面板查看主进程日志
3. 或直接在终端查看输出

### 生产环境

生产构建的日志输出到控制台，可通过以下方式查看：
- Windows: 使用 DebugView 工具
- macOS/Linux: 终端直接运行应用

---

## 注意事项

1. **避免敏感信息**：不要在日志中输出 API Key、Cookie、密码等敏感信息
2. **控制日志量**：循环内不要每条都打印，使用 `step()` 或批量输出
3. **性能考虑**：生产环境避免过多 DEBUG 日志
4. **错误堆栈**：`logger.error` 自动记录，无需手动处理

---

## 更新记录

| 日期 | 版本 | 更新内容 |
|------|------|---------|
| 2025-04-11 | v1.0 | 初始版本，定义基础规范 |

---

*本文档由开发团队维护，更新时需同步修改代码实现*
