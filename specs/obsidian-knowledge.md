# Obsidian Knowledge / VaultView 2.0 Spec

来源：交接包 `docs/vaultview-agent-handoff/05_REFERENCE/PROPOSED_REPO_SPEC_obsidian-knowledge.md`
（用户明确批准的目标方案）+ `01_RULES_AND_DECISIONS/ADR_AND_NONNEGOTIABLES.md`。按 AGENTS.md
「先 spec 后代码」落地本文件后，各阶段工作单（W01–W07）在自己的范围内实现并回填验收证据。

**实现状态标记**：本文各节标注【已实现】/【未实现，属 Wxx】。标注"未实现"的条款是目标
契约而非现状描述——在对应工作单落地前，不得在代码、UI 或文档中宣称其已生效。

## 0. 范围与产品边界

- 一个活动 Vault 的精确文章找回（FIND_ARTICLE）、问库/比较（ANSWER/COMPARE）、来源验证与
原文回跳；Jev 可选决策与离线评测框架【已实现，W05】（§5d；真实联调/真实标注集对比未实测，
默认关闭）；审核写入【机制已实现，W06；写路径默认关闭】（§5e：S03 Hard Write Safety GO
门禁未满足——三洞与 P0 分级门控未在 runtime 层落地，正式裁定
`docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md`；提案/账本面可用，apply/undo fail-closed）。
- UI 唯一入口 VaultView；四视图：笔记、智能问库、洞察、审核。不新增 Knowledge 顶级导航，
  不重建编辑器（ADR #2）。【已实现，W04】（§5c；洞察/审核的完整功能属后续阶段，当前只呈现真实状态）
- 原 Markdown 是唯一事实源；Knowledge 索引可重建，不得改写笔记冒充事实（ADR #4）。
- Drora 是唯一产品主体；不新建独立桌面 Agent（ADR #1）。

## 1. 状态所有者

| 状态 | 所有者 | 其他方 | 证据 |
| --- | --- | --- | --- |
| Vault 配置（rootPath/displayName/inboxPath/allowAgentWrites） | `vault-config.json` 单文件（插件数据目录），由 `packages/services/src/obsidian-vault/` 门面写入 | hooks 与 SessionStart 上下文只读、每次询问重读 | `specs/obsidian-plugin.md`「形态与状态所有者」 |
| 会话焦点投影 | `vault-focus.json`（services 面板单写，7 天/50 会话修剪） | UserPromptSubmit hook 只读 | 同上「焦点上下文联动」 |
| Knowledge 索引（chunk/FTS/rowid） | 共享 SQLite（按 Profile + Source + Epoch 隔离），可重建缓存 | 跨 Host lease/fencing 防迟到提交 | 【已实现，W02】（§5b） |
| EvidenceReceipt / 引用账本 | 服务端 opaque receipt，绑定 session/run/sourceEpoch/fileSha/quote selector；持久化在共享 knowledge-index.sqlite（v2 `evidence_receipts`），宿主（services）写、CLI Runtime gate 只读 | 模型文字不得自行构造可信 citation | 【已实现，W03】（§5） |
| L2 治理 Proposal 与批准账本 | Proposal + 人工批准 + 版本校验和持久账本 | 未批准/过期批准绝不写文件 | 【机制已实现，W06】（§5e）；执行/撤销写路径默认关闭（S03 门禁未满足，WRITE_SAFETY_NO_GO.md） |
| Session / CommandInbox / Memory / 手机远控 | 复用现有 Drora 运行时 | 禁止复制第二套（ADR #7、交接纪律） | 不变 |

配置事实源唯一：Knowledge 链路的 SourceRegistry 只由当前活动 Vault + Profile 推导，
sourceEpoch 变化使旧 Query、Index Job、Receipt 失效；不得复制独立 Vault 配置
（交接纪律「禁止第二份 Vault 配置事实源」）。【已实现，W02】（§5b.2；Receipt 失效侧见 §5，W03 已实现）

## 2. 方案 C：分级写入（已批准风险方案）

ADR #8。风险分级与运行时落盘通道的映射以 `docs/vaultview/delivery/W00_TOOL_WRITE_MATRIX.md`
的 P0/P1/P2 分级为准绳：

| 层级 | 语义 | 当前状态 |
| --- | --- | --- |
| L0 只读 | 原生 Read/Glob/Grep 直接读 Vault（授权根内），不触及写路径 | 【已实现】（SessionStart 注入，`specs/obsidian-plugin.md`） |
| L1 经授权编辑 | `allowAgentWrites=true` 时，PermissionRequest hook 对根内**普通 Markdown 笔记**的 Write/Edit 权限询问自动放行（收窄策略见 §3） | 【已实现，W01 收窄】 |
| L2 知识治理 | 结构性/批量治理写（重组、批量改名、索引物化等）必须走 Proposal → 人工批准 → 版本校验和持久账本；重复 operationId 幂等 | 【机制已实现，W06】（§5e）；写路径默认关闭（S03 门禁未满足），Bash/js 属未满足的 P0 门控前提而非有意分歧（§5e.8） |
| L3 高风险 | 默认不自动执行（Bash/MCP/js 等可旁路通道的强制写承诺） | 【永久默认关闭，除非真实 Runtime 审计通过（ADR #10）】 |

**明确的不变量**：hook 只匹配 Write/Edit，且只在运行时基础判定为 ask 时被触发。yolo/整工具
allow 规则/会话 allow 在 hook 之前短路；Bash、node_repl(js)、MCP server 进程内写盘完全不经过
PermissionRequest hook（实测证据：`docs/vaultview/delivery/W00_TOOL_WRITE_MATRIX.md` §3/§4/§8）。
因此：**不得在代码、UI、文档中宣称本插件 hook 能阻断 Bash/MCP 的 L2/L3 写入**——那是 W00/W06
的 Runtime 层门控议题，不是本插件的能力。L2 未落地前不存在"强制写入审核"。

## 3. 权限策略（W01 已实现）

PermissionRequest hook（matcher `Write|Edit`）的自动 allow 判定，全部满足才输出
`{behavior:"allow"}`；任何一条不满足或判定过程异常（IO 错误、坏输入、坏配置）一律**静默**
（无输出、exit 0），交回 Runtime 默认问询。绝不 fail-open 到 allow，也绝不 exit 2：

1. 插件数据目录可读且 `vault-config.json` 为有效配置、根真实存在（目录）；`allowAgentWrites=true`。
2. 工具名为 `Write` 或 `Edit`（matcher + 代码双重校验）。
3. `tool_input.file_path` 为非空字符串且不含 NUL。
4. 相对路径必须携带 stdin `cwd`（Runtime 契约必发，`contracts/src/hooks/index.ts:69`）；
   缺失/空白视为异常 → 静默。相对路径按该 cwd 解析——与 Write handler 的
   `resolveWorkspacePath` 语义一致（`core/src/tool/path-policy.ts:32-34`）。
5. 解析后的目标落在 `realpath(vault 根)` 内（拒绝 `..`、绝对路径与跨盘逃逸）。
6. 逐段 `lstat` 拒绝符号链接（根内软链把写入引出根即拒绝；Windows junction 同样命中）。
7. **普通 `.md` 明确授权**：相对根的路径（realpath 基准，`/` 分隔）每个段非空、不为 `.`/`..`、
   不以 `.` 开头（拒绝 `.obsidian/**`、`.hidden/**` 及点文件），末段以 `.md` 结尾
   （大小写不敏感，接受 `.MD`/`.Md`）。目标已存在时必须是普通文件（拒绝目录冒充）。
8. Unicode/中文文件名原样保留，不做 NFC/NFD 折叠（折叠会误伤合法路径）；Windows 保留名与
   大小写折叠行为遵循平台语义。

策略实现独立可测：形状策略为纯函数（`obsidian-plugin/src/lib/paths.ts` 的
`isPlainVaultMarkdownPath`），防逃逸解析为 `agent-access.ts` 的
`resolveAuthorizedVaultWritePath`（返回相对 realpath 根的路径，调用方不得再对原始 rootPath
做二次 `relative`——修复候选补丁在该处的 realRoot 拼写错位，见
`docs/vaultview/delivery/W00_EVIDENCE_REPORT.md` §3.9）。面板门面
（`packages/services/src/obsidian-vault/`）不变量不受影响：hook 收窄后与面板
`normalizeRelativeMarkdownPath` 的"仅非隐藏 `.md`"语义对齐，消除"W01 前 hook 对
`.obsidian` 与非 .md 自动 allow 而面板拒绝"的不对称。路径分隔符在所有平台统一按 `/`
解释：候选路径先做反斜杠归一再解析，与面板门面同一可见性语义；POSIX 上反斜杠是合法
文件名字符，不按字面文件名放行（否则 `notes\.obsidian\x.md` 会被当作单段字面名绕过
隐藏段检查），绝对路径/UNC 判定先于归一对原始串做（K-POL-7，CI ubuntu/macos 实证）。

