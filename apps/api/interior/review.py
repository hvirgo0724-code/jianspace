"""装修避坑审查引擎。

三层分析：
1. 本地坑位知识库（规则匹配，离线可用）
2. 大模型批判分析（百炼文本模型，识别合同语义陷阱）
3. 跨文档交叉核查（合同 / 报价单 / 设计说明之间的金额与条目比对）

审查结果可回挂到预算清单的可疑项，并生成 PDF 报告。
"""
from __future__ import annotations

import io
import json
import re
from dataclasses import dataclass, field
from typing import Literal


Category = Literal[
    "hygiene_corner",
    "over_decoration",
    "contract_trap",
    "cross_doc_mismatch",
    "item_prediction",
]
Severity = Literal["high", "medium", "low"]


@dataclass
class Finding:
    """单条审查发现。"""

    id: str
    category: Category
    severity: Severity
    title: str
    description: str
    advice: str
    evidence: str | None = None
    estimated_amount_minor: int | None = None
    source: str = "rule"
    budget_item_ids: list[str] = field(default_factory=list)


@dataclass
class ReviewReport:
    """完整审查报告。"""

    summary: str
    total_findings: int
    by_severity: dict[str, int]
    by_category: dict[str, int]
    findings: list[Finding] = field(default_factory=list)
    created_at: str = ""
    contract_reliability_score: int = 50
    predicted_extra_cost_minor: int = 0
    llm_used: bool = False
    llm_note: str = ""
    documents: dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# 本地坑位知识库
# ---------------------------------------------------------------------------

