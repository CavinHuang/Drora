# W03 阶段交付报告（W03_DELIVERY）

**工作单：** W03 — Evidence → 真实 Drora Session → 引用回跳　**日期：** 2026-10-10　**实现分支：** `feat/vaultview-impl`　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`（本工作单开工时 HEAD 为 `9695b680`，即基线 + W00/W01/W02 提交；本工作单改动未提交，按纪律由脚本统一提交）

> 路径约定：`path:line` 相对实施工作树根 `D:/workspace/projects/Drora-vaultview-handoff/`（行号为成稿时状态）。
> 诚实声明：下表所有命令均为本会话在实施工作树实际执行，退出码为真实值；未执行的验证逐项写明原因。本工作单未做 git add/commit/push。测试全部使用 `mkdtemp` 合成临时 Vault，未触碰用户真实 Vault；日志不写笔记全文/凭据/绝对路径（guard 错误 message 只含 receiptId 前 12 字符，见 `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/evidence-admission.ts:27`）。

## 0. S02 前提确认（接手状态）

W00 复核判定 S02=有条件 GO：三层接线前提与代码事实一致——① `CommandInboxHost.guard` 类型预留但构造处未接线（`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/command-inbox.ts:32-33`，decide 调用于 `:394`）；② `sendQueuedNow` 是手动提升与 auto-drain（合成信封 `v4-bridge.ts:645-657`）的唯一汇合漏斗（`queue.ts:165-291`），但只验 reservation/lease/idle；③ 协议无 Receipt 载体（`contracts/src/interfaces/session.port.ts:281-316` 无 sourceEpoch/fileSha/receipt 字段）；guide 通道零闸门。本工作单按该接线结论落地，**未修改任何 Runtime 队列语义**（复验是在既有漏斗上的前置 guard，失败走既有 finally 回滚与 ACK failed 通道）。

## 0.1 修复轮 1（评审 blocking #1：投影漏映射 evidenceRefs）

- **发现**（评审实证，本会话独立复现属实）：`ProductProjection.onTurnSteerQueued.nextItem`（`product-projection.ts:3358`）逐字段构造 QueueItem 时漏映射 `evidenceRefs`——生产队列项来自该投影（`v4-gateway.ts:2565 getQueueItem` 读投影），因此 `queue.ts:188` 的漏斗复验拿到 `undefined` 恒放行；仅 idle 直发（payload 复验）有效，A17 第 2 层在真实链路失效。本会话复现探针：对真 `ProductProjection.applyEvent` 注入带 `intent.evidenceRefs=[{receiptId:"evr_test"}]` 的 `TurnSteerQueued` 事件，输出 `evidenceRefs on projected queue item: undefined`、item keys 无 evidenceRefs。
- **修复**：`nextItem` 补 `evidenceRefs: payload.intent?.evidenceRefs ?? existing?.evidenceRefs`（`product-projection.ts:3380-3383`，与 modelSelection/provenance 同一「intent 缺省保留原事实」规则）。事件源头（core `steering.ts:163` 透传 `request.intent`）已有数据；`TurnSteerDeliveryChanged`/`TurnSteerDispatchChanged` 经 `...item` spread 天然保留（已核对）；`conversation-topic-publisher.ts:390` 的 QueueItem 字面量仅用于 admission 投影字节测量（只读、不进执行），不构成复验缺口。
- **回归锁定**：`evidence-session-wiring.test.mjs` 新增 3 个真投影用例——①真投影 item 携带 refs；②真投影 item → 真 `sendQueuedNow`，复验拒绝在 reserve 前生效（零 reserve/promote/remove/sendInput）；③复验通过后提升 intent 携带投影出的 refs。
- **修复轮验证（本会话实跑）**：wiring 10/10、gate 5/5（联合 15/15）EXIT=0；services knowledgeEvidence 10/10 EXIT=0；四 knowledge 文件联合 31/31 EXIT=0；bootstrap `tsc` 构建与包测试入口 EXIT=0。

## 1. 完成内容与真实代码证据

### 1.1 文件清单（`git status --short` 实测：20 个修改 + 8 个新增路径）

| 文件 | 改动 | 作用 |
| --- | --- | --- |
| `specs/obsidian-knowledge.md` | 修订 | §5「Evidence 语义」由【未实现，属 W03】改写为【已实现，W03】：§5.1 Receipt 创建（四重复验门）、§5.2 resolveCitation 状态机、§5.3 CLI 发送链路三层接线（契约字段/漏斗复验/guide 禁用）、§5.4 不可信数据边界（userselect 非 Receipt、模型文字伪造 id 不可信）、§5.5 验收映射；§1 状态所有者表 EvidenceReceipt 行改标已实现并写明宿主写/CLI 只读；§6 K-EV 行回填 |
| `packages/shared/src/knowledge-evidence.ts` | 新增 | **跨进程契约单一出处**：`KnowledgeEvidenceRef`（仅 opaque receiptId）、`MAX_EVIDENCE_REFS_PER_INPUT=8`、`evr_` 前缀、状态机 `current/stale/missing/forbidden`、原因词表 `KNOWLEDGE_EVIDENCE_REASONS`、guard 词表 `KNOWLEDGE_EVIDENCE_GUARDS`（`guard.evidence*`）、`evidence_receipts` 建表语句数组（migration v2 与 CLI 只读侧共用）、列清单常量、`knowledgeSourceFingerprint`、`normalizeContentForQuoteSelector`（quote 偏移口径 = markdownChunker 的 `\r?\n` 切行 `\n` 重组，宿主与 CLI 禁止各写第二份） |
| `packages/shared/src/index.ts` | 修订 | 导出 knowledge-evidence 契约 |
| `packages/shared/src/drora-protocol-v4/command.ts` | 修订 | `sendText` payload 新增可选 `evidenceRefs`（≤8 条、`.strict()` + `evr_` 形状 refine；旧 CLI z.object 静默丢键 = fail-closed，与 `offPeakToolEnabled` 同款 additive 规则，`command.ts:104-116` 附近） |
| `packages/shared/src/drora-protocol-v4/input-intent.ts` | 修订 | `ConversationInputIntent`（queue item / durable 账本 / 投影的同一自包含事实）新增可选 `evidenceRefs`（`.strict()` 前追加，旧快照无键可解析） |
| `apps/drora-cli/packages/contracts/src/interfaces/session.port.ts` | 修订 | `TurnInputIntentMetadata` 新增 `evidenceRefs?: Array<{receiptId}>`（admission 固定、提升随行、账本持久化） |
| `packages/services/src/knowledge/store/migrations.ts` | 修订 | **migration v2**：`evidence_receipts` 表 + session/run 两个索引；DDL 语句数组直接引用 shared 常量（零复制） |
| `packages/services/src/knowledge/evidence/evidenceRegistry.ts` | 新增 | `prepareEvidenceFromRun`（run/候选 → 源身份 → 文件 sha → quote 切片 sha 四重复验后才签发；签发走 `db.transaction` 短事务写账本；excerpt ≤240 有界）与 `resolveCitationReceipt`（账本→会话绑定→源身份→文件→quote 逐层复验，任一失败结构化返回）；`createVaultFileReader`（内容一律过面板安全门面）；`loadReceiptById` |
| `packages/services/src/knowledge/knowledgeTypes.ts` | 修订 | `KnowledgeRunView` 新增 `sessionId`（Receipt 会话绑定的载体；run 无会话 → Receipt 不绑会话）；re-export evidence 结果类型 + `KnowledgePrepareEvidenceParams/KnowledgeResolveCitationParams` |
| `packages/services/src/knowledge/knowledgeQuery.ts` | 修订 | `IKnowledgeQueryService` 增加 `prepareEvidence` / `resolveCitation` RPC 面（交接包 `RPC_AND_STATE_CONTRACTS.md` 草案中的两方法，按 §5 语义实现） |
| `packages/services/src/knowledge/knowledgeServices.ts` | 修订 | 两个 RPC 实现：每次调用先 `resolveKnowledgeSource`（指纹变化自动 epoch+1），有源时经 `createVaultFileReader` 读当前文件 |
| `packages/services/src/knowledge/query/queryOrchestrator.ts` | 修订 | run 视图透传 `sessionId` |
| `packages/services/src/index.ts` | 修订 | 导出 evidence 纯类型（根 index 不带实现值，同 W02 规则） |
| `apps/drora-cli/packages/bootstrap/src/knowledge-evidence/vault-config-reader.ts` | 新增 | CLI 侧 vault-config.json 只读镜像读取（形状与 services `loadVaultConfig` 同式；根失效→null=撤权语义）；`resolveObsidianPluginDataDirForGate`（`DRORA_DATA_BASE_DIR||HOME` → `<根>/.drora/cli/data/obsidian@drora-plugins-official`，与 services `resolveObsidianPluginDataDir` 公式互为镜像，注释互相锁定）；`isSafeRegularFileWithinRoot`（逐段 lstat 拒软链 + realpath 根内包含） |
| `apps/drora-cli/packages/bootstrap/src/knowledge-evidence/evidence-gate.ts` | 新增 | **Evidence gate（生产实现）**：`node:sqlite` 只读连接惰性打开账本（无 DB 文件 / v1 无表 = 空 ledger）；每次复验重读 vault-config；逐条 receipt 复验 形状→账本→会话→vaultId(sha256(realpath 根))→指纹→文件 sha→quote 切片 sha；失败分型为 `guard.evidenceUnknown/Forbidden/Stale/Missing`，gate 自身不可用 fail-closed `guard.evidenceUnavailable`；`close()` 生命周期 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/evidence-admission.ts` | 新增 | handlers 共用复验入口 `verifyEvidenceOrThrow`（空 refs / 宿主无 port → 放行 = additive）与 `resolveEvidenceSafeDelivery`（证据输入禁用 guide → 回退 queue + `guard.evidenceGuideForbidden`）；`EvidenceGuardRejectionError`（reasonCode 原样上行为 ACK failed.reasonCode，经 gateway 既有错误映射 `v4-gateway.ts:2514-2525`） |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/types.ts` | 修订 | `V4CommandCoreHost` 新增 `verifyInputEvidence?` 端口（宿主未注入不复验，标注非过渡钩子） |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/session-flow.ts` | 修订 | **接线点 1**：`sendText` 在 admission 前（抢 lease/preempt 之前的最早确定点）复验 `payload.evidenceRefs`；delivery 裁决经 `resolveEvidenceSafeDelivery`（guide 禁用），intent 携带 refs（`session-flow.ts:191-232` 附近） |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/queue.ts` | 修订 | **接线点 2**：`sendQueuedNow` 读到完整 QueueItem 后、`reserveQueueItem` 前复验 `queueItem.evidenceRefs`（手动提升与 auto-drain 合成信封的唯一漏斗，`queue.ts:186-190`）；失败 → guard 错误 → 既有 finally 回滚（reserve 未发生，队首原位保留） |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/product-projection.ts` | 修订（**修复轮 1**） | `onTurnSteerQueued.nextItem` 补映射 `evidenceRefs: payload.intent?.evidenceRefs ?? existing?.evidenceRefs`（`product-projection.ts:3380-3383`）。评审 blocking 修复：此前投影逐字段构造 QueueItem 漏掉该键，生产路径上 `getQueueItem` 返回的队首项恒无 refs → 漏斗复验恒空放行（A17 第 2 层失效）。已用真投影探针复现（applyEvent 注入带 `intent.evidenceRefs` 的 TurnSteerQueued，projected item 无该键）并加 3 个真投影回归用例锁定 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/input-intent.ts` | 修订 | `inputIntentMetadata` 与 `inputIntentMetadataFromQueueItem` 透传 `evidenceRefs`（提升后 transcript/projection 仍携带同一组绑定） |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/server-types.ts` | 修订 | `DroraProtocolAgentServerContext.knowledgeEvidenceVerifier?` 与 `DroraProtocolAgentDependencies.knowledgeEvidenceVerifier?`（形状与 core host 端口一致） |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/server.ts` | 修订 | deps 注入透传到 context |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/v4-bridge.ts` | 修订 | binder 把 `context.knowledgeEvidenceVerifier` 透传为 `coreHost.verifyInputEvidence`；durable `admitInputCommand` 把 payload 的 refs 写进 `conversationInputIntentSchema` 与 `session_input` 账本 intent；**账本投递裁决与 handler 对齐**（证据输入 rawRequested=guide → 账本记录 queue + `guard.evidenceGuideForbidden`，避免账本记录一个不会发生的投递，`v4-bridge.ts:745-763` 附近） |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-entrypoint.ts` | 修订 | 生产入口装配 `createKnowledgeEvidenceGate()`（本进程可推导的同一份 vault-config + 账本只读连接 + 当前 Vault 文件） |
| `apps/drora-cli/packages/bootstrap/test/knowledge-evidence-gate.test.mjs` | 新增 | 真 gate + 真 vault-config.json + 真 SQLite 账本（共享 DDL 建表）+ 合成临时 Vault 文件：5 个 node:test（详见 §2.1） |
| `apps/drora-cli/packages/bootstrap/test/evidence-session-wiring.test.mjs` | 新增 | 真 handler（`NATIVE_HANDLERS.sendText/sendQueuedNow`）+ 桩 core host：10 个 node:test（含修复轮 3 个**真投影**用例：`ProductProjection.applyEvent` 注入带 `intent.evidenceRefs` 的 TurnSteerQueued → 投影 item 携带 refs → 真 `sendQueuedNow` 经该 item 复验拒绝/放行；详见 §2.1） |
| `packages/services/test/knowledgeEvidence.test.ts` | 新增 | 真 knowledge services + 真账本 + 合成 Vault：10 个 node:test（详见 §2.1） |

### 1.2 逐项完成状态（对照工作单 5 项）

1. **服务端 opaque EvidenceReceipt，绑定 session/run/sourceEpoch/fileSha/quote selector；打开及发送前再次验证授权与文件当前版本** —— 完成。签发：`prepareEvidenceFromRun`（`evidenceRegistry.ts:117-208` 附近）四重复验后写 `evidence_receipts`；解析：`resolveCitationReceipt`（`:216-300` 附近）状态机 `current/stale/missing/forbidden` + 机器可读 reason。打开（resolveCitation）与发送前（CLI gate，第 3 项）使用同一套判定语义，共享同一 DDL/指纹/quote 口径常量。
2. **原有 Composer/Session 允许显式 `@Vault`/“用选中文章回答”；发送前可预览有界引用内容与出站范围** —— 契约与数据面完成：`sendText.evidenceRefs` 走既有 Composer/Session 命令链（不新建会话，ADR #7）；`resolveCitation.current` 返回 ≤240 字符有界 excerpt + quote selector（预览数据源）；全链零模型/零网络（A18 测试为证）。**发送框 UI 呈现（预览面板/`@Vault` 交互）属 W04**，本阶段提供 RPC 与契约，未做 UI——如实声明。
3. **查明 busy input admission 真正执行时机；排队期间改文件/撤权/切库旧 evidence 不得在执行时当 current** —— 按 W00 S02 结论接线：执行时复验放在 `sendQueuedNow` reserve 前（`queue.ts:186-190`），手动提升与 auto-drain 汇于同一漏斗；`sendText` 在 admission 前复验覆盖 idle 直发；guide/steer 通道被禁用（回退 queue，账本与 handler 同一裁决）。A17 测试证明：拒绝发生在 reserve 之前，队列项原位保留（`evidence-session-wiring.test.mjs` 用例 6）。
4. **模型文字不得自造可信 citation；`# userselect {text,path}` 不是 Receipt；点击前必须服务端 resolveCitation** —— 完成。引用可信唯一入口 = 服务端 `resolveCitation`；伪造/未知 id → `forbidden/unknown_receipt`（A14）；跨会话 → `forbidden/cross_session`（A19，绑定 receipt 未携会话也拒绝——保守面）；`userselect` 引用保持既有 `{text,path}` 数据语义，未接入 evidence 账本（spec §5.4 固化）。
5. **FIND_ARTICLE 不强制触发 Agent 回答；无模型仍可浏览检索结果** —— 完成（W02 已成立，本阶段加测锁定）：`knowledgeEvidence.test.ts`「A18」用例在不配置任何 provider/model 的进程里跑通 createRun→search→prepareEvidence→resolveCitation 全链。

