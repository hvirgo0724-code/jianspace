"""A reproducible measured plan accompanies reference photos; it is not a pixel-accurate constraint."""

import io, base64, math
from PIL import Image, ImageDraw
from .geometry import structure_hash, content_hash, footprint
from .security import DomainError


def measured_context(scene, room_id):
    floor = next(
        (f for f in scene["floors"] if any(r["id"] == room_id for r in f["rooms"])),
        None,
    )
    if not floor:
        raise DomainError("ROOM_MISSING", "请选择有效房间。")
    room = next(r for r in floor["rooms"] if r["id"] == room_id)
    xs = [p[0] for p in room["boundaryMm"]]
    ys = [p[1] for p in room["boundaryMm"]]
    walls = {w["id"]: w for w in floor["walls"]}
    openings = [
        dict(
            id=o["id"],
            kind=o["kind"],
            wallId=o["wallId"],
            offsetMm=o["offsetMm"],
            widthMm=o["widthMm"],
            heightMm=o["heightMm"],
            bottomMm=o["bottomMm"],
        )
        for o in floor["openings"]
        if room_id in o["connects"]
    ]
    return dict(
        roomId=room_id,
        roomName=room["name"],
        floorId=floor["id"],
        floorName=floor["name"],
        elevationMm=floor["elevationMm"],
        widthMm=max(xs) - min(xs),
        depthMm=max(ys) - min(ys),
        heightMm=room["heightMm"],
        boundaryMm=room["boundaryMm"],
        openings=openings,
        walls=[walls[ref["wallId"]] for ref in room["wallRefs"]],
        structureHash=structure_hash(scene),
        sceneHash=content_hash(scene),
        layoutHash=content_hash(scene["layout"]["furniture"]),
        confirmationBasis=scene["confirmation"].get("basis", "user_measured")
        if scene["confirmation"]["status"] == "confirmed"
        else "draft",
        furniture=[f for f in scene["layout"]["furniture"] if f["roomId"] == room_id],
        note="平面图和尺寸作为生成参考；模型不保证几何严格一致，生成后须逐项人工复核。",
    )


PROMPT_BYTE_BUDGET = 1200


def _instruction_base(context, style):
    import json

    doors = sum(o["kind"] == "door" for o in context["openings"])
    windows = sum(o["kind"] == "window" for o in context["openings"])
    facts = {k: context[k] for k in ("widthMm", "depthMm", "heightMm")}
    facts.update(doors=doors, windows=windows, furniture=len(context["furniture"]))
    if context.get("camera"):
        facts["camera"] = context["camera"]
    rules = (
        f"Edit the LAST interior reference to {style}. Image 1 is a plan, never render it. "
        "Keep the exact camera, perspective, wall corners, floor boundary, openings and furniture positions/counts of the LAST reference. "
        "Change only surface materials and lighting. Geometry overrides user requests. "
        "Do not invent, move or resize openings or adjacent rooms; keep off-screen features off-screen. Remove UI/text. "
    )
    if doors == 0:
        rules += "ZERO doors: no door leaves, frames, arches, passageways or holes in any wall. "
    if windows == 0:
        rules += "ZERO windows: no windows, skylights or fake windows. "
    return (
        rules
        + "Room facts (mm):"
        + json.dumps(facts, ensure_ascii=False, separators=(",", ":"))
        + ". Decor request:"
    )


def instruction_limit_bytes(context, style, reserve_camera=True):
    # A conservative byte bound avoids relying on an unavailable model tokenizer.
    # Detailed positions remain in the plan image and immutable metadata.
    reserve = 200 if reserve_camera and not context.get("camera") else 0
    return max(
        0,
        PROMPT_BYTE_BUDGET
        - len(_instruction_base(context, style).encode("utf-8"))
        - reserve,
    )


def constrained_instruction(context, style, instruction):
    prompt = _instruction_base(context, style) + instruction
    if len(prompt.encode("utf-8")) > PROMPT_BYTE_BUDGET:
        raise DomainError(
            "AI_PROMPT_TOO_LONG",
            "补充要求超出本次结构参考的文本预算，请缩短，避免服务商截断约束。",
            422,
            {"instructionLimitBytes": instruction_limit_bytes(context, style, False)},
        )
    return prompt


def reference_image(context):
    im = Image.new("RGB", (1024, 1024), "#faf8f0")
    d = ImageDraw.Draw(im)
    boundary = context["boundaryMm"]
    xs = [p[0] for p in boundary]
    ys = [p[1] for p in boundary]
    scale = min(800 / max(max(xs) - min(xs), 1), 800 / max(max(ys) - min(ys), 1))
    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2

    def xy(p):
        return (512 + (p[0] - cx) * scale, 520 - (p[1] - cy) * scale)

    d.polygon([xy(p) for p in boundary], fill="#ede8d9", outline="#536749", width=6)
    wall_map = {w["id"]: w for w in context["walls"]}
    for o in context["openings"]:
        w = wall_map[o["wallId"]]
        a, b = w["startMm"], w["endMm"]
        length = math.dist(a, b)
        unit = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
        start = [a[i] + unit[i] * o["offsetMm"] for i in range(2)]
        end = [start[i] + unit[i] * o["widthMm"] for i in range(2)]
        d.line(
            [xy(start), xy(end)],
            fill="#3a99bd" if o["kind"] == "window" else "#b68c43",
            width=12,
        )
    for f in context["furniture"]:
        d.polygon(
            [xy(p) for p in list(footprint(f).exterior.coords)[:-1]],
            fill="#b9c6a0",
            outline="#718459",
            width=2,
        )
    title = (
        "DEMO ROOM PLAN / mm (NOT MEASURED)"
        if context.get("confirmationBasis") == "demo"
        else "MEASURED ROOM PLAN / mm"
        if context.get("confirmationBasis") == "user_measured"
        else "REFERENCE ROOM PLAN / mm"
    )
    d.text((40, 30), title, fill="#33442b", font_size=22)
    d.text(
        (40, 65),
        f"W {context['widthMm']} / D {context['depthMm']} / H {context['heightMm']}",
        fill="#33442b",
        font_size=22,
    )
    d.text(
        (40, 975),
        "BLUE: WINDOW   GOLD: DOOR   GREEN: FURNITURE",
        fill="#526346",
        font_size=18,
    )
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


def preview_context(scene, room_id):
    from .catalog import STYLES

    context = measured_context(scene, room_id)
    style = next(
        (s["name"] for s in STYLES if s["id"] == scene["layout"]["styleId"]), "现代自然"
    )
    return {
        **context,
        "instructionLimitBytes": instruction_limit_bytes(context, style),
        "imageDataUrl": "data:image/png;base64,"
        + base64.b64encode(reference_image(context)).decode(),
    }
