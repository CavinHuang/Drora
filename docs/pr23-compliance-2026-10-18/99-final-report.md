# PR #23 规范与完整性终审报告（2026-10-18）

- 被审对象：PR #23 全量实现（分支 `fix/pr23-review-round2`，即远端 `feat/obsidian-knowledge-e2e`）。
- 审查基线：提交态 HEAD `b7ac637aad3728cb93fc0e2836d46d8c4c47ce23`（合并基 `7ced6f898070eaae63822f4ae97d635c3dfb1567`，428 提交 / 158 文件 = 82 修改 + 76 新增）。全部代码结论取自提交态 `git show` / `git diff` / `git grep`；工作区存在 CRLF 幻影改动与未提交的 AGENTS.md 本地修订，未作为审查对象。
- 审查主题：规范符合性 + 功能完整性（bug 深猎已在既往两轮完成，本轮以规范为主、顺带记录发现的缺陷）。
- 审查配置：16 路独立审查员（见附录）+ 确定性门禁脚本 + 评审主席终审（本文）。

## 一、结论速览

| 判定 | 结论 |
| --- | --- |
| **规范符合度 conventionScore** | **较高**。核心纪律（架构边界 0 违规、安全不变量全 fail-closed、契约键主要族单一出处、上游对齐接缝记录、i18n 双语对齐、日志分级、异步 IO）在 158 文件面上整体成立；缺口集中在四个次级面：① spec/文档同步滞后（4 项行为改动无 spec 条款、RC 交付范围文档安全断言与装配相反、约 10 处陈旧注释）；② 契约字面量收口遗漏（vault-config.json ×3、knowledge-index.sqlite ×2、1 处生产源手写 manifest 表头）；③ 测试与 CI 接线（1 个已知红的生产者侧测试不在 CI、3 个新回归测试无 CI 通道、CI paths 触发清单缺口）；④ 3 文件 oxfmt 格式回归（CI 已声明 fmt 基线未定、暂不设门）。共 15 项 medium（去重后），无一触及安全旁路、凭据泄漏或跨层越权。 |
| **功能完整性 completenessScore** | **较高**。六大能力域对照 specs 承诺逐条核对：evidence 全链、L2 审核写入状态机、S03 双条件总门、完成态引用与回跳链、L0/L1 知识能力五域「规格承诺 → 实现 → 测试 → 三平台 CI」全部闭环（含真实 fork+SIGKILL 进程测试与真 Electron E2E）；缺口为边界态与交付面：未配置 Vault 的审核视图空态缺失（§5e.11 明文要求）、渲染层 inline 引用 [1-5] 与契约上限 8 层间不一致、E2E 验收矩阵 16+（实际 25）个交互用例无 E2E 且无自动化映射（文档已透明标注未执行）。 |
| **总判定 verdict** | **有条件达标**：功能完整性达到「规格承诺全部实现且有测试」的标准，规范符合度整体较高；但存在 **4 项合并前阻塞项**（见下），处理后可认定「实现符合项目规范、功能完整」。其余 11 项 medium 与 40 项 low 为跟踪债务，不构成阻塞。 |

**阻塞项（blockers）：**

