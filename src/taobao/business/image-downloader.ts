/**
 * 图片下载工具 — 从淘宝 CDN 下载图片到本地临时文件
 *
 * 职责：
 * - 将远程图片 URL 下载到本地文件系统（系统临时目录）
 * - 处理淘宝图片 URL 的特殊格式（协议相对路径、尺寸后缀）
 * - 支持并发控制和失败容忍（单张失败不中断整体流程）
 *
 * 使用场景：
 * - 下载淘宝商品主图（3-9 张）
 * - 下载淘宝商品详情图（1-20 张）
 * - 下载后交给微信小店里货模块上传到微信 CDN
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

// ============================================================
// URL 处理
// ============================================================

/**
 * 标准化图片 URL
 *
 * 处理淘宝图片 URL 的常见格式：
 * 1. 协议相对路径："//img.alicdn.com/..." → "https://img.alicdn.com/..."
 * 2. 已有协议：直接使用
 * 3. 空值/null：返回空字符串
 *
 * @param url - 原始图片 URL
 * @returns 标准化后的完整 URL
 */
const normalizeImageUrl = (url: string): string => {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  return url
}

/**
 * 去除淘宝图片 URL 的尺寸后缀，获取原图
 *
 * 淘宝图片 URL 通常包含尺寸参数：
 * - https://img.alicdn.com/imgextra/xxx_400x400.jpg → 原图
 * - https://img.alicdn.com/imgextra/xxx.jpg_80x80.jpg → 原图
 *
 * 去除 _数字x数字 模式可以获取更高质量的原图，
 * 微信小店要求主图 800x800 像素以上。
 *
 * @param url - 淘宝图片 URL
 * @returns 去除尺寸后缀的 URL
 */
const stripSizeSuffix = (url: string): string => {
  return url.replace(/_\d+x\d+(\.\w+)?$/, '$1')
}

// ============================================================
// 文件路径生成
// ============================================================

/**
 * 生成临时文件路径
 *
 * 使用系统临时目录 + 唯一前缀 + UUID 确保文件名不冲突。
 * 根据响应的 Content-Type 或 URL 后缀推断文件扩展名。
 *
 * @param url - 图片 URL（用于推断扩展名）
 * @param prefix - 文件名前缀（如 "head"、"desc"、"sku"）
 * @returns 本地临时文件路径
 */
const generateTempPath = (url: string, prefix: string): string => {
  // 从 URL 推断扩展名
  const urlPath = new URL(url).pathname
  const ext = extname(urlPath).replace(/_.*$/, '') || '.jpg'

  // 生成唯一文件名
  const uuid = randomUUID().slice(0, 8)
  const fileName = `${prefix}_${uuid}${ext}`

  return join(tmpdir(), fileName)
}

// ============================================================
// 核心下载
// ============================================================

/** 下载选项 */
export interface DownloadOptions {
  /** 单张下载超时（毫秒），默认 30000 */
  timeout?: number
  /** 文件名前缀，默认 "img" */
  prefix?: string
}

/**
 * 下载单张图片到本地临时文件
 *
 * @param imageUrl - 图片 URL
 * @param options - 下载选项
 * @returns 本地文件路径，下载失败返回 null
 */
export const downloadImage = async (
  imageUrl: string,
  options?: DownloadOptions
): Promise<string | null> => {
  const timeout = options?.timeout ?? 30_000
  const prefix = options?.prefix ?? 'img'

  try {
    // 标准化 URL 并去除尺寸后缀获取原图
    const url = stripSizeSuffix(normalizeImageUrl(imageUrl))
    if (!url) return null

    const filePath = generateTempPath(url, prefix)

    // 下载图片
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 模拟浏览器 Referer，避免淘宝 CDN 拒绝
        Referer: 'https://www.taobao.com/',
      },
    })
    clearTimeout(timer)

    if (!response.ok) {
      return null
    }

    // 写入临时文件
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(filePath, buffer)

    return filePath
  } catch {
    // 下载失败（超时、网络错误等）不中断流程
    return null
  }
}

/**
 * 批量下载图片到本地临时文件
 *
 * 并发控制：最多同时下载 N 张，避免过多并发导致超时。
 * 单张下载失败不影响其他图片，对应位置为 null。
 *
 * @param imageUrls - 图片 URL 数组
 * @param options - 下载选项（含并发数）
 * @returns 本地文件路径数组（失败的项为 null）
 */
export const downloadImages = async (
  imageUrls: string[],
  options?: DownloadOptions & { concurrency?: number }
): Promise<(string | null)[]> => {
  const concurrency = options?.concurrency ?? 3
  const results: (string | null)[] = new Array(imageUrls.length).fill(null)

  // 并发池：最多同时下载 concurrency 个
  const queue = [...imageUrls.map((url, index) => ({ url, index }))]
  const workers: Promise<void>[] = []

  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift()
        if (!item) break
        results[item.index] = await downloadImage(item.url, options)
      }
    })())
  }

  await Promise.all(workers)
  return results
}

/**
 * 过滤掉下载失败的图片（null 项）
 * 返回只包含成功下载的文件路径
 *
 * @param paths - 包含 null 的路径数组
 * @returns 只有成功路径的数组
 */
export const filterSuccessfulDownloads = (
  paths: (string | null)[]
): string[] => paths.filter((p): p is string => p !== null)
