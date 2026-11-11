"""Retrieval-augmented knowledge for the 小筑 assistant.

The corpus is derived from rule libraries that already exist in this package
(assistant knowledge, review rules, style presets, furniture catalog), so there
is no second copy of the content. Chunks are stored in ``rag_chunks`` with a
deterministic local embedding: character n-gram hashing. That keeps retrieval
available with SQLite, PostgreSQL without the vector extension, and no network
access at all. When a DashScope key is configured, ``RAG_EMBEDDING_PROVIDER``
can switch indexing to the hosted embedding model; any failure falls back to the
local encoder, and query time degrades to lexical-only scoring.

This module never raises into the assistant: callers get an empty result and the
existing keyword ``search_knowledge`` path remains the final fallback.
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .config import settings
from .models import RagChunk, now

MAX_CHUNK_CHARS = 320
CHUNK_OVERLAP = 40
LOCAL_MODEL = "char-ngram-hash-v1"
DEFAULT_LOCAL_DIM = 384

_ASCII_WORD = re.compile(r"[a-zA-Z0-9_]+")
_CHINESE = re.compile(r"[\u4e00-\u9fff]")
_SENTENCE = re.compile(r"(?<=[。！？；;.!?])\s*")


@dataclass
class Chunk:
    """One indexable passage with the metadata used for citations and boosts."""

    doc_id: str
    chunk_index: int
    title: str
    category: str
    source: str
    text: str
    keywords: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    @property
    def source_id(self) -> str:
        # Assistant ids stay stable (``waterproof``) so existing sources and
        # tests keep working; other namespaces keep their prefix.
        if self.doc_id.startswith("assistant:"):
            return self.doc_id.split(":", 1)[1]
        return self.doc_id


@dataclass
class Embedder:
    provider: str
    model: str
    dim: int


@dataclass
class Retrieval:
    items: list[dict]
    mode: str
    provider: str
    indexed: int
    note: str = ""


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "").lower()


def tokens(text: str) -> list[str]:
    """ASCII words plus Chinese bigrams; precision over single characters."""
    normalized = _normalize(text)
    words = _ASCII_WORD.findall(normalized)
    chinese = "".join(_CHINESE.findall(normalized))
    words.extend(chinese[i : i + 2] for i in range(max(0, len(chinese) - 1)))
    if not words and chinese:
        words.append(chinese)
    return words


def split_text(
    text: str, max_chars: int = MAX_CHUNK_CHARS, overlap: int = CHUNK_OVERLAP
) -> list[str]:
    """Split prose on sentence boundaries, falling back to hard cuts."""
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return []
    if len(cleaned) <= max_chars:
        return [cleaned]
    pieces: list[str] = []
    for sentence in _SENTENCE.split(cleaned):
        sentence = sentence.strip()
        if not sentence:
            continue
        while len(sentence) > max_chars:
            pieces.append(sentence[:max_chars])
            sentence = sentence[max_chars - overlap :]
        pieces.append(sentence)

    chunks: list[str] = []
    buffer = ""
    for piece in pieces:
        candidate = f"{buffer}{piece}" if buffer else piece
        if buffer and len(candidate) > max_chars:
            chunks.append(buffer.strip())
            tail = buffer[-overlap:] if overlap else ""
            buffer = tail + piece if len(tail) + len(piece) <= max_chars else piece
        else:
            buffer = candidate
    if buffer.strip():
        chunks.append(buffer.strip())
    return chunks


def _review_doc_id(title: str) -> str:
    return "review:" + hashlib.sha1(title.encode("utf-8")).hexdigest()[:10]


def build_corpus() -> list[Chunk]:
    """Build the document corpus from existing rule sources."""
    from . import assistant as assistant_module
    from . import catalog, review

    chunks: list[Chunk] = []

    for entry in assistant_module.KNOWLEDGE:
        text = "；".join(str(point) for point in entry["points"])
        chunks.append(
            Chunk(
                doc_id=f"assistant:{entry['id']}",
                chunk_index=0,
                title=entry["title"],
                category="assistant",
                source=entry["source"],
                text=text,
                keywords=list(entry["keywords"]),
                metadata={"namespace": "assistant"},
            )
        )

    for entry in review.KNOWLEDGE_BASE:
        title = str(entry["title"])
        text = f"{entry['description']} 建议：{entry['advice']}"
        chunks.append(
            Chunk(
                doc_id=_review_doc_id(title),
                chunk_index=0,
                title=title,
                category=str(entry["category"]),
                source="筑见装修避坑本地知识库",
                text=text,
                keywords=list(entry.get("keywords") or []),
                metadata={
                    "namespace": "review",
                    "severity": entry.get("severity"),
                    "budgetKeywords": list(entry.get("budgetKeywords") or []),
                },
            )
        )

    for style in catalog.STYLES:
        materials = style.get("materials") or {}
        text = (
            f"{style['description']} 地面：{materials.get('floor', '')}；"
            f"墙面：{materials.get('wall', '')}；家具：{materials.get('furniture', '')}。"
            f"提示词关键词：{style.get('prompt_keywords', '')}"
        )
        chunks.append(
            Chunk(
                doc_id=f"style:{style['id']}",
                chunk_index=0,
                title=style["name"],
                category="style",
                source="筑见 12 种风格预设",
                text=text,
                keywords=[str(style.get("prompt_keywords") or "")],
                metadata={"namespace": "style", "styleId": style["id"]},
            )
        )

    for item in catalog.CATALOG:
        size = item.get("sizeMm") or []
        size_text = "×".join(str(value) for value in size) if size else "未标注"
        text = (
            f"{item['name']}，类别 {item.get('category', '')}，"
            f"分组 {item.get('group', '')}，尺寸 {size_text} mm，"
            f"安装方式 {item.get('placement', '')}。"
        )
        chunks.append(
            Chunk(
                doc_id=f"furniture:{item['id']}",
                chunk_index=0,
                title=item["name"],
                category="furniture",
                source="筑见家具家电目录",
                text=text,
                keywords=[str(value) for value in item.get("keywords") or []],
                metadata={"namespace": "furniture", "skuId": item["id"]},
            )
        )

    for tier_id, tier in review.BUDGET_TIERS.items():
        text = (
            f"{tier['label']}：{tier['desc']}。参考单价 地面 {tier['floor']}、"
            f"墙面 {tier['wall']}、柜体 {tier['cabinet']}、卫浴 {tier['bathroom']}、"
            f"灯具 {tier['lighting']}，管理费上浮 {tier['markup']}%。"
        )
        chunks.append(
            Chunk(
                doc_id=f"budget:{tier_id}",
                chunk_index=0,
                title=f"材料预算 · {tier['label']}",
                category="budget",
                source="筑见材料三档预算口径（非报价）",
                text=text,
                keywords=["预算", "材料", "单价", tier["label"]],
                metadata={"namespace": "budget", "tier": tier_id},
            )
        )

    for surface, options in review._MATERIAL_TIER_POOL.items():
        detail = "；".join(f"{label} {text}" for label, text in options)
        chunks.append(
            Chunk(
                doc_id=f"material:{surface}",
                chunk_index=0,
                title=f"{surface}材料三档建议",
                category="material",
                source="筑见材料清单三档建议",
                text=detail,
                keywords=[surface, "材料", "替代方案"],
                metadata={"namespace": "material", "surface": surface},
            )
        )

    return chunks


def corpus_signature(chunks: list[Chunk], embedder: Embedder) -> str:
    payload = "|".join(
        f"{chunk.doc_id}:{chunk.chunk_index}:{_hash(chunk.text)}" for chunk in chunks
    )
    return _hash(f"{payload}|{embedder.provider}:{embedder.model}:{embedder.dim}")


def _configured_embedder() -> Embedder:
    provider = (settings.rag_embedding_provider or "local").strip().lower()
    if provider == "dashscope" and settings.ai_ready and settings.rag_embedding_model:
        return Embedder("dashscope", settings.rag_embedding_model.strip(), 0)
    return Embedder("local", LOCAL_MODEL, settings.rag_embedding_dim)


def local_embed(text: str, dim: int) -> list[float]:
    """Signed hashing of character bigrams, L2 normalised."""
    normalized = _normalize(text)
    chinese = "".join(_CHINESE.findall(normalized))
    features: Counter[str] = Counter()
    for i in range(max(0, len(chinese) - 1)):
        features[f"b:{chinese[i : i + 2]}"] += 1.0
    for char in chinese:
        features[f"u:{char}"] += 0.35
    for word in _ASCII_WORD.findall(normalized):
        features[f"w:{word}"] += 1.2
    vector = [0.0] * dim
    for feature, weight in features.items():
        digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % dim
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[index] += sign * weight
    return _unit(vector)


def _unit(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if not norm:
        return vector
    return [value / norm for value in vector]


def remote_embed(texts: list[str], model: str) -> list[list[float]]:
    """Call the DashScope OpenAI-compatible embedding endpoint."""
    import httpx

    from .providers import provider_base
    from .security import DomainError

    response = httpx.post(
        provider_base() + "/compatible-mode/v1/embeddings",
        headers={"Authorization": f"Bearer {settings.dashscope_api_key}"},
        json={"model": model, "input": texts, "encoding_format": "float"},
        timeout=20,
    )
    if response.status_code >= 400:
        raise DomainError(
            "RAG_EMBEDDING_FAILED",
            f"embedding 服务返回 HTTP {response.status_code}。",
            502,
        )
    try:
        rows = response.json()["data"]
        ordered = sorted(rows, key=lambda row: row.get("index", 0))
        vectors = [
            _unit([float(value) for value in row["embedding"]]) for row in ordered
        ]
    except (KeyError, TypeError, ValueError):
        raise DomainError("RAG_EMBEDDING_INVALID", "embedding 返回格式无法解析。", 502)
    if len(vectors) != len(texts) or any(not vector for vector in vectors):
        raise DomainError("RAG_EMBEDDING_INVALID", "embedding 返回数量不匹配。", 502)
    return vectors


def _embed(
    texts: list[str], embedder: Embedder
) -> tuple[list[list[float]], Embedder, str]:
    """Embed with the configured provider, falling back to the local encoder."""
    if not texts:
        return [], embedder, ""
    if embedder.provider == "dashscope":
        try:
            vectors = remote_embed(texts, embedder.model)
            dim = len(vectors[0])
            return vectors, Embedder("dashscope", embedder.model, dim), ""
        except Exception as exc:  # noqa: BLE001 — provider failures must fall back
            note = f"远程 embedding 不可用，已回落本地编码：{getattr(exc, 'message', str(exc))}"
            local = Embedder("local", LOCAL_MODEL, settings.rag_embedding_dim)
            return [local_embed(text, local.dim) for text in texts], local, note
    return [local_embed(text, embedder.dim) for text in texts], embedder, ""


def _embed_input(chunk: Chunk) -> str:
    return f"{chunk.title}。{' '.join(chunk.keywords)}。{chunk.text}"


_MEMORY: dict = {
    "requested": "",
    "documents": [],
    "embedder": Embedder("local", LOCAL_MODEL, DEFAULT_LOCAL_DIM),
    "note": "",
}


def _memory_documents() -> list[dict]:
    chunks = build_corpus()
    embedder = _configured_embedder()
    requested = corpus_signature(chunks, embedder)
    if _MEMORY["requested"] != requested:
        vectors, actual, note = _embed(
            [_embed_input(chunk) for chunk in chunks], embedder
        )
        _MEMORY.update(
            requested=requested,
            documents=[
                _document(chunk, vector, actual)
                for chunk, vector in zip(chunks, vectors)
            ],
            embedder=actual,
            note=note,
        )
    return _MEMORY["documents"]


def _document(chunk: Chunk, vector: list[float], embedder: Embedder) -> dict:
    return {
        "sourceId": chunk.source_id,
        "docId": chunk.doc_id,
        "title": chunk.title,
        "category": chunk.category,
        "source": chunk.source,
        "text": chunk.text,
        "keywords": chunk.keywords,
        "metadata": chunk.metadata,
        "embedding": vector,
        "provider": embedder.provider,
        "model": embedder.model,
    }


def _document_from_row(row: RagChunk) -> dict:
    return {
        "sourceId": row.metadata_json.get("sourceId")
        or (
            row.doc_id.split(":", 1)[1]
            if row.doc_id.startswith("assistant:")
            else row.doc_id
        ),
        "docId": row.doc_id,
        "title": row.title,
        "category": row.category,
        "source": row.source,
        "text": row.text,
        "keywords": list(row.keywords_json or []),
        "metadata": dict(row.metadata_json or {}),
        "embedding": list(row.embedding_json or []),
        "provider": row.embedding_provider,
        "model": row.embedding_model,
    }


def ensure_index(db, force: bool = False) -> dict:
    """Incrementally upsert the corpus into ``rag_chunks``."""
    chunks = build_corpus()
    requested = _configured_embedder()
    signature = corpus_signature(chunks, requested)
    existing = {
        (row.doc_id, row.chunk_index): row for row in db.scalars(select(RagChunk))
    }
    stored_signature = (
        next(iter(existing.values())).metadata_json.get("corpusSignature")
        if existing
        else None
    )
    if not force and stored_signature == signature and len(existing) == len(chunks):
        return _stats(chunks, existing, requested, "", False)

    vectors, actual, note = _embed([_embed_input(chunk) for chunk in chunks], requested)
    if actual != requested:
        signature = corpus_signature(chunks, actual)

    added = updated = removed = 0
    seen: set[tuple[str, int]] = set()
    for chunk, vector in zip(chunks, vectors):
        key = (chunk.doc_id, chunk.chunk_index)
        seen.add(key)
        digest = _hash(chunk.text)
        row = existing.get(key)
        if row is None:
            row = RagChunk(doc_id=chunk.doc_id, chunk_index=chunk.chunk_index)
            db.add(row)
            added += 1
        elif (
            row.content_hash == digest
            and row.embedding_provider == actual.provider
            and row.embedding_dim == actual.dim
        ):
            row.metadata_json = {
                **chunk.metadata,
                "corpusSignature": signature,
                "sourceId": chunk.source_id,
            }
            continue
        else:
            updated += 1
        row.title = chunk.title
        row.category = chunk.category
        row.source = chunk.source
        row.text = chunk.text
        row.keywords_json = list(chunk.keywords)
        row.metadata_json = {
            **chunk.metadata,
            "corpusSignature": signature,
            "sourceId": chunk.source_id,
        }
        row.content_hash = digest
        row.embedding_provider = actual.provider
        row.embedding_model = actual.model
        row.embedding_dim = actual.dim
        row.embedding_json = vector
        row.updated_at = now()

    for key, row in existing.items():
        if key not in seen:
            db.delete(row)
            removed += 1
    db.flush()
    return {
        "chunks": len(chunks),
        "indexed": len(seen),
        "provider": actual.provider,
        "model": actual.model,
        "dim": actual.dim,
        "forced": force,
        "note": note,
        "added": added,
        "updated": updated,
        "removed": removed,
    }


def _stats(chunks, existing, embedder, note, forced) -> dict:
    return {
        "chunks": len(chunks),
        "indexed": len(existing),
        "provider": embedder.provider,
        "model": embedder.model,
        "dim": embedder.dim,
        "forced": forced,
        "note": note,
        "added": 0,
        "updated": 0,
        "removed": 0,
    }


def status(db) -> dict:
    rows = []
    try:
        rows = list(db.scalars(select(RagChunk)))
    except SQLAlchemyError:
        rows = []
    corpus = build_corpus()
    provider = rows[0].embedding_provider if rows else _configured_embedder().provider
    model = rows[0].embedding_model if rows else _configured_embedder().model
    return {
        "enabled": settings.rag_enabled,
        "chunks": len(corpus),
        "indexed": len(rows),
        "provider": provider,
        "model": model,
        "dim": rows[0].embedding_dim if rows else 0,
        "autoIndex": settings.rag_auto_index,
        "lastIndexedAt": max((row.updated_at for row in rows), default=""),
        "namespaces": sorted({row.category for row in rows}),
    }


def _bm25(query_tokens: list[str], doc_tokens: list[list[str]]) -> list[float]:
    if not query_tokens or not doc_tokens:
        return [0.0] * len(doc_tokens)
    total = len(doc_tokens)
    average = sum(len(item) for item in doc_tokens) / total or 1.0
    scores = [0.0] * total
    for token in set(query_tokens):
        df = sum(1 for item in doc_tokens if token in item)
        if not df:
            continue
        idf = math.log(1 + (total - df + 0.5) / (df + 0.5))
        for index, item in enumerate(doc_tokens):
            frequency = item.count(token)
            if not frequency:
                continue
            denominator = frequency + 1.2 * (1 - 0.75 + 0.75 * len(item) / average)
            scores[index] += idf * frequency * 2.2 / denominator
    return scores


def _cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def _query_vector(query: str, document: dict) -> list[float] | None:
    provider = document.get("provider") or "local"
    dim = len(document.get("embedding") or [])
    if not dim:
        return None
    if provider == "local":
        return local_embed(query, dim)
    try:
        return remote_embed(
            [query], document.get("model") or settings.rag_embedding_model
        )[0]
    except Exception:  # noqa: BLE001 — query embedding degrades to lexical
        return None


def _indexed_documents(db) -> tuple[list[dict], str]:
    if db is None:
        return _memory_documents(), _MEMORY["note"]
    try:
        rows = list(db.scalars(select(RagChunk)))
        if not rows and settings.rag_auto_index:
            ensure_index(db)
            rows = list(db.scalars(select(RagChunk)))
        if rows:
            return [_document_from_row(row) for row in rows], ""
    except SQLAlchemyError:
        pass
    documents = _memory_documents()
    return documents, _MEMORY["note"]


def search(db, query: str, limit: int | None = None) -> Retrieval:
    """Hybrid BM25 + vector retrieval with title/keyword boosts."""
    query = (query or "").strip()
    limit = max(1, min(10, limit or settings.rag_top_k))
    if not settings.rag_enabled or not query:
        return Retrieval([], "disabled", "local", 0)
    documents, note = _indexed_documents(db)
    if not documents:
        return Retrieval([], "empty", "local", 0, note)

    query_tokens = tokens(query)
    doc_tokens = [
        tokens(
            f"{document['title']} {' '.join(document['keywords'])} {document['text']}"
        )
        for document in documents
    ]
    lexical = _bm25(query_tokens, doc_tokens)
    top_lexical = max(lexical, default=0.0) or 1.0

    query_vector = _query_vector(query, documents[0])
    weight = max(0.0, min(1.0, settings.rag_vector_weight))
    title_tokens = set(query_tokens)

    scored = []
    for index, document in enumerate(documents):
        vector_score = (
            max(0.0, _cosine(query_vector, document["embedding"]))
            if query_vector
            else 0.0
        )
        lexical_score = lexical[index] / top_lexical
        if vector_score < 0.35 and lexical[index] <= 0:
            continue
        boost = 0.0
        if title_tokens & set(tokens(document["title"])):
            boost += 0.05
        if title_tokens & set(tokens(" ".join(document["keywords"]))):
            boost += 0.03
        score = min(1.0, weight * vector_score + (1 - weight) * lexical_score + boost)
        if score < settings.rag_min_score:
            continue
        scored.append((score, vector_score, lexical_score, document))

    scored.sort(key=lambda item: (-item[0], item[3]["docId"]))
    items: list[dict] = []
    seen: set[str] = set()
    for score, vector_score, lexical_score, document in scored:
        if document["docId"] in seen:
            continue
        seen.add(document["docId"])
        items.append(
            {
                "id": document["sourceId"],
                "title": document["title"],
                "category": document["category"],
                "source": document["source"],
                "text": document["text"],
                "score": round(score, 4),
                "vectorScore": round(vector_score, 4),
                "lexicalScore": round(lexical_score, 4),
                "docId": document["docId"],
            }
        )
        if len(items) >= limit:
            break
    mode = "hybrid" if query_vector else "lexical"
    return Retrieval(
        items, mode, documents[0].get("provider", "local"), len(documents), note
    )


def retrieve(db, query: str, limit: int | None = None) -> list[dict]:
    return search(db, query, limit).items