### 1.3 实际调用链（关键路径）

- **签发**：UI(W04) → RPC `knowledge-query.prepareEvidence({runId, articleId})` → `resolveKnowledgeSource`（重读 vault-config，指纹变化即 epoch+1）→ run/候选定位 → 门面读当前文件（逐段 lstat+2MB+sha256）→ quote 切片 sha 复验 → `db.transaction` 写 `evidence_receipts` → `{status:"current", receipt}`。
- **回跳**：UI 点击 → `resolveCitation({receiptId, sessionId})` → 账本 → 会话绑定 → 源身份/指纹 → 文件 sha → quote sha → `current` + 有界 excerpt。
- **发送（idle 直发）**：`sendText` 命令 → gateway admission（`v4-gateway.ts:2398` inbox.handle）→ durable 账本 `admitInputCommand`（refs 入账，guide 禁用裁决对齐）→ handler `session-flow.ts` → `verifyEvidenceOrThrow`（gate：账本只读 + vault-config + 文件 sha + quote sha）→ `startPromptTurn`（模型轮）。
- **发送（busy 排队）**：同上 admission/入队 → turn 结束后提升：手动 `sendQueuedNow` 命令或 auto-drain 合成信封（`v4-bridge.ts:645-657`）→ `queue.ts` handler → 读完整 QueueItem → `verifyEvidenceOrThrow(queueItem.evidenceRefs)` → 通过才 reserve/promote；排队期间改文件/撤权/切库 → ACK `failed` + `guard.evidence*`，项原位保留，auto-drain 路径按既有错误处理暂停自动提升（`v4-bridge.ts:658-671`）。

