"""Clause-level retrieval for contract / quote review.

The review engine has always fed the first 8000 characters of each document to
the model, which silently drops clauses on long contracts. This module builds an
ephemeral, per-request clause index with character offsets, retrieves the clauses
that matter for the matched rules, and guarantees that key clauses (amount,
schedule, payment nodes, change orders, acceptance, brand, penalty, warranty)
survive into the model context as complete units.

It reuses the assistant RAG primitives (tokenizer, local embedding, BM25/vector
fusion) but keeps its own cache and budgets: review traffic is per-document and
must not pollute the assistant knowledge index. Every failure returns an empty
context so the caller can fall back to the legacy truncation path.
"""

from __future__ import annotations

import hashlib
import re
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, field

from . import rag
from .config import settings

DOC_LABELS = {
    "contract": "合同",
    "quote": "报价单",
    "drawing": "设计说明",
}

# Clause families that must reach the model intact regardless of document size.
KEY_PATTERNS: dict[str, re.Pattern[str]] = {
    "金额": re.compile(r"(?:总价|总金额|合同价|合计|金额|单价)[^。\n]{0,40}?\d"),
    "工期": re.compile(r"(?:工期|开工|竣工|交付|完工|延误|逾期)"),
    "付款节点": re.compile(r"(?:付款|首付|预付|定金|订金|尾款|进度款|节点款)"),
    "增项条款": re.compile(r"(?:增项|变更|追加|签证|按实结算|实际发生量)"),
    "验收标准": re.compile(r"(?:验收|隐蔽工程|闭水|打压|检测|整改)"),
    "品牌型号": re.compile(r"(?:品牌|型号|规格|系列|产地|环保等级|E0|ENF)"),
    "违约赔付": re.compile(r"(?:违约|赔付|罚款|滞纳金|赔偿)"),
    "质保": re.compile(r"(?:质保|保修|售后|维保)"),
}

_PARAGRAPH = re.compile(r"[^\n]+(?:\n(?!\s*\n)[^\n]+)*")
_SENTENCE_END = re.compile(r"[。！？；;!?]\s*")

# PDF 提取文本常常没有空行，整份文档会被当成一个段落。仅对超长单段做
# 启发式重建：按条款起始词、句末标点和段落长度确定边界，只切分不改动文本。
_REBUILD_MIN_CHARS = 500
_TARGET_BLOCK_CHARS = 400
_MIN_FIRST_BLOCK_CHARS = 40
_CLAUSE_MARKER = re.compile(
    r"(?:第[一二三四五六七八九十百零〇\d]+[条章节部分款项]"
    r"|[一二三四五六七八九十]+[、.．]"
    r"|（[一二三四五六七八九十\d]+）"
    r"|\([一二三四五六七八九十\d]+\)"
    r"|\d+[、.．])"
)
# PDF 里常见「付款方式：」「工期约定：」这类独立成行的条款标题。
_CLAUSE_HEADING = re.compile(r"(?m)^[ \t]*[\u4e00-\u9fa5A-Za-z0-9（）()]{2,12}[：:]")


def _rebuild_spans(text: str, start: int, end: int) -> list[tuple[int, int]]:
    """把一个超长段落切成多个近似段落，边界均为原文字符位置。"""
    clause_starts: set[int] = set()
    bounds: set[int] = {start, end}
    for match in _CLAUSE_MARKER.finditer(text, start, end):
        before = text[match.start() - 1] if match.start() > start else ""
        if match.start() == start or before in "\n。；;！？":
            clause_starts.add(match.start())
            bounds.add(match.start())
    for match in _CLAUSE_HEADING.finditer(text, start, end):
        position = match.start()
        while position < end and text[position] in " \t":
            position += 1
        clause_starts.add(position)
        bounds.add(position)
    for match in _SENTENCE_END.finditer(text, start, end):
        bounds.add(match.end())

    spans: list[tuple[int, int]] = []
    block_start = start
    for position in sorted(bounds - {start}):
        length = len(text[block_start:position].strip())
        at_clause = position in clause_starts
        if position < end and length < (_MIN_FIRST_BLOCK_CHARS if at_clause else 1):
            continue
        if at_clause or position == end or length >= _TARGET_BLOCK_CHARS:
            if length:
                spans.append((block_start, position))
            block_start = position
    if block_start < end and text[block_start:end].strip():
        spans.append((block_start, end))
    return spans


