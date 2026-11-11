# 小筑 RAG 落地说明

本文记录「筑见 JianSpace」接入 RAG 的选型、实现与验证方式。当前落地的是**小筑家装助手知识检索**这一条端到端链路；其余候选保留为后续扩展。

## 1. 落点评估

| 优先级 | 候选 | 现有实现 | 检索对象 | 预期收益 | 改动面 |
| --- | --- | --- | --- | --- | --- |
| P0 | 小筑助手问答 | `apps/api/interior/assistant.py`，9 条关键词知识 + `_system_prompt` 注入 + `sources` 引用；`docs/ASSISTANT.md` 已把「可维护文档 + 向量检索」列为后续方向 | 助手知识、避坑规则、12 种风格、48 款家具、材料/预算口径 | 改写问法也能召回；引用出处统一；知识库可持续扩充 | 小：新增检索模块、1 张表、1 个迁移、助手注入点与 3 个 API |
| P1 | 装修避坑审查 | `apps/api/interior/review.py`，18 条规则 + 整份文档截断后交给模型 | 合同/报价/设计说明条款与规则库 | 长文档按规则召回证据，减少截断漏检 | 中：需按请求切分与嵌入，成本、延迟更高 |
| P2 | 材料与风格知识 | `catalog.py` / `review.py` 的结构化常量 | 12 风格、48 家具、材料三档 | 结构清晰、数量小，关键词检索已基本够用 | 小，但增量价值有限 |
| P3 | 效果图提示词/风格模板 | `catalog.py` 的 `prompt_keywords` | 12 条风格模板 | 可辅助提示词补全 | 小，收益低 |

首选 P0 的原因：已有明确注入点与引用结构，改动不触及生成/审核主流程；语料来自现有规则，避免维护第二份内容；离线可测。

## 2. 设计与实现

### 2.1 语料与切分

实现：`apps/api/interior/rag.py`

- `build_corpus()` 从既有常量生成文档，不新增内容副本：
  - `assistant.KNOWLEDGE` → `assistant:<id>`
  - `review.KNOWLEDGE_BASE` → `review:<title hash>`
  - `catalog.STYLES` → `style:<id>`
  - `catalog.CATALOG` → `furniture:<sku>`
  - `review.BUDGET_TIERS` → `budget:<tier>`
  - `review._MATERIAL_TIER_POOL` → `material:<surface>`
- 每个片段带 `doc_id`、`chunk_index`、`title`、`category`、`source`、`keywords`、`metadata`。
- `split_text()` 按句子边界切分，单段上限 320 字、重叠 40 字；结构化知识条目通常一段即一块。
- 引用 id：助手条目保留原 id（如 `waterproof`），其余使用命名空间 id（如 `style:modern`、`furniture:sofa-small`）。

### 2.2 Embedding 与存储

- 默认 `RAG_EMBEDDING_PROVIDER=local`：字符 bigram/中文 unigram/英文词的签名哈希向量（384 维，L2 归一化）。零新依赖、无网络、SQLite/PostgreSQL 均可运行。
- 可选 `dashscope`：通过 OpenAI 兼容 `/compatible-mode/v1/embeddings` 调用 `RAG_EMBEDDING_MODEL`。任何失败自动回落本地编码，并在返回的 `note` 中说明。
- 存储表 `rag_chunks`（迁移 `f7b8c9d0e1a2`）：
  - 文本、关键词、元数据、`content_hash`
  - `embedding_provider` / `embedding_model` / `embedding_dim` / `embedding_json`
  - 唯一约束 `(doc_id, chunk_index)`
- 当前检索在应用层计算余弦，适合几十到几百块的语料。PostgreSQL 可平滑升级为 pgvector：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE rag_chunks ADD COLUMN embedding vector(384);
CREATE INDEX rag_chunks_embedding_idx ON rag_chunks
  USING hnsw (embedding vector_cosine_ops);
