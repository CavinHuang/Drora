# Obsidian Vault 阶段二：真抽离 Spec（本体零 vault 实现）

来源：用户终裁（2026-11-11）推翻阶段一「宿主实现保留」模型：「我们的要求是把 Obsidian
vault 的实现，抽离成 drora 的 ui 插件，而不是耦合在 drora 的本体」。本文件是阶段二的
单一事实源；`specs/obsidian-vault-plugin-extraction.md`（阶段一）降级为**中间态**：
其插件体系平台扩展与能力逻辑设计大部分保留，本体装配条件化与 UI 组件位置属阶段二
改造对象，被取代处在该文件头部标注并互链本文件。行为契约仍以
`specs/obsidian-plugin.md`（hooks/安全不变量）与 `specs/obsidian-knowledge.md`
（知识链路行为）为准——阶段二只改**实现归属与物理位置**，行为语义以 git HEAD 原实现
为等价基准。

阶段二关键证据均为本会话实读：plugin-ui 契约（`packages/ui/src/plugin-ui/CONTRACT.md:7-26`
后台保留 4 页/30 分钟/`_meta.ui.backgroundRetention`、8MiB、display modes、
hostContext 仅 width/maxHeight+`drora/widgetState`）、office-runtime 共享 server 与
CSP/分块先例（`office-runtime/src/adapters/server.ts:370-373` offset/limit chunk 工具、
`wasmUnsafeEval` 申报）、browser-use 确定性 node_modules 子树 seed
（`official-plugin-definitions.ts:239-243`）、isolation 仅官方插件
（`adapters/src/plugins/mcp.ts:191-194`）、evidenceRefs optional 兼容语义
（`drora-protocol-v4/command.ts:124`、`input-intent.ts:118-120`）、obsidian 现清单
无 mcpServers/ui（`obsidian-plugin/.zcode-plugin/plugin.json`）。

## 0. 目标态定义（真抽离三支柱）

1. **本体零 vault 实现**：Drora 本体（packages/services、packages/ui、packages/shared、
   packages/client、packages/desktop、packages/web、packages/server、
   apps/drora-cli/packages/{core,bootstrap,contracts}——评审 2 轮统一为与 §9 扫描清单
   同一八包口径）经残留扫描（§9 白名单=平台接口）对 vault/知识 token 零命中。
2. **插件自带全部实现**：VaultView UI（webview 形态重建）+ 知识检索栈（插件宿主服务
   进程）+ 数据（全部进插件数据目录）+ agent 工具（插件 MCP 工具面）全部归
   obsidian 插件包；本体只剩平台接口（插件契约、MCP/资源协议、hooks 契约）。
3. **能力等价**：以 git HEAD（阶段一起点）行为为基准对照（§9 清单），用户可感知能力
   不回退；平台缺口解不了的能力如实列降级形态与决策点（§6/§11），不假装能迁。

## 1. 本体清除清单（逐项去向）

| #   | 本体位置                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 去向                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `packages/services/src/knowledge/`（store/index/search/query/decision/evidence/review/source/eval + knowledgeServices 装配 + vaultSearchProtocol + insightsSnapshot）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **物理迁移**进 `apps/drora-cli/packages/obsidian-plugin/src/server/`（等价实现，随插件服务进程；文件头注明迁移来源与 HEAD commit）                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C2  | `packages/services/src/obsidian-vault/`（vault-config/vault-focus 门面 + 安全不变量实现）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **物理迁移**进插件包 `src/server/vault/`（hooks lib 已有同语义副本，服务进程以迁入实现为唯一实现，去重）                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| C3  | `packages/ui/src/v4/VaultView.tsx` + `v4/vault/`（非 knowledge 子目录 **14 文件**）+ `v4/vault/knowledge/`（**20 文件**；find 实测 34=14+20，终读评审修正原 15/19）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **删除**，webview 页面重建（§2，React 打包进插件 `dist/ui/`，不复用本体组件）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| C4  | `packages/ui/src/drora-extensions/WorkspaceMainView.tsx` + `WorkspaceShellLayout.tsx` vault 段（1960-2013/2379-2381/3016-3130）+ `app-shell/types.ts` "vault" 成员（**实码 :213-214**）+ `project-sidebar` onOpenVault/vaultActive 槽 + 阶段一落地实码：`plugin-ui/host-panel-registry.tsx`、`plugin-ui/adapters/useHostPanelSurfaces.ts`、`bootstrap/drora-protocol/plugin-ui-surfaces.ts` app 级投影分支 + **app 形态契约与解析分支（终读评审 M8 补）**：`contracts/src/plugins/index.ts:217` `availability:"app"` 联合成员、`adapters/src/plugins/ui-surfaces.ts:102-135` hostPanelId 分支、obsidian-plugin plugin.json 现状 app+hostPanelId 声明 | **删除/收窄**（宿主面板机制整体），入口改为 ui.surfaces webview surface（§2）；`plugin-ui-surfaces.ts` session 级过滤回退既有语义；**`availability:"app"` 联合成员删除（不留死成员）**——D11 backlog 若做 app 级沙箱面板需另立 spec 重引入；这些文件无 vault token、残留扫描测不到拆净 → **拆除验证 = 契约测试断言 `PluginUiSurfaceAvailability` 仅含 "session" + 解析器拒绝 hostPanelId**（P7 gate 补充）                                                                                                                                                      |
| C5  | 会话知识引用面——**拆分处置（评审 2 轮 H3）**，逐文件分流清单见下方「C5 分流清单」：**C5a 保留（通用 chat 面）**=citation 渲染与投影消费端；**C5b 拆除（生产端随面板走）**=来源清单/选区引用生产端                                                                                                                                                                                                                                                                                                                                                                                                                                                    | C5a 渲染保留 = chat 引用能力不因抽离消失（消费 receipt 投影非 vault 实现）；「打开原文」路由改宿主→面板 openWith(receiptId)（g9 双向），解析在面板内经插件 server 完成，插件不在场给结构化降级提示；C5b 生产端在 webview 重建                                                                                                                                                                                                                                                                                                                                  |
| C6  | shared 契约：`knowledge-evidence.ts`、`knowledge/queryTerms.ts`、`drora-protocol/index.ts` knowledge/search 与 knowledgeNeighbors 协议段（**实码 :5079 方法键及 schema 段，按符号名引用**）、`drora-protocol-v4/{input-intent.ts:118-120,command.ts:124}` evidenceRefs、`channels.ts` 四通道                                                                                                                                                                                                                                                                                                                                                         | **删除/收窄（终读评审 M5 修正）**：插件侧契约随 C1 迁入；wire evidenceRefs **schema 字段定义保留 + deprecated 注释（.strict() parse 兼容——删定义会使旧持久化账本硬解析失败破坏会话恢复），删除全部写入路径**；CLI intent 层（input-intent-persistence/canonical-intent-replay/fork-edit-retry/session-flow，实测命中文件）保留**最小 legacy 探测器**：检测 refs 非空即拒绝并给结构化 `legacy_evidence_unverifiable`（A17 fail-closed 延续）——探测器中 evidenceRefs 字面量必然存在，**登记残留扫描白名单（§9，逐条 path+原因）**；queryTerms 由插件包自携带副本 |
| C7  | services 装配（**按符号名引用，终读评审 L9 修正行号漂移**）：`node.ts` 四 `.register`（实码 :3561-3567，符号 IObsidianVaultService/IKnowledgeIndexService/IKnowledgeQueryService/IKnowledgeReviewService）、`knowledgeQuerySource` thunk（实码 :2721）、`accessor.ts` 四 getter（:135-141）、`droraAgentService.ts` 反向分发（:1135-1141 thunk Pick 含 neighbors、:3633-3655 knowledgeNeighbors 分发）、`services/drora-extensions/knowledgeHost.ts`（D8 孤儿装配）、desktop `host/index.ts` knowledgeHost 装配段、`client/remoteServiceAccess.ts` 四 getter（:147-153,367-377）                                                                     | **删除**（无替代——服务已不在本体）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C8  | CLI：`core/src/tool/handlers/vault-search.ts` + 注册门、`bootstrap/src/drora-protocol/vault-search-port.ts`、`bootstrap/src/knowledge-evidence/`（gate + vault-config-reader）、`contracts/src/tools/vault-search.ts` **+ `contracts/src/tools/vault-neighbors.ts`（阶段一实码，评审 M7 补）**                                                                                                                                                                                                                                                                                                                                                       | **拆除**（工具迁插件 MCP 面 §4；gate 语义随迁插件工具内复验 §4.2；contracts 契约随插件工具 schema）                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| C9  | 设置页 `settings/model-capabilities/{DecisionJev,Embedding}CapabilityForm.tsx` + `ModelCapabilityDetail.tsx` knowledgeIndexService 复用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **拆除**（Jev 随 C1 迁移；配置走 userConfig，D8）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| C10 | 测试与登记：`packages/services/test/knowledge*+obsidian*`（**30 test 文件 = 25 node + 5 vitest Jev，逐文件归类核实**）+ **`knowledgeLeaseChild.mjs` 辅助进程文件随迁（终读评审 L10 点名）**、`packages/ui/test/` knowledge/vault 19 文件（逐文件去留见「C5 分流清单」）、`packages/client/test/remoteServiceAccess.test.ts`、desktop e2e r1-r9/G 系列/obsidian\*、CLI vault-search/gate 测试、`drora-test-files.json`/CI 清单对应条目                                                                                                                                                                                                                | **随实现迁移**（node:test 直连插件 server 模块，helper.mjs 同迁）或**重写**（E2E 改 webview 形态；C5a 渲染端测试保留改断言降级提示）；清单对账 P8                                                                                                                                                                                                                                                                                                                                                                                                              |
| C11 | **Jev/模型能力档案域（终读评审 M3 补，C9 之外的持 token 面）**：`shared/src/contracts/modelCapabilities.ts`（decision-jev 能力节点 :28-60、KNOWLEDGE_JEV_PROVIDERS、凭据键 builder `model-capabilities:decision-jev:*`）、`shared/src/validationAppSettings.ts:759`「Jev 出站决策」AppSettings 字段、`services/src/model-capabilities/*` Jev 段、`ui/src/lib/userActionTraceCatalog.ts:112-117` decision_jev 动作、`shared/src/test-ids.ts:538-556`、settings/model-capabilities/ 余文件（capabilityNav/useKnowledgeServiceAvailability/contract.example）                                                                                           | **随 C1 迁插件**（能力节点/凭据键改 userConfig 注入，D8）；AppSettings 字段删除 + 旧配置值迁移注记（丢弃或映射 userConfig，D8 裁定）；test-ids/traceCatalog 对应条目删除；settings 余文件拆除                                                                                                                                                                                                                                                                                                                                                                  |

