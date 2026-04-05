<template>
  <div class="app">
    <header class="header">
      <h1>电商助手</h1>
      <div class="conn-status" :class="connection.status" @click="recheck">
        <span class="conn-dot"></span>
        <span>{{ connection.message }}</span>
        <span v-if="connection.status === 'checking'" class="spinner"></span>
      </div>
    </header>

    <!-- 连接失败提示 -->
    <div v-if="connection.status === 'error' || connection.status === 'disconnected'" class="conn-card" :class="connection.message.includes('重启') ? 'warn-card' : 'error-card'">
      <div class="error-icon" :class="{ 'warn-icon': connection.message.includes('重启') }">
        <span v-if="connection.message.includes('重启')" class="spinner-icon"></span>
        <span v-else>!</span>
      </div>
      <div class="error-body">
        <div class="error-title" :class="{ 'warn-title': connection.message.includes('重启') }">{{ connection.message }}</div>
        <div v-if="connection.suggestion" class="error-suggestion">{{ connection.suggestion }}</div>
        <button v-if="!connection.message.includes('重启')" class="btn primary retry-btn" @click="recheck">重新检测连接</button>
      </div>
    </div>

    <template v-if="connection.status === 'connected'">
      <!-- 输入区 -->
      <div class="input-card">
        <div class="form-row">
          <label class="label">店铺名称</label>
          <input
            v-model="storeName"
            class="input store-input"
            placeholder="输入淘宝C店名称，如：惠购日用百货"
            @keydown.enter="startCollect"
          />
        </div>

        <div class="filters">
          <div class="filter-item">
            <label>销量 ≥</label>
            <input v-model.number="minSales" type="number" min="0" class="input short" />
          </div>
          <div class="filter-item">
            <label>价格 ≥ ￥</label>
            <input v-model.number="minPrice" type="number" min="0" step="0.01" class="input short" placeholder="不限" />
          </div>
          <div class="filter-item">
            <label>价格 ≤ ￥</label>
            <input v-model.number="maxPrice" type="number" min="0" step="0.01" class="input short" placeholder="不限" />
          </div>
        </div>

        <div class="actions">
          <button class="btn primary" :disabled="loading || !storeName.trim()" @click="startCollect">
            {{ loading ? '采集中...' : '开始采集' }}
          </button>
          <button class="btn" :disabled="products.length === 0 || exporting" @click="doExport('detail')">
            导出详情
          </button>
          <button class="btn" :disabled="products.length === 0 || exporting" @click="doExport('links')">
            导出链接
          </button>
        </div>

        <!-- 操作状态 -->
        <div v-if="statusText" class="op-status" :class="statusClass">{{ statusText }}</div>
      </div>

      <!-- 结果 -->
      <div v-if="products.length > 0" class="result-card">
        <div class="result-header">
          <h2>{{ collectedStore }}</h2>
          <span class="meta">全店 {{ totalInStore }} 个商品 | 筛选后 {{ products.length }} 个</span>
        </div>
        <table>
          <thead>
            <tr>
              <th class="col-idx">#</th>
              <th class="col-title">商品</th>
              <th class="col-price" @click="sortBy('price')">价格 {{ sortIcon('price') }}</th>
              <th class="col-sales" @click="sortBy('sales')">销量 {{ sortIcon('sales') }}</th>
              <th class="col-action">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in sortedProducts" :key="p.itemId">
              <td>{{ i + 1 }}</td>
              <td class="title-cell" :title="p.title">{{ p.title }}</td>
              <td>￥{{ p.price }}</td>
              <td>{{ p.salesStr }}</td>
              <td><a :href="p.link" target="_blank">打开</a></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!loading && products.length === 0 && hasCollected" class="empty">
        没有符合条件的商品
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

interface Product {
  title: string
  itemId: string
  price: string
  shopName: string
  sales: number
  salesStr: string
  link: string
}

interface ConnectionState {
  status: 'checking' | 'connected' | 'disconnected' | 'error'
  message: string
  suggestion?: string
}