KNOWLEDGE_BASE: list[dict] = [
    # --- 卫生死角 ---
    {
        "category": "hygiene_corner",
        "keywords": ["吊顶", "集成吊顶", "铝扣板"],
        "title": "吊顶内积水隐患",
        "severity": "high",
        "description": "厨房/卫生间吊顶上方无检修口且密封过严，蒸汽凝结水无法排出，长期积水导致吊顶发霉脱落。",
        "advice": "检查合同是否注明安装检修口；设计吊顶时预留 300mm 见方检修口于管道接口处。",
        "budgetKeywords": ["吊顶"],
    },
    {
        "category": "hygiene_corner",
        "keywords": ["淋浴房", "玻璃隔断", "地漏"],
        "title": "淋浴房边缘发霉死角",
        "severity": "medium",
        "description": "玻璃隔断与地面连接处未做等电位，底座周边未留 5-8mm 打胶缝，半年内必然发黑发霉。",
        "advice": "要求报价单列打胶密封项并指定防霉玻璃胶品牌；底座留伸缩缝。",
        "budgetKeywords": ["淋浴", "防水", "打胶"],
    },
    {
        "category": "hygiene_corner",
        "keywords": ["橱柜", "地柜", "踢脚板"],
        "title": "橱柜底部卫生死角",
        "severity": "medium",
        "description": "地柜完全落地无踢脚板或踢脚板密封过严，柜底成为蟑螂滋生和食物残渣积聚区。",
        "advice": "选用悬浮地柜或留 80-100mm 踢脚板空间并安装可拆洗踢脚板。",
        "budgetKeywords": ["橱柜", "地柜"],
    },
    {
        "category": "hygiene_corner",
        "keywords": ["马桶", "坐便", "背水箱"],
        "title": "马桶背后清洁死角",
        "severity": "low",
        "description": "马桶与墙面间距小于 50mm 时无法伸入清洁工具，缝隙长期积垢且易渗水。",
        "advice": "安装前确认马桶中心线距墙 ≥ 300mm，留出可清洁间距。",
        "budgetKeywords": ["马桶", "洁具"],
    },
    # --- 过度装修 ---
    {
        "category": "over_decoration",
        "keywords": ["吊顶", "多层吊顶", "复杂吊顶", "叠级吊顶"],
        "title": "吊顶层数超标",
        "severity": "medium",
        "description": "客厅设计 3 层及以上吊顶，增加石膏板、龙骨、油漆及安装人工，单这一项多出 8000-15000 元，且积灰难清洁。",
        "advice": "考虑单层边吊 + 灯槽，或不做吊顶只做石膏线，节省预算同时更易维护。",
        "estimatedAmountMinor": 1200000,
        "budgetKeywords": ["吊顶"],
    },
    {
        "category": "over_decoration",
        "keywords": ["石材", "大理石", "背景墙", "岩板"],
        "title": "石材背景墙非必要",
        "severity": "low",
        "description": "电视背景墙用天然大理石或岩板，单价 800-1500 元/㎡，加上造型和安装费一项 3-8 万。",
        "advice": "考虑艺术漆、木纹板、石膏线造型等替代方案，成本仅为石材的 20-40%。",
        "estimatedAmountMinor": 500000,
        "budgetKeywords": ["背景墙", "石材", "岩板"],
    },
    {
        "category": "over_decoration",
        "keywords": ["全屋定制", "护墙板", "木饰面"],
        "title": "木饰面面积过大",
        "severity": "medium",
        "description": "全屋护墙板或木饰面超过墙面面积 40% 时，造价高、甲醛释放总量大，且后期难以拆改。",
        "advice": "控制在局部造型墙（≤15% 墙面面积），其余用乳胶漆或壁布。",
        "estimatedAmountMinor": 800000,
        "budgetKeywords": ["木饰面", "护墙板", "定制"],
    },
    {
        "category": "over_decoration",
        "keywords": ["拆改", "砸墙", "结构改造"],
        "title": "结构拆改风险与增量",
        "severity": "high",
        "description": "涉及承重墙或剪力墙拆改，除高昂拆除与加固费用外，还存在结构安全隐患与物业报批风险。",
        "advice": "拆改前取得原始结构图并报物业审批；承重构件一律不得拆改。",
        "estimatedAmountMinor": 2000000,
        "budgetKeywords": ["拆改", "拆除", "加固"],
    },
    # --- 合同陷阱 ---
    {
        "category": "contract_trap",
        "keywords": ["按实结算", "按实际", "最终结算", "据实结算"],
        "title": "价格锁定条款模糊",
        "severity": "high",
        "description": "合同出现「按实结算」「按实际发生量」等模糊表述，意味着施工方可以任意追加项目。",
        "advice": "要求改为「固定总价 + 限额外 5% 以内调整」；明确哪些项目不在预算内。",
    },
    {
        "category": "contract_trap",
        "keywords": ["品牌", "指定品牌", "高级品牌", "同等档次"],
        "title": "材料品牌未标注",
        "severity": "high",
        "description": "报价单/合同仅写「乳胶漆」「地板」「瓷砖」未指定品牌型号，施工方可能以次充好。",
        "advice": "要求每个材料项标注品牌、型号、规格，附件列出完整材料清单并作为合同组成部分。",
    },
    {
        "category": "contract_trap",
        "keywords": ["工期", "延误", "违约金", "逾期"],
        "title": "工期违约金缺失",
        "severity": "medium",
        "description": "合同未约定延误赔付，或延误赔付比例过低（低于 0.1%/天），装修公司无动力按期交付。",
        "advice": "要求增加工期违约金（建议 0.1-0.5%/天，总上限合同额 10-20%）。",
    },
    {
        "category": "contract_trap",
        "keywords": ["质保", "保修", "售后", "维保"],
        "title": "质保期短于行业标准",
        "severity": "medium",
        "description": "行业规定基础工程质保 2 年、水电隐蔽工程质保 5 年。合同如低于此标准需警惕。",
        "advice": "要求至少 2 年基础质保 + 5 年水电质保，并明确质保范围（不含人为损坏）。",
    },
    {
        "category": "contract_trap",
        "keywords": ["定金", "订金", "预付", "首付"],
        "title": "付款比例前置过高",
        "severity": "high",
        "description": "开工前支付比例超过 60% 时，业主失去对施工进度与质量的制约手段。",
        "advice": "建议按 3:3:3:1 分阶段付款，尾款不低于 10% 且验收合格后支付。",
    },
    {
        "category": "contract_trap",
        "keywords": ["增项", "变更", "签证"],
        "title": "增项审批流程缺失",
        "severity": "medium",
        "description": "合同未约定增项须书面确认，施工中出现口头增项易导致结算金额失控。",
        "advice": "约定所有增项须业主书面签字确认后方可施工，未确认部分不予结算。",
    },
    {
        "category": "contract_trap",
        "keywords": ["管理费", "设计费", "远程费", "搬运费"],
        "title": "附加费用未计入总价",
        "severity": "medium",
        "description": "报价单只列施工单价，管理费、设计费、垃圾清运、材料搬运等另计，实际总价常超预算 15-25%。",
        "advice": "要求报价单提供含税总价，并逐项列明所有附加费用。",
        "estimatedAmountMinor": 300000,
    },
    {
        "category": "contract_trap",
        "keywords": ["水电", "隐蔽工程", "点位"],
        "title": "水电按点位数结算风险",
        "severity": "high",
        "description": "水电改造按「点位」计价且未封顶，实际点位数量远超图纸估算，是装修超支最大来源。",
        "advice": "要求水电按实测米数或包干价结算，并在合同中约定上限。",
        "estimatedAmountMinor": 400000,
        "budgetKeywords": ["水电", "隐蔽"],
    },
    # --- 增项预测 ---
    {
        "category": "item_prediction",
        "keywords": ["老房", "二手房", "翻新", "拆旧"],
        "title": "老房翻新常见增项",
        "severity": "medium",
        "description": "老房翻新通常出现墙面空鼓铲除、防水重做、旧管线更换等计划外增项，平均超预算 20-35%。",
        "advice": "预留 15-20% 增项预留金，并在合同中约定增项单价。",
        "estimatedAmountMinor": 1500000,
    },
    {
        "category": "item_prediction",
        "keywords": ["别墅", "复式", "跃层", "地下室"],
        "title": "大宅隐蔽工程增项",
        "severity": "medium",
        "description": "多层住宅的给排水、采暖、新风管道跨度大，管线与保温工程量常被低估。",
        "advice": "要求按楼层分区出具管线图与工程量清单。",
        "estimatedAmountMinor": 2500000,
    },
]