1. **提交态存在已知红的生产者侧测试且位于 CI 盲区**——cli-p0-5 的 readOnly 旗标门控改变了 `ToolCallStarted` 载荷契约（`readOnly:false` 不再外发、改为省键），但既有测试未同步更新且无任何 CI 通道运行它，属「测试与实现不一致」被静默合入。证据：`apps/drora-cli/packages/core/src/tool/executor/permission-capability.ts:46-53`（`isTrustedReadOnlyTool(...) || undefined`）+ `write-tier-policy.ts:58`（`readOnly !== true → return false`，故解析后 readOnly=false 的内建工具也变 undefined）+ `events.ts:43`（undefined 时省键）→ `tests/tool-call-started-capability.test.ts:110、128` 的 `toMatchObject({readOnly:false})` 必然失败（复核员实跑 2 failed/1 passed；主席静态核验机制成立，本轮按指令未运行测试）；CI 仅跑 `core/test` 七个 node--test 文件（`.github/workflows/ci.yml:100-109`），`core/tests/` vitest 目录零执行。
2. **KnowledgeAnswerSources 违反 React Rules of Hooks（崩溃级潜在缺陷）**——early return 位于 useMemo 之前，同一挂载实例 citations 空↔非空翻转时 hooks 数量 2↔3 变化，渲染阶段抛 "Rendered more/fewer hooks" 崩溃组件树。证据：`packages/ui/src/v4/KnowledgeAnswerSources.tsx:30`（`if (citations.length === 0) return null;`）先于 `:34`（`React.useMemo`），其前已有 `useDroraIntl`(:28)/`useState`(:29) 两个 hook（主席亲验提交态；现有验收路径未触发，属静态确凿的潜伏缺陷，修复仅需把 early return 移到 useMemo 之后）。
3. **A1 交付范围文档的安全断言与实际装配相反**——`OBSIDIAN_RELEASE_CANDIDATE_SCOPE.md` 三处声称生产 `writeSafetyGatePassed` 保持 false 且「不得开启」，而提交态对 desktop-local 生产 Host 定向放行。证据：`docs/vaultview/delivery/OBSIDIAN_RELEASE_CANDIDATE_SCOPE.md:18、70`（grep 亲验）vs `packages/services/src/node.ts:2608` + `reviewReleasePolicy.ts:7-9`（仅 `desktop-local` 返回 true）+ `packages/desktop/src/host/index.ts:3042`（生产传 `"desktop-local"`）；specs/obsidian-knowledge.md §5e.12 已记录收尾复评放行决定，交付文档未同步（主席亲验三方证据链）。
4. **审核视图未配置 Vault 空态缺失，违反 §5e.11 明文要求**——未配置 Vault 时 `getSummary()` 正常 resolve null，视图却落入「永久加载」分支而非引导态，且该分支零测试。证据：`packages/ui/src/v4/vault/knowledge/KnowledgeReviewView.tsx:419-424`（`!loadFailed && !summary` → Loader2+statusLoading）+ `obsidianVaultService.ts:172-175`（config 为 null 时 resolve null）vs `specs/obsidian-knowledge.md` §5e.11「空态：未配置 Vault → 引导」（主席亲验提交态两侧）。

## 二、确定性门禁结果（脚本执行，主席未复跑）

| # | 门禁 | 结果 | 备注 |
| --- | --- | --- | --- |
| 1 | Typecheck（全仓） | exit=0 | 无关键输出行 |
| 2 | CLI core 包构建 | exit=0 | 无关键输出行 |
| 3 | 架构边界检查 | exit=0，violations: 0 | 佐证「UI 不直调服务/Runtime、无跨域实现导入」面 |
| 4 | services 知识域单测 | exit=0，81/81 pass | 含「MATCH 注入输入安全降级」「L2 审批 TTL 非法值 fail-closed」 |
| 5 | CLI 权限与模型边界单测 | exit=0，23/23 pass | permission-p0-executor / write-tier-policy / permission-service-write-tier 等 |
| 6 | UI 知识域组件/单测 | exit=0 | knowledgeTurnCitations 11 例、conversationSelectionReference 24 例、rootJwtInvalidBroadcastGate 等全绿 |
| 7 | 同 SHA CI 四工作流 | exit=0，全绿 | 含 R1–R9 三平台验收套件（ubuntu/windows/macos） |

补充事实（主席读提交态 CI 配置核实）：`pnpm fmt:check` 未进门禁清单，且在 `ci.yml:45-48` 被有意注释禁用（注释明言 fmt 基线未定、2900+ 文件差异，进 CI 会永久红灯）——这一定级背景将 oxfmt 回归（ui-lib-a-1）从阻塞降为合并前建议；`core/tests/`（vitest 目录，含已红的 tool-call-started-capability.test.ts）不在任何工作流执行集内（ci.yml:36 枚举 16 个 ui 测试、:100-109 枚举 7 个 core/test node--test 文件）。

## 三、规范符合度明细（按 AGENTS.md 条款类归纳）

### 3.1 spec 先行（「新增或修改行为前，先更新对应 spec」）——基本满足，4 项条款缺口 + 1 项文档矛盾

- **满足面**：知识域主线 W01–W09 与 §5b/§5c/§5e（含 2026-10-17 收尾复评增量、§5e.10–14）条款齐全且与提交态实现逐条语义一致（services 甲/乙、功能完整性核查三路交叉印证）；`specs/agent-write-safety.md` 2026-10-17 收尾契约的 allowedTools P0 守卫、readOnlyHint 不可信、P0 user-once、持久化消毒四条全部有条款、有实现、有具名测试；message.tsx 的可信引用接缝五要素在 §5e.10 有集成点记录（F-1 残余补记）；evidence 三层接线与 §5.3 逐条对应（sendText admission 前复验 session-flow.ts:79、sendQueuedNow reserve 前复验 queue.ts:195、guide 禁用回退、edit/retry 继承+二次复验）。
- **例外**：① D1 修复的 conversation_quote 模型边界白名单无 spec 条款（cli-core-b-1 + conv-4 合并，medium，复核证实）；② ui-auth-1 JWT 广播门控修复无 spec 条款（conv-3，low）；③ D-4 引用快照持久化+懒水合无 spec 条款（ui-lib-a-2，low）；④ 完成态来源面板呈现契约未落 spec（ui-know-a-6，low）；⑤ RC 交付范围文档与最终装配相反（spec-1，medium，**阻塞项 3**）；另有 knowledgeServices.ts A-10 勘误注释与装配相反（spec-2，low）与约 10 处陈旧注释（见 3.8/五）。

