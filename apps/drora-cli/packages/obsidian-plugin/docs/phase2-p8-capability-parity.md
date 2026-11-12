# 阶段二 P8 收尾验收：能力等价复跑记录（webview + 插件 server 形态）

依据：`specs/obsidian-vault-phase2-true-extraction.md` §9（验收定义，含七项差异清单）、
§10-P8（收尾验收批次）；行为契约 `specs/obsidian-knowledge.md` 各节验收映射。
等价基准 = git HEAD `bf872a6c0`（阶段一起点，本体实现形态）。
执行日期 2026-11-12；全部命令走 pinned pnpm（`.zcode/toolchain-bin/pnpm`）真实执行。

## 1. 逐节复跑结果（obsidian-knowledge.md 验收映射 × HEAD 基准）

| spec 节            | HEAD 基准形态                                        | 阶段二形态复跑（命令与结果）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 结论 |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| §4 查询语义        | 本体 services 检索管线                               | `node --import tsx --test test/knowledgeIndexQuery.test.ts test/knowledgeAskUiFlow.test.ts`（batch2 27 用例含 run 生命周期/幂等/取消）全绿；面板 lookup 语义（检索即终点）由 `test/knowledgeAskUiFlow.test.ts` + fixture e2e 场景 6 锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 等价 |
| §5 Evidence 语义   | 三层接线（工具摘录→prepareEvidence→CLI admission gate） | **收窄为插件工具内单层复验**（D9 建议值先行）：`test/knowledgeAgentTools.test.ts`（8 用例：白名单+evidence 三态 current/stale/missing/no_source）+ `test/knowledgeEvidence.test.ts`（Receipt 创建/解析语义随迁全绿）+ `test/knowledgeReceiptIsolation.test.ts`（隔离）全绿；citation openWith 三态走 fixture e2e 场景 7（真实 resolveCitation 链）；旧 CLI admission gate 已按 C6/C8 拆除，旧账本 refs 条目拒绝语义 = bootstrap `test/knowledge-user-input-provenance.test.mjs`（3 用例：新账本不持久化 refs、旧账本条目仍可投影、伪造形状 fail-closed）全绿 | 等价（收窄面按差异⑤呈现） |
| §5b 索引与检索     | 本体 knowledge 栈（25 node:test）                    | 随迁 30 node:test 全绿（knowledgeIndexQuery/knowledgeAutoIndex/knowledgeFtsColumns/knowledgeChunkerTokenizer/knowledgeE2EFullChain/knowledgeSemanticAccuracy/knowledgeVectorRecall/knowledgeLocalEmbedding/knowledgeEmbeddingInput 等；批 1-6 共 203 用例 pass，1 skipped 为向量环境条件跳过）；DB 级 lease/fencing = knowledgeLeaseFencing 全绿；升级搬迁零损失 = knowledgeMigration（6 用例）+ knowledgeMcpServer（3 用例：54 工具面/conflict fail-closed/升级冒烟计数一致）全绿                                                                                                                                                                                                                          | 等价 |
| §5c 四视图 UI      | 本体 VaultView.tsx + v4/vault/（34 文件）            | webview 重建（`src/ui/`，P5）：面板模型纯函数 = `test/vaultPanelModel.test.ts`（8 用例：树模型/滚动记忆/wikilink 解析/lookup 横幅/草稿/openWith 载荷/handoff 文本）全绿；数据通道 = `test/vaultUiResources.test.ts`（4 用例）全绿；真实链 = fixture e2e（launcher/display modes/notes 浏览/wikilink/N1 lookup+handoff/草稿保护 + P8 场景 5-8）；**写操作面不交付**（D13 保守缺省：编辑器/标题提交/新建/改名/删除/N2 一键插入/N3 确认插入/approve/apply/configureVault 写入/startReconcile 均降级提示）——差异⑦呈现，g10 终裁后补批 | 等价（只读面）+ 差异⑦ |
| §5d Jev 决策       | 本体模型能力域（设置表单+热刷新+凭据键）             | **静态化收窄**（D8 建议值先行）：决策栈随迁 `test/knowledgeDecisionPipeline.test.ts`（管线）+ `test/knowledgeDecisionPolicy.test.ts`（纯函数）+ `test/knowledgeEvaluationHarness.test.ts`（离线评测）全绿；Jev 5 vitest（Adapter/Assembly/Connection/HotReload/SystemOneTransport）31 用例全绿；凭据读取器缺省 fail-closed（迁入件 D8 改点）；本体 AppSettings 字段/表单/凭据键已按 C9/C11 拆除（旧值丢弃，迁移注记在 modelCapabilities.ts 头注释——终裁若选映射 userConfig 由补批落地）                                                                                                                                           | 等价（收窄面按差异⑥呈现） |
| §5e 审核写入       | 本体 review 栈 + GO 门禁                             | 随迁全绿：knowledgeReview/knowledgeReviewFreshApproval/knowledgeReviewOwnership/knowledgeReviewWritePath（59 用例，含 writePathEnabled fail-closed/W01 语义/operation ledger/undo SHA 校验）；面板审核视图只读呈现 L2 门（fixture e2e 场景 8）                                                                                                                                                                                                                                                                                                                                                                                                     | 等价（写面差异⑦） |
| §5f VaultSearch    | CLI 内建工具（只读无审批+deferred）                  | 插件 MCP 工具 `vault_search`/`vault_neighbors`（P4）：契约随迁+白名单+evidence 注解 = `test/knowledgeAgentTools.test.ts` 8 用例全绿；出站白名单同一收口 = `test/knowledgeVaultSearchProtocol.test.ts`（35 用例批 4 内）；**审批差异**：MCP 工具逐次 ask（D7 保守缺省，不做自动 allow）+ **常驻首发**（D15：manifest alwaysLoad，工具面每会话 context，deferred 收敛待双轨下线后加工具级 deferred）——差异⑦/⑧呈现；server/stdio host 不装配插件 server（差异⑨）                                                                                                                                                | 等价（检索语义）+ 差异⑦⑧⑨ |
| §5g 洞察视图       | 本体 insights 面板数据面                             | `test/knowledgeInsights.test.ts`（库存/覆盖/索引活动/决策快照）全绿；面板 insights 视图经 `data/insights` 资源端点消费（vaultUiResources 4 用例锁定端点封套）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 等价 |
| §5h N2/N3/N4       | 本体面板写入能力                                     | N1 lookup 交付（P5，检索即终点）；N2 面板「相关笔记」数据面 = `test/knowledgeNeighbors.test.ts` + `data/neighbors` 端点全绿；**N2 一键插入/N3 确认插入属写操作面**（D13 降级提示）；N4 健康体检数据面随 insights（`data/insights` 含 healthReport）——写侧能力待 g10 终裁补批（差异⑦）                                                                                                                                                                                                                                                                                                                                                              | 数据面等价 + 差异⑦ |
| hooks 契约（obsidian-plugin.md 验收 1-21） | hooks 三事件（未随迁移改动） | `pnpm --dir apps/drora-cli/packages/obsidian-plugin test`：agent-access（验收 9-11/14-16/21 策略面，15 node:test）+ permission-path-policy（W01 收窄）+ hooks-e2e（验收 9-12/14-16，spawn 构建产物 stdin/stdout）全绿（28 ok 组/15 tests/fail 0）；验收 1-8 的 MCP 工具面已按「Proma 式原生访问重构」移除（验收 13），门面安全语义由 obsidianVaultConfig/obsidianVaultAtomicCreate 单测锁定（随迁全绿） | 等价（hooks 实现零改动） |