### C5 分流清单（终读评审 M4，P7 执行与白名单登记的判定依据）

**本体消费面（rg -i knowledge 实测命中数）逐文件归属**：

| 文件                                                                                  | 归属                                                                                                      | 依据                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `v4/ConversationComposer.tsx`（35 处）                                                | **保留-改造**（发送链 knowledge 分支拆为「面板 openWith 路由 + 降级提示」，生产注入段拆除）               | 引用 chip/来源清单注入的发送链属 chat 面 |
| `v4/SessionPane.tsx`（2 处）                                                          | **保留-改造**（citation 打开路由改 g9 openWith）                                                          | 同上                                     |
| `v4/agentConversationTransport.ts`（2 处）                                            | **保留-改造**（wire 投影透传，evidenceRefs 写入段随 C6 删）                                               | 协议投影非 vault 实现                    |
| `v4/conversationProjectionStore.ts`（3 处）                                           | **保留-改造**（citation 投影消费）                                                                        | 同 C5a                                   |
| `lib/droraSessionProjection.ts`（8 处）                                               | **保留-改造**（投影序列化）                                                                               | 同上                                     |
| `v4/knowledgeCitationOpenFeedback.ts`（5 处）                                         | **保留-改造**（打开反馈改面板路由结果）                                                                   | C5a                                      |
| `v4/knowledgeEvidenceSendFailure.ts`（9 处）                                          | **保留-改造**（**D9 `legacy_evidence_unverifiable` 拒绝原因的 UI 消费端**——拒绝语义延续故消费端必须保留） | C5a + D9                                 |
| `lib/conversationKnowledgeSources.ts`、`lib/conversationSelectionReference.ts` 知识段 | **拆除**（C5b 生产端）                                                                                    | 面板内重建                               |

**ui/test 19 文件逐文件去留**：`knowledgeCitationMarkdown / knowledgeCitationNavigation / knowledgeCitationOpenFeedback / knowledgeCitationTransaction / knowledgeTurnCitations / messageResponseKnowledgeCitation / knowledgeEvidenceSendFailure / vaultQuoteRevealCodeMirror / knowledgeEvidenceVerification`（9 个，渲染/投影/失败语义端）**保留-改造**（断言降级提示与 openWith 路由）；`conversationKnowledgeSources / knowledgeAgentHandoff / knowledgeAskModel / knowledgeConnectionsModel / knowledgeConnectionsPanel / knowledgeInsightsModel / knowledgeInsightsHealth / knowledgeReviewProposalInput / knowledgeReviewView / knowledgeUiDiscipline`（10 个，生产端/面板模型）**拆除或随插件迁**（面板模型测试迁插件 UI 工程）。

白名单（平台接口，残留扫描豁免）：`contracts/src/plugins/`（PluginManifest/ui.surfaces 通用类型——**注意 hostServices/runtimeTopLevelPaths/uninstallKeepData 三键实际定义在 `bootstrap/src/app/official-plugin-definitions.ts:68-81`，该文件本身已在白名单，终读评审 L11 修正归属**）、`adapters/src/plugins/`（hostPanelId 分支拆除后契约测试锁定）、`shared/src/mcp-apps/`、`shared/src/plugin-marketplaces.ts`、`plugin-ui`/`plugin-ui-bridge` 通用桥（C5a 渲染面按文件白名单登记）、`bootstrap/src/app/official-plugin-{definitions,runtime}.ts`、obsidian-plugin 包本身、hooks 契约（`DRORA_PLUGIN_HOOK_COMMAND` 等）、**C6 legacy 探测器文件（input-intent-persistence/canonical-intent-replay/fork-edit-retry/session-flow 的 evidenceRefs 字面量，逐文件登记）**。

## 2. UI 重建：VaultView webview 形态

按 plugin-ui 现行契约（`packages/ui/src/plugin-ui/CONTRACT.md`）重建，**不可复用本体
React 组件**（i18n/主题/交互按插件页面能力重设计）：

- **形态**：插件 `dist/ui/panel.html`（React 独立打包，drora-site-plugin 先例）+
  manifest `ui.surfaces[]`（`availability:"session"` 沙箱页面——注意：阶段一的
  `availability:"app"` 宿主面板形态随 hostPanelId 一并废除，VaultView 回归现行唯一
  支持的 session 级；「无有效会话无面板」是真抽离下如实接受的能力差异，列 §11）。
  工具 `_meta.ui.resourceUri` 与 surfaces 共用沙箱与 AppBridge。
- **数据通道**：页面经 AppBridge 调插件 knowledge server 的 MCP 工具与
  resources/read（单次 ≤8MiB + MIME 白名单，`plugin-ui-bridge/CONTRACT.md:9-10`）；
  树/列表/检索结果按 **offset/limit 分页工具**设计（office-runtime
  `server.ts:239-244,370-373` offset/limit chunk 先例）；大文件读取走分段工具。
- **工具调用审批语义（评审 2 轮 H1，P5 等价性的前提）**：`plugin-ui/CONTRACT.md:13`
  明文「页面调用 MCP 的目标由宿主固定，复用 Agent 的权限和审批路径」——面板全部
  操作（保存/新建/改名/删除/批准提案/configureVault/startReconcile）都是工具调用，
  照搬该语义将使面板每次写操作弹 MCP 审批，与现面板「用户动作即授权、RPC 零弹窗」
  根本冲突。解法 = 平台扩展 **g10 面板用户动作工具信任分类**：宿主对来自插件面板
  页面的工具调用标记 `caller=panel-user-action`，经**宿主 authority 验证的官方插件
  描述符**分类放行——只读工具自动 allow；写类工具**不走 MCP 审批弹窗**（用户点击
  即授权：MCP 审批防护的是「agent 代表用户行动」，面板用户直接动作的被授权方就是
  用户本人，无第二次确认对象），破坏性操作（删除/批准提案）由页面内二次确认 UI
  承担 + 宿主审计日志。安全口径对账：该机制与 `core/src/mcp/index.ts:141-144`
  「自报 readOnlyHint 不构成信任锚，只有宿主 authority 验证过的官方 CUA 描述符才
  允许凭只读提示进入 low 档」同构——g10 以**宿主 authority 验证**（resolveTrustedOfficialCuaServerNames
  同款机制扩展，`mcp-config.ts:41-53`）取代 manifest 自报，不违反 agent-write-safety
  §5 收口口径。**未裁定/未落地前 P5 只重建只读面（浏览/检索/洞察），写操作如实
  降级并提示**（§11-D13）。
- **CSP**：默认禁 eval/wasm；页面如需语法高亮 wasm 资源 `_meta["zcode/csp"]` 显式申报
  （office-runtime 先例）；本轮按「页面纯 JS 高亮」设计免申报优先。
- **display modes**：`availableDisplayModes:["fullscreen"]`（面板型页面，inline 不
  适用）；后台保留 `_meta.ui.backgroundRetention:true` 按需申报——编辑器未保存态
  由页面自持久化草稿到插件 server（工具调用续活跃，`drora/activity` 语义
  CONTRACT.md:17），30 分钟回收前草稿已落盘。
- **主题/locale**：hostContext 现仅回传 width/maxHeight+widgetState（CONTRACT.md:14-15），
  **无主题/locale**——g4 附带扩展 hostContext 增 `drora/locale`/`drora/theme` 只读
  字段（本体 renderer 注入，防回环：页面只读不写）；扩展落地前页面内自管切换兜底。
- **行为等价基准**：四视图（notes/ask/insights/review）+ 树模型/滚动记忆/标题提交/
  wikilink 解析/LiveMarkdown 编辑（页面内换 CodeMirror 独立打包）/选区浮层/新能力
  N1-N4，对照 git HEAD `v4/VaultView.tsx` + vault/ 目录行为清单逐项验收（§9）。

## 3. 插件宿主服务进程：知识检索栈

- **形态**：obsidian-plugin manifest 增 `mcpServers`：`knowledge`（stdio，插件自带
  `dist/mcp/server.js`），官方定义声明 app 级常驻生命周期（g1，§6）；desktop 打包态
  经 `official-plugin-runtime` 既有 `__drora-plugin-host` 重写机制启动
  （ELECTRON_RUN_AS_NODE，`official-plugin-runtime.ts:100-118` 既有）。
- **承载**：C1/C2 迁入的索引（indexCoordinator/reconcile/FTS+BM25/向量混合召回）、
  bge 嵌入（onnxruntime-node 动态 import 缺模块降级语义原样）、证据 receipt、审核
  Proposal、vault 门面（obsidian-vault 迁入件）。vault-config/vault-focus 读写不变
  （本就在插件数据目录）。
- **数据目录**：`knowledge-index.sqlite`（v1-v6 全表）、向量存储、bge 模型全部落
  `<~/.drora>/cli/data/obsidian@drora-plugins-official/`（插件数据目录，DRORA_PLUGIN_DATA
  env 既有注入）；index_lease/fencing 随迁（进程内持有，g8 §6）。
- **并发模型（评审 2 轮 H2 修正）**：**DB 级 index_lease/fencing 原样保留**——代码
  随 C1 物理迁移零成本，继续按 knowledge.md §5b.3/A05（两真实进程 writer 竞争→旧
  fence 拒绝、TTL 接管可恢复）与 §5e.6（owner PID + 随机 token、「活跃或无法判定已
  死亡的 PID 不能被接管」「旧版本回退前停止所有 Host」）语义运行；g1 singleton 仅是
  **优化声明而非正确性前提**——仓库自身把多 Host 跨进程并发当受支持场景并有测试与
  条款锁定（knowledge.md:383,933），跨窗口/跨 Host/多 agent runtime 下插件 server
  可能多实例，写竞争防护必须继续由 DB 级 fence 承担，**不得进程内化**。hooks 进程
  仍只读配置文件；CLI gate 随迁后「第二只读 DB 连接」消失（§4.2），但只读连接消失
  不改变 fence 需求。
- **UI 服务面→MCP 映射（评审 2 轮 M8，P3 交付物）**：四服务 RPC 面以 MCP 工具 +
  resources 重暴露，映射清单随 P3 交付并逐项对验收（接口锚点：`knowledgeIndex.ts:23`
  IKnowledgeIndexService、`knowledgeQuery.ts:42` IKnowledgeQueryService、
  `obsidianVault.ts:96` IObsidianVaultService、review 服务接口）：
  - **读类 → MCP 工具**（offset/limit 分页）：listFiles/readFile（分段）/
    getStatus/getInsights/search/run 查询/neighbors/insights 快照/review 列表等。
  - **写类 → MCP 工具**（g10 信任分类，§2）：writeFile/createNote/rename/delete/
    setUserContext/configureVault/startReconcile/approve/apply/undo。
  - **流事件 → resources 订阅**：`onRunUpdated`（runGeneration+seq 递增流）映射为
    **资源订阅**（`resources/subscribe` 模板 `vault://runs/{runId}`，增量通知 +
    全量拉取兜底）；平台无订阅语义时降级为页面 **offset 轮询**（P2 设计时裁定，
    轮询间隔与活跃续期对齐 `drora/activity` 语义）。
  - **configureVault 根目录选择**：沙箱页面无文件系统——g9 宿主动作增
    `drora/openDirectoryPicker`（宿主 renderer 原生目录选择对话框，选中路径回传
    页面 → 页面调 configureVault 工具）；g9 动作清单由三扩为四。
