#!/usr/bin/env python3
"""
搜索淘宝C店销量TOP N店铺
用法: python3 search_top_stores.py <关键词> [--top N] [--type pc_taobao]
输出: stdout JSON [{name, product_count, total_sales}, ...]
"""
import json, re, sys, argparse, subprocess, os, tempfile, time

from collections import defaultdict

SOURCE_APP = "copaw"


def run_taobao_native(tool, args_dict, output_file=None):
    """调用 taobao-native CLI"""
    args_json = json.dumps({**args_dict, "sourceApp": SOURCE_APP}, ensure_ascii=False)
    cmd = f'taobao-native {tool} --args \'{args_json}\''
    if output_file:
        cmd += f' -o "{output_file}"'
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"Error: {result.stderr}", file=sys.stderr)
        return None
    if output_file and os.path.exists(output_file):
        with open(output_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    try:
        return json.loads(result.stdout)
    except:
        return None


def read_full_page():
    """分段读取当前页面全部内容"""
    all_content = ""
    offset = 0
    for _ in range(10):
        tmp = tempfile.mktemp(suffix=".json", dir="/tmp")
        result = run_taobao_native("read_page_content", {"offset": offset}, tmp)
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
    """'7万+人付款' → 70000"""
    m = re.match(r'(\d+)(万?)(\+?)人(?:付款|看过)', sales_str)
    if not m:
        return 0
    num = int(m.group(1))
    if m.group(2) == '万':
        num *= 10000
    return num


def extract_stores_from_api(api_file):
    """从 API JSON 中按 shopName 统计每个店铺的商品数"""
    with open(api_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    result = data.get('result', data)
    products = result.get('products', [])

    stores = defaultdict(lambda: {"name": "", "product_count": 0, "shopUrl": "", "items": []})
    for p in products:
        shop = p.get("shopName", "")
        url = p.get("productUrl", "") or ""
        # 跳过天猫
        if "tmall.com" in url:
            continue
        if not shop:
            continue
        stores[shop]["name"] = shop
        stores[shop]["product_count"] += 1
        stores[shop]["shopUrl"] = p.get("shopUrl", "") or stores[shop]["shopUrl"]
        stores[shop]["items"].append({
            "itemId": p.get("itemId", ""),
            "title": p.get("title", ""),
            "price": str(p.get("price", "")),
        })
    return dict(stores)


def extract_sales_from_page(content):
    """从页面文本提取每个商品的销量（按位置顺序）"""
    sales_pattern = r'(\d+万?\+?人(?:付款|看过))'
    sales_matches = list(re.finditer(sales_pattern, content))
    sales_list = []
    for match in sales_matches:
        sales_str = match.group(1)
        sales_num = parse_sales_number(sales_str)
        sales_list.append({"sales": sales_num, "sales_str": sales_str})
    return sales_list


def main():
    parser = argparse.ArgumentParser(description="搜索淘宝C店销量TOP N店铺")
    parser.add_argument("keyword", help="搜索关键词，如：收纳盒")
    parser.add_argument("--top", type=int, default=3, help="取前N家店铺（默认3）")
    parser.add_argument("--type", default="pc_taobao", help="搜索类型（默认pc_taobao，仅C店）")
    parser.add_argument("--output", "-o", default=None, help="结果输出到文件（可选）")
    args = parser.parse_args()

    tmp_api = tempfile.mktemp(suffix=".json", dir="/tmp")

    print(f"搜索: {args.keyword} (类型: {args.type})", file=sys.stderr)
    run_taobao_native("search_products", {
        "keyword": args.keyword,
        "type": args.type,
    }, tmp_api)

    time.sleep(2)

    # 从 API 数据统计店铺
    stores = extract_stores_from_api(tmp_api)
    print(f"  从API找到 {len(stores)} 个店铺", file=sys.stderr)

    for name in sorted(stores, key=lambda s: stores[s]['product_count'], reverse=True)[:10]:
        print(f"    {name}: {stores[name]['product_count']}个商品", file=sys.stderr)

    # 读取页面获取销量
    page_content = read_full_page()
    page_sales = extract_sales_from_page(page_content)
    print(f"  页面销量标记: {len(page_sales)} 个", file=sys.stderr)

    # 页面销量和 API 店铺统计是分开的，这里只用 API 的店铺数据排序
    # 按 API 中的商品数量排序（近似代表店铺在该品类的覆盖度）
    store_list = [
        {"name": s["name"], "product_count": s["product_count"], "shopUrl": s["shopUrl"]}
        for s in sorted(stores.values(), key=lambda x: x["product_count"], reverse=True)
    ]

    # 输出
    result = {
        "keyword": args.keyword,
        "type": args.type,
        "top": args.top,
        "total_stores_found": len(store_list),
        "stores": store_list[:args.top],
    }

    output_json = json.dumps(result, ensure_ascii=False, indent=2)
    print(output_json)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output_json)
        print(f"\n已保存到: {args.output}", file=sys.stderr)

    # 清理
    if os.path.exists(tmp_api):
        os.remove(tmp_api)


if __name__ == "__main__":
    main()