```

对应只需在 `_indexed_documents()` / `search()` 边界替换为向量 SQL，`ensure_index()` 与上层调用不变；无扩展环境继续走现有 JSON + Python 余弦。

### 2.3 混合检索

`search(db, query, limit)`：

1. BM25：查询词（ASCII 词 + 中文 bigram）对标题、关键词、正文打分。
2. 向量余弦：与索引中同一 provider/model 的向量比较；查询向量失败则退化为纯词法。
3. 融合：`score = 0.55 * 向量 + 0.45 * 词法`（`RAG_VECTOR_WEIGHT` 可调），标题命中 +0.05、关键词命中 +0.03。
4. 过滤：既无词法命中且向量 <0.35 的片段直接丢弃，再按 `RAG_MIN_SCORE` 截断。
5. 按 `doc_id` 去重，返回 `score` / `vectorScore` / `lexicalScore`，便于评测与调试。

当前重排是规则加权；语料继续增长后可在此处接入 cross-encoder 或 LLM 重排，接口不变。

### 2.4 索引入库与更新

- `ensure_index(db)` 先按 `corpus_signature`（文档 id + 文本 hash + provider/model/dim）判断是否需要重建。
- 需要时逐块比较 `content_hash` 与 embedding 指纹，只 upsert 变化块并删除消失块，返回 `added/updated/removed`。
- 首次问答惰性建索引（`RAG_AUTO_INDEX=true`）；管理员可用 `POST /api/assistant/knowledge/reindex` 强制增量重建。
- 无数据库场景（单元测试、脚本）使用进程内缓存索引，不写库、不联网。

### 2.5 上下文注入与引用

调用链：

```text
POST /api/assistant/chat
  → routes/assistant.py: chat()
  → assistant.answer(text, brief, history, db)
  → assistant.ai_answer()
      → rag.retrieve(db, text, RAG_TOP_K)
      → _system_prompt(..., entries)
      → providers.chat_text(messages)
  → 返回 { message, sources, ... }
```

- 注入格式：`[id] 标题（来源：...）：正文`，系统提示要求结论后用 `[id]` 标注，且不得引用未提供条目。
- `sources` 仍是 `{id,title,source}`，前端引用展示无需改动。
- RAG 关闭、无命中、数据库异常或检索异常时，回退原有关键词 `search_knowledge()`；规则问答路径完全不变。

### 2.6 API

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/assistant/knowledge/status` | 登录 | 索引块数、provider/model/dim、最后更新时间、命名空间 |
| POST | `/api/assistant/knowledge/search` | 登录 | 混合检索，返回 `mode/provider/indexed/items`；离线可调 |
| POST | `/api/assistant/knowledge/reindex` | 管理员 | 强制增量重建，返回 `added/updated/removed` 并写审计 |

## 3. 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `RAG_ENABLED` | `true` | 总开关；关闭后只用关键词知识 |
| `RAG_TOP_K` | `4` | 注入上下文的最大块数（1–8） |
| `RAG_VECTOR_WEIGHT` | `0.55` | 向量分权重，其余为 BM25 |
| `RAG_MIN_SCORE` | `0.15` | 最低融合分 |
| `RAG_AUTO_INDEX` | `true` | 首次检索时惰性建索引 |
| `RAG_EMBEDDING_PROVIDER` | `local` | `local` 或 `dashscope` |
| `RAG_EMBEDDING_MODEL` | `text-embedding-v4` | `dashscope` 模式下的模型名 |
| `RAG_EMBEDDING_DIM` | `384` | 本地向量维度（64–1024） |
| `REVIEW_RAG_ENABLED` | `true` | 避坑审查条款检索开关 |
| `REVIEW_RAG_TIMEOUT_MS` | `1500` | 审查检索总超时；超时回落截断 |
| `REVIEW_RAG_MAX_CLAUSES` | `80` | 单次审查最多索引的条款块数 |
| `REVIEW_RAG_MAX_CLAUSE_CHARS` | `1200` | 单块上限；整段优先，超长按句切分 |
| `REVIEW_RAG_TOP_K` | `8` | 规则相关条款召回数（×2 参与组装） |
| `REVIEW_RAG_PROMPT_CHARS` | `12000` | 单文档上下文预算；重点条款可上浮至 1.5 倍 |
| `REVIEW_RAG_CACHE_SIZE` | `8` | 按文档 content_hash 复用的进程内缓存条数 |
| `REVIEW_RAG_EMBEDDING_PROVIDER` | `local` | 审查默认本地；可设 `dashscope` |

`dashscope` 模式复用现有 `DASHSCOPE_API_KEY` 与 `ALLOW_AI_CALLS`；无 Key 或调用失败自动回本地。

## 4. 验证

```bash
# 后端全量测试（当前 277 项通过）
python -m pytest apps/api/tests -q

# 前端测试与类型检查（当前 110 项通过）
cd apps/web && npm test && npm run typecheck

# 只跑助手 RAG / 审查 RAG 用例
python -m pytest apps/api/tests/test_rag.py -q
python -m pytest apps/api/tests/test_review_rag.py -q

# 迁移（SQLite/PostgreSQL 通用）
alembic -c alembic.ini upgrade head
```

新增用例覆盖：语料与切分元数据、本地向量确定性、远程 embedding 失败回落、索引幂等与增量更新、混合检索命中（防水/沙发/风格）、无数据库检索、API 鉴权与管理员重索引、AI 上下文注入与关键词兜底；审查侧覆盖长文档重点条款不丢失、证据字符偏移准确、超时降级、RAG 开关前后结论一致、LLM 上下文注入与定位、缓存复用、API 返回 `evidenceRef`；规则侧覆盖质保年限、增项书面确认、水电点位计价，以及付款比例/工期违约金/材料品牌的条件正反例；PDF 侧覆盖定位渲染、同段命中合并、跨页摘录完整、非法 ref 降级、无空行长文本分段、分段后偏移自洽、整句摘录、路由保留 `evidenceRef`。

