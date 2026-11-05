"""装修避坑审查引擎。

面向装修消费者的 AI 批判审查，帮助在签合同前发现隐形陷阱。
支持设计图纸 + 合同报价单上传后的多维度分析。
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class Finding:
    """单条审查发现。"""

    id: str
    category: Literal[
        "hygiene_corner",
        "over_decoration",
        "contract_trap",
        "cross_doc_mismatch",
        "item_prediction",
    ]
    severity: Literal["high", "medium", "low"]
    title: str
    description: str
    advice: str
    evidence: str | None = None
    estimated_amount_minor: int | None = None


@dataclass
class ReviewReport:
    """完整审查报告。"""

    summary: str
    total_findings: int
    by_severity: dict[str, int]
    by_category: dict[str, int]
    findings: list[Finding] = field(default_factory=list)
    created_at: str = ""
    contract_reliability_score: int = 50  # 0-100
    predicted_extra_cost_minor: int = 0


# ---------------------------------------------------------------------------
# 本地坑位知识库（装修避坑条目）
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
    },
    {
        "category": "hygiene_corner",
        "keywords": ["淋浴房", "玻璃隔断", "地漏"],
        "title": "淋浴房边缘发霉死角",
        "severity": "medium",
        "description": "玻璃隔断与地面连接处未做等电位，底座周边未留 5-8mm 打胶缝，半年内必然发黑发霉。",
        "advice": "要求报价单列打胶密封项并指定防霉玻璃胶品牌；底座留伸缩缝。",
    },
    {
        "category": "hygiene_corner",
        "keywords": ["橱柜", "地柜", "踢脚板"],
        "title": "橱柜底部卫生死角",
        "severity": "medium",
        "description": "地柜完全落地无踢脚板或踢脚板密封过严，柜底成为蟑螂滋生和食物残渣积聚区。",
        "advice": "选用悬浮地柜或留 80-100mm 踢脚板空间并安装可拆洗踢脚板。",
    },
    # --- 过度装修 ---
    {
        "category": "over_decoration",
        "keywords": ["吊顶", "多层吊顶", "复杂吊顶"],
        "title": "吊顶层数超标",
        "severity": "medium",
        "description": "客厅设计 3 层及以上吊顶，增加石膏板、龙骨、油漆及安装人工，单这一项多出 8000-15000 元，且积灰难清洁。",
        "advice": "考虑单层边吊 + 灯槽，或不做吊顶只做石膏线，节省预算同时更易维护。",
        "estimated_amount_minor": 1200000,
    },
    {
        "category": "over_decoration",
        "keywords": ["石材", "大理石", "背景墙"],
        "title": "石材背景墙非必要",
        "severity": "low",
        "description": "电视背景墙用天然大理石或岩板，单价 800-1500 元/㎡，加上造型和安装费一项 3-8 万。",
        "advice": "考虑艺术漆、木纹板、石膏线造型等替代方案，成本仅为石材的 20-40%。",
        "estimated_amount_minor": 500000,
    },
    # --- 合同陷阱 ---
    {
        "category": "contract_trap",
        "keywords": ["按实结算", "按实际", "最终结算"],
        "title": "价格锁定条款模糊",
        "severity": "high",
        "description": "合同出现「按实结算」「按实际发生量」等模糊表述，意味着施工方可以任意追加项目。",
        "advice": "要求改为「固定总价 + 限额外 5% 以内调整」；明确哪些项目不在预算内。",
    },
    {
        "category": "contract_trap",
        "keywords": ["品牌", "指定品牌", "高级品牌"],
        "title": "材料品牌未标注",
        "severity": "high",
        "description": "报价单/合同仅写「乳胶漆」「地板」「瓷砖」未指定品牌型号，施工方可能以次充好。",
        "advice": "要求每个材料项标注品牌、型号、规格，附件列出完整材料清单并作为合同组成部分。",
    },
    {
        "category": "contract_trap",
        "keywords": ["工期", "延误", "违约金"],
        "title": "工期违约金缺失",
        "severity": "medium",
        "description": "合同未约定延误赔付，或延误赔付比例过低（<0.1%/天），装修公司无动力按期交付。",
        "advice": "要求增加工期违约金（建议 0.1-0.5%/天，总上限合同额 10-20%）。",
    },
    {
        "category": "contract_trap",
        "keywords": ["质保", "保修", "售后"],
        "title": "质保期短于行业标准",
        "severity": "medium",
        "description": "行业规定基础工程质保 2 年、水电隐蔽工程质保 5 年。合同如低于此标准需警惕。",
        "advice": "要求至少 2 年基础质保 + 5 年水电质保，并明确质保范围（不含人为损坏）。",
    },
]


def match_findings(text_content: str) -> list[Finding]:
    """基于关键词匹配生成本地知识库的发现。"""
    text = (text_content or "").lower()
    results: list[Finding] = []
    idx = 0
    for entry in KNOWLEDGE_BASE:
        if any(kw.lower() in text for kw in entry["keywords"]):
            results.append(
                Finding(
                    id=f"f-{idx}",
                    category=entry["category"],
                    severity=entry["severity"],
                    title=entry["title"],
                    description=entry["description"],
                    advice=entry["advice"],
                    estimated_amount_minor=entry.get("estimated_amount_minor"),
                )
            )
            idx += 1
    return results


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
    summary = _generate_summary(by_severity, score)
    return ReviewReport(
        summary=summary,
        total_findings=len(findings),
        by_severity=by_severity,
        by_category=by_category,
        findings=findings,
        contract_reliability_score=score,
        predicted_extra_cost_minor=total_extra,
    )


def _generate_summary(by_severity: dict, score: int) -> str:
    parts = []
    high = by_severity.get("high", 0)
    med = by_severity.get("medium", 0)
    low = by_severity.get("low", 0)
    if score >= 80:
        verdict = "整体规范，仅有少量需注意的细节"
    elif score >= 60:
        verdict = "存在一些常见问题，签前建议逐条确认"
    elif score >= 40:
        verdict = "有较多需警惕的条款，强烈建议仔细审校"
    else:
        verdict = "问题较多，建议先整改再签合同"
    parts.append(f"合同可靠性评分：{score}/100 — {verdict}")
    parts.append(f"发现 {high} 条高危问题、{med} 条中等问题、{low} 条低危问题。")
    return " | ".join(parts)


# --- 三档预算 ---

BUDGET_TIERS: dict[str, dict] = {
    "economy": {
        "label": "经济档",
        "desc": "性价比优先，选国产主流品牌",
        "floor": 150,   # 元/㎡
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
    """根据场景和风格生成材料清单 + 三档预算。"""
    from .catalog import STYLES
    area = scene.get("totalAreaMm2", 0) / 1_000_000  # ㎡
    style = next((s for s in STYLES if s["id"] == style_id), None)

    material_list = []
    for tier_id, tier in BUDGET_TIERS.items():
        # 估算各项材料金额（元）
        floor_cost = round(area * tier["floor"])
        wall_cost = round(area * 3 * tier["wall"])  # 墙面 ≈ 地面 x 3
        cabinet_cost = round(area * tier["cabinet"] * 0.4)  # 橱柜 ≈ 40% 面积
        bath_cost = round(2 * tier["bathroom"])
        light_cost = round(area * tier["lighting"])
        subtotal = floor_cost + wall_cost + cabinet_cost + bath_cost + light_cost
        total = round(subtotal * (1 + tier["markup"] / 100))
        material_list.append(
            {
                "tier": tier_id,
                "label": tier["label"],
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
    return {
        "areaM2": round(area, 1),
        "styleName": style["name"] if style else None,
        "styleMaterials": style_materials,
        "tiers": material_list,
        "recommendation": _recommend_tier(area, style_materials),
    }


def _recommend_tier(area: float, materials: dict) -> str:
    if area < 60:
        return "economy"
    if area < 120:
        return "standard"
    return "premium"