### 3.2 架构边界与状态唯一所有者——满足

- UI 经 `useOptionalServices` 注入访问服务，全 PR 新增代码 `window.drora`/`console.*` 零命中；Zustand 位置合规；账本唯一入口 ReviewLedgerStore + 三层写互斥（进程内 vaultLocks、跨进程 runtimeOwnership、prepared→applying 单赢家）；vault-config.json 三写路径经 `serializeVaultConfigWrite` 串行；渲染层只读 CLI 权威投影（knowledgeTurnCitations 不读 Composer 可变态）；发送失败草稿保留、pending overlay 与账本事实区分；Main 不承载业务状态（CLI 链路审查确认）；架构门禁 violations: 0。未发现本类 medium+ 违规。

### 3.3 契约键单一出处——部分满足（1 medium + 若干 low）

- **满足面**：evr_ 前缀、guard 码、上限 8（MAX_EVIDENCE_REFS_PER_INPUT）、DDL/列清单、JWT 广播通道、PermissionCapabilityGroup、manifest 表头常量（KNOWLEDGE_SOURCE_MANIFEST_HEADER）等主要族均单一出处且生产代码全量引用常量（共享契约组 git grep 全仓核对；手写字面量仅存于测试断言）。
- **例外**：vault-config.json 文件名 3 处生产代码手写、knowledge-index.sqlite 路径两侧独立构造，未收口进 shared/contracts 常量（conv-1，medium，复核证实；当前两份构造指向同一物理路径、行为正确，属规范违背而非功能缺陷）；ConversationTurnGroup.tsx:1634 生产源手写 manifest 表头（ui-cite-a-2 + conv-2 合并，medium，**主席亲验**：:1634 `row.text.includes("来源索引（顺序与附带的原文证据片段一致）：")`，同文件未 import 常量；该处是诊断投影 data 属性，漂移后果为 E2E 诊断判定静默失效）；low 级：sendText payload 内联重复 evidenceRef 形状（shared-1）、gate_unavailable reason 4 处手写未收口（shared-2）、excerpt 界值 240 两处独立定义（shared-3）、desktop E2E 三个 .ts 测试文件手写表头（ui-cite-b-3，fixtures JSON 数据文件豁免）、evidenceRefs 类型形状多处内联（cli-proto-2）。

### 3.4 上游对齐与模块化（还原隔离、最小接缝、官方优先）——满足

- 策略主体住新模块（write-tier-policy.ts、knowledgeCitationMarkdown.ts、reviewRuntimeOwnership.ts、reviewReleasePolicy.ts 等），既有核心文件只做守卫接线（service.ts +70 / mcp/index.ts +10 / permission-flow.ts +10 等）；76 个新增文件无一位于还原目录；唯一上游派生文件 message.tsx 的五个接缝与 spec §5e.10 记录逐项吻合、自研主体独立成文件、无顺手重构；82 个修改文件中还原文件仅修还原错误并留 bundle 证据（既往轮次已核）。无本类 medium+ 违规。

### 3.5 i18n 与 DESIGN.md——基本满足

- 本 PR 新增 109/379 键（两路独立统计口径）zh/en 双语完全对齐、零新增死键、动态键族（evidenceOpen×5 / evidenceSend×5 / banner×11 / handoff / intent / phase）逐一与生产拼接点核对一致；渲染安全走 mdast 变换与 React 转义，无 dangerouslySetInnerHTML。存量 6 键不对齐经基线比对确认非本 PR 引入（ui-lib-b-2，如实记录不立案）。
- 例外（均 low）：bare `rounded` 违反 DESIGN.md（ui-know-a-2）、提案表单原生控件偏离 Inputs 规范（ui-know-a-3）、change.kind 英文枚举入中文界面（ui-know-a-4）、知识交接模型面文案硬编码中文且无 spec 豁免记录（ui-lib-a-4）。

### 3.6 日志——满足

- UI 零 console/window.drora?.log；services 用 createServiceLogger(scope)；info/warn/error 分级与 AGENTS.md 口径一致；消毒丢弃带 warn 审计、permission.evaluated 结构化日志携带 ruleId/mode；新增日志负载仅 operationId/计数/布尔，无笔记全文、凭据、绝对路径（总审计 grep 零命中）。无例外。

