"""Rule-first home renovation assistant with optional LLM narration.

The assistant never invents measured data: project facts come from the member's
working copy, prices are ranges, and uncertain or sensitive questions are routed
to a human handoff ticket instead of being answered as fact.
"""

import re

from .config import settings
from .models import Asset, DesignVersion, WorkingCopy
from .security import authorize

DISCLAIMER = "以上为通用参考，不替代设计师、监理或当地规范；涉及结构与安全请让专业人员现场确认。"

KNOWLEDGE = [
    {
        "id": "waterproof",
        "title": "卫生间防水与闭水试验",
        "keywords": ["防水", "卫生间", "淋浴", "闭水", "渗水", "漏水", "沉箱"],
        "points": [
            "淋浴区墙面防水通常做到 1.8 米或更高；洗手台区域高出台面约 30 厘米；其余墙面常见做法为 30 厘米。",
            "地面与墙面交接处、管根、阴阳角应先做附加层，门口建议做挡水条并延伸防水。",
            "防水层固化后做 24–48 小时闭水试验，蓄水深度不少于 20 毫米，并到楼下对应位置检查是否渗漏。",
        ],
        "source": "通用施工做法（以当地规范、设计说明与施工交底为准）",
    },
    {
        "id": "electrical",
        "title": "水电改造与回路",
        "keywords": ["水电", "电路", "插座", "电线", "回路", "强弱电", "配电箱", "线径"],
        "points": [
            "照明、普通插座、厨房、卫生间空调等建议分回路；大功率电器使用独立回路。",
            "常见线径参考：照明 1.5 mm²、普通插座 2.5 mm²、空调/热水器等大功率 4 mm²，最终按功率与规范核算。",
            "强弱电分开走管并保持间距；线管转弯用弯管器，避免 90°死弯，管内不应有接头。",
            "改造完成后做绝缘、通断与漏保测试，并保留管线走向照片或图纸。",
        ],
        "source": "通用施工做法（以当地规范与持证电工意见为准）",
    },
    {
        "id": "tile",
        "title": "瓷砖铺贴与验收",
        "keywords": ["瓷砖", "铺贴", "空鼓", "美缝", "找平", "地砖", "墙砖"],
        "points": [
            "铺贴前确认排版、起铺点与损耗；大板砖需要匹配的粘结剂与找平器。",
            "空鼓检查可逐块敲击，边角空鼓与大面积空鼓应返工；行业常见控制目标是单块空鼓面积不超过 5%。",
            "用 2 米靠尺检查平整度，缝隙均匀，阳角收口顺直，地漏周边坡度朝向排水点。",
        ],
        "source": "通用验收做法（具体允许偏差以合同与当地标准为准）",
    },
    {
        "id": "paint",
        "title": "乳胶漆与墙面基层",
        "keywords": ["乳胶漆", "涂料", "墙面", "腻子", "底漆", "甲醛", "voc", "环保"],
        "points": [
            "先处理基层：空鼓、开裂、起砂要先修补；腻子干透后打磨并清灰。",
            "通常一遍底漆、两遍面漆；深色漆或基层吸水差异大时按产品说明增加遍数。",
            "关注 VOC、游离甲醛与耐擦洗次数，查看检测报告与批次；环保材料也需要通风。",
        ],
        "source": "通用材料与施工做法（以产品说明和检测报告为准）",
    },
    {
        "id": "acceptance",
        "title": "分阶段验收清单",
        "keywords": ["验收", "工地", "工长", "监理", "节点", "隐蔽工程", "竣工"],
        "points": [
            "水电隐蔽工程：管线走向、打压/绝缘测试、强弱电间距、照片留档。",
            "泥木阶段：防水闭水、瓷砖空鼓与坡度、吊顶龙骨与检修口、柜体收口。",
            "油漆竣工：墙面平整、阴阳角顺直、无色差流挂；安装阶段检查门窗开合与五金。",
            "每个节点建议书面确认后再进入下一阶段，增项先确认价格与做法。",
        ],
        "source": "通用验收流程（以合同约定的验收标准为准）",
    },
    {
        "id": "budget",
        "title": "装修预算构成",
        "keywords": ["预算", "报价", "半包", "全包", "增项", "主材", "辅材", "人工"],
        "points": [
            "半包通常包含人工与辅材，主材自购；全包包含主材、辅材与施工。",
            "报价要拆到项目、数量、单价、工艺与品牌型号，避免只写“一项”。",
            "预留 8%–15% 的机动金应对拆改、找平、管线变更等不可预见项。",
        ],
        "source": "通用预算经验（地区与材料档次差异较大）",
    },
    {
        "id": "design",
        "title": "风格与空间搭配",
        "keywords": ["风格", "现代简约", "原木", "奶油", "中古", "软装", "灯光", "配色", "收纳"],
        "points": [
            "先定硬装基调与主色，再用软装做层次；全屋主色控制在 2–3 种更稳定。",
            "小户型优先做收纳与动线：玄关、餐边、阳台柜按使用频率设计。",
            "灯光分层：基础照明、重点照明与氛围照明分开，避免只靠一盏主灯。",
        ],
        "source": "通用设计建议（需结合采光、层高与家庭成员）",
    },
    {
        "id": "safety",
        "title": "结构与施工安全红线",
        "keywords": ["承重墙", "拆墙", "砸墙", "配重墙", "燃气", "消防", "结构", "改管"],
        "points": [
            "不得自行拆改承重墙、剪力墙、配重墙与建筑主体结构。",
            "燃气管道、消防设施、公共管线改造必须由有资质的单位实施并报备。",
            "涉及结构开洞、加建、外立面改动时，先取得物业与专业结构复核意见。",
        ],
        "source": "安全底线（必须由专业机构现场确认）",
    },
    {
        "id": "contract",
        "title": "合同与付款节点",
        "keywords": ["合同", "付款", "定金", "尾款", "增项", "违约", "工期"],
        "points": [
            "合同写明工期、付款节点、验收标准、增项确认方式与保修期限。",
            "付款建议与验收节点绑定，避免一次性支付大比例款项。",
            "增项必须书面确认单价与工程量后再施工，口头承诺要落到文字。",
        ],
        "source": "通用合同建议（以正式合同与当地法规为准）",
    },
]

