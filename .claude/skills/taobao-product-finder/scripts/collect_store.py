#!/usr/bin/env python3
"""
采集指定淘宝C店的全部商品（按销量/价格过滤）
用法: python3 collect_store.py <店铺名> [--min-sales 10] [--min-price X] [--max-price Y] [--output-dir ./output]
原理: 用店铺名作为关键词搜索淘宝 → API返回该店铺的商品（含itemId/价格/标题）→ 页面提供销量 → 按位置合并 → 过滤输出
输出: stdout JSON摘要 + 本地两个文件（详情.txt / 链接.txt）
"""
import json, re, sys, os, argparse, subprocess, tempfile, time

SOURCE_APP = "copaw"


# ── 工具函数 ──────────────────────────────────────────────

def run_taobao(tool, args_dict, output_file=None):
    args_json = json.dumps({**args_dict, "sourceApp": SOURCE_APP}, ensure_ascii=False)
    cmd = f'taobao-native {tool} --args \'{args_json}\''
    if output_file:
        cmd += f' -o "{output_file}"'
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120)
    if output_file and os.path.exists(output_file):
        with open(output_file, 'r', encoding='utf-8') as f:
            content = f.read()
        if content.strip():
            return json.loads(content)
    try:
        return json.loads(r.stdout)
    except:
        return None


def read_full_page_content():
    all_content = ""
    offset = 0
    for _ in range(10):
        tmp = tempfile.mktemp(suffix=".json", dir="/tmp")
        result = run_taobao("read_page_content", {"offset": offset}, tmp)
        if not result:
            break
        r = result.get("result", result)
        content = r.get("content", "")
        total = r.get("totalLength", 0)
        offset = r.get("offset", 0) + len(content)
        all_content += content
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
        if offset >= total:
            break
    return all_content


def parse_sales_number(sales_str):
    m = re.match(r'(\d+)(万?)(\+?)人(?:付款|看过)', sales_str)
    if not m:
        return 0
    num = int(m.group(1))
    if m.group(2) == '万':
        num *= 10000
    return num


def safe_price(price_str):
    try:
        return float(price_str)
    except (ValueError, TypeError):
        return 0


# ── 核心：搜索店铺名 → 按位置匹配 ─────────────────────

def collect_all_products(store_name):
    """用店铺名搜索，获取该店铺的全部商品（API+页面销量）"""
    # 第1步：搜索店铺名
    api_file = f"/tmp/taobao_store_{os.getpid()}.json"
    run_taobao("search_products", {"keyword": store_name, "type": "pc_taobao"}, api_file)
    if not os.path.exists(api_file):
        print("错误：搜索失败，API数据未生成", file=sys.stderr)
        return []

    with open(api_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    all_api = data.get('result', data).get('products', [])
    print(f"  API返回 {len(all_api)} 个商品", file=sys.stderr)

    time.sleep(2)

    # 第2步：读取页面销量
    page_content = read_full_page_content()

    # 第3步：按位置匹配
    sales_pattern = r'(\d+万?\+?人(?:付款|看过))'
    sales_matches = list(re.finditer(sales_pattern, page_content))
    print(f"  页面销量标记: {len(sales_matches)} 个", file=sys.stderr)

    count = min(len(all_api), len(sales_matches))
    merged = []
    for i in range(count):
        ap = all_api[i]
        sm = sales_matches[i]
        sales_str = sm.group(1)
        sales_num = parse_sales_number(sales_str)
        merged.append({
            "title": ap.get("title", ""),
            "itemId": ap.get("itemId", ""),
            "price": str(ap.get("price", "")),
            "shopName": ap.get("shopName", ""),
            "sales": sales_num,
            "sales_str": sales_str,
            "link": f"https://item.taobao.com/item.htm?id={ap.get('itemId', '')}",
        })

    # 只保留目标店铺的商品
    store_products = [p for p in merged if p["shopName"] == store_name]
    print(f"  属于 {store_name} 的商品: {len(store_products)} 个", file=sys.stderr)

    if os.path.exists(api_file):
        os.remove(api_file)

    return store_products


# ── 过滤 + 输出 ──────────────────────────────────────────

def filter_and_output(products, store_name, min_sales, output_dir,
                      min_price=None, max_price=None):
    filtered = [p for p in products if p["sales"] > min_sales]
    if min_price is not None:
        filtered = [p for p in filtered if safe_price(p["price"]) >= min_price]
    if max_price is not None:
        filtered = [p for p in filtered if safe_price(p["price"]) <= max_price]
    filtered.sort(key=lambda x: x["sales"], reverse=True)

    os.makedirs(output_dir, exist_ok=True)
    base = os.path.join(output_dir, store_name)

    # 1. 详情（人读）
    detail_path = f"{base}_详情.txt"
    with open(detail_path, 'w', encoding='utf-8') as f:
        conditions = [f"销量>{min_sales}"]
        if min_price is not None:
            conditions.append(f"价格>=￥{min_price}")
        if max_price is not None:
            conditions.append(f"价格<=￥{max_price}")
        f.write(f"{'='*60}\n")
        f.write(f"{store_name} — {' '.join(conditions)}\n")
        f.write(f"共 {len(filtered)} 个商品（全店采集）\n")
        f.write(f"{'='*60}\n\n")
        for i, p in enumerate(filtered, 1):
            f.write(f"{i}. {p['title']}\n")
            f.write(f"   价格: ￥{p['price']}  销量: {p['sales_str']} ({p['sales']}人)\n")
            f.write(f"   链接: {p['link']}\n\n")

    # 2. 纯链接（程序读）
    links_path = f"{base}_链接.txt"
    with open(links_path, 'w', encoding='utf-8') as f:
        for p in filtered:
            if p["link"]:
                f.write(p["link"] + "\n")

    return {
        "total_in_store": len(products),
        "total_after_filter": len(filtered),
        "files": {"detail": detail_path, "links": links_path},
    }


# ── 主流程 ────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="采集指定淘宝C店的全部商品（按销量/价格过滤）")
    parser.add_argument("store_name", help="店铺全名（精确匹配），将用店铺名搜索获取全店商品")
    parser.add_argument("--min-sales", type=int, default=10, help="最低销量阈值（默认10）")
    parser.add_argument("--min-price", type=float, default=None, help="最低价格")
    parser.add_argument("--max-price", type=float, default=None, help="最高价格")
    parser.add_argument("--output-dir", "-d", default="./output", help="输出目录（默认 ./output）")
    args = parser.parse_args()

    store_name = args.store_name
    output_dir = os.path.abspath(args.output_dir)

    print(f"采集全店商品: {store_name}", file=sys.stderr)

    # 搜索店铺名 → 获取全店商品
    products = collect_all_products(store_name)
    print(f"  全店商品: {len(products)} 个", file=sys.stderr)

    # 过滤 + 输出
    result = filter_and_output(products, store_name, args.min_sales, output_dir,
                               args.min_price, args.max_price)
    print(f"  过滤后(销量>{args.min_sales}): {result['total_after_filter']} 个", file=sys.stderr)
    print(f"  详情: {result['files']['detail']}", file=sys.stderr)
    print(f"  链接: {result['files']['links']}", file=sys.stderr)

    print(json.dumps({
        "store": store_name,
        "min_sales": args.min_sales,
        "total_in_store": result["total_in_store"],
        "total_after_filter": result["total_after_filter"],
        "files": result["files"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