**与未来 Proposal（L2）的区别**：L1 自动放行只覆盖"根内非隐藏目录的普通 .md 的 Write/Edit
ask 询问"，无持久化规则、每次询问重新校验、不可翻案 deny；L2 面向治理类/批量写，必须显式
Proposal + 人工批准 + 账本（W06），两者不共享放行路径，L1 的存在不构成 L2 的豁免。

## 4. 查询语义【W02 已实现本地检索；问答/决策属 W03/W04】

- FIND_ARTICLE 首先返回 3–5 篇候选及可核验证据（原文片段 + 位置），不默认写冗长总结（ADR #3）。
- ANSWER/COMPARE 只在有权威来源时经已有 Agent Session 生成；无模型/断网仍可浏览检索结果。
- 索引 partial、语义不可用（`semantic_unavailable`）、无答案都必须显式呈现，不编造标题/链接。
- 检索：中文 bigram 或经验证 tokenizer + 英文 BM25，MATCH 参数化；Embedding 走端口，
  不可用时显式降级。候选按 scope/sourceEpoch/runGeneration 隔离、去重聚合；模型不得扩展
  授权范围或日期筛选条件。
- 只索引现有安全门面接受的 Markdown；隐藏/软链/超配额排除并计入 coverage。

## 5. Evidence 语义【已实现，W03】

### 5.1 Receipt 创建（服务端 prepareEvidence）

- `IKnowledgeQueryService.prepareEvidence({ runId, articleId, sessionId? })`：从已完成的
  run 候选创建 opaque EvidenceReceipt。receipt 由服务端生成随机 id（`evr_` + 32 hex），
  绑定 `sessionId / runId / articleId / vaultId / sourceEpoch / sourceFingerprint /
  relativePath / fileSha256 / chunkSha256 / heading / quote selector / title / 有界 excerpt
  / createdAt`，持久化在 knowledge-index.sqlite v2 `evidence_receipts` 表。
- 创建时即复验：run 必须存在且携带该候选；源指纹仍与 run 绑定一致；文件当前 sha256 仍等于
  候选 fileSha256；quote selector 反解出的文本 sha256 仍等于候选 chunkSha256。任一不满足
  → 返回结构化 `stale/missing/source_stale/no_source`，**不签发 receipt**（receipt 只为
  创建时刻已验证为 current 的证据存在）。
- quote selector 偏移是「按 `\r?\n` 切行后以 `\n` 重组」的规范化文本字符偏移
  （markdownChunker 口径）；复验按同一规范化切片 + sha256 比对，天然免疫换行符差异与
  同名 quote 多次出现（位置选择器固定唯一位置，A15）。
- `sessionId` 绑定取 run 的发起会话；run 无会话（纯 FIND_ARTICLE）时 receipt 不绑会话，
  resolveCitation 不做跨会话拒绝（仍受源身份/文件版本校验）。

### 5.2 引用解析（服务端 resolveCitation）

- `IKnowledgeQueryService.resolveCitation({ receiptId, sessionId? })` 是引用可信的唯一入口：
  - 未知 receiptId → `forbidden/unknown_receipt`（伪造 id 永远不可信，A14）；
  - receipt 绑定了会话且与会话不符 → `forbidden/cross_session`（A19）；
  - 源未配置/根失效 → `forbidden/source_unconfigured`；vaultId 不一致（切库）→
    `forbidden/vault_switched`；源指纹变化（撤权重授）→ `stale/source_reauthorized`（A13）；
  - 文件已删除 → `missing/file_deleted`；文件 sha256 不符 → `stale/file_modified`；
    quote 切片 sha 不符 → `stale/quote_moved`（A12）；
  - 全部通过 → `current` + 有界 excerpt（≤240 字符，与候选同界）。
- 解析结果绝不包含 receipt 之外的新增授权：excerpt 有界，正文全文只能经面板/Agent 既有
  只读通道读取。

### 5.3 发送链路复验（CLI Runtime gate，W00 S02 三层接线）

- **契约载体**：`sendText` payload 携带可选 `evidenceRefs: [{ receiptId }]`（≤8 条，仅
  opaque id，正文/路径/sha 一律不随线传输）；`ConversationInputIntent`（queue item 与
  durable `session_input` 账本）同形透传，busy 排队后 refs 随队首提升进入复验。
- **执行时复验**：CLI Runtime 内置只读 Evidence gate（`bootstrap/src/knowledge-evidence/`），
  读同一份 vault-config.json + knowledge-index.sqlite（只读连接）+ 当前文件内容，语义与
  §5.2 相同。接线点（W00 S02 结论）：
  1. `sendText` handler 在 admission 前复验 payload.evidenceRefs——idle 直发在提交给模型
     前复验；
  2. `sendQueuedNow` handler（手动提升与 auto-drain 合成信封的唯一漏斗）在 reserve 前复验
     queueItem.evidenceRefs——**排队期间改文件/撤权/切库，旧 evidence 在执行时必然被拒，
     不得静默降级为 current（A17）**；
  3. guide 通道禁用：携带 evidenceRefs 的输入不得按 guide/steer 投递（requestedDelivery
     强制回退 queue，记录 `guard.evidenceGuideForbidden`）——guide 行内消费不经过提升漏斗，
     也就没有执行时复验点。
- 复验失败 → handler 抛出带 reasonCode 的领域错误 → ACK `failed` + `guard.evidence*`；
  sendQueuedNow 失败回滚 reservation，队首原位保留，auto-drain 路径暂停自动提升。gate 不可
  用（配置/DB 读取失败）按 `guard.evidenceUnavailable` 拒绝，不 fail-open。
- 宿主未注入 gate（旧宿主/测试桩）→ 不复验，保持既有行为（additive 演进，与 sendText
  payload 的旧 CLI 静默丢键同规则）。

### 5.4 不可信数据的边界

- `# userselect` 的 `{text,path}`（`buildPromptWithConversationSelections`）是剪贴板式
  引用，**不是 Receipt**：不进 evidence 账本、不获执行时复验、不可作为可信 citation 解析。
- 模型输出文字中出现的任何 receiptId/path/quote 都是数据：只有服务端 resolveCitation 返回
  `current` 才可作为引用回跳；伪造 id 得到 `forbidden/unknown_receipt`。
- 本地检索/Receipt/复验全部零出站：不经任何模型与网络（ADR #11）；FIND_ARTICLE 无模型、
  断网仍可检索与浏览（A18 的 W03 部分）。

### 5.5 验收映射

A12/A13/A14/A15（服务端 Receipt 语义）、A16/A17（真实会话发送链路复验）、A18 的 W03 部分
（检索与 Receipt 全链无模型可用）、A19（会话绑定）——证据见
`docs/vaultview/delivery/W03_DELIVERY.md` 与 `packages/services/test/knowledgeEvidence.test.ts`、
`apps/drora-cli/packages/bootstrap/test/knowledge-evidence-gate.test.mjs`、
`apps/drora-cli/packages/bootstrap/test/evidence-session-wiring.test.mjs`。

## 5b. 索引与本地检索（W02，2026-10-10 落地）

本节是工作单 W02 的行为契约。实现位于 `packages/services/src/knowledge/`（自研新模块，
不触碰任何还原/上游对齐目录）；channel 与类型单一出处见 §5b.1。

### 5b.1 RPC 面与单一出处

- `ServiceChannels.KnowledgeIndex = "knowledge-index"`、`ServiceChannels.KnowledgeQuery =
  "knowledge-query"` 定义于 `packages/shared/src/channels.ts`（契约字面量唯一出处）；
  `IKnowledgeIndexService`/`IKnowledgeQueryService` 接口与同名 descriptor 常量定义于
  `packages/services/src/knowledge/{knowledgeIndex,knowledgeQuery}.ts`，经
  `packages/services/src/{index,node}.ts` 导出并注册（与 `IObsidianVaultService` 同形）。
