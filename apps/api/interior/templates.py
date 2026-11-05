"""Measured, editable sample homes. Dimensions are fictional millimetre references."""

import copy
import math
from .catalog import example_scene, single_room_scene, CATALOG


def rectangle_floor(fid, name, elevation, specs):
    """Specs use wall-centre rectangles; rooms are inset by half the 200 mm wall."""
    floor = dict(
        id=fid,
        name=name,
        elevationMm=elevation,
        rooms=[],
        walls=[],
        openings=[],
        obstacles=[],
    )
    edges = []
    for key, title, kind, rect, height in specs:
        x0, y0, x1, y1 = rect
        rid = fid + "-" + key
        floor["rooms"].append(
            dict(
                id=rid,
                name=title,
                type=kind,
                heightMm=height,
                boundaryMm=[
                    [x0 + 100, y0 + 100],
                    [x1 - 100, y0 + 100],
                    [x1 - 100, y1 - 100],
                    [x0 + 100, y1 - 100],
                ],
                computedAreaMm2=(x1 - x0 - 200) * (y1 - y0 - 200),
                wallRefs=[],
            )
        )
        edges.extend(
            [
                (0, y0, x0, x1, rid, "left", height),
                (1, x1, y0, y1, rid, "left", height),
                (0, y1, x0, x1, rid, "right", height),
                (1, x0, y0, y1, rid, "right", height),
            ]
        )
    lines = sorted({(e[0], e[1]) for e in edges})
    owners = {}
    for axis, coordinate in lines:
        relevant = [e for e in edges if e[:2] == (axis, coordinate)]
        cuts = sorted({v for e in relevant for v in e[2:4]})
        for lo, hi in zip(cuts, cuts[1:]):
            adjacent = [e for e in relevant if e[2] <= lo and e[3] >= hi]
            if not adjacent:
                continue
            wid = fid + "-wall-" + str(len(floor["walls"]) + 1)
            floor["walls"].append(
                dict(
                    id=wid,
                    startMm=[lo, coordinate] if axis == 0 else [coordinate, lo],
                    endMm=[hi, coordinate] if axis == 0 else [coordinate, hi],
                    thicknessMm=200,
                    heightMm=max(e[6] for e in adjacent),
                    structuralRole="unknown",
                    locked=True,
                )
            )
            owners[wid] = [e[4] for e in adjacent]
            for e in adjacent:
                next(r for r in floor["rooms"] if r["id"] == e[4])["wallRefs"].append(
                    dict(wallId=wid, side=e[5])
                )
    connected = set()
    private_connected = set()
    for wall in sorted(
        floor["walls"],
        key=lambda w: (
            0
            if any(
                next(r["type"] for r in floor["rooms"] if r["id"] == rid) == "hall"
                for rid in owners[w["id"]]
            )
            else 1,
            -math.dist(w["startMm"], w["endMm"]),
        ),
    ):
        linked = owners[wall["id"]]
        length = round(math.dist(wall["startMm"], wall["endMm"]))
        pair = tuple(sorted(linked))
        if len(linked) == 2 and pair not in connected and length >= 1200:
            # Connect living/hall spaces to rooms; avoid bedroom-to-bedroom shortcuts.
            kinds = [
                next(r["type"] for r in floor["rooms"] if r["id"] == rid)
                for rid in linked
            ]
            if "stairwell" in kinds:
                continue
            public = ("living", "hall", "dining", "courtyard", "terrace")
            if not any(k in public for k in kinds):
                continue
            private = [rid for rid, kind in zip(linked, kinds) if kind not in public]
            if any(rid in private_connected for rid in private):
                continue
            private_connected.update(private)
            connected.add(pair)
            width = min(1800, length - 300) if all(k in public for k in kinds) else 900
            floor["openings"].append(
                dict(
                    id=fid + "-door-" + str(len(floor["openings"])),
                    kind="door",
                    model="archway" if all(k in public for k in kinds) else "hinged",
                    wallId=wall["id"],
                    offsetMm=(length - width) // 2,
                    widthMm=width,
                    bottomMm=0,
                    heightMm=2200,
                    connects=linked,
                )
            )
        elif len(linked) == 1 and length >= 1800:
            room = next(r for r in floor["rooms"] if r["id"] == linked[0])
            if room["type"] in ("hall", "courtyard", "terrace", "stairwell"):
                continue
            large = room["type"] in ("living", "dining")
            width = min(3200 if large else 1800, length - 600)
            floor["openings"].append(
                dict(
                    id=fid + "-window-" + str(len(floor["openings"])),
                    kind="window",
                    model="floor-to-ceiling" if large else "casement",
                    wallId=wall["id"],
                    offsetMm=(length - width) // 2,
                    widthMm=width,
                    bottomMm=100 if large else 900,
                    heightMm=min(room["heightMm"] - 250, 2600)
                    if large
                    else min(1400, room["heightMm"] - 1050),
                    connects=[linked[0], None],
                )
            )
    # An exterior entrance in the first living/hall room, separate from window openings.
    entry = next(
        (r for r in floor["rooms"] if r["type"] in ("living", "hall")),
        floor["rooms"][0],
    )
    candidates = [
        w
        for w in floor["walls"]
        if owners[w["id"]] == [entry["id"]]
        and math.dist(w["startMm"], w["endMm"]) >= 1300
    ]
    if candidates:
        wall = min(
            candidates, key=lambda w: sum(p[1] for p in (w["startMm"], w["endMm"]))
        )
        floor["openings"] = [o for o in floor["openings"] if o["wallId"] != wall["id"]]
        floor["openings"].append(
            dict(
                id=fid + "-entrance",
                kind="door",
                wallId=wall["id"],
                offsetMm=250,
                widthMm=1000,
                bottomMm=0,
                heightMm=2100,
                connects=[entry["id"], None],
            )
        )
    return floor