def match_findings(text_content: str, *, source: str = "rule") -> list[Finding]:
    """基于关键词匹配生成本地知识库发现。"""
    text = (text_content or "").lower()
    results: list[Finding] = []
    seen: set[str] = set()
    for entry in KNOWLEDGE_BASE:
        if not any(kw.lower() in text for kw in entry["keywords"]):
            continue
        title = entry["title"]
        if title in seen:
            continue
        seen.add(title)
        results.append(
            Finding(
                id=f"r-{len(results)}",
                category=entry["category"],
                severity=entry["severity"],
                title=title,
                description=entry["description"],
                advice=entry["advice"],
                estimated_amount_minor=entry.get("estimatedAmountMinor"),
                source=source,
            )
        )
    return results


# ---------------------------------------------------------------------------
# 文档解析
# ---------------------------------------------------------------------------

_MAX_TEXT = 60_000


def parse_document(data: bytes, filename: str) -> tuple[str, str]:
    """把上传的合同/报价单解析为纯文本，返回 (文本, 说明)。"""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            pages = [(p.extract_text() or "") for p in reader.pages[:40]]
            text = "\n".join(pages).strip()
            if not text:
                return "", "PDF 无可提取文字，可能是扫描件，请改用文本粘贴或先做 OCR。"
            return text[:_MAX_TEXT], f"PDF 解析成功，{len(reader.pages)} 页。"
        except Exception as exc:  # pragma: no cover - 依赖文件内容
            return "", f"PDF 解析失败：{exc}"
    if name.endswith((".txt", ".md", ".csv", ".json")):
        try:
            return data.decode("utf-8")[:_MAX_TEXT], "文本文件读取成功。"
        except UnicodeDecodeError:
            try:
                return data.decode("gbk")[:_MAX_TEXT], "文本文件按 GBK 读取成功。"
            except UnicodeDecodeError:
                return "", "文本编码无法识别，请使用 UTF-8 或 GBK。"
    return "", f"暂不支持 {name or '该'} 格式，请上传 PDF / TXT / MD / CSV。"


# ---------------------------------------------------------------------------
# 大模型批判分析
# ---------------------------------------------------------------------------

_LLM_SYSTEM = """你是资深家装监理与合同审核专家。基于给定的装修文档，找出对业主不利的问题。
只输出 JSON，不要解释。格式：
{"findings":[{"category":"hygiene_corner|over_decoration|contract_trap|cross_doc_mismatch|item_prediction",
"severity":"high|medium|low","title":"不超过20字","description":"具体问题与依据",
"advice":"可执行的整改建议","evidence":"文档原文片段（不超过60字）",
"estimatedAmountYuan":数字或null}]}
要求：最多 8 条，按严重程度排序；只报告文档中确有依据的问题，不得编造品牌、价格或法规条文。"""


def _extract_json(text: str) -> dict | None:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None