## 2. 测试

| 命令/场景 | 环境 | exit code | 证据 |
| --- | --- | ---: | --- |
| `node --import tsx --test packages/services/test/knowledgeEvidence.test.ts` | worktree 根，node v24.1.0 / win32 | **0** | tests 10 / pass 10 / fail 0 |
| `node --import tsx --test apps/drora-cli/packages/bootstrap/test/knowledge-evidence-gate.test.mjs` | 同上 | **0** | tests 5 / pass 5 / fail 0 |
| `node --import tsx --test apps/drora-cli/packages/bootstrap/test/evidence-session-wiring.test.mjs` | 同上 | **0** | tests 10 / pass 10 / fail 0（修复轮后含 3 个真投影回归用例） |
| 两 CLI 文件联合 | 同上 | **0** | tests 15 / pass 15 / fail 0（修复轮后） |
| 四 knowledge 文件联合（W02 回归 + W03）：`node --import tsx --test packages/services/test/knowledgeIndexQuery.test.ts packages/services/test/knowledgeChunkerTokenizer.test.ts packages/services/test/knowledgeLeaseFencing.test.ts packages/services/test/knowledgeEvidence.test.ts` | 同上 | **0** | tests 31 / pass 31 / fail 0 |
| `npx tsc -b packages/shared packages/services` | 同上 | **0** | 无错误 |
| `pnpm --dir apps/drora-cli/packages/bootstrap run build`（tsc 全量类型检查；同式验证 contracts、cli 包） | 同上 | **0** | bootstrap/contracts/cli 三包 tsc 全部通过 |
| `pnpm --dir apps/drora-cli/packages/bootstrap run test`（包自带测试入口，回归） | 同上 | **0** | hook/runner/插件发现用例全 ok |
| `npx oxlint <本工作单改动/新增的根仓库文件>` | 同上 | **0** | `Found 0 warnings and 0 errors`（22 files） |
| `git diff --check` | 同上 | **0** | 无空白错误（仅仓库常规 autocrlf 提示） |
| `pnpm --dir apps/drora-cli/packages/bootstrap run lint` | 同上 | **1（既有失败）** | `oxlint src` 报 "No files found to lint"：根 `.oxlintrc.json` `ignorePatterns` 含 `apps/drora-cli`（上游对齐隔离策略），CLI 包 lint 脚本在当前配置下为 no-op——**与本次改动无关的既有状态**（本工作单未改任何 lint 配置；CLI 代码质量门禁为 `tsc`，已通过） |
| `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` / 全量 `node --test` | — | **未执行** | 按交接验证分工由统一脚本执行；本会话只做上述定向验证。既有失败基线三文件（desktopRendererPlatformMobileFace / computerUseSettingsNavigation / nonCliAcpRetirement）未触碰 |