def _block_spans(text: str) -> list[tuple[int, int]]:
    """段落边界；无空行的超长单段才启用启发式重建。"""
    spans = [(match.start(), match.end()) for match in _PARAGRAPH.finditer(text or "")]
    if len(spans) == 1 and spans[0][1] - spans[0][0] > _REBUILD_MIN_CHARS:
        rebuilt = _rebuild_spans(text, spans[0][0], spans[0][1])
        if len(rebuilt) > 1:
            return rebuilt
    return spans


@dataclass
class Clause:
    id: str
    doc_key: str
    doc_label: str
    paragraph: int
    index: int
    text: str
    start: int
    end: int
    keys: tuple[str, ...] = ()

    @property
    def is_key(self) -> bool:
        return bool(self.keys)

    @property
    def label(self) -> str:
        return f"{self.doc_label}·段 {self.paragraph}｜字符 {self.start}-{self.end}"


@dataclass
class ClauseIndex:
    doc_key: str
    clauses: list[Clause]
    vectors: list[list[float]]
    provider: str
    model: str
    dim: int


@dataclass
class ReviewContext:
    indexes: dict[str, ClauseIndex] = field(default_factory=dict)
    note: str = ""

    @property
    def clauses(self) -> list[Clause]:
        items = [clause for index in self.indexes.values() for clause in index.clauses]
        return sorted(items, key=lambda clause: (clause.doc_key, clause.start))

    @property
    def used(self) -> bool:
        return bool(self.indexes)

    def search(self, query: str, top_k: int = 1) -> list[Clause]:
        if not query.strip() or not self.indexes:
            return []
        entries: list[tuple[Clause, list[float]]] = [
            (clause, index.vectors[position])
            for index in self.indexes.values()
            for position, clause in enumerate(index.clauses)
        ]
        query_tokens = rag.tokens(query)
        doc_tokens = [rag.tokens(clause.text) for clause, _ in entries]
        lexical = rag._bm25(query_tokens, doc_tokens)
        top_lexical = max(lexical, default=0.0) or 1.0

        query_vectors: dict[tuple[str, str, int], list[float] | None] = {}
        for index in self.indexes.values():
            key = (index.provider, index.model, index.dim)
            if key not in query_vectors:
                query_vectors[key] = _query_vector(query, index)

        vectors = {
            index.doc_key: query_vectors[(index.provider, index.model, index.dim)]
            for index in self.indexes.values()
        }
        scored = []
        weight = max(0.0, min(1.0, settings.rag_vector_weight))
        for position, (clause, vector_embedding) in enumerate(entries):
            vector = vectors.get(clause.doc_key)
            vector_score = (
                max(0.0, _cosine(vector, vector_embedding)) if vector else 0.0
            )
            lexical_score = lexical[position] / top_lexical
            score = (
                weight * vector_score
                + (1 - weight) * lexical_score
                + (0.08 if clause.is_key else 0.0)
            )
            scored.append((score, clause))
        scored.sort(key=lambda item: (-item[0], item[1].id))
        return [clause for _, clause in scored[: max(1, top_k)]]


def _cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def _query_vector(query: str, index: ClauseIndex) -> list[float] | None:
    if index.provider == "local":
        return rag.local_embed(query, index.dim)
    try:
        return rag.remote_embed([query], index.model)[0]
    except Exception:  # noqa: BLE001 — degrade to lexical scoring
        return None


