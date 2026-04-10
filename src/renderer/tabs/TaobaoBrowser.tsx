/**
 * 淘宝浏览器标签页 — 嵌入式 WebView 提供完整的浏览器体验
 *
 * 设计理念：
 * - 用户在 WebView 中手动登录淘宝，全程可见、可干预
 * - 登录后直接在 WebView 中导航到商品页，提取数据
 * - 模拟滚动的提取过程对用户可见，遇到验证码等可手动处理
 * - Cookie 通过 partition="persist:taobao" 自动持久化，重启后不丢失
 *
 * 数据流：
 *   用户导航到商品页 → 点击「提取数据」→ 注入 JS 滚动+提取 → 显示结果
 *   → 点击「上货到微信」→ IPC 传给主进程 → 上货
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Card, Input, Button, Space, message, Divider, Typography, Tag, Descriptions,
  Alert, Badge, Spin, Collapse, Image,
} from 'antd'
import {
  ArrowLeftOutlined, ArrowRightOutlined, ReloadOutlined,
  LoginOutlined, EyeOutlined, CloudUploadOutlined,
  CheckCircleOutlined, ChromeOutlined, BugOutlined, CloseCircleOutlined,
} from '@ant-design/icons'

const { Text, Paragraph } = Typography

// ─── 类型 ──────────────────────────────────────

/** 从页面提取的商品数据 */
interface ExtractedProduct {
  title: string
  itemId: string
  price: string
  shopName: string
  description: string
  headImageUrls: string[]
  descImageUrls: string[]
  skus: Array<{
    attributes: Array<{ key: string; value: string }>
    price: string
  }>
  sourceUrl: string
  extractSource: string
  /** 淘宝类目名称链（如 ["家居日用", "钥匙扣"]） */
  categoryNames: string[]
}

// ─── 常量 ──────────────────────────────────────

/** Chrome UA（去掉 Electron 标识） */
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** 淘宝首页 URL */
const HOME_URL = 'https://www.taobao.com/'

/** 淘宝登录页 URL */
const LOGIN_URL = 'https://login.taobao.com/'

// ─── 诊断脚本（用于探测页面数据源） ───────────

/**
 * 诊断脚本 — 探测淘宝页面上可用的数据源
 *
 * 返回所有找到的全局变量、DOM 元素、meta 标签等信息，
 * 用于确定正确的数据提取策略。
 */
const DIAGNOSE_SCRIPT = `
(() => {
  const info = { url: window.location.href, title: document.title, sources: {} };

  // 1. 检查常见的全局变量
  const globals = [
    'runParams', 'g_config', 'itemDo', 'DataCenter',
    '__INITIAL_DATA__', '__NEXT_DATA__', '__NUXT__',
    '$data', 'g_page_config', 'g_srp_loadCssImmediately',
    'hub', 'g_config', 'g_data', 'item',
  ];
  for (const name of globals) {
    try {
      const val = window[name];
      if (val !== undefined && val !== null) {
        info.sources[name] = {
          type: typeof val,
          keys: typeof val === 'object' ? Object.keys(val).slice(0, 20) : undefined,
          preview: JSON.stringify(val).substring(0, 300),
        };
      }
    } catch (e) {}
  }

  // 2. 检查 meta 标签
  const metas = {};
  document.querySelectorAll('meta[property], meta[name]').forEach(el => {
    const key = el.getAttribute('property') || el.getAttribute('name') || '';
    metas[key] = el.getAttribute('content') || '';
  });
  info.sources['_metas'] = metas;

  // 3. 检查 script 标签中的 JSON 数据
  const scripts = [];
  document.querySelectorAll('script[type="application/json"], script[type="text/javascript"]').forEach(el => {
    const text = el.textContent || '';
    if (text.includes('itemId') || text.includes('item_id') || text.includes('"title"')) {
      scripts.push(text.substring(0, 500));
    }
  });
  if (scripts.length > 0) info.sources['_jsonScripts'] = scripts;

  // 4. 检查关键 DOM 元素
  const domInfo = {};
  const selectors = {
    'title_h1': 'h1',
    'tb_main_title': '.tb-main-title',
    'ItemHeader': '[class*="ItemHeader"]',
    'title_class': '[class*="title"]',
    'price_class': '[class*="price"]',
    'Price_component': '[class*="Price"]',
    'MainPic': '[class*="MainPic"]',
    'PicGallery': '[class*="PicGallery"]',
    'ShopName': '[class*="ShopName"]',
    'shopName': '[class*="shopName"]',
    'tb-pic': '.tb-pic img',
    'sku': '[class*="sku"], [class*="SKU"]',
    'SkuItem': '[class*="SkuItem"]',
    'itemImages': '[class*="itemImage"], [class*="main-image"]',
  };
  for (const [name, sel] of Object.entries(selectors)) {
    try {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        domInfo[name] = {
          count: els.length,
          samples: Array.from(els).slice(0, 3).map(el => ({
            tag: el.tagName,
            text: (el.textContent || '').trim().substring(0, 100),
            src: el.getAttribute('src') || el.querySelector('img')?.getAttribute('src') || '',
            class: el.className?.toString?.()?.substring(0, 100) || '',
          })),
        };
      }
    } catch (e) {}
  }
  info.sources['_dom'] = domInfo;

  // 5. 查找所有包含 alicdn 的 img 标签（前 10 个）
  const allImgs = [];
  document.querySelectorAll('img[src*="alicdn"], img[data-src*="alicdn"]').forEach(el => {
    allImgs.push({
      src: (el.getAttribute('src') || '').substring(0, 150),
      dataSrc: (el.getAttribute('data-src') || '').substring(0, 150),
      class: (el.className?.toString?.() || '').substring(0, 80),
      parentClass: (el.parentElement?.className?.toString?.() || '').substring(0, 80),
    });
  });
  info.sources['_images'] = allImgs.slice(0, 20);

  return JSON.stringify(info);
})()
`