- **onnxruntime 打包**（g7，终读评审 L13 补现状证据）：现依赖在
  `packages/services/package.json:34` 与 `packages/desktop/package.json:93`，
  obsidian-plugin package.json **无此依赖 → P3 必须先新增依赖声明**才能「插件
  node_modules 携带」（N-API .node 二进制）；按 browser-use 确定性子树先例登记
  `runtimeTopLevelPaths: ["node_modules/onnxruntime-node", ...]`（`definitions:239-243`
  同款纪律）；模型文件（~24MB）不进 seed（首用下载落插件数据目录，§5b.9 语义原样）；
  **asarUnpack 核对项已实证真实存在**：`electron-builder.config.js:661-666` 现仅
  node-pty/petSharp 条目、无 onnxruntime——P3 落实新增并回填证据。
- **明确不迁**：fs watcher 仍不做（维持「装配后延迟一次 + search TTL」两触发点语义，
  §5b.8）；Jev 的模型能力档案联动（热刷新/设置页）不再适用（§11-D8）。

## 4. Agent 工具迁移：VaultSearch / vault_neighbors

- **形态**：两工具变为插件 `knowledge` server 的 MCP 工具（schema 随迁 C8 契约），
  CLI 经既有 MCP client stdio 直连——**g3 的「传输机制」即既有插件 stdio MCP 通道，
  无需新传输**；server 由宿主常驻启动（g1），工具经进程内直连迁入的知识栈（不再是
  drora-protocol 反向请求，C7/C8 对应面删除）。
- **deferred tool 语义**（g3 缺口本体）：插件 MCP 工具现不支持 deferred（调研二 g3
  实证）——P2 平台扩展：manifest 工具级 `deferred: true` 声明（契约键收口
  contracts），运行时按 VaultSearch 现语义（`core/src/tool/handlers/vault-search.ts`
  shouldDefer 同形）延迟注册。落地前 vault_neighbors 不发布（VaultSearch 以 MCP 工具
  形态首发，deferred 缺失时表现为常驻工具——**这是用户/模型可感知差异（工具面常驻每会话 context），已列入 §9 已知差异⑧与 §11-D15，不静默**）。
- **权限**：插件 MCP 工具走 MCP 审批路径（默认 ask），与现状 VaultSearch「只读无审批」
  不同。降档策略（§11-D7）受成文口径约束：`core/src/mcp/index.ts:141-144` 明文
  「自报 readOnlyHint 不构成信任锚（specs/agent-write-safety.md §5 收口口径），只有
  宿主 authority 验证过的官方 CUA 描述符才允许凭只读提示进入 low 档」——manifest
  自报 `readOnly` **不构成**放行依据；D7 落地必须以**宿主 authority 验证描述符**
  （resolveTrustedOfficialCuaServerNames 同款机制扩展到 vault 插件，与 §2 g10 同一
  验证底座）取代自报，或正式修订该口径（二选一，P2 设计评审产出）。写入类能力仍走
  L1 hook/L2 Proposal（hooks 不变）。
- **Evidence 语义随迁**：receipt 签发/复验移入插件 server（工具结果内嵌已验证
  quote）；本体 wire `evidenceRefs` 字段与 CLI admission gate（C6/C8）拆除——agent
  携带证据的输入复验改由工具调用时序保证（handoff 文本经 g9 桥进入 composer 后走
  既有发送链，不再有 wire 证据引用）。这是行为收窄（S02 三层接线→工具内单层复验），
  如实记录于 §9 等价清单，最终取舍列 §11-D9。

## 5. 数据迁移（零手工）

- **vault-config.json / vault-focus.json**：已在插件数据目录，不动。
- **knowledge-index.sqlite（含 v2 receipts/v3 审核账本/v5 向量/v6 owner）+ 模型**：
  现位于 `<数据根>/.drora/knowledge/`，迁入插件数据目录 `knowledge/` 子目录。
  **物理迁移优先**（重建会丢 receipts 与审核账本，且首次重建全库索引成本高）。
  **时序（评审 2 轮 M4 修正：搬迁排在 P7 本体清除之后）**：双轨期（P4-P7）旧 host
  四服务/旧面板/CLI gate 仍读旧路径，搬迁未开始故不受影响；P7 拆除旧实现后，**新版
  插件 server 首启**检测旧路径存在且插件目录无 DB → 执行搬迁：先对旧库
  `wal_checkpoint(TRUNCATE)`（收敛 WAL 便于目录原子 move）+ 读 v6
  review_runtime_owners 做 **owner PID 活性校验**（有活跃 writer 即拒绝搬迁并提示
  关闭旧窗口后重试——复用既有 owner PID/token 机制，knowledge.md §5e.6），再
  move 目录 + 计数校验，失败回退保留原件并提示；迁移后 vaultId（realpath 根
  sha256，`sourceRegistry.ts:7,43-44`）与 configuredAt 不变 → 指纹/sourceEpoch
  不变 → 索引/向量/账本零损失零重建。旧路径留空壳不删（用户手工清理，spec 不自动
  删本体数据根目录）。两 spec 矛盾已消解：模型路径以 `localEmbeddingPort.ts:26-28`
  数据根口径为准，随本迁移一并进插件目录。
- **迁移门**：插件 server 工具面在迁移未完成时返回结构化 `migrating` 状态；P8 验收
  「升级后首启自动搬迁、零手工、数据计数一致」。

## 6. 平台扩展设计（缺口解法与先例证据；解不了的如实列）

| 缺口                   | 解法                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 先例证据                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| g1 app 级常驻服务      | 官方定义新增 `appService` 声明（宿主启动即拉起、独立于 session lease、崩溃重启、宿主退出收割）；**singleton 是优化声明非正确性前提**（评审 2 轮 H2）——P1 必须写明单例作用域与强制机制：宿主主进程级（每窗口不重复拉起）还是机器级（跨窗口/跨 Host 去重），**`packages/server/src/stdioServices.ts` 同为 createLocalServices 消费方（终读评审 M6）——server/stdio host 是否装配插件 knowledge server 必须在此裁定**（不装配 = server host 的 agent 工具面回退，入 §9 差异⑨），多实例并存时的行为（DB 级 fence 兜底，§3）                                  |
| g3 工具面迁移          | 工具进插件 stdio MCP server（传输=既有插件 MCP 通道）；deferred 语义平台扩展（manifest 工具 `deferred:true`）                                                                                                                                                                                                                                                                                                                                                                                                                                           | node_repl stdio 子进程先例（`mcp-config.ts:34,54`）；VaultSearch deferred 现语义（core handler shouldDefer）作为对齐基准                                                                |
| g4 沙箱数据通道        | offset/limit 分页工具 + 分段读取（设计约束，无需平台新代码）；hostContext 增 locale/theme 只读字段（小扩展）                                                                                                                                                                                                                                                                                                                                                                                                                                            | office-runtime offset/limit chunk 工具（server.ts:370-373）；hostContext 现状 CONTRACT.md:14-15                                                                                         |
| g7 原生模块打包        | runtimeTopLevelPaths 登记 onnxruntime-node 确定性子树 + electron-builder asarUnpack 核对回填                                                                                                                                                                                                                                                                                                                                                                                                                                                            | browser-use sharp 子树（definitions:239-243 注释）；§5b.9 核对项既列                                                                                                                    |
| g8 跨进程 DB 并发      | **DB 级 index_lease/fencing 原样保留（随 C1 物理迁移零成本），不进程内化**（评审 2 轮 H2 修正，撤销原「单实例→单进程」假设）：多 Host/多实例是仓库受支持场景（knowledge.md:383 A05 两真实进程 writer 竞争、:933 owner PID+随机 token、旧版本回退前停止所有 Host），写竞争防护必须继续由 DB fence 承担；singleton（g1）仅降低竞争概率                                                                                                                                                                                                                    | knowledge.md §5b.3/A05（:383）/§5e.6（:933）条款与测试锁定；现状 host 单写 + gate 只读 WAL 共存已验证                                                                                   |
| g9 宿主↔面板双向动作桥 | 平台扩展（**评审 2 轮 M5 修正**：页面→宿主会话通道**已有先例**，非全新机制）：页面→宿主白名单动作 `drora/openConversationHandoff`（依托既有 `updateModelContext` composer 投递先例扩展，CONTRACT.md:20）、`drora/openDirectoryPicker`（configureVault 根目录选择，§3 映射）、`drora/navigate`；**宿主→面板** `openWith(payload)`（C5a citation 打开路由：chat 点击引用 → 宿主打开 vault 面板并携带 receiptId，解析在面板内经插件 server 完成）。**citation 跨视图导航是真正的缺口**（双向传参均无现成机制），handoff 有 updateModelContext 先例、成本低 | 既有会话动作先例：CONTRACT.md:20 `sendFollowUpMessage`（走既有会话动作）/`updateModelContext`（投递 composer，非数据库状态）；页面→宿主通用动作与宿主→面板传参为扩展面，P2 先行设计评审 |

**P1 落地裁定（2026-11-11，建议值先行、待用户终裁）**：①singleton 强制作用域 = **宿主
进程级**——同一 host 进程（bootstrap create-app 每进程唯一装配点）内每 pluginId 至多
拉起一个 appService 实例，重复 start 复用既有实例；机器级去重不做，跨窗口/跨 Host
多实例是仓库受支持场景，写竞争防护由 DB 级 fence 承担（§3/g8），singleton 仅降低竞争
概率。②`packages/server/src/stdioServices.ts`（createLocalServices 独立装配链，
不经 bootstrap create-app）**不装配** appService：server/stdio host 的插件 server 与
VaultSearch/neighbors 工具面回退，即 §9 差异⑨（待终裁，推翻时另批接入）。③appService
在场门 = 插件启用态（禁用插件即停服务）；启用态在宿主启动期评估，运行中禁用/卸载
插件不即时停常驻实例（下一宿主启动生效）；hostComponents 三态开关仍只作用于本体注册门
（B3 遗留，P7 拆除后消亡）。④P1 只交付常驻生命周期机制本身；常驻实例与 per-session
MCP client 实例的关系（共享 writer vs 多实例+fence 兜底）由 P3 映射清单设计裁定。
⑤manifest 尚无 appService 所指 server 条目时（P3 落地前）启动链惰性跳过、不报错。