def llm_critique(documents: dict[str, str], style_hint: str = "") -> tuple[list[Finding], str]:
    """调用百炼文本模型做批判分析；失败时返回空列表与原因。"""
    from .config import settings

    payload_parts = []
    for key, label in (
        ("contract", "合同"),
        ("quote", "报价单"),
        ("drawing", "设计说明"),
    ):
        value = (documents.get(key) or "").strip()
        if value:
            payload_parts.append(f"=== {label} ===\n{value[:8000]}")
    if not payload_parts:
        return [], "未提供可分析文档。"
    if not settings.ai_ready or not settings.dashscope_text_model.strip():
        return [], "未启用文本模型，仅使用本地知识库规则。"
    if style_hint:
        payload_parts.append(f"=== 装修风格 ===\n{style_hint}")

    from .providers import chat_text

    messages = [
        {"role": "system", "content": _LLM_SYSTEM},
        {"role": "user", "content": "\n\n".join(payload_parts)},
    ]
    try:
        raw = chat_text(messages)
    except Exception as exc:  # DomainError 或网络异常均降级
        return [], f"大模型分析不可用：{getattr(exc, 'message', str(exc))}"

    data = _extract_json(raw)
    if not data or not isinstance(data.get("findings"), list):
        return [], "大模型返回内容无法解析，已退回本地规则。"

    findings: list[Finding] = []
    for i, item in enumerate(data["findings"][:8]):
        if not isinstance(item, dict):
            continue
        category = item.get("category")
        if category not in (
            "hygiene_corner",
            "over_decoration",
            "contract_trap",
            "cross_doc_mismatch",
            "item_prediction",
        ):
            category = "contract_trap"
        severity = item.get("severity")
        if severity not in ("high", "medium", "low"):
            severity = "medium"
        title = str(item.get("title") or "").strip()[:40]
        if not title:
            continue
        amount = item.get("estimatedAmountYuan")
        amount_minor = None
        if isinstance(amount, (int, float)) and amount > 0:
            amount_minor = int(round(amount * 100))
        findings.append(
            Finding(
                id=f"m-{i}",
                category=category,
                severity=severity,
                title=title,
                description=str(item.get("description") or "").strip()[:400],
                advice=str(item.get("advice") or "").strip()[:400],
                evidence=str(item.get("evidence") or "").strip()[:120] or None,
                estimated_amount_minor=amount_minor,
                source="llm",
            )
        )
    return findings, f"大模型分析完成，返回 {len(findings)} 条。"


# ---------------------------------------------------------------------------
# 跨文档交叉核查
# ---------------------------------------------------------------------------

_AMOUNT = re.compile(r"(\d+(?:\.\d+)?)\s*(万元|万|元)")


def _amounts(text: str) -> list[int]:
    """抽取文本中的金额，统一为分。"""
    result = []
    for value, unit in _AMOUNT.findall(text or ""):
        try:
            number = float(value)
        except ValueError:
            continue
        minor = int(round(number * 10000 * 100)) if unit.startswith("万") else int(round(number * 100))
        if minor >= 100 * 100:
            result.append(minor)
    return result


_QUOTE_ITEMS = [
    "拆墙",
    "砌墙",
    "水电",
    "防水",
    "吊顶",
    "瓷砖",
    "地板",
    "乳胶漆",
    "木工",
    "橱柜",
    "洁具",
    "灯具",
    "开关",
    "门",
]


def cross_document_check(documents: dict[str, str]) -> list[Finding]:
    """比对合同金额、报价单总额与设计说明中的条目差异。"""
    contract = documents.get("contract") or ""
    quote = documents.get("quote") or ""
    drawing = documents.get("drawing") or ""
    findings: list[Finding] = []
    index = 0

    def add(title: str, description: str, advice: str, severity: str, evidence: str) -> None:
        nonlocal index
        findings.append(
            Finding(
                id=f"x-{index}",
                category="cross_doc_mismatch",
                severity=severity,  # type: ignore[arg-type]
                title=title,
                description=description,
                advice=advice,
                evidence=evidence[:120],
                source="rule",
            )
        )
        index += 1

    if contract and quote:
        contract_total = max(_amounts(contract), default=0)
        quote_total = max(_amounts(quote), default=0)
        if contract_total and quote_total:
            diff = abs(contract_total - quote_total) / contract_total
            if diff >= 0.15:
                add(
                    "合同总额与报价单不一致",
                    f"合同金额约 {contract_total / 100:.0f} 元，报价单约 {quote_total / 100:.0f} 元，差异 {diff * 100:.0f}%。",
                    "要求装修公司书面说明差异来源，并把最终金额写入合同正文而非附件。",
                    "high",
                    f"合同 {contract_total / 100:.0f} 元 / 报价 {quote_total / 100:.0f} 元",
                )
        elif contract_total and not quote_total:
            add(
                "报价单缺少总价",
                "报价单中未出现明确总价金额，无法核对合同与报价的一致性。",
                "要求报价单提供含税总价与分项合计，避免只列单价。",
                "medium",
                "报价单无总价字段",
            )

    if quote and drawing:
        missing = [item for item in _QUOTE_ITEMS if item in drawing and item not in quote]
        if missing:
            add(
                "设计内容未进入报价",
                f"设计说明提到但报价单未列项：{'、'.join(missing[:6])}。",
                "逐项确认这些内容是否包含在总价内，未列项的必须补充报价。",
                "high",
                "缺失条目：" + "、".join(missing[:6]),
            )

    if contract:
        has_amount_word = bool(re.search(r"总价|总金额|合同价", contract))
        if not has_amount_word:
            add(
                "合同未写明总价",
                "合同正文没有「总价/合同价」表述，价格可能仅存在于报价单附件中。",
                "要求在合同正文明确总价、付款节点与增项上限。",
                "medium",
                "合同正文未检索到总价条款",
            )
    return findings


