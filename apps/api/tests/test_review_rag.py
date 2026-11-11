"""避坑审查的条款检索、证据定位、PDF 高亮与降级测试。"""

import io
import re
import time

from interior import providers, review, review_rag
from interior.config import settings
from pypdf import PdfReader

FILLER = (
    "本段用于填充篇幅，描述普通墙面施工流程与现场管理要求，不涉及费用与时间安排。"
    "施工前确认基层含水率，材料进场按批次码放，完工后清理现场并做好成品保护。"
)
_PDF_FILLER = (
    "双方确认施工范围以图纸与报价单为准，材料进场需业主验收签字，"
    "完工后清理现场并做好成品保护。"
)


def _pdf_like_contract() -> str:
    """模拟 PDF 提取文本：条款之间只有换行、没有空行。"""
    clauses = [
        "装修施工合同 合同编号 2026-001 发包方与承包方经协商一致订立本合同。",
        "第一条 工程范围：客餐厅吊顶设计 3 层集成吊顶，墙面乳胶漆施工，地面铺贴瓷砖。"
        + _PDF_FILLER,
        "第二条 结算方式：最终结算按实际发生量结算，增项以现场签证为准。" + _PDF_FILLER,
        "第三条 材料：乳胶漆未指定品牌型号，瓷砖品牌待定，板材环保等级未注明。"
        + _PDF_FILLER,
        "第四条 工期：工期 60 天，延误无赔付，逾期不承担违约责任。" + _PDF_FILLER,
        "第五条 质保：整体质保 1 年，水电隐蔽工程质保 3 年。" + _PDF_FILLER,
        "第六条 付款：签约首付 30%，水电验收后支付 30%，竣工验收后 7 日内支付尾款 10%。"
        + _PDF_FILLER,
    ]
    return "\n".join(clauses)


def _long_contract() -> str:
    paragraphs = [f"第 {i} 条 {FILLER * 6}" for i in range(1, 41)]
    paragraphs[34] = (
        "第 35 条 付款节点：合同签订后支付首付款 30%，水电隐蔽验收后支付 30%，"
        "竣工验收后 7 日内支付尾款 10%。"
    )
    return "\n\n".join(paragraphs)


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def test_split_clauses_keep_offsets_and_key_labels():
    text = (
        "一、付款节点\n签约首付 30%，水电验收后支付 30%。\n\n"
        "二、工期\n工期 60 天，逾期按日赔付。\n\n"
        "三、普通说明\n" + FILLER
    )
    clauses = review_rag.split_clauses("contract", text, 500)
    assert len(clauses) >= 3
    for clause in clauses:
        assert len(clause.text) <= 500
        assert _normalized(text[clause.start : clause.end]) == clause.text
    keys = {key for clause in clauses for key in clause.keys}
    assert {"付款节点", "工期", "违约赔付"} <= keys
    assert {clause.paragraph for clause in clauses} >= {1, 2, 3}


def test_prompt_context_keeps_late_key_clause_complete():
    review_rag.clear_cache()
    text = _long_contract()
    context = review_rag.prepare({"contract": text})
    assert context.used is True

    dummy = review.Finding(
        id="x",
        category="contract_trap",
        severity="high",
        title="付款节点模糊",
        description="",
        advice="",
    )
    prompt = review_rag.prompt_context([dummy], context)
    clause = next(
        item for item in context.clauses if "竣工验收后 7 日内支付尾款" in item.text
    )
    assert clause.start > 8000
    assert "竣工验收后 7 日内支付尾款 10%" in prompt
    assert f"字符 {clause.start}-{clause.end}" in prompt
    assert len(prompt) <= settings.review_rag_prompt_chars * 1.5 + 400


