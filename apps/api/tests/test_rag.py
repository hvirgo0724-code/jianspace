"""RAG 知识索引、混合检索与小筑上下文注入的单元测试。"""

from interior import rag
from interior.config import settings
from interior.database import session_scope
from interior.models import RagChunk, User
from sqlalchemy import select


def test_corpus_and_chunking_metadata():
    chunks = rag.build_corpus()
    assert len(chunks) >= 80
    ids = {(chunk.doc_id, chunk.chunk_index) for chunk in chunks}
    assert len(ids) == len(chunks)
    assert any(chunk.source_id == "waterproof" for chunk in chunks)
    assert any(chunk.doc_id == "style:modern" for chunk in chunks)
    assert any(chunk.category == "furniture" for chunk in chunks)
    assert all(chunk.title and chunk.text and chunk.source for chunk in chunks)

    long_text = "卫生间防水施工要点。" * 60
    pieces = rag.split_text(long_text)
    assert len(pieces) > 1
    assert all(len(piece) <= rag.MAX_CHUNK_CHARS for piece in pieces)
    assert "".join(pieces).replace(" ", "") != ""


def test_local_embedding_is_deterministic_and_remote_failure_falls_back(monkeypatch):
    first = rag.local_embed("卫生间防水做多高", 128)
    second = rag.local_embed("卫生间防水做多高", 128)
    assert first == second
    assert len(first) == 128
    assert abs(sum(value * value for value in first) - 1) < 1e-6

    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")

    def broken(texts, model):
        raise RuntimeError("embedding provider down")

    monkeypatch.setattr(rag, "remote_embed", broken)
    vectors, embedder, note = rag._embed(
        ["卫生间防水"], rag.Embedder("dashscope", "text-embedding-v4", 0)
    )
    assert embedder.provider == "local"
    assert len(vectors[0]) == settings.rag_embedding_dim
    assert "回落本地编码" in note


def test_index_is_incremental_and_updates_changed_chunks(client, monkeypatch):
    with session_scope() as db:
        first = rag.ensure_index(db)
        assert first["added"] == first["chunks"] > 0
        assert first["indexed"] == first["chunks"]

    with session_scope() as db:
        second = rag.ensure_index(db)
        assert second["added"] == second["updated"] == second["removed"] == 0
        assert second["indexed"] == second["chunks"]

    original = rag.build_corpus
    changed = original()
    changed[0] = rag.Chunk(
        doc_id=changed[0].doc_id,
        chunk_index=changed[0].chunk_index,
        title=changed[0].title,
        category=changed[0].category,
        source=changed[0].source,
        text=changed[0].text + "（索引更新验证）",
        keywords=changed[0].keywords,
        metadata=changed[0].metadata,
    )
    monkeypatch.setattr(rag, "build_corpus", lambda: changed)
    with session_scope() as db:
        third = rag.ensure_index(db)
        assert third["updated"] >= 1
        row = db.scalar(
            select(RagChunk).where(
                RagChunk.doc_id == changed[0].doc_id,
                RagChunk.chunk_index == changed[0].chunk_index,
            )
        )
        assert "索引更新验证" in row.text


def test_hybrid_search_hits_expected_documents(client):
    with session_scope() as db:
        rag.ensure_index(db)

    with session_scope() as db:
        waterproof = rag.search(db, "卫生间防水做多高", 4)
        assert waterproof.mode == "hybrid"
        assert waterproof.indexed >= 80
        assert waterproof.items[0]["id"] == "waterproof"

        sofa = rag.search(db, "小户型选什么沙发", 4)
        assert sofa.items[0]["id"] == "furniture:sofa-small"

        style = rag.search(db, "现代简约风格怎么搭配", 4)
        assert any(item["id"] == "style:modern" for item in style.items)


def test_search_works_without_database():
    result = rag.search(None, "乳胶漆怎么选", 3)
    assert result.items
    assert result.provider == "local"
    assert any(
        "乳胶漆" in item["title"] or "乳胶漆" in item["text"] for item in result.items
    )