# ---------------------------------------------------------------------------
# 汇总与预算联动
# ---------------------------------------------------------------------------

def _dedupe(findings: list[Finding]) -> list[Finding]:
    """按标题去重，规则条目优先保留。"""
    seen: set[str] = set()
    result: list[Finding] = []
    for f in findings:
        key = re.sub(r"\s+", "", f.title)
        if key in seen:
            continue
        seen.add(key)
        result.append(f)
    return result


def summarize_findings(findings: list[Finding]) -> ReviewReport:
    """把发现列表汇总成完整报告。"""
    by_severity: dict[str, int] = {"high": 0, "medium": 0, "low": 0}
    by_category: dict[str, int] = {}
    total_extra = 0
    for f in findings:
        by_severity[f.severity] = by_severity.get(f.severity, 0) + 1
        by_category[f.category] = by_category.get(f.category, 0) + 1
        if f.estimated_amount_minor:
            total_extra += f.estimated_amount_minor
    score = 100 - by_severity["high"] * 25 - by_severity["medium"] * 10 - by_severity["low"] * 3
    score = max(0, min(100, score))
    return ReviewReport(
        summary=_generate_summary(by_severity, score, len(findings)),
        total_findings=len(findings),
        by_severity=by_severity,
        by_category=by_category,
        findings=findings,
        contract_reliability_score=score,
        predicted_extra_cost_minor=total_extra,
    )


def _generate_summary(by_severity: dict, score: int, total: int) -> str:
    high = by_severity.get("high", 0)
    med = by_severity.get("medium", 0)
    low = by_severity.get("low", 0)
    if total == 0:
        return "未发现明显问题，仍建议逐条核对品牌型号与付款节点。"
    if score >= 80:
        verdict = "整体规范，仅有少量需注意的细节"
    elif score >= 60:
        verdict = "存在一些常见问题，签前建议逐条确认"
    elif score >= 40:
        verdict = "有较多需警惕的条款，强烈建议仔细审校"
    else:
        verdict = "问题较多，建议先整改再签合同"
    return f"合同可靠性评分 {score}/100 — {verdict}；共 {total} 条问题（高 {high} / 中 {med} / 低 {low}）。"


def analyze_documents(
    documents: dict[str, str], *, use_llm: bool = True, style_hint: str = ""
) -> ReviewReport:
    """完整审查流程：规则 + 大模型 + 跨文档核查。"""
    merged_text = "\n".join(v for v in documents.values() if v)
    rule_findings = match_findings(merged_text)
    cross_findings = cross_document_check(documents)

    llm_findings: list[Finding] = []
    llm_note = ""
    if use_llm:
        llm_findings, llm_note = llm_critique(documents, style_hint)

    findings = _dedupe([*rule_findings, *cross_findings, *llm_findings])
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: severity_rank[f.severity])
    for i, f in enumerate(findings):
        f.id = f"{f.source[0]}-{i}"

    report = summarize_findings(findings)
    report.llm_used = bool(llm_findings)
    report.llm_note = llm_note
    report.documents = {
        key: len(value) for key, value in documents.items() if value
    }
    return report


def link_budget_findings(findings: list[Finding], lines: list[dict]) -> list[Finding]:
    """把审查发现挂到预算清单中对应的条目。"""
    for finding in findings:
        keywords = next(
            (
                entry["keywords"]
                for entry in KNOWLEDGE_BASE
                if entry["title"] == finding.title
            ),
            [],
        )
        tokens = [*keywords[:2], *re.findall(r"[一-龥]{2,4}", finding.title)]
        matched = []
        for line in lines or []:
            title = str(line.get("title") or "")
            if any(tok and tok in title for tok in tokens):
                key = line.get("itemKey")
                if key:
                    matched.append(str(key))
        finding.budget_item_ids = matched[:5]
    return findings


