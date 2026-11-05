"""Measured quantities and user-quoted prices; never invent local market prices."""

from decimal import Decimal, ROUND_HALF_UP
from shapely.geometry import Polygon, LineString


def money(quantity, price):
    if price is None:
        return None
    return int(
        (Decimal(str(quantity)) * Decimal(price)).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )


def renovation_lines(scene):
    settings = scene["layout"].get("renovation", {})
    waste = settings.get("wastePercent", 5) / 100
    rates = {r["roomId"]: r for r in settings.get("rooms", [])}
    quantities = []
    lines = []
    for floor in scene["floors"]:
        for room in floor["rooms"]:
            poly = Polygon(room["boundaryMm"])
            floor_area = poly.area / 1e6
            if room["type"] == "stairwell":
                floor_area = 0
            opening_area = sum(
                o["widthMm"] * o["heightMm"] / 1e6
                for o in floor["openings"]
                if room["id"] in o["connects"]
            )
            wall_area = max(0, poly.length * room["heightMm"] / 1e6 - opening_area)
            outdoor = room["type"] in ("courtyard", "terrace")
            ceiling_area = 0 if outdoor else poly.area / 1e6
            if outdoor:
                refs = {r["wallId"] for r in room["wallRefs"]}
                wall_area = max(
                    0,
                    sum(
                        LineString([w["startMm"], w["endMm"]])
                        .intersection(poly.buffer(w["thicknessMm"] / 2 + 1))
                        .length
                        * w["heightMm"]
                        for w in floor["walls"]
                        if w["id"] in refs
                    )
                    / 1e6
                    - opening_area,
                )
            q = dict(
                roomId=room["id"],
                floorId=floor["id"],
                name=floor["name"] + " / " + room["name"],
                floorAreaM2=round(floor_area, 3),
                wallAreaM2=round(wall_area, 3),
                ceilingAreaM2=round(ceiling_area, 3),
            )
            quantities.append(q)
            rate = rates.get(room["id"], {})
            if not rate.get("enabled", False):
                continue
            for key, title, base, material in [
                ("floorMaterialMinor", "地面材料", floor_area, True),
                ("floorLaborMinor", "地面铺装人工", floor_area, False),
                ("wallMaterialMinor", "墙面材料", wall_area, True),
                ("wallLaborMinor", "墙面施工人工", wall_area, False),
                ("ceilingMaterialMinor", "顶面材料", ceiling_area, True),
                ("ceilingLaborMinor", "顶面施工人工", ceiling_area, False),
            ]:
                if base <= 0:
                    continue
                quantity = round(base * (1 + waste if material else 1), 3)
                price = rate.get(key)
                lines.append(
                    dict(
                        itemKey=room["id"] + "-" + key,
                        title=room["name"] + " · " + title,
                        roomId=room["id"],
                        category="material" if material else "labor",
                        quantity=quantity,
                        unit="m²",
                        unitPriceMinor=price,
                        amountMinor=money(quantity, price),
                        priceState="unknown" if price is None else "estimated",
                        source="user_input",
                    )
                )
    for extra in settings.get("extraLines", []):
        price = extra.get("unitPriceMinor")
        quantity = extra["quantity"]
        lines.append(
            dict(
                itemKey=extra["id"],
                title=extra["title"],
                roomId=extra.get("roomId"),
                category=extra["category"],
                quantity=quantity,
                unit=extra["unit"],
                unitPriceMinor=price,
                amountMinor=money(quantity, price),
                priceState="unknown" if price is None else "estimated",
                source="user_input",
            )
        )
    return quantities, lines
