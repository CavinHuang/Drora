# W05 阶段交付报告（W05_DELIVERY）

**工作单：** W05 — Jev 多阶段决策与实测 A/B　**日期：** 2026-10-10　**实现分支：** `feat/vaultview-impl`　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`（本工作单开工时 HEAD 为 `92c8a719`，即基线 + W00–W04 提交；本工作单改动未提交，按纪律由脚本统一提交）

> 路径约定：`path:line` 相对实施工作树根 `D:/workspace/projects/Drora-vaultview-handoff/`（行号为成稿时状态）。
> 诚实声明：下表所有命令均为本会话在实施工作树实际执行，退出码为真实值；未执行的验证逐项写明原因。本工作单未做 git add/commit/push。测试全部使用 `mkdtemp` 合成临时 Vault，未触碰用户真实 Vault；日志与诊断不写笔记全文/凭据/绝对路径（adapter/transport 打桩用 Key 仅存在于测试进程内）。
> **核心结论：Jev 决策层与离线评测框架全部落地且默认关闭；真实 TypeSafe 出站联调（A24）与真实人工标注集 A/B（A28）因缺凭据/标注集未实测——不存在任何"实测改善"声明。**

## 1. 完成内容与真实代码证据

### 1.1 文件清单（`git status --short` 实测：7 个修改 + 3 个新增源码路径 + 4 个新增测试）

| 文件 | 改动 | 作用 |
| --- | --- | --- |
| `specs/obsidian-knowledge.md` | 修订 | 新增「§5d Jev 多阶段决策与离线评测（W05，2026-10-10 落地）」九个小节：§5d.1 模块构成与默认关闭、§5d.2 状态所有者补表、§5d.3 TypeSafe 契约（真实文档验证记录）、§5d.4 P0 合并决策、§5d.5 本地 DecisionPolicy 五动作、§5d.6 授权绑定与 run 诊断、§5d.7 降级与竞态、§5d.8 离线评测框架、§5d.9 验收映射；§0 范围行与 §6 K-JEV 行回填状态 |
| `packages/services/src/knowledge/decision/decisionTypes.ts` | 新增 | 决策层契约单一出处：`KnowledgeDecisionProvider` 端口、候选/请求/结果 DTO、五动作 `KnowledgeDecisionAction`、fallback reason 词表、consent 判别式、run 诊断 `KnowledgeDecisionDiagnostics`、policy 配置 |
| `packages/services/src/knowledge/decision/decisionPolicy.ts` | 新增 | 本地 DecisionPolicy 纯函数：五动作裁决（EXPAND_ONCE 先于空候选终态，否则不可达）、名次归一、单调融合 `0.35×local+0.65×noul`、queryHash 规范化；`DECISION_POLICY_VERSION` 钉缓存键 |
| `packages/services/src/knowledge/decision/decisionConsent.ts` | 新增 | Host 内存授权账本：grant/revoke/get + `verifyBinding`（阶段门）+ `verify`（**逐调用**重查，fail-closed）；绑定 provider/vaultId/sourceEpoch/queryHash/candidateHashes/TTL |
| `packages/services/src/knowledge/decision/jevTransport.ts` | 新增 | `JevTransport` 端口 + 默认 `createTypeSafeHttpTransport`（POST `{baseURL}/v1/systemone`、`Authorization: Bearer`、缺 Key 构造即抛错）；API Key 只在 Host 侧注入 |
| `packages/services/src/knowledge/decision/jevAdapter.ts` | 新增 | JevAdapter：P0 每**候选恰好一次** systemOne Noul 出站（单条合并问题承载相关性+直接证据，`mergedNoulQuestion`）；并发池/单调用 3s 超时/阶段 6s 预算/429·529 短退避一次；非法评分（NaN/出界/缺类型）→ `invalid_score`；取消 → 在途中止 + 未发起候选补齐 `cancelled` |
| `packages/services/src/knowledge/decision/localFallback.ts` | 新增 | LocalFallback：全部候选 `status:"fallback"`、保持本地名次、零出站——任何关闭/未授权/失败路径的确定性落点 |
| `packages/services/src/knowledge/decision/decisionCache.ts` | 新增 | 进程内 LRU 决策缓存：键 = sha256(provider\|model\|policyVersion\|vault\|epoch\|queryHash\|chunkSha)，按谓词失效（撤权/换源） |
| `packages/services/src/knowledge/decision/decisionTelemetry.ts` | 新增 | 出站计数/回退分桶/延迟样本/token 用量（服务生命周期累计；不落任何内容）；`outboundCountTotal` 是 A23 断言面 |
| `packages/services/src/knowledge/decision/decisionPipeline.ts` | 新增 | 决策管线：授权门 → 缓存分层（命中不计出站）→ provider → 结果校验（未知候选 ID 丢弃计 `unknown_candidate`，合法 scored 才入缓存）→ 回退补齐 → policy 五动作/融合 → 诊断与 telemetry |
| `packages/services/src/knowledge/query/queryDecisionBridge.ts` | 新增 | 编排器拆分出的纯辅助：run 候选→决策候选映射（名次归一）、融合重排（只改 rank 不改事实，A26）、`grantDecisionConsentForRun`（绑定 run 事实授予） |
| `packages/services/src/knowledge/eval/evaluationMetrics.ts` | 新增 | 纯指标：Recall@K / Hit@K / MRR / No-answer FP 判定 / chunk 级 Evidence Precision / nearest-rank P50·P95 / 非 null 均值（标注缺失不进分母） |
| `packages/services/src/knowledge/eval/evaluationHarness.ts` | 新增 | A/B harness：走真实 `createKnowledgeServices` 检索路径，对比 lexical / hybrid / hybrid+jev（任意 provider 可注入）；每 run 记录宣布/名次/延迟/出站；top-1 引用经 `prepareEvidence→resolveCitation` 核验（citation support）；成本代理（outbound/tokens/cacheHits） |
| `packages/services/src/knowledge/query/queryOrchestrator.ts` | 修订 | ① `search` 重构：`searchLexicalPass` AND 轮 → policy 裁决 EXPAND_ONCE → 至多一次 OR 轮（A11）→ 决策阶段（默认 off）→ 融合重排 → 阶段后源重验；② 新增**决策补跑**：已落定 run 携带 `decisionConsentId` 再检索 = 只补跑决策（「本地候选先显示→授权→Jev 优化排序」的服务端形态）；③ `cancelRun` 支持中止进行中的补跑（刷新不落定、本地候选保留）；④ run 视图新增 `decision` 诊断字段；⑤ grant/revoke RPC 实现 |
| `packages/services/src/knowledge/search/lexicalRetriever.ts` | 修订 | 拆出单轮 `searchLexicalPass`（relaxed 显式化、附 tokenCount）；`searchKnowledgeLexical` 复合入口保持 W02 行为（既有调用方/评测基线不受影响） |
| `packages/services/src/knowledge/knowledgeQuery.ts` | 修订 | RPC 面 additive：`KnowledgeSearchParams.decisionConsentId?`、`grantDecisionConsent`、`revokeDecisionConsent`（channel 仍为 `knowledge-query`，不新增频道） |
| `packages/services/src/knowledge/knowledgeTypes.ts` | 修订 | `KnowledgeRunView.decision`（nullable，RPC additive）；决策类型 re-export（单一出处仍是 decision/decisionTypes） |
| `packages/services/src/knowledge/knowledgeServices.ts` | 修订 | 装配：`decisionProvider?`（简单注入）+ `decisionProviderFactory?`（**出站 provider 必须走工厂**拿到服务自有授权账本，否则逐调用重查 fail-closed 失效）；管线/缓存/telemetry 恒装配（provider 为 null → off 分支）；`KnowledgeServices.decision` 句柄（**不挂 queryService**——ProxyChannel 会把一切函数属性暴露为 RPC 命令）；生产调用点 `node.ts` 不注入 provider = 默认关闭 |
| `packages/services/src/index.ts` / `node.ts` | 修订 | 纯类型经 index 导出（含 decision 诊断/授权类型）；实现经 node 导出（adapter/transport/localFallback/consent/cache/telemetry/pipeline/policy/eval harness） |
| `packages/services/test/knowledgeDecisionPolicy.test.ts` | 新增 | 14 用例：五动作、扩搜一次上限、Jev 不可越权、融合单调、阈值可配置、queryHash、缓存键/LRU/失效、telemetry、LocalFallback |
| `packages/services/test/knowledgeJevAdapter.test.ts` | 新增 | 15 用例：请求形状（每候选一次、官方字段、凭证不进请求对象）、429/529 退避、5xx/4xx/空体/缺答案、非法评分四态、授权逐调用重查/范围/过期/缺失、取消、超时、截断、**本地 http 假服务器逐字段断言线格式**（`/v1/systemone` + Bearer + `{state,model,questions}`） |
| `packages/services/test/knowledgeDecisionPipeline.test.ts` | 新增 | 10 用例（真实服务集成）：A23 默认关闭零出站、授权→补跑融合（A26 事实不变）、缓存命中/撤权失效、授权跨 run 不可用、A27 无答案负样本、A25 provider 抛错回退、取消/迟到丢弃、换源失效、JevAdapter 工厂接入、**未走工厂的 fail-closed 验证** |
| `packages/services/test/knowledgeEvaluationHarness.test.ts` | 新增 | 4 用例：指标手算校验；合成脱敏中文试点集（6 query × 4 篇合成笔记）三变体（lexical/hybrid/hybrid+jev）；oracle 注入验证融合确实改变排序；缓存重跑零出站 |

### 1.2 逐项完成状态（对照工作单 6 项）

1. **独立 DecisionProvider / LocalFallback / JevAdapter；TypeSafe 文档验证；凭证仅安全配置** —— 完成。端口与实现见 §1.1；TypeSafe 契约按**当日真实文档**验证（证据见 §3），未从 Python 示例猜接口（Python cookbook 的 `system_one` 与 JS SDK 的 `systemOne`、HTTP 的 `POST /v1/systemone` 已双向核对一致）。凭证只在 Host 侧构造 transport 时注入（`jevTransport.ts:88-90` 缺 Key 构造即抛错），RPC 面无凭证。
2. **P0 合并相关性与直接证据判断；不固定连跑 9 次** —— 完成。每候选恰好一次出站、单条 Noul 问题合并判定（`jevAdapter.ts` `mergedNoulQuestion`）；测试断言两候选恰好 2 次请求（`knowledgeJevAdapter.test.ts`「请求形状」用例）。意图歧义/充分性/引用支持**不在 P0 触发远端决策**：意图走 UI 既有启发式、充分性走本地阈值、引用支持走 Receipt 复验（spec §5d.4 固化）。
3. **本地 DecisionPolicy 五动作；扩搜最多一次** —— 完成。`decisionPolicy.ts:66-131`；EXPAND_ONCE 由 policy 真实执行（编排器据 `shouldExpand` 跑 OR 轮，`queryOrchestrator.ts:150-161`）；PREPARE_EVIDENCE_FOR_AGENT 仅建议、不自动签发 receipt；NO_RELIABLE_MATCH 优先于任何 Jev 分数。测试锁定（policy 14 用例 + pipeline 集成）。
4. **权限绑定 provider/source/epoch/queryHash/candidateHash；实际调用前重查** —— 完成。授权账本 `decisionConsent.ts`；管线阶段门（`decisionPipeline.ts:97-113`）+ JevAdapter **逐调用**重查（`jevAdapter.ts:157-176`）；跨 run 授权（不同 queryHash）→ denied（pipeline 测试）；撤销后未开始候选不出站（adapter 测试）。远端 Embedding（`embeddingPort` 独立注入）与回答模型（既有 Agent 会话）授权各自独立，决策授权不复用（spec §5d.1）。
5. **超时/429/5xx/取消/非法评分/未知候选 ID/换源本地回退；迟到响应不覆盖新 Query；缓存按版本失效** —— 完成。逐项测试见 §2.2；缓存键含 model/policy/内容（chunkSha）版本，epoch 变化换键、撤权清条目（pipeline 测试「缓存」用例）；迟到丢弃由 runGeneration + 阶段后 epoch 重验双重保证。
6. **真实脱敏标注集评估 Lexical/Hybrid/Hybrid+Jev/Reranker，指标齐全** —— **框架完成，实测未做**。harness 支持四变体（provider 可注入即支持专用 reranker）；指标 Recall@30/Hit@1/5/MRR/No-answer FP/Evidence Precision/Citation support/P50·P95/成本全部实现并被手算用例锁定。缺真实人工标注集与凭据，本阶段仅有合成试点集（测试 fixture），**不得声称任何指标改善**（A28 未实测，见 §3）。

### 1.3 实际调用链（关键路径）

- 默认关闭（生产现状）：UI 智能问库提交 → `createRun`→`search` → AND 轮 → policy（本地）→ pipeline `runStage`（provider=null → `off` 分支，`decisionPipeline.ts:87-110`，`outboundCount=0`）→ run 落定带 `decision:{status:"off",reason:"disabled_no_provider"}`。UI 的「未启用（Jev 关闭）」提示（W04）与真实状态一致。
- Jev 开启后（需 Host 注入 provider 工厂 + 用户逐 query 授权）：`search`（本地落定，首轮 stage=`denied/consent_missing`，零出站）→ UI 应展示候选并请求授权 → `grantDecisionConsent({runId})`（绑定 vaultId/epoch/queryHash/chunkSha 集合，TTL 60s）→ `search({runId, decisionConsentId})` 决策补跑 → 管线门 `verifyBinding` → adapter 逐候选 `verify` → TypeSafe `POST /v1/systemone` → 校验/缓存/融合 → 重排落定。
- 取消/竞态：补跑期间 `cancelRun` → 提升代数 + abort → `applyResult` 代数守卫丢弃刷新（`queryOrchestrator.ts:302-309`）；换源 → 阶段后 `sourceChangedSince` → `source_stale`。

## 2. 测试

| 命令/场景 | 环境 | exit code | 证据 |
| --- | --- | ---: | --- |
| `node scripts/check-workspace-freshness.mjs` | worktree 根，node v24.1.0 / win32 | **0** | 基线新鲜（ahead 335 / behind 0，无远端跟踪分支提示为既有状态） |
| `node --import tsx --test packages/services/test/knowledgeDecisionPolicy.test.ts` | 同上 | **0** | tests 14 / pass 14 / fail 0 |
| `node --import tsx --test packages/services/test/knowledgeJevAdapter.test.ts` | 同上 | **0** | tests 15 / pass 15 / fail 0 |
| `node --import tsx --test packages/services/test/knowledgeDecisionPipeline.test.ts` | 同上 | **0** | tests 10 / pass 10 / fail 0（开发中修正 3 处用例预期：无 provider 时伪授权走 off 分支而非 denied（off 先于授权门，行为正确）；已落定 run 的取消语义按 W04「保留上一轮结果」收敛；首轮已注入 provider 时 stage 为 denied/consent_missing 而非 off——均为语义澄清，非缺陷） |
| `node --import tsx --test packages/services/test/knowledgeEvaluationHarness.test.ts` | 同上 | **0** | tests 4 / pass 4 / fail 0（开发中修正 2 处：telemetry 为服务生命周期累计口径（快照语义，改用逐 run `decisionOutboundCount` 断言）；harness 增加 `requestIdPrefix` 防多次评测被 createRun 幂等吞掉） |
| 十文件联合回归（W02+W03+W04+W05 全部 knowledge 测试）：`node --import tsx --test packages/services/test/knowledgeDecisionPolicy.test.ts packages/services/test/knowledgeJevAdapter.test.ts packages/services/test/knowledgeDecisionPipeline.test.ts packages/services/test/knowledgeEvaluationHarness.test.ts packages/services/test/knowledgeIndexQuery.test.ts packages/services/test/knowledgeChunkerTokenizer.test.ts packages/services/test/knowledgeLeaseFencing.test.ts packages/services/test/knowledgeEvidence.test.ts packages/services/test/knowledgeAskUiFlow.test.ts packages/ui/test/knowledgeAskModel.test.ts` | 同上 | **0** | tests 84 / pass 84 / fail 0 |
| `pnpm typecheck`（仓库全量） | 同上 | **0** | 无错误 |
| `pnpm lint`（仓库全量） | 同上 | **0** | `Found 387 warnings and 0 errors`（与 W02/W04 交付记录的存量基线同值，零新增）；开发中曾出现 1 error（queryOrchestrator 超 max-lines 434>400）→ 已拆出 `queryDecisionBridge.ts` 修复并复测通过 |
| `npx oxlint packages/services/src/knowledge packages/services/test`（定向，全部新增/改动文件） | 同上 | **0** | `Found 0 warnings and 0 errors` |
| `pnpm architecture:check --changed` | 同上 | **0** | `architecture: OK / violations: 0 / baseline: 0 / new: 0` |
| `git diff --check` | 同上 | **0** | 无空白错误（CRLF 提示为 autocrlf 既有行为） |
| **A24 真实 TypeSafe 出站请求（非私密合成文本）** | — | **未执行** | 原因：环境无 TYPESAFE_API_KEY 凭据（交接包与工作树均无安全配置）。替代证据：默认 HTTP transport 对本地 `node:http` 假服务器做了**逐字段线格式断言**（路径/鉴权头/请求体三键/响应解析，adapter 测试「默认 HTTP transport」用例）。真实联调待用户提供 Key 后按 §4 演示路径执行 |
| **A28 真实人工标注中文集 A/B** | — | **未执行** | 原因：无真实脱敏人工标注集（EVAL_DATASET_SPEC 要求双人标注+仲裁）。已交付 harness + 合成试点集；合成数字只证明框架计算正确 |
| 全量 `node --test` / 既有失败基线三文件 | — | **未执行** | 按交接验证分工由统一脚本执行；`desktopRendererPlatformMobileFace.test.ts`、`computerUseSettingsNavigation.test.ts`、`nonCliAcpRetirement.test.ts` 为既有失败基线，本工作单未触碰 |

### 2.2 场景 → 用例映射（验收 ID）

| 验收 ID | 场景 | 用例与断言要点 |
| --- | --- | --- |
| A23 | 默认关闭/拒绝 → 零出站 | pipeline「A23」：run.decision=`{off,disabled_no_provider,outboundCount:0}`、grant disabled、telemetry 0；关闭态伪授权仍 off |
| A24 | 真实 Noul 请求 | **未实测（缺凭据）**；线格式由本地假服务器用例锁定（§2 表「未执行」行） |
| A25 | 429/5xx/timeout/NaN/未知 ID → 保留本地候选+降级 | adapter 8 用例 + pipeline「A25 provider 抛错」：单候选/整阶段回退、reason 分桶、本地候选完整 |
| A26 | 重排不改已选事实；迟到响应丢弃 | pipeline「授权 → 决策补跑」（articleId 集合与事实字段 deepEqual 相等）+「取消/迟到丢弃」（刷新不落定、本地候选保留、decision ≠ applied）；UI 选中锚点由 W04 reducer 按 articleId 保持（本阶段未改 UI） |
| A27 | 无答案负样本不强选 | policy 用例（空候选 NO_RELIABLE_MATCH 不可被 0.99 高分翻案）+ pipeline「A27」（无候选拒授权、零出站）+ harness q5/q6（宣布口径） |
| A28 | 真实标注集 A/B | **未实测（缺标注集）**；harness 用例以 oracle 注入验证融合数学与指标口径 |
| A11 | 扩搜上限一次 | policy「A11 扩搜上限一次」（EXPAND_ONCE→expanded 后不再建议）+ 既有 OR 降级回归（W02 用例 84/84 内） |
| A35 | 决策出站独立授权、日志无全文/凭据 | adapter 授权四态用例 + 凭证不进请求对象断言 + 诊断 reason 词表不含内容 |
| J09 | 缓存隔离 | policy 缓存键七分量用例 + pipeline 缓存/撤权失效用例 + harness 重跑零出站 |

## 3. 评估和安全

- **Source 权限与数据出站检查**：默认关闭是结构性的——生产装配（`node.ts` 调 `createKnowledgeServices()` 不带 decision 参数）不注入 provider，授权账本空，`grantDecisionConsent` 恒 disabled，**不存在可被数据触发的出站路径**。授权绑定五元组（provider/vault/epoch/queryHash/candidateHash）+ TTL + 逐调用重查 fail-closed；adapter 未走工厂（账本实例不一致）时逐调用重查必然失败，该失效模式本身有测试锁定（pipeline「未走工厂」用例）。出站内容最小化：state 仅 `{query, note_excerpt, title}`（有界 excerpt ≤240 字符），无绝对路径/凭据/其他会话历史。
- **TypeSafe 契约验证记录（2026-10-10 本会话抓取）**：HTTP API `docs.typesafe.ai/api.md`——`POST {baseURL}/v1/systemone`、`Authorization: Bearer`、请求 `{state, model, questions}`、noul 问题 `{type:"noul", instructions, criteria?{true,false}}`、响应 `{model, answers.<name>.{type,noul}, usage.{input_tokens,output_tokens}}`、错误 401/422/429（退避）/529（过载）；JS SDK `docs.typesafe.ai/sdk/javascript.md` + api 页——npm `@typesafe-ai/sdk`（Node 20+）、`new TypeSafeClient({apiKey, baseURL, timeout, maxRetries, fetch})`、`client.systemOne({state, questions, model?}, options?)`、`noul(instructions?, criteria?)` 辅助。Python cookbook（rerank_typesafe）仅为交叉印证，未据其猜接口。**未引入该 npm 依赖**（默认关闭的可选能力不增加硬依赖；SDK 形状与 HTTP 形状一致，切换 SDK 仅替换 transport 实现）——记录为有意分歧。
- **跨 Host / Runtime admission / 队列**：本阶段未改 Runtime/队列语义。决策授权是 Host 进程内存状态（不持久化，重启即失效重新询问）；提示词/injection 面零改动。
- **Jev 真联调与数据集结果**：均未实测（缺凭据/标注集）。合成试点集上的数字（harness 测试内）只用于锁定框架计算，**报告不引用其作为质量证据**。
- **报告已使用的模拟/Fixture 与未验证部分**：
  1. **真实出站未执行**（A24）：无 API Key。transport 线格式以本地 http 假服务器逐字段验证，真实延迟/费用/限流行为未知。
  2. **评测数字非真值**（A28）：合成脱敏 6 query 试点集由本会话构造，非人工双标注；stub embedding（bigram 哈希）与 oracle provider 仅验证管线数学。
  3. **UI 未接决策态**：工作单未要求 UI；W04 的「未启用」提示与现状一致。决策诊断（`run.decision`）已在 RPC 面就绪，UI 排序提示/授权对话框留待后续工作单。
  4. **默认 HTTP transport 未经真实网络验证**（代理/TLS/重试策略与官方 SDK 的 RetryPolicy 差异未比对）。
  5. `searchKnowledgeLexical` 复合入口保留但生产编排不再直接调用（评测基线与既有测试使用）；如后续无消费方可考虑收编（knip 不在本阶段门禁内，未跑）。

## 4. 结果与门槛

- **通过的验收 ID**（本会话真实执行证据）：A23、A25、A26（服务端语义；UI 锚点依赖 W04 现状）、A27、A11、A35、J09；A07 的工具面（harness 就绪）。
- **未通过/有条件通过**：A24 **未实测**（缺凭据；线格式已验证）；A28 **未实测**（缺人工标注集；框架已交付）；A26 的 UI 层（选中锚点）未在本阶段 GUI 验证（继承 W04 缺口，归 W07）。
- **GO/NO-GO**：W05 范围 **GO（有条件）**——决策层/评测框架/测试/spec 全部落地且默认关闭，84/84 knowledge 测试 + 全量 typecheck/lint/architecture 真实通过；宣传边界：不声称真实 Jev 改善、不声称引用支持率等指标值，功能对用户不可见直至显式开启。
- **回滚步骤**：`git checkout 92c8a719 -- specs/obsidian-knowledge.md packages/services/src/index.ts packages/services/src/node.ts packages/services/src/knowledge/knowledgeQuery.ts packages/services/src/knowledge/knowledgeServices.ts packages/services/src/knowledge/knowledgeTypes.ts packages/services/src/knowledge/query/queryOrchestrator.ts packages/services/src/knowledge/search/lexicalRetriever.ts`，并删除 `packages/services/src/knowledge/decision/`、`packages/services/src/knowledge/eval/`、`packages/services/src/knowledge/query/queryDecisionBridge.ts`、4 个 `knowledgeDecision*/knowledgeJev*/knowledgeEvaluation*` 测试文件及本报告。无 DB schema 迁移、无 vault-config 变更、无 UI/i18n 改动。
- **下一阶段建议**：① UI 接线（授权对话框 + 排序提示替换 W04 `jevOff` 静态文案 + Decision trace 展示 `run.decision`），遵守「重排不改已选焦点」；② 用户提供 TypeSafe Key 后按 §5 演示路径补 A24；③ 按 EVAL_DATASET_SPEC 建真实标注集后跑 A28（harness 已支持 `hybrid+reranker` 第四变体，注入替代 provider 即可）；④ W06/W07 复核 `searchKnowledgeLexical` 复合入口的消费情况。

## 5. 可验证演示路径

1. **默认关闭零出站（A23）**：`node --import tsx --test packages/services/test/knowledgeDecisionPipeline.test.ts` →「A23 默认关闭」用例（无凭据也可复跑）。
2. **线格式验证（A24 的替代证据）**：`node --import tsx --test packages/services/test/knowledgeJevAdapter.test.ts` →「默认 HTTP transport」用例。
3. **授权→重排→缓存 全链路**：同上 pipeline 文件「授权 → 决策补跑」「缓存」两用例（stub provider，无网络）。
4. **真实联调（待 Key）**：Host 装配处注入
   `decisionProviderFactory: ({consentRegistry}) => createJevAdapter({transport: createTypeSafeHttpTransport({apiKey, model: "jev-latest"}), consentRegistry, perCallTimeoutMs: 3000, stageBudgetMs: 6000, concurrency: 4, rateLimitRetries: 1, rateLimitBackoffMs: 250})`，
   然后走 `createRun → search → grantDecisionConsent → search({decisionConsentId})`，读取 `run.decision.{modelVersion,outboundCount,latencyMs}` 与 `services.decision.telemetry.snapshot()` 记录 SDK/model/耗时/消耗。

## 6. 与工作单假设的偏差记录

1. **未引入 `@typesafe-ai/sdk` npm 依赖**：工作单要求按真实 JS/HTTP 文档验证接口（已完成并记录 §3），但默认关闭的可选能力不值得硬依赖；面向自研 transport 端口编码，SDK 形状可后续直接替换。属有意分歧，spec §5d.3 已固化。
2. **出站 provider 必须经 `decisionProviderFactory` 注入**：首版允许直接注入 adapter 时发现其逐调用授权重查会落在与服务账本不同的实例上（fail-closed 失效）——已增加工厂注入形式并保留直接注入路径（供无出站的本地 stub/评测 reranker），「未走工厂」失效模式有测试锁定。
3. **已落定 run 的取消语义**：决策补跑期间 cancel 按代数丢弃刷新、**保留**本地候选（对齐 W04「取消不清空上一轮可用结果」），而非把已落定 run 改写为 cancelled——W05 工作单未定义此交互，按既有产品语义收敛，spec §5d.7 已固化。
4. **policy 裁决顺序修正（开发中发现）**：初版把「空候选 → NO_RELIABLE_MATCH」放在 EXPAND_ONCE 判定之前导致扩搜动作不可达（死代码）；单测暴露后修正为先判扩搜前提，spec §5d.5 同步修订。
5. **出站池规模**：JEV_DETAIL 建议池 Top 20–30，但 run 候选受 W02 检索 limit 约束（默认 5 篇文章级候选）；本阶段出站池 = run 候选 ∩ maxCandidates(20) 上限。生产池扩容（limit 提升）留给 UI 接线工作单决策，避免单方面改变 W02 候选数语义。
6. **telemetry 为服务生命周期累计口径**：`outboundCountTotal` 跨 run 累计（快照语义）；逐 run 出站以 `run.decision.outboundCount` 为准。A23 断言两者皆为零，语义无歧义。