def report_to_dict(report: ReviewReport) -> dict:
    return {
        "summary": report.summary,
        "totalFindings": report.total_findings,
        "bySeverity": report.by_severity,
        "byCategory": report.by_category,
        "contractReliabilityScore": report.contract_reliability_score,
        "predictedExtraCostMinor": report.predicted_extra_cost_minor,
        "llmUsed": report.llm_used,
        "llmNote": report.llm_note,
        "documents": report.documents,
        "findings": [
            {
                "id": f.id,
                "category": f.category,
                "severity": f.severity,
                "title": f.title,
                "description": f.description,
                "advice": f.advice,
                "evidence": f.evidence,
                "estimatedAmountMinor": f.estimated_amount_minor,
                "source": f.source,
                "budgetItemIds": f.budget_item_ids,
            }
            for f in report.findings
        ],
    }


# ---------------------------------------------------------------------------
# 审查报告 PDF
# ---------------------------------------------------------------------------

_CATEGORY_LABEL = {
    "hygiene_corner": "卫生死角",
    "over_decoration": "过度装修",
    "contract_trap": "合同陷阱",
    "cross_doc_mismatch": "跨文档不一致",
    "item_prediction": "增项预测",
}
_SEVERITY_LABEL = {"high": "高危", "medium": "中危", "low": "低危"}


def review_report_pdf(report: ReviewReport) -> bytes:
    """生成可下载的审查报告 PDF。"""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    try:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        font_name = "STSong-Light"
    except Exception:  # pragma: no cover
        font_name = "Helvetica"

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="筑见 JianSpace 装修避坑审查报告",
    )
    base = ParagraphStyle("base", fontName=font_name, fontSize=10, leading=16)
    title = ParagraphStyle("title", fontName=font_name, fontSize=18, leading=26, spaceAfter=6)
    h2 = ParagraphStyle("h2", fontName=font_name, fontSize=13, leading=20, spaceBefore=10, spaceAfter=6)
    story = [
        Paragraph("筑见 JianSpace · 装修避坑审查报告", title),
        Paragraph(report.summary, base),
        Spacer(1, 8),
    ]
    stats = Table(
        [
            ["合同可靠性评分", f"{report.contract_reliability_score} / 100"],
            ["高危 / 中危 / 低危", f"{report.by_severity.get('high', 0)} / {report.by_severity.get('medium', 0)} / {report.by_severity.get('low', 0)}"],
            ["预计增项金额", f"{report.predicted_extra_cost_minor / 100:,.0f} 元"],
            ["分析方式", "本地知识库 + 大模型批判" if report.llm_used else "本地知识库规则"],
        ]
    )
    stats.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), font_name),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
                ("BACKGROUND", (0, 0), (0, -1), colors.whitesmoke),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.extend([stats, Spacer(1, 10), Paragraph("问题清单", h2)])

    for i, finding in enumerate(report.findings, 1):
        header = (
            f"{i}. [{_SEVERITY_LABEL[finding.severity]}] {finding.title}"
            f"（{_CATEGORY_LABEL.get(finding.category, finding.category)}）"
        )
        story.append(Paragraph(header, ParagraphStyle("fh", fontName=font_name, fontSize=11, leading=17, spaceBefore=6)))
        story.append(Paragraph(f"问题：{finding.description}", base))
        story.append(Paragraph(f"建议：{finding.advice}", base))
        if finding.evidence:
            story.append(Paragraph(f"依据：{finding.evidence}", base))
        if finding.estimated_amount_minor:
            story.append(Paragraph(f"预估影响金额：{finding.estimated_amount_minor / 100:,.0f} 元", base))

    doc.build(story)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# 材料清单与三档预算
# ---------------------------------------------------------------------------

BUDGET_TIERS: dict[str, dict] = {
    "economy": {
        "label": "经济档",
        "desc": "性价比优先，选国产主流品牌",
        "floor": 150,
        "wall": 35,
        "cabinet": 800,
        "bathroom": 3000,
        "lighting": 200,
        "markup": 0,
    },
    "standard": {
        "label": "标准档",
        "desc": "主流品牌 + 部分进口，平衡品质与预算",
        "floor": 280,
        "wall": 55,
        "cabinet": 1500,
        "bathroom": 5000,
        "lighting": 500,
        "markup": 25,
    },
    "premium": {
        "label": "高档档",
        "desc": "进口 + 高端国产，追求品质和设计感",
        "floor": 500,
        "wall": 80,
        "cabinet": 3000,
        "bathroom": 10000,
        "lighting": 1500,
        "markup": 60,
    },
}