### 3.7 测试义务（行为改动先测试、交互改动 E2E、测试与实现一致）——基本满足，2 项 medium 缺口 + 1 项阻塞

- **满足面**：每处 S03/L2/evidence 行为改动均有具名测试且真实测行为（真 executor 集成验证 Hook 不代批与持久授权 fail-closed；真实 fork+SIGKILL 进程测试覆盖 apply/undo × 活跃/死亡四组合；12 路并发 createRun single-flight、10 路并发 search、三写路径并发交叉；bootstrap 三套测试覆盖 admission 5 类/promotion 6 类/replay 3 类）；R1–R9 + handoff + positive + inline-provenance E2E 断言普遍绑定真实生产行为（CLI guard 码、canonical 投影、replay 请求体 include/exclude、磁盘账本终态、真实 hook 产物矩阵）；.e2e-home 隔离纪律完备（逐 spec 独立 HOME、finally 恢复并逐字节断言、仅删自建文件）。
- **例外**：① **阻塞项 1**（cli-core-a-1，红测试 + CI 盲区，主席亲验机制）；② cli-p0-5 的 ToolCallStarted readOnly 抑制与 mcp riskLevel 展示收紧两处行为改动无生产者侧回归（cli-core-a-1/a-2 同根，cli-core-a-2 另证 spec §6 声称的 display 级回归覆盖实际缺失，medium，复核证实）；③ 3 个本 PR 新增/修改的回归测试（knowledgeReviewView、rootJwtInvalidBroadcastGate、knowledgeChunkerTokenizer）不被任何 CI 工作流执行，D3 回归在 CI 层面零守卫（e2e-a-2，medium，主席亲验 ci.yml:36 枚举不含三者）；④ G 系 16+（复核实为 25）个交互用例无 E2E 且无自动化映射（e2e-b-3，medium，复核证实；文档已透明标注「未执行」并设 GO 条件）；⑤ e2e-b-1（medium，复核证实）：restart helper G12 段仍为固定 pause(1800) 单次负向采样，同 PR 在 G64 已确立并注释废除该反模式，此处漏改。low：双采样 spread 合并缺陷两处（e2e-a-3/a-4）、r6 一处 pause 残留（e2e-a-5）、knowledgeReviewView 测试传错 IntlProvider prop（ui-cite-b-2）、knowledgeReviewWritePath「坏值视为关闭」用例未走引擎加载路径（services-b-2）。

### 3.8 实现与验证纪律（typecheck/lint、中文修复注释、异步 IO、workspaceIdentity、格式）——基本满足

- typecheck/lint/架构检查必跑项全过（门禁 1/3）；异步 IO 全走 fs/promises（node:sqlite DatabaseSync 为 §5b.3 既定同步架构，不属违反）；workspaceIdentity 条款本 PR 未触及适用面（知识域以 vaultId/sourceEpoch 隔离）；修复注释大体中文详注。
- 例外：**3 文件 oxfmt 格式回归**（ui-lib-a-1，medium，复核证实 + 主席抽验：对提交态导出的 message.tsx 运行 `pnpm exec oxfmt --check` 输出 "Format issues found"；message.tsx 与 WorkspaceShellLayout.tsx 在合并基上原本合规，conversationKnowledgeSources.ts 为新文件；鉴于 ci.yml:45-48 明确 fmt 基线未定暂不设门，列为合并前建议：对 3 文件定向 `fmt:fix`）；3 处新增英文注释违反中文修复注释要求（cli-core-a-5）；陈旧注释批次（约 10 处，见第五节 doc 类）；CI paths 触发清单缺口与重复条目（e2e-a-1 + e2e-b-2 + e2e-b-5 合并为一项 medium，主席亲验 cross-platform.yml:7-30：fixtures 仅 handoff 一份在列、helpers/**/wdio.conf.ts 无条目、:20 与 :24 重复、:21 被 :23 覆盖；R*.json 回放 fixture 与 evidence 链文件改动不会触发三平台验收 CI）。

## 四、功能完整性核对（六大能力域）