H = 2800
SPECS = {
    "one-bedroom": [
        ("living", "客厅", "living", (0, 0, 4500, 5000), H),
        ("bed", "卧室", "bedroom", (0, 5000, 4500, 8600), H),
        ("kitchen", "厨房", "kitchen", (4500, 0, 7000, 2500), H),
        ("bath", "卫生间", "bathroom", (4500, 2500, 7000, 5000), H),
    ],
    "two-bedroom": [
        ("living", "客厅", "living", (0, 0, 9000, 4000), H),
        ("master", "主卧", "bedroom", (0, 4000, 3600, 8200), H),
        ("bed", "次卧", "bedroom", (3600, 4000, 6800, 8200), H),
        ("kitchen", "厨房", "kitchen", (6800, 4000, 9000, 8200), H),
        ("bath", "卫生间", "bathroom", (6400, -2400, 9000, 0), H),
    ],
    "three-bedroom": [
        ("living", "客厅", "living", (0, 0, 6000, 4500), H),
        ("kitchen", "厨房", "kitchen", (6000, 0, 9000, 3000), H),
        ("bath", "卫生间", "bathroom", (9000, 0, 12000, 3000), H),
        ("hall", "入户过厅", "hall", (6000, 3000, 12000, 4500), H),
        ("master", "主卧", "bedroom", (0, 4500, 4200, 9000), H),
        ("bed", "次卧", "bedroom", (4200, 4500, 8100, 9000), H),
        ("third", "儿童房", "bedroom", (8100, 4500, 12000, 9000), H),
    ],
    "three-bedroom-plus": [
        ("living", "客厅", "living", (0, 0, 6200, 4400), H),
        ("dining", "餐厅", "dining", (6200, 0, 11000, 4400), H),
        ("master", "主卧", "bedroom", (0, 4400, 3800, 9000), H),
        ("bed", "次卧", "bedroom", (3800, 4400, 7400, 9000), H),
        ("third", "儿童房", "bedroom", (7400, 4400, 11000, 9000), H),
        ("kitchen", "厨房", "kitchen", (6200, -3000, 11000, 0), H),
        ("bath", "客卫", "bathroom", (0, -2600, 3000, 0), H),
        ("bath2", "第二卫生间", "bathroom", (3000, -2600, 6200, 0), H),
    ],
}