**P2 落地记录（2026-11-12，建议值先行、待用户终裁；批次快照与本节冲突处以本节为准）**：

- **g3 deferred 声明**：manifest 工具级 `mcpServers.<server>.tools.<toolName>.deferred:
true`。契约键单一出处在 `contracts/src/interfaces/mcp.port.ts`（`McpServerToolDeclaration`
  / `McpServerConfigBase.tools` / `McpToolDescriptor.deferred`）；解析在 adapters
  `resolveMcpServerConfig`（fail-closed：tools 形不合法禁用整台 server，条目只收
  `deferred` 键），消费在 `core/src/mcp/index.ts` createMcpToolEntry——`deferred:true`
  将该工具 metadata 的 alwaysLoad 归零，按 VaultSearch shouldDefer 同形语义进入
  tool-search 集合。**现状澄清（与 §4 原文出入）**：v3.16.1 上游 tool-search 合并
  （commit 7d7ee097f）后 MCP 工具缺省即 `shouldDefer:true`（`core/src/mcp/index.ts:202`），
  "插件 MCP 工具不支持 deferred"的前提已过时——缺省 deferred-eligible，server 级
  `alwaysLoad:true` 才常驻。因此 g3 声明的实际效力 = **工具级覆盖 server 级 alwaysLoad
  常驻**（优先级：manifest 工具级 deferred > 自报 alwaysLoad > server 级 alwaysLoad >
  缺省 deferred-eligible）；D15 的「常驻首发」由 P4 给 knowledge server 声明
  `alwaysLoad:true` 实现，VaultSearch/neighbors 收敛时加 tools 级 deferred 即可。
- **g4 hostContext locale/theme**：官方 hostContext 标准位本就有 theme/locale 且宿主
  已填充并随 host-context-changed 更新（spec 原文「无主题/locale」系误读 CONTRACT.md:14
  ——该行说的是 containerDimensions 只回传 width/maxHeight 防高度回环）。P2 按裁定字面
  落地 `drora/theme`/`drora/locale` 只读键：`buildPluginUiHostContext` 唯一构造点与标准位
  同源同步写入，页面只读（alias 无写回成员），不构成第二事实源。
- **g9 双向动作桥**：页面→宿主三动作 = `drora/openConversationHandoff`（composer 投递，
  与 updateModelContext 同通道、来源标记 `plugin-ui-handoff:` 独立）、
  `drora/openDirectoryPicker`（缺省 `IPlatformService.selectDirectory`，取消回
  `{path:null}`）、`drora/navigate`（P2 最小面仅 `kind:"surface"`，同插件清单声明校验，
  payload 随 openWith 转交）；均在 AppBridge 扩展方法位注册（与 ui/set-widget-state 同款，
  传输仍是既有 postMessage MessagePort，无新通道），按
  `experimental["drora/hostActions"].actions` 宣告（声明与 handler 一一对应，缺省 -32601）。
  宿主→面板 `drora/openWith {payload}` 通知：命令语义，握手前暂存、initialized 后补发
  一次；navigate 编排（解析 surface→开 tab→等页面准入→投递）接线在侧栏面板模型，
  工具卡片页不宣告 g9 动作（面板形态才是 g9 目标面）。沙箱侧 alias API 新增
  `openConversationHandoff/selectDirectory/navigate/onOpenWith`。契约键与运行时 schema
  单一出处：`shared/src/mcp-apps/contract.ts` + `schemas.ts`。**批次快照差异**：快照写
  `openWorkspaceCitation`，spec §6/§8 名单无此动作（citation 打开是宿主→面板 openWith
  方向），本批按 spec 落地三动作 + openWith；若终裁要 citation 独立页面→宿主动作另补。
- **D7 收口（P2，保守缺省待终裁）**：g10 信任分类不实施；检索类插件 MCP 工具维持逐次
  ask——`core/src/mcp/index.ts` needsApproval:true 现状即逐次 ask，P2 不加任何
  authority 验证降档路径；「宿主 authority 验证描述符取代自报」的自动 allow 方案
  （§11-D7 建议）留待终裁后另行落地，落地前不改变 agent-write-safety §5 口径。

**P3 落地记录（2026-11-12，建议值先行、待用户终裁）**：

- **C1/C2 物理迁入**：knowledge 栈 58 文件 → `obsidian-plugin/src/server/knowledge/`、
  obsidian-vault 门面 8 文件 → `src/server/vault/`，每文件头部注明迁自路径与 HEAD
  `bf872a6c0`；除头注释、services 内部件导入重指（descriptors/serviceLogger/paths →
  `src/server/platform/` 值等价副本；obsidian-vault → `../vault/` 同深度镜像）与下述
  D8 改点外，与 HEAD 逐字节等价（diff 机械校验 58/58 通过）。**双轨形态澄清**：本批
  迁入 = 插件侧收到唯一新实现；本体 `packages/services/src/{knowledge,obsidian-vault}`
  原件原样保留（§5「旧 host 四服务仍读旧路径」的实现载体），P7 随 C7 一并拆除——
  避免本体经反向依赖引插件实现（依赖方向与 bundle 面均不可行）。两实现共用数据库时
  写竞争由 DB 级 index_lease/fencing 仲裁（g8 原样随迁，未进程内化，零改动验证）。
- **knowledge MCP server**（`src/mcp/server.ts` → `dist/mcp/server.js`，esbuild
  自包含 bundle）：§3 映射全量 1:1 落地——51 服务方法 + 1 元状态工具共 52 工具，
  onRunUpdated → `vault://runs/{runId}` 资源订阅（SDK 原生 subscribe/updated 通知 +
  `get_run` 全量拉取兜底）；映射清单逐项对验收文档 `obsidian-plugin/docs/
knowledge-mcp-mapping.md`（含 onRunUpdated 订阅/轮询裁定与 g9 四动作消费关系）。
  真实 stdio 冒烟（@modelcontextprotocol/client pin 2026-07-28 modern era）通过。
- **D14 状态机**（`src/server/platform/dataPaths.ts`）：legacy（连旧路径）/ plugin /
  dual_db_conflict 三态按文件系统事实判定；两库并存 → 数据面拒绝（结构化冲突状态 +
  人工取舍提示，不静默合并）；**无库首建落旧路径**（双轨期旧 host 仍在旧路径开库，
  插件侧抢先建插件目录即自造 conflict；P6 搬迁批次落地后切插件目录缺省）。`migrating`
  状态键预留、P3 不产生。
- **D8 改点（迁入件内）**：`decision/jevAssembly.ts` 凭据读取器缺省不再自建 services
  credential 实例（插件进程不链接 services 包，依赖方向约束）；未注入即 fail-closed
  关闭（与 K-JEV-8 凭据缺失同语义）。本体侧原件行为不变；插件 Jev userConfig 静态化
  接线归后续批次。5 个 Jev vitest 随迁后全绿（均注入 fake，不依赖缺省路径）。
- **manifest 0.4.0 + appService 生效**：`.zcode-plugin/plugin.json` +mcpServers.
  knowledge（stdio，`${DRORA_PLUGIN_ROOT}/dist/mcp/server.js`）；官方定义 0.3.0→
  0.4.0，P1 的 `appService:{server:"knowledge"}` 声明自此实际生效。ui.surfaces 现状
  （app 级宿主面板）不动——webview session 形态是 P5、hostPanelId 拆除是 P7（C4）。
- **g7 打包面**：obsidian-plugin 新增依赖 `onnxruntime-node`/`onnxruntime-common`
  （双双钉死 1.30.0——common 是 binding.js 运行时 require，两棵子树必须同版随行；
  adm-zip/global-agent 仅装期脚本用、不进运行时闭包）；定义 runtimeTopLevelPaths
  登记两棵子树；desktop staging 新增 `stageOnnxruntimeIntoBundledAgents`（bin/
  napi-v6 按平台+架构双层修剪，与 sharp「按目标平台重产」同纪律）；electron-builder
  asarUnpack 回填 `node_modules/onnxruntime-node/**`（desktop 自带侧，P7 随本体清除
  退役）。模型文件（~24MB）不进 seed（§5b.9 首用下载语义原样）。
- **测试随迁（C10）**：25 node:test + 5 vitest Jev + `knowledgeLeaseChild.mjs` +
  5 个 review/semantic fixtures → `obsidian-plugin/test/`（迁后路径全绿，含 D8 收窄
  后的 Jev 件）；`node-unit-test-files.mjs` 发现 glob 扩至
  `apps/drora-cli/packages/*/test/**`（内容过滤器继续排除 vitest 套件）；
  `drora-test-files.json` 5 条 vitest 路径同步改指。新增
  `knowledgeMcpServer.node-test.ts`（52 工具面 + 订阅模板 + D14 legacy/conflict 双态
  隔离冒烟，入保留集）。
- **架构门禁收口（P3 第 2 次尝试，2026-11-12）**：首跑 `architecture:check --changed`
  63 条 unmanaged-new-file（src/server 62 + src/mcp 1，新文件不得落未受管模块 drora-cli）。
  处置：①`architecture:adopt obsidian-plugin-server`（roots = src/mcp + src/server，
  requires 自动推断 rpc/shared，owner plugin，adapters 单层；产物四件套落 src/mcp/，
  contract/CONTRACT 按 P3 语义填写）；②自身新文件 src/mcp/server.ts 983 行超
  max-fileLines=800 → **拆分**为 tools.ts（782，工具注册表）+ server.ts（217，接线与
  生命周期），纯机械搬移，MCP 冒烟双测复跑通过；③迁入件 reviewEngine.ts（1620 行 +
  文件头既有 eslint-disable max-lines）按「与 HEAD 逐字节等价、迁移期不拆不摘」纪律
  登记 max-file-lines/disable-count 例外（本体原件 P7 拆除时一并处置）；④检查器 cycle
  规则修复：type-only 边（`export type` re-export ↔ `import type`，knowledgeTypes ↔
  evidenceRegistry，HEAD 既有单一出处 re-export 模式、无运行时环）误报循环依赖——
  按工具自身「type-only 不产生运行时依赖」口径，环检测改用非 type-only 边
  （scripts/architecture/index.mjs cycleEdges；既有运行时环测试复跑通过）。收口后
  `architecture:check --changed` = OK / violations 0。
- **gate 拦路缺陷（非 P3 范围，就地修复留证）**：HEAD bf872a6c0 的
  `prepare-agent-node-bundle.mjs` 残留一个 node-repl-host 半改名重复条目（携 drora-
  site 的 requiredRuntimePaths/stagedPath），使 desktop 打包链在 HEAD 上必然失败
  （断言永不产出的 node-repl-host/dist/server.mjs）。整条删除，修复注释含证据链。