// ─── 提取脚本（注入到 webview 中执行） ──────────

/**
 * 完整的商品数据提取脚本
 *
 * 在 webview 的页面上下文中执行，可以访问 DOM 和 window 变量。
 * 流程：先提取核心数据 → 再滚动页面触发懒加载 → 最后提取详情图
 */
const EXTRACT_SCRIPT = `
(async () => {
  const result = {
    title: '', itemId: '', price: '', shopName: '', description: '',
    headImageUrls: [], descImageUrls: [], skus: [],
    sourceUrl: window.location.href, extractSource: '',
    categoryNames: [],
  };

  // ═══ 第一阶段：提取核心数据 ═══

  // --- 标题：document.title（去掉"-淘宝网"后缀） ---
  const docTitle = document.title || '';
  result.title = docTitle.replace(/[-–—]\\s*淘宝网\\s*$/, '').replace(/[-–—]\\s*天猫\\s*$/, '').trim();

  // --- 商品 ID：从 URL 提取 ---
  const idMatch = window.location.href.match(/[?&]id=(\\d+)/);
  if (idMatch) result.itemId = idMatch[1];

  // --- 类目名称：从面包屑导航提取 ---
  const breadcrumbSelectors = [
    '[class*="breadcrumb"] a',
    '[class*="Breadcrumb"] a',
    '[class*="categoryNav"] a',
    '[class*="crumb"] a',
    '#J_Breadcrumb a',
    '.tb-crumb a',
  ];
  for (const sel of breadcrumbSelectors) {
    const links = document.querySelectorAll(sel);
    if (links.length > 0) {
      links.forEach(a => {
        const text = (a.textContent || '').trim();
        if (text && text !== '首页' && text !== '淘宝网' && text !== '天猫') {
          result.categoryNames.push(text);
        }
      });
      if (result.categoryNames.length > 0) break;
    }
  }

  // --- 价格：优先取"卖家优惠"（实际售价），回退取"券后" ---
  const subPriceEl = document.querySelector('[class*="subPrice"]');
  if (subPriceEl) {
    const m = subPriceEl.textContent.match(/￥(\\d+\\.?\\d*)/);
    if (m) { result.price = m[1]; result.extractSource = 'dom-subPrice'; }
  }
  if (!result.price) {
    const hlPriceEl = document.querySelector('[class*="highlightPrice"]');
    if (hlPriceEl) {
      const m = hlPriceEl.textContent.match(/￥(\\d+\\.?\\d*)/);
      if (m) { result.price = m[1]; result.extractSource = 'dom-highlightPrice'; }
    }
  }
  if (!result.price) {
    const priceEl = document.querySelector('[class*="price--"]');
    if (priceEl) {
      const m = priceEl.textContent.match(/[￥¥](\\d+\\.?\\d*)/);
      if (m) { result.price = m[1]; result.extractSource = 'dom-price'; }
    }
  }

  // --- 店铺名 ---
  const shopEl = document.querySelector('[class*="shopName--"]');
  if (shopEl) result.shopName = shopEl.textContent?.trim() || '';

  // --- 主图：从缩略图列表提取（class 包含 thumbnailPic） ---
  const seenHead = new Set();
  document.querySelectorAll('img[class*="thumbnailPic"]').forEach(img => {
    let src = img.getAttribute('src') || '';
    if (src.startsWith('//')) src = 'https:' + src;
    // 去掉尺寸后缀获取原图
    src = src.replace(/_\\d+x\\d+\\.\\w+$/i, '').replace(/\\.jpg_q\\d+\\.jpg_\\.webp$/i, '.jpg').replace(/_\\.webp$/i, '.jpg');
    if (src && !seenHead.has(src)) {
      seenHead.add(src);
      result.headImageUrls.push(src);
    }
  });

  // --- SKU：从 skuValueWrap 子元素中提取各选项 ---
  const skuContainers = document.querySelectorAll('[class*="skuValueWrap"]');
  if (skuContainers.length > 0) {
    // 每个 skuValueWrap 下有多个 sku 选项
    skuContainers.forEach(container => {
      const items = container.querySelectorAll('[class*="skuValue"], [class*="imageTextItem"]');
      items.forEach(item => {
        const text = (item.textContent || '').trim();
        if (!text) return;
        const img = item.querySelector('img');
        result.skus.push({
          attributes: [{ key: '规格', value: text }],
          price: '',
          imageUrl: img ? (img.getAttribute('src') || '') : undefined,
        });
      });
    });
  }
  // 如果上面没找到 SKU，尝试从 skuItem 中获取
  if (result.skus.length === 0) {
    const skuItems = document.querySelectorAll('[class*="skuItem"] [class*="text"], [class*="skuItem"] [class*="value"]');
    skuItems.forEach(item => {
      const text = (item.textContent || '').trim();
      if (text && text.length < 100) {
        result.skus.push({ attributes: [{ key: '规格', value: text }], price: '' });
      }
    });
  }

  // ═══ 第二阶段：滚动页面触发详情图懒加载 ═══
  // 多轮滚动 + 充分等待，确保所有懒加载图片都能加载
  const totalHeight = document.body.scrollHeight || document.documentElement.scrollHeight;

  // 第一轮：缓慢滚动到底部（小步长，每步等久一点）
  let y = 0;
  while (y < totalHeight) {
    y += 250;
    window.scrollTo(0, Math.min(y, totalHeight));
    await new Promise(r => setTimeout(r, 600 + Math.floor(Math.random() * 400)));
  }
  // 到底部后等待图片加载
  await new Promise(r => setTimeout(r, 2000));

  // 第二轮：快速从底部滚回顶部，再慢滚到底部（触发遗漏的图片）
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 1000));
  y = 0;
  while (y < totalHeight) {
    y += 300;
    window.scrollTo(0, Math.min(y, totalHeight));
    await new Promise(r => setTimeout(r, 300 + Math.floor(Math.random() * 300)));
  }
  // 最终等待
  await new Promise(r => setTimeout(r, 3000));

  // ═══ 第三阶段：提取详情图 ═══

  // 从所有 descV8-singleImage 相关的 img 提取（同时检查 src 和 data-src）
  const seenDesc = new Set();
  document.querySelectorAll('img[class*="descV8"], img[class*="descV8-singleImage"]').forEach(img => {
    let src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-ks-lazyload') || '';
    if (src.startsWith('//')) src = 'https:' + src;
    if (src && src.includes('alicdn.com') && !src.includes('spacer') && !seenDesc.has(src)) {
      seenDesc.add(src);
      result.descImageUrls.push(src);
    }
  });

  // 补充扫描：从详情区域的所有 img 提取
  if (result.descImageUrls.length === 0) {
    const descContainer = document.querySelector('#description')
      || document.querySelector('#J_DivItemDesc')
      || document.querySelector('.ke-post');
    if (descContainer) {
      descContainer.querySelectorAll('img').forEach(img => {
        let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (src.startsWith('//')) src = 'https:' + src;
        if (src && src.includes('alicdn.com') && !seenDesc.has(src)) {
          seenDesc.add(src);
          result.descImageUrls.push(src);
        }
      });
    }
  }

  // ═══ 第四阶段：补充描述文本 ═══
  // 从页面中的参数区域提取
  const paramSection = document.querySelector('[class*="parameter"], [class*="attributeList"]');
  if (paramSection) {
    result.description = (paramSection.textContent || '').replace(/\\s+/g, ' ').trim().substring(0, 2000);
  }

  if (!result.extractSource) result.extractSource = 'dom-v2';
  return JSON.stringify(result);
})()
`