def clause_keys(text: str) -> tuple[str, ...]:
    return tuple(
        label for label, pattern in KEY_PATTERNS.items() if pattern.search(text)
    )


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _emit(
    text: str,
    start: int,
    end: int,
    doc_key: str,
    doc_label: str,
    paragraph: int,
    counter: list[int],
    clauses: list[Clause],
) -> None:
    raw = text[start:end]
    left = len(raw) - len(raw.lstrip())
    right = len(raw) - len(raw.rstrip())
    cleaned = _clean(raw)
    if not cleaned:
        return
    absolute_start = start + left
    absolute_end = end - right
    clauses.append(
        Clause(
            id=f"{doc_key}#{counter[0]}",
            doc_key=doc_key,
            doc_label=doc_label,
            paragraph=paragraph,
            index=counter[0],
            text=cleaned,
            start=absolute_start,
            end=absolute_end,
            keys=clause_keys(cleaned),
        )
    )
    counter[0] += 1


def _split_block(
    text: str,
    block_start: int,
    block_end: int,
    doc_key: str,
    doc_label: str,
    paragraph: int,
    max_chars: int,
    counter: list[int],
    clauses: list[Clause],
) -> None:
    block = text[block_start:block_end]
    if len(block) <= max_chars:
        _emit(
            text,
            block_start,
            block_end,
            doc_key,
            doc_label,
            paragraph,
            counter,
            clauses,
        )
        return

    boundaries = [0]
    boundaries.extend(match.end() for match in _SENTENCE_END.finditer(block))
    if boundaries[-1] != len(block):
        boundaries.append(len(block))
    spans = [
        (boundaries[i], boundaries[i + 1])
        for i in range(len(boundaries) - 1)
        if boundaries[i + 1] > boundaries[i]
    ]

    cursor: int | None = None
    for sentence_start, sentence_end in spans:
        if sentence_end - sentence_start > max_chars:
            if cursor is not None:
                _emit(
                    text,
                    block_start + cursor,
                    block_start + sentence_start,
                    doc_key,
                    doc_label,
                    paragraph,
                    counter,
                    clauses,
                )
                cursor = None
            position = sentence_start
            while position < sentence_end:
                stop = min(sentence_end, position + max_chars)
                _emit(
                    text,
                    block_start + position,
                    block_start + stop,
                    doc_key,
                    doc_label,
                    paragraph,
                    counter,
                    clauses,
                )
                position = stop
            continue
        if cursor is None:
            cursor = sentence_start
        if sentence_end - cursor > max_chars:
            _emit(
                text,
                block_start + cursor,
                block_start + sentence_start,
                doc_key,
                doc_label,
                paragraph,
                counter,
                clauses,
            )
            cursor = sentence_start
    if cursor is not None:
        _emit(
            text,
            block_start + cursor,
            block_end,
            doc_key,
            doc_label,
            paragraph,
            counter,
            clauses,
        )


def split_clauses(
    doc_key: str, text: str, max_chars: int | None = None
) -> list[Clause]:
    """Split a document into location-aware clauses, preserving full paragraphs."""
    max_chars = max_chars or settings.review_rag_max_clause_chars
    doc_label = DOC_LABELS.get(doc_key, doc_key)
    clauses: list[Clause] = []
    counter = [0]
    for paragraph, (block_start, block_end) in enumerate(_block_spans(text), start=1):
        _split_block(
            text,
            block_start,
            block_end,
            doc_key,
            doc_label,
            paragraph,
            max_chars,
            counter,
            clauses,
        )
    return clauses


_CACHE: OrderedDict[tuple, ClauseIndex] = OrderedDict()
_CACHE_LOCK = threading.Lock()


def clear_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


def cached_documents() -> int:
    with _CACHE_LOCK:
        return len(_CACHE)


def _provider() -> tuple[str, str]:
    configured = (settings.review_rag_embedding_provider or "local").strip().lower()
    if configured == "dashscope" and settings.ai_ready and settings.rag_embedding_model:
        return "dashscope", settings.rag_embedding_model
    return "local", rag.LOCAL_MODEL