def estimate_materials(scene: dict, style_id: str | None = None) -> dict:
    """根据场景面积与风格生成材料建议 + 三档预算。"""
    from .catalog import STYLES

    area_mm2 = 0
    if isinstance(scene, dict):
        area_mm2 = scene.get("totalAreaMm2") or 0
        if not area_mm2:
            rooms = scene.get("rooms") or []
            for room in rooms:
                shape = room.get("shape") or {}
                points = shape.get("pointsMm") or []
                if len(points) >= 3:
                    area_mm2 += _polygon_area(points)
    area = max(0.0, area_mm2 / 1_000_000)
    style = next((s for s in STYLES if s["id"] == style_id), None)

    tiers = []
    for tier_id, tier in BUDGET_TIERS.items():
        floor_cost = round(area * tier["floor"])
        wall_cost = round(area * 3 * tier["wall"])
        cabinet_cost = round(area * tier["cabinet"] * 0.4)
        bath_cost = round(2 * tier["bathroom"])
        light_cost = round(area * tier["lighting"])
        subtotal = floor_cost + wall_cost + cabinet_cost + bath_cost + light_cost
        total = round(subtotal * (1 + tier["markup"] / 100))
        tiers.append(
            {
                "tier": tier_id,
                "label": tier["label"],
                "desc": tier["desc"],
                "floorTotal": floor_cost,
                "wallTotal": wall_cost,
                "cabinetTotal": cabinet_cost,
                "bathroomTotal": bath_cost,
                "lightingTotal": light_cost,
                "markupPercent": tier["markup"],
                "subtotal": subtotal,
                "total": total,
            }
        )

    style_materials = style.get("materials", {}) if style else {}
    items = _material_items(area, style_id, style_materials)
    return {
        "areaM2": round(area, 1),
        "styleName": style["name"] if style else None,
        "styleMaterials": style_materials,
        "tiers": tiers,
        "items": items,
        "recommendation": _recommend_tier(area),
    }


def _polygon_area(points: list) -> float:
    """鞋带公式，返回平方毫米。"""
    total = 0.0
    count = len(points)
    for i in range(count):
        x1, y1 = points[i][0], points[i][1]
        x2, y2 = points[(i + 1) % count][0], points[(i + 1) % count][1]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def _material_items(area: float, style_id: str | None, materials: dict) -> list[dict]:
    """按风格输出材料清单条目（含用量估算与三档单价）。"""
    floor = materials.get("floor", "常规地面材料")
    wall = materials.get("wall", "常规墙面材料")
    furniture = materials.get("furniture", "常规家具饰面")
    return [
        {
            "category": "地面",
            "name": floor,
            "quantity": round(area * 1.05, 1),
            "unit": "㎡",
            "unitPrice": {"economy": BUDGET_TIERS["economy"]["floor"], "standard": BUDGET_TIERS["standard"]["floor"], "premium": BUDGET_TIERS["premium"]["floor"]},
        },
        {
            "category": "墙面",
            "name": wall,
            "quantity": round(area * 3, 1),
            "unit": "㎡",
            "unitPrice": {"economy": BUDGET_TIERS["economy"]["wall"], "standard": BUDGET_TIERS["standard"]["wall"], "premium": BUDGET_TIERS["premium"]["wall"]},
        },
        {
            "category": "柜体",
            "name": f"{furniture} 定制柜体",
            "quantity": round(area * 0.4, 1),
            "unit": "㎡",
            "unitPrice": {"economy": BUDGET_TIERS["economy"]["cabinet"], "standard": BUDGET_TIERS["standard"]["cabinet"], "premium": BUDGET_TIERS["premium"]["cabinet"]},
        },
        {
            "category": "卫浴",
            "name": "洁具套装（马桶 / 台盆 / 淋浴）",
            "quantity": 2,
            "unit": "套",
            "unitPrice": {"economy": BUDGET_TIERS["economy"]["bathroom"], "standard": BUDGET_TIERS["standard"]["bathroom"], "premium": BUDGET_TIERS["premium"]["bathroom"]},
        },
        {
            "category": "灯具",
            "name": f"{'主灯 + 辅助照明'}（{style_id or '通用'}）",
            "quantity": round(area, 1),
            "unit": "㎡",
            "unitPrice": {"economy": BUDGET_TIERS["economy"]["lighting"], "standard": BUDGET_TIERS["standard"]["lighting"], "premium": BUDGET_TIERS["premium"]["lighting"]},
        },
    ]


def _recommend_tier(area: float) -> str:
    if area < 60:
        return "economy"
    if area < 120:
        return "standard"
    return "premium"