INTENT_KEYWORDS = {
    "handoff": ["人工", "客服", "投诉", "纠纷", "维权", "退款", "申诉", "转人工"],
    "weather": [
        "天气", "气温", "下雨", "冷不冷", "热不热", "风力", "空气质量",
        "紫外线", "台风", "穿什么",
    ],
    "budget": ["多少钱", "预算", "报价", "费用", "平米", "平方", "㎡", "全包", "半包", "价格", "万"],
    "construction": [
        "施工", "防水", "水电", "验收", "瓦工", "木工", "油漆", "工期", "工地",
        "工长", "开裂", "漏水", "空鼓", "闭水", "隐蔽工程", "承重墙", "拆墙",
        "砸墙", "配重墙",
    ],
    "design": ["风格", "搭配", "颜色", "配色", "软装", "布局", "设计", "效果图", "家具", "灯光", "收纳"],
    "knowledge": ["材料", "乳胶漆", "瓷砖", "地板", "板材", "环保", "甲醛", "怎么选", "注意", "规范"],
    "chat": ["你好", "谢谢", "心情", "累", "烦", "在吗", "早上好", "晚上好"],
}

HOME_INTENTS = {"budget", "construction", "design", "knowledge"}


def route_intent(text):
    normalized = text.lower()
    scores = {
        intent: sum(1 for keyword in keywords if keyword in normalized)
        for intent, keywords in INTENT_KEYWORDS.items()
    }
    for intent in (
        "handoff",
        "budget",
        "construction",
        "design",
        "knowledge",
        "weather",
        "chat",
    ):
        if scores[intent]:
            return intent
    return "knowledge" if search_knowledge(text) else "general"