def _embed(
    texts: list[str], provider: str, model: str
) -> tuple[list[list[float]], str, str, int, str]:
    if provider == "dashscope":
        try:
            vectors = rag.remote_embed(texts, model)
            return vectors, "dashscope", model, len(vectors[0]), ""
        except Exception as exc:  # noqa: BLE001 — fall back to local encoding
            note = f"云端 embedding 不可用，已回落本地：{getattr(exc, 'message', str(exc))}"
            provider, model = "local", rag.LOCAL_MODEL
        else:
            note = ""
    else:
        note = ""
    vectors = [rag.local_embed(text, settings.rag_embedding_dim) for text in texts]
    return vectors, provider, model, settings.rag_embedding_dim, note


def _index_document(
    doc_key: str, text: str, max_chars: int, max_clauses: int
) -> tuple[ClauseIndex, str]:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    provider, model = _provider()
    cache_key = (
        doc_key,
        digest,
        provider,
        model,
        max_chars,
        max_clauses,
        settings.rag_embedding_dim,
    )
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached is not None:
            _CACHE.move_to_end(cache_key)
            return cached, ""

    clauses = split_clauses(doc_key, text, max_chars)
    if len(clauses) > max_clauses:
        keyed = [clause for clause in clauses if clause.is_key]
        rest = [clause for clause in clauses if not clause.is_key]
        clauses = sorted((keyed + rest)[:max_clauses], key=lambda clause: clause.start)

    vectors, provider, model, dim, note = _embed(
        [clause.text for clause in clauses], provider, model
    )
    index = ClauseIndex(
        doc_key=doc_key,
        clauses=clauses,
        vectors=vectors,
        provider=provider,
        model=model,
        dim=dim,
    )
    with _CACHE_LOCK:
        _CACHE[cache_key] = index
        while len(_CACHE) > settings.review_rag_cache_size:
            _CACHE.popitem(last=False)
    return index, note


def _build(documents: dict[str, str]) -> ReviewContext:
    indexes: dict[str, ClauseIndex] = {}
    notes: list[str] = []
    for doc_key, text in documents.items():
        if not (text or "").strip():
            continue
        index, note = _index_document(
            doc_key,
            text,
            settings.review_rag_max_clause_chars,
            settings.review_rag_max_clauses,
        )
        if index.clauses:
            indexes[doc_key] = index
        if note:
            notes.append(note)
    total = sum(len(index.clauses) for index in indexes.values())
    provider = next((index.provider for index in indexes.values()), "local")
    detail = f"已索引 {total} 块（{provider}）"
    if notes:
        detail = "；".join([*notes, detail])
    return ReviewContext(indexes=indexes, note=detail)


def prepare(documents: dict[str, str], timeout_ms: int | None = None) -> ReviewContext:
    """Build the clause index with a hard timeout, never raising to the caller."""
    timeout_ms = timeout_ms or settings.review_rag_timeout_ms
    if not settings.review_rag_enabled:
        return ReviewContext(note="审查检索未启用")
    if not any((text or "").strip() for text in documents.values()):
        return ReviewContext(note="无可检索文档")
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(_build, documents)
    try:
        return future.result(timeout=timeout_ms / 1000)
    except FutureTimeout:
        return ReviewContext(note="审查检索超时，已回落原截断逻辑")
    except Exception as exc:  # noqa: BLE001 — review must still return
        return ReviewContext(note=f"审查检索不可用，已回落原截断逻辑：{exc}")
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


_SENTENCE_BOUNDARY = re.compile(r"[。！？；;!?]")


def _snippet(text: str, terms: list[str], limit: int = 120) -> str:
    """按整句摘录：起点对齐到命中所在句子的句首，避免从句中截断。"""
    cleaned = _clean(text)
    lowered = cleaned.lower()
    for term in terms:
        if not term:
            continue
        position = lowered.find(term.lower())
        if position < 0:
            continue
        start = 0
        for match in _SENTENCE_BOUNDARY.finditer(cleaned, 0, position):
            start = match.end()
        while start < position and cleaned[start].isspace():
            start += 1
        end_match = _SENTENCE_BOUNDARY.search(cleaned, position)
        end = end_match.end() if end_match else len(cleaned)
        snippet = cleaned[start:end]
        return snippet[:limit] if len(snippet) > limit else snippet
    first = _SENTENCE_BOUNDARY.search(cleaned)
    end = first.end() if first else len(cleaned)
    return cleaned[: min(end, limit)]