def test_pdf_like_single_paragraph_is_rebuilt_with_offsets():
    text = _pdf_like_contract()
    assert "\n\n" not in text and len(text) > 500
    clauses = review_rag.split_clauses("contract", text, 1200)
    assert len({clause.paragraph for clause in clauses}) >= 4
    for clause in clauses:
        assert _normalized(text[clause.start : clause.end]) == clause.text
    spans = review_rag._block_spans(text)
    assert spans[0][0] == 0 and spans[-1][1] == len(text)
    assert all(end > start for start, end in spans)
    late = next(clause for clause in clauses if "尾款" in clause.text)
    assert late.paragraph > 1


def test_short_single_paragraph_keeps_one_block():
    text = "第一条 工程范围：墙面施工。第二条 付款：首付 30%。"
    clauses = review_rag.split_clauses("contract", text, 1200)
    assert {clause.paragraph for clause in clauses} == {1}


def test_rebuilt_paragraphs_keep_evidence_window_aligned():
    review_rag.clear_cache()
    text = _pdf_like_contract()
    context = review_rag.prepare({"contract": text})
    assert context.used is True
    hits = context.search("竣工验收后 7 日内支付尾款", top_k=1)
    assert hits and "尾款" in hits[0].text
    clause = hits[0]
    assert clause.end - clause.start < len(text) // 2

    dummy = review.Finding(
        id="x",
        category="contract_trap",
        severity="high",
        title="价格锁定条款模糊",
        description="",
        advice="",
        evidence_ref=review_rag.ref(clause),
    )
    window = review_rag.context_windows({"contract": text}, context, [dummy])[clause.id]
    assert window["paragraph"] == clause.paragraph
    assert window["text"] == text[window["contextStart"] : window["contextEnd"]]
    assert window["contextStart"] <= clause.start < clause.end <= window["contextEnd"]


def test_snippet_starts_at_sentence_boundary():
    text = (
        "第一条 说明。整段补充说明，包含主材、辅材与人工及税费。"
        "最终结\n算按实际发生量结算，多退少补。"
    )
    snippet = review_rag._snippet(text, ["最终结算", "按实际"])
    assert snippet.startswith("最终结 算按实际发生量结算")
    assert "，包含主材" not in snippet


def test_rule_evidence_has_accurate_location():
    contract = (
        "装修合同：\n\n"
        "第一条 工程范围：客餐厅墙面乳胶漆施工。\n\n"
        "第二条 结算方式：最终结算按实际发生量结算，增项以现场签证为准。\n\n" + FILLER
    )
    report = review.analyze_documents({"contract": contract}, use_llm=False)
    assert report.rag_used is True
    finding = next(item for item in report.findings if item.title == "价格锁定条款模糊")
    assert finding.evidence
    assert finding.evidence_ref
    ref = finding.evidence_ref
    assert ref["document"] == "contract"
    assert ref["documentLabel"] == "合同"
    assert 0 <= ref["start"] < ref["end"] <= len(contract)
    assert finding.evidence in _normalized(contract[ref["start"] : ref["end"]])


def test_water_point_evidence_lands_on_pricing_clause():
    contract = (
        "装修合同：\n\n"
        "第一条 质保：整体质保 2 年，水电隐蔽工程质保 5 年。\n\n"
        "第二条 水电：水电改造按点位结算，每个点位 180 元。\n"
    )
    report = review.analyze_documents({"contract": contract}, use_llm=False)
    titles = {item.title for item in report.findings}
    assert "质保期短于行业标准" not in titles
    finding = next(
        item for item in report.findings if item.title == "水电按点位数结算风险"
    )
    ref = finding.evidence_ref
    assert ref
    clause_text = contract[ref["start"] : ref["end"]]
    assert "点位" in clause_text and "结算" in clause_text
    assert "质保" not in clause_text


