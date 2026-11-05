"""Explainable circulation heuristics. This is not a building-code compliance engine."""

import math
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union
from .geometry import footprint


def approach_zone(opening, wall, room, depth):
    if opening["kind"] != "door" or opening["bottomMm"] > 25:
        return None
    ref = next((r for r in room["wallRefs"] if r["wallId"] == wall["id"]), None)
    if not ref:
        return None
    a, b = wall["startMm"], wall["endMm"]
    length = math.dist(a, b)
    if not length:
        return None
    ux = (b[0] - a[0]) / length
    uy = (b[1] - a[1]) / length
    sign = 1 if ref["side"] == "left" else -1
    nx = -uy * sign
    ny = ux * sign
    start = [
        a[0] + ux * opening["offsetMm"] + nx * wall["thicknessMm"] / 2,
        a[1] + uy * opening["offsetMm"] + ny * wall["thicknessMm"] / 2,
    ]
    end = [start[0] + ux * opening["widthMm"], start[1] + uy * opening["widthMm"]]
    return Polygon(
        [
            start,
            end,
            [end[0] + nx * depth, end[1] + ny * depth],
            [start[0] + nx * depth, start[1] + ny * depth],
        ]
    )


def blocks_access(item, floor, room, passage):
    if item["positionMm"][2] >= 1700:
        return False
    shape = footprint(item)
    walls = {w["id"]: w for w in floor["walls"]}
    return any(
        shape.intersection(zone).area > 1
        for o in floor["openings"]
        if room["id"] in o["connects"]
        and (zone := approach_zone(o, walls[o["wallId"]], room, passage)) is not None
    )


def assess_layout(scene):
    pref = scene["layout"].get("preferences", {})
    passage = pref.get("passageMm", 900 if pref.get("elderly") else 600)
    issues = []
    reasons = [f"检查门口 {passage} mm 参考净空；保留结构与锁定物品。"]

    def add(code, message, ids):
        issues.append(
            dict(
                code=code,
                message=message,
                objectIds=ids,
                severity="warning",
                field="layout",
            )
        )

    for floor in scene["floors"]:
        walls = {w["id"]: w for w in floor["walls"]}
        for room in floor["rooms"]:
            objects = [
                f
                for f in scene["layout"]["furniture"]
                if f["roomId"] == room["id"]
                and f["floorId"] == floor["id"]
                and f["positionMm"][2] < 1700
            ]
            for f in objects:
                if blocks_access(f, floor, room, passage):
                    add(
                        "DOOR_APPROACH",
                        room["name"] + " 的门口净空被家具占用。",
                        [f["id"], room["id"]],
                    )
            doors = [
                o
                for o in floor["openings"]
                if o["kind"] == "door" and room["id"] in o["connects"]
            ]
            for door in doors:
                if door["widthMm"] - 90 < passage:
                    add(
                        "PASSAGE_WIDTH",
                        room["name"] + f" 的门洞扣除参考门框后不足 {passage} mm。",
                        [door["id"]],
                    )
            poly = Polygon(room["boundaryMm"])
            obstacles = [footprint(f).buffer(passage / 2) for f in objects]
            obstacles += [
                Polygon(o["polygonMm"]).buffer(passage / 2)
                for o in floor["obstacles"]
                if o["baseZMm"] < 1700
            ]
            free = poly.buffer(-passage / 2).difference(unary_union(obstacles))
            parts = list(free.geoms) if free.geom_type == "MultiPolygon" else [free]
            usable = [p for p in parts if p.area >= passage * passage]
            if not usable:
                add(
                    "NO_CLEAR_AREA",
                    room["name"] + " 缺少满足参考宽度的可站立区域。",
                    [room["id"]],
                )
            elif len(usable) > 1:
                add(
                    "DISCONNECTED_PATH",
                    room["name"] + " 的可通行区域被分隔，请复核家具间通路。",
                    [room["id"]],
                )
            for f in objects:
                if f["sizeMm"][2] < 1000:
                    continue
                for window in [
                    o
                    for o in floor["openings"]
                    if o["kind"] == "window"
                    and room["id"] in o["connects"]
                    and o["bottomMm"] < f["positionMm"][2] + f["sizeMm"][2]
                ]:
                    wall = walls[window["wallId"]]
                    a, b = wall["startMm"], wall["endMm"]
                    length = math.dist(a, b)
                    ux = (b[0] - a[0]) / length
                    uy = (b[1] - a[1]) / length
                    line = LineString(
                        [
                            (
                                a[0] + ux * window["offsetMm"],
                                a[1] + uy * window["offsetMm"],
                            ),
                            (
                                a[0] + ux * (window["offsetMm"] + window["widthMm"]),
                                a[1] + uy * (window["offsetMm"] + window["widthMm"]),
                            ),
                        ]
                    )
                    if footprint(f).intersects(
                        line.buffer(wall["thicknessMm"] / 2 + 200)
                    ):
                        add(
                            "WINDOW_BLOCKED",
                            room["name"] + " 的高件物品靠近窗前，请复核采光与开窗。",
                            [f["id"], window["id"]],
                        )
    catalog = {c["skuId"]: c for c in scene["layout"]["catalogSnapshot"]}
    if pref.get("elderly"):
        reasons.append(
            "已按长者需求检查较宽门口净空；尚需现场复核扶手、防滑和无障碍条件。"
        )
    if pref.get("children"):
        reasons.append(
            "儿童家庭建议复核高柜固定、窗边攀爬与家具圆角，当前不自动判断产品安全。"
        )
    if pref.get("occupants", 1) > 1:
        beds = sum(
            2 if f["sizeMm"][0] >= 1400 else 1
            for f in scene["layout"]["furniture"]
            if "床" in catalog.get(f["skuId"], {}).get("name", "")
            and "床头" not in catalog.get(f["skuId"], {}).get("name", "")
        )
        if beds < pref["occupants"]:
            add(
                "SLEEPING_CAPACITY",
                f"参考床位约 {beds} 人，低于居住人数 {pref['occupants']}，请复核卧室配置。",
                [],
            )
    if pref.get("storagePriority"):
        storage = sum(
            any(
                k in catalog.get(f["skuId"], {}).get("name", "") for k in ("柜", "书架")
            )
            for f in scene["layout"]["furniture"]
        )
        reasons.append(
            f"当前有 {storage} 件柜架类物品，供 {pref.get('occupants', 1)} 人家庭复核收纳需求。"
        )
    budget = pref.get("budgetMinor")
    known = sum(
        catalog.get(f["skuId"], {}).get("priceMinor") or 0
        for f in scene["layout"]["furniture"]
    )
    if budget is not None and known > budget:
        add(
            "OVER_BUDGET",
            "现有家具已知报价超过目标预算，重新摆放不会降低采购单价。",
            [],
        )
    return dict(
        score=max(0, 100 - len(issues) * 8),
        reasons=reasons,
        warnings=[i["message"] for i in issues],
        issues=issues,
        note="净空、连通和窗前检查为几何启发式建议，不构成规范验收。",
    )
