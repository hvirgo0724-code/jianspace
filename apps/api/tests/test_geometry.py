from interior.catalog import example_scene
from interior.geometry import (
    validate_scene,
    structure_hash,
    generate_layouts,
    content_hash,
)


def test_reference_geometry_and_immutability():
    s = example_scene()
    before = content_hash(s)
    assert validate_scene(s)["valid"]
    variants = generate_layouts(s)
    assert len(variants) == 3
    assert content_hash(s) == before
    for v in variants:
        assert validate_scene(v)["valid"]
        assert structure_hash(v) == structure_hash(s)
        original = next(f for f in s["layout"]["furniture"] if f["locked"])
        assert original == next(
            f for f in v["layout"]["furniture"] if f["id"] == original["id"]
        )


def test_collision_outside_and_door_fan():
    s = example_scene()
    f = s["layout"]["furniture"][0]
    f["positionMm"] = [100, 100, 0]
    codes = {i["code"] for i in validate_scene(s)["issues"]}
    assert "FURNITURE_OUTSIDE" in codes
    f["positionMm"] = [1250, 450, 0]
    f["sizeMm"] = [600, 600, 850]
    next(c for c in s["layout"]["catalogSnapshot"] if c["skuId"] == f["skuId"])[
        "sizeMm"
    ] = f["sizeMm"]
    assert "DOOR_SWING_COLLISION" in {i["code"] for i in validate_scene(s)["issues"]}


def test_structure_hash_excludes_style_but_not_wall():
    s = example_scene()
    h = structure_hash(s)
    s["layout"]["styleId"] = "cream"
    assert structure_hash(s) == h
    s["floors"][0]["walls"][0]["heightMm"] += 1
    assert structure_hash(s) != h


def test_invalid_room_and_unknown_floor_are_rejected():
    s = example_scene()
    s["floors"][0]["rooms"][0]["boundaryMm"] = [
        [0, 0],
        [4000, 5000],
        [4000, 0],
        [0, 5000],
    ]
    assert not validate_scene(s)["valid"]
    s = example_scene()
    s["layout"]["furniture"][0]["floorId"] = "not-existing"
    assert "FLOOR_MISSING" in {i["code"] for i in validate_scene(s)["issues"]}


def test_boundary_wall_consistency():
    s = example_scene()
    s["floors"][0]["rooms"][0]["boundaryMm"][1][0] -= 300
    assert "WALL_BOUNDARY_MISMATCH" in {i["code"] for i in validate_scene(s)["issues"]}


def test_single_room_start_is_empty_and_geometrically_valid():
    from interior.catalog import single_room_scene

    s = single_room_scene()
    assert validate_scene(s)["valid"]
    assert len(s["floors"][0]["rooms"]) == 1
    assert not s["layout"]["furniture"]