**P4 落地记录（2026-11-12，建议值先行、待用户终裁）**：

- **Agent 工具面（§4）**：`vault_search` / `vault_neighbors` 落进插件 knowledge
  server（新注册表 `src/mcp/agent-tools.ts`；server.ts 装配合并，工具面 54 = 52 服务
  面 + 2 agent 面；agent-tools → tools 单向依赖，无运行时环）。C8 契约随迁：插件侧
  携带完整入参 schema 副本（strict 拒未知键、query/notePath ≤512、limit 1-10，与
  HEAD contracts 同形），出站白名单经 `vaultSearchProtocol.ts` 同一收口；P7 C8 拆除
  后该副本即唯一契约位。`vault_search` 的 limit 是 C8 兼容位——检索服务按自身缺省
  截断，与 HEAD 反向链路（host 分支不消费 limit）等价，不做新截断。
- **evidence 工具内复验（§4.2/D9 建议值先行）**：`vault_search` 逐候选在调用时刻对
  当前文件复验（门面 readFile → fileSha256 → quoteSliceSha256，与
  `prepareEvidenceFromRun` 同一道核验、只复验不签发 receipt），候选新增
  `evidence:{status: current|stale|missing}` 注解——旧三层接线（工具未验证摘录 →
  prepareEvidence → CLI admission gate）收窄为工具内单层的可观察面；
  `vault_neighbors` 不加注解（相似是向量事实非引用核验，HEAD 同口径）。本体 wire
  收窄面（evidenceRefs 字段 deprecated 化/CLI admission gate 拆除/最小 legacy
  探测器）仍按 C6/C8 归 P7，本批未动。
- **D15 常驻首发**：manifest `mcpServers.knowledge` 就地补 `alwaysLoad: true`
  （0.4.0 分支内未发版，不另起版本号；官方定义注释同步）→ 54 工具随 server 常驻每
  会话 context（§9 差异⑧如实呈现）。deferred 收敛 = 双轨下线时在 manifest 加工具级
  `tools.vault_search.deferred: true` 等（P2 g3 机制，优先级压过 server 级
  alwaysLoad），工具实现零改动。D7 保守缺省不变：两工具随 MCP 工具缺省
  needsApproval 逐次 ask，未加任何 authority 降档路径。
- **CLI 双轨（切换期）**：旧面 6 文件标 deprecated（contracts 两契约 + 端口接口 +
  core 两 handler + bootstrap 协议端口实现），注册门（includeVaultSearch/
  includeVaultNeighbors 双条件）与运行时行为零改动——旧面继续经 drora-protocol 反向
  请求读旧路径（§5 时序：搬迁未开始，不受影响）；双轨期 CLI 内建 `VaultSearch`/
  `vault_neighbors` 与插件 MCP 面（模型侧名 `mcp__plugin_obsidian_knowledge__*`）
  并存。P7 随 C7/C8 拆除。
- **gate 执行**：插件工具契约测试 `test/knowledgeAgentTools.test.ts` 8 用例（入参
  契约随迁/白名单+evidence 三态/no_source/neighbors 直通与降级/dual_db_conflict
  拒绝/D15 manifest 断言）全绿；P3 冒烟 `knowledgeMcpServer.node-test.ts` 更新为
  54 工具面后全绿（bundle 重建）；CLI 双轨定向 `vault-search-handler`/
  `vault-neighbors-handler`（node:test 8 用例）与 `tool-contracts`（vitest 43 用例）
  全绿；插件包 tsc --noEmit 通过。

**P5 落地记录（2026-11-12，建议值先行、待用户终裁）**：

- **panel.html React 四视图（只读面）**：`src/ui/`（panel.html 壳 + main/NotesView/
  AskView/InsightsView/ReviewView/host/i18n/model/parts），esbuild 单文件内联到
  `dist/ui/panel.html`（~1.3MB，drora-site build 先例；构建入口 `scripts/build-ui.mjs`
  并入 build-runtime 聚合）。四视图语义对照 HEAD `v4/VaultView.tsx`+`vault/`：树模型/
  滚动记忆/wikilink 解析（根精确>当前目录>唯一后缀）/分段读取/N2 建议过滤（近邻−已链接）
  /N1 lookup 横幅派生均为纯函数重建（`src/ui/model.ts`，node:test 直测）。
- **数据通道 = resources/read（非工具）**：面板全部数据经 `ui://obsidian/data/*` 资源
  端点（`src/mcp/uiResources.ts`，13 端点统一 `{ok,data|error}` 封套 + offset/limit
  分页/分段）。依据：页面工具调用复用 Agent 权限链逐次弹审批（bootstrap mcp-ui
  handlers.callTool → authorizeAppTool → resolveToolPermission），D7 保守缺省下浏览/
  检索不可用；drora-site「读走资源不弹窗」+ office-runtime chunk 全资源为既有先例，
  §2「页面经 AppBridge 调 MCP 工具与 resources/read」的资源侧即本面（工具侧待 g10
  终裁后随写操作面接入）。端点逐项对验收表在 `docs/knowledge-mcp-mapping.md` 末节。
- **D13 保守缺省的降级边界（如实）**：编辑器（CodeMirror/LiveMarkdown）、标题提交、
  新建/改名/删除、N2 一键插入、N3 确认插入、审核 approve/apply/reject、configureVault
  写入、startReconcile/requestRebuild 均不交付——UI 就位但降级提示（i18n
  `vault.degraded.write`），不放死按钮；g9 `openDirectoryPicker` 已接线（未配置引导
  可选目录），写入半段同属降级提示。
- **g9 双向桥接**：handoff（ask 候选「交给 Agent」→ `drora/openConversationHandoff`
  投递 composer，语言中立来源清单文本）；citation（宿主 `drora/openWith
  {kind:"citation",receiptId}` → 面板 `data/citation` 解析 → notes 定位原文行，
  current/stale/missing 分支呈现）。
- **locale/theme**：hostContext 标准位 + `drora/theme`/`drora/locale` 只读键（P2 落地）
  双源读取，`applyDocumentTheme`/`applyHostStyleVariables` 跟随；页面无写回成员。
- **草稿（backgroundRetention）**：面板资源 `_meta.ui.backgroundRetention:true` 申报；
  视图/打开笔记/检索草稿/树展开态防抖 400ms 经 `ui/set-widget-state` 落宿主内存，
  回收重建时 `hostContext["drora/widgetState"]` 下发恢复（e2e 实证）。**「自持久化到
  插件 server」形态未交付**（写通道是工具调用，D13 保守缺省下逐次弹审批不可用）——
  随 g10 终裁后的写操作面补批，如实记录不假装。
- **manifest 0.4.0（分支内演进）**：ui.surfaces 从 `availability:"app"+hostPanelId`
  切换为 `availability:"session"+server:"knowledge"+resourceUri:"ui://obsidian/panel.html"`
  （app 形态声明来源消失，本体 hostPanel 机制与入口成死面，P7 随 C4 拆除；投影测试用
  合成 fixture 不受影响）。官方定义 requiredSeedPaths 增 `dist/ui/panel.html`；
  architecture 模块 obsidian-plugin-server roots 增 `src/ui`。
- **gate 执行**：插件构建（tsc+esbuild 三产物）通过；`test/vaultUiResources.test.ts`
  （4 用例：面板 meta+conflict 封套/分页分段只读端点/N1 lookup+幂等/citation 落空）
  与 `test/vaultPanelModel.test.ts`（8 用例）node:test 全绿；沙箱页面 e2e 走 desktop
  mcp-apps fixture 新 `--obsidian-only` 模式（`obsidian-main.ts`：真实 knowledge
  server + 真实构建面板过真实 agent/bridge/沙箱链，showcase 先例）——launcher（vault
  概要经无审批资源读取呈现）/display modes（fullscreen-only：inline 槽只渲染插件卡、
  侧栏锚点页面可见）/notes 浏览（树缺省折叠→展开、分段读取、wikilink 渲染）/N1
  lookup+g9 handoff（真实 host-action 事件含来源路径）/后台回收草稿保护（草稿落宿主
  widgetState store；retained 页隐藏+期限到期不销毁（`canRecycle` 仅在 >4 后台页容量
  压力下逐出，CONTRACT.md:17），重开同 guest 草稿原样在位——逐出/重建路径由平台
  retention 基线「five retained MCP pages evict one after thirty minutes」覆盖）。

**P6 落地记录（2026-11-12，建议值先行、待用户终裁）**：

- **首启自动搬迁执行器**（`src/server/platform/knowledgeMigration.ts`，§5 步骤逐条）：
  状态机解析 legacy（仅旧路径有库）→ ①对旧库 `PRAGMA wal_checkpoint(TRUNCATE)`（读
  返回行，busy=1 即拒搬；开库 SQLITE_BUSY 同语义）→ ②读 v6 `review_runtime_owners`
  做 owner PID 活性校验（活跃/不可判定死亡 = 活跃 writer → 拒搬 + 结构化 ownerPids
  提示关旧窗口重试；谓词与 reviewRuntimeOwnership.ts definitelyDead 同语义本地副本，
  只观察不接管，不改迁入件）→ ③枚举旧目录全部文件 move 到 `<插件数据目录>/knowledge/`
  （普通文件先搬、SQLite 主库绝对末位——中断时状态机仍解析回 legacy、下次启动幂等
  续搬；rename 优先、EXDEV 回退 copy+字节数校验+unlink）+ 计数校验（搬后旧目录
  0 文件、目标主库在位），任一步失败逆序回退保留原件 → ④旧目录留空壳不删。并发
  首启串行化：旧目录内 `.drora-knowledge-migration.lock` 文件锁（wx 独占 + PID/host
  判死破残锁）——resident appService 与会话级实例同秒首启时互不交错；对端搬迁中
  → blocked_concurrent，server 侧 500ms×30 轮询收敛（对端完成即重解析 plugin 态）。
- **server 首启接线**（`src/mcp/server.ts`）：serveStdio 先行注册（迁移进行中工具面
  可达），legacy 态 dataPlane=null + migration running → 数据工具/面板数据端点结构化
  `migrating` 拒绝、`knowledge_server_status` 如实呈现 phase；搬迁收敛后**原位切换**
  context 三元组（completed→plugin 数据面；blocked_active_writer/blocked_busy/failed
  →legacy 原件继续服务 + migration 原因；blocked_concurrent 超时→数据面保持拒绝，
  不建 legacy——防惰性开库在旧路径造空库自造 dual_db_conflict），run 更新流经
  attachRunEvents 幂等补挂。**已知边界（如实）**：搬迁期间另一实例若恰在搬后惰性
  开库，旧路径会新建空库 → 下次启动按 dual_db_conflict fail-closed（人工取舍、无
  数据损失）；锁 + blocked_concurrent 不建 legacy 数据面已把该窗口收窄到双重巧合。
