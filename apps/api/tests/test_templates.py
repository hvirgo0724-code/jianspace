import copy
import pytest
from pypdf import PdfReader
import io
from interior.templates import TEMPLATE_IDS, template_scene
from interior.geometry import validate_scene, generate_layouts, structure_hash
from interior.exports import export_scene


@pytest.mark.parametrize("key", TEMPLATE_IDS)
def test_templates_are_valid_and_every_room_has_an_internal_route(key):
    s = template_scene(key)
    assert validate_scene(s)["valid"], validate_scene(s)["issues"]
    assert s["confirmation"]["status"] == "draft"
    for floor in s["floors"]:
        graph = {r["id"]: set() for r in floor["rooms"] if r["type"] != "stairwell"}
        for o in floor["openings"]:
            if o["kind"] == "door" and all(o["connects"]):
                a, b = o["connects"]
                if a not in graph or b not in graph:
                    continue
                graph[a].add(b)
                graph[b].add(a)
        reached = set()
        todo = [floor["rooms"][0]["id"]]
        while todo:
            rid = todo.pop()
            if rid not in reached:
                reached.add(rid)
                todo.extend(graph[rid] - reached)
        assert reached == set(graph), (key, graph, reached)


def test_templates_api_creation_and_upper_floor_round_trip(signed):
    listed = signed.get("/api/home-templates").json()["items"]
    assert {t["id"] for t in listed} == set(TEMPLATE_IDS)
    for key in ("three-bedroom", "loft", "duplex"):
        p = signed.post("/api/projects", json={"name": key, "templateId": key})
        assert p.status_code == 201, p.text
        w = signed.get(f"/api/projects/{p.json()['id']}/working-copy").json()
        assert validate_scene(w["scene"])["valid"]
        assert p.json()["rooms"] == sum(len(f["rooms"]) for f in w["scene"]["floors"])
    assert (
        signed.post(
            "/api/projects", json={"name": "bad", "templateId": "unknown"}
        ).status_code
        == 422
    )


@pytest.mark.parametrize("style", ["modern", "nordic", "mediterranean", "chinese"])
def test_exterior_style_is_saved_without_changing_confirmed_structure(
    signed, confirmed, style
):
    pid, working = confirmed
    scene = copy.deepcopy(working["scene"])
    before = structure_hash(scene)
    scene["layout"]["exterior"] = {"styleId": style}
    saved = signed.put(
        f"/api/projects/{pid}/working-copy",
        json={"scene": scene, "baseRevision": working["revision"]},
    )
    assert saved.status_code == 200, saved.text
    loaded = signed.get(f"/api/projects/{pid}/working-copy").json()["scene"]
    assert loaded["layout"]["exterior"]["styleId"] == style
    assert structure_hash(loaded) == before
    assert loaded["confirmation"] == working["scene"]["confirmation"]
    assert validate_scene(loaded)["valid"]


def test_unknown_exterior_style_is_rejected():
    scene = template_scene("villa")
    scene["layout"]["exterior"] = {"styleId": "unknown"}
    assert not validate_scene(scene)["valid"]


def test_multifloor_validation_rejects_wrong_measurement_floor_and_stair_target():
    s = template_scene("loft")
    s["floors"][0]["stairs"][0]["targetFloorId"] = "missing"
    assert "STAIR_TARGET" in {i["code"] for i in validate_scene(s)["issues"]}
    s = template_scene("loft")
    s["measurements"] = [
        dict(
            id="m",
            floorId="level-1",
            targetType="room",
            targetId="level-2-bed",
            measurementType="height",
            rawValue=2600,
            rawUnit="mm",
            normalizedMm=2600,
            method="tape",
            measuredAt="2026-10-23T00:00:00Z",
            sourceAssetIds=[],
            notes="test",
        )
    ]
    assert "MEASUREMENT_TARGET_MISSING" in {
        i["code"] for i in validate_scene(s)["issues"]
    }


def test_multifloor_layout_and_exports_keep_all_levels():
    s = template_scene("loft")
    # Moving objects on the upper floor must use that floor's rooms and obstacles.
    candidates = generate_layouts(s, count=1)
    assert candidates and structure_hash(candidates[0]) == structure_hash(s)
    assert {f["floorId"] for f in candidates[0]["layout"]["furniture"]} == {
        "level-1",
        "level-2",
    }
    pdf, _, _ = export_scene(s, "pdf")
    assert len(PdfReader(io.BytesIO(pdf)).pages) == 3
    data, _, _ = export_scene(s, "json")
    import json

    assert json.loads(data)["floors"] == s["floors"]
    copied = copy.deepcopy(s)
    copied["floors"][1]["elevationMm"] = 0
    assert "FLOOR_ELEVATION" in {i["code"] for i in validate_scene(copied)["issues"]}


def test_upper_stairwell_has_a_boundary_but_is_not_counted_as_usable_area():
    from interior.templates import list_templates

    listed = {t["id"]: t for t in list_templates()}
    for key in ("villa", "duplex"):
        scene = template_scene(key)
        upper = scene["floors"][1]
        shaft = next(r for r in upper["rooms"] if r["type"] == "stairwell")
        assert shaft["wallRefs"] and shaft["computedAreaMm2"] > 0
        indoor = (
            sum(
                r["computedAreaMm2"]
                for f in scene["floors"]
                for r in f["rooms"]
                if r["type"] not in ("stairwell", "courtyard", "terrace")
            )
            / 1e6
        )
        assert listed[key]["areaM2"] == round(indoor, 2)


def test_outdoor_rooms_do_not_invent_ceiling_work_and_templates_have_sensible_stair_treads():
    from interior.estimates import renovation_lines

    for key in ("villa", "courtyard"):
        scene = template_scene(key)
        yard = next(r for r in scene["floors"][0]["rooms"] if r["type"] == "courtyard")
        scene["layout"]["renovation"] = {
            "rooms": [
                {"roomId": yard["id"], "enabled": True, "ceilingMaterialMinor": 10000}
            ]
        }
        quantities, lines = renovation_lines(scene)
        assert (
            next(q for q in quantities if q["roomId"] == yard["id"])["ceilingAreaM2"]
            == 0
        )
        assert not any("ceiling" in line["itemKey"] for line in lines)
    for key in ("loft", "duplex", "villa"):
        scene = template_scene(key)
        floor = scene["floors"][0]
        stair = floor["stairs"][0]
        import math

        assert math.dist(stair["startMm"], stair["endMm"]) / stair["stepCount"] >= 250
        assert (scene["floors"][1]["elevationMm"] - floor["elevationMm"]) / stair[
            "stepCount"
        ] <= 180