### 2.1 场景 → 用例映射

| 验收 ID | 场景 | 用例与断言要点 |
| --- | --- | --- |
| A12 | 打开引用前改原文 → stale；删除 → missing | services「A12」：改写后 `stale`、删除后 `missing`；CLI gate「复验失败分型」：改文件 `guard.evidenceStale/file_modified`、删文件 `guard.evidenceMissing` |
| A13 | 切库/撤权旧 receiptId → forbidden/stale，不泄漏旧原文 | services「A13」：切库 forbidden、撤权 forbidden、重授权 `stale/source_reauthorized`；CLI gate 同三态（`vault_switched`/`source_unconfigured`/`source_reauthorized`），excerpt 只在 current 返回 |
| A14 | 伪造 receipt/path/quote → 不得成为可信引用 | services「A14」：伪造 id/非法形状 → `forbidden`；CLI gate：非 `evr_` 前缀与未知 id → `guard.evidenceUnknown`（不扫表）；quote 绑定被篡改（A15 同源）→ `stale/quote_moved` |
| A15 | quote 同名多次出现 → 定位有校验，不静默跳错 | quote selector 是位置选择器（行号+字符偏移，`normalizeContentForQuoteSelector` 单一口径）+ 切片 sha 复验；services「A15」与 gate「坏账本行」用例证明错位必 `stale` |
| A16 | @Vault → Query → 预览 → 真实现有 Session → 答案 → 回跳 | 本阶段落地 Query（W02）→ prepareEvidence → 真实 v4 sendText 命令链（真 handler + durable 账本 + intent）→ 执行时复验 → resolveCitation 回跳；**模型生成与 UI 呈现归 W04**（见 §3 未验证） |
| A17 | busy queue 后源更改/授权撤销 → admission 不信任旧证据 | gate「复验失败分型」+ wiring「sendQueuedNow 复验拒绝」（桩 item 与**真投影 item** 两种形状都覆盖）：拒绝在 reserve 前，`reserveQueueItem/markQueueItemPromoting/removeQueueItem/sendInput` 全部零调用 = 队首原位保留；auto-drain 与手动提升走同一漏斗（`queue.ts` 单 handler 事实）。修复轮 1 补：投影映射回归用例锁死「真投影 → getQueueItem → 复验」全链 refs 不丢 |
| A18 | 无模型/断网 → 可检索、可阅读，问答显示不可用 | services「A18」：零模型进程全链可用；无任何网络调用面（services/gate 均无 fetch/http 依赖） |
| A19 | 追问绑定所选文章；换源/新 Query 不串 session | services「A19」：他 session 与未携 session 均 forbidden，同 session current；无会话 run 的 receipt 不绑会话（文档化语义）；wiring：intent.evidenceRefs 随提升原样随行 |