DEFINITIONS = [
    ("single-room", "单房间起点", "自由量房", "先输入实测尺寸，再添加更多空间。"),
    ("two-room", "两空间体验户型", "基础体验", "客厅与卧室，保留原有演示家具。"),
    ("empty", "两空间空置户型", "空置起点", "沿用基础轮廓，自由布置家具家电。"),
    ("one-bedroom", "一室一厅一卫一厨", "紧凑平层", "独立卧室、客厅、厨房与卫生间。"),
    ("two-bedroom", "两室一厅一卫一厨", "舒适平层", "主次卧分区，客厅串联日常生活。"),
    ("three-bedroom", "三室一厅一卫一厨", "家庭平层", "主卧、次卧与儿童房，独立厨卫。"),
    (
        "three-bedroom-plus",
        "三室两厅两卫一厨",
        "改善平层",
        "独立客餐厅与双卫生间，适合多人家庭。",
    ),
    (
        "loft",
        "复式 Loft",
        "挑空夹层",
        "下层会客与厨卫，上层卧室；含挑空、楼梯和夹层平台。",
    ),
    ("duplex", "跃层复式", "上下两层", "下层公共生活区，上层两间卧室与书房。"),
    (
        "villa",
        "独栋花园别墅",
        "双层独栋",
        "公共与卧室分层，贯通楼梯、落地窗和前庭小院。",
    ),
    ("courtyard", "小院平层住宅", "室内与小院", "三面围合小院，独立起居、卧室和厨卫。"),
]
TEMPLATE_IDS = tuple(d[0] for d in DEFINITIONS)


def furnish(scene):
    catalog = {i["id"]: i for i in CATALOG}
    choices = {
        "living": ["sofa-small", "coffee-table"],
        "bedroom": ["bed-single"],
        "kitchen": ["kitchen-cabinet"],
        "bathroom": ["toilet"],
        "study": ["desk"],
        "dining": ["dining-table"],
    }
    # Catalog IDs differ from display names; keep only existing generic entries.
    for floor in scene["floors"]:
        for room in floor["rooms"]:
            xs = [p[0] for p in room["boundaryMm"]]
            ys = [p[1] for p in room["boundaryMm"]]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            for n, key in enumerate(choices.get(room["type"], [])):
                item = catalog.get(key)
                if not item:
                    continue
                w, d, h = item["sizeMm"]
                x = (x0 + x1) // 2
                y = y1 - d // 2 - 250 - n * 1300
                if (
                    x - w / 2 < x0
                    or x + w / 2 > x1
                    or y - d / 2 < y0
                    or h > room["heightMm"]
                ):
                    continue
                sku = room["id"] + "-sku-" + str(n)
                oid = room["id"] + "-item-" + str(n)
                scene["layout"]["catalogSnapshot"].append(
                    dict(
                        skuId=sku,
                        name=item["name"],
                        sizeMm=copy.deepcopy(item["sizeMm"]),
                        priceMinor=None,
                        currency="CNY",
                        sourceType="user_input",
                        quotedAt="2026-10-23T00:00:00Z",
                        modelAssetId="builtin-" + item["modelKind"],
                        productUrl=None,
                    )
                )
                scene["layout"]["furniture"].append(
                    dict(
                        id=oid,
                        floorId=floor["id"],
                        roomId=room["id"],
                        skuId=sku,
                        positionMm=[x, y, 0],
                        sizeMm=copy.deepcopy(item["sizeMm"]),
                        rotationDeg=0,
                        locked=False,
                    )
                )