- **无库首建切插件目录**（dataPaths.ts，撤销 P3 旧路径首建缺省）：P7 后旧 host 已
  不存在、旧路径不再有人开库，继续落旧路径只会给下次升级制造多余搬迁。既有断言
  同步更新（knowledgeMcpServer/vaultUiResources 两测试的无库态期望 legacy→plugin）。
- **工具面/资源面 migrating 结构化状态**：requireDataPlane 区分 D14 冲突与 §5 迁移门
  （MigrationPendingError 携带 `{status:"migrating",phase,reason}`）；uiResources 数据
  端点统一 dataPlaneUnavailableResult 封套（conflict/migrating 同构，面板按 code 呈现）。
- **gate 拦路缺陷就地修复（非本批范围，留证）**：P7 第 2 次拆分把共享骨架留在
  tools.ts 形成 tools.ts ↔ tools-vault.ts 模块环——esbuild bundle 摊平掩蔽（MCP 冒烟
  走 bundle），src 直连导入（node:test/tsx ESM 求值）在 tools-vault 模块体求值期访问
  未初始化 pagingSchema 即 TDZ 崩溃，P6 迁移单测首跑实证（基线
  `knowledgeAgentTools.test.ts` 同样失败）。按 P7 拆分自身「共享骨架单一出处」意图
  抽出 `tool-shared.ts` 消环（tools.ts → tools-vault.ts → tool-shared.ts 单向），
  tools.ts 再导出维持既有导入面；基线失败测试复跑恢复全绿。另：P3 冒烟文件名
  `knowledgeMcpServer.node-test.ts` 后缀不匹配任何保留集发现 glob（`*.test.ts`/
  `*.node-test.mjs` 均不命中，P3 手工直跑未暴露）→ 改名 `knowledgeMcpServer.test.ts`
  纳入 `test:unit:node`/`test:drora` 发现面。
- **D6（升级，建议值先行）**：`resolveOfficialPluginUninstallKeepData(pluginId, explicit)`
  取代旧「显式参数优先」默认解析——obsidian 声明 `uninstallKeepData:true` 后**强制
  保留**（显式 `keepData:false` 不生效；数据目录现含知识库+模型，rm 即全库丢失），
  未声明插件维持全局语义；卸载链路两处调用点（marketplace 记录分支 + 内置抑制分支）
  同步收口。卸载 UI 明示：`DroraInstalledPluginSummary` 增 `uninstallKeepData` 投影
  （shared schema optional 字段 + bootstrap toInstalledPluginData 填充），三处卸载
  确认弹窗（PluginsSection×2/PluginStorePage）经 usePluginUninstall 的
  `pendingKeepsData` 切换专用文案 `confirmDescriptionKeepData`（zh/en 双语：明示
  「数据目录（含知识库索引与嵌入模型）将保留，重装可直接恢复」——提示与 CLI 侧行为
  不允许各说各话）。
- **gate 执行**：迁移单测 `test/knowledgeMigration.test.ts` 6 用例全绿（completed+
  计数一致+字节/行级零变化 / 活跃 writer 拒绝不动文件 / 中断续搬幂等 / 失败回退
  原件保留 / 锁互斥+残锁判死 / migrating 结构化拒绝）；server 冒烟
  `knowledgeMcpServer.test.ts` 3 用例全绿（54 工具面+无库态 plugin 首建 / conflict /
  **升级冒烟**：真实 bundle + 真实旧库首启搬迁收敛 + 数据计数一致 + 旧目录空壳）；
  `pnpm test:drora` 官方入口逐文件真实执行（node:test 路由）；D6 vitest
  `official-plugin-uninstall-keep-data.test.ts` 4 用例全绿（bootstrap 包原生 runner）；
  手工升级冒烟（真实 MCP client stdio + 隔离数据根）另跑一遍全链路：升级前 2 文件
  →首启 ok/plugin→旧目录 0 文件、插件目录 2 文件、sources 1 行/documents 42 行/
  fingerprint 不变→二次启动直连 plugin 态；附带 `vaultUiResources`（4）/`vaultPanelModel`
  （8）/`knowledgeAgentTools`（8，消环修复后基线恢复）全绿；插件包/shared/bootstrap
  tsc 通过，ui tsc -p 通过，oxlint 改动文件 0 告警（全量 7 告警均为未触碰文件的
  基线遗留）。**批次快照差异**：快照写「host 停旧服务」——§5 时序（评审 2 轮 M4）
  为「P7 拆除旧实现后仅新版首启搬迁」，本批按 spec：无停服步骤，仍开着的旧版本窗口
  由 owner PID 活性校验兜底（拒搬 + 提示，下次启动重试）。

**P7 落地记录（2026-11-12，建议值先行、待用户终裁；记录条目均为 P8 收尾批实读/实跑验证的事实）**：

- **本体清除 C3-C10 全清单执行**：C3（v4/VaultView + v4/vault/ 34 文件）、C5b 生产端
  （conversationKnowledgeSources/knowledgeAgentHandoff/knowledgeAskModel/knowledgeCitation
  Navigation|Transaction/knowledgeReview*/knowledgeInsights*/vaultQuoteReveal 等 ui/test 19
  文件分流拆除）、C6（CLI gate：evidence-gate/vault-config-reader/evidence-session-wiring
  测试；wire evidenceRefs 字段 deprecated 保留 + 最小 legacy 探测器 = 改写后的
  knowledge-user-input-provenance.test.mjs，3 用例 P8 实跑全绿：新账本不持久化 refs、
  旧账本条目仍可投影、伪造形状 fail-closed）、C7（node.ts 四 .register/accessor 四
  getter/client 四 getter/knowledgeHost 装配段）、C8（core 两 handler + 契约两文件 +
  bootstrap 端口）、C9/C11（设置页两表单 + modelCapabilities decision-jev/embedding
  purpose 收窄三类 + AppSettings Jev 键丢弃，迁移注记在 modelCapabilities.ts 头注释）。
- **C4 hostPanel 形态整体拆除**（git status 实证 D）：host-panel-registry/useHostPanel
  Surfaces/plugin-ui-surfaces app 级投影分支/`availability:"app"` 联合成员；拆除验证 =
  adapters 契约测试（`tests/plugin-ui-surfaces.test.ts`：PluginUiSurfaceAvailability 仅
  "session"、`availability:"app"` 与 hostPanelId 一律解析拒绝并记诊断——官方插件声明也
  不例外；P8 实跑随 adapters 包全量绿）。
- **残留扫描门禁落地**：`scripts/check-vault-extraction-residuals.mjs`（17 token ×
  八包，注释剥离 + 白名单逐条 path+token+原因 + 白名单孤儿检查），并入
  `verify:pre-push` 链首（package.json scripts）；P8 实跑 = **7904 文件白名单外零命中**
  （白名单现仅 obsidian-main.ts 夹具一条——C5a 渲染面/C6 探测器实测无 token 残留，
  无需登记）。
- **CI/清单对账**：ci.yml vitest 行收窄为 C5a 保留 7 文件、node --test 行 25 条改指
  obsidian-plugin/test（P8 复核全存在）；drora-test-files.json 同步（P8 复核 280 条全
  存在）；`node-unit-test-files.mjs` 双 glob 发现面（P8 复核 30 node 文件、5 Jev
  vitest 零泄漏）。

**P8 落地记录（2026-11-12，建议值先行、待用户终裁）**：

- **i18n 键迁移**（§10-P8 行）：本体 `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`
  的 `vault.*` **342 键×2 删除**（P7 后零引用死键）+ `workspace.openVault`（C4 侧栏
  入口槽键，零引用）一并清理；`grep -c "vault\."` 复核两文件归 0；locale parse 校验
  （esbuild loader=ts）通过；C5a 渲染面键（chat.selections.evidenceOpen.* /
  chat.knowledgeTurn.*）保留（消费端 KnowledgeAnswerSources 等仍在）；插件页面资源
  `src/ui/i18n.ts`（P5 建 192 键×zh/en）为 vault 面板文案唯一资源位。
- **E2E 重写**（webview 形态等价场景）：`packages/desktop/scripts/mcp-apps-host-fixture/
  obsidian-main.ts` 在 P5 四场景后追加四组——R1-G01（索引任务 completed+覆盖文件数
  精确 3）、R1-G02/G58+R2 加严（唯一句 bigram 检索：候选路径/行区间覆盖唯一句行/
  摘录含原文 + 定位跳转 notes 目标行 + handoff 文本携带路径/行号/摘录）、R3/R9/G28
  （citation openWith 全分支：真实 prepare_evidence 签发 receipt → current 定位原文；
  改原文 → stale 结构化提示；删原文 → missing；未知 receiptId → 服务端 forbidden →
  面板 missing 分支呈现）、R7-G31（review 视图 L2 写门只读呈现默认关）；watchdog
  480s→720s。工具面通道裁定留证：`mcp/uiCallTool` 需 App connection（namespaced
  server 归属），fixture 会话直挂名下实证长挂（无审批请求到达）——P8 改独立 MCP
  client stdio 直连 knowledge server（P6 升级冒烟同款；多实例 DB fence 仲裁 = g8
  受支持场景）。**执行结果 9/9 场景 PASS（exit=0）**。已收窄面（R2 chip/admission、
  R4 队列复验、R6 来源清单、G25/G30 chip 提示、g-interleaving 旧 hook 面）不伪造
  等价——逐项映射与依据见
  `apps/drora-cli/packages/obsidian-plugin/docs/phase2-p8-capability-parity.md` §3。
- **能力等价逐项复跑**（§9）：验收记录落
  `obsidian-plugin/docs/phase2-p8-capability-parity.md`（§4 查询/§5 Evidence/§5b 索引/
  §5c 四视图/§5d Jev/§5e 审核/§5f VaultSearch/§5g 洞察/§5h N1-N4/hooks 1-21 逐节
  命令与结果 + 九项差异按 D7-D15 裁定呈现）。实跑汇总：插件包 30 node:test 全绿
  （203 用例 pass/1 环境条件 skip）、Jev 5 vitest 31 用例绿、C5a 渲染 7 文件 40 用例
  绿、hooks 三件套（agent-access/permission-path-policy/hooks-e2e）全绿、adapters 包
  全量 182 文件 2590 用例绿、bootstrap 包 obsidian 面全绿（app-service 7/plugins 47/
  runtime-features 9/ui-surfaces 5/uninstall-keep-data 4/provenance 3）。
- **三 spec 回填**：本节 + `specs/obsidian-knowledge.md`（§5.5/§5f.3 等验收映射按
  阶段二形态补注记，§1b 标注阶段二完成态）+ `specs/obsidian-plugin.md`（头部 B 系列
  标注更新为阶段二真抽离完成态）。