## 3. 评估和安全

- **Source 权限与数据出站检查**：Receipt 签发与解析读文件一律过面板安全门面（`createVaultFileReader` 包 `createVaultFileSystem`，逐段 lstat + 2MB + sha256）；CLI gate 独立实现同防线（形状拒绝 `..`/隐藏段/软链 + realpath 根内包含，测试覆盖越界路径）。全链零出站：无模型/无网络调用面；excerpt ≤240 字符有界，全文只能走既有只读通道（ADR #11 未放宽）。
- **跨 Host / Runtime admission / 队列**：未修改 Runtime 队列语义——复验是漏斗上的前置 guard，失败经既有错误映射（ACK failed + reasonCode）与既有 finally 回滚。账本（evidence_receipts）只由宿主写、CLI 只读，与索引缓存同库但独立表；sourceEpoch/指纹失效使旧 receipt 失效（切库/撤权重授），`pruneStaleSourceRows` 不触及 receipt 表（账本不随缓存清除，保留 forbidden 判定依据）。
- **Jev 真联调与数据集结果**：本工作单未涉及（默认关闭，ADR #5/#11）。
- **报告已使用的模拟/Fixture 与未验证部分**：
  1. **会话级 wiring 测试用桩 core host**（真 handler + 真 gate 实现，但 `DroraApp` 为桩）——未在真实 Electron Host 进程内起真模型轮；「真 Host + 真 Session 查询、生成、引用回跳」的模型生成与 UI 呈现归 W04/W07 演示路径。复验与提升语义已由真 handler 层证明。
  2. **UI Composer 集成未做**（W04）：发送前预览有界引用的 UI 面板、`@Vault` 交互、引用回跳点击不存在于本阶段交付。
  3. **POSIX 平台未实测**（win32 开发机）；gate 路径判定用跨平台 API（path/lstat/realpath），Windows junction/软链用例同 W01 规则以平台能力门控。
  4. **guide 禁用的账本一致性**已实现并构建验证，但没有专门的端到端账本断言用例（`admitInputCommand` 的持久化落盘需要完整 server 环境）；裁决逻辑与 handler 共用同一常量与规则。
  5. 统一脚本范围门禁（repo 全量 typecheck/lint/architecture:check/全量 node --test）未执行（分工），已有失败基线三文件与本工作单无关。

