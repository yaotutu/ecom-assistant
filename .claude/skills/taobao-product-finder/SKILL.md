---
name: taobao-product-finder
description: |
  淘宝C店商品链接采集工具。根据关键词搜索淘宝C店（非天猫），找到销量最高的店铺，并采集指定店铺中符合销量和价格条件的全部商品链接。
  关键词只是入口，采集的是店铺的全店商品，不局限于搜索关键词对应的品类。
  TRIGGER when: 用户要求查找某类商品的淘宝店铺、采集店铺全店商品链接、找销量高的店铺、按价格/销量筛选淘宝商品。
  Examples: "找收纳盒销量最高的3家店铺并采集全店商品"、"采集这家店铺所有销量大于10的商品"、"帮我找淘宝上xx卖得最好的店并拿到全店商品链接"
---

# 淘宝C店全店商品采集

## 前置依赖

- 淘宝桌面版客户端已安装且登录
- `taobao-native` CLI 可用

## 核心原理

两步走：**关键词找店铺** → **店铺名搜全店商品**

1. 用产品关键词搜索 → 找到该品类销量最高的店铺
2. 用店铺名搜索淘宝 → 获取该店铺的全店商品（API 提供 itemId/价格/标题，页面提供销量，按位置一一对应）

关键词只是"入口"：用户搜"钳子"找到A店，但采集的是A店里**所有品类**的商品（抹布、收纳、香薰等），不局限于钳子。

## 输出

默认输出到 `./output/` 目录，每个店铺两个文件：

| 文件 | 受众 | 内容 |
|------|------|------|
| `{店铺名}_详情.txt` | 人读 | 序号、标题、价格、销量、链接 |
| `{店铺名}_链接.txt` | 程序读 | 每行一个链接，纯净无杂 |

## 脚本

位于 `scripts/` 目录。

### search_top_stores.py — 搜索TOP店铺

```bash
python3 scripts/search_top_stores.py <关键词> [--top N]
```

- `--top N`：取前 N 家（默认 3）
- stdout JSON：`{stores: [{name, product_count, shopUrl}, ...]}`

### collect_store.py — 采集店铺全店商品

```bash
python3 scripts/collect_store.py <店铺全名> [--min-sales 10] [--min-price X] [--max-price Y] [--output-dir ./output]
```

- 用店铺名作为搜索词，获取该店铺的全部商品
- `--min-sales`：最低销量（默认 10）
- `--min-price` / `--max-price`：价格区间
- `--output-dir`：输出目录（默认 `./output`）

**注意**：不再需要 `--keyword` 参数，店铺名本身就是搜索词。

## 典型工作流

```bash
# 第1步：找收纳盒销量最高的3家C店
python3 scripts/search_top_stores.py "收纳盒" --top 3

# 第2步：采集每家店铺的全店商品（销量>10，价格>5）
python3 scripts/collect_store.py "好物优选百货超市" --min-sales 10 --min-price 5
python3 scripts/collect_store.py "义乌北哥百货" --min-sales 10 --min-price 5
python3 scripts/collect_store.py "百姓惠享百货" --min-sales 10 --min-price 5
```

## 局限性

- 淘宝搜索单次最多返回约50个商品，商品数量超过50的店铺可能无法完全覆盖
- 搜索店铺名时可能有少量其他店铺的商品混入，脚本会按店铺名精确过滤