- `IKnowledgeIndexService`：`getStatus` / `startReconcile` / `requestRebuild` / `cancelJob`。
- `IKnowledgeQueryService`：`createRun` / `search` / `getRun` / `cancelRun` /
  `onRunUpdated`（`runGeneration+seq` 事件）。`prepareEvidence`/`resolveCitation` 属 W03，
  本阶段不在接口面上伪装。
- Query 入参只有 `query + clientRequestId(+sessionId)`：**不提供任何日期、路径范围、
  数量上限之外的可选过滤参数**，模型/UI 无法借 RPC 扩展授权范围（ADR #3、工作单 6）。
  `clientRequestId` 幂等：重复提交返回同一 run。

### 5b.2 状态所有者（补 §1 表）

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 索引 DB（documents/chunks/chunks_fts/index_jobs/index_lease/coverage） | `node:sqlite`（node 24 内置，SQLite ≥3.49）单文件：`<Profile 数据根>/knowledge/knowledge-index.sqlite`，WAL 模式 | 可重建缓存；删除/重建绝不触及审核账本（W06 才存在）与 vault-config.json |
| Source 身份与 epoch | 同一 DB 的 `sources` 表，由 SourceRegistry 每次 RPC 前从 `vault-config.json`（唯一配置事实源）+ Profile 数据根推导 | 不复制第二份 Vault 配置；`loadVaultConfig` 失败（未配置/根失效）→ 无源 |
| Query run（runGeneration/seq） | Query 服务进程内存 | 不持久化；进程重启即丢（检索无状态可重来） |

**sourceEpoch 语义**：源指纹 = `vaultId(realpath 根 sha256) + configuredAt`。SourceRegistry
每次解析时对比 DB 内指纹，不一致即 `epoch+1` 并清除旧 epoch 的 documents/chunks/jobs 缓存行。
因此**换根（切库）、撤权后重新授权（configuredAt 变化）都会使旧 Query 结果、进行中 Index
Job、后续 Receipt（W03）失效**；`allowAgentWrites` 翻转不换 epoch（它门控写入，不改变读取
范围，读操作不受限是本 spec 既有语义）。

### 5b.3 SQLite 纪律（W00 DB Spike §4 全量采纳）

1. 每条连接显式 `PRAGMA journal_mode=WAL` + `busy_timeout=5000`；`errcode===5`
   （SQLITE_BUSY）单独分类，不与一般错误混淆。
2. 写路径一律 `BEGIN IMMEDIATE` 短事务：**每个 document 的替换是独立事务**，事务内第一条
   语句前重验 lease（owner+epoch(fence)+未过期），Spike3 反例（列戳 CAS 不设防）不复现。
3. `index_lease` 表单行租约：epoch 单调递增为 fence token；TTL（默认 10s）+ 心跳（默认 3s）
   是死亡检测唯一手段；接管成功后 `wal_checkpoint(TRUNCATE)` + `integrity_check` 体检。
4. FTS5 独立表 `chunks_fts(tokens)`，`rowid === chunks.id`；插入/删除与 chunks 行同事务同步；
   检索 `JOIN chunks ON chunks.id = chunks_fts.rowid` 再按 `vaultId+sourceEpoch` 过滤。
5. service 生命周期：`createKnowledgeServices()` 返回的 `dispose()` 停心跳 → 释放租约 →
   关闭连接；在 `node.ts` 记入 `sharedSqliteRepos`（与 OffPeakTaskRepo 同链）统一关闭。

### 5b.4 收录范围与 coverage

- 扫描器与 `vault-fs.ts` 门面同一套不变量：拒绝隐藏段/软链、仅 `.md`、深度 ≤16、
  文件 ≤5000、目录 ≤1000、单文件 ≤2MB；文件内容一律经 `createVaultFileSystem(root).readFile`
  读取（逐段 lstat + sha256 与面板同源）。
- 被排除条目按原因计数（hidden/symlink/notMarkdown/overSize/overQuota/depth），任一非零或
  配额截断 → 该 epoch coverage `partial=true`；`getStatus`/检索结果如实返回 coverage，
  不假装全库完整。
- chunk 记录：heading 路径（`A > B`）、quote selector（起止行 1-based + 全文字符偏移）、
  chunk 文本 sha256、所属文件 sha256；单文件 chunk 上限 512，超出计入截断（partial）。

### 5b.5 词法与语义

- 中文汉字按 bigram 切分（连续汉字串 ≥2 → 相邻二元组序列作 phrase；单字 → prefix 查询），
  英文/数字按词小写，均走 FTS5 默认 unicode61 + `bm25()` 排序（英文 BM25 语义由 FTS5 保证）。
- MATCH 表达式只由 tokenizer 产物构造：token 内引号转义为 `""` 后整体加双引号，用户输入
  永不拼入原始查询串（严格参数化：`WHERE chunks_fts MATCH ?` 绑定参数）。AND 无命中时以
  同一转义规则降级 OR 重试一次。简繁互检不在本阶段承诺（bigram 不折叠字形，归 W05 数据集）。
- Embedding 端口 `KnowledgeEmbeddingPort { id, embed(texts) }` 经工厂注入：未注入、调用失败
  或当前索引无嵌入数据时，检索诊断显式 `semantic_unavailable`，词法候选照常返回；端口可用
  时对词法候选池做余弦重排融合。**未经授权不把笔记内容送任何出站模型（ADR #11）**——端口
  实现自身负责出站授权，默认无端口=零出站。

### 5b.6 run 语义

- `createRun` 即绑定当前 sourceEpoch；`search` 完成时重验：epoch 已变 → run 置
  `source_stale` 并丢弃候选；`cancelRun` 后到达的结果按 `runGeneration` 丢弃（事件与状态
  一律携带 `runGeneration+seq`，迟到消息不得覆盖新 run）。
- 无源（未配置/根失效）→ `no_source`；有源但索引未建 → 空候选 + coverage 如实呈现；
  检索失败 → `failed`（带原因，不含绝对路径）。候选按 `scope(vaultId)+sourceEpoch+
  runGeneration` 隔离，文章级去重聚合（同文档多 chunk 合并为单候选，附命中 chunk 数）。

### 5b.7 验收映射

A02（新增→coverage 准确）、A03（改/删/重命名→旧 chunk 不可见）、A04（隐藏/软链/超限→
排除与 partial）、A05（两真实进程 writer 竞争→旧 fence 拒绝、TTL 接管可恢复）、A06/A10
（找回与空结果不编造）、A13 的 W02 部分（切库/撤权使旧 run 失效）——证据见
`docs/vaultview/delivery/W02_DELIVERY.md` 与 `packages/services/test/knowledge*.test.ts`。

## 5c. VaultView 四视图 UI（W04，2026-10-10 落地）

本节是工作单 W04 的行为契约。实现位于 `packages/ui/src/v4/vault/knowledge/`（自研新模块，
不触碰任何还原/上游对齐目录）与 `packages/ui/src/v4/VaultView.tsx`（既有面板的整合点）。
渲染进程消费的 accessor 接入：`packages/services/src/accessor.ts` 增加可选
`knowledgeIndexService`/`knowledgeQueryService`；`packages/client/src/remoteServiceAccess.ts`
经 RPC channel 建代理（与 `obsidianVaultService` 同形，远端/bots host 未注册该频道时为
调用期失败，由 UI 错误态呈现，不在构造期抛错）。

### 5c.1 信息架构与导航

- 四视图 = VaultView 内顶部切换：`笔记 / 智能问库 / 洞察 / 审核`，默认「笔记」；
  不新增 Knowledge 顶级导航（PRD §2.1，ADR #2 不重建编辑器）。
- 「笔记」是既有 VaultView 能力的原样保留：文件树、Markdown 编辑器（CodeMirror）、
  wiki link、图片粘贴、选区引用/右侧问答、滚动记忆、草稿冲突恢复。本阶段唯一增量是
  「引用回跳」：智能问库的证据跳转携带 quote selector 的行号区间，打开笔记后按行锚定
  并选中原引用区间（`vault-quote-reveal.ts`，行号口径免疫 CRLF 差异——quote selector 的
  行号在原始与规范化文本中同义，字符偏移则随换行符漂移，不用偏移锚定）。
- 「智能问库」接真实 Query/Index/Citation RPC（§5b/§5）；「洞察」「审核」在 W05/W06
  落地前只呈现真实索引/授权状态与"未开放"说明，不伪装功能。

