# W04 阶段交付报告（W04_DELIVERY）

**工作单：** W04 — VaultView 四视图真实 UI 接入　**日期：** 2026-10-10　**实现分支：** `feat/vaultview-impl`　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`（本工作单开工时 HEAD 为 `a441352a`，即基线 + W00–W03 提交；本工作单改动未提交，按纪律由脚本统一提交）

> 路径约定：`path:line` 相对实施工作树根 `D:/workspace/projects/Drora-vaultview-handoff/`（行号为成稿时状态）。
> 诚实声明：下表所有命令均为本会话在实施工作树实际执行，退出码为真实值；未执行的验证逐项写明原因。本工作单未做 git add/commit/push。测试全部使用 `mkdtemp` 合成临时 Vault，未触碰用户真实 Vault；日志与 UI 不写笔记全文/凭据/绝对路径。

## 1. 完成内容与真实代码证据

### 1.1 文件清单（`git status --short` 实测：6 个修改 + 4 个新增路径）

| 文件 | 改动 | 作用 |
| --- | --- | --- |
| `specs/obsidian-knowledge.md` | 修订 | 新增「§5c VaultView 四视图 UI（W04，2026-10-10 落地）」：§5c.1 信息架构与导航、§5c.2 状态所有者补表、§5c.3 智能问库交互契约、§5c.4 UI 状态映射（工作单 9 态 → 真实数据源）、§5c.5 渲染与跨平台纪律、§5c.6 验收映射；§0 四视图行与 §6 K-UI 行改标已实现并回填证据指针 |
| `packages/services/src/accessor.ts` | 修订 | `IServiceAccessor` 新增可选 `knowledgeIndexService`/`knowledgeQueryService`（`accessor.ts:97-98`，host-local 能力，与 `obsidianVaultService` 同形可选） |
| `packages/client/src/remoteServiceAccess.ts` | 修订 | ① **修复合并回归**：`obsidianVaultService` getter 曾由 `eff2ee71` 加入、后续分支合并时从本文件丢失（丢失后 accessor 上该属性为 `undefined`，VaultView 恒显示「Vault 服务不可用」）——本工作单恢复（`remoteServiceAccess.ts:97-101,233`）；② 新增 `knowledgeIndexService`/`knowledgeQueryService` 两个 RPC 代理 getter（`remoteServiceAccess.ts:104-105,236-241`）。`ChannelClient.getChannel` 不在构造期抛错（`packages/rpc/src/channelClient.ts:37-49`），远端/bots host 未注册频道时为调用期失败，由 UI 错误态呈现 |
| `packages/ui/src/v4/vault/knowledge/knowledgeAskModel.ts` | 新增 | 智能问库纯状态机（可脱离 DOM 单测）：意图启发式分类（`detectAskIntentHint:31`，比较>问内容>找文章，默认 find）、run 投影 reducer（`reduceKnowledgeAsk:134`，runId+runGeneration+seq 三重守卫，A22）、候选展开切片（`sliceCandidates:229`，默认 5 篇）、结果形态映射（`getAskOutcome:256`）、状态条派生（`deriveAskBanners:296`）、证据 Inspector 态 |
| `packages/ui/src/v4/vault/knowledge/KnowledgeAskView.tsx` | 新增 | 智能问库主视图：`createRun→search` 提交编排（`submit:131`，含并发提交 seq 守卫与 clientRequestId 幂等重试）、`cancelRun`（`cancel:175`）、证据核验 `prepareEvidence→resolveCitation`（`verifyEvidence:202`）、`onRunUpdated` 订阅（`KnowledgeAskView.tsx:125`）、索引状态轮询与「建立索引」按钮、Decision trace 默认折叠 |
| `packages/ui/src/v4/vault/knowledge/KnowledgeCandidateCard.tsx` | 新增 | 候选卡 + 状态条子组件：为何候选（章节+命中数，不展示分数冒充准确率）、核验/跳到原文/加入 Agent（明示 userselect 普通引用非 Receipt）/就此追问、结构化证据态（current/stale/missing/forbidden/no_source/source_stale） |
| `packages/ui/src/v4/vault/knowledge/KnowledgeAskResults.tsx` | 新增 | 结果区子组件：Decision trace（默认折叠，收纳 diagnostics/score/runId/epoch）、上一轮（追问保留，默认折叠）、空态/无 Vault 引导/建索引按钮/过期态 |
| `packages/ui/src/v4/vault/knowledge/KnowledgeAskInput.tsx` | 新增 | 输入区子组件：意图四选一、Enter 提交/Shift+Enter 换行/IME 组合期不提交、取消/重试按钮 |
| `packages/ui/src/v4/vault/knowledge/KnowledgeInsightsView.tsx` | 新增 | 洞察视图：真实索引健康（getStatus 快照：coverage/partial/semantic/job）+「洞察建议属 W05 未开放」诚实空态，不伪装洞察卡片 |
| `packages/ui/src/v4/vault/knowledge/KnowledgeReviewView.tsx` | 新增 | 审核视图：真实写入授权状态（`getSummary` 的 allowAgentWrites）+ hook 能力边界如实说明（仅 Write/Edit 询问自动放行；Bash/MCP 不经该 hook）+「L2 提案审核属 W06 未开放」空态 |
| `packages/ui/src/v4/vault/vault-quote-reveal.ts` | 新增 | 引用回跳行锚定（`revealVaultQuote:10`）：按 quote selector **行号**（原始与规范化文本同义）锚定并选中原引用区间、滚动居中；不用字符偏移（CRLF 漂移） |
| `packages/ui/src/v4/VaultView.tsx` | 修订 | 四视图整合：`VaultViewTab` 类型 + 默认「笔记」的 tab 栏（`VaultView.tsx:1590-1620` 附近，`role="tablist"`）；条件布局（笔记=既有侧栏+编辑器原样保留；其余三视图全宽面板）；引用回跳链路 `openNoteFromKnowledge`（`VaultView.tsx:1324`，复用既有 `openFile` 只读通道与 `bodyFocusRequest` 消费机制）+ 编辑器 reveal 分支（`VaultView.tsx:639`）；解析 knowledge 服务（`VaultView.tsx:983-985`） |
| `packages/ui/src/i18n/locales/zh-CN.ts` | 修订 | 新增 `vault.views/tabs/ask/insights/review.*` 共 97 行双语键（中文） |
| `packages/ui/src/i18n/locales/en-US.ts` | 修订 | 同上英文镜像（102 行）；已用脚本核对组件引用的全部静态键 + 动态模板键（intent×4 / banner×11 / tab×4）两语言齐全 |
| `packages/ui/test/knowledgeAskModel.test.ts` | 新增 | 7 个 node:test：意图分类与手选优先、提交生命周期（上一轮归档/证据作废）、A22 迟到事件三重守卫、取消保留语义、候选展开与不强选、outcome 全映射、状态条九态映射 |
| `packages/services/test/knowledgeAskUiFlow.test.ts` | 新增 | 3 个 node:test（服务级集成，见 §2.1） |

### 1.2 逐项完成状态（对照工作单 5 项）

1. **在现有 VaultView 内整合四视图，默认笔记；不新增顶级入口** —— 完成。tab 栏在 VaultView 内部（`VaultView.tsx:1596`），`workspaceMainView === "vault"` 的挂载点不变（`packages/ui/src/app-shell/WorkspaceShellLayout.tsx:1855`），无新顶级导航；默认 `viewTab="notes"`（`VaultView.tsx:988`）。
2. **「笔记」保持现有能力** —— 完成。文件树/编辑器/wiki link/图片/Properties/选区对话/滚动记忆/草稿冲突恢复全部原样保留（本工作单对该路径唯一增量是 reveal 分支与 reveal 属性，均为加法；既有 `focusVaultBody` 路径行为不变）。
3. **「智能问库」接真实 Query/Index/Citation RPC** —— 完成。提交=真实 `createRun`（含 sessionId 透传与 `crypto.randomUUID()` 幂等键）→`search`；取消=`cancelRun`；证据 Inspector=`prepareEvidence`→`resolveCitation`（逐层复验、伪造 id→forbidden 如实透传）；「跳到原文」只在 `current` 后可用；自然语言意图四选一（UI 呈现形态，不改 RPC 参数——`createRun` 无 intent 字段，不伪造契约）；扩搜上限一次由服务端承担，UI 经 `diagnostics.matchRelaxedToOr` 如实呈现，无第二轮人工扩搜入口；追问=同源新 run（上一轮折叠保留）+ 既有 selection 引用注入/右侧问答。
4. **本地候选即时返回；Jev 完成后只更新排序提示；Decision trace 默认折叠** —— 完成（W04 部分）。本地候选不等任何远端；Jev（W05）未接入，排序增强区显式「未启用（Jev 关闭），当前为本地排序」（`jevOff` banner，有候选时低噪音提示一次），不存在可被 Jev 抢走的已选文章焦点；trace 初始 `traceOpen=false`。
5. **工作单列出的全部状态都有真实 UI 态** —— 完成，逐态映射见 spec §5c.4 表并有测试锁定（`knowledgeAskModel.test.ts` 状态条用例 + `knowledgeAskUiFlow.test.ts` 服务侧）。九态：无 Vault（`noVault` 引导卡）、索引 partial（coverage 计数条）、semantic unavailable（显式降级提示）、Jev 拒绝/超时（W05 前不存在请求，「未启用」如实呈现）、无答案（`noAnswer` 不编造）、多候选（并列不强选，A09）、过期/撤权（`sourceStale` + prepareEvidence `source_stale` 透传）、模型不可用（无会话时答案入口禁用、检索可用，A18）、Host 重连（RPC reject → 错误态 + 重试，重试复用同一 clientRequestId 幂等）。

### 1.3 实际调用链（关键路径）

- 提交：输入 Enter → `submit`（`KnowledgeAskView.tsx:131`）→ `queryService.createRun({query, clientRequestId, sessionId})` → status=retrieving → `queryService.search({runId})` → `runSettled` 入 reducer（runId+代数守卫）→ 候选卡渲染（本地 rank）→ `refreshIndexStatus()` 刷新状态条。
- 核验与回跳：候选卡「核验」→ `verifyEvidence`（`KnowledgeAskView.tsx:202`）→ `prepareEvidence({runId, articleId})` → current 才 `resolveCitation({receiptId, sessionId})` → verified（excerpt+行号+receiptId 展示）→「跳到原文」→ `onOpenNote(relativePath, quote)` → `openNoteFromKnowledge`（`VaultView.tsx:1324`）→ 既有 `openFile`（面板唯一只读门面）→ `setBodyFocusRequest({vaultId, relativePath, reveal})` → 编辑器 ready 后 `revealVaultQuote`（`vault-quote-reveal.ts:10`）按行锚定选中。
- 取消：检索中「取消」→ `cancelRun({runId})` → `cancelSucceeded`（候选/上一轮保留）→ 服务端返回 cancelled 视图（候选清空、代数提升丢弃迟到结果）。
- accessor 链：`createLocalServices`（W02 已注册，`node.ts:2728-2729`）→ `exposeOnChannelServer`（`desktop/src/host/index.ts:2136`）→ renderer `RemoteServiceAccess`（`remoteServiceAccess.ts:236-241`）→ `useOptionalServices().knowledgeQueryService` → VaultView 传入子视图。

## 2. 测试

| 命令/场景 | 环境 | exit code | 证据 |
| --- | --- | ---: | --- |
| `node scripts/check-workspace-freshness.mjs` | worktree 根，node v24.1.0 / win32 | **0** | 基线新鲜（相对 origin/main ahead，无 behind） |
| `node --import tsx --test packages/ui/test/knowledgeAskModel.test.ts` | 同上 | **0** | tests 7 / pass 7 / fail 0 |
| `node --import tsx --test packages/services/test/knowledgeAskUiFlow.test.ts` | 同上 | **0** | tests 3 / pass 3 / fail 0（开发中修正 2 处用例预期：重新授权后 epoch+1 需先重建索引；已落定 run 的 search 幂等返回，source_stale 走检索中重验路径——均为服务语义澄清，非产品缺陷） |
| 六文件联合回归（W02+W03+W04）：`node --import tsx --test packages/services/test/knowledgeIndexQuery.test.ts packages/services/test/knowledgeChunkerTokenizer.test.ts packages/services/test/knowledgeLeaseFencing.test.ts packages/services/test/knowledgeEvidence.test.ts packages/services/test/knowledgeAskUiFlow.test.ts packages/ui/test/knowledgeAskModel.test.ts` | 同上 | **0** | tests 41 / pass 41 / fail 0 |
| `packages/ui/test/webRemoteControlAutoStart.test.ts` + `desktopPetProjection.test.ts`（同包邻接回归） | 同上 | **0** | tests 11 / pass 11 / fail 0 |
| `npx tsc -b packages/shared packages/services packages/client packages/ui`（定向，开发中多轮） | 同上 | **0** | 无错误 |
| `pnpm typecheck`（仓库全量） | 同上 | **0** | 无错误 |
| `npx oxlint <本工作单全部新增/改动文件>`（13 files） | 同上 | **0** | `Found 0 warnings and 0 errors` |
| `pnpm lint`（仓库全量） | 同上 | **0** | `Found 387 warnings and 0 errors`（与 W02 交付记录的存量基线同值，无新增） |
| `pnpm architecture:check --changed` | 同上 | **0** | `architecture: OK / violations: 0 / baseline: 0 / new: 0` |
| `git diff --check` | 同上 | **0** | 无空白错误 |
| i18n 键核对（脚本比对待用键与 zh-CN/en-US 两语言） | 同上 | **0** | 76 个静态键 + intent×4/banner×11/tab×4 动态键全部两语言齐全 |
| **GUI E2E（真实 VaultView 连接临时 Vault→搜索→展开候选→回跳、键盘、截图）** | — | **未执行** | 原因见 §3 未验证①；已按交接预案以服务级集成测试（`knowledgeAskUiFlow.test.ts`，真实 `createKnowledgeServices` 按组件精确调用顺序驱动）+ 状态机单测替代，并在下方如实声明覆盖缺口 |
| `pnpm fmt:check` / 全量 `node --test` / 既有失败基线三文件 | — | **未执行** | 按交接验证分工由统一脚本执行；`desktopRendererPlatformMobileFace.test.ts`、`computerUseSettingsNavigation.test.ts`、`nonCliAcpRetirement.test.ts` 为既有失败基线，本工作单未触碰 |

### 2.1 场景 → 用例映射（`knowledgeAskUiFlow.test.ts`）

| 验收 ID | 场景 | 用例与断言要点 |
| --- | --- | --- |
| A01/A06（UI 链） | 无源→连接→建索引→提交→候选 | 「UI 编排：状态条→建索引→提交→候选聚合→幂等重试」：`configured=false` → configure+reconcile → `indexedFiles=2` → 提交落定 ready、候选按文章聚合（无重复 path）、quote 行号 ≥1、`evidenceStatus=unverified`；同 clientRequestId 重试返回同一 runId |
| run 事件契约 | `onRunUpdated` | seq 按发出顺序单调递增；UI 侧 runId+代数+seq 守卫由 `knowledgeAskModel.test.ts`「A22」用例锁定 |
| 证据 Inspector | prepare→resolve→回跳数据 | 「UI 编排：证据 Inspector」：current+`evr_` 前缀、excerpt ≤240、行号区间有效；跨会话 resolve → `forbidden`（A19）；伪造 id → `forbidden`（A14）；改原文后 prepare → `stale`（A12/A15 的 UI 触发面） |
| 取消/空查询/无源/切库 | 四态 | 「UI 编排：取消保留语义、无源 run、空查询拒绝与切库过期」：cancel → `cancelled`；空查询服务端拒绝（UI submitFailed 面）；撤权后新 run `no_source`；重新授权→重建索引→新 run ready，检索中切库 → `source_stale` 且候选清空，旧候选 prepareEvidence → `source_stale` |

## 3. 评估和安全

- **Source 权限与数据出站检查**：UI 零新增出站通道——检索/核验全部走既有本地 RPC（ADR #11 不放宽）；「加入 Agent/追问」是既有 selection 引用注入（userselect 语义），按钮文案与 Tooltip 明示「普通引用，不是核验证据（Receipt）」（spec §5.4 边界在 UI 层如实呈现）；「跳到原文」走面板既有只读 `readFile` 门面，无新读路径。测试全部 mkdtemp 合成 Vault，无真实模型/网络调用。
- **跨 Host / Runtime admission / 队列**：本阶段未改 Runtime/队列语义。evidenceRefs 的 composer 附件化发送（W03 建议①的 UI 半边）**不在本阶段交付**——「加入 Agent」走的是 selection 引用而非 `sendText.evidenceRefs`，因此该入口产生的引用不获执行时复验（这是如实声明的边界，不是 Receipt 能力）； composer 附件化留给后续阶段。
- **Jev 真联调与数据集结果**：未涉及（默认关闭，ADR #5/#11）；UI 已为 W05 预留的只有排序提示位（`jevOff` banner），无任何 Jev 请求路径。
- **报告已使用的模拟/Fixture 与未验证部分**：
  1. **GUI E2E / 截图 / 真实键盘链路未执行**：需要启动完整 Electron 应用（renderer 构建 + utilityProcess MessagePort 握手 + CLI runtime spawn），且连接临时 Vault 必须经原生目录选择对话框（无法可靠自动化，且自动扫描面有触碰用户真实 Vault 的风险）。已做替代：服务级集成测试锁定组件的精确 RPC 编排（§2.1），状态机单测锁定 A22/九态/展开/意图；**「真实 VaultView 内点击级操作与跨主题截图」这一验收证据因此缺口，按 W07 演示路径补**。
  2. **浅/深色、390px 窄屏、Windows/macOS/Linux 渲染未实测**（win32 开发机单平台）：实现层面全部使用 `text-ui-*` 令牌与语义色 token（无 `text-[13px]`/裸色值/固定宽度），布局用 flex/min-w-0/min-h-0；A21 判定归 W07 复核。
  3. accessor 链在真实 Electron 进程内的端到端未跑（同 W02/W03 的未验证边界，统一脚本未含 Electron 冒烟）；`RemoteServiceAccess` 构造期安全（`getChannel` 不抛错）由源码证据（`channelClient.ts:37-49`）保证。
  4. `vault.ask.evidence.checking` 键已入两语言字典但 UI 当前以 spinner 呈现核验中（未引用该文案键）；属冗余键，无行为影响。

## 4. 结果与门槛

- **通过的验收 ID**（本会话真实执行证据）：A01、A06/A08/A09/A10 的 UI 面、A18 的 UI 面、A20（旧编辑器路径零重构，diff 为加法；邻接 ui 测试 11/11 回归通过）、A22；spec §6 K-UI 行已回填。
- **未通过/有条件通过**：A21 **有条件通过**——令牌纪律满足（定向 oxlint 0 违规、无禁用字号/裸色），但跨平台/跨主题/窄屏渲染未实测（归 W07）；GUI 点击级 E2E 与截图证据**缺失**（§3 未验证①）。
- **GO/NO-GO**：W04 范围 **GO（有条件）**——工作单 5 项全部落地，10 项新增测试全绿、41 项 knowledge 回归全绿、全量 typecheck/lint/architecture:check 真实通过。宣传边界：智能问库当前是**本地检索+证据核验+回跳**的完整闭环，不声称端到端问答（答案生成入口依赖既有会话与模型）；洞察/审核两视图是真实状态展示 + 未开放说明，不是功能交付。
- **回滚步骤**：`git checkout a441352a -- specs/obsidian-knowledge.md packages/services/src/accessor.ts packages/client/src/remoteServiceAccess.ts packages/ui/src/v4/VaultView.tsx packages/ui/src/i18n/locales/zh-CN.ts packages/ui/src/i18n/locales/en-US.ts`，并删除 `packages/ui/src/v4/vault/knowledge/`、`packages/ui/src/v4/vault/vault-quote-reveal.ts`、`packages/ui/test/knowledgeAskModel.test.ts`、`packages/services/test/knowledgeAskUiFlow.test.ts` 及本报告。无迁移产物（未触及 DB schema 与 vault-config.json）。
- **下一阶段建议**：① W05 接 Jev 时只需替换 `jevOff` 提示位为排序增强通道，并遵守「重排不改已选文章焦点」（reducer 的 `selectedArticleId` 仅由用户动作驱动已是现成约束）；② composer 附件化 `evidenceRefs`（W03 建议①）建议独立成小工作单，复用本阶段 `prepareEvidence→resolveCitation` 的组件编排；③ W07 补 Electron 冒烟时顺带采集四视图浅/深色与 390px 截图（A21 收口）与点击级 E2E；④ `KnowledgeResolveCitationResult` 失败分支的 status 词表含 `"current"`（类型上与成功分支不可区分，组件被迫用 citation 存在性窄化），建议 W05+ 在 services 侧把失败分支 status 收窄为排除 `"current"` 的子集。

## 5. 与工作单假设的偏差记录

1. **修复了一处上游合并回归（超出工作单字面范围、为验收必需）**：`RemoteServiceAccess` 丢失 `obsidianVaultService` getter——提交 `eff2ee71`（HEAD 祖先）曾加入该 getter，本分支文件中不存在（`git show eff2ee71:packages/client/src/remoteServiceAccess.ts` 含 4 处 Obsidian 引用，当前文件 0 处；两提交互不为祖先，合并时丢失）。丢失后果：桌面 renderer 的 accessor 上该属性为 `undefined`，VaultView 恒显示「Vault 服务不可用」，工作单「真实 VaultView 能连接临时 Vault」的验收不可能通过。已恢复并加中文注释说明依据（`remoteServiceAccess.ts:97-100`）；`packages/ui/test` 邻接用例与全量 typecheck 回归通过。
2. **意图（intent）不进 RPC**：交接草案 `RPC_AND_STATE_CONTRACTS.md` 的 `CreateQueryRunRequest.intentOverride` 在 W02 定稿的 RPC 面中不存在（spec §5b.1 明确不提供范围扩展参数）。W04 按真实仓库执行：意图只决定 UI 呈现形态与空态提示，不伪造第二套契约字段（spec §5c.3 已记录）。
3. **Jev 拒绝/超时两态的 UI 呈现方式**：W05 前 Jev 默认关闭、不存在请求路径，故「拒绝/超时」以「未启用（本地排序）」的常态提示呈现，而非错误分支——错误分支交互（重试智能排序等）归 W05，spec §5c.4 已固化。
4. **洞察/审核视图范围**：工作单要求整合四视图但未定义其 W04 内容；按 spec「先 spec 后代码」与诚实原则，两视图只呈现真实索引/授权状态 + 未开放说明（W05/W06 范围如实标注），不使用占位假数据。
5. **测试归属**：`knowledgeAskUiFlow.test.ts` 放在 `packages/services/test/` 而非 ui 包——它驱动的是真实服务编排（组件编排的服务侧契约），沿 W02/W03 的 services 测试惯例；ui 包测试保持纯函数风格（与 `webRemoteControlAutoStart.test.ts` 同款）。
6. **KnowledgeAskView 拆分**：oxlint `max-lines`（400）约束下拆出 CandidateCard/Results/Input 三个子组件文件（真实内聚边界，非禁用规则）；VaultView 自身的 max-lines 豁免为既有状态，本工作单未扩大其范围。