def search_knowledge(text, limit=2):
    normalized = text.lower()
    scored = []
    for entry in KNOWLEDGE:
        score = sum(2 if keyword in entry["title"] else 1 for keyword in entry["keywords"] if keyword in normalized)
        if score:
            scored.append((score, entry))
    scored.sort(key=lambda item: (-item[0], item[1]["id"]))
    return [entry for _, entry in scored[:limit]]


def is_home_related(text, intent):
    return intent in HOME_INTENTS or bool(search_knowledge(text))


def project_brief(db, user, project_id):
    if not project_id:
        return None
    project = authorize(db, user, project_id)
    working = db.get(WorkingCopy, (project_id, user.id))
    design = (
        db.get(DesignVersion, project.current_design_id)
        if project.current_design_id
        else None
    )
    scene = working.scene_json if working else design.scene_json if design else None
    brief = {
        "id": project.id,
        "name": project.name,
        "areaM2": None,
        "rooms": None,
        "confirmed": False,
        "styleId": None,
        "photos": 0,
    }
    if scene:
        brief["areaM2"] = round(
            sum(
                room["computedAreaMm2"]
                for floor in scene["floors"]
                for room in floor["rooms"]
                if room["type"] not in ("courtyard", "terrace", "stairwell")
            )
            / 1e6,
            1,
        )
        brief["rooms"] = sum(len(floor["rooms"]) for floor in scene["floors"])
        brief["confirmed"] = scene["confirmation"]["status"] == "confirmed"
        brief["styleId"] = scene["layout"]["styleId"]
    brief["photos"] = (
        db.query(Asset)
        .filter(
            Asset.project_id == project_id,
            Asset.state == "ready",
            Asset.kind == "photo",
        )
        .count()
    )
    return brief


def _area_from_text(text):
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:㎡|平米|平方米|平)", text)
    return float(match.group(1)) if match else None


def _money_range(area, low, high):
    return f"{area * low / 10000:.1f} 万–{area * high / 10000:.1f} 万"


def _budget_answer(text, brief):
    area = (brief or {}).get("areaM2") or _area_from_text(text)
    actions = []
    if brief:
        actions.append({"type": "navigate", "tab": "budget", "label": "打开预算清单"})
    if not area:
        return (
            "可以告诉我房子的建筑面积吗？我按面积给出半包与全包的参考区间。",
            [],
            actions,
            False,
        )
    content = (
        f"按约 {area:g} ㎡估算，装修参考区间如下（不含家电与软装）：\n"
        f"1. **半包（人工 + 辅材）**：约 {_money_range(area, 600, 1000)}。\n"
        f"2. **全包（含主材 + 施工）**：约 {_money_range(area, 1400, 2400)}。\n"
        "影响价格的主要因素：城市与人工费、拆改量、水电重做比例、主材品牌、"
        "柜体与石材用量、是否有地暖/中央空调。\n"
        + ("项目当前已录入实测面积，可在预算清单里按房间细化。" if brief and brief.get("areaM2") else "")
        + f"\n{DISCLAIMER}"
    )
    return (
        content,
        [
            {
                "id": "budget",
                "title": "装修预算构成",
                "source": "平台区间估算（非报价）",
            }
        ],
        actions,
        False,
    )


def _knowledge_answer(intent, text, brief):
    safety = any(
        keyword in text
        for keyword in ("承重墙", "拆墙", "砸墙", "配重墙", "燃气", "消防", "结构开洞")
    )
    entries = search_knowledge(text)
    actions = []
    if brief:
        actions.append({"type": "navigate", "tab": "guide", "label": "查看功能与流程"})
    if safety:
        entry = next(item for item in KNOWLEDGE if item["id"] == "safety")
        content = (
            "这类问题涉及结构与安全，我不能给出拆除或改造建议。\n\n"
            + "\n".join(f"- {point}" for point in entry["points"])
            + "\n\n建议先联系物业与有资质的结构工程师现场复核；需要平台协助时可以直接转人工。"
        )
        return content, [entry], actions, True
    if not entries:
        content = (
            "这个问题我暂时没有可靠的知识条目，不好凭空给结论。"
            "可以换成更具体的材料、空间或施工节点，我也可以帮你转人工，由人工顾问跟进。"
        )
        return content, [], actions, True
    parts = []
    sources = []
    for entry in entries:
        parts.append(f"**{entry['title']}**\n" + "\n".join(f"- {point}" for point in entry["points"]))
        sources.append(
            {"id": entry["id"], "title": entry["title"], "source": entry["source"]}
        )
    parts.append(DISCLAIMER)
    return "\n\n".join(parts), sources, actions, False