def test_retrieval_golden_set_recall():
    """离线金标集：改写问法下，目标片段应进入 top-3。"""
    golden = [
        ("卫生间防水做多高", "waterproof"),
        ("小户型选什么沙发", "furniture:sofa-small"),
        ("现代简约风格怎么搭配", "style:modern"),
        ("经济档装修材料预算", "budget:economy"),
        ("墙面乳胶漆怎么选", "material:墙面"),
    ]
    hits = 0
    for query, expected in golden:
        ids = [item["id"] for item in rag.search(None, query, 3).items]
        hits += expected in ids
    assert hits >= 4, f"recall@3={hits}/{len(golden)}"


def test_chat_endpoint_builds_index_and_injects_rag(signed, monkeypatch):
    from sqlalchemy import func

    captured = {}

    def fake_chat(messages):
        captured["system"] = messages[0]["content"]
        return "建议先定硬装基调 [style:modern]。"

    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_text_model", "qwen3.8-27b")
    from interior import providers

    monkeypatch.setattr(providers, "chat_text", fake_chat)

    response = signed.post(
        "/api/assistant/chat", json={"message": "现代简约风格怎么搭配"}
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["mode"] == "ai"
    assert "[style:modern]" in captured["system"]
    assert any(
        source["id"] == "style:modern" for source in payload["message"]["sources"]
    )

    with session_scope() as db:
        indexed = db.scalar(select(func.count()).select_from(RagChunk))
        assert indexed >= 80


def test_knowledge_endpoints_status_search_and_admin_reindex(signed):
    from fastapi.testclient import TestClient
    from interior.main import app

    with TestClient(app) as anonymous:
        assert (
            anonymous.post(
                "/api/assistant/knowledge/search", json={"query": "防水"}
            ).status_code
            == 401
        )

    assert signed.get("/api/assistant/knowledge/status").status_code == 200

    body = signed.post(
        "/api/assistant/knowledge/search",
        json={"query": "卫生间防水做多高", "limit": 3},
    )
    assert body.status_code == 200, body.text
    payload = body.json()
    assert payload["mode"] in ("hybrid", "lexical")
    assert payload["items"][0]["id"] == "waterproof"
    assert {"id", "title", "source", "text", "score"} <= set(payload["items"][0])

    forbidden = signed.post("/api/assistant/knowledge/reindex")
    assert forbidden.status_code == 403

    user_id = signed.get("/api/me").json()["id"]
    with session_scope() as db:
        db.get(User, user_id).system_role = "admin"
    reindexed = signed.post("/api/assistant/knowledge/reindex")
    assert reindexed.status_code == 200, reindexed.text
    assert reindexed.json()["indexed"] == reindexed.json()["chunks"]

    status = signed.get("/api/assistant/knowledge/status").json()
    assert status["indexed"] == status["chunks"]
    assert status["provider"] == "local"
    assert "assistant" in status["namespaces"]


def test_ai_answer_injects_retrieved_context(monkeypatch):
    captured = {}

    def fake_chat(messages):
        captured["system"] = messages[0]["content"]
        return "建议先定硬装基调，再用软装做层次 [design]。"

    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_text_model", "qwen3.8-27b")
    from interior import assistant, providers

    monkeypatch.setattr(providers, "chat_text", fake_chat)

    result = assistant.answer("现代简约风格怎么搭配")
    assert result["mode"] == "ai"
    assert "[design]" in captured["system"]
    assert "[style:modern]" in captured["system"]
    assert "来源：筑见 12 种风格预设" in captured["system"]
    assert any(item["id"] == "style:modern" for item in result["sources"])


def test_ai_answer_falls_back_to_keyword_library(monkeypatch):
    captured = {}

    def fake_chat(messages):
        captured["system"] = messages[0]["content"]
        return "防水建议 [waterproof]"

    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_text_model", "qwen3.8-27b")
    from interior import assistant, providers

    monkeypatch.setattr(providers, "chat_text", fake_chat)
    monkeypatch.setattr(rag, "retrieve", lambda *args, **kwargs: [])
    result = assistant.answer("卫生间防水做多高")
    assert result["mode"] == "ai"
    assert "[waterproof]" in captured["system"]
    assert any(source["id"] == "waterproof" for source in result["sources"])
