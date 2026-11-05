"""小筑 assistant: routing, grounded knowledge, project context and human handoff."""

from fastapi.testclient import TestClient

from interior import assistant, providers, weather
from interior.config import settings
from interior.database import session_scope
from interior.main import app
from interior.models import User


def test_rule_intent_routing_and_knowledge_retrieval():
    assert assistant.route_intent("卫生间防水做多高") == "construction"
    assert assistant.route_intent("你好呀") == "chat"
    assert assistant.route_intent("100 平米装修多少钱") == "budget"
    assert assistant.route_intent("现代简约风格怎么搭配") == "design"
    assert assistant.route_intent("乳胶漆怎么选") == "knowledge"
    assert assistant.route_intent("请帮我转人工") == "handoff"
    top = assistant.search_knowledge("卫生间防水做多高")
    assert top[0]["id"] == "waterproof"


def test_ai_narration_keeps_sources_and_falls_back(monkeypatch):
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_text_model", "qwen3.8-27b")
    monkeypatch.setattr(providers, "chat_text", lambda messages: "AI 叙述回答")
    result = assistant.answer("卫生间防水做多高")
    assert result["mode"] == "ai"
    assert result["content"] == "AI 叙述回答"
    assert any(source["id"] == "waterproof" for source in result["sources"])

    def broken(messages):
        raise RuntimeError("provider down")

    monkeypatch.setattr(providers, "chat_text", broken)
    fallback = assistant.answer("卫生间防水做多高")
    assert fallback["mode"] == "rules"
    assert "1.8" in fallback["content"]


def test_safety_question_refuses_and_suggests_handoff():
    result = assistant.rule_answer("承重墙可以拆掉吗")
    assert "不得" in result["content"]
    assert result["handoffSuggested"] is True