### 5c.2 状态所有者（补 §1 表）

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 四视图激活 tab | VaultView 组件内 React state | 会话内易失；不持久化、不进全局 store（无跨面板订阅需求） |
| 智能问库 run 事实（候选/status/diagnostics） | 服务端 Query 服务（§5b.6） | UI 只保留「当前 runId + runGeneration + seq」投影，`onRunUpdated` 迟到事件按 runId+代数丢弃（A22） |
| 候选列表展示序 | 本地 rank（服务端 bm25+融合） | Jev（W05）未来只覆盖排序提示，不改候选事实、不抢已选文章焦点（PRD 检索原则 2/3） |
| Evidence Inspector 态 | UI 组件内状态（按 articleId 键） | 数据源只有 `prepareEvidence`/`resolveCitation` 结构化结果；UI 不本地复验 sha、不缓存跨 run 的可信判定 |
| 索引状态条 | `IKnowledgeIndexService.getStatus` 快照 | UI 只显示不缓存权威事实；每次 run 落定与手动刷新时重取 |
| 提交幂等键 | UI 生成 `clientRequestId`（randomUUID） | 重试同一次提交复用同键（§5b.1 幂等契约） |

### 5c.3 智能问库交互契约

- **意图**：`自动识别（默认）/ 找文章 / 问内容 / 比较` 四选一；auto 为 UI 启发式分类
  （比较/对比/区别 → compare；找/哪篇/那篇/文章/标题/记得 → find；问/为什么/如何/是什么/总结 →
  answer；默认 find——FIND 是默认形态，候选优先，ADR #3）。意图只决定呈现形态与空态提示，
  **不改变 RPC 请求参数**（`createRun` 无 intent 字段，§5b.1；UI 不得伪造第二套契约）。
- **输入**：多行自然语言；Enter 提交、Shift+Enter 换行、IME composition 期间 Enter 不提交。
- **run 生命周期**：提交 = `createRun`（携带 sessionId 与 clientRequestId）→ `search`；
  检索中可取消（`cancelRun`，结果按 runGeneration 丢弃）；取消不清空上一轮可用结果（PRD §8
  `searching_local` 禁止行为）。新提交使旧 run 投影立即失效（runId 替换 + 旧事件不匹配即丢）。
- **候选**：按文章聚合（服务端已去重），默认露出前 5 篇、可「展开全部」；每篇显示标题、
  相对路径、命中章节（matchedHeading）、有界原文节选（excerpt）、命中 chunk 数与
  「为何候选」（章节 + 命中数；**不展示百分比分数冒充准确率**，score 只进默认折叠的
  Decision trace）。多候选并列展示，不自动选一篇（A09）；用户点击才有选中态。
- **证据 Inspector**：候选卡「核验」→ `prepareEvidence`（签发 receipt，§5.1）→ 立即
  `resolveCitation` 复验（§5.2）→ `current` 显示有界 excerpt + 行号区间 + 「跳到原文」；
  `stale/missing/forbidden/no_source/source_stale` 各自显式呈现机器原因。跳到原文只在
  current 后可用：切到笔记视图打开 `relativePath` 并按 quote 行号区间锚定选中。
- **追问**：沿用同一 Vault 源发起新 run（上一轮候选折叠保留在「上一轮」区）；
  「把引用加入当前 Agent」走既有 selection 引用注入（userselect 数据语义，**不是 Receipt、
  不获执行时复验**，§5.4，UI 必须以文案明示）；无会话时该入口禁用并提示。
- **扩搜**：检索扩搜上限一次由服务端承担（OR 降级，§5b.5）；UI 只通过
  `diagnostics.matchRelaxedToOr` 如实呈现「已自动扩大检索一次」，不提供第二轮人工扩搜入口。
- **Decision trace** 默认折叠：diagnostics（lexicalChunkHits/lexicalCandidates/
  matchRelaxedToOr/semantic+原因）、score、quote selector、runId/sourceEpoch 全部在折叠区。
- **模型不可用/无会话**：问内容/比较意图仍执行同一本地检索；答案生成入口 = 把证据引用送入
  既有 Agent 会话（复用 selection 机制，不新建会话，ADR #7）。无模型/断网/无会话时检索与
  浏览完全可用，该入口禁用并提示（A18）。

### 5c.4 UI 状态映射（工作单 9 态 → 真实数据源）

| UI 态 | 数据源 | 呈现 |
| --- | --- | --- |
| 无 Vault | `getStatus.configured=false` 或 run `no_source` | 连接引导卡（指向笔记视图左下角 Vault 切换器），不自动扫描（A01） |
| 索引 partial | `coverage.partial` + 各排除计数 | 状态条显示已索引数与排除原因计数（A04 的 UI 面） |
| 索引未建 | configured 且 `coverage.indexedFiles=0` 且无进行中 job | 提供「建立索引」按钮 → `startReconcile`；进行中显示 job 状态 |
| semantic unavailable | `getStatus.semantic` / `diagnostics.semantic` | 显式「语义检索不可用（本地词法检索正常）」+ 原因，不冒充语义结果 |
| Jev 拒绝/超时 | W05 前 Jev 默认关闭（ADR #5） | 排序增强区显示「未启用，当前为本地排序」；拒绝/超时分支的交互归 W05，本阶段不存在 Jev 请求 |
| 无答案 | run `empty` | 「未找到可核验来源」+ 改写建议；不编造标题/链接（A10） |
| 多候选 | 候选 >1 | 并列展示不强选；用户点击才有选中态（A09） |
| 过期/撤权 | run `source_stale`、`prepareEvidence` 同名结果、resolve `forbidden/*` | 显式提示源已失效；旧候选禁止签发新 receipt（服务端已拒绝，UI 如实透传） |
| 模型不可用 | 无 sessionId / selection 注入失败 | 检索可用，答案入口禁用并说明（A18） |
| Host 重连/RPC 失败 | service 调用 reject（含断连代理错误码） | 错误态 + 重试按钮；重试复用同一 clientRequestId 幂等语义 |

### 5c.5 渲染与跨平台纪律

- 全部排版走 `text-ui-*` 令牌（DESIGN.md 强制约束），颜色只用语义 token；浅/深色、
  Windows/macOS/Linux、窄屏（390px）布局用 flex/min-w-0/min-h-0 适配，不引入固定宽度。
- 键盘可达：输入区可 Tab 到达；候选卡为 button（Enter 触发）；折叠区/展开按钮 focus 可见。

### 5c.6 验收映射

A01（无 Vault 引导）、A06/A08/A09/A10 的 UI 部分（候选优先、多候选并列、负例不编造）、
A18 的 UI 部分（无模型可浏览）、A20（旧编辑器回归）、A22（取消/切库旧结果不覆盖）。
A21（主题/平台/窄屏）：静态令牌纪律已由 W07 回归锁定——
`packages/ui/test/knowledgeUiDiscipline.test.ts` 对 knowledge UI 源文件禁任意字号
（`text-[..px]`/行内 `fontSize`/根字号突变）与裸色值，并锁 i18n 两语言齐全与对等；
跨平台真实渲染与 GUI 截图仍未实测（本环境无显示服务器，缺口见 W07 交付报告）。
证据见 `docs/vaultview/delivery/W04_DELIVERY.md`、`docs/vaultview/delivery/W07_DELIVERY.md`、
`packages/ui/test/knowledgeAskModel.test.ts`、`packages/services/test/knowledgeAskUiFlow.test.ts`。

证据规则：每项记录真实 command / environment / exit code；`NOT_RUN` 必须写原因。