def ref(clause: Clause) -> dict:
    return {
        "document": clause.doc_key,
        "documentLabel": clause.doc_label,
        "clauseId": clause.id,
        "paragraph": clause.paragraph,
        "start": clause.start,
        "end": clause.end,
        "keys": list(clause.keys),
    }


_CONTEXT_PAD_CHARS = 1200


def _paragraph_bounds(text: str) -> list[tuple[int, int]]:
    return _block_spans(text)


def context_windows(
    documents: dict[str, str], context: ReviewContext, findings: list
) -> dict[str, dict]:
    """为每条带定位的发现生成「前后各一段」的原文窗口，供前端对照。

    报告 PDF 不内嵌原页，前端也拿不到上传文件的解析文本，因此在分析阶段
    一次性把窗口算好随结果返回；同一 clauseId 只保留一份。
    """
    windows: dict[str, dict] = {}
    bounds: dict[str, list[tuple[int, int]]] = {}
    for finding in findings:
        value = finding.evidence_ref
        if not isinstance(value, dict):
            continue
        clause_id = str(value.get("clauseId") or "")
        doc_key = str(value.get("document") or "")
        if not clause_id or not doc_key or clause_id in windows:
            continue
        index = context.indexes.get(doc_key)
        text = documents.get(doc_key) or ""
        if index is None or not text:
            continue
        clause = next((item for item in index.clauses if item.id == clause_id), None)
        if clause is None:
            continue
        if doc_key not in bounds:
            bounds[doc_key] = _paragraph_bounds(text)
        paragraphs = bounds[doc_key]
        paragraph = clause.paragraph
        start = paragraphs[paragraph - 2][0] if paragraph >= 2 else 0
        end = paragraphs[paragraph][1] if paragraph < len(paragraphs) else len(text)
        start = max(start, clause.start - _CONTEXT_PAD_CHARS)
        end = min(end, clause.end + _CONTEXT_PAD_CHARS)
        start = max(0, min(start, clause.start))
        end = min(len(text), max(end, clause.end))
        windows[clause_id] = {
            "document": doc_key,
            "documentLabel": DOC_LABELS.get(doc_key, doc_key),
            "paragraph": paragraph,
            "start": clause.start,
            "end": clause.end,
            "contextStart": start,
            "contextEnd": end,
            "text": text[start:end],
            "keys": list(clause.keys),
        }
    return windows


def _entry_terms(title: str) -> list[str]:
    from . import review

    for entry in review.KNOWLEDGE_BASE:
        if entry["title"] == title:
            return [
                str(entry["title"]),
                *[str(word) for word in entry.get("keywords") or []],
            ]
    return [title]


def terms_for(finding) -> list[str]:
    """规则条目的标题与关键词，供证据定位与报告高亮复用。"""
    return _entry_terms(finding.title)


