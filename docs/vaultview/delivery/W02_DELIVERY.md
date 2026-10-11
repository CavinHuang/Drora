# W02 阶段交付报告（W02_DELIVERY）

**工作单：** W02 — Source / Index / 文章召回服务　**日期：** 2026-10-10　**实现分支：** `feat/vaultview-impl`　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`（本工作单开工时 HEAD 为 `0d543db0`，即基线 + W00/W01 提交；本工作单改动未提交，按纪律由脚本统一提交）

> 路径约定：`path:line` 相对实施工作树根 `D:/workspace/projects/Drora-vaultview-handoff/`（行号为成稿时状态）。
> 诚实声明：下表所有命令均为本会话在实施工作树实际执行，退出码为真实值；未执行的验证逐项写明原因。本工作单未做 git add/commit/push。测试全部使用 `mkdtemp` 合成临时 Vault，未触碰用户真实 Vault；日志不写笔记全文/凭据/绝对路径。

## 1. 完成内容与真实代码证据

### 1.1 文件清单（`git status --short` 实测：4 个修改 + 5 个新增路径）

| 文件 | 改动 | 作用 |
| --- | --- | --- |
| `specs/obsidian-knowledge.md` | 修订 | 新增「§5b 索引与本地检索（W02，2026-10-10 落地）」：RPC 面与单一出处（§5b.1）、状态所有者补表与 sourceEpoch 语义（§5b.2）、SQLite 纪律（§5b.3）、收录范围与 coverage（§5b.4）、词法与语义（§5b.5）、run 语义（§5b.6）、验收映射（§5b.7）；§1 索引行改标【已实现，W02】、§4 标题改为「W02 已实现本地检索；问答/决策属 W03/W04」、§6 K-IDX 行更新证据指针 |
| `packages/shared/src/channels.ts` | 修订 | `ServiceChannels.KnowledgeIndex = "knowledge-index"`、`ServiceChannels.KnowledgeQuery = "knowledge-query"`（channel 字面量唯一出处，`channels.ts:169-172`） |
| `packages/services/src/knowledge/knowledgeTypes.ts` | 新增 | 共享 DTO 唯一定义：`KnowledgeSourceRef/Coverage/IndexJobView/LeaseView/IndexStatus/ArticleCandidate/RunView/RunUpdatedEvent` 等（evidenceStatus 固定 `unverified`，Receipt 属 W03） |
| `packages/services/src/knowledge/knowledgeIndex.ts` | 新增 | `IKnowledgeIndexService` 接口 + 同名 descriptor（getStatus/startReconcile/requestRebuild/cancelJob） |
| `packages/services/src/knowledge/knowledgeQuery.ts` | 新增 | `IKnowledgeQueryService` 接口 + 同名 descriptor（createRun/search/getRun/cancelRun/onRunUpdated） |
| `packages/services/src/knowledge/store/knowledgeDatabase.ts` | 新增 | `node:sqlite` 连接：WAL + `busy_timeout=5000`（默认 0 会 0ms 抛 busy，W00 spike2 实测）+ `synchronous=NORMAL` + 外键；`transaction()` BEGIN IMMEDIATE 短事务 + SQLITE_BUSY(errcode=5) 单独分类为 `KnowledgeBusyError`；连接**惰性**打开（`raw` getter，`knowledgeDatabase.ts:53-67`）；`healthCheck()` = `wal_checkpoint(TRUNCATE)` + integrity |
| `packages/services/src/knowledge/store/migrations.ts` | 新增 | schema v1：`schema_version/meta/sources/documents/chunks/chunks_fts(FTS5)/index_jobs/index_lease/coverage`；FTS5 独立表 `chunks_fts(tokens)`，**rowid === chunks.id**（`migrations.ts:63`） |
| `packages/services/src/knowledge/store/indexLease.ts` | 新增 | 单行租约原语：acquire（epoch 单调递增=fence）/heartbeat/release/read；**`verifyLeaseInsideTransaction`（`indexLease.ts:127-140`）在调用方已开启的写事务内校验 owner+epoch+未过期三条件**（W00 spike3 反例"列戳 CAS 不设防"不复现）；`KnowledgeLeaseLostError` |
| `packages/services/src/knowledge/store/indexRepository.ts` | 新增 | documents/chunks/FTS 同事务同步（插入即 `INSERT INTO chunks_fts(rowid, tokens)`）、coverage 计数与 partial 判定、index_jobs 行 CRUD、`articleIdOf` = sha256(vaultId+relativePath) |
| `packages/services/src/knowledge/source/sourceRegistry.ts` | 新增 | SourceRegistry：每次解析都 `loadVaultConfig`（与面板同一份 vault-config.json，零复制）；源指纹 = `vaultId + configuredAt`；指纹变化 → epoch+1 + `pruneStaleSourceRows` 清除非当前 (vaultId, epoch) 的 documents/chunks/jobs/coverage（`sourceRegistry.ts:106-121`）；DB 路径按 Profile 数据根推导 |
| `packages/services/src/knowledge/index/markdownChunker.ts` | 新增 | ATX 标题切块：heading 路径 `A > B`（栈内保存层级，防浅级别过度弹栈——本会话实测修复的缺陷）、quote selector（1-based 行号 + 全文字符偏移）、chunk sha256、frontmatter 独立 chunk、512 chunk 截断标记 |
| `packages/services/src/knowledge/index/sourceScanner.ts` | 新增 | 扫描不变量与 `vault-fs.ts` 门面同源同值（隐藏段/软链/仅 .md/深度 16/5000 文件/1000 目录/2MB），差异点是被跳过条目按原因计数（coverage 需要）；文件内容不在扫描器读取 |
| `packages/services/src/knowledge/index/indexCoordinator.ts` | 新增 | 任务执行体：抢租约→心跳→全量扫描→与索引对账→**每个文档一个短事务（事务内先 fence 校验）**→coverage/终态→释放租约；未变化文件按 mtime+size、内容按 sha256 跳过（增量语义）；删除消失路径（重命名=旧删+新增）；取消/租约丢失/源切换（superseded）三条停止路径 |
| `packages/services/src/knowledge/search/tokenizer.ts` | 新增 | 中文汉字 bigram（≥2 字串→相邻二元组 phrase；单字→prefix `"字" *`）+ 英文/数字小写词；**MATCH 表达式只由 token 产物构造**（引号词元不可达 + 形状守卫正则 + 严格转义，用户输入永不原样进查询串） |
| `packages/services/src/knowledge/search/embeddingPort.ts` | 新增 | `KnowledgeEmbeddingPort { id, embed(texts): number[][] \| null }`；默认 null = 显式 `semantic_unavailable`、零出站（ADR #11） |
| `packages/services/src/knowledge/search/lexicalRetriever.ts` | 新增 | FTS5 `MATCH ?` 参数化检索 + `bm25()` 升序；候选按 (vaultId, sourceEpoch) 关系过滤隔离；文章级去重聚合（同文档多 chunk 合一，附命中数）；AND 无命中且 tokenCount>1 → 同规则 OR 降级一次；端口可用时对词法池做余弦稳定重排（score 仍为 bm25 值，不伪造第二套分数） |
| `packages/services/src/knowledge/query/queryOrchestrator.ts` | 新增 | run 生命周期：createRun 绑定当前 (vaultId, sourceEpoch)、clientRequestId 幂等、MAX 512 字符；search 完成时重验源，**vaultId 或 epoch 任一变化 → source_stale 且丢弃候选**；runGeneration 单调递增，cancelRun 提升 in-flight 校验代数丢弃迟到结果；`onRunUpdated` 事件携带 runGeneration+seq；run 上限 100 裁剪（易失状态，不持久化） |
| `packages/services/src/knowledge/knowledgeServices.ts` | 新增 | 两个 RPC 服务实现 + `createKnowledgeServices()` 装配：lazy 开库、Embedding 端口注入点、`dispose()`（停 run 事件流 → 关闭 DB）；服务实例只暴露 RPC 面方法（ProxyChannel.fromService 会把一切函数属性暴露为命令，dispose 句柄绝不挂实例） |
| `packages/services/src/node.ts` | 修订 | `createLocalServices` 注册 `IKnowledgeIndexService`/`IKnowledgeQueryService`（`node.ts:2725-2728` 附近，ObsidianVault 同段）；dispose 记入 `sharedSqliteRepos` 统一关闭链（`sqliteReposToClose.push({ close: () => knowledgeServices.dispose() })`）；导出工厂 |
| `packages/services/src/index.ts` | 修订 | 导出两个 descriptor + 全部 Knowledge 纯类型（与 IObsidianVaultService 同形；根 index 被 renderer 拉进浏览器包，不带实现值） |
| `packages/services/test/knowledgeChunkerTokenizer.test.ts` | 新增 | 9 个 node:test：标题路径/偏移回原文、frontmatter、截断、bigram、prefix/phrase、注入形状守卫、无词元报错、cosine 边界 |
| `packages/services/test/knowledgeIndexQuery.test.ts` | 新增 | 10 个场景测试：A02/A03/A04/切库/撤权/中英混搜+负例/MATCH 注入/semantic 端口/run 语义/rebuild（详见 §2.1） |
| `packages/services/test/knowledgeLeaseFencing.test.ts` | 新增 | A05：两个真实 OS 进程竞争租约 + 旧 fence 写拒绝 + 硬杀后 TTL 接管恢复；store 级 fencing 全链路 |
| `packages/services/test/knowledgeLeaseChild.mjs` | 新增 | 子进程脚本：独立进程持租约+心跳，输出 `ACQUIRED <fence>`；被硬杀时租约原地保留（死亡检测只能靠 TTL） |

### 1.2 逐项完成状态（对照工作单 6 项）

1. **按当前 Drora RPC 注册两个服务；channel/type 单一出处；lifecycle dispose** —— 完成。channel 字面量入 `ServiceChannels`（`channels.ts:169-172`），接口+descriptor 与 `IObsidianVaultService` 同形（`knowledgeIndex.ts:38-41`、`knowledgeQuery.ts:44-47`），经 `ServiceCollection.register` 注册、`exposeOnChannelServer` 自动暴露为 RPC channel；dispose 记入 node.ts 既有 `sharedSqliteRepos` 关闭链。`prepareEvidence`/`resolveCitation` 不在本阶段接口面（W03，接口 docstring 注明）。
2. **SourceRegistry 仅由活动 Vault + Profile 推导；epoch 失效** —— 完成。每次 RPC 入口 `resolveKnowledgeSource`（`sourceRegistry.ts:62-121`）重读 `vault-config.json`；指纹变化 → epoch+1 + 旧缓存清除；检索侧 (vaultId, epoch) 对比较使旧 run `source_stale`（`queryOrchestrator.ts:203-213`）；同协调者内源切换使进行中 job `superseded`（`indexCoordinator.ts:157-175`）。
3. **SQLite WAL + migration + FTS rowid + 短事务；多 Host lease/fencing 与崩溃恢复** —— 完成。WAL/busy_timeout/migration v1/FTS5 rowid=chunks.id；写路径全部 BEGIN IMMEDIATE 短事务且事务内 fence 校验；A05 测试以两个真实 OS 进程验证：持锁拒绝→旧 fence 写拒绝→SIGKILL 硬杀→TTL 接管（fence 提升）→`wal_checkpoint(TRUNCATE)`+integrity ok。索引只写本库缓存行，不触及审核账本（账本 W06 才存在）。
4. **只索引安全门面 Markdown；排除隐藏/软链/超配额；chunk 带 heading/quote selector/sha；增删改/重命名/漏事件 reconcile/partial** —— 完成。扫描器与门面同规则；内容一律经 `createVaultFileSystem(root).readFile`（逐段 lstat + 2MB + sha256 同面板）；排除按原因计数，任一非零 → `partial=true`；reconcile 全量扫描对账天然覆盖漏事件；测试见 §2.1 A02–A04。
5. **中文 bigram、英文 BM25、严格 MATCH 参数化；Embedding 端口 + semantic_unavailable** —— 完成。FTS5 unicode61 + `bm25()`；MATCH 表达式三重防线（词元形状不可含语法字符 → 引号转义 → 表达式形状正则守卫）；无端口时诊断显式 `semantic_unavailable`（reason `port_not_configured`），词法照常返回；测试注入确定性端口验证 applied + 重排生效。
6. **候选按 scope/sourceEpoch/runGeneration 隔离，去重聚合；不开放范围/日期扩展参数** —— 完成。检索 SQL 硬过滤 (vaultId, sourceEpoch)；结果按 run 代数丢弃迟到覆盖；createRun 入参只有 query+clientRequestId(+sessionId)，无任何日期/路径/范围参数。

### 1.3 实际调用链（关键路径）

- 索引：RPC `startReconcile` → `knowledgeServices.requireSource`（loadVaultConfig）→ `IndexCoordinator.startJob`（acquireIndexLease → insertJob → 异步 runJob）→ `scanVaultSource`（门面不变量+排除计数）→ 差异对账 → 每文档 `db.transaction(verifyLeaseInsideTransaction → replaceDocumentInTransaction)` → chunks 与 `chunks_fts(rowid)` 同事务 → `saveCoverageInTransaction` → job 终态 → `releaseIndexLease`。
- 检索：RPC `createRun` → `resolveKnowledgeSource`（绑定 epoch）→ `search` → 再 resolve（验证 (vaultId,epoch)）→ `searchKnowledgeLexical` → `buildMatchExpression`（严格转义）→ `WHERE chunks_fts MATCH ? AND d.vault_id=? AND d.source_epoch=?` → bm25 排序 → 文章聚合（±语义端口余弦重排）→ run 落定（代数守卫）→ `onRunUpdated` 事件。

## 2. 测试

| 命令/场景 | 环境 | exit code | 证据 |
| --- | --- | ---: | --- |
| `node scripts/check-workspace-freshness.mjs` | worktree 根，node v24.1.0 / win32 | **0** | `基线新鲜：feat/vaultview-impl，相对 origin/main：ahead 332 / behind 0` |
| `node --import tsx --test packages/services/test/knowledgeChunkerTokenizer.test.ts` | 同上 | **0** | 9 pass / 0 fail |
| `node --import tsx --test packages/services/test/knowledgeIndexQuery.test.ts` | 同上 | **0** | 10 pass / 0 fail（A02/A03/A04/切库/撤权/混搜/注入/semantic/run/rebuild） |
| `node --import tsx --test packages/services/test/knowledgeLeaseFencing.test.ts` | 同上 | **0** | 2 pass / 0 fail（含真实子进程硬杀接管，A05 用例 1181ms） |
| 三文件联合 `node --import tsx --test <三个文件>` | 同上 | **0** | `tests 21 / pass 21 / fail 0 / cancelled 0 / skipped 0` |
| `npx tsc -b packages/rpc packages/shared packages/services`（定向，开发中多轮） | 同上 | **0** | 无输出 |
| `pnpm typecheck`（仓库全量） | 同上 | **0** | 无错误（期间发现并修复一次本工作单引入的 `ObsidianVaultRenameInput` 导出缺失，见 §5 偏差 7） |
| `npx oxlint <本工作单新增/改动文件>` | 同上 | **0** | `Found 0 warnings and 0 errors`（node.ts 4 条 no-unused-vars 为存量，stash 对照确认） |
| `pnpm lint`（仓库全量） | 同上 | **0** | `Found 387 warnings and 0 errors`（warnings 为存量面） |
| `pnpm architecture:check --changed` | 同上 | **0** | `architecture: OK / violations: 0 / baseline: 0 / new: 0` |
| `git diff --check` | 同上 | **0** | 无空白错误 |
| `npx oxfmt --check <新增文件>` | 同上 | **1** | **如实报告**：新增文件与存量文件（`packages/services/src/obsidian-vault`、`collection.ts` 同样 exit 1）均不过 oxfmt——本仓 oxfmt 未强制（`verify:pre-push` = lint + architecture:check，`package.json:19`），未做格式化改写以免与存量风格撕裂 |
| 全量 `node --test` / 既有失败基线三文件 | — | **未执行** | 按交接验证分工由统一脚本执行；`desktopRendererPlatformMobileFace.test.ts`、`computerUseSettingsNavigation.test.ts`、`nonCliAcpRetirement.test.ts` 为既有失败，本工作单未触碰、不代跑 |
| `pnpm fmt:check`（仓库全量） | — | **未执行** | 同上属统一脚本范围；本会话只在新增文件范围探测（见上），未全仓改写格式 |

### 2.1 场景 → 用例映射（`knowledgeIndexQuery.test.ts` / `knowledgeLeaseFencing.test.ts`）

| 验收 ID | 场景 | 用例与断言要点 |
| --- | --- | --- |
| A02 | 新增 10 个 MD → coverage 准确 | 「A02」：indexedFiles=10、partial=false、epoch=1、semantic=unavailable |
| A03 | 修改/删除/重命名 → 旧 chunk 不可信 | 「A03」：改写后旧标记 AND+OR 均无命中（status empty）；删除后同；重命名后旧路径无候选、新路径命中 |
| A04 | 隐藏/软链/超限/深度/非 md → 排除+partial | 「A04」：`.hidden`+`.obsidian`=hidden 2、非 md 1、超 2MB 1、深度 17 层 ≥1、软链文件（POSIX）或 junction 目录（Windows 回退）≥1、partial=true；隐藏内容零命中 |
| A05 | 双 Host 写竞争、旧 fence 拒绝、重启恢复 | 「A05（子进程）」：Host B 持租约 → Host A startJob 抛“租约被其他 Host 持有”；Host A 以旧 fence 写事务 → `KnowledgeLeaseLostError`；`SIGKILL` 硬杀 B → TTL 未过仍拒绝（死者租约拒人）→ TTL 过后 A 接管 fence 提升且任务 completed、`wal_checkpoint(TRUNCATE)`+integrity ok。「store 级 fencing」：续期/接管 epoch 单调、旧持有者心跳被拒、迟到写事务回滚（stale 行不存在） |
| A06/A10 | 找回与不编造 | 「中英混搜+负例」：中文 bigram（上下文窗口/单字 prefix 窗）、英文（memory system）、混搜（窗口 context）均命中；库中不存在的观点（长期记忆不能替代）→ empty 且 0 候选；候选带 quote selector 行号/偏移 + file/chunk sha256 + `evidenceStatus=unverified` |
| A13（W02 部分） | 切库/撤权使旧 run 失效 | 「切库」：切库后 getStatus 指向新 vaultId、旧缓存 indexedFiles=0、旧 run search → `source_stale`；「撤权」：配置移除 → 旧 run `source_stale`、新 run `no_source`、startReconcile 明确拒绝、getStatus configured=false；重新授权同根 → epoch 递增、旧 run 仍 stale |
| A11（W02 部分） | 至多一次扩搜 | AND 无命中且 tokenCount>1 → 同规则 OR 降级恰一次（`matchRelaxedToOr` 诊断位）；单 token 不降级 |
| K-IDX（spec §6） | 上列各项 | spec §5b.7 已回填证据指针 |

## 3. 评估和安全

- **Source 权限与数据出站检查**：索引/检索只读活动 Vault（内容经面板同一安全门面读取，逐段 lstat 拒软链、≤2MB）；Embedding 端口默认不注入 = 零出站，端口实现自带出站授权责任（ADR #11 未放宽）；测试用确定性假端口，无任何真实模型/网络调用。日志只写 jobId/counts/时长等元数据（`createServiceLogger`），无笔记全文/绝对路径/凭据。
- **跨 Host / Runtime admission / 队列**：A05 以两个真实 OS 进程验证租约互斥、fencing 写拒绝、硬杀后 TTL 接管（W00 spike 进程模型）。如实声明边界：真实 Electron 双窗口（连接同进程/异进程粒度）未复测——W00 spike §3 已论证该判断点独立于本实现；lease 是第二道防线，Host 存活/路由仍归既有 owner/lease 机制。Query 侧 `runGeneration+seq` 防迟到覆盖已实现并有事件测试；CommandInbox admission 复验（A17）属 W03。
- **Jev 真联调与数据集结果**：本工作单未涉及（默认关闭，符合 ADR #5/#11）；A07 检索质量门槛（简繁/同义词/Recall@30）归 W05 数据集评测——bigram 不做简繁字形折叠，此处如实声明。
- **报告已使用的模拟/Fixture 与未验证部分**：① 假 Embedding 端口（确定性向量）用于验证端口机制与重排，不声称任何真实语义效果；② 全部测试使用 `mkdtemp` 合成 Vault；③ **未验证**：`excludedOverQuota` 计数未被任何测试触发（需 >5000 文件，未构造；该计数与其他排除计数同一条代码路径）；Electron main 内本服务的真实装配启动（node:sqlite 在 Electron 41 main 已由 W00 spike probe 验证可用，但 `createLocalServices` 全链未在 Electron 内启动）；移动端/Web 远程链路上的表现；中文 bigram 的检索质量指标（归 W05）。

## 4. 结果与门槛

- **通过的验收 ID**（本会话真实执行证据）：A02、A03、A04、A05、A06（本地检索部分）、A10（负例不编造）、A11（扩搜上限的 W02 部分）、A13（切库/撤权失效的 W02 部分，Receipt 侧属 W03）；spec §6 K-IDX 行已回填。
- **未通过/有条件通过**：A07（检索质量）**未测**——归 W05 数据集门槛，不由本阶段声称；A16–A19（真实 Session/admission）归 W03；配额 5000 文件级 service 级 E2E 未构造（§3 未验证①）。
- **GO/NO-GO**：W02 范围 **GO**——工作单 6 项全部落地，22 项新增测试全绿，全量 typecheck/lint/architecture:check 真实通过。不得外推的宣传边界：本地检索可用 ≠ 问答可用（无模型/断网行为属 W03/W04 面）；`semantic_unavailable` 是当前默认状态（无端口注入）。
- **回滚步骤**：`git checkout 0d543db0 -- specs/obsidian-knowledge.md packages/services/src/node.ts packages/services/src/index.ts packages/shared/src/channels.ts`，并删除 `packages/services/src/knowledge/` 与 `packages/services/test/knowledge*.ts`、`knowledgeLeaseChild.mjs` 及本报告。无数据库迁移产物（库文件在 Profile 数据根内，属可重建缓存，可直接删除）。
- **下一阶段建议**：① W03 Receipt 绑定可直接消费本阶段的 quote selector（行号+字符偏移）与 file/chunk sha256；② Query 事件已带 runGeneration+seq，W04 UI 订阅 `onRunUpdated` 时按代数丢弃即可；③ 建议统一脚本跑 Electron main 冒烟确认 `createLocalServices` 装配（本服务惰性开库，启动期不触磁盘）；④ 5000 文件配额与 `excludedOverQuota` 计数建议在 W07 稳定性阶段补构造性测试。

## 5. 与工作单假设的偏差记录

1. **Profile = Drora 数据根**：ADR #9 的"Profile"在本仓无独立 profile 实体，按真实仓库映射为 `getDataBaseDir()` 数据根（DB 落 `<数据根>/.drora/knowledge/knowledge-index.sqlite`，`sourceRegistry.ts:54-56`）；源隔离在库内按 (vaultId, epoch) 完成。测试经 `setDataBaseDir` 隔离。
2. **sourceEpoch 是 vault 内计数**：`sources` 表按 vaultId 主键，epoch 在同一 vaultId 内单调递增；换库后新 vault 从 1 起。因此旧 run 失效判定必须比较 (vaultId, epoch) 二元组（开发中发现仅比 epoch 会在 A→B 切库时漏判，已修复并有测试锁定）。
3. **撤权的语义映射**：本仓没有独立的"Knowledge 源授权"开关（不得发明第二份配置事实源），"撤权"= vault-config.json 失效/移除（与面板"未配置"同语义）；`allowAgentWrites` 翻转**不**换 epoch（它门控 Agent 写入，不改变读取范围——读操作不受限是既有 spec 语义）。
4. **Query RPC 面收窄**：交接包 `RPC_AND_STATE_CONTRACTS.md` 草案中的 `prepareEvidence/resolveCitation` 属 W03（EvidenceReceipt），本阶段不实现也不伪装；`intentOverride` 未纳入 W02 入参（决策引擎属后续阶段），接口以结构化注释声明扩展点。
5. **OR 降级是检索语义的一部分**：AND 无命中且多词元时同规则 OR 扩搜恰一次（工作单 6"至多一次扩搜"与 A11 的本地实现）。副作用是负例探测必须用独占词元——三个开发中用例据此修正（这不是产品缺陷，是召回/精度取舍，已在诊断位 `matchRelaxedToOr` 暴露）。
6. **新依赖面 node:sqlite**：仓库此前零 SQLite 依赖（W00 spike §0 风险面结论适用）。node 24.1 加载时会打印 ExperimentalWarning（无害）；Electron 41 main 可用性由 W00 spike 实测（SQLite 3.51.2 vs CLI 3.49.1 跨运行时版本混用，WAL 前向兼容）。
7. **修复了一处本工作单引入的回归**：编辑 `packages/services/src/index.ts` 导出块时误删了存量 `ObsidianVaultRenameInput` 导出，全量 typecheck 捕获（`packages/ui/src/v4/vault/vault-title-commit.ts:3` 报错），已恢复并重跑 `pnpm typecheck` exit 0。
8. **DB 连接惰性化**：`createLocalServices` 无条件装配本服务，为避免环境问题在启动期炸掉整个服务集合，SQLite 连接延迟到首次真实使用才建文件（`knowledgeDatabase.ts:53` getter）；代价是磁盘/权限故障在首次索引/检索时才暴露（结构化错误呈现）。
9. **测试风格**：按交接纪律沿用仓库 node:test + tsx 形态（与 `packages/services/test/importedClaudeRecovery.test.ts` 同款相对导入）。