def _design_answer(brief):
    context = ""
    if brief:
        context = (
            f"当前项目「{brief['name']}」约 {brief['areaM2'] or '未录入'} ㎡、"
            f"{brief['rooms'] or '未录入'} 个空间，"
            + ("尺寸已确认。" if brief["confirmed"] else "尺寸尚未确认，建议先完成实测。")
        )
    content = (
        (context + "\n\n" if context else "")
        + "做设计前建议先定三件事：常住人数与生活习惯、必须保留的家具、预算上限。\n"
        "1. 硬装基调先定主色与地面材质，再用软装增加层次。\n"
        "2. 小户型优先保证动线与收纳，避免为了造型牺牲通行。\n"
        "3. 灯光做分层：基础、重点与氛围分开控制。\n"
        + DISCLAIMER
    )
    return content, [], [{"type": "navigate", "tab": "editor", "label": "进入空间设计"}], False


def _chat_answer(text):
    if any(word in text for word in ("心情", "累", "烦", "压力")):
        content = (
            "装修事情多确实容易累。可以先只处理一件小事：量好一个房间、确认一版尺寸，"
            "其余交给清单。想吐槽也可以继续说，我在。"
        )
    else:
        content = (
            "你好，我是小筑，负责家装知识、预算、设计和施工避坑。"
            "可以直接问我“卫生间防水做多高”“89 平米怎么控预算”，也可以让我结合当前项目回答。"
        )
    return content, [], [], False


def _weather_answer(text):
    from . import weather

    try:
        content, sources = weather.answer(text)
    except weather.WeatherError:
        content = (
            "天气服务暂时连不上，稍后再问一次；出行前也可以直接看手机天气 App。"
        )
        sources = []
    return content, sources, [], False


def _general_answer(text):
    content = (
        "这个问题不在家装范围内，当前没有可用的模型来展开回答，我不想凭空编。"
        "可以换个装修、材料、预算或施工的问题；需要的话也能转人工顾问。"
    )
    return content, [], [], True


def _with_handoff_action(result):
    if result["handoffSuggested"] and not any(
        action.get("type") == "handoff" for action in result["actions"]
    ):
        result["actions"] = [
            *result["actions"],
            {"type": "handoff", "label": "转人工顾问"},
        ]
    return result


def rule_answer(text, brief=None):
    intent = route_intent(text)
    if intent == "budget":
        content, sources, actions, handoff = _budget_answer(text, brief)
    elif intent == "design":
        content, sources, actions, handoff = _design_answer(brief)
    elif intent in ("construction", "knowledge"):
        content, sources, actions, handoff = _knowledge_answer(intent, text, brief)
    elif intent == "weather":
        content, sources, actions, handoff = _weather_answer(text)
    elif intent == "handoff":
        content, sources, actions, handoff = (
            "可以转人工。请描述具体问题与期望，我会把当前对话和项目信息一起交给人工顾问。",
            [],
            [{"type": "handoff", "label": "填写转人工申请"}],
            True,
        )
    elif intent == "chat":
        content, sources, actions, handoff = _chat_answer(text)
    else:
        content, sources, actions, handoff = _general_answer(text)
    return _with_handoff_action(
        {
            "intent": intent,
            "mode": "rules",
            "content": content,
            "sources": sources,
            "actions": actions,
            "handoffSuggested": handoff,
        }
    )


