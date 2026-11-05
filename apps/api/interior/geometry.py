"""Deterministic millimetre geometry, independent of image-generation providers."""

import copy, hashlib, json, math
from itertools import combinations
from jsonschema import Draft202012Validator, FormatChecker
from shapely.geometry import Polygon, LineString, box
from shapely.affinity import rotate, translate
from shapely.ops import unary_union
from .config import ROOT

SCHEMA = json.loads((ROOT / "packages/scene/scene.schema.json").read_text("utf-8"))
validator = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


def canonical(value):
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        if value and all(isinstance(v, dict) and "id" in v for v in value):
            value = sorted(value, key=lambda v: v["id"])
        return [canonical(v) for v in value]
    return value


def content_hash(value):
    return hashlib.sha256(
        json.dumps(
            canonical(value),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode()
    ).hexdigest()


def structure_hash(scene):
    return content_hash(
        {k: scene[k] for k in ("schemaVersion", "unit", "coordinateSystem", "floors")}
    )


def normalized(scene):
    scene = copy.deepcopy(scene)
    for f in scene["floors"]:
        for r in f["rooms"]:
            p = r["boundaryMm"]
            r["computedAreaMm2"] = round(
                abs(
                    sum(
                        p[i][0] * p[(i + 1) % len(p)][1]
                        - p[(i + 1) % len(p)][0] * p[i][1]
                        for i in range(len(p))
                    )
                    / 2
                )
            )
    return scene


def footprint(f):
    w, d, _ = f["sizeMm"]
    x, y, _ = f["positionMm"]
    return translate(
        rotate(box(-w / 2, -d / 2, w / 2, d / 2), f["rotationDeg"], origin=(0, 0)), x, y
    )


def stair_footprint(stair):
    a, b = stair["startMm"], stair["endMm"]
    return LineString([a, b]).buffer(stair["widthMm"] / 2, cap_style=2)


def door_zone(opening, wall, room):
    swing = opening.get("swing")
    if opening["kind"] != "door" or opening.get("model") == "archway" or not swing:
        return None
    a, b = wall["startMm"], wall["endMm"]
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return None
    ux, uy = dx / length, dy / length
    side = next(
        (r["side"] for r in room["wallRefs"] if r["wallId"] == wall["id"]), None
    )
    if not side:
        return None
    sign = 1 if side == "left" else -1
    offset = opening["offsetMm"] + (
        opening["widthMm"] if swing["hinge"] == "end" else 0
    )
    hx = a[0] + ux * offset - uy * wall["thicknessMm"] / 2 * sign
    hy = a[1] + uy * offset + ux * wall["thicknessMm"] / 2 * sign
    direction = 1 if swing["direction"] == "ccw" else -1
    base = math.atan2(uy, ux) + (math.pi if swing["hinge"] == "end" else 0)
    arc = math.radians(swing["angleDeg"]) * direction
    points = [(hx, hy)] + [
        (
            hx + opening["widthMm"] * math.cos(base + arc * i / 24),
            hy + opening["widthMm"] * math.sin(base + arc * i / 24),
        )
        for i in range(25)
    ]
    return Polygon(points).buffer(30)


def validate_scene(scene, check_layout=True):
    issues = []

    def issue(code, message, ids=(), field="", severity="error"):
        issues.append(
            {
                "code": code,
                "severity": severity,
                "objectIds": list(ids),
                "field": field,
                "message": message,
            }
        )

    schema_errors = sorted(
        validator.iter_errors(scene), key=lambda e: str(list(e.path))
    )
    for e in schema_errors[:40]:
        issue("SCHEMA_INVALID", e.message, field=".".join(map(str, e.path)))
    if schema_errors:
        return {"valid": False, "issues": issues, "validatorVersion": "1.0"}
    if len(scene["floors"]) > 2:
        issue("FLOOR_UNSUPPORTED", "当前编辑器支持最多两个楼层。")
    ids = [f["id"] for f in scene["floors"]]
    floors_by_id = {f["id"]: f for f in scene["floors"]}
    if len({f["elevationMm"] for f in scene["floors"]}) != len(scene["floors"]):
        issue("FLOOR_ELEVATION", "各楼层的标高不能相同。")
    for floor in scene["floors"]:
        for group in ("rooms", "walls", "openings", "obstacles"):
            ids.extend(o["id"] for o in floor[group])
        rooms = {r["id"]: r for r in floor["rooms"]}
        walls = {w["id"]: w for w in floor["walls"]}
        polys = {}
        for r in rooms.values():
            p = Polygon(r["boundaryMm"])
            if not p.is_valid or p.area < 10000:
                issue("ROOM_INVALID", "房间轮廓自交或面积过小。", [r["id"]])
                continue
            if not p.exterior.is_ccw:
                issue("ROOM_ORIENTATION", "请按逆时针顺序绘制房间边界。", [r["id"]])
            if abs(p.area - r["computedAreaMm2"]) > 1:
                issue("AREA_MISMATCH", "净面积与边界不一致。", [r["id"]])
            polys[r["id"]] = p
            for wr in r["wallRefs"]:
                if wr["wallId"] not in walls:
                    issue(
                        "WALL_MISSING",
                        "房间引用了不存在的墙。",
                        [r["id"], wr["wallId"]],
                    )
            faces = []
            for wr in r["wallRefs"]:
                w = walls.get(wr["wallId"])
                if not w:
                    continue
                a, b = w["startMm"], w["endMm"]
                length = math.dist(a, b)
                if length < 1:
                    continue
                side = 1 if wr["side"] == "left" else -1
                nx = -(b[1] - a[1]) / length * w["thicknessMm"] / 2 * side
                ny = (b[0] - a[0]) / length * w["thicknessMm"] / 2 * side
                faces.append(
                    LineString([(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny)])
                )
            if faces and p.exterior.difference(unary_union(faces).buffer(1)).length > 5:
                issue(
                    "WALL_BOUNDARY_MISMATCH",
                    "房间净边界与引用墙的内表面不一致，请同步校正墙线。",
                    [r["id"]],
                )
        for (ra, pa), (rb, pb) in combinations(polys.items(), 2):
            if pa.intersection(pb).area > 1:
                issue("ROOM_OVERLAP", "两个房间的净空间重叠。", [ra, rb])
        for w in walls.values():
            if math.dist(w["startMm"], w["endMm"]) < 1:
                issue("WALL_ZERO_LENGTH", "墙段不能为零长度。", [w["id"]])
        for o in floor["openings"]:
            w = walls.get(o["wallId"])
            if not w:
                issue("WALL_MISSING", "洞口所属墙不存在。", [o["id"]])
                continue
            if o["offsetMm"] + o["widthMm"] > math.dist(w["startMm"], w["endMm"]) + 1:
                issue("OPENING_OUTSIDE", "门窗超出所属墙段。", [o["id"], w["id"]])
            if o["bottomMm"] + o["heightMm"] > w["heightMm"] + 1:
                issue("OPENING_HEIGHT", "门窗顶部超出墙高。", [o["id"]])
            if any(r is not None and r not in rooms for r in o["connects"]):
                issue("ROOM_MISSING", "洞口连接了不存在的房间。", [o["id"]])
            for rid in o["connects"]:
                if rid in rooms and not any(
                    ref["wallId"] == w["id"] for ref in rooms[rid]["wallRefs"]
                ):
                    issue(
                        "OPENING_ROOM_MISMATCH",
                        "门窗所属墙未与连接房间对应。",
                        [o["id"], rid],
                    )
            if o.get("swing", {}).get("roomId") not in (None, *o["connects"]):
                issue("DOOR_ROOM_MISMATCH", "门扇开向房间不在门洞连接中。", [o["id"]])
        for a, b in combinations(floor["openings"], 2):
            if (
                a["wallId"] == b["wallId"]
                and min(a["offsetMm"] + a["widthMm"], b["offsetMm"] + b["widthMm"])
                - max(a["offsetMm"], b["offsetMm"])
                > 1
            ):
                if min(
                    a["bottomMm"] + a["heightMm"], b["bottomMm"] + b["heightMm"]
                ) > max(a["bottomMm"], b["bottomMm"]):
                    issue("OPENING_OVERLAP", "同墙门窗洞口重叠。", [a["id"], b["id"]])
        obstacles = []
        for ob in floor["obstacles"]:
            p = Polygon(ob["polygonMm"])
            if not p.is_valid or p.area < 1:
                issue("OBSTACLE_INVALID", "固定设施轮廓无效。", [ob["id"]])
            else:
                obstacles.append(ob)
        stairs = floor.get("stairs", [])
        for stair in stairs:
            ids.append(stair["id"])
            target = floors_by_id.get(stair["targetFloorId"])
            if not target or target["elevationMm"] <= floor["elevationMm"]:
                issue(
                    "STAIR_TARGET", "楼梯必须连接到标高更高的有效楼层。", [stair["id"]]
                )
            if math.dist(stair["startMm"], stair["endMm"]) < 1000:
                issue("STAIR_LENGTH", "参考楼梯水平长度至少为 1000 mm。", [stair["id"]])
            shape = stair_footprint(stair)
            if not unary_union(list(polys.values())).buffer(1).covers(shape):
                issue("STAIR_OUTSIDE", "楼梯超出下层净空间。", [stair["id"]])
            if target:
                from shapely.geometry import Point

                if not any(
                    Polygon(r["boundaryMm"]).buffer(1).covers(Point(stair["endMm"]))
                    for r in target["rooms"]
                ):
                    issue(
                        "STAIR_LANDING",
                        "楼梯终点未落在目标楼层的平台内。",
                        [stair["id"]],
                    )
        if check_layout:
            furniture = [
                x for x in scene["layout"]["furniture"] if x["floorId"] == floor["id"]
            ]
            catalog = {c["skuId"]: c for c in scene["layout"]["catalogSnapshot"]}
            shapes = {}
            for f in furniture:
                room = rooms.get(f["roomId"])
                p = polys.get(f["roomId"])
                if room is None:
                    issue("ROOM_MISSING", "家具所属房间不存在。", [f["id"]])
                    continue
                shape = footprint(f)
                shapes[f["id"]] = shape
                if p is not None and not p.buffer(0.5).covers(shape):
                    issue(
                        "FURNITURE_OUTSIDE",
                        "家具超出房间净边界。",
                        [f["id"], room["id"]],
                    )
                if f["positionMm"][2] + f["sizeMm"][2] > room["heightMm"]:
                    issue("FURNITURE_HEIGHT", "家具高度超过层高。", [f["id"]])
                sku = catalog.get(f["skuId"])
                if not sku:
                    issue("SKU_MISSING", "家具缺少目录快照。", [f["id"]])
                elif sku["sizeMm"] != f["sizeMm"]:
                    issue(
                        "SKU_DIMENSIONS",
                        "家具尺寸与目录快照不一致，请转为自定义家具。",
                        [f["id"]],
                    )
                for o in floor["openings"]:
                    if (
                        o.get("swing", {}).get("roomId") == room["id"]
                        and o["wallId"] in walls
                        and min(
                            f["positionMm"][2] + f["sizeMm"][2],
                            o["bottomMm"] + o["heightMm"],
                        )
                        > max(f["positionMm"][2], o["bottomMm"])
                    ):
                        zone = door_zone(o, walls[o["wallId"]], room)
                        if zone is not None and shape.intersection(zone).area > 1:
                            issue(
                                "DOOR_SWING_COLLISION",
                                "家具阻挡门扇开启区域。",
                                [f["id"], o["id"]],
                            )
                for ob in obstacles:
                    if min(
                        f["positionMm"][2] + f["sizeMm"][2],
                        ob["baseZMm"] + ob["heightMm"],
                    ) > max(f["positionMm"][2], ob["baseZMm"]):
                        if shape.intersection(Polygon(ob["polygonMm"])).area > 1:
                            issue(
                                "OBSTACLE_COLLISION",
                                "家具与固定设施冲突。",
                                [f["id"], ob["id"]],
                            )
                for stair in stairs:
                    if shape.intersection(stair_footprint(stair)).area > 1:
                        issue(
                            "STAIR_COLLISION",
                            "家具占用了楼梯区域。",
                            [f["id"], stair["id"]],
                        )
            for a, b in combinations(furniture, 2):
                if (
                    a["id"] in shapes
                    and b["id"] in shapes
                    and shapes[a["id"]].intersection(shapes[b["id"]]).area > 1
                ):
                    if min(
                        a["positionMm"][2] + a["sizeMm"][2],
                        b["positionMm"][2] + b["sizeMm"][2],
                    ) > max(a["positionMm"][2], b["positionMm"][2]):
                        issue(
                            "FURNITURE_OVERLAP",
                            "家具实体相互重叠。",
                            [a["id"], b["id"]],
                        )
    ids.extend(f["id"] for f in scene["layout"]["furniture"])
    floor_ids = {f["id"] for f in scene["floors"]}
    for f in scene["layout"]["furniture"]:
        if f["floorId"] not in floor_ids:
            issue("FLOOR_MISSING", "家具所属楼层不存在。", [f["id"]])
    for m in scene["measurements"]:
        mf = floors_by_id.get(m["floorId"])
        local_targets = (
            {
                o["id"]
                for group in ("rooms", "walls", "openings", "obstacles")
                for o in mf[group]
            }
            if mf
            else set()
        )
        if m["targetId"] not in local_targets:
            issue(
                "MEASUREMENT_TARGET_MISSING",
                "测量记录所关联的空间对象不存在。",
                [m["id"]],
            )
        expected = round(m["rawValue"] * {"mm": 1, "cm": 10, "m": 1000}[m["rawUnit"]])
        if expected != m["normalizedMm"]:
            issue(
                "MEASUREMENT_UNIT_MISMATCH", "原始测量值与标准毫米值不一致。", [m["id"]]
            )
    if len(ids) != len(set(ids)):
        issue("DUPLICATE_ID", "场景对象标识存在重复。")
    all_room_ids = {r["id"] for f in scene["floors"] for r in f["rooms"]}
    reno = scene["layout"].get("renovation", {})
    rate_ids = [r["roomId"] for r in reno.get("rooms", [])]
    if len(rate_ids) != len(set(rate_ids)) or any(
        r not in all_room_ids for r in rate_ids
    ):
        issue("BUDGET_ROOM", "房间报价存在重复或关联了不存在的房间。")
    extras = reno.get("extraLines", [])
    if len({e["id"] for e in extras}) != len(extras) or any(
        e.get("roomId") and e["roomId"] not in all_room_ids for e in extras
    ):
        issue("BUDGET_REFERENCE", "补充费用标识重复或房间不存在。")
    return {
        "valid": not any(i["severity"] == "error" for i in issues),
        "issues": issues,
        "structureHash": structure_hash(scene),
        "validatorVersion": "1.0",
    }


def generate_layouts(scene, count=3):
    """Discrete candidates + deterministic collision checks; never alter structure."""
    from .models import uid
    from .layout_quality import approach_zone, assess_layout

    base = copy.deepcopy(scene)
    candidates = []
    floors = {f["id"]: f for f in base["floors"]}
    rooms = {r["id"]: r for f in base["floors"] for r in f["rooms"]}
    movable = [f for f in base["layout"]["furniture"] if not f["locked"]]
    locked = [f for f in base["layout"]["furniture"] if f["locked"]]
    preferences = base["layout"].get("preferences", {})
    passage = preferences.get("passageMm", 900 if preferences.get("elderly") else 600)
    zones = {}
    for fl in base["floors"]:
        walls = {w["id"]: w for w in fl["walls"]}
        for room in fl["rooms"]:
            zones[room["id"]] = [
                z
                for o in fl["openings"]
                if room["id"] in o["connects"]
                and (z := approach_zone(o, walls[o["wallId"]], room, passage))
                is not None
            ]
    catalog = {c["skuId"]: c for c in base["layout"]["catalogSnapshot"]}
    if not base["layout"]["furniture"]:
        return []
    # Candidate spacing stays independent from render pixels. Limit search explicitly.
    for variant in range(max(count * 4, 8)):
        trial = copy.deepcopy(base)
        placed = copy.deepcopy(locked)
        success = True
        for item in sorted(movable, key=lambda x: -(x["sizeMm"][0] * x["sizeMm"][1])):
            floor = floors[item["floorId"]]
            room = rooms[item["roomId"]]
            poly = Polygon(room["boundaryMm"])
            minx, miny, maxx, maxy = poly.bounds
            options = []
            for rot in [0, 90, 180, 270]:
                w, d = item["sizeMm"][:2]
                if rot % 180:
                    w, d = d, w
                xs = [minx + w / 2 + 60, maxx - w / 2 - 60, (minx + maxx) / 2]
                ys = [miny + d / 2 + 60, maxy - d / 2 - 60, (miny + maxy) / 2]
                xs.extend(range(round(minx + w / 2 + 100), round(maxx - w / 2), 500))
                ys.extend(range(round(miny + d / 2 + 100), round(maxy - d / 2), 500))
                for x in xs:
                    for y in ys:
                        if len(options) > 1400:
                            break
                        q = copy.deepcopy(item)
                        q["rotationDeg"] = rot
                        q["positionMm"] = [round(x), round(y), item["positionMm"][2]]
                        shape = footprint(q)
                        if not poly.covers(shape):
                            continue
                        conflicts = any(
                            p["floorId"] == item["floorId"]
                            and min(
                                item["positionMm"][2] + item["sizeMm"][2],
                                p["positionMm"][2] + p["sizeMm"][2],
                            )
                            > max(item["positionMm"][2], p["positionMm"][2])
                            and shape.intersection(footprint(p)).area > 1
                            for p in placed
                        )
                        if q["positionMm"][2] < 1700 and any(
                            shape.intersection(zone).area > 1
                            for zone in zones[room["id"]]
                        ):
                            conflicts = True
                        if any(
                            shape.intersection(stair_footprint(st)).area > 1
                            for st in floor.get("stairs", [])
                        ):
                            conflicts = True
                        for ob in floor["obstacles"]:
                            if shape.intersection(Polygon(ob["polygonMm"])).area > 1:
                                conflicts = True
                        for op in floor["openings"]:
                            if op.get("swing", {}).get("roomId") == room["id"]:
                                wall = next(
                                    (
                                        w
                                        for w in floor["walls"]
                                        if w["id"] == op["wallId"]
                                    ),
                                    None,
                                )
                                zone = door_zone(op, wall, room) if wall else None
                                if (
                                    zone is not None
                                    and shape.intersection(zone).area > 1
                                ):
                                    conflicts = True
                        if not conflicts:
                            # Favour walls while rotating the preference order for diverse variants.
                            wall_distance = min(x - minx, maxx - x, y - miny, maxy - y)
                            preference = (
                                wall_distance
                                + (x * (0.14 if variant % 2 else -0.14))
                                + y * (0.12 if variant % 3 else -0.12)
                            )
                            name = catalog.get(item["skuId"], {}).get("name", "")
                            if preferences.get("storagePriority") and any(
                                k in name for k in ("柜", "书架")
                            ):
                                preference += wall_distance * 1.5
                            options.append((preference, q))
            if not options:
                success = False
                break
            options.sort(key=lambda t: t[0])
            placed.append(options[min(variant // 3, len(options) - 1)][1])
        if success:
            trial["layout"]["furniture"] = placed
            trial["layout"]["id"] = uid()
            trial["sceneId"] = uid()
            trial["layout"]["name"] = ["布局方案 A", "布局方案 B", "布局方案 C"][
                len(candidates) % 3
            ]
            if validate_scene(trial)["valid"]:
                quality = assess_layout(trial)
                trial["layout"]["analysis"] = {
                    k: quality[k] for k in ("score", "reasons", "warnings")
                }
                sig = content_hash(placed)
                if all(
                    content_hash(c["layout"]["furniture"]) != sig for c in candidates
                ):
                    candidates.append(trial)
        if len(candidates) >= count:
            break
    return sorted(
        candidates, key=lambda c: -c["layout"].get("analysis", {}).get("score", 0)
    )