平台契约面（P1/P2 交付）复跑：adapters 包 vitest 全量 182 文件 2590 用例全绿（含
plugin-ui-surfaces 契约测试：availability 仅 "session"、hostPanelId 解析拒绝、
mcp 工具 deferred 声明、hostComponents 三态）；bootstrap 包 vitest 272 文件中
obsidian 面全绿（official-plugin-app-service 7 / plugins 47 / plugin-runtime-features 9 /
plugin-ui-surfaces 5 / official-plugin-uninstall-keep-data 4 用例）。

## 2. §9 已知差异清单（按裁定呈现，不静默）

| # | 差异                                                                  | 裁定与呈现                                                                                                                                                                                                                                                      |
| - | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① | session 级面板：无有效会话无 VaultView 入口                            | D11 建议值先行：按 session 级交付；app 级沙箱面板列 backlog（spec §11）                                                                                                                                                                                            |
| ② | §5c.3 冷启动引用回跳不可达（无会话时 chat 点击引用无法打开面板定位）    | D11：降级为提示（面板不在场时 C5a 降级提示语义）；app 级面板 backlog                                                                                                                                                                                               |
| ③ | chat 引用打开依赖面板/插件 server 在场                                 | C5a 降级提示（knowledgeEvidenceSendFailure/knowledgeCitationOpenFeedback 渲染端保留-改造，40 用例全绿）                                                                                                                                                             |
| ④ | Web/远程 workspace 插件 UI 不支持                                     | plugin-ui-bridge 契约只支持本地 workspace Agent；如实接受（spec §6 尾注）                                                                                                                                                                                           |
| ⑤ | evidenceRefs wire 收窄 + 旧账本 refs 条目拒绝                          | D9 建议值先行：工具内单层复验；旧账本 fail-closed（provenance 3 用例绿）                                                                                                                                                                                           |
| ⑥ | Jev 配置面静态化（设置表单/热刷新/凭据键拆除，旧 AppSettings 值丢弃）    | D8 建议值先行：userConfig 静态注入（android 先例）；迁移注记在 modelCapabilities.ts 头注释，终裁后补批                                                                                                                                                              |
| ⑦ | 面板写操作不交付（D13 保守缺省）+ 检索类插件 MCP 工具逐次 ask（D7）     | g10 信任分类未裁定：P5 只交付只读面（写操作降级提示不放假按钮）；D7 维持逐次 ask、不加 authority 降档路径；两项均待终裁后补批                                                                                                                                       |
| ⑧ | VaultSearch 以 MCP 常驻工具首发（每会话 context 占用）                  | D15 建议值先行：manifest alwaysLoad:true；收敛 = 双轨下线后加工具级 deferred（P2 g3 机制）                                                                                                                                                                          |
| ⑨ | server/stdio host（packages/server createLocalServices 装配链）agent 工具面回退 | P1 落地裁定②：不装配 appService；待终裁推翻时另批接入                                                                                                                                                                                                              |