| 能力域 | 判定 | 证据摘要 |
| --- | --- | --- |
| 1. Evidence 全链（签发→入场复验→队列提升→编辑重放→投影→持久化→冷恢复） | **完整** | sendText admission 前复验（session-flow.ts:79）、sendQueuedNow/auto-drain 唯一漏斗 reserve 前复验+失败回滚（queue.ts:195、v4-bridge.ts:758-765）、guide 禁用回退（evidence-admission.ts:71-89）、gate 不可用 fail-closed（:44-63）、edit/retry 继承+二次复验（canonical-intent-replay.ts:41,66-71）、durable 账本透传（input-intent-persistence.ts:27-30）、冷启动水合；evidence-session-wiring 三套 bootstrap 测试 + G08 真 SQLite gate 集成；R3/R4/R5 三平台 E2E。legacy 水合兜底 unchecked cast 为 low 展示级健壮性缺口（cli-proto-4）。 |
| 2. 完成态引用与回跳链 UI（[n] 标签、回跳二次读、D-4 水合、D1 模型边界） | **完整（附 3 处边界缺陷）** | 完成态仅信 CLI 投影 UserInputRow、receipt/manifest 双校验、回跳仅传 opaque receipt 且全文件 SHA+excerpt 二次读、epoch 单调、15s 超时 fail-closed；D1 白名单（conversation-quotes.ts）+ 回归测试；D-4 持久化与 composerDraftStore 同构。边界缺陷：渲染层 inline 绑定硬编码 [1-5] 与契约上限 8 层间不一致且无 spec 差异记录（ui-cite-b-1，medium，主席亲验 :31 正则；knowledgeCitationMarkdown.test.ts:120 反向锁定旧语义）；KnowledgeAnswerSources hooks 违规（**阻塞项 2**）；handoff 写入非原子可留孤儿引用（ui-cite-a-3，low）。 |
| 3. L2 审核写入状态机（提案/批准/TTL/claim/undo/跨进程所有权/独占创建/串行化/双开关） | **完整（附空态缺失）** | 写前+逐文件重载提案与 TTL 复检、undoing durable claim 单赢家、跨进程 owner PID+token 仅确认死亡接管（无超时夺权）、崩溃后只读 reconcile 绝不自动重放、createOnly 硬链接独占创建、vault-config 三写路径串行、非法 TTL 入账前整批拒绝、真实 fork+SIGKILL 四组合测试。缺口：未配置 Vault 空态缺失（**阻塞项 4**）；low：link() 在无硬链接文件系统上 create 全落 conflict（services-a-1，fail-closed 方向）、Windows rename 重试错误分类过宽（services-a-2）。 |
| 4. S03 权限与模型边界（allowedTools P0、readOnlyHint 不可信、user-once、持久化消毒、evidenceRefs 白名单） | **完整（附 2 处测试缺口）** | 五层守卫全落地、判定/展示/外发三面不可信、Hook 不代批、持久化仅留 Bash 内容规则、conversation_quote 白名单与 wire 校验闭环；23/23 权限单测绿。缺口即 3.7 例外①②（cli-core-a-1 含**阻塞项 1**、cli-core-a-2 medium）。 |
| 5. L0/L1 知识能力（Ask 流程/多源交接/VaultSearch/insights/plugin hook/人工提案） | **完整（附 1 项组合限制）** | 意图四选一不改 RPC、IME/Enter 纪律、扩搜仅透传诊断、COMPARE≥2/ANSWER≥1/上限 5/整批失败、L1 hook 真实产物 4 放行 11 静默矩阵（R7）、审核视图 L1/L2 双开关+逐文件预览 fail-closed 批准门。组合限制（low）：单篇「加入 Agent」引用不携带 evidenceSource，与 handoff 草稿混用时整批拒绝发送（fail-closed 有横幅，ui-know-b-1）。 |
| 6. E2E 验收与 CI 交付面（R1–R9 三平台、fixtures、验收矩阵） | **部分** | 已完成面：R1–R9 三平台矩阵与环境一致、断言绑定真实生产行为、隔离纪律完备、同 SHA 四工作流全绿。缺口：G 系 16+（实为 25）交互用例无 E2E 且无映射（e2e-b-3，medium）；CI paths 清单遗漏回放 fixture/helpers/evidence 链文件且有重复（e2e-a-1 合并项，medium）；3 个新回归测试无 CI 通道、D3 零守卫（e2e-a-2，medium）；helper G12 反模式漏改（e2e-b-1，medium）；provenance 负向 spec 仅 ubuntu 通道（e2e-b-4，low）。 |

「规格承诺但实现缺失」未发现实质条目（E-2 残留竞态为规格明示接受项）；「实现存在但规格未记录」见 3.1 例外清单。

## 五、发现明细（按领域；去重后 55 项 = 15 medium + 40 low，原始 61 条）

复核状态图例：**主席亲验**（本次终审读提交态代码/运行检查证实）、**复核证实**（专项复核员证实，主席采信）、**未复核**（低严重度，双人初审一致，主席按低风险采信）。**无任何一条经复核被判定不成立**；复核中发现的证据瑕疵（不改变定性的）附注于后。

### 5.1 medium（15 项）