def _system_prompt(brief, entries, home_related=True):
    context = "无当前项目。"
    if brief:
        context = (
            f"项目：{brief['name']}；面积：{brief['areaM2']} ㎡；空间数：{brief['rooms']}；"
            f"尺寸状态：{'已确认' if brief['confirmed'] else '未确认'}；照片数：{brief['photos']}。"
        )
    if home_related:
        library = "\n".join(
            f"[{entry['id']}] {entry['title']}：" + " ".join(entry["points"])
            for entry in entries
        ) or "无匹配条目"
        mode = (
            "当前是家装顾问模式。先使用下方知识条目与项目事实，再补充通用常识；"
            "知识不足时明确说不知道，并建议转人工。"
        )
    else:
        library = "无（本题不属于家装，无需知识条目）"
        mode = (
            "当前是通用闲聊模式。可以回答生活常识、饮食、出行等日常话题，"
            "自然、简短、有用；不编造实时数据、具体店铺或营业信息，不确定就直说，"
            "回答后如需也可轻轻带回装修话题。"
        )
    return (
        "你是「小筑」，筑见平台的家装管家，也可以陪用户聊几句日常。\n"
        "规则：\n"
        "1. 家装问题以项目事实与知识条目为依据，不虚构尺寸、材料和规范。\n"
        "2. 价格只给区间并说明影响因素，绝不编造精确报价或材料价格。\n"
        "3. 不提供承重墙拆改、燃气、消防等违规或危险建议，必须建议专业复核。\n"
        "4. 不承诺施工结果，不替代设计、监理或当地规范。\n"
        "5. 回答使用简体中文，先给结论，再给要点；末尾最多问一个下一步问题。\n"
        f"6. {mode}\n"
        f"项目上下文：{context}\n"
        f"可用知识：\n{library}\n"
    )


def ai_answer(text, brief, history):
    if not (
        settings.allow_ai_calls
        and settings.dashscope_api_key
        and settings.dashscope_text_model.strip()
    ):
        return None
    from .providers import chat_text

    intent = route_intent(text)
    home_related = is_home_related(text, intent)
    entries = (
        [] if intent == "budget" or not home_related else search_knowledge(text)
    )
    messages = [
        {"role": "system", "content": _system_prompt(brief, entries, home_related)}
    ]
    messages.extend(history[-8:])
    messages.append({"role": "user", "content": text[:2000]})
    try:
        content = chat_text(messages)
    except Exception:
        return None
    if not content.strip():
        return None
    return {
        "intent": intent,
        "mode": "ai",
        "content": content.strip()[:6000],
        "sources": [
            {"id": entry["id"], "title": entry["title"], "source": entry["source"]}
            for entry in entries
        ],
        "actions": (
            [{"type": "navigate", "tab": "budget", "label": "打开预算清单"}]
            if intent == "budget" and brief
            else []
        ),
        "handoffSuggested": intent == "handoff",
    }


def answer(text, brief=None, history=None):
    routed = rule_answer(text, brief)
    # Weather is answered from the live feed, not re-narrated by the model.
    if routed["intent"] == "weather":
        return routed
    ai = ai_answer(text, brief, history or [])
    if ai:
        # Keep the deterministic safety signal only for home questions.
        if is_home_related(text, routed["intent"]):
            ai["handoffSuggested"] = ai["handoffSuggested"] or routed["handoffSuggested"]
            if routed["sources"] and not ai["sources"]:
                ai["sources"] = routed["sources"]
        return _with_handoff_action(ai)
    return routed


def conversation_brief(conversation):
    return {
        "id": conversation.id,
        "projectId": conversation.project_id,
        "title": conversation.title,
        "createdAt": conversation.created_at,
    }


def message_view(message):
    return {
        "id": message.id,
        "role": message.role,
        "content": message.content,
        "intent": message.intent,
        "sources": message.sources_json,
        "actions": message.actions_json,
        "mode": message.mode,
        "createdAt": message.created_at,
    }