## 3. E2E 重写映射（旧 WDIO r1-r9/G 系列 → webview 形态等价场景）

执行入口：`packages/desktop/scripts/mcp-apps-host-e2e.mjs --obsidian-only`
（DRORA_OBSIDIAN_SERVER=obsidian-plugin/dist/mcp/server.js；真实 Electron fixture
host + 真实 agent/bridge/沙箱链 + 真实构建面板 + 真实 knowledge server）。
**执行结果（2026-11-12，第十一轮收敛后）**：9/9 场景 PASS（P5 四场景 + P8 四场景
——R1-G01 / R1-G02+G58+R2 加严 / R3+R9+G28 citation 四态 / R7-G31），exit=0。
工具面通道裁定留证：`mcp/uiCallTool` 在 fixture 会话直挂名下需要 App connection
（namespaced server 归属），首跑实证无审批请求到达而长挂——P8 改用独立 MCP client
stdio 直连 knowledge server（P6 升级冒烟同款已验证路径；多实例 DB 级 fence 仲裁是
g8 受支持场景）。locale 呈现留证：fixture 宿主 locale=en_US，面板横幅文案按
hostContext 跟随（en 文案断言与 zh 并列收录）。

| 旧用例（HEAD 已删）                          | 旧覆盖行为                                     | webview 等价场景（本批落地）                                                                                                       | 收窄面（不伪造等价）                                                                 |
| -------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| r1-first-use G01/G02                         | 首启配置+索引计数精确+唯一句检索行号            | 场景 5（R1-G01：configured=true、覆盖 3 文件、job completed）+ 场景 6（唯一句 bigram 检索：路径/行区间覆盖第 3 行/摘录含原文）          | —                                                                                    |
| obsidian-knowledge-positive G58              | managed-vault 连接/索引/FIND/verified→原文      | 场景 5+6（同链）+ 场景 7 current 定位（verified → original Markdown read）                                                             | —                                                                                    |
| r2-agent-handoff G03/G04/G13                 | Composer 引用 chip+admission 复验+来源 manifest | 场景 6 handoff 加严（g9 openConversationHandoff 真实 host-action：来源路径+行号+摘录）                                               | chip/admission/manifest 面已按 C5b/C6 拆除（差异⑤）；evidence 复验移工具内（§1 表） |
| r3-time-based-reject G05/G06/G07             | 时间差拒绝（stale/missing/forbidden）          | 场景 7（stale=修改原文后 openWith 结构化过期提示；missing=删除后不可达提示；forbidden=未知 receipt 同 missing 分支呈现）                 | admission 链拆除；面板 citation 分支即等价面                                        |
| r4-busy-queue G08/G09                        | busy 队列提升前复验+重复加入 dedupe            | —（evidence 面收窄）                                                                                                                  | 差异⑤；队列通用面非 vault 专属，不属等价清单                                          |
| r5-restart-isolation G12/G35/G42             | 重启冷恢复/跨轮隔离/会话隔离                   | 投影冷恢复 = bootstrap knowledge-user-input-provenance（3 用例）；citation 跨轮隔离 = knowledgeIndexQuery G35/G42 用例（27 用例内）     | —                                                                                    |
| r6-source-manifest-guard G16/G26/G27         | 来源清单防篡改                                  | —                                                                                                                                     | C5b 拆除：来源清单生产端随面板走，新形态=handoff 文本（场景 6 锁定内容面）             |
| r7-write-boundary G31/G32/G40/L1             | L2 写门+L1 hook 边界                           | 场景 8（review 视图 L2 门只读呈现，默认关）+ L1 hook = hooks 套件（§1 表）；apply fail-closed = knowledgeReviewWritePath 单测           | L2 真实写面待 g10 补批（差异⑦）                                                      |
| r8-concurrency G45/G46/G52                   | 并发 single-flight/scope epoch                 | messageCitationOpenIntegration（C5a 保留 40 用例内）锁定 open 事件总线；面板 openWith 为命令语义（新载荷覆盖旧载荷）                     | 面板侧 seq 守卫按新形态实现（每次 openWith 全量解析，无迟到采纳面）                  |
| r9-second-read-focus G47/G53/G54/G55         | SHA 二次读校验/草稿保护/迟到忽略               | 场景 7 stale（fileSha256 复验拒绝）+ P5 草稿保护场景（widgetState 恢复，e2e 实证）                                                      | 亚毫秒注入窗口无产品注入点（旧用例同样按 PARTIAL 口径记录）                          |
| g-citation-open-errors G28/G29               | chip 打开+stale toast                          | 场景 7（current 定位 + 未知 receiptId 结构化 forbidden→missing 呈现，不崩溃不导航）                                                    | chip 面拆除；openWith 桥即等价入口                                                   |
| g-interleaving G11/G20-G22                   | 交错防护（submitSeq 守卫）                      | —                                                                                                                                     | 旧面板 hook 面随 C3 拆除；lookup 为资源读+幂等键（createRun clientRequestId 防双跑，knowledgeAskUiFlow 锁定） |
| g-hint-and-plain-selection G25/G30           | chip hover 提示+普通选区动作缺席               | —                                                                                                                                     | HEAD 即 pending（v3.16.1 移入 manual-review/pending），维持 pending 不迁移           |
| obsidian-authenticated-handoff G61-G63       | 跨视图 handoff+重启                            | 场景 6 handoff + provenance 冷恢复（见 r5 行）                                                                                         | —                                                                                    |
| obsidian-inline-citation-provenance          | 伪造引用负面场景                                | knowledge-user-input-provenance 伪造形状 fail-closed 用例                                                                              | —                                                                                    |