def test_crlf_documents_keep_lf_offsets():
    contract = (
        "装修合同：\n\n"
        "结算方式：最终结算按实际发生量结算，增项以现场签证为准。\n\n"
        "付款方式：签约首付 60%，水电验收后支付 30%，尾款 10%。\n"
    )
    lf = review.analyze_documents({"contract": contract}, use_llm=False)
    crlf = review.analyze_documents(
        {"contract": contract.replace("\n", "\r\n")}, use_llm=False
    )

    def refs(report):
        return [
            (finding.title, finding.evidence_ref["start"], finding.evidence_ref["end"])
            for finding in report.findings
            if finding.evidence_ref
        ]

    assert refs(lf)
    assert refs(lf) == refs(crlf)
    for finding in crlf.findings:
        ref = finding.evidence_ref
        if not ref:
            continue
        window = crlf.evidence_contexts[ref["clauseId"]]
        offset = ref["start"] - window["contextStart"]
        length = ref["end"] - ref["start"]
        assert (
            window["text"][offset : offset + length]
            == contract[ref["start"] : ref["end"]]
        )


def test_analyze_conclusions_unchanged_with_rag(monkeypatch):
    documents = {
        "contract": (
            "装修合同：吊顶设计 3 层集成吊顶；乳胶漆未指定品牌型号；"
            "最终结算按实际发生量结算；工期延误无赔付；质保 1 年不含隐蔽工程；"
            "水电按点位结算。合同总价 300000 元。"
        ),
        "quote": "报价单合计 180000 元",
        "drawing": "设计说明包含拆墙、水电、吊顶、橱柜",
    }
    with_rag = review.analyze_documents(documents, use_llm=False)
    monkeypatch.setattr(settings, "review_rag_enabled", False)
    without_rag = review.analyze_documents(documents, use_llm=False)

    def core(report):
        return [
            (
                finding.category,
                finding.severity,
                finding.title,
                finding.description,
                finding.advice,
                finding.estimated_amount_minor,
                finding.source,
            )
            for finding in report.findings
        ]

    assert with_rag.rag_used is True
    assert without_rag.rag_used is False
    assert core(with_rag) == core(without_rag)
    assert with_rag.total_findings == without_rag.total_findings
    assert with_rag.by_severity == without_rag.by_severity
    assert with_rag.by_category == without_rag.by_category


def test_timeout_degrades_to_legacy_truncation(monkeypatch):
    def slow(_documents):
        time.sleep(0.3)
        return review_rag.ReviewContext(note="slow")

    monkeypatch.setattr(review_rag, "_build", slow)
    monkeypatch.setattr(settings, "review_rag_timeout_ms", 50)
    context = review_rag.prepare({"contract": "合同总价 100000 元"})
    assert context.used is False
    assert "超时" in context.note

    report = review.analyze_documents(
        {"contract": "装修合同：最终结算按实际发生量结算；工期延误无赔付。"},
        use_llm=False,
    )
    assert report.rag_used is False
    assert "超时" in report.rag_note
    assert report.total_findings > 0


def test_llm_context_uses_retrieval_and_preserves_findings(monkeypatch):
    captured = {}
    evidence = "竣工验收后 7 日内支付尾款 10%"

    def fake_chat(messages):
        captured["user"] = messages[1]["content"]
        return (
            '{"findings":[{"category":"contract_trap","severity":"high",'
            '"title":"尾款支付节点偏晚","description":"尾款支付与验收绑定不足",'
            '"advice":"尾款改为验收合格后支付","evidence":"' + evidence + '",'
            '"estimatedAmountYuan":null}]}'
        )

    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_text_model", "qwen3.8-27b")
    monkeypatch.setattr(providers, "chat_text", fake_chat)

    report = review.analyze_documents({"contract": _long_contract()}, use_llm=True)
    assert report.llm_used is True
    assert evidence in captured["user"]
    assert "字符" in captured["user"]
    assert captured["user"].find(evidence) > 8000

    finding = next(item for item in report.findings if item.title == "尾款支付节点偏晚")
    assert finding.severity == "high"
    assert finding.description == "尾款支付与验收绑定不足"
    assert finding.advice == "尾款改为验收合格后支付"
    assert finding.evidence == evidence
    assert finding.source == "llm"
    assert finding.evidence_ref
    assert finding.evidence_ref["document"] == "contract"