// ─── 工具函数 ──────────────────────────────────

/** 判断 URL 是否为淘宝商品详情页 */
const isProductPage = (url: string): boolean =>
  url.includes('item.taobao.com/item.htm') ||
  url.includes('detail.tmall.com/item.htm') ||
  url.includes('detail.tmall.hk/item.htm')

/** 判断 URL 是否为登录页面 */
const isLoginPage = (url: string): boolean =>
  url.includes('login.taobao.com') || url.includes('login.tmall.com')

/** 清理图片 URL（去掉尺寸后缀，获取原图） */
const cleanImageUrl = (url: string): string =>
  url
    .replace(/_\d+x\d+\.\w+$/i, '')
    .replace(/\.jpg_q\d+\.jpg_\.webp$/i, '.jpg')
    .replace(/\.webp$/i, '.jpg')

// ─── 组件 ──────────────────────────────────────

const TaobaoBrowser = () => {
  // ─── WebView 引用 ──────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<any>(null)

  // ─── 状态 ──────────────────────────────
  const [currentUrl, setCurrentUrl] = useState(HOME_URL)
  const [urlInput, setUrlInput] = useState('')
  const [pageLoading, setPageLoading] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [product, setProduct] = useState<ExtractedProduct | null>(null)
  const [diagnostic, setDiagnostic] = useState<string | null>(null)

  const isProduct = isProductPage(currentUrl)

  // ─── 创建 WebView ──────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const webview = document.createElement('webview')
    webview.setAttribute('partition', 'persist:taobao')
    webview.setAttribute('src', HOME_URL)
    webview.setAttribute('useragent', CHROME_UA)
    webview.style.width = '100%'
    webview.style.height = '100%'

    // 导航事件 — 更新 URL 和登录状态
    webview.addEventListener('did-navigate', (e: any) => {
      setCurrentUrl(e.url)
      setUrlInput(e.url)
      setPageLoading(false)
      // 如果离开了登录页，标记为已登录
      if (!isLoginPage(e.url) && e.url !== 'about:blank') {
        setIsLoggedIn(true)
      }
    })

    webview.addEventListener('did-navigate-in-page', (e: any) => {
      if (e.url && e.url !== currentUrl) {
        setCurrentUrl(e.url)
        setUrlInput(e.url)
      }
    })

    webview.addEventListener('did-start-loading', () => setPageLoading(true))
    webview.addEventListener('did-stop-loading', () => setPageLoading(false))

    // 新窗口（广告等）— 在当前 webview 中打开
    webview.addEventListener('new-window', (e: any) => {
      const url = e.url || ''
      // 允许淘宝和天猫的导航，阻止其他弹窗
      if (url.includes('taobao.com') || url.includes('tmall.com')) {
        webview.loadURL(url)
      }
    })

    containerRef.current.appendChild(webview)
    webviewRef.current = webview

    return () => {
      if (containerRef.current?.contains(webview)) {
        containerRef.current.removeChild(webview)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── 导航操作 ──────────────────────────

  const handleNavigate = useCallback(() => {
    if (!urlInput.trim() || !webviewRef.current) return
    let url = urlInput.trim()
    if (!url.startsWith('http')) url = 'https://' + url
    webviewRef.current.loadURL(url)
  }, [urlInput])

  const handleGoBack = useCallback(() => webviewRef.current?.goBack(), [])
  const handleGoForward = useCallback(() => webviewRef.current?.goForward(), [])
  const handleReload = useCallback(() => webviewRef.current?.reload(), [])

  const handleGoToLogin = useCallback(() => {
    webviewRef.current?.loadURL(LOGIN_URL)
    setIsLoggedIn(false)
  }, [])

  // ─── 诊断页面数据源 ────────────────────

  const handleDiagnose = useCallback(async () => {
    if (!webviewRef.current) return
    try {
      const rawJson = await webviewRef.current.executeJavaScript(DIAGNOSE_SCRIPT)
      setDiagnostic(rawJson)
      console.log('[诊断结果]', JSON.parse(rawJson))
      message.success('诊断完成，结果已输出到控制台（Cmd+Option+I 查看）')
    } catch (err: any) {
      message.error(`诊断失败: ${err.message}`)
    }
  }, [])

  // ─── 提取商品数据 ──────────────────────

  const handleExtract = useCallback(async () => {
    if (!webviewRef.current || extracting) return
    setExtracting(true)
    setProduct(null)

    const hide = message.loading('正在提取商品数据（含滚动加载详情图）...', 0)

    try {
      const rawJson = await webviewRef.current.executeJavaScript(EXTRACT_SCRIPT)
      const data = JSON.parse(rawJson) as ExtractedProduct

      // 清理图片 URL
      data.headImageUrls = data.headImageUrls.map(cleanImageUrl)
      data.descImageUrls = data.descImageUrls.map(cleanImageUrl)

      setProduct(data)
      hide()

      if (data.title) {
        message.success(`提取成功: ${data.title}`)
      } else {
        message.warning('未能提取到商品标题，请确认当前页面是商品详情页')
      }
    } catch (err: any) {
      hide()
      message.error(`提取失败: ${err.message}`)
    } finally {
      setExtracting(false)
    }
  }, [extracting])

  // ─── 一键上货到微信 ────────────────────

  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    productId: string
    autoListed: boolean
    steps: Array<{ name: string; success: boolean; duration: number; detail?: string }>
  } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // ─── 类目匹配测试 ────────────────────

  const [categoryMatchResult, setCategoryMatchResult] = useState<{
    matched: boolean
    categoryName?: string
    categoryPath?: number[]
    message?: string
  } | null>(null)
  const [categoryMatching, setCategoryMatching] = useState(false)

  const handleTestCategoryMatch = useCallback(async () => {
    if (!product?.title) return
    setCategoryMatching(true)
    setCategoryMatchResult(null)
    try {
      const res = await window.platformAPI.testCategoryMatch(product.title, product.categoryNames)
      setCategoryMatchResult(res.data ?? { matched: false, message: '无返回数据' })
      if (res.data?.matched) {
        message.success(`匹配到: ${res.data.categoryName}`)
      } else {
        message.warning(res.data?.message ?? '未匹配到类目')
      }
    } catch (err: any) {
      message.error(`类目匹配失败: ${err.message}`)
    } finally {
      setCategoryMatching(false)
    }
  }, [product])

  const handleUpload = useCallback(async () => {
    if (!product) return
    setUploading(true)
    setUploadResult(null)
    setUploadError(null)

    const hide = message.loading('正在上货到微信小店：下载图片 → 转换格式 → 提交...', 0)

    try {
      const res = await window.platformAPI.uploadExtractedProduct(
        product,
        {
          freightTemplateId: '1',
          defaultStock: 100,
        },
        { autoList: false }
      )
      hide()

      if (res.success && res.data) {
        setUploadResult({
          productId: res.data.productId,
          autoListed: res.data.autoListed,
          steps: res.data.steps ?? [],
        })
        message.success(`上货成功! 商品ID: ${res.data.productId}`)
      } else {
        setUploadError(res.error ?? '上货失败（无错误信息）')
        message.error(res.error ?? '上货失败')
      }
    } catch (err: any) {
      hide()
      setUploadError(err.message)
      message.error(`上货异常: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }, [product])

  // ─── 渲染 ──────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px - 40px)', margin: -20, marginTop: -20 }}>
      {/* ─── 顶部：导航栏 ──────────────── */}
      <div style={{ padding: '8px 12px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
        <Space style={{ width: '100%' }} size="small">
          {/* 导航按钮 */}
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={handleGoBack} />
          <Button size="small" icon={<ArrowRightOutlined />} onClick={handleGoForward} />
          <Button size="small" icon={<ReloadOutlined />} onClick={handleReload} loading={pageLoading} />

          {/* URL 输入 */}
          <Input
            size="small"
            placeholder="输入淘宝商品链接后回车"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onPressEnter={handleNavigate}
            prefix={<ChromeOutlined />}
            style={{ flex: 1, minWidth: 300 }}
          />

          <Button size="small" type="primary" onClick={handleNavigate}>
            前往
          </Button>

          {/* 登录状态 */}
          <Space size="small">
            <Badge status={isLoggedIn ? 'success' : 'warning'} />
            <Text style={{ fontSize: 12 }}>
              {isLoggedIn ? '已登录' : '未登录'}
            </Text>
            {!isLoggedIn && (
              <Button size="small" type="link" icon={<LoginOutlined />} onClick={handleGoToLogin}>
                去登录
              </Button>
            )}
          </Space>

          {/* 提取按钮 */}
          {isProduct && (
            <>
              <Button
                size="small"
                icon={<BugOutlined />}
                onClick={handleDiagnose}
              >
                诊断
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<EyeOutlined />}
                loading={extracting}
                onClick={handleExtract}
                style={{ background: '#722ed1', borderColor: '#722ed1' }}
              >
                提取数据
              </Button>
            </>
          )}
        </Space>
      </div>

      {/* ─── 中间：WebView 浏览器 ──────── */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 300 }} />

      {/* ─── 底部：诊断结果 ────────────── */}
      {diagnostic && (
        <Card
          size="small"
          title="页面诊断结果"
          style={{ maxHeight: 300, overflow: 'auto' }}
        >
          <pre style={{
            background: '#f5f5f5', padding: 12, borderRadius: 6,
            fontSize: 11, maxHeight: 250, overflow: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {(() => {
              try {
                return JSON.stringify(JSON.parse(diagnostic), null, 2)
              } catch {
                return diagnostic
              }
            })()}
          </pre>
        </Card>
      )}

      {/* ─── 底部：提取结果 ────────────── */}
      {product && (
        <Card
          size="small"
          title={
            <Space>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              <span>提取结果</span>
              <Tag color="blue">{product.extractSource}</Tag>
            </Space>
          }
          extra={
            uploadResult ? (
              <Space>
                <Tag color="green">微信商品ID: {uploadResult.productId}</Tag>
                {uploadResult.autoListed && <Tag color="purple">已提交上架审核</Tag>}
              </Space>
            ) : (
              <Button
                type="primary"
                size="small"
                icon={<CloudUploadOutlined />}
                onClick={handleUpload}
                loading={uploading}
                style={{ background: '#722ed1', borderColor: '#722ed1' }}
              >
                {uploading ? '上货中...' : '上货到微信'}
              </Button>
            )
          }
          style={{ maxHeight: 250, overflow: 'auto' }}
        >
          <Descriptions column={3} size="small">
            <Descriptions.Item label="标题" span={2}>
              <Paragraph copyable style={{ margin: 0, fontSize: 13 }}>{product.title}</Paragraph>
            </Descriptions.Item>
            <Descriptions.Item label="价格">
              <Text strong style={{ color: '#f50' }}>¥{product.price}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="ID">{product.itemId}</Descriptions.Item>
            <Descriptions.Item label="店铺">{product.shopName}</Descriptions.Item>
            <Descriptions.Item label="SKU">{product.skus.length} 个</Descriptions.Item>
            <Descriptions.Item label="主图">
              <Space>
                {product.headImageUrls.slice(0, 5).map((url, i) => (
                  <Image
                    key={i}
                    src={url}
                    width={40}
                    height={40}
                    style={{ objectFit: 'cover', borderRadius: 3 }}
                    fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN88P/BfwAJhAPk2iJi2AAAAABJRU5ErkJggg=="
                  />
                ))}
                {product.headImageUrls.length > 5 && (
                  <Tag>+{product.headImageUrls.length - 5}</Tag>
                )}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="详情图">
              <Tag color={product.descImageUrls.length > 0 ? 'green' : 'orange'}>
                {product.descImageUrls.length} 张
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="微信类目" span={2}>
              <Space>
                <Button
                  size="small"
                  onClick={handleTestCategoryMatch}
                  loading={categoryMatching}
                >
                  测试匹配
                </Button>
                {categoryMatchResult?.matched && (
                  <Tag color="green">{categoryMatchResult.categoryName}</Tag>
                )}
                {categoryMatchResult && !categoryMatchResult.matched && (
                  <Tag color="red">{categoryMatchResult.message}</Tag>
                )}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* ─── 底部：上货错误信息 ──────────── */}
      {uploadError && (
        <Card size="small" style={{ borderColor: '#ff4d4f' }}>
          <Alert type="error" message="上货失败" description={uploadError} showIcon />
        </Card>
      )}

      {/* ─── 底部：上货步骤日志 ──────────── */}
      {(uploadResult && uploadResult.steps.length > 0) && (
        <Card
          size="small"
          title="上货步骤"
          style={{ maxHeight: 200, overflow: 'auto' }}
        >
          {uploadResult.steps.map((step, i) => (
            <div key={i} style={{ marginBottom: 4, fontSize: 12 }}>
              {step.success
                ? <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
                : <CloseCircleOutlined style={{ color: '#ff4d4f', marginRight: 6 }} />
              }
              <Text strong>{step.name}</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>{step.duration}ms</Text>
              {step.detail && (
                <Text type="secondary" style={{ marginLeft: 8 }}>{step.detail}</Text>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

export default TaobaoBrowser