## 4. i18n 键迁移对账（spec §10-P8 行）

- 本体 `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts` 的 `vault.*` **342 键×2 删除**
  （P7 已拆本体 VaultView 消费端，键为零引用死键）+ `workspace.openVault`（C4 侧栏
  入口槽键，同随拆除，零引用）一并清理；`grep -c "vault\."` 复核两文件归 **0**。
- 保留非 vault 前缀的 C5a 渲染面键（`chat.selections.evidenceOpen.*`、
  `chat.knowledgeTurn.*`——KnowledgeAnswerSources/ConversationComposer 消费端仍在）。
- 插件页面资源 `src/ui/i18n.ts`（P5 建，zh/en 双份 192 键）为 vault 面板文案唯一资源位。
- locale 文件 parse 校验（esbuild loader=ts）双文件通过。

## 5. 基线失败如实记录（非 obsidian 阶段二引入，均已归属）

- bootstrap 包 vitest 6 用例失败：official-command-endpoint（**HEAD 证据**：
  `endpoint.ts:141` 已是 `X-Drora-App-Version` 而测试期望 `x-zcode-app-version`——
  HEAD bf872a6c0 改名战役漏改测试，工作区无 diff）；protocol-slash-commands
  （`vi is not defined`，测试文件自身缺 import）；persona-protocol / session-facade /
  workflow-fault-matrix（时序类）。六个文件零工作区改动，与 obsidian 战役无交集。