## 4. 结果与门槛

- **通过的验收 ID**（本会话真实执行证据）：A12、A13、A14、A15、A17、A18（W03 部分）、A19；A16 的服务端+发送链路部分（生成/回跳 UI 归 W04）。spec §6 K-EV 行已回填。
- **未通过/有条件通过**：A16 整条（含模型生成与引用回跳点击）**有条件通过**——数据面/RPC/复验链完整，UI 呈现缺位，不声称完整产品闭环。
- **GO/NO-GO**：W03 范围 **GO**（含修复轮 1）——S02 三层接线全部落地（契约字段/漏斗复验/guide 通道），25 项新增测试全绿（services 10 + gate 5 + wiring 10，其中 3 个真投影回归锁定评审修复），W02 31 项回归全绿，触及包全部 tsc 通过。宣传边界：本地检索+Evidence 门禁可用 ≠ 端到端问答可用；`evidenceUnavailable` 是 fail-closed 拒绝不是放行。
- **回滚步骤**：`git checkout 9695b680 -- specs/obsidian-knowledge.md packages/shared/src/index.ts packages/shared/src/drora-protocol-v4/command.ts packages/shared/src/drora-protocol-v4/input-intent.ts packages/services/src/ apps/drora-cli/packages/contracts/src/interfaces/session.port.ts apps/drora-cli/packages/bootstrap/src/`，并删除 `packages/shared/src/knowledge-evidence.ts`、`packages/services/src/knowledge/evidence/`、`packages/services/test/knowledgeEvidence.test.ts`、`apps/drora-cli/packages/bootstrap/src/knowledge-evidence/`、两个新测试文件。v2 migration 兼容旧读方（新表对 W02 代码不可见）；回滚后已存在的 v2 库文件可整体删除（可重建缓存 + 账本随回滚失效，不影响 vault-config.json 与用户 Vault）。
- **下一阶段建议**：① W04 VaultView UI 接 `prepareEvidence`/`resolveCitation`（候选卡「引用」按钮 → receiptId → composer 附件化 `evidenceRefs`；引用点击 → resolveCitation → current 才可回跳）；② 发送前预览直接消费 resolveCitation 结果（有界 excerpt + stale 提示 + 出站范围说明）；③ W07 补真实 Electron 进程冒烟：真 Host `createLocalServices` + 真 CLI spawn + busy 队列场景（本阶段 handler 级已证明）；④ 统一脚本注意：bootstrap 包 `lint` 脚本在根 oxlintrc 下为 no-op（既有状态），CLI 侧质量门禁目前仅 tsc。

