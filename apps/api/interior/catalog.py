import json, copy
from .config import ROOT
from .models import uid

EXAMPLE = json.loads((ROOT / "packages/scene/scene.example.json").read_text("utf-8"))
CATALOG = json.loads((ROOT / "packages/catalog/items.json").read_text("utf-8"))
STYLES = [
    {
        "id": "warm-wood",
        "name": "原木自然",
        "description": "浅橡木与亚麻，温暖而松弛。",
        "floor": "#d3ba91",
        "wall": "#eee9dd",
        "accent": "#8b9a77",
        "color": "#8e9c77",
        "materials": {"floor": "三层实木复合地板", "wall": "亚麻色乳胶漆", "furniture": "橡木贴面 + 棉麻"},
        "prompt_keywords": "浅橡木、亚麻布、自然、温暖、植物",
    },
    {
        "id": "modern",
        "name": "现代简约",
        "description": "清晰线条与中性色，留出生活空间。",
        "floor": "#c4bfb4",
        "wall": "#eeeef0",
        "accent": "#5d6b72",
        "color": "#66777e",
        "materials": {"floor": "大尺寸灰色地砖", "wall": "纯白乳胶漆", "furniture": "哑光漆面 + 金属细腿"},
        "prompt_keywords": "简洁线条、中性灰、大留白、几何、功能",
    },
    {
        "id": "cream",
        "name": "奶油柔光",
        "description": "柔和米白与圆润的居住氛围。",
        "floor": "#dcccb4",
        "wall": "#f5eddf",
        "accent": "#b9a78a",
        "color": "#c6b398",
        "materials": {"floor": "奶油色仿石纹砖", "wall": "暖米色乳胶漆", "furniture": "布艺软包 + 原木脚"},
        "prompt_keywords": "奶油色、柔和光线、圆润线条、温馨",
    },
    {
        "id": "wabi-sabi",
        "name": "侘寂极简",
        "description": "低饱和灰泥、木色与安静留白。",
        "floor": "#a99f8b",
        "wall": "#d9d2c2",
        "accent": "#807c65",
        "color": "#99927b",
        "materials": {"floor": "微水泥", "wall": "艺术灰泥", "furniture": "原木手作 + 粗亚麻"},
        "prompt_keywords": "残缺美、自然材质、低饱和度、质朴、岁月痕迹",
    },
    {
        "id": "mid-century",
        "name": "中古复古",
        "description": "胡桃木与沉稳色彩，保留时间感。",
        "floor": "#a07852",
        "wall": "#e7dfcd",
        "accent": "#8b624b",
        "color": "#a47b57",
        "materials": {"floor": "胡桃木实木地板", "wall": "米白墙纸", "furniture": "柚木 + 真皮 + 黄铜"},
        "prompt_keywords": "胡桃木、黄铜、复古、经典、60年代",
    },
    {
        "id": "nordic",
        "name": "北欧清新",
        "description": "浅色木纹与明快功能，轻盈有序。",
        "floor": "#ddcba7",
        "wall": "#eef0e6",
        "accent": "#91a5a0",
        "color": "#92a49d",
        "materials": {"floor": "白橡木实木地板", "wall": "纯净白乳胶漆", "furniture": "白橡木 + 针织布艺 + 绿植"},
        "prompt_keywords": "白橡木、明亮清新、绿植点缀、Hygge、阳光",
    },
    {
        "id": "cream-french",
        "name": "奶油法式",
        "description": "奶油色调 + 石膏线 + 曲线家具，温润优雅。",
        "floor": "#e8dcc4",
        "wall": "#faf2e4",
        "accent": "#b8997a",
        "color": "#c4a785",
        "materials": {"floor": "米色复古花砖", "wall": "奶油色乳胶漆 + 石膏线条", "furniture": "曲线扶手椅 + 铜制吊灯"},
        "prompt_keywords": "奶油色、石膏线、曲线线条、铜制吊灯、优雅、法式",
    },
    {
        "id": "french-vintage",
        "name": "法式复古",
        "description": "做旧质感 + 复古家具 + 金属吊灯，浪漫怀旧。",
        "floor": "#b58e6a",
        "wall": "#eadcc5",
        "accent": "#6b4f3a",
        "color": "#8a6d54",
        "materials": {"floor": "复古拼花木地板", "wall": "做旧石灰墙", "furniture": "路易十五式沙发 + 水晶吊灯"},
        "prompt_keywords": "做旧质感、复古家具、水晶吊灯、浪漫、洛可可、法式",
    },
    {
        "id": "modern-luxury",
        "name": "现代轻奢",
        "description": "金属线条 + 大理石 + 精致细节，高级质感。",
        "floor": "#e4e0d6",
        "wall": "#f5f4f0",
        "accent": "#c9a96e",
        "color": "#b89b5e",
        "materials": {"floor": "大理石通体砖", "wall": "高级灰艺术漆", "furniture": "金属线条 + 天鹅绒 + 水晶"},
        "prompt_keywords": "金属线条、大理石、精致细节、金色点缀、高级、轻奢",
    },
    {
        "id": "industrial",
        "name": "工业风",
        "description": "裸露砖墙 + 金属管道 + 水泥灰，粗犷有力。",
        "floor": "#8a8a82",
        "wall": "#d4cfc5",
        "accent": "#4a4a4a",
        "color": "#5d5d5a",
        "materials": {"floor": "水泥自流平", "wall": "裸砖墙 + 金属管道", "furniture": "铁艺 + 皮革 + 原木"},
        "prompt_keywords": "裸露砖墙、金属管道、水泥灰、粗犷、Loft、工业",
    },
    {
        "id": "japanese",
        "name": "日式原木",
        "description": "原木质感 + 和纸 + 榻榻米，禅意宁静。",
        "floor": "#c9b089",
        "wall": "#ede5d0",
        "accent": "#7d6b4f",
        "color": "#9b8565",
        "materials": {"floor": "日式榻榻米或原木", "wall": "和纸壁纸", "furniture": "矮桌 + 蒲团 + 竹制灯具"},
        "prompt_keywords": "原木质感、和纸、榻榻米、禅意、日式、宁静",
    },
    {
        "id": "modern-chinese",
        "name": "现代中式",
        "description": "传统元素简化 + 中式家具 + 水墨意境。",
        "floor": "#b89a6a",
        "wall": "#f0ead8",
        "accent": "#3e5a47",
        "color": "#5a7a63",
        "materials": {"floor": "仿木纹瓷砖", "wall": "素色壁布 + 水墨画装饰", "furniture": "新中式实木 + 棉麻坐垫"},
        "prompt_keywords": "新中式、水墨意境、实木家具、禅意、东方、传统元素",
    },
]