- **CI 清单重对账**：drora-test-files.json 280 条、ci.yml vitest 7 条 + node --test
  25 条、node-unit 发现面（30 node/5 vitest 分流）逐一复核现存一致，零死条目。
- **基线失败如实呈报（非本战役引入，均已归属到 HEAD 已提交战役）**：bootstrap 6
  用例（endpoint 版本头——HEAD 实证 `endpoint.ts:141` 为 `X-Drora-App-Version` 而测试
  期望 `x-zcode-app-version`，bf872a6c0 改名漏改；slash-commands `vi is not defined`；
  persona/session-facade/fault-matrix 时序类，六文件零工作区 diff）；`test:drora`
  3 用例（voice 契约 `globalDictationEnabled` ← 22038fc10、ui-team `session-line.ts`
  ← bf872a6c0，两测试文件零工作区 diff）。按「保留与任务无关的本地改动」纪律不在
  本批处置。
- **desktop e2e 全量（附加 gate）如实记录**：32 worker 全量跑 65 分钟被宿主环境
  SIGTERM 终止于 21%（92 spec：76 过/16 败；16 败零 vault/obsidian 交集、全为
  高并发时序类）。定向补跑插件域：plugin-mcp-skill-installed-enabled 与
  plugin-management-persistence-source **PASS**；plugin-management-builtin-inline
  与 plugin-management-installed-menu-layout 失败于重启后工作区就绪等待（运行时
  日志显示 app 已恢复、同 restart 链对照通过 → 恢复时序窗口敏感；无 HEAD 基线可
  对照、与 appService 启动链是否相关未定论，列终审复核）。`verify:pre-push`：
  首关 `check-push-worktree` 与 `test:engineering:affected --scope push` 要求干净
  工作区（施工会话禁止 git 写操作 → 结构性不可执行）；其余链分解执行全绿
  （残留扫描 OK / remote-targets skip / lint 0 err / stale-phrases 0 / db-schema
  兼容 / test:architecture 52 用例 / architecture:check --changed violations 0）；
  `--scope worktree` = 158/158 全选中按设计跳过（exit 0）。明细见
  `obsidian-plugin/docs/phase2-p8-capability-parity.md` §5-§6。

**做不到/不做的（如实）**：Web/远程 workspace 的插件 UI 仍不支持
（plugin-ui-bridge CONTRACT.md:10 只支持本地 workspace Agent）——VaultView webview
形态同样受限，与阶段一 hostPanelId 时「随 renderer 天然 Web 可用」相比是回退，终裁
形态下如实接受并列 §11；fs watcher 不做；宿主面板 hostPanelId 形态废除。

## 7. 阶段一成果处置表

**起点事实**：阶段一批次 B1-B6 已在本工作区落地实码（git status 实测 83 文件
+2690/-259 行：hostPanelId 宿主面板注册表 `packages/ui/src/plugin-ui/host-panel-registry.tsx`
与 `useHostPanelSurfaces.ts`、vault_neighbors 契约与 handler
（`contracts/src/tools/vault-neighbors.ts`、`knowledge/query/knowledgeNeighbors.ts`）、
启用键上移 `shared/src/contracts/pluginEnablement.ts`、listUiSurfaces 投影三态合成
分支等）——下表「拆除/改造」的对象是这些**已落地实码**，不是纸面设计；工作量估算
与批次 scope 以此为准。

| 阶段一成果                                                           | 处置                                     | 理由                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 ui.surfaces app 级宿主面板形态（hostPanelId+注册表）              | **拆除**                                 | VaultView 改 webview surface；session 级沙箱页面是现行唯一支持形态，自定义形态成为死代码                                                                                                            |
| B1 启用状态键上移 shared + 三态合成读取器（suppressedBuiltins 语义） | **保留**                                 | 平台通用机制；hooks 与宿主能力开关两层模型仍需要（D1a 延续）                                                                                                                                        |
| B1 官方定义 hostServices 键                                          | **改造**                                 | 归属声明对象从「本体服务」改为「插件自带 server 组件」；仍属官方定义元数据                                                                                                                          |
| B1 uninstallKeepData（D6-a）                                         | **保留并升级为关键**                     | 插件数据目录现含知识库+模型，keepData 语义错误即全库丢失（§11-D6 升级）                                                                                                                             |
| B2 manifest 0.3.0（componentTypes/hooks/skills）                     | **改造**                                 | 演进 0.4.0：+mcpServers(knowledge server)+ui.surfaces(webview)+runtimeTopLevelPaths+deferred 声明                                                                                                   |
| B3 本体装配条件化（构造级短路/三态合成接线/renderer 注册表驱动）     | **拆除**                                 | 本体装配与组件随真抽离整体清除（C7）；三态合成读取器作为平台件保留于 B1 项                                                                                                                          |
| B4 CLI 注册门双条件                                                  | **拆除**                                 | 工具迁插件 MCP 面，includeVaultSearch 门无对象                                                                                                                                                      |
| B5 vault_neighbors core handler+反向协议                             | **改造**                                 | 能力逻辑随 C1 迁插件 server，工具形态改 MCP（§4）                                                                                                                                                   |
| B6 N1-N4 能力逻辑                                                    | **改造**                                 | 逻辑随服务进程；UI 段在 webview 重建（N2/N3/N4 写入仍走 L1/门面 CAS/L2 分级，语义不变）                                                                                                             |
| B7 清单对账                                                          | **改造**                                 | P8 按 C10 重对账                                                                                                                                                                                    |
| D1a 宿主能力独立开关（缺省开）                                       | **保留**                                 | 语义映射为「插件 hooks 缺省关 + server/面板随 appService/ui.surfaces 在场」；用户可关                                                                                                               |
| D2 Jev 留模型能力域                                                  | **被终裁推翻→改造**                      | decision/ 随 C1 迁插件；档案热刷新/设置页表单不再适用，配置走 userConfig（等价损失 §11-D8）                                                                                                         |
| D3 证据 gate 留 CLI 主管道                                           | **被终裁推翻→拆除**                      | gate 数据面（本体 DB）消失；语义随迁插件工具内复验（§4.2，收窄如实记录）                                                                                                                            |
| D4 会话引用面留主程序                                                | **被终裁推翻→拆分（评审 2 轮 H3 修正）** | C5b 生产端拆除随面板走；**C5a 渲染端保留本体**（通用 chat 面消费 receipt 投影，非 vault 实现——「webview 内等价重建」对 chat 消费宿结构性不成立，撤销原表述）；citation 打开经 g9 双向 openWith 路由 |
| D5 GO 门禁/write-tier 留本体                                         | **部分保留**                             | write-tier-policy 管 Bash/js 全通道非 vault 专属，留本体；reviewReleasePolicy GO 门随 review 栈迁插件（writePathEnabled 门语义原样）                                                                |

## 8. 安全不变量（延续，零弱化）

`specs/obsidian-plugin.md` 9 条安全不变量、W01 收窄、hooks 三事件语义、L0-L3 分级、
S03 NO-GO（writePathEnabled 门随迁不变，批量 apply 仍 fail-closed）全部原样；实现
物理迁移不触碰语义（迁移 PR 逐文件对照 HEAD 证据）。新增面审查：webview 页面无文件
系统/DB 直访（一切经 MCP 工具，8MiB/MIME 白名单）；g9 双向动作桥白名单最小面
（页面→宿主三动作 + 宿主→面板 openWith，均不绕权限系统——handoff 注入走 composer
既有通道（updateModelContext 先例），citation 打开是只读导航，目录选择是宿主原生
对话框）；**g10 面板工具信任分类以宿主 authority 验证为准（不自报），写类豁免审批
的安全口径对账 agent-write-safety §5（D13 裁定后生效）**；卸载边界 §5.8（阶段一
spec）延续且升级（插件数据目录现含知识库，D6）。

## 9. 验收定义

**残留扫描（真抽离门禁，P8 起每批防回灌；终读评审 H1 重写 token 集）**：

- **token 集 = 字面量族精确匹配（大小写敏感）**，不用裸词：`VaultSearch`、
  `vault_neighbors`（snake，实码 `contracts/src/tools/vault-neighbors.ts:111`）、
  `vaultSearch`、`vaultNeighbors`、`obsidian-vault`、`obsidianVault`、
  `IObsidianVaultService`、`vaultConfig`（实码 `obsidian-vault/config.ts:9`）、
  `vault-config`、`obsidian@drora-plugins-official`（实码
  `obsidianVaultService.ts:44`）、`knowledge-index`、`KNOWLEDGE_INDEX_DB_FILE_NAME`、
  `bge-small-zh`、`knowledgeJev`、`decision-jev`、`knowledge/neighbors`、
  `knowledge/search`（协议键）。
- **裸词禁入**：`knowledge`/`evidence`/`evidenceRef`/`Jev` 不进 token 集——实测误报
  （persona 域自有 `evidenceRefs` 字段 `persona.ts:326-329`、`voice.ts:39`、
  `telegramProvider.ts`、generate-image 等）；域收口改按**文件清单扫描**（C6/C11
  清单内的具体文件，P7 拆净后应不存在）。
- **白名单格式**：逐条 `path + token + 原因`（C5a 渲染面、C6 legacy 探测器、平台
  契约文件），防白名单膨胀为第二实现位。
- **gate 定义**：token 族 × 八包（§0 口径）扫描，白名单外零命中；配套契约测试
  （availability 仅 "session"、解析器拒 hostPanelId）兜住无 token 拆除面（C4）。
  落地为脚本纳入 `verify:pre-push`。

**能力等价（git HEAD 基准）**：obsidian-knowledge.md 各节验收映射（§4 查询语义/§5
Evidence/§5b 索引检索/§5c 四视图/§5d Jev（按 D8 修正）/§5e 审核/§5f VaultSearch/§5g
洞察）在 webview+插件 server 形态下逐项复跑；**已知差异清单（评审 2 轮补全，均需
§11 裁定或如实呈现，不静默）**：①session 级面板可用性（无有效会话无入口，D11）；
②**§5c.3 冷启动引用回跳**——「chat 点击引用→打开面板定位」在 session 级面板下
需要有效会话，无会话冷启动时该链不可达（降级：提示先开启会话或打开面板），D11 一并
裁定；③chat 引用打开依赖面板/插件 server 在场（C5a 降级提示语义）；④Web/远程；
⑤evidenceRefs wire 收窄与旧账本 refs 条目拒绝（D9）；⑥Jev 配置面静态化（D8）；
⑦面板写操作审批语义（D13/g10）；⑧**deferred 缺失期 VaultSearch 以 MCP 常驻工具首发**（shouldDefer 实码 `vault-search.ts:75` 现 true，工具面常驻每会话 context，D15）；⑨**server/stdio host agent 工具面**：`packages/server/src/stdioServices.ts` 同走 createLocalServices，插件 server 不装配该 host 时 VaultSearch/neighbors 回退（随 g1 P1 作用域裁定）