离线手工验证：

```bash
curl -X POST http://127.0.0.1:8000/api/assistant/knowledge/search \
  -H "Content-Type: application/json" \
  -b cookies.txt -H "X-CSRF-Token: <token>" \
  -d '{"query":"卫生间防水做多高","limit":3}'
```

预期首条为 `waterproof`，响应含 `mode: hybrid`、`score` 与片段正文。

## 5. P1：避坑审查条款证据检索

实现：`apps/api/interior/review_rag.py`，接入 `review.analyze_documents`。

调用链：

```text
POST /api/review/analyze-text 或 /api/review/analyze
  → review.analyze_documents()
      → review_rag.prepare(documents)            # 超时 1500ms，失败返回空上下文
          → split_clauses()                      # 段落 + 句子切分，记录 start/end/paragraph
          → 本地/云端 embedding + content_hash 缓存
      → match_findings()                         # 原规则引擎，结论不变
      → review_rag.attach_evidence(rule/cross)   # 仅 evidence 为空时回填片段与 evidenceRef
      → review_rag.prompt_context(findings)      # 重点条款 + 规则相关条款，带定位
      → llm_critique(..., context=...)           # 有上下文用条款，无则回退 value[:8000]
      → review_rag.attach_locations(llm)         # 只补定位，不改 evidence 文本
  → report_to_dict(): 原字段 + ragUsed/ragNote/evidenceRef
```

- **切分与定位**：按空行分段（无空行的超长单段按条款标题与句末标点重建），按句切块，单块 ≤1200 字；每块记录 `start/end/paragraph`，`text[start:end]` 可回查原文。
- **重点条款**：金额、工期、付款节点、增项、验收、品牌型号、违约、质保八类命中即标记；组装上下文时优先完整放入，不受 8000 字截断。
- **证据回填**：规则条目只在 `evidence is None` 时填入命中片段，并写 `evidenceRef`；LLM 条目的 evidence 原样保留，仅根据片段反查定位。
- **规则条件**：合同类规则命中关键词后继续校验语义，无法判定时不报——质保按「基础 2 年 / 水电隐蔽 5 年」比较（支持月数与中文数字）；增项须缺少书面/签字/签证/审批才报；水电须同时出现「点位」与按点位计价；付款比例超过 60%、工期明确无赔付或低于 0.1%/天、材料品牌未写明具体品牌时才报。证据条款另做语义守卫，如水电依据必须落在点位计价条款，避免落到质保段。
- **摘录**：`_snippet` 从命中词所在句子的句首开始截取，避免出现「整），包含主材…」这类句中起点；`evidenceRef` 的 `start/end` 不受影响。
- **降级**：RAG 关闭、超时、embedding/检索异常均返回空上下文，`llm_critique` 自动走原 `value[:8000]`；`ragUsed=false`、`ragNote` 说明原因，审查结果照常返回。
- **结论不变**：`_dedupe`、排序、评分、金额预测均未改动；测试用 RAG 开关前后逐条比对核心字段。

实测（本地、29.7k 字、25 块）：首次索引约 21ms，缓存命中约 0.4ms；远程 embedding 为可选路径，默认不启用。

### 5.1 PDF 报告中的证据定位

`POST /api/review/report-pdf` 从报告 JSON 还原 `Finding.evidenceRef` 后渲染，只在「依据」处增强，标题、章节顺序、统计表与文件名均不变：

- **高亮**：摘录中的命中片段（规则关键词，以及金额/工期/付款等条款模式匹配到的原文）用 ReportLab `<font backColor="#FFF1A8">` 加底色；文本先做 XML 转义，避免 `&`、`<` 破坏段落标记。
- **定位**：摘录后追加一行 `定位：合同·段 35｜字符 12345-12490`，与 `evidenceRef` 的 `documentLabel` / `paragraph` / `start` / `end` 一一对应。
- **同段合并**：多条发现命中同一 `clauseId` 时，仅首条展示完整摘录与高亮，其余显示 `依据：同第 N 条（定位…）`，不重复刷屏。
- **跨页**：摘录作为单个 Paragraph 交给 ReportLab 自动分页，长证据完整保留，跨页两段都带底色。
- **降级**：`evidenceRef` 缺失、`start/end` 非整数或起止非法时，退回普通「依据：摘录」，不抛错；JSON 响应中的 `evidenceRef` 始终保留，供前端做原文对照。

限制：报告 PDF 是审查结论文档，不内嵌合同原页；上传 PDF 经 pypdf 提取文本后不再持有页码与坐标，要在原页做框选需要重排原文并保留版面，改动面过大。因此采用「报告内定位 + 摘录底色」的稳妥方案；原页跳转留给前端对照视图。