| ID | 领域 | 位置 | 摘要 | 状态 |
| --- | --- | --- | --- | --- |
| cli-core-a-1 | CLI 权限 | permission-capability.ts:46-53 | cli-p0-5 门控改变 ToolCallStarted 契约，既有测试 tests/tool-call-started-capability.test.ts 未同步（复核员实跑 2 failed/1 passed），且 core/tests 目录不在任何 CI → **阻塞项 1** | **主席亲验**（机制静态成立；实跑数字引自复核员） |
| cli-core-a-2 | CLI 权限 | mcp/index.ts:144-155 | 第三方 MCP readOnlyHint 不再降 low 展示（trustedReadOnly）无直接测试；spec §6 声称的 display 级回归覆盖实际缺失 | 复核证实 |
| cli-core-b-1（+conv-4） | CLI 权限/总审计 | conversation-quotes.ts:10 | D1 conversation_quote 模型边界白名单无 specs 条款，违反「行为改动先更新 spec」 | 复核证实 |
| cli-proto-1 | CLI 协议 | commands/types.ts:237-238 等 4 文件 5 处 | additive→fail-closed 翻转后旧注释未清理，涉安全语义的误导性表述与 spec 明言废弃的口径矛盾 | 复核证实 |
| e2e-a-1（+e2e-b-2、e2e-b-5） | E2E/CI | cross-platform.yml:7-30 | paths 触发清单遗漏 R*.json 回放 fixture（7 个）、inline-provenance（cross-platform 侧）、restart helper、helpers/**、wdio.conf.ts、evidence 链文件；且 obsidian-vault/** 重复登记、knowledge/review/** 被覆盖 | **主席亲验**（:7-30 逐行；复核注明 R*.json 实为 7 个、inline-provenance 在 provenance.yml 有单平台信号——采信修正后的表述） |
| e2e-a-2 | E2E/CI | ci.yml:36 | 3 个本 PR 新增/修改回归测试（knowledgeReviewView、rootJwtInvalidBroadcastGate、knowledgeChunkerTokenizer）不被任何 CI 执行；D3 回归 CI 层零守卫（R9 fixture 刻意绕开该场景） | **主席亲验**（ci.yml:36 枚举核对） |
| e2e-b-1 | E2E | obsidian-authenticated-restart.helper.ts:88 | G12 TOCTOU 拒绝段固定 pause(1800) 单次负向采样，同 PR G64 已废除的同款反模式漏改，验收假绿风险 | 复核证实 |
| e2e-b-3 | E2E/验收 | KNOWLEDGE_E2E_PHASE1_SMOKE.md:39-62 | G 系 16 个（复核实为 25 个，含 G23/G34/G36-39/G41/G43/44）交互用例无 E2E 且无自动化映射；部分有未收录的模型/服务级覆盖，不能解读为零自动化 | 复核证实（含保守计数修正） |
| ui-cite-a-1 | 引用链 UI | KnowledgeAnswerSources.tsx:30 | React Rules of Hooks 违规（early return 先于 useMemo），citations 空↔非空翻转时崩溃 → **阻塞项 2** | **主席亲验**（复核修正：正常投影路径不可达，触发依赖水合/时序；静态违规确凿） |
| ui-cite-a-2（+conv-2） | 引用链 UI | ConversationTurnGroup.tsx:1634 | 生产源手写 manifest 表头契约字面量，未引用 KNOWLEDGE_SOURCE_MANIFEST_HEADER，违反契约键单一出处 | **主席亲验**（诊断投影用途，漂移后果为 E2E 诊断判定静默失效） |
| ui-cite-b-1 | 引用链 UI | knowledgeCitationMarkdown.ts:31 | 渲染层 inline [n] 绑定硬编码 [1-5]，与 wire/读取端上限 8 层间不一致、无 spec 差异记录；且该层测试反向锁定 [8]→空 scope 为期望 | **主席亲验**（:31/:41 正则） |
| ui-know-a-1 | 知识面板 UI | KnowledgeReviewView.tsx:419 | 未配置 Vault 时审核视图永久加载态，缺失 §5e.11 明文要求的引导空态，分支零测试 → **阻塞项 4** | **主席亲验** |
| ui-lib-a-1 | UI 基础 | message.tsx:16 等 3 文件 | 本 PR 引入 oxfmt 格式回归（2 文件基线原本合规）；因 CI 已声明 fmt 基线未定暂不设门，降为合并前建议（定向 fmt:fix） | **主席亲验**（message.tsx 抽查复现 "Format issues found"；三文件全量结论引自复核员的控制组实验） |
| spec-1 | 交付文档 | OBSIDIAN_RELEASE_CANDIDATE_SCOPE.md:18,70,76 | RC 范围文档三处安全断言与 desktop-local 定向放行的装配相反，误导发布裁定 → **阻塞项 3** | **主席亲验**（:18/:70 grep + node.ts:2608 + policy + host 装配链） |
| conv-1 | 总审计 | vault-config-reader.ts:52 等 | vault-config.json 字面量 3 处手写、knowledge-index.sqlite 路径 2 份独立构造，未收口 shared 常量；当前行为正确 | 复核证实 |

### 5.2 low（40 项，按域列出）

**CLI 权限与协议（9）**：cli-core-a-3（app__ 前缀场景无测试）、cli-core-a-4（matchesProjectRules 注释脱节）、cli-core-a-5（3 处英文注释）、cli-core-a-6（cli-p0-4/5 评审编号 specs 零记录）、cli-core-b-2（消毒 JSDoc 旧口径）、cli-core-b-3（建议注释旧口径）、cli-proto-2（evidenceRefs 形状内联复写）、cli-proto-3（死代码导出接口）、cli-proto-4（legacy 水合 unchecked cast，展示级健壮性）。
**E2E/CI（6）**：e2e-a-3+a-4（合并：R5/handoff 双采样 spread 合并使首采样失效，2 文件）、e2e-a-5（r6 固定 pause 单次负向检查残留）、e2e-a-6+shared-4（合并：3 处 e2e 陈旧注释描述 D1 修复前泄漏为现状）、e2e-a-7（工作流「已知预期红」注释与全绿终态矛盾）、e2e-b-4（provenance spec 仅 ubuntu 通道，与自身转正条件不衔接）。
**services（6）**：services-a-1（link() 在无硬链接 FS 上 create 不可用，fail-closed）、services-a-2（rename 重试错误分类过宽）、services-b-1（TTL「生产最低 30s」注释残留）、services-b-2（坏值用例未走引擎加载路径）、services-b-3（spec 引用旧编号）、services-b-4（英文测试标题/错误信息混杂）。
**共享契约（2）**：shared-1（sendText payload 内联重复 schema）、shared-2（gate_unavailable 未收口词表）。
**引用链/知识面板 UI（10）**：ui-cite-a-3（handoff 写入非原子孤儿引用）、ui-cite-a-4（注释 1–5 与上限 8 不一致）、ui-cite-b-2（IntlProvider 传错 prop 名）、ui-cite-b-3（desktop E2E 手写表头）、ui-know-a-2（bare rounded）、ui-know-a-3（原生表单控件）、ui-know-a-4（英文枚举入界面）、ui-know-a-5（KnowledgeAnswerSources 不在纪律门禁扫描范围）、ui-know-a-6（来源面板契约未落 spec）、ui-know-b-1（单条加入与 handoff 混用整批拒绝）。
**UI 基础与认证（6）**：ui-lib-a-2（D-4 持久化未落 spec）、ui-lib-a-3（告警去重不重置偏差）、ui-lib-a-4（模型面中文文案无豁免记录）、ui-lib-b-1（水合守卫未校验 receiptId/evidenceSource 类型）、ui-lib-b-2（存量 6 键 i18n 不对齐，非本 PR 引入）、conv-3（JWT 门控无 spec 条款）。
**其他（1）**：spec-2（A-10 勘误注释与最终装配相反）。

## 六、未覆盖与建议

### 仍需真人完成项

1. G 系人工验收矩阵：25 个用例（含 e2e-b-3 所列 16 个与复核补充的 G23/G34/G36-39/G41/G43/44）需真人执行或补自动化映射；文档已自标「未执行」并以 GO 条件约束合并（PR 保持 Draft）。
2. G02 相关性真人判断：既往轮次已裁定 BLOCKED（无自动化判据），维持人工。
3. A24/A28 真实联调：规格明示未实测、默认关闭，需真人在真实环境验证后启用。

### 建议跟进（按优先级）

1. **合并前**：处理 4 项阻塞项（更新 tool-call-started-capability.test.ts 至新契约并将 core/tests 目录纳入 CI；hooks 顺序一行修复；RC scope 文档三处同步收尾复评决定；实现 §5e.11 未配置引导空态+测试）；对 3 个 oxfmt 回归文件定向 `pnpm fmt:fix`。
2. **CI 接线**：三个新回归测试接入工作流；cross-platform/provenance paths 补齐 R*.json fixture、helpers、wdio.conf、evidence 链文件并去重；provenance 负向 spec 补 win/mac 通道；评估将 fmt:check 纳入增量（仅改文件）模式。
3. **spec 补录**：conversation_quote 模型边界白名单（D1）、JWT 广播门控、D-4 持久化、渲染层 [1-5] 差异（或直接统一为 8 并修正 knowledgeCitationMarkdown.test.ts:120 的反向锁定）四条条款。
4. **契约收口**：vault-config.json 与 knowledge-index.sqlite 提入 shared/contracts；gate_unavailable 收口词表；ConversationTurnGroup.tsx:1634 改引常量；excerpt 240 常量化。
5. **注释清理批次**：约 10 处陈旧注释（additive 旧口径 5 处、TTL 30s、消毒 JSDoc、D1 修复前描述、工作流预期红、1–5 上限）与 3 处英文注释汉化。
6. **DESIGN 对齐**：bare rounded、原生表单控件、英文枚举三处按 DESIGN.md 规范化。

## 七、附录：审查方法与覆盖

### 7.1 审查方法

- 代码证据一律取提交态：`git show b7ac637a:<path>`（全貌）、`git diff 7ced6f89 b7ac637a -- <path>`（改动）、`git grep <pattern> b7ac637a -- <path>`；规范文件（AGENTS.md/DESIGN.md/CONTEXT.md）读工作区最新版。
- 确定性门禁 7 项 + 同 SHA CI 由脚本先行执行，全体审查员与主席均未复跑测试/构建/CI 查询（如实声明：除下述主席亲验项外，本报告运行验证为零）。
- 主席终审亲验清单（本次会话实际执行）：`git ls-tree` 定位测试路径；通读提交态 permission-capability.ts、write-tier-policy.ts、tool-call-started-capability.test.ts、events.ts(:30-140)、KnowledgeAnswerSources.tsx、knowledgeCitationMarkdown.ts(:1-60)、ConversationTurnGroup.tsx(:1620-1649)、KnowledgeReviewView.tsx(:395-439)、obsidianVaultService.ts(:155-189)、node.ts(:2598-2617)、desktop host index.ts(:3035-3049)、reviewReleasePolicy.ts、ci.yml（全文）、cross-platform.yml(:1-40)、specs/obsidian-knowledge.md §5e.11/§5e.12 段、OBSIDIAN_RELEASE_CANDIDATE_SCOPE.md（grep :18/:70）；运行 `pnpm exec oxfmt --check .review-tmp/message.tsx`（提交态导出副本）复现格式问题。

### 7.2 审查员配置（16 路）

| # | 审查员 | 范围 | 文件数 |
| --- | --- | --- | --- |
| 1-2 | CLI 权限与模型边界·甲/乙 | S03 权限门控、write-tier-policy、permission-flow/response/suggestions、conversation-quotes | 8 / 7 |
| 3 | CLI 协议链路 | v4 协议 12 文件（evidence admission/queue/replay/水合/网关） | 12 |
| 4-5 | E2E 验收与 CI·甲/乙 | 2 新工作流 + ci.yml + R1–R9 套件 + handoff/positive/inline-provenance + 9 fixtures + helpers | 13 / 12 |
| 6-7 | Knowledge 服务与 Vault 存储·甲/乙 | services knowledge/obsidian-vault 17 文件（引擎/账本/原子写/并发/崩溃 fixture） | 17 |
| 8 | 共享契约 | shared 4 文件（knowledge-evidence/input-intent/rows/protocol） | 4 |
| 9-10 | 会话引用链 UI·甲/乙 | Composer/TurnGroup/RowView/AnswerSources/citationMarkdown + 10 测试 | 11 / 10 |
| 11-12 | 知识面板 UI·甲/乙 | Ask/Review/Proposal/Candidate + hooks + 5 测试 | 10 / 10 |
| 13-14 | UI 基础与认证·甲/乙 | message.tsx 接缝、SelectionReference 持久化、OAuth 恢复门、i18n | 8 / 7 |
| 15 | 功能完整性核查 | 全量对照 spec 承诺逐域核对 | 全量 |
| 16 | 规范总审计 | AGENTS.md 横切总审计（158 文件） | 全量 |

### 7.3 覆盖声明

- 158 文件（82 修改 + 76 新增）按上述 16 路分域全覆盖，无空窗域；每条 medium 均经独立复核员二次取证，主席对 5 项阻断候选 + CI paths 块 + oxfmt 抽样完成第三道亲验。
- 本报告未运行任何测试/构建/CI 查询（指令约束）；services/CLI/UI 单测与三平台 CI 结论采信任务书给定的脚本门禁输出。
- 主席临时导出目录 `.review-tmp/` 已在终审后清理，未触碰工作区任何被审文件。

---

*评审主席签发 · 2026-10-18 · 基线 b7ac637aad3728cb93fc0e2836d46d8c4c47ce23*