# ---------------------------------------------------------------------------
# 从效果图反推材料
# ---------------------------------------------------------------------------

_MATERIAL_PROMPT = """你是室内设计材料专家。观察这张室内效果图，推断可见的材料做法。
只输出 JSON：{"styleGuess":"风格判断","materials":[{"surface":"墙面|地面|柜体|灯具|软装","name":"材料名称","color":"主要颜色","finish":"哑光|亮光|木纹|织物等","confidence":0-1}],"notes":"补充说明"}
最多 8 条，只描述画面里能看到的内容，不要编造品牌。"""


def materials_from_image(image_bytes: bytes, style_hint: str = "") -> dict:
    """用视觉模型从效果图反推材料建议。"""
    import base64

    from .config import settings

    if not settings.ai_ready:
        return {"ok": False, "reason": "未启用 AI 调用，无法从图片反推材料。", "materials": []}

    from .providers import provider_base

    model = settings.dashscope_vision_model.strip()
    if not model:
        return {"ok": False, "reason": "未配置视觉模型。", "materials": []}

    import httpx

    data_url = "data:image/jpeg;base64," + base64.b64encode(image_bytes).decode("ascii")
    hint = f"\n目标风格参考：{style_hint}" if style_hint else ""
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _MATERIAL_PROMPT + hint},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        "temperature": 0.2,
        "max_tokens": 900,
    }
    try:
        response = httpx.post(
            provider_base() + "/compatible-mode/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.dashscope_api_key}"},
            json=payload,
            timeout=90,
        )
    except Exception as exc:
        return {"ok": False, "reason": f"视觉模型网络异常：{exc}", "materials": []}

    if response.status_code >= 400:
        detail = ""
        try:
            detail = response.json().get("error", {}).get("message", "")
        except Exception:
            detail = response.text[:120]
        hint = (
            "密钥无效，请更新 DASHSCOPE_API_KEY。"
            if response.status_code in (401, 403)
            else "请稍后重试或更换模型。"
        )
        return {
            "ok": False,
            "reason": f"视觉模型返回 HTTP {response.status_code}：{detail or hint}",
            "materials": [],
        }

    try:
        content = response.json()["choices"][0]["message"]["content"]
    except Exception:
        return {"ok": False, "reason": "视觉模型返回结构异常。", "materials": []}

    data = _extract_json(content if isinstance(content, str) else "")
    if not data:
        return {"ok": False, "reason": "视觉模型返回无法解析。", "materials": []}

    materials = []
    for item in (data.get("materials") or [])[:8]:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        surface = str(item.get("surface") or "").strip()
        name = str(item.get("name")).strip()
        materials.append(
            {
                "surface": surface,
                "name": name,
                "color": str(item.get("color") or "").strip(),
                "finish": str(item.get("finish") or "").strip(),
                "confidence": float(item.get("confidence") or 0),
                "tierSuggestions": _tier_for_material(surface, name),
            }
        )
    return {
        "ok": True,
        "styleGuess": str(data.get("styleGuess") or "").strip(),
        "materials": materials,
        "notes": str(data.get("notes") or "").strip(),
    }


_MATERIAL_TIER_POOL = {
    "墙面": [
        ("经济档", "国产乳胶漆（立邦/多乐士基础系列）"),
        ("标准档", "进口乳胶漆或国产艺术漆"),
        ("高档档", "进口艺术漆 / 微水泥 / 壁布"),
    ],
    "地面": [
        ("经济档", "国产强化复合地板或 800×800 抛釉砖"),
        ("标准档", "三层实木复合地板或 750×1500 通体砖"),
        ("高档档", "实木地板或进口岩板"),
    ],
    "柜体": [
        ("经济档", "颗粒板 + 国产五金"),
        ("标准档", "多层实木板 + 百隆/海蒂诗五金"),
        ("高档档", "实木/进口饰面板 + 进口五金"),
    ],
    "灯具": [
        ("经济档", "国产 LED 吸顶灯 + 筒灯"),
        ("标准档", "品牌无主灯方案（射灯 + 灯带）"),
        ("高档档", "进口灯具 / 智能照明系统"),
    ],
    "软装": [
        ("经济档", "国产棉麻布艺"),
        ("标准档", "品牌布艺 + 局部真皮"),
        ("高档档", "进口面料 / 全真皮 / 羊毛地毯"),
    ],
}


def _tier_for_material(surface: str, name: str) -> list[dict]:
    pool = _MATERIAL_TIER_POOL.get(surface) or _MATERIAL_TIER_POOL["墙面"]
    return [{"tier": label, "suggestion": text} for label, text in pool]