def example_scene():
    s = copy.deepcopy(EXAMPLE)
    s["sceneId"] = uid()
    s["geometryVersionId"] = uid()
    s["confirmation"] = {"status": "draft", "measurementRevision": 1}
    return s


def single_room_scene():
    scene = example_scene()
    f = scene["floors"][0]
    room = f["rooms"][0]
    room.update(
        name="我的空间",
        type="other",
        boundaryMm=[[0, 0], [4000, 0], [4000, 5000], [0, 5000]],
        computedAreaMm2=20_000_000,
    )
    f["rooms"] = [room]
    f["walls"] = []
    f["openings"] = []
    f["obstacles"] = []
    center = [[-100, -100], [4100, -100], [4100, 5100], [-100, 5100]]
    room["wallRefs"] = []
    for i in range(4):
        wid = "wall-" + str(i + 1)
        f["walls"].append(
            {
                "id": wid,
                "startMm": center[i],
                "endMm": center[(i + 1) % 4],
                "thicknessMm": 200,
                "heightMm": 2800,
                "structuralRole": "unknown",
                "locked": True,
            }
        )
        room["wallRefs"].append({"wallId": wid, "side": "left"})
    scene["layout"].update(
        furniture=[],
        catalogSnapshot=[],
        cameraViews=[],
        materials=[],
        name="我的空间方案",
    )
    scene["measurements"] = []
    return scene


def budget_for(scene):
    from .estimates import renovation_lines, money

    lookup = {x["skuId"]: x for x in scene["layout"]["catalogSnapshot"]}
    lines = []
    for f in scene["layout"]["furniture"]:
        c = lookup.get(f["skuId"], {})
        price = c.get("priceMinor")
        lines.append(
            {
                "itemKey": f["id"],
                "title": c.get("name", "自定义家具"),
                "quantity": 1,
                "unit": "件",
                "unitPriceMinor": price,
                "amountMinor": price,
                "priceState": "unknown" if price is None else "estimated",
                "source": c.get("sourceType", "unknown"),
                "roomId": f["roomId"],
                "category": "furniture",
            }
        )
    furniture_total = sum(x["amountMinor"] or 0 for x in lines)
    quantities, renovation = renovation_lines(scene)
    lines.extend(renovation)
    total = sum(x["amountMinor"] or 0 for x in lines)
    reserve_percent = scene["layout"].get("renovation", {}).get("contingencyPercent", 0)
    reserve = money(reserve_percent / 100, total)
    return {
        "currency": "CNY",
        "knownSubtotalMinor": total,
        "unknownLineCount": sum(x["priceState"] == "unknown" for x in lines),
        "lines": lines,
        "quantities": quantities,
        "furnitureSubtotalMinor": furniture_total,
        "renovationSubtotalMinor": total - furniture_total,
        "contingencyMinor": reserve,
        "estimatedTotalMinor": total + reserve,
        "assumptions": [
            "工程量来自房间净轮廓；墙面扣除关联门窗面积。材料含用户设定损耗，人工不加损耗。",
            "启用房间估算后统计地面、墙面、顶面的材料和人工；水电等按用户补充清单计入。",
            "内置演示价格是研发夹具，不是商家报价；未报价项单独列出。",
            "正式下单前需核实商品尺寸和价格。",
        ],
    }