// ─── 连接状态 ────────────────────────────────
const connection = ref<ConnectionState>({
  status: 'checking',
  message: '正在检测淘宝桌面版连接...',
})

async function checkConnection() {
  connection.value = { status: 'checking', message: '正在检测淘宝桌面版连接...' }
  try {
    const result = await window.platformAPI.checkConnection()
    connection.value = result
  } catch (err: any) {
    connection.value = {
      status: 'error',
      message: `检测失败: ${err.message}`,
      suggestion: '请确认淘宝桌面版已安装并正在运行。',
    }
  }
}

function recheck() {
  checkConnection()
}

onMounted(() => {
  checkConnection()
})

// ─── 采集 ────────────────────────────────────
const storeName = ref('')
const minSales = ref(10)
const minPrice = ref<number | undefined>(undefined)
const maxPrice = ref<number | undefined>(undefined)

const loading = ref(false)
const exporting = ref(false)
const hasCollected = ref(false)
const statusText = ref('')
const statusClass = ref('')

const products = ref<Product[]>([])
const totalInStore = ref(0)
const collectedStore = ref('')

// 排序
type SortKey = 'price' | 'sales'
const sortKey = ref<SortKey>('sales')
const sortAsc = ref(false)

const sortedProducts = computed(() => {
  const list = [...products.value]
  const key = sortKey.value
  const dir = sortAsc.value ? 1 : -1
  return list.sort((a, b) => {
    const va = parseFloat(a[key] as string) || 0
    const vb = parseFloat(b[key] as string) || 0
    return (va - vb) * dir
  })
})

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value
  else { sortKey.value = key; sortAsc.value = false }
}

function sortIcon(key: SortKey) {
  if (sortKey.value !== key) return ''
  return sortAsc.value ? '↑' : '↓'
}

function setStatus(text: string, cls: string) {
  statusText.value = text
  statusClass.value = cls
}

async function startCollect() {
  if (loading.value || !storeName.value.trim()) return

  loading.value = true
  hasCollected.value = false
  products.value = []
  collectedStore.value = storeName.value.trim()
  setStatus(`正在采集: ${collectedStore.value}...`, 'loading')

  try {
    const res = await window.platformAPI.collectStore(collectedStore.value, {
      minSales: minSales.value,
      minPrice: minPrice.value,
      maxPrice: maxPrice.value,
    })

    loading.value = false

    if (res.success) {
      products.value = res.data.products
      totalInStore.value = res.data.totalInStore
      hasCollected.value = true
      setStatus(`采集完成: ${res.data.totalAfterFilter} 个商品`, 'done')
    } else {
      // 区分是连接问题还是业务问题
      if (res.suggestion) {
        setStatus(`连接异常: ${res.error} — ${res.suggestion}`, 'error')
        // 连接可能断了，重新检查
        checkConnection()
      } else {
        setStatus(`采集失败: ${res.error}`, 'error')
      }
    }
  } catch (err: any) {
    loading.value = false
    setStatus(`采集异常: ${err.message}`, 'error')
    checkConnection()
  }
}