| ID | 场景 | 期望 | 状态 |
| --- | --- | --- | --- |
| K-POL-1 | 纯形状策略：`.obsidian/**`、`.hidden/**`、点文件、非 .md、空段、`..`、空串 | 全部拒绝自动放行 | 已实现（`test/permission-path-policy.test.mjs`） |
| K-POL-2 | Unicode/中文文件名、`.MD` 大小写 | 原样保留并放行（平台大小写语义内） | 已实现（同上） |
| K-POL-3 | 防逃逸：根外绝对路径、UNC 路径、`\\?\` 扩展路径、`..` 穿越、根内软链文件/目录逃逸、已存在目录冒充 `.md` | 一律静默（交回问询） | 已实现（同上） |
| K-POL-4 | 相对路径带根内 cwd / 无 cwd / 根外 cwd | 放行 / 静默 / 静默 | 已实现（同上） |
| K-POL-5 | 缺失/坏配置：env 未设、目录缺失、JSON 损坏、根被删、根是文件、`allowAgentWrites=false` | 全部静默，不产生 allow 决策 | 已实现（既有 + 新增用例） |
| K-POL-7 | 分隔符等价：`notes\sub\b.md` 在任何平台按 `/` 分隔解析（先归一再解析，与面板 `normalizeRelativeMarkdownPath` 一致） | 解析为 `notes/sub/b.md`，绝不作为字面文件名放行；POSIX 上不绕过隐藏段检查 | 已实现（CI ubuntu/macos 实证修复，`test/permission-path-policy.test.mjs`） |
| K-HOOK-1 | hook stdin/stdout E2E：根内 `.md` Write/Edit + allow → allow 决策，无持久化规则 | 结构化 allow，其余静默 exit 0 | 已实现（`test/hooks-e2e.mjs`） |
| K-HOOK-2 | E2E：`.obsidian/**`、`.hidden/**`、非 Markdown、软链、root 外、`allowAgentWrites=false` | 均不得自动 allow（静默） | 已实现（A29） |
| K-HOOK-3 | 合法 Markdown 编辑与既有默认问询不回归 | 根内 .md 仍 allow；其余行为不变 | 已实现（A30） |
| K-DOC-1 | matcher `Write|Edit` 真实边界写入 spec；代码/UI 不宣称能拦 Bash/MCP L2/L3 写入 | 文档与代码一致 | 已实现（本 spec §2 + `specs/obsidian-plugin.md`） |
| K-IDX-1..n | 索引/召回/中文检索/多 Host lease（A02–A05、A07） | 见 `04_ACCEPTANCE/ACCEPTANCE_MATRIX.md` | W02 已实现（§5b.7，证据 `docs/vaultview/delivery/W02_DELIVERY.md`）；A07 质量门槛归 W05 |
| K-EV-1..n | Receipt/stale/伪造 citation/admission 复验（A12–A19） | 同上 | W03 已实现（§5.5，证据 `docs/vaultview/delivery/W03_DELIVERY.md`） |
| K-UI-1..n | VaultView 四视图（A01、A20–A22） | 同上 | W04 已实现（§5c，证据 `docs/vaultview/delivery/W04_DELIVERY.md`） |
| K-JEV-1..n | Jev 默认关闭/降级（A23–A28） | 同上 | W05 已实现决策层与评测框架（§5d）；A24 真实联调与 A28 真实标注集对比保持未实测（缺凭据/标注集） |
| K-W06-1..n | Proposal 账本/幂等/conflict（A31–A34） | 同上 | 机制已实现（§5e，证据 `docs/vaultview/delivery/W06_DELIVERY.md`）；A31 的 P0 通道硬阻断未实现 → 门禁未满足，正式裁定 `WRITE_SAFETY_NO_GO.md`，写路径默认关闭（§5e 引言/§5e.8） |
| K-W07-1..n | 发布前集成与回归（A16 服务面全链、A21 静态面、A23/A35 零出站、A36 仓库门禁、A37 协议面、双 Host 索引竞争/切源迟到丢弃/撤权/索引 partial/伪造 receipt/提示词注入） | 每项真实 command/exit code | W07 已执行（证据 `docs/vaultview/delivery/W07_DELIVERY.md`：`knowledgeE2EFullChain.test.ts` 全链 3 用例、`knowledgeUiDiscipline.test.ts` 4 用例、knowledge 全量 110 用例、手机远控 51、远端 20、CLI wiring 15、obsidian-plugin 套件；A24/A28 真实联调与真实标注集、真实 Electron/真机 GUI E2E 未执行并写明原因） |

## 5d. Jev 多阶段决策与离线评测（W05，2026-10-10 落地）

本节是工作单 W05 的行为契约。实现位于 `packages/services/src/knowledge/decision/` 与
`packages/services/src/knowledge/eval/`（自研新模块，不触碰任何还原/上游对齐目录）。
ADR #5/#11 继续有效：**Jev 默认关闭；未经授权不把笔记内容送任何出站模型**。

### 5d.1 模块构成与默认关闭

| 单元 | 文件 | 职责 |
| --- | --- | --- |
| DecisionProvider 端口 | `decision/decisionProvider.ts` | `KnowledgeDecisionProvider.decide(request)`：对**已召回的候选片段**做命题级相关性判断；实现自带出站授权责任（与 Embedding 端口同形） |
| LocalFallback | `decision/localFallback.ts` | 确定性本地产出：全部候选 `status:"fallback"`、保持本地名次；任何远端失败/关闭都落到这里，本地候选永远可用 |
| JevAdapter | `decision/jevAdapter.ts` | DecisionProvider 的 Jev 实现：逐候选一次 TypeSafe `systemOne` Noul 调用（经注入 transport），校验分数/ID，失败单候选回退 |
| HTTP transport | `decision/jevTransport.ts` | `JevTransport.post(request)` 端口 + 默认 `fetch` 实现（POST `{baseURL}/v1/systemone`，`Authorization: Bearer`）；API Key 只从 Host 侧安全配置注入，不进 renderer/日志 |
| DecisionPolicy | `decision/decisionPolicy.ts` | 本地确定性策略：五动作裁决、扩搜一次、单调融合（纯函数，可脱离 IO 单测） |
| Consent 账本 | `decision/decisionConsent.ts` | Host 内存授权账本：授予/撤销/逐调用重查 |
| 决策缓存 | `decision/decisionCache.ts` | 进程内有界缓存（键含 provider/model/policy/vault/epoch/queryHash/chunkSha），换源/撤权/版本变化即失效 |
| Telemetry | `decision/decisionTelemetry.ts` | 出站计数/延迟样本/token 用量计数器；不落任何查询与片段文本 |
| 决策管线 | `decision/decisionPipeline.ts` | 编排：授权门 → 缓存 → provider → 校验 → 融合 → 迟到丢弃；产出 run 的 `decision` 诊断 |
| 离线评测 | `eval/evaluationMetrics.ts`、`eval/evaluationHarness.ts` | 纯指标函数 + 走真实检索代码路径的 A/B harness |

**默认关闭的实现含义**：`createKnowledgeServices` 不注入 `decisionProvider`（与
`embeddingPort` 同形可选）→ 管线恒走 `off` 分支，`outboundCount=0`，`grantDecisionConsent`
返回 `granted:false, reason:"disabled"`。renderer 无法注入 provider（端口只在 Host 侧工厂
注入），凭证不进 RPC 面。远端 Embedding 与回答模型的授权是各自独立的端口/会话通道，
决策授权不复用、不隐含（ADR #11）。

### 5d.2 状态所有者（补 §1 表）

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 授权账本（consent receipt） | Query 服务进程内存（`decisionConsent.ts`） | 按 consentId 索引；绑定 provider/vaultId/sourceEpoch/queryHash/candidateHashes/TTL；不持久化，进程重启即丢（重新询问用户） |
| 决策缓存 | Query 服务进程内存（`decisionCache.ts`） | 键 = sha256(providerId\|model\|policyVersion\|vaultId\|sourceEpoch\|queryHash\|chunkSha)；仅本机、不持久化请求全文；epoch 变化/撤权/policy 或 model 版本变化即失效；LRU 有界 |
| 出站计数与延迟样本 | `decisionTelemetry.ts`（服务生命周期内累计） | `outboundCount` 是 A23 的断言面；日志不写查询/片段/凭据 |
| run 的 decision 诊断 | run 视图字段（§5b.6 run 所有权的延伸） | `KnowledgeRunView.decision`，见 §5d.6 |

### 5d.3 TypeSafe 契约（2026-10-10 真实文档验证，非 Python 示例猜测）

适配目标以当日抓取的官方文档为准（记录于 W05 交付报告 §3）：
HTTP API（docs.typesafe.ai/api.md）：`POST {baseURL}/v1/systemone`，头
`Authorization: Bearer <KEY>` + `Content-Type: application/json`，请求体
`{ state, model, questions: { <name>: { type: "noul", instructions, criteria?{true,false} } } }`，
响应 `{ model, answers: { <name>: { type: "noul", noul: 0..1 } }, usage: { input_tokens, output_tokens } }`；
错误语义 401/422/429（退避）/529（过载）。JS SDK（docs.typesafe.ai/sdk/javascript.md）：
npm `@typesafe-ai/sdk`，`new TypeSafeClient({ apiKey, baseURL, timeout, maxRetries, fetch })`，
`client.systemOne({ state, questions, model? }, options?)` → `answers.<name>.noul` + model/usage，
`noul(instructions?, criteria?)` 辅助构造问题。

- 适配器面向**注入的 transport 端口**编码，默认实现按上述 HTTP 契约；未引入 npm 依赖
  `@typesafe-ai/sdk`（避免为本仓库默认关闭的可选能力增加硬依赖；SDK 形状与 HTTP 形状已
  双向核对一致，切换 SDK 只是替换 transport 实现）。
- 凭证仅存在于 Host 侧安全配置（构造 transport 时注入）；RPC 面、日志、诊断、缓存键
  一律不含 Key 与绝对路径。

### 5d.4 P0 合并决策（不为每条 Query 固定连跑 9 次）

- P0 每**候选**恰好一次出站调用：单条 Noul 问题同时承载「相关性 + 直接证据」判定
  （instructions 要求命题级匹配而非话题相似；criteria.true = 直接陈述/具体回答查询所指向
  的观点，criteria.false = 仅主题相关或泛泛而谈）。
- 意图歧义、充分性、引用支持**不在 P0 触发远端决策**：意图由 UI 既有启发式承担（§5c.3，
  不改 RPC）；充分性由本地 policy 阈值裁决（§5d.5）；引用支持由 Receipt 复验链承担
  （§5，服务端事实，模型评分不可替代）。仅当离线评测证明 P0 单问题不足时，后续工作单
  才按「真正需要」增量引入远端子决策。
- 出站候选上限默认 20（候选池 30 内截断），并发默认 4，单调用超时默认 3s，阶段预算
  默认 6s（JEV_DETAIL §0C.4 实验初值，全部可经 policy 配置覆盖）。

### 5d.5 本地 DecisionPolicy（纯函数）

动作词表：`SHOW_CANDIDATES / EXPAND_ONCE / ASK_CLARIFICATION / PREPARE_EVIDENCE_FOR_AGENT /
NO_RELIABLE_MATCH`。裁决顺序（硬条件优先，Jev 不可越权）：

1. 首轮检索无命中且未扩搜过且查询词元 ≥2 → `EXPAND_ONCE`，编排器以同一 query/scope/
   硬过滤做 OR 降级重试**一次**（A11 上限；`matchRelaxedToOr` 如实入诊断）——先于空候选
   终态判定，否则不可达；
2. 无候选（两轮检索后仍空）→ `NO_RELIABLE_MATCH`——Jev 不能补召回（D32-01）。
3. 有候选且有合法 Jev 分数：top noul ≥ `directThreshold`（实验默认 0.75）→
   `PREPARE_EVIDENCE_FOR_AGENT`（**仅建议**：表示该候选可直接走 prepareEvidence 送
   Agent；不自动签发 receipt，实际签发永远经 §5.1 复验）。
4. 有候选且 top noul < `abstainThreshold`（实验默认 0.45）但存在非零中段分数，或前两名
   分差 ≤ `ambiguityBand`（实验默认 0.08）→ `ASK_CLARIFICATION`（呈现"不确定，可能是
   这几篇"，不强选一篇，A09/A27）。
5. 其余 → `SHOW_CANDIDATES`。无 Jev 分数（off/denied/fallback）时在 1/2/5 中裁决。

融合：`finalScore = 0.35 × normalizedLocal + 0.65 × noul`（JEV_DETAIL §0C.3 实验起始权重，
policyVersion 钉住）；`normalizedLocal` = 名次归一 `(n - rank + 1) / n`（bm25 跨查询量纲
不可比，名次单调鲁棒）。单候选回退时 `finalScore = 0.35 × normalizedLocal`（仅本地项，
相对名次保持）；**绝不把 noul 数值展示为正确率**（§5c.3 score 折叠纪律延伸）。

### 5d.6 授权绑定与 run 诊断

- `grantDecisionConsent({ runId, candidateIds? })`：run 落定且有候选时授予
  `{ granted:true, consentId, expiresAtMs }`，绑定授予时刻的 provider/vaultId/sourceEpoch/
  queryHash(=sha256(规范化 query))/candidateHashes（候选 chunkSha256 集合，可被子集授权）/
  TTL（默认 60s，单 query）。追问/新 Query 是新 run，必须重新授权（§0C.5 追问行）。
- `revokeDecisionConsent({ consentId })`：撤销并清除该授权关联的缓存条目；撤销后进行中的
  阶段在**下一次逐调用重查**时失败回退。
- **实际调用前重查**：JevAdapter 在每个候选的出站调用前重验完整绑定（provider/vault/
  epoch/queryHash/该候选 chunkSha/未过期/未撤销），任一不匹配 → 该候选本地回退，不再出站。
  阶段结束后管线重验 sourceEpoch，已变 → 整个决策丢弃（按 source_stale 语义，§5b.6）。
- `KnowledgeRunView.decision`（nullable，RPC additive）：
  `{ status: "off"|"denied"|"applied"|"fallback"|"cancelled", reason, action, providerId,
  modelVersion, policyVersion, outboundCount, scoredCount, fallbackCount, cacheHitCount,
  latencyMs }`。`reason` 机器可读（`disabled_no_provider / consent_missing / consent_expired /
  consent_revoked / timeout / http_429 / http_5xx / invalid_score / unknown_candidate /
  provider_error / cancelled`），不含查询文本、路径与凭据。

### 5d.7 降级与竞态

- 单候选失败（超时/429 短退避一次后仍失败/5xx/529/取消/非法评分（非有限数或出 [0,1]）/
  未知候选 ID/授权失效）→ 该候选 `fallback`，**其余候选照常**；整阶段失败（budget 耗尽、
  provider 抛错、授权整体失效）→ 全部回退 LocalFallback。本地候选与排序永远完整可用
  （A25）。
- 迟到响应：决策结果落定时校验 `runGeneration`（cancelRun/新提交即失效，A22/A26 语义
  延伸）与 sourceEpoch；不匹配即整包丢弃，绝不覆盖新 Query 的候选。跨 run 结构隔离：
  决策阶段按 runId 作用域，不存在 A 覆盖 B 的路径（J07）。
- 缓存失效：键含 policyVersion/model/sourceEpoch/vaultId/queryHash/chunkSha（J09）；撤权
  清除关联条目；命中不产生出站（`cacheHitCount` 计入诊断，`outboundCount` 不增）。

### 5d.8 离线评测框架（A07/A28 的工具面）

- `evaluationHarness` 走**真实**检索代码路径（`searchKnowledgeLexical` + 决策管线）对比
  变体：`lexical`（无语义端口）/ `hybrid`（+Embedding 端口）/ `hybrid+jev`（+DecisionProvider）/
  `hybrid+reranker`（同端口注入另一 provider 实现）。
- 指标（`evaluationMetrics.ts` 纯函数，逐个可单测）：Recall@30、Hit@1/Hit@5、MRR、
  No-answer FP（无答案样本被宣布命中的比例）、Evidence Precision（top-1 候选是否含相关
  chunk）、P50/P95 延迟、成本代理（outboundCalls / inputTokens / outputTokens / cacheHits）。
- 数据集要求（EVAL_DATASET_SPEC）：真实脱敏、人工标注的中文查询；标注分歧复核仲裁；
  Jev 自身评分不得作为真值。**本阶段仓库内只有合成脱敏试点样例（测试 fixture，非人工
  标注集）**——指标数字只证明框架计算正确，不构成任何真实收益声明（A28 保持未实测）。

### 5d.9 验收映射

证据规则同 §6：真实 command / environment / exit code；`NOT_RUN` 必须写原因。
证据见 `docs/vaultview/delivery/W05_DELIVERY.md` 与
`packages/services/test/knowledgeDecisionPolicy.test.ts`、`knowledgeJevAdapter.test.ts`、
`knowledgeDecisionPipeline.test.ts`、`knowledgeEvaluationHarness.test.ts`。

| ID | 场景 | 状态 |
| --- | --- | --- |
| A23 / K-JEV-1 | 默认关闭/拒绝 → `outboundCount=0`、grant 返回 disabled | 已实现（pipeline 测试） |
| A24 / K-JEV-2 | 真实非私密 Noul 请求 + SDK/model/耗时记录 | **未实测（缺凭据）**：transport 线格式经本地假服务器逐字段断言；真实出站待用户提供 API Key |
| A25 / K-JEV-3 | 429/5xx/timeout/NaN/未知候选 ID → 本地候选保留 + 降级标记 | 已实现（adapter/pipeline 测试） |
| A26 / K-JEV-4 | 迟到/取消决策不覆盖新 Query；重排不改候选事实（articleId 稳定） | 已实现（pipeline 测试；UI 选中锚点由 W04 reducer 按 articleId 保持） |
| A27 / K-JEV-5 | 无答案负样本不被强选（NO_RELIABLE_MATCH / ASK_CLARIFICATION 硬条件） | 已实现（policy 测试） |
| A28 / K-JEV-6 | 真实人工标注中文集 A/B | **未实测（缺标注集）**：框架 + 合成脱敏试点集已交付 |
| A11 | 扩搜上限一次由 policy 执行 | 已实现（policy 测试 + 既有 OR 降级回归） |
| A35 | 决策出站独立授权、日志无全文/凭据 | 已实现（consent/telemetry 测试） |

## 5e. 审核写入与安全写回（W06，2026-10-10 落地；评审修复轮 1 收敛为 NO-GO 交付）

本节是工作单 W06 的行为契约。实现位于 `packages/services/src/knowledge/review/`（自研新模块，
不触碰任何还原/上游对齐目录）；channel 字面量 `ServiceChannels.KnowledgeReview =
"knowledge-review"` 在 `packages/shared/src/channels.ts`（单一出处）。

**门禁裁定（诚实口径，完整引用 W00 条件）**：W06 的门禁是 TASK_GRAPH `tasks[6].gate =
"S03 Hard Write Safety GO"`。W00 对 S03 的判定是**有条件 GO**（`W00_EVIDENCE_REPORT.md` §7），
其 GO 前提为：

1. **先修三洞**（全部位于 runtime 层，须程序化门控、不依赖插件 hook）：
   (1) plan 模式两处打洞——无 `destructiveHint` 的 MCP 直通（`core/src/permission/service.ts:415-422`）
   + memory md 覆盖 plan deny（`core/src/tool/executor/memory-file-permission.ts:38-46`）；
   (2) node_repl/MCP 无内容规则粒度，一次「总是允许」即持久化整工具 allow
   （`core/src/tool/executor/permission-suggestions.ts:24-36` + `permission/service.ts:292`）；
   (3) Bash 整工具 allow 规则短路含重定向在内的一切命令
   （`core/src/tool/handlers/bash-command-rule-evaluator.ts:14`）；
2. **P0 分级门控**：任意路径写（Bash/js/未声明 destructive 的 MCP）强制逐次确认 + 禁整工具
   持久 allow；统一挂点 `resolveToolCallCapabilityFlags`（`permission-capability.ts:28-39`）；
3. **有意分歧集合仅限**：MCP server 进程内写盘、宿主自动写盘、yolo 直通（改审计+receipt）。

截至 W06 交付，`c39ce371..HEAD` 对上述三洞文件零改动、P0 门控未实现——**门禁未满足**。
按工作单「没有强硬阻断的真实证据，只提交 `WRITE_SAFETY_NO_GO.md`」执行：

- 本节机制（Proposal/批准/账本/Undo/reconcile）已落地并测试，但**执行/撤销写路径默认
  fail-closed**：`createKnowledgeReviewService` 的 `writePathEnabled` 缺省 false，
  `applyProposal`/`undoOperation` 返回结构化 `write_path_disabled`，文件零触碰；
  生产装配（`node.ts` 经 `knowledgeServices`）不传使能，仅测试显式开启；
- 提案/批准/账本/只读 reconcile 面保持可用，供审计与门禁复验；
- 正式交付裁定见 `docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md`（含 GO 路径）。
  门禁通过前，不得在代码、UI 或文档中宣称审核写入已生效。

### 5e.1 模块构成

| 单元 | 文件 | 职责 |
| --- | --- | --- |
| DTO 与状态机词表 | `review/reviewTypes.ts` | Proposal/批准/Operation 视图、变更类型、结构化拒绝原因（RPC 面唯一定义处） |
| 账本存取 | `review/reviewStore.ts` | `review_proposals / review_approvals / review_operations / review_operation_files` 行映射、operationId 唯一约束、prepared→applying 单赢家转移（BEGIN IMMEDIATE） |
| 审核服务 | `review/reviewService.ts` | `IKnowledgeReviewService` 接口 + descriptor + 实现：Proposal 生命周期、批准绑定、经 Vault 门面的 CAS 写执行、Undo、reconcile；每 vault 进程内异步互斥 |

### 5e.2 状态所有者（补 §1 表）

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| Proposal（目标源/来源证据/base SHA/revision/精确内容） | knowledge-index.sqlite v3 `review_proposals`（vaultId + revision + changesHash + changes JSON） | 与索引同库但**不在任何清除路径上**：`requestRebuild`/reconcile/`pruneStaleSourceRows` 只清 documents/chunks/chunks_fts/index_jobs/coverage，绝不触及 review 四表与 evidence_receipts |
| 批准账本 | 同库 `review_approvals`，主键 (proposal_id, revision)；绑定 changesHash + sourceEpoch + expiresAtMs | 过期/换 revision/换 epoch 的批准自然失效，不删行（审计历史） |
| Operation ledger | 同库 `review_operations`（operationId PRIMARY KEY，唯一约束）+ `review_operation_files`（每文件 base/next/snapshot/状态） | 快照（写前内容）在落盘前先入账本；崩溃后凭账本 reconcile |
| 进程内写互斥 | 服务实例内存 per-vault 异步互斥 | 只防同进程交错；跨 Host 串行靠账本转移 + 门面 CAS（§5e.6） |
| 审核视图选中态等 UI 局部状态 | 归后续 UI 工作单（W04「审核」视图当前只呈现真实状态） | UI 不缓存权威事实 |

### 5e.3 RPC 面（`IKnowledgeReviewService`）

`createProposal / reviseProposal / getProposal / listProposals / approveProposal /
rejectProposal / applyProposal / reconcileOperation / reconcileStuckOperations /
undoOperation / getProposalChangeContent`。

- `createProposal({ title, reason, evidence, changes })`：每条 change = `{ kind:
  "write"|"create"|"delete", relativePath, baseSha256?(write 必填/create 必为 null/
  delete 必填), content?(write/create) }`。创建即绑定当前 vaultId 并逐条校验：
  路径经 `normalizeRelativeMarkdownPath`（仅非隐藏 `.md`）+ `getSafeVaultTarget`
  （逐段 lstat 拒软链）；write 的 baseSha256 必须等于当前文件实际 sha256（创建时即对
  齐现实，杜绝「批准一个基于幻觉旧版」的提案）；content ≤2MB（与门面上限一致）。
- `reviseProposal`：任何 changes/标题/理由/证据变化 → `revision+1` + changesHash 重算；
  旧 revision 的批准仍在账本但**只对旧 revision 有效**——apply 只认当前 revision 的批准
  （A32「Diff 改后旧 revision 无效」）。
- `approveProposal({ proposalId, ttlMs? })`：记录 `(proposalId, revision, changesHash,
  sourceEpoch, approvedAtMs, expiresAtMs)`（TTL 默认 10 分钟，钳位 [30s, 24h]）。
- `applyProposal({ proposalId, operationId? })`：全量前置校验（§5e.5）通过才执行；
  operationId 是调用方幂等键——已存在则**原样返回账本记录，绝不二次执行**（A33）。
  **S03 总门（评审修复轮 1）**：`writePathEnabled` 缺省 false 时 apply/undo 直接返回
  结构化 `write_path_disabled`（先于一切其他校验），文件零触碰（§5e 引言）。
- `reconcileOperation / reconcileStuckOperations`：对 `applying`/`uncertain` 的账本行做
  **只读文件证据核验 + 账本状态落定**，绝不执行任何文件写（A33「未知结果 reconcile 后
  才继续」；重启恢复入口）。
- `undoOperation({ operationId })`：对该 operation 内已 applied 的文件按逆序做带当前
  SHA 验证的逆操作（§5e.7）。
- `getProposalChangeContent({ proposalId, relativePath })`：读取提案内某文件的精确目标
  内容（Diff 预览用；≤2MB）。正文原文继续走既有只读通道，本方法只回提案内声明的内容。

### 5e.4 Proposal 契约（L2）

- **目标源**：创建时解析当前源（`resolveKnowledgeSource`，vault-config.json 唯一事实源），
  绑定 vaultId；未配置/根失效 → 结构化 `no_source` 拒绝。
- **来源证据**：`evidence` 数组（receiptId 引用或文字说明）原样入账本，供审批人核对
  「为什么改」；服务不校验 receiptId 的 current 性（证据是审批上下文，不是写授权）。
- **目标 base SHA**：每条 write/delete change 携带 baseSha256；create 携带 null。
- **proposalRevision**：从 1 起单调递增；changes 内容集的任何变化都产生新 revision。
- **精确 Diff**：changes JSON 保存目标精确内容（nextContent），Diff 由 (baseSha 内容,
  nextContent) 完全决定；**不存模糊指令**（「把这些文件整理一下」不是合法提案）。
- **L3 不可表达**：路径规则（仅普通非隐藏 `.md`）+ 内容 ≤2MB + 无批量通配/目录操作 →
  批量重构、修改 `.obsidian`、非 Markdown 写在类型面上无法构造（ADR #8 的 L3
  「默认不自动执行」在本门面是结构性排除，不是开关）。

### 5e.5 批准绑定与 apply 前置校验（未批准/过期批准绝不写文件）

apply 在**任何文件 IO 之前**按序校验，任一失败返回结构化拒绝（机器可读 reason），
不产生半写状态：

1. 提案存在且未 rejected；当前 vaultId 与提案一致；`allowAgentWrites=true`（撤权即拒）；
2. 当前 revision 存在批准行：revision 匹配、changesHash 与当前 changes 重算一致、
   sourceEpoch 与当前 epoch 一致（切库/撤权重授即失效）、未过期；
3. operationId 幂等检查：账本已存在 → 返回既有记录（不执行）；`applying` 状态的既存
   operation → 拒绝并指向 reconcile；
4. 单赢家转移：`INSERT operation(prepared)` → `UPDATE ... SET status='applying'
   WHERE operation_id=? AND status='prepared'`（BEGIN IMMEDIATE；影响行数=0 即另一
   Host 在执行 → `busy` 拒绝，绝不并发进文件写）。

### 5e.6 Operation ledger 与双 Host 串行

- operationId 唯一约束（PRIMARY KEY）；状态机 `prepared → applying → applied /
  conflict / uncertain`；per-file 状态 `prepared / applying / applied / conflict /
  not_landed / undo_applied / undo_conflict`。
- **先保护快照**：每个文件写前，把当前内容（≤2MB）+ sha256 写入
  `review_operation_files`（snapshot 列），再执行门面写入；快照落账本失败即中止该
  operation（无快照不写，Undo 无依据）。
- **冲突即停**：任一文件 conflict（base sha 失配 / 门面 CAS conflict / 删除时 sha 不符）
  → 立即停止后续文件，operation 置 `conflict`；已 applied 的文件保持独立可 Undo。
- **双 Host 串行**：同 operationId 由唯一约束 + prepared→applying 单赢家转移串行；
  不同 operationId 写同一文件由门面 read-SHA + atomic rename CAS 串行（后写者
  conflict）；同进程并发由 per-vault 互斥排队。三层合起来保证：同一文件的两次审核写
  绝不交错落盘，第二个操作者拿到结构化 conflict 而非静默覆盖。
- **结果未知（断线/崩溃）**：process 死亡让账本停在 `applying`；恢复后只能经
  reconcile 落定：文件 sha==next → `applied`；sha 与 base、next 均不同 → `conflict`
  （外部编辑介入）；sha==base → `not_landed`（operation 回 `prepared`，**重放必须
  显式再次调用 apply**，服务任何路径都绝不自动重放）。诚实的已知限制：sha==base 无法
  区分「从未写入」与「写入后被外部还原为逐字节相同内容」——因此 not_landed 只表述
  「当前文件处于 base 版本」这一事实，不含对执行史的断言。

### 5e.7 Undo（带当前 SHA 验证的逆操作）

- write 的逆 = 用快照覆盖（门面 CAS `expectedSha256 = applied 时记录的 nextSha`）；
  create 的逆 = 删除（CAS 同上）；delete 的逆 = `createOnly` 重建快照内容。
- 执行前验证当前文件 sha 与账本记录一致；不一致（外部编辑/旁路写入）→ `undo_conflict`，
  文件原样保留，绝不覆盖。Undo 同样要求 allowAgentWrites=true 且 vault 匹配；不需要
  新批准（它恢复的是已批准操作之前的状态），但全程留账本痕迹（undo 状态 + 时间）。
- Undo 不可用（快照缺失/已 undo）→ 结构化拒绝；部分文件的 undo 失败不影响其他文件
  继续（逐文件独立，operation 视图如实呈现每文件结果）。

### 5e.8 覆盖边界与门禁前提（A31 的诚实结论）

- **本门面硬覆盖（门禁通过后生效）**：经 `IKnowledgeReviewService` 的 L2 写——未批准/过期/
  换 revision/换 epoch/撤权/冲突一律结构化拒绝，文件零触碰（A32/A33/A34 的测试面）；
  当前因总门关闭（§5e 引言）暂不可达。
- **未满足的 GO 前提（不是有意分歧，必须修）**：P0 任意路径写通道——Bash、node_repl(js)、
  未声明 destructive 的 MCP——按 W00 GO 前提必须在 runtime permission 层程序化实现
  「强制逐次确认 + 禁整工具持久 allow」（三洞清单见 §5e 引言）。这些通道当前可绕过
  PermissionRequest hook（W00 矩阵 §3–§4 实证），在前提落地前构成 NO-GO 的直接理由。
- **有意分歧集合（仅限以下三项，按 W00 收窄口径）**：MCP server 进程内写盘、宿主自动写盘
  （artifacts/exec 日志/memory md/workflow 草稿等 8 类）、yolo 直通——这些无法逐路径硬阻断，
  按 W00 改为「模型可见工具全覆盖 + 自动写盘审计日志 + yolo 需显式 receipt」并在本 spec 记录
  （审计事件面属后续工作单，当前以账本快照 + SHA 证据检测作为本门面范围内的补偿控制：
  旁路写入必然改变文件 SHA → 后续 apply/undo/提案 base 校验结构化 conflict，绝不静默覆盖）。
- **线性化限制（必须随实现声明）**：门面的 read-SHA + atomic rename 不是严格线性化
  CAS——SHA 校验与 rename 之间存在窗口，外部 Obsidian（或任何进程）在该窗口内保存
  会被本次写入覆盖（外部编辑丢失，本方写入成功）。本服务不做跨进程文件锁（Windows/
  macOS/Linux 无可移植的强制锁语义），只承诺：a) 窗口最小化（校验后立即 rename）；
  b) 账本快照 + SHA 证据让丢失可被发现（后续操作 conflict）；c) 本服务自身的并发写
  （双 Host/双 operation）经账本转移串行。对外部并发编辑不承诺零丢失——这是
  read-SHA 乐观锁的结构极限，不是可修的实现缺陷。

### 5e.9 验收映射

证据规则同 §6：真实 command / environment / exit code；`NOT_RUN` 必须写原因。
证据见 `docs/vaultview/delivery/W06_DELIVERY.md`、`docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md`
与 `packages/services/test/knowledgeReview.test.ts`。

| ID | 场景 | 状态 |
| --- | --- | --- |
| A31 | Write/Edit（W01 hook 收窄）/Bash/MCP/js/宿主自动写的真实覆盖报告 | **有条件**：报告=本节 §5e.8 + `W00_TOOL_WRITE_MATRIX.md`；P0 通道（Bash/js/MCP）硬阻断未实现 → 门禁未满足，正式裁定 WRITE_SAFETY_NO_GO.md |
| A32 | 未批准/过期批准/审批后改稿（revision+1）绝不写文件 | 已实现（review 服务测试；机制层面，写路径当前默认关闭） |
| A33 | 重复 operationId 只执行一次；断线未知结果 reconcile 后才继续；重启 reconcile 不自动重放 | 已实现（review 服务测试） |
| A34 | 外部并发修改 conflict 不静默覆盖；Undo 验证当前 SHA；双 Host 同文件串行；旁路写盘可检测 | 已实现（review 服务测试） |

- 测试只用合成临时 Vault（`mkdtemp`），绝不修改用户真实 Vault；软链不可用平台（Windows 非
  开发者模式）跳过对应用例并以 junction 补目录逃逸覆盖。
- 日志不写笔记全文、凭据、绝对路径；hook 静默路径不产生任何输出。
- Jev 与一切外发默认关闭（ADR #5/#11）。
