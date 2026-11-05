"""避坑审查、材料清单与识别后端的单元测试。"""

from interior import recognition, review


def _contract() -> str:
    return (
        "装修合同：吊顶设计 3 层集成吊顶；乳胶漆未指定品牌型号；"
        "最终结算按实际发生量结算；工期延误无赔付；质保 1 年不含隐蔽工程；"
        "水电按点位结算。"
    )


def test_rule_findings_cover_major_categories():
    findings = review.match_findings(_contract())
    categories = {f.category for f in findings}
    assert "hygiene_corner" in categories
    assert "over_decoration" in categories
    assert "contract_trap" in categories
    titles = {f.title for f in findings}
    assert "价格锁定条款模糊" in titles
    assert "材料品牌未标注" in titles
    assert "水电按点位数结算风险" in titles


def test_analyze_documents_offline_fallback():
    report = review.analyze_documents(
        {"contract": _contract(), "quote": "报价单总价 180000 元"},
        use_llm=True,
    )
    assert report.total_findings > 0
    assert report.llm_used is False
    assert "未启用" in report.llm_note or "不可用" in report.llm_note
    assert report.predicted_extra_cost_minor >= 0


def test_cross_document_amount_mismatch():
    findings = review.cross_document_check(
        {
            "contract": "合同总价 300000 元",
            "quote": "报价单合计 180000 元",
            "drawing": "设计说明包含拆墙、水电、吊顶、橱柜",
        }
    )
    titles = {f.title for f in findings}
    assert "合同总额与报价单不一致" in titles
    assert any("设计内容未进入报价" == t for t in titles)
    mismatch = next(f for f in findings if f.title == "合同总额与报价单不一致")
    assert mismatch.severity == "high"


def test_parse_document_text_and_unknown():
    text, note = review.parse_document("你好合同".encode("utf-8"), "合同.txt")
    assert text == "你好合同"
    assert "成功" in note
    empty, note = review.parse_document(b"", "x.docx")
    assert empty == ""
    assert "不支持" in note


def test_estimate_materials_tiers_and_items():
    result = review.estimate_materials({"totalAreaMm2": 90_000_000}, "cream-french")
    assert result["areaM2"] == 90.0
    assert result["styleName"] == "奶油法式"
    assert len(result["tiers"]) == 3
    assert result["recommendation"] == "standard"
    assert len(result["items"]) == 5
    totals = {t["tier"]: t["total"] for t in result["tiers"]}
    assert totals["economy"] < totals["standard"] < totals["premium"]


def test_estimate_materials_derives_area_from_rooms():
    scene = {
        "rooms": [
            {
                "shape": {
                    "pointsMm": [[0, 0], [5000, 0], [5000, 4000], [0, 4000]]
                }
            }
        ]
    }
    result = review.estimate_materials(scene, None)
    assert result["areaM2"] == 20.0


def test_link_budget_findings_attaches_item_ids():
    findings = review.match_findings("吊顶设计 3 层集成吊顶")
    lines = [
        {"itemKey": "ceiling-1", "title": "石膏板吊顶"},
        {"itemKey": "floor-1", "title": "实木地板"},
    ]
    linked = review.link_budget_findings(findings, lines)
    ids = [item for f in linked for item in f.budget_item_ids]
    assert "ceiling-1" in ids
    assert "floor-1" not in ids


def test_review_report_pdf_is_valid_pdf():
    report = review.analyze_documents({"contract": _contract()}, use_llm=False)
    pdf = review.review_report_pdf(report)
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 3000


def test_yolov8_backend_reports_missing_dependency(monkeypatch):
    backend = recognition.YOLOv8Backend()
    monkeypatch.setattr(backend, "_load", lambda: None)
    monkeypatch.setattr(backend, "_load_error", "未安装 ultralytics")
    result = backend.recognize(b"fake", 8000, 2800)
    assert result.success is False
    assert "ultralytics" in result.notes


def test_create_backend_selects_implementation():
    assert isinstance(recognition.create_backend("yolov8"), recognition.YOLOv8Backend)
    assert isinstance(recognition.create_backend("../x"), recognition.DashScopeBackend)


def test_review_endpoints_require_login(client):
    assert client.post("/api/review/analyze-text", json={"contract": "x"}).status_code == 401
    assert client.post("/api/review/report-pdf", json={"report": {}}).status_code == 401


def test_review_analyze_text_endpoint(signed):
    response = signed.post(
        "/api/review/analyze-text",
        json={
            "contract": _contract(),
            "quote": "报价单合计 180000 元",
            "useLlm": False,
            "budgetLines": [{"itemKey": "c1", "title": "石膏板吊顶"}],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["totalFindings"] > 0
    assert body["findings"][0]["severity"] in ("high", "medium", "low")
    assert any(f["budgetItemIds"] for f in body["findings"])


def test_review_upload_endpoint_parses_text_file(signed):
    files = {"contract": ("合同.txt", "吊顶3层 按实结算 未指定品牌".encode("utf-8"), "text/plain")}
    response = signed.post(
        "/api/review/analyze",
        files=files,
        data={"useLlm": "false"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["totalFindings"] >= 2
    assert body["notes"]


def test_review_upload_without_documents_is_rejected(signed):
    response = signed.post("/api/review/analyze", data={"useLlm": "false"})
    assert response.status_code == 400


def test_report_pdf_endpoint_returns_pdf(signed):
    report = signed.post("/api/review/analyze-text", json={"contract": _contract(), "useLlm": False}).json()
    response = signed.post("/api/review/report-pdf", json={"report": report})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content.startswith(b"%PDF")


def test_materials_estimate_endpoint_is_public(client):
    response = client.post(
        "/api/materials/estimate",
        json={"scene": {"totalAreaMm2": 90_000_000}, "styleId": "wabi-sabi"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["styleName"] == "侘寂极简"


def test_materials_from_image_requires_login_and_reports_disabled(signed):
    files = {"image": ("effect.png", b"\x89PNG\r\n\x1a\n", "image/png")}
    response = signed.post("/api/materials/from-image", files=files)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "MATERIAL_RECOGNITION_FAILED"


def test_recognition_backend_and_validation(signed):
    info = signed.get("/api/recognition/backend")
    assert info.status_code == 200
    assert info.json()["available"] == ["dashscope", "yolov8", "controlnet"]

    bad = signed.post(
        "/api/recognition/recognize",
        files={"image": ("plan.png", b"\x89PNG", "image/png")},
        data={"totalWidthMm": "100", "floorHeightMm": "2800"},
    )
    assert bad.status_code == 400
