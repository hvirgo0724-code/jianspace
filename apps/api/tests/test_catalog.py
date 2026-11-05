import copy
from interior.catalog import CATALOG, single_room_scene, budget_for
from interior.geometry import validate_scene


def test_catalog_entries_survive_scene_validation_and_remain_unquoted():
    assert len(CATALOG) == 48
    assert len({item["id"] for item in CATALOG}) == 48
    for item in CATALOG:
        scene = single_room_scene()
        scene["layout"]["catalogSnapshot"] = [
            {
                "skuId": "test-sku",
                "name": item["name"],
                "sizeMm": copy.deepcopy(item["sizeMm"]),
                "priceMinor": None,
                "currency": "CNY",
                "sourceType": "user_input",
                "quotedAt": "2026-10-22T10:00:00Z",
                "modelAssetId": "builtin-" + item["modelKind"],
                "productUrl": None,
            }
        ]
        scene["layout"]["furniture"] = [
            {
                "id": "test-furniture",
                "floorId": scene["floors"][0]["id"],
                "roomId": scene["floors"][0]["rooms"][0]["id"],
                "skuId": "test-sku",
                "positionMm": [2000, 2500, item["baseZMm"]],
                "sizeMm": copy.deepcopy(item["sizeMm"]),
                "rotationDeg": 0,
                "locked": False,
            }
        ]
        assert validate_scene(scene)["valid"], item["id"]
        budget = budget_for(scene)
        assert budget["unknownLineCount"] == 1
        assert budget["knownSubtotalMinor"] == 0


def test_a_high_appliance_does_not_block_a_short_door_swing():
    from interior.catalog import example_scene

    scene = example_scene()
    scene["layout"]["furniture"] = []
    scene["layout"]["catalogSnapshot"] = [
        {
            "skuId": "wall-item",
            "name": "壁挂空调",
            "sizeMm": [600, 200, 300],
            "priceMinor": None,
            "currency": "CNY",
            "sourceType": "user_input",
            "quotedAt": "2026-10-22T10:00:00Z",
            "modelAssetId": "builtin-wall-ac",
            "productUrl": None,
        }
    ]
    scene["layout"]["furniture"] = [
        {
            "id": "high-ac",
            "floorId": "floor-1",
            "roomId": "room-living",
            "skuId": "wall-item",
            "positionMm": [1250, 250, 2200],
            "sizeMm": [600, 200, 300],
            "rotationDeg": 0,
            "locked": False,
        }
    ]
    assert validate_scene(scene)["valid"]
    scene["layout"]["furniture"][0]["positionMm"][2] = 1500
    assert "DOOR_SWING_COLLISION" in {
        issue["code"] for issue in validate_scene(scene)["issues"]
    }