def test_index_cache_reuses_same_document(monkeypatch):
    review_rag.clear_cache()
    text = _long_contract()
    first = review_rag.prepare({"contract": text})
    second = review_rag.prepare({"contract": text})
    assert first.indexes["contract"] is second.indexes["contract"]
    assert review_rag.cached_documents() >= 1


def test_review_endpoint_returns_rag_evidence(signed):
    response = signed.post(
        "/api/review/analyze-text",
        json={
            "contract": "装修合同：最终结算按实际发生量结算；工期延误无赔付。",
            "useLlm": False,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ragUsed"] is True
    assert payload["ragNote"].startswith("已索引")
    assert any(item["evidenceRef"] for item in payload["findings"])


def test_evidence_contexts_cover_neighbour_paragraphs():
    contract = (
        "装修合同\n\n"
        "第一条 工程范围：客餐厅吊顶设计 3 层。\n\n"
        "第二条 结算方式：最终结算按实际发生量结算。\n\n"
        "第三条 其他约定。"
    )
    report = review.analyze_documents({"contract": contract}, use_llm=False)
    finding = next(item for item in report.findings if item.title == "价格锁定条款模糊")
    ref = finding.evidence_ref
    window = report.evidence_contexts[ref["clauseId"]]
    assert window["contextStart"] <= ref["start"] < ref["end"] <= window["contextEnd"]
    assert window["text"] == contract[window["contextStart"] : window["contextEnd"]]
    assert window["paragraph"] == ref["paragraph"]
    assert "第一条" in window["text"] and "第三条" in window["text"]


def test_evidence_contexts_empty_when_rag_disabled(monkeypatch):
    monkeypatch.setattr(settings, "review_rag_enabled", False)
    report = review.analyze_documents(
        {"contract": "最终结算按实际发生量结算。"}, use_llm=False
    )
    assert report.evidence_contexts == {}


# ---------------------------------------------------------------------------
# PDF：evidenceRef 定位与摘录高亮
# ---------------------------------------------------------------------------


def _pdf_text(pdf: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf))
    return "".join(page.extract_text() or "" for page in reader.pages).replace("\n", "")


def _clause_contract() -> str:
    return (
        "装修合同：\n\n"
        "第一条 工程范围：客餐厅吊顶设计 3 层集成吊顶。\n\n"
        "第二条 结算方式：最终结算按实际发生量结算。\n\n"
        "第三条 材料：乳胶漆未指定品牌型号。\n\n"
        "第四条 工期：工期延误无赔付。\n\n"
        "第五条 质保：质保 1 年不含隐蔽工程。"
    )


def test_pdf_location_matches_evidence_offsets():
    contract = _clause_contract()
    report = review.analyze_documents({"contract": contract}, use_llm=False)
    finding = next(item for item in report.findings if item.title == "价格锁定条款模糊")
    ref = finding.evidence_ref
    assert ref and 0 <= ref["start"] < ref["end"] <= len(contract)
    assert finding.evidence in _normalized(contract[ref["start"] : ref["end"]])
    assert review._evidence_location(ref) == (
        f"合同·段 {ref['paragraph']}｜字符 {ref['start']}-{ref['end']}"
    )

    text = _pdf_text(review.review_report_pdf(report))
    assert "依据：" in text
    assert f"定位：合同·段 {ref['paragraph']}｜字符 {ref['start']}-{ref['end']}" in text


def test_pdf_highlights_hit_fragment_and_escapes_text():
    markup = review._evidence_markup(
        "最终结算按实际发生量结算", ["按实结算", "实际发生量"]
    )
    assert '<font backColor="#FFF1A8">实际发生量</font>' in markup
    assert review._evidence_markup("a<b>&c", []) == "a&lt;b&gt;&amp;c"


def test_pdf_merges_findings_sharing_clause():
    ref = {
        "document": "contract",
        "documentLabel": "合同",
        "clauseId": "contract#2",
        "paragraph": 2,
        "start": 100,
        "end": 160,
        "keys": ["增项条款"],
    }
    findings = [
        review.Finding(
            id=f"dup{i}",
            category="contract_trap",
            severity="medium",
            title=f"条目 {i}",
            description="同一段命中",
            advice="整改",
            evidence="增项须业主书面签字确认",
            evidence_ref=dict(ref),
        )
        for i in (1, 2)
    ]
    report = review.ReviewReport(
        summary="s",
        total_findings=2,
        by_severity={"high": 0, "medium": 2, "low": 0},
        by_category={},
        findings=findings,
    )
    text = _pdf_text(review.review_report_pdf(report))
    assert text.count("增项须业主书面签字确认") == 1
    assert "同第 1 条" in text


def test_pdf_tolerates_missing_or_invalid_refs():
    base = {
        "category": "contract_trap",
        "severity": "low",
        "title": "定位缺失",
        "description": "d",
        "advice": "a",
    }
    findings = [
        review.Finding(id="none", evidence="没有定位的原文", evidence_ref=None, **base),
        review.Finding(
            id="bad",
            evidence="<b>&非法定位</b>",
            evidence_ref={"start": "x", "end": 3},
            **base,
        ),
        review.Finding(
            id="reversed",
            evidence="起止颠倒",
            evidence_ref={"document": "contract", "start": 50, "end": 10},
            **base,
        ),
    ]
    report = review.ReviewReport(
        summary="s",
        total_findings=3,
        by_severity={"high": 0, "medium": 0, "low": 3},
        by_category={},
        findings=findings,
    )
    pdf = review.review_report_pdf(report)
    assert pdf.startswith(b"%PDF")
    text = _pdf_text(pdf)
    assert "没有定位的原文" in text
    assert "非法定位" in text
    assert "定位：" not in text


def test_pdf_keeps_long_evidence_across_pages():
    findings = []
    for i in range(1, 13):
        evidence = (
            f"本合同第{i}条约定付款节点为首付30%、水电验收后支付30%、尾款10%，"
            "增项须书面确认，验收标准按国家规范执行，逾期按日赔付千分之一。"
        )
        findings.append(
            review.Finding(
                id=f"long{i}",
                category="contract_trap",
                severity="high",
                title=f"付款节点 {i}",
                description="同一模板的长证据，用于验证跨页时摘录完整。",
                advice="整改",
                evidence=evidence,
                evidence_ref={
                    "document": "contract",
                    "documentLabel": "合同",
                    "clauseId": f"contract#long{i}",
                    "paragraph": i,
                    "start": i * 100,
                    "end": i * 100 + len(evidence),
                    "keys": ["付款节点"],
                },
            )
        )
    report = review.ReviewReport(
        summary="s",
        total_findings=len(findings),
        by_severity={"high": len(findings), "medium": 0, "low": 0},
        by_category={},
        findings=findings,
    )
    pdf = review.review_report_pdf(report)
    assert len(PdfReader(io.BytesIO(pdf)).pages) >= 2
    text = _pdf_text(pdf)
    assert text.count("定位：合同·段") == len(findings)
    assert text.count("逾期按日赔付千分之一。") == len(findings)


def test_pdf_route_preserves_evidence_ref(monkeypatch, signed):
    captured: dict = {}

    def fake_pdf(report_obj):
        captured["report"] = report_obj
        return b"%PDF-1.4 fake"

    monkeypatch.setattr("interior.routes.review.review_report_pdf", fake_pdf)
    ref = {
        "document": "contract",
        "documentLabel": "合同",
        "clauseId": "contract#3",
        "paragraph": 3,
        "start": 12,
        "end": 40,
        "keys": ["付款节点"],
    }
    response = signed.post(
        "/api/review/report-pdf",
        json={
            "report": {
                "summary": "s",
                "findings": [
                    {
                        "id": "f1",
                        "category": "contract_trap",
                        "severity": "high",
                        "title": "t",
                        "description": "d",
                        "advice": "a",
                        "evidence": "首付 30%",
                        "evidenceRef": ref,
                    }
                ],
            }
        },
    )
    assert response.status_code == 200, response.text
    assert captured["report"].findings[0].evidence_ref == ref