- `pnpm test:drora` 3 用例失败（1953 用例中）：voice 契约 2 例（`globalDictationEnabled`
  键由已提交 22038fc10 voice 战役引入、期望清单未更新）+ ui-team 契约 1 例
  （`session-line.ts` 由已提交 bf872a6c0 cua 战役加入 module.ts、测试未更新）。
  两个测试文件零工作区改动。
- 上述失败按「保留与任务无关的本地改动、不顺手修」纪律不在本批处置，如实呈报。

## 6. desktop e2e 全量 gate（附加 gate，如实记录）

- **执行**：`pnpm --dir packages/desktop test:e2e`（wdio-native 32 worker 并行，
  ensure-e2e-desktop-build + agent build 前置全走真实构建）。**环境限制**：runner
  运行 65 分钟后被宿主环境 SIGTERM 终止（21% 完成），已完成 **92 spec：76 过 /
  16 败**。16 个失败（browser×2、coding-plan×2、conversation-session 通用面×12）
  **零 vault/obsidian/knowledge token 交集**，错误形态抽样全为时序类（waitUntil
  30s 超时 / stale element / no such element）——32 并行的资源竞争远超 CI 分片
  （--shards=10）工况。本机跑完 444 spec 估需 ~5 小时且会被环境终止，全量完整跑
  在本施工会话不可达，如实呈报。
- **定向补跑**（改动面交集最大的插件域，串行）：
  `conversation-session-plugin-mcp-skill-installed-enabled` **PASS**（插件 MCP/skill
  启用链）；`plugin-management-persistence-source` **PASS**（含 restart 链）；
  `plugin-management-builtin-inline` 与 `plugin-management-installed-menu-layout`
  **FAIL**——失败点均在 `restartPluginLifecycleApp → waitForWorkspaceApp`（重启后
  「主界面切到工作区」60s 等待超时），运行时日志显示 app 实际已恢复（renderer 会话
  订阅 acknowledged）；同走 restart 链的 persistence-source 通过 → **非系统性重启链
  破坏**，判为恢复时序窗口敏感。**归属如实**：无 CI 基线（CI 不跑 desktop e2e）且
  施工会话禁止 stash，无法对照 HEAD；与本战役 appService 常驻启动（P1/P3）是否
  微弱拖慢启动**未能定论**，列待终审复核项，不在本批盲改。