def test_assistant_chat_uses_project_and_persists_history(signed, project):
    pid, _ = project
    response = signed.post(
        "/api/assistant/chat", json={"message": "卫生间防水做多高", "projectId": pid}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "rules"
    assert body["message"]["intent"] == "construction"
    assert "1.8" in body["message"]["content"]
    assert any(source["id"] == "waterproof" for source in body["message"]["sources"])
    conversation_id = body["conversationId"]

    budget = signed.post(
        "/api/assistant/chat",
        json={"message": "我家大概多少预算", "conversationId": conversation_id},
    ).json()
    assert budget["message"]["intent"] == "budget"
    assert "半包" in budget["message"]["content"] and "万" in budget["message"]["content"]
    assert any(action["tab"] == "budget" for action in budget["message"]["actions"])

    history = signed.get(f"/api/assistant/conversations/{conversation_id}").json()
    assert [m["role"] for m in history["messages"]] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assert history["conversation"]["projectId"] == pid


def test_unknown_topic_is_routed_to_human_handoff(signed):
    body = signed.post(
        "/api/assistant/chat",
        json={"message": "施工现场出现了一种很罕见的特殊状况"},
    ).json()
    assert body["handoffSuggested"] is True
    assert body["message"]["sources"] == []
    assert any(
        action["type"] == "handoff" for action in body["message"]["actions"]
    )

    handoff = signed.post(
        "/api/assistant/handoffs",
        json={
            "conversationId": body["conversationId"],
            "reason": "施工问题",
            "detail": "现场情况特殊，需要人工判断",
            "contact": "13900000000",
        },
    )
    assert handoff.status_code == 201, handoff.text
    ticket = handoff.json()
    assert ticket["status"] == "pending" and ticket["notified"] is False
    mine = signed.get("/api/assistant/handoffs").json()["items"]
    assert [row["id"] for row in mine] == [ticket["id"]]
    assert mine[0]["status"] == "pending"


def test_conversations_are_private_and_admin_can_resolve(signed, project):
    pid, _ = project
    chat = signed.post(
        "/api/assistant/chat", json={"message": "水电怎么验收", "projectId": pid}
    ).json()
    user_id = signed.get("/api/me").json()["id"]
    ticket = signed.post(
        "/api/assistant/handoffs",
        json={"conversationId": chat["conversationId"], "reason": "需要人工复核"},
    ).json()

    with TestClient(app) as other:
        login = other.post("/api/auth/demo", json={}).json()
        other.headers["X-CSRF-Token"] = login["csrfToken"]
        assert (
            other.get(f"/api/assistant/conversations/{chat['conversationId']}").status_code
            == 404
        )
        forbidden = other.patch(
            f"/api/admin/assistant/handoffs/{ticket['id']}",
            json={"status": "resolved", "resolution": "x"},
        )
        assert forbidden.status_code == 403

    assert (
        signed.patch(
            f"/api/admin/assistant/handoffs/{ticket['id']}",
            json={"status": "resolved", "resolution": "x"},
        ).status_code
        == 403
    )
    with session_scope() as db:
        db.get(User, user_id).system_role = "admin"
    queue = signed.get("/api/admin/assistant/handoffs?status=pending").json()["items"]
    assert ticket["id"] in [row["id"] for row in queue]
    resolved = signed.patch(
        f"/api/admin/assistant/handoffs/{ticket['id']}",
        json={"status": "resolved", "resolution": "已电话回访并确认验收节点。"},
    )
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"
    history = signed.get(f"/api/assistant/conversations/{chat['conversationId']}").json()
    assert history["messages"][-1]["mode"] == "human"
    assert "已电话回访" in history["messages"][-1]["content"]


def _fake_weather(url, params):
    if "geocoding" in url:
        return {
            "results": [
                {
                    "name": "上海",
                    "admin1": "上海市",
                    "latitude": 31.22,
                    "longitude": 121.46,
                }
            ]
        }
    return {
        "current": {
            "temperature_2m": 20.4,
            "apparent_temperature": 21.3,
            "precipitation": 0,
            "weather_code": 3,
            "wind_speed_10m": 16.8,
            "relative_humidity_2m": 92,
        },
        "daily": {
            "weather_code": [2, 61],
            "temperature_2m_max": [21.0, 22.5],
            "temperature_2m_min": [18.1, 17.2],
            "precipitation_probability_max": [20, 80],
        },
    }


def test_city_extraction_ignores_time_and_filler_words():
    assert weather.extract_city("上海今天天气怎么样") == "上海"
    assert weather.extract_city("我在杭州，天气怎么样") == "杭州"
    assert weather.extract_city("明天北京冷不冷") == "北京"
    assert weather.extract_city("今天天气怎么样") is None
    assert weather.extract_city("天气怎么样") is None


def test_weather_uses_live_feed_instead_of_text_model(monkeypatch):
    calls = {"ai": 0}
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_text_model", "qwen3.8-27b")
    monkeypatch.setattr(settings, "weather_default_city", "上海")
    monkeypatch.setattr(weather, "_CITY_CACHE", {})
    monkeypatch.setattr(weather, "fetch_json", _fake_weather)

    def fake_chat(messages):
        calls["ai"] += 1
        return "不应被调用"

    monkeypatch.setattr(providers, "chat_text", fake_chat)
    result = assistant.answer("今天天气怎么样")
    assert result["intent"] == "weather"
    assert result["mode"] == "rules"
    assert calls["ai"] == 0
    assert "上海" in result["content"]
    assert "20.4 ℃" in result["content"] and "阴" in result["content"]
    assert result["sources"][0]["id"] == "weather"
    assert result["handoffSuggested"] is False


def test_weather_unknown_city_asks_for_another_name(monkeypatch):
    monkeypatch.setattr(settings, "weather_default_city", "")
    monkeypatch.setattr(weather, "_CITY_CACHE", {})
    monkeypatch.setattr(weather, "fetch_json", lambda url, params: {"results": []})
    result = assistant.answer("火星天气")
    assert result["intent"] == "weather"
    assert result["mode"] == "rules"
    assert "没找到" in result["content"]
    assert result["handoffSuggested"] is False


def test_weather_outage_degrades_to_plain_notice(monkeypatch):
    monkeypatch.setattr(settings, "weather_default_city", "上海")
    monkeypatch.setattr(weather, "_CITY_CACHE", {})

    def broken(url, params):
        raise weather.WeatherError("down")

    monkeypatch.setattr(weather, "fetch_json", broken)
    result = assistant.answer("上海天气")
    assert result["mode"] == "rules"
    assert "暂时连不上" in result["content"]
    assert result["sources"] == []
    assert result["handoffSuggested"] is False


def test_home_question_prompt_keeps_knowledge_library(monkeypatch):
    captured = {}
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_text_model", "qwen3.8-27b")

    def fake_chat(messages):
        captured["system"] = messages[0]["content"]
        return "防水建议"

    monkeypatch.setattr(providers, "chat_text", fake_chat)
    result = assistant.answer("卫生间防水做多高")
    assert "家装顾问模式" in captured["system"]
    assert "[waterproof]" in captured["system"]
    assert result["sources"][0]["id"] == "waterproof"


def test_general_chat_uses_model_without_knowledge_constraint(monkeypatch):
    captured = {}
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_text_model", "qwen3.8-27b")

    def fake_chat(messages):
        captured["system"] = messages[0]["content"]
        return "可以试试附近的家常菜馆，具体以点评平台为准。"

    monkeypatch.setattr(providers, "chat_text", fake_chat)
    result = assistant.answer("有什么好吃的")
    assert result["intent"] == "general"
    assert result["mode"] == "ai"
    assert "通用闲聊模式" in captured["system"]
    assert "本题不属于家装" in captured["system"]
    assert "只使用提供的项目事实与知识条目" not in captured["system"]
    assert result["sources"] == []
    assert result["handoffSuggested"] is False
    assert not any(action["type"] == "handoff" for action in result["actions"])


def test_general_chat_without_model_suggests_handoff():
    result = assistant.rule_answer("有什么好吃的")
    assert result["intent"] == "general"
    assert result["handoffSuggested"] is True
    assert any(action["type"] == "handoff" for action in result["actions"])