async function doExport(format: 'detail' | 'links') {
  if (products.value.length === 0 || exporting.value) return

  exporting.value = true
  const label = format === 'detail' ? '详情' : '链接'
  setStatus(`正在导出${label}，请选择保存目录...`, 'loading')

  try {
    const res = await window.platformAPI.export(
      collectedStore.value,
      JSON.parse(JSON.stringify(products.value)),
      JSON.parse(JSON.stringify({ minSales: minSales.value, minPrice: minPrice.value, maxPrice: maxPrice.value })),
      format
    )

    if (res.success) {
      setStatus(`已导出${label}: ${res.filePath}`, 'done')
    } else {
      setStatus(res.error === '已取消' ? '' : `导出失败: ${res.error}`, res.error === '已取消' ? '' : 'error')
    }
  } catch (err: any) {
    setStatus(`导出异常: ${err.message}`, 'error')
  } finally {
    exporting.value = false
  }
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
.app { max-width: 1100px; margin: 0 auto; padding: 24px; }

/* ─── 连接状态 ─────────────────── */
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.header h1 { font-size: 18px; font-weight: 600; }

.conn-status {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; padding: 5px 14px; border-radius: 14px;
  cursor: pointer; user-select: none; transition: all 0.2s;
}
.conn-status:hover { filter: brightness(0.95); }

.conn-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

.conn-status.connected { background: #f0fdf4; color: #16a34a; }
.conn-status.connected .conn-dot { background: #22c55e; }
.conn-status.disconnected { background: #fef2f2; color: #dc2626; }
.conn-status.disconnected .conn-dot { background: #ef4444; }
.conn-status.error { background: #fef2f2; color: #dc2626; }
.conn-status.error .conn-dot { background: #ef4444; }
.conn-status.checking { background: #eff6ff; color: #2563eb; }
.conn-status.checking .conn-dot { background: #3b82f6; animation: pulse 1s infinite; }

.spinner { width: 12px; height: 12px; border: 2px solid #93c5fd; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.6s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

/* ─── 连接错误卡片 ─────────────── */
.conn-card {
  margin-bottom: 20px; padding: 20px 24px;
  background: #fff; border-radius: 10px;
  border-left: 4px solid #ef4444;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.error-card, .warn-card { display: flex; gap: 16px; align-items: flex-start; }
.warn-card { border-left-color: #faad14; }
.error-icon {
  width: 36px; height: 36px; border-radius: 50%;
  background: #fef2f2; color: #ef4444;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; flex-shrink: 0;
}
.warn-icon { background: #fffbe6; color: #faad14; }
.spinner-icon {
  width: 18px; height: 18px; border: 2px solid #ffe58f; border-top-color: #faad14;
  border-radius: 50%; animation: spin 0.6s linear infinite;
}
.error-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; color: #dc2626; }
.warn-title { color: #d48806; }
.error-suggestion { font-size: 13px; color: #666; margin-bottom: 12px; line-height: 1.5; }
.retry-btn { font-size: 13px; padding: 6px 16px; }

/* ─── 输入区 ───────────────────── */
.input-card {
  background: #fff; border-radius: 10px; padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 20px;
}
.form-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.label { font-size: 14px; font-weight: 500; white-space: nowrap; }
.input {
  padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px;
  font-size: 14px; outline: none; transition: border-color 0.2s;
}
.input:focus { border-color: #1677ff; }
.store-input { flex: 1; }
.input.short { width: 100px; text-align: center; }
.filters { display: flex; gap: 20px; margin-bottom: 16px; }
.filter-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #666; }
.actions { display: flex; gap: 10px; }
.op-status {
  margin-top: 12px; font-size: 12px; padding: 6px 12px; border-radius: 6px;
}
.op-status.loading { color: #1677ff; background: #e6f4ff; }
.op-status.done { color: #52c41a; background: #f6ffed; }
.op-status.error { color: #ff4d4f; background: #fff2f0; }

/* ─── 按钮 ─────────────────────── */
.btn {
  padding: 8px 20px; border: 1px solid #d9d9d9; border-radius: 6px;
  font-size: 13px; cursor: pointer; background: #fff; transition: all 0.15s;
}
.btn:hover:not(:disabled) { border-color: #1677ff; color: #1677ff; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.btn.primary:hover:not(:disabled) { background: #4096ff; }

/* ─── 结果表格 ─────────────────── */
.result-card {
  background: #fff; border-radius: 10px; padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.result-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
.result-header h2 { font-size: 16px; }
.meta { font-size: 12px; color: #999; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; text-align: left; }
th { font-weight: 500; color: #999; background: #fafafa; font-size: 12px; cursor: pointer; user-select: none; }
th:hover { color: #1677ff; }
.col-idx { width: 36px; }
.col-price { width: 90px; }
.col-sales { width: 120px; }
.col-action { width: 50px; }
.col-title { max-width: 580px; }
.title-cell { max-width: 580px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-action a { color: #1677ff; text-decoration: none; }
.col-action a:hover { text-decoration: underline; }
.empty { text-align: center; padding: 40px; color: #bbb; font-size: 14px; }
</style>
