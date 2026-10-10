# Obsidian Knowledge / VaultView 2.0 Spec

来源：交接包 `docs/vaultview-agent-handoff/05_REFERENCE/PROPOSED_REPO_SPEC_obsidian-knowledge.md`
（用户明确批准的目标方案）+ `01_RULES_AND_DECISIONS/ADR_AND_NONNEGOTIABLES.md`。按 AGENTS.md
「先 spec 后代码」落地本文件后，各阶段工作单（W01–W07）在自己的范围内实现并回填验收证据。

**实现状态标记**：本文各节标注【已实现】/【未实现，属 Wxx】。标注"未实现"的条款是目标
契约而非现状描述——在对应工作单落地前，不得在代码、UI 或文档中宣称其已生效。

## 0. 范围与产品边界

- 一个活动 Vault 的精确文章找回（FIND_ARTICLE）、问库/比较（ANSWER/COMPARE）、来源验证与
  原文回跳；后续阶段扩展 Jev 可选决策（W05）与审核写入（W06）。
- UI 唯一入口 VaultView；四视图：笔记、智能问库、洞察、审核。不新增 Knowledge 顶级导航，
  不重建编辑器（ADR #2）。【未实现，属 W04】
- 原 Markdown 是唯一事实源；Knowledge 索引可重建，不得改写笔记冒充事实（ADR #4）。
- Drora 是唯一产品主体；不新建独立桌面 Agent（ADR #1）。

## 1. 状态所有者

| 状态 | 所有者 | 其他方 | 证据 |
| --- | --- | --- | --- |
| Vault 配置（rootPath/displayName/inboxPath/allowAgentWrites） | `vault-config.json` 单文件（插件数据目录），由 `packages/services/src/obsidian-vault/` 门面写入 | hooks 与 SessionStart 上下文只读、每次询问重读 | `specs/obsidian-plugin.md`「形态与状态所有者」 |
| 会话焦点投影 | `vault-focus.json`（services 面板单写，7 天/50 会话修剪） | UserPromptSubmit hook 只读 | 同上「焦点上下文联动」 |
| Knowledge 索引（chunk/FTS/rowid） | 共享 SQLite（按 Profile + Source + Epoch 隔离），可重建缓存 | 跨 Host lease/fencing 防迟到提交 | 【已实现，W02】（§5b） |
| EvidenceReceipt / 引用账本 | 服务端 opaque receipt，绑定 session/run/sourceEpoch/fileSha/quote selector；持久化在共享 knowledge-index.sqlite（v2 `evidence_receipts`），宿主（services）写、CLI Runtime gate 只读 | 模型文字不得自行构造可信 citation | 【已实现，W03】（§5） |
| L2 治理 Proposal 与批准账本 | Proposal + 人工批准 + 版本校验和持久账本 | 未批准/过期批准绝不写文件 | 【未实现，属 W06】 |
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
| L2 知识治理 | 结构性/批量治理写（重组、批量改名、索引物化等）必须走 Proposal → 人工批准 → 版本校验和持久账本；重复 operationId 幂等 | 【未实现，属 W06】 |
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
`.obsidian` 与非 .md 自动 allow 而面板拒绝"的不对称。

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



证据规则：每项记录真实 command / environment / exit code；`NOT_RUN` 必须写原因。

| ID | 场景 | 期望 | 状态 |
| --- | --- | --- | --- |
| K-POL-1 | 纯形状策略：`.obsidian/**`、`.hidden/**`、点文件、非 .md、空段、`..`、空串 | 全部拒绝自动放行 | 已实现（`test/permission-path-policy.test.mjs`） |
| K-POL-2 | Unicode/中文文件名、`.MD` 大小写 | 原样保留并放行（平台大小写语义内） | 已实现（同上） |
| K-POL-3 | 防逃逸：根外绝对路径、UNC 路径、`\\?\` 扩展路径、`..` 穿越、根内软链文件/目录逃逸、已存在目录冒充 `.md` | 一律静默（交回问询） | 已实现（同上） |
| K-POL-4 | 相对路径带根内 cwd / 无 cwd / 根外 cwd | 放行 / 静默 / 静默 | 已实现（同上） |
| K-POL-5 | 缺失/坏配置：env 未设、目录缺失、JSON 损坏、根被删、根是文件、`allowAgentWrites=false` | 全部静默，不产生 allow 决策 | 已实现（既有 + 新增用例） |
| K-HOOK-1 | hook stdin/stdout E2E：根内 `.md` Write/Edit + allow → allow 决策，无持久化规则 | 结构化 allow，其余静默 exit 0 | 已实现（`test/hooks-e2e.mjs`） |
| K-HOOK-2 | E2E：`.obsidian/**`、`.hidden/**`、非 Markdown、软链、root 外、`allowAgentWrites=false` | 均不得自动 allow（静默） | 已实现（A29） |
| K-HOOK-3 | 合法 Markdown 编辑与既有默认问询不回归 | 根内 .md 仍 allow；其余行为不变 | 已实现（A30） |
| K-DOC-1 | matcher `Write|Edit` 真实边界写入 spec；代码/UI 不宣称能拦 Bash/MCP L2/L3 写入 | 文档与代码一致 | 已实现（本 spec §2 + `specs/obsidian-plugin.md`） |
| K-IDX-1..n | 索引/召回/中文检索/多 Host lease（A02–A05、A07） | 见 `04_ACCEPTANCE/ACCEPTANCE_MATRIX.md` | W02 已实现（§5b.7，证据 `docs/vaultview/delivery/W02_DELIVERY.md`）；A07 质量门槛归 W05 |
| K-EV-1..n | Receipt/stale/伪造 citation/admission 复验（A12–A19） | 同上 | W03 已实现（§5.5，证据 `docs/vaultview/delivery/W03_DELIVERY.md`） |
| K-UI-1..n | VaultView 四视图（A01、A20–A22） | 同上 | 未实现，属 W04 |
| K-JEV-1..n | Jev 默认关闭/降级（A23–A28） | 同上 | 未实现，属 W05 |
| K-W06-1..n | Proposal 账本/幂等/conflict（A31–A34） | 同上 | 未实现，属 W06 |

## 7. 测试与日志边界

- 测试只用合成临时 Vault（`mkdtemp`），绝不修改用户真实 Vault；软链不可用平台（Windows 非
  开发者模式）跳过对应用例并以 junction 补目录逃逸覆盖。
- 日志不写笔记全文、凭据、绝对路径；hook 静默路径不产生任何输出。
- Jev 与一切外发默认关闭（ADR #5/#11）。
