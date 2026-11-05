import io, json, csv, math
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.colors import HexColor
from .catalog import budget_for


def csv_safe(value):
    if isinstance(value, str) and value.lstrip().startswith(
        ("=", "+", "-", "@", "\t", "\r")
    ):
        return "'" + value
    return value


def export_scene(scene, fmt="pdf"):
    if fmt == "json":
        return (
            json.dumps(scene, ensure_ascii=False, indent=2).encode(),
            "application/json",
            "方案场景.json",
        )
    if fmt == "csv":
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(
            ["项目", "房间", "数量", "单位", "单价（元）", "金额（元）", "价格来源"]
        )
        rooms = {
            r["id"]: f["name"] + " / " + r["name"]
            for f in scene["floors"]
            for r in f["rooms"]
        }
        for l in budget_for(scene)["lines"]:
            w.writerow(
                [
                    csv_safe(l["title"]),
                    csv_safe(rooms.get(l["roomId"], "")),
                    l["quantity"],
                    csv_safe(l["unit"]),
                    "" if l["unitPriceMinor"] is None else l["unitPriceMinor"] / 100,
                    "" if l["amountMinor"] is None else l["amountMinor"] / 100,
                    l["source"],
                ]
            )
        budget = budget_for(scene)
        w.writerow(
            [
                "已知报价小计",
                "",
                "",
                "",
                "",
                budget["knownSubtotalMinor"] / 100,
                "不含待询价金额",
            ]
        )
        w.writerow(
            ["预留金", "", "", "", "", budget["contingencyMinor"] / 100, "用户设定比例"]
        )
        w.writerow(
            [
                "已知预计总额",
                "",
                "",
                "",
                "",
                budget["estimatedTotalMinor"] / 100,
                "不含待询价金额",
            ]
        )
        return out.getvalue().encode("utf-8-sig"), "text/csv", "装修与家具预算清单.csv"
    if fmt != "pdf":
        raise ValueError("Unsupported export")
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(842, 595))
    c.setTitle("筑见 · 空间设计方案")
    for f in scene["floors"]:
        c.setFillColor(HexColor("#faf8f3"))
        c.rect(0, 0, 842, 595, fill=1, stroke=0)
        c.setFont("STSong-Light", 22)
        c.setFillColor(HexColor("#283b32"))
        c.drawString(35, 550, "筑见 / " + scene["layout"]["name"])
        c.setFont("STSong-Light", 10)
        c.drawString(
            35,
            526,
            f["name"] + f" · 标高 {f['elevationMm']} mm · 概念方案，不作为施工图",
        )
        points = [p for r in f["rooms"] for p in r["boundaryMm"]]
        minx = min(p[0] for p in points)
        miny = min(p[1] for p in points)
        maxx = max(p[0] for p in points)
        maxy = max(p[1] for p in points)
        scale = min(720 / max(maxx - minx, 1), 375 / max(maxy - miny, 1))
        ox = 60 - minx * scale
        oy = 100 - miny * scale
        for r in f["rooms"]:
            p = c.beginPath()
            for i, (x, y) in enumerate(r["boundaryMm"]):
                (p.moveTo if i == 0 else p.lineTo)(ox + x * scale, oy + y * scale)
            p.close()
            c.setFillColor(HexColor("#ede8d9"))
            c.setStrokeColor(HexColor("#485b4c"))
            c.drawPath(p, fill=1, stroke=1)
            x = sum(v[0] for v in r["boundaryMm"]) / len(r["boundaryMm"])
            y = sum(v[1] for v in r["boundaryMm"]) / len(r["boundaryMm"])
            c.setFillColor(HexColor("#556453"))
            c.drawCentredString(
                ox + x * scale,
                oy + y * scale,
                r["name"] + f"  {r['computedAreaMm2'] / 1e6:.2f} m²",
            )
        walls = {w["id"]: w for w in f["walls"]}
        c.setLineCap(0)
        for wall in walls.values():
            c.setLineWidth(wall["thicknessMm"] * scale)
            c.setStrokeColor(HexColor("#60704f"))
            c.line(
                ox + wall["startMm"][0] * scale,
                oy + wall["startMm"][1] * scale,
                ox + wall["endMm"][0] * scale,
                oy + wall["endMm"][1] * scale,
            )
        for opening in f["openings"]:
            wall = walls[opening["wallId"]]
            a, b = wall["startMm"], wall["endMm"]
            length = math.dist(a, b)
            ux = (b[0] - a[0]) / length
            uy = (b[1] - a[1]) / length
            x = a[0] + ux * opening["offsetMm"]
            y = a[1] + uy * opening["offsetMm"]
            ex = x + ux * opening["widthMm"]
            ey = y + uy * opening["widthMm"]
            c.setStrokeColor(HexColor("#faf8f3"))
            c.setLineWidth(wall["thicknessMm"] * scale + 1)
            c.line(ox + x * scale, oy + y * scale, ox + ex * scale, oy + ey * scale)
            c.setStrokeColor(
                HexColor("#99b4b3")
                if opening["kind"] == "window"
                else HexColor("#c0aa7f")
            )
            c.setLineWidth(2 if opening["kind"] == "window" else 0.7)
            c.line(ox + x * scale, oy + y * scale, ox + ex * scale, oy + ey * scale)
        c.setLineWidth(0.7)
        for stair in f.get("stairs", []):
            a, b = stair["startMm"], stair["endMm"]
            run = math.dist(a, b)
            if run == 0:
                continue
            nx = -(b[1] - a[1]) / run * stair["widthMm"] / 2
            ny = (b[0] - a[0]) / run * stair["widthMm"] / 2
            c.setStrokeColor(HexColor("#8a8068"))
            for i in range(stair["stepCount"] + 1):
                t = i / stair["stepCount"]
                x = a[0] + (b[0] - a[0]) * t
                y = a[1] + (b[1] - a[1]) * t
                c.line(
                    ox + (x + nx) * scale,
                    oy + (y + ny) * scale,
                    ox + (x - nx) * scale,
                    oy + (y - ny) * scale,
                )
        for obj in scene["layout"]["furniture"]:
            if obj["floorId"] != f["id"]:
                continue
            x, y, _ = obj["positionMm"]
            w, d, _ = obj["sizeMm"]
            c.saveState()
            c.translate(ox + x * scale, oy + y * scale)
            c.rotate(obj["rotationDeg"])
            c.setFillColor(HexColor("#c3b293"))
            c.setStrokeColor(HexColor("#897b62"))
            c.roundRect(-w * scale / 2, -d * scale / 2, w * scale, d * scale, 3, fill=1)
            c.restoreState()
        c.setFont("STSong-Light", 9)
        c.drawString(
            35,
            55,
            "墙体结构性质默认为未知；拆改、承重、防水及机电方案须由专业人员复核。",
        )
        c.drawString(
            35,
            38,
            "户型状态："
            + (
                (
                    "演示尺寸已确认（虚构参考，非实测）"
                    if scene["confirmation"].get("basis") == "demo"
                    else "已确认实测"
                )
                if scene["confirmation"]["status"] == "confirmed"
                else "未确认草稿"
            ),
        )
        c.showPage()
    budget = budget_for(scene)
    c.setFont("STSong-Light", 20)
    c.drawString(40, 550, "装修与家具家电清单估算")
    y = 510
    c.setFont("STSong-Light", 11)
    for l in budget["lines"]:
        if y < 80:
            c.showPage()
            c.setFont("STSong-Light", 11)
            y = 540
        c.drawString(40, y, l["title"] + f" / {l['quantity']} {l['unit']}")
        c.drawRightString(
            790,
            y,
            "待询价"
            if l["amountMinor"] is None
            else f"CNY {l['amountMinor'] / 100:,.2f} / {l['source']}",
        )
        y -= 26
    if y < 160:
        c.showPage()
        c.setFont("STSong-Light", 11)
        y = 520
    c.drawString(
        40,
        y - 20,
        f"已知小计 CNY {budget['knownSubtotalMinor'] / 100:,.2f}；另有 {budget['unknownLineCount']} 项待询价。",
    )
    c.drawString(
        40,
        y - 38,
        f"预留金 CNY {budget['contingencyMinor'] / 100:,.2f}；已知预计总额 CNY {budget['estimatedTotalMinor'] / 100:,.2f}。",
    )
    c.setFont("STSong-Light", 9)
    for i, line in enumerate(budget["assumptions"]):
        c.drawString(40, 60 - i * 14, line)
    c.save()
    return buf.getvalue(), "application/pdf", "空间设计方案.pdf"