**数据零手工迁移**：升级用户首启 → 自动搬迁 → 四视图数据完整（文档计数/chunk 数/
receipts 数/审核账本行数与迁移前一致）→ vaultId/sourceEpoch 不变（指纹未变不重建）。

**hooks 零回退**：obsidian-plugin.md 验收 1-21 复跑（hooks 实现未动）。

## 10. 批次（阶段二 P 系列；每批 gate：pinned pnpm typecheck/lint/architecture:check --changed + 定向测试）

| 批  | 范围                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 附加 gate                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| P0  | 本 spec 落盘 + 阶段一 spec 标注中间态互链                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | oxfmt 定向；文档评审                                                                                            |
| P1  | g1 app 级常驻生命周期（official-plugin-runtime + bootstrap 装配 + 定义 appService 键，契约收口 contracts）+ singleton/崩溃重启/收割语义测试                                                                                                                                                                                                                                                                                                                                                                  | bootstrap/plugin-runtime 定向 node:test                                                                         |
| P2  | g3 deferred 工具声明 + g4 hostContext locale/theme + g9 双向动作桥（页面→宿主三动作+宿主→面板 openWith+renderer handler+沙箱侧 API）+ g10 面板用户动作信任分类（宿主 authority 验证，D7/D13 裁定后收口）                                                                                                                                                                                                                                                                                                     | plugin-ui/plugin-ui-bridge 定向 vitest + adapters 契约测试 + 沙箱 e2e 冒烟                                      |
| P3  | 插件服务进程化：knowledge 栈+obsidian-vault 门面物理迁入 obsidian-plugin（C1/C2，逐文件 HEAD 对照注释；**DB 级 lease/fencing 原样随迁，不进程内化**）+ mcpServers/manifest 0.4.0 + runtimeTopLevelPaths/asarUnpack 核对（g7）+ **UI 服务面→MCP 映射清单交付（§3，含 onRunUpdated 订阅/轮询裁定与四动作 g9 清单）**+ 25 个 node:test 随迁改跑插件 server 模块（实测 30=25 node+5 vitest；`knowledgeLeaseChild.mjs` 辅助进程文件同迁）+ **obsidian-plugin package.json 新增 onnxruntime-node 依赖声明（L13）** | node:test 25 文件（迁后路径）+ vitest 5 Jev 文件 + 映射清单逐项对验收 + office e2e 冒烟对照 + 打包 staging 校验 |
| P4  | Agent 工具迁移：VaultSearch/vault_neighbors → 插件 MCP 工具（deferred）+ evidence 语义随迁（§4.2）+ CLI 旧端口/handler 保留但标记 deprecated（切换期双轨；**旧面读旧路径不受影响——搬迁未开始，见 §5 时序**）                                                                                                                                                                                                                                                                                                 | 插件工具契约测试 + CLI 双轨回归（vault-search-handler/tool-contracts 定向）                                     |
| P5  | UI webview 重建：panel.html React 四视图+N1-N4（分页/分段读取、backgroundRetention 草稿自持久化、locale/theme 接入）+ g9 双向桥接（handoff/citation openWith/目录选择）+ **写操作面按 D13 裁定交付（未裁定先只读面）**                                                                                                                                                                                                                                                                                       | 插件 UI 构建 + 沙箱页面 e2e（launcher/display modes/后台回收草稿保护）                                          |
| P6  | 数据迁移（**评审 2 轮 M4：移至 P7 后，搬迁仅新版首启、旧实现已不存在**）：`wal_checkpoint(TRUNCATE)` + v6 owner PID 活性校验（活跃 writer 拒绝搬迁）→ move+计数校验+回退 + `migrating` 状态 + 升级路径测试（含 D6 keepData 交互）                                                                                                                                                                                                                                                                            | 迁移单测（含活跃 writer 拒绝/中断/失败回退）+ 手工升级冒烟                                                      |
| P7  | 本体清除：C3-C10 全清单执行（含 C5b/C5a 分流与 C5a 保留面白名单登记）+ 双轨下线（删 CLI 旧工具面/gate/协议段/装配点/四 getter/channels 四通道/设置页表单）+ 残留扫描脚本落地并入 verify:pre-push（**C5a 白名单豁免登记先行，避免扫描误报**）+ **无 token 拆除面的契约测试断言（availability 仅 "session"/解析器拒 hostPanelId，M8）**                                                                                                                                                                        | 残留扫描零命中 + `pnpm verify:pre-push` + knip + 全量 vitest drora                                              |
| P8  | 收尾验收：能力等价逐项复跑（§9 含七项差异清单）+ E2E 重写（webview 形态：r1-r9/G 系列等价场景+obsidian-knowledge-positive）+ i18n 键迁移（vault.\* 实测 342 键×2，grep -c 复核 → 插件页面资源）+ 三 spec 回填实现状态 + CI 清单重对账                                                                                                                                                                                                                                                                        | desktop e2e 全量 + `pnpm verify:pre-push` + 文档评审                                                            |

依赖：P1→P2→(P3→P4→P5→P7→**P6**→P8)；P5 依赖 P2 桥与 P3 工具面；**P6 必须在 P7
之后**（旧 host 实现拆除后搬迁，双轨期旧面持续读旧路径不受影响，§5 时序）；P8 末位。

## 11. 决策点（待裁定；未裁定对应批次不动）

| #                         | 决策                                                                                                                                                                                                                                                                          | 建议                                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D6（升级）                | 卸载 keepData：插件数据目录现含知识库+模型，默认 rm 即全库丢失                                                                                                                                                                                                                | uninstallKeepData=true 强制 + 卸载 UI 明示；「恢复」零损失                                                                                                                                                                |
| D7                        | 只读检索类插件 MCP 工具审批策略：自动 allow vs 逐次 ask（现 MCP 默认）——**受成文口径约束（评审 2 轮 M6）**：`core/src/mcp/index.ts:141-144`「自报 readOnlyHint 不构成信任锚（agent-write-safety §5），只有宿主 authority 验证过的官方 CUA 描述符才允许凭只读提示进入 low 档」 | 官方只读工具自动 allow，但**以宿主 authority 验证描述符取代 manifest 自报**（resolveTrustedOfficialCuaServerNames 同款机制扩展，与 g10 同一验证底座）；不自建第二信任口径；若嫌机制重可维持逐次 ask（可用性回退如实呈现） |
| D8                        | Jev 随插件的配置等价损失：档案热刷新/设置页表单 → userConfig 静态配置；**含 AppSettings schema 键（validationAppSettings.ts:759）与凭据键 `model-capabilities:decision-jev:*` 的拆除——旧配置值迁移去向（丢弃 vs 映射 userConfig）终读评审 M3 补**                             | 接受静态化（userConfig sensitive 注入 env，android 先例）；AppSettings 字段删除 + 旧值映射 userConfig（迁移注记），凭据键随插件 userConfig 重建；设置页表单与 traceCatalog/test-ids 条目拆除                              |
| D9                        | evidenceRefs wire 语义收窄 + **旧持久化账本处置（评审 2 轮 M9）**：三层接线（admission 复验）→ 插件工具内单层复验；durable session_input 中已带 refs 的排队条目升级后如何处置                                                                                                 | 接受收窄 + **旧账本带 refs 条目一律拒绝并给结构化 `legacy_evidence_unverifiable` 原因（不静默容忍——A17 fail-closed 延续，evidence-session-wiring 两例语义）**；保留协议字段与最小 CLI gate 则违反零残留，不建议           |
| D10                       | g9 宿主动作桥未落地期间的 handoff/citation 形态：等价桥（P2 平台扩展）vs 降级（页面展示+复制）                                                                                                                                                                                | 做 g9 桥（P2 先行）；降级仅作桥失败时的运行时回退                                                                                                                                                                         |
| D11                       | session 级面板可用性回退（无有效会话无 VaultView 入口；Web/远程不支持；**§5c.3 冷启动引用回跳不可达——chat 点击引用需有效会话才能打开面板定位，评审 2 轮 H3 补**）vs 追加平台 app 级面板扩展                                                                                   | 先按 session 级交付（现行契约），冷启动回跳降级为「提示开启会话/打开面板」；app 级沙箱面板列 backlog                                                                                                                      |
| D12                       | 数据迁移取舍得兜底确认：物理搬迁（默认）vs 重建索引声明（丢 receipts/账本）                                                                                                                                                                                                   | 物理搬迁；重建仅作搬迁失败回退并在 UI 明示后果                                                                                                                                                                            |
| D13（新增，评审 2 轮 H1） | 面板用户动作的工具调用审批语义：g10 豁免（宿主 authority 验证官方插件 + caller=panel-user-action 标记：只读自动 allow、写类页面点击即授权+页面级二次确认+宿主审计，不走 MCP 审批弹窗）vs 复用 Agent 审批路径（CONTRACT.md:13 现状语义，面板每次写操作弹审批，可用性根本回退） | **g10 豁免**（先例：宿主 authority 验证的官方 CUA 描述符进 low 档，mcp-config.ts:41-53 + core/mcp/index.ts:141-144 同口径；MCP 审批防护的是 agent 代用户行动，面板用户动作被授权方即用户本人）；未裁定前 P5 只交付只读面  |
| D14（新增，终读评审 H2）  | 双轨期插件 server 数据路径状态机：legacy 兼容模式（连旧路径，经 DB lease 与旧 host 仲裁）→ P7 后搬迁；插件目录与旧路径均有库时 `dual_db_conflict` 拒绝启动数据面                                                                                                              | 按 §5 状态机执行（显式化，替代隐式行为）；人工取舍提示，不静默合并                                                                                                                                                        | 影响 P3-P7 |
| D15（新增，终读评审 M7）  | deferred 落地前 VaultSearch 以 MCP 常驻工具首发（每会话 context 占用）vs VaultSearch 迁移推迟到 deferred 落地后                                                                                                                                                               | 常驻首发（工具 schema 小、占用有限），deferred 落地后收敛；推迟则 P4 拆双轨顺延                                                                                                                                           | 影响 P4/P8 |

## 12. 与阶段一 spec 的关系

阶段一文件头部已标注：`specs/obsidian-vault-plugin-extraction.md` = 中间态设计
（装配条件化与宿主面板部分被本文件取代）；`specs/obsidian-plugin.md`（hooks/不变量）
与 `specs/obsidian-knowledge.md`（行为契约）继续有效，其中 §1b（装配归属变更）标注
被本文件 §1 清除清单取代。冲突裁决：实现归属与物理位置以本文件为准，行为语义以
两份行为 spec 为准。