## 5. 与工作单假设的偏差记录

1. **Receipt 账本落在 knowledge-index.sqlite v2（共享 DB）而非独立存储**：W00 S02 建议「shared contracts 增加 Receipt 引用字段」，未规定账本物理位置。选择同库新表的理由：宿主写/CLI 只读的跨进程共享是 W03 的核心难题（两进程无法共享内存态），WAL + A05 已验证双进程访问模型；DDL/列清单以 shared 常量为单一出处，测试锁定 migration 与常量同源。**迁移影响**：v2 只增表，v1 读方不受影响。
2. **CLI gate 独立实现复验逻辑而非 import services**：`apps/drora-cli/packages/bootstrap` 不依赖 `@drora/services`（依赖方向禁止，services 反向 spawn CLI）。因此复验口径（指纹公式、quote 规范化、guard 词表、DDL）全部下沉到 `@drora/shared` 单一出处，两侧 import 同一常量；vault-config 读取形状按 services 同式镜像并以注释互相锁定（同 W02 时代 services 镜像 CLI 公式的先例）。
3. **guard 语义选择「拒绝并保留」而非「降级放行」**：复验失败（含 gate 自身不可用）一律拒绝该项发送/提升，不静默降级为 current（W00 S02 复验失败语义）；旧宿主未注入端口时保持既有行为（additive，与 sendText payload 旧 CLI 丢键同规则）——两个方向都如实写入 spec §5.3。
4. **guide 通道处理选 W00 方案 (c) 的「禁用」分支**：证据输入强制回退 queue（记录 `guard.evidenceGuideForbidden`），而非在 `drainPendingInput` 加第二复验点——queue 路径已有唯一漏斗复验，避免在 core steering 内再开洞；账本投递记录与 handler 裁决对齐（否则账本会记录一个不会发生的 guide 投递）。
5. **edit/retry/fork 不继承 evidenceRefs**：重建的输入是新 canonical 输入；receipt 会话绑定使跨会话携带必然 forbidden，携带只会制造必败发送。保守语义 = 不携带即不声明证据（文本内容仍可自由引用，只是不构成 Receipt 主张）。已在 contracts 字段注释与 spec §5.3 固化。
6. **resolveCitation 绑定 receipt 未携会话时拒绝（保守面）**：草案未规定 null sessionId 行为；选择「绑定会话的 receipt 必须由同一会话解析」，FIND_ARTICLE 无会话 receipt（sessionId=""）跨会话可解析，测试锁定两分支。
7. **`prepareEvidence` 的 session 绑定取 run 的发起会话**：接口入参不带 sessionId（与交接草案 `PrepareEvidence` 面一致），绑定源 = `createRun` 透传的 sessionId（W02 已存储、本阶段在 run 视图中透出）。