def template_scene(template_id):
    if template_id not in TEMPLATE_IDS:
        raise ValueError("Unknown home template")
    if template_id == "single-room":
        return single_room_scene()
    scene = example_scene()
    if template_id in ("two-room", "empty"):
        if template_id == "empty":
            scene["layout"].update(furniture=[], catalogSnapshot=[])
        return scene
    scene["layout"].update(
        furniture=[],
        catalogSnapshot=[],
        cameraViews=[],
        materials=[],
        name="户型初始方案",
    )
    scene["measurements"] = []
    if template_id in SPECS:
        scene["floors"] = [rectangle_floor("level-1", "一层", 0, SPECS[template_id])]
    elif template_id in ("villa", "courtyard"):
        lower_specs = [
            ("living", "起居厅", "living", (0, 0, 7500, 6000), 3200),
            ("kitchen", "厨房", "kitchen", (7500, 0, 11500, 4000), 3200),
            ("bath", "一层卫生间", "bathroom", (11500, 0, 14000, 4000), 3200),
            ("dining", "餐厅", "dining", (7500, 4000, 14000, 6000), 3200),
            ("bed", "客卧", "bedroom", (0, 6000, 4500, 12000), 3200),
            ("study", "书房", "study", (4500, 6000, 9000, 12000), 3200),
            (
                "hall",
                "楼梯厅" if template_id == "villa" else "休闲厅",
                "hall",
                (9000, 6000, 14000, 13000),
                3200,
            ),
            ("yard", "前庭小院", "courtyard", (0, -5000, 14000, 0), 3200),
        ]
        lower = rectangle_floor("level-1", "庭院一层", 0, lower_specs)
        yard = next(r for r in lower["rooms"] if r["type"] == "courtyard")
        for wall in lower["walls"]:
            attached = [
                r
                for r in lower["rooms"]
                if any(ref["wallId"] == wall["id"] for ref in r["wallRefs"])
            ]
            if attached == [yard]:
                wall["heightMm"] = 900
        # Planting boxes have matching physical footprints for rendering and walk collision.
        for n, x in enumerate((900, 13000)):
            lower["obstacles"].append(
                dict(
                    id=f"yard-planter-{n}",
                    kind="planter",
                    polygonMm=[
                        [x - 350, -4400],
                        [x + 350, -4400],
                        [x + 350, -3700],
                        [x - 350, -3700],
                    ],
                    baseZMm=0,
                    heightMm=550,
                    locked=True,
                )
            )
        scene["floors"] = [lower]
        if template_id == "villa":
            upper = rectangle_floor(
                "level-2",
                "别墅二层",
                3400,
                [
                    ("master", "主卧", "bedroom", (0, 0, 6500, 4800), 3000),
                    ("bed", "次卧", "bedroom", (6500, 0, 10500, 4800), 3000),
                    ("bath", "二层卫生间", "bathroom", (10500, 0, 14000, 4800), 3000),
                    ("corridor", "二层过厅", "hall", (0, 4800, 14000, 6500), 3000),
                    ("study", "家庭活动室", "study", (0, 6500, 5500, 12000), 3000),
                    ("child", "儿童房", "bedroom", (5500, 6500, 9500, 12000), 3000),
                    ("side", "楼梯侧廊", "hall", (9500, 6500, 11300, 10800), 3000),
                    (
                        "void",
                        "楼梯井（挑空）",
                        "stairwell",
                        (11300, 6500, 14000, 10800),
                        3000,
                    ),
                    ("landing", "二层平台", "hall", (9500, 10800, 14000, 13000), 3000),
                ],
            )
            lower["stairs"] = [
                dict(
                    id="villa-stair",
                    startMm=[12600, 6650],
                    endMm=[12600, 11800],
                    widthMm=1200,
                    targetFloorId="level-2",
                    stepCount=20,
                )
            ]
            upper["openings"] = [
                o for o in upper["openings"] if o["id"] != "level-2-entrance"
            ]
            front = next(
                w
                for w in upper["walls"]
                if w["startMm"][1] == w["endMm"][1] == 10800 and w["endMm"][0] >= 13200
            )
            upper["openings"] = [
                o for o in upper["openings"] if o["wallId"] != front["id"]
            ]
            upper["openings"].append(
                dict(
                    id="villa-arrival",
                    kind="door",
                    model="archway",
                    wallId=front["id"],
                    offsetMm=12000 - front["startMm"][0],
                    widthMm=1200,
                    bottomMm=0,
                    heightMm=2400,
                    connects=["level-2-landing", "level-2-void"],
                )
            )
            scene["floors"].append(upper)
    elif template_id == "loft":
        lower = rectangle_floor(
            "level-1",
            "Loft 下层",
            0,
            [
                ("living", "挑空客厅", "living", (0, 0, 7200, 4200), 5400),
                ("kitchen", "开放厨房", "kitchen", (0, 4200, 3000, 9200), 2600),
                ("bath", "卫生间", "bathroom", (3000, 4200, 4800, 9200), 2600),
                ("hall", "楼梯厅", "hall", (4800, 4200, 7200, 9200), 5400),
            ],
        )
        upper = rectangle_floor(
            "level-2",
            "Loft 夹层",
            2800,
            [
                ("bed", "夹层卧室", "bedroom", (0, 4200, 4800, 9200), 2600),
                ("landing", "夹层平台", "hall", (4800, 8000, 7200, 9200), 2600),
            ],
        )
        lower["stairs"] = [
            dict(
                id="loft-stair",
                startMm=[6000, 4300],
                endMm=[6000, 8400],
                widthMm=1000,
                targetFloorId="level-2",
                stepCount=16,
            )
        ]
        upper["openings"] = [
            o for o in upper["openings"] if o["id"] != "level-2-entrance"
        ]
        # Low guard wall on the edge facing the double-height living space.
        for w in upper["walls"]:
            if w["startMm"][1] == w["endMm"][1] == 4200:
                w["heightMm"] = 1050
                upper["openings"] = [
                    o for o in upper["openings"] if o["wallId"] != w["id"]
                ]
        # Stair arrival is an open passage in the landing's front guard wall.
        front = next(
            w for w in upper["walls"] if w["startMm"][1] == w["endMm"][1] == 8000
        )
        upper["openings"] = [o for o in upper["openings"] if o["wallId"] != front["id"]]
        upper["openings"].append(
            dict(
                id="loft-arrival",
                kind="door",
                model="archway",
                wallId=front["id"],
                offsetMm=700,
                widthMm=1000,
                bottomMm=0,
                heightMm=2100,
                connects=["level-2-landing", None],
            )
        )
        scene["floors"] = [lower, upper]
    else:
        lower = rectangle_floor(
            "level-1",
            "复式一层",
            0,
            [
                ("living", "客厅", "living", (0, 0, 6200, 4800), 2800),
                ("dining", "餐厅", "dining", (6200, 0, 10000, 4800), 2800),
                ("kitchen", "厨房", "kitchen", (0, 4800, 3500, 9000), 2800),
                ("bath", "一层卫生间", "bathroom", (3500, 4800, 6200, 9000), 2800),
                ("hall", "楼梯厅", "hall", (6200, 4800, 10000, 10500), 2800),
            ],
        )
        upper = rectangle_floor(
            "level-2",
            "复式二层",
            3000,
            [
                ("master", "主卧", "bedroom", (0, 0, 5000, 4500), 2800),
                ("bed", "次卧", "bedroom", (5000, 0, 10000, 4500), 2800),
                ("study", "书房", "study", (0, 4500, 3500, 10500), 2800),
                ("corridor", "二层过厅", "hall", (3500, 4500, 10000, 6000), 2800),
                ("bath", "二层卫生间", "bathroom", (3500, 6000, 6200, 10500), 2800),
                ("passage", "侧廊", "hall", (6200, 6000, 7700, 9200), 2800),
                (
                    "void",
                    "楼梯井（挑空）",
                    "stairwell",
                    (7700, 6000, 10000, 9200),
                    2800,
                ),
                ("hall", "二层走廊", "hall", (6200, 9200, 10000, 10500), 2800),
            ],
        )
        # A hall alongside bedrooms connects the upstairs rooms without crossing a void.
        # Keep the upper stairwell empty: no floor slab underneath the stair flight.
        lower["stairs"] = [
            dict(
                id="duplex-stair",
                startMm=[8700, 5200],
                endMm=[8700, 9700],
                widthMm=1100,
                targetFloorId="level-2",
                stepCount=18,
            )
        ]
        upper["openings"] = [
            o for o in upper["openings"] if o["id"] != "level-2-entrance"
        ]
        front = next(
            w
            for w in upper["walls"]
            if w["startMm"][1] == w["endMm"][1] == 9200 and w["endMm"][0] >= 9250
        )
        upper["openings"] = [o for o in upper["openings"] if o["wallId"] != front["id"]]
        upper["openings"].append(
            dict(
                id="duplex-arrival",
                kind="door",
                model="archway",
                wallId=front["id"],
                offsetMm=8150 - front["startMm"][0],
                widthMm=1100,
                bottomMm=0,
                heightMm=2100,
                connects=["level-2-hall", "level-2-void"],
            )
        )
        scene["floors"] = [lower, upper]
    furnish(scene)
    return scene


def list_templates():
    result = []
    order = {
        key: i
        for i, key in enumerate(
            (
                "three-bedroom",
                "villa",
                "courtyard",
                "loft",
                "duplex",
                "one-bedroom",
                "two-bedroom",
                "three-bedroom-plus",
                "single-room",
                "two-room",
                "empty",
            )
        )
    }
    for key, title, tag, description in sorted(DEFINITIONS, key=lambda d: order[d[0]]):
        s = template_scene(key)
        result.append(
            dict(
                id=key,
                name=title,
                tag=tag,
                description=description,
                areaM2=round(
                    sum(
                        r["computedAreaMm2"]
                        for f in s["floors"]
                        for r in f["rooms"]
                        if r["type"] not in ("courtyard", "terrace", "stairwell")
                    )
                    / 1e6,
                    2,
                ),
                floorCount=len(s["floors"]),
                outdoorAreaM2=round(
                    sum(
                        r["computedAreaMm2"]
                        for f in s["floors"]
                        for r in f["rooms"]
                        if r["type"] in ("courtyard", "terrace")
                    )
                    / 1e6,
                    2,
                ),
                roomCount=sum(len(f["rooms"]) for f in s["floors"]),
                scenePreview=s,
            )
        )
    return result