# 证据条款必须与规则结论语义对应，避免只靠关键词把「隐蔽工程质保」当成
# 「水电按点位结算」的依据。
_EVIDENCE_PICKERS = {
    "水电按点位数结算风险": lambda text: bool(
        re.search(r"水电|隐蔽", text)
        and re.search(
            r"按点位[^。；\n]{0,4}(?:结算|计价|计费|收费|报价)"
            r"|点位[^。；\n]{0,4}(?:单价|计价|结算|收费)"
            r"|点位[^。；\n]{0,6}\d+\s*元"
            r"|(?:每个|每|单)点位[^。；\n]{0,8}(?:元|收费|计价)"
            r"|(?:结算|计价|计费|收费)[^。；\n]{0,3}按点位",
            text,
        )
    ),
    "质保期短于行业标准": lambda text: bool(
        re.search(r"质保|保修|售后|维保", text)
        and re.search(
            r"(?:\d+(?:\.\d+)?|[零一二两三四五六七八九十]+)\s*(?:年|个月)", text
        )
    ),
    "增项审批流程缺失": lambda text: bool(
        re.search(r"增项|变更|追加", text)
        and not re.search(r"书面|签字|签认|签证|审批|甲方确认|业主确认|确认后", text)
    ),
    "付款比例前置过高": lambda text: bool(
        re.search(r"首付|首期|定金|订金|预付|签约|开工前", text)
        and re.search(r"\d+(?:\.\d+)?\s*%", text)
    ),
    "工期违约金缺失": lambda text: bool(
        re.search(r"工期|延误|逾期", text)
        and (
            re.search(r"无赔付|不赔付|无违约金|不承担|免赔", text)
            or re.search(r"违约金|赔付|赔偿|罚款|滞纳金", text)
        )
    ),
    "材料品牌未标注": lambda text: bool(
        re.search(r"品牌|型号|乳胶漆|地板|瓷砖|木门|橱柜|洁具", text)
    ),
}


def attach_evidence(findings: list, context: ReviewContext) -> None:
    """Fill empty rule evidence with a located clause; never touch other fields."""
    if not context.used:
        return
    for finding in findings:
        if finding.evidence:
            continue
        terms = _entry_terms(finding.title)
        picker = _EVIDENCE_PICKERS.get(finding.title)
        hits = context.search(" ".join(terms), top_k=5 if picker else 1)
        clause = (
            next((item for item in hits if picker(item.text)), None)
            if picker
            else (hits[0] if hits else None)
        )
        if clause is None:
            continue
        finding.evidence = _snippet(clause.text, terms)
        finding.evidence_ref = ref(clause)


def attach_locations(findings: list, context: ReviewContext) -> None:
    """Attach locations to model evidence without rewriting the evidence text."""
    if not context.used:
        return
    for finding in findings:
        evidence = (finding.evidence or "").strip()
        if not evidence or finding.evidence_ref:
            continue
        probe = _clean(evidence)[:40]
        if len(probe) < 6:
            continue
        for clause in context.clauses:
            if probe in clause.text:
                finding.evidence_ref = ref(clause)
                break


def prompt_context(
    findings: list,
    context: ReviewContext,
) -> str:
    """Assemble complete key clauses plus rule-relevant clauses per document."""
    if not context.used:
        return ""
    query = " ".join(
        [finding.title for finding in findings]
        + [term for finding in findings for term in _entry_terms(finding.title)]
    )
    blocks: list[str] = []
    for index in context.indexes.values():
        by_id = {clause.id: clause for clause in index.clauses}
        keyed = [clause for clause in index.clauses if clause.is_key]
        retrieved = context.search(query, top_k=settings.review_rag_top_k * 2)
        ordered: list[Clause] = []
        seen: set[str] = set()
        for clause in keyed + [
            item for item in retrieved if item.doc_key == index.doc_key
        ]:
            if clause.id not in by_id or clause.id in seen:
                continue
            seen.add(clause.id)
            ordered.append(clause)
        for clause in index.clauses:
            if clause.id not in seen:
                ordered.append(clause)
                seen.add(clause.id)

        budget = settings.review_rag_prompt_chars
        key_budget = int(budget * 1.5)
        lines: list[str] = []
        used = 0
        for clause in ordered:
            line = f"[{clause.label}] {clause.text}"
            if clause.is_key:
                if used + len(line) > key_budget:
                    continue
            elif used + len(line) > budget:
                continue
            lines.append(line)
            used += len(line)
        if not lines:
            continue
        doc_label = index.clauses[0].doc_label
        blocks.append(
            f"=== {doc_label}（{len(index.clauses)} 段，原文按字符偏移定位）===\n"
            + "\n".join(lines)
        )
    return "\n\n".join(blocks)