验证：

```bash
python -m pytest apps/api/tests/test_review_rag.py -q   # 16 项
```

覆盖偏移映射（`text[start:end]` 与摘录一致）、同段合并、跨页完整、缺失/非法 ref 不崩、`/review/report-pdf` 路由保留 `evidenceRef`。手工验证：调用审查接口拿到 JSON 后直接 POST 同一份结果到 `report-pdf`，打开 PDF 检查「定位」行与底色片段。

### 5.2 前端原文对照视图

审查页 `apps/web/src/components/RenovationReview.tsx` 在每条「依据」下增加「查看原文对照」，逻辑抽到 `apps/web/src/evidence.ts`：

- **取数**：分析接口新增返回 `evidenceContexts`（按 `clauseId` 去重），含 `document / paragraph / start / end / contextStart / contextEnd / text`，窗口为命中条款前后各一段（单侧最多 1200 字）。上传文件由后端解析、原文不落库，因此在分析阶段一次性随结果返回，前端无需二次上传。
- **本地兜底**：无上下文且文档来自粘贴文本时，用 `trim()` 后的文本切命中前后各 240 字；上传文件不使用本地文本，避免与分析时文本不一致。后端在分析入口统一把 `\r\n` 归一为 `\n`，避免浏览器表单提交的 CRLF 使 `evidenceRef` 偏移与前端留存的 LF 文本错位。
- **不可得**：两者都没有时显示「上传文件未保留原文，可粘贴文本后重新审查」，不出现空白。
- **交互**：展开显示 `合同 · 段 35`、`字符 x-y` 与原文，命中片段用 `<mark>` 底色高亮；同一 `clauseId` 仅首条渲染完整原文，其余显示「与第 N 条同一段 · 查看原文」，点击跳到首条并展开。`evidenceRef` 缺失或偏移非法时只保留摘录，不报错。
- **不改导出**：PDF 报告与 `/review/report-pdf` 逻辑未改动。

限制：上传文件原文不持久化，窗口只随本次分析结果返回；上线前生成的历史报告没有 `evidenceContexts`，粘贴文本仍可本地切，上传文件需重新审查。文档超过 60000 字时后端只保留前段，超出部分的定位自然缺失。PDF 提取文本没有空行时，仅当整段超过 500 字才按「第X条 / 一、 / （一）」、`付款方式：` 一类行首标题、句末标点与行长做启发式分段；只确定边界、不改动文本，因此 `start/end` 仍与原文严格一致。短文本或已有空行的文档保持原段落。分段后段落号更细，证据窗口与检索粒度同步收紧。

验证：

```bash
cd apps/web && npm test          # 110 项，含 src/evidence.test.ts 7 项
cd apps/web && npm run typecheck
```

浏览器手工点验：`artifacts/rag-evidence-ui/`（粘贴合同全路径、同段条目跳转、PDF 上传与无原文提示，结果见 `verify-result.json`；规则误报与 PDF 分段复验见 `verify-fixes.json`，30 项通过）。

`src/evidence.test.ts` 覆盖偏移换算、本地兜底、上传文件提示、非法 ref、窗口不覆盖时降级、同段去重与越界裁剪。后端 `test_crlf_documents_keep_lf_offsets` 覆盖表单 CRLF 提交与 LF 剪贴板文本的偏移一致性。

## 6. 成本与延迟

- 本地模式：助手索引约百级块、审查单次 20–50 块，向量与 BM25 均在毫秒级，无外部成本。
- 审查文档规模：4–8 页报价单约 3–5 块，20 页合同约 11–13 块，40 页合同约 21–25 块；单份文档一次批量 embedding（本地为 0 次网络调用）。
- 远程 embedding：仅在显式配置时启用；40 页合同约 0.01–0.02 元/次（按常见报价量级估算，以账单为准），但 P99 受网络影响，默认走本地。
- 生成侧上下文按 `REVIEW_RAG_PROMPT_CHARS` 与 `REVIEW_RAG_MAX_CLAUSES` 双重限制，超时 1500ms 兜底。

## 7. 后续扩展

1. **pgvector**：按 2.2 的 DDL 增加向量列与 HNSW 索引，替换应用层余弦；保留 JSON 列作为降级。
2. **重排**：在 `search()` 后接入 cross-encoder 或 LLM 重排，并补充离线金标集评估 recall@k / MRR。
3. **语料治理**：将 `build_corpus()` 的常量来源逐步迁到可维护文档目录，保留 `doc_id` 与 `source` 契约即可。
4. **审查扩展**：报告内已支持条款定位与摘录底色；后续可把 `evidenceRef` 接到前端原文对照视图，并在保留 PDF 页面坐标时实现原页高亮/跳转。
