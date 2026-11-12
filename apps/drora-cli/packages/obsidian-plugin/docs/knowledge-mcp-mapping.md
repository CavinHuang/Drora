# Knowledge Server UI 服务面 → MCP 映射清单（P3 交付；P4 增补 agent 工具面）

依据：`specs/obsidian-vault-phase2-true-extraction.md` §3（评审 2 轮 M8，P3 交付物）、
§4/§10-P3（agent 工具迁移 P4）、§10-P4。
实现：`src/mcp/server.ts`（stdio MCP server，manifest `mcpServers.knowledge`）；
agent 工具注册表在 `src/mcp/agent-tools.ts`（P4，54 工具 = 52 服务面 + 2 agent 面）。
验收锚点行号以 HEAD `bf872a6c0`（P3 迁移起点）为准；迁入后对应 `src/server/` 同名文件。

## 裁定记录（随清单交付，均为建议值先行、待用户终裁）

1. **onRunUpdated 订阅 vs 轮询**：首选**资源订阅**——SDK 原生
   `resources/subscribe`/`unsubscribe` + `sendResourceUpdated` 通知，模板
   `vault://runs/{runId}`（增量通知，事件即 `KnowledgeRunUpdatedEvent{runId,
   runGeneration, seq, status}`，`queryOrchestrator.ts:72-81` 的 Emitter 直连）；
   **全量拉取兜底 + 无订阅语义时的降级 = `knowledge_query_get_run` offset 轮询**
   （轮询间隔与活跃续期对齐 `drora/activity` 语义——面板活跃期间短间隔、后台回收前
   停轮询；实现归 P5 页面侧）。
2. **四动作 g9 清单**（P2 已落地的页面→宿主动作面，本 server 消费关系）：
   `drora/openConversationHandoff`（composer 投递，不触 server）；
   `drora/openDirectoryPicker`（目录选择 → 选中路径回传页面 → 页面调
   `vault_configure` 工具——根目录选择唯一入口，本清单锚定该链）；
   `drora/navigate`（surface 导航，payload 经 openWith 转交）；
   宿主→面板 `drora/openWith`（citation 打开路由：chat 点击引用 → 面板 → 面板内调
   `knowledge_query_resolve_citation` 工具完成 receipt 解析——C5a「解析在面板内经
   插件 server 完成」的落点）。
3. **写类工具审批语义**：工具面照常发布（§3 映射完整性），但 g10 信任分类未裁定
   （D7/D13 保守缺省）：面板调用写类工具前一律不下发（P5 只交付只读面）；agent 调用
   走 MCP 审批路径逐次 ask。
4. **状态面**：`knowledge_server_status` 工具返回 `{status: ok|dual_db_conflict|
   migrating, mode, paths…}`；`migrating` 键自 P6 起产生（§5 首启搬迁：running 期间数据工具结构化拒绝；blocked/failed 回退后数据面按 legacy 原件继续服务并经 `migration` 子对象呈现原因）。

## 逐项映射（四服务接口 1:1，共 51 方法 + 1 事件）

### IObsidianVaultService（18）— 锚点 `src/server/vault/obsidianVault.ts:96`

| 接口方法 | MCP 工具 | 形态 |
| --- | --- | --- |
| getSummary | `vault_get_summary` | 读 |
| listCandidates | `vault_list_candidates` | 读 + offset/limit 分页 |
| selectManagedVault | `vault_select_managed_vault` | 写 |
| configureVault | `vault_configure` | 写；根路径来自 g9 `drora/openDirectoryPicker` |
| authorizeCandidate | `vault_authorize_candidate` | 写 |
| setAgentWritesEnabled | `vault_set_agent_writes_enabled` | 写（翻转失效旧批准，L1 语义不变） |
| listFiles | `vault_list_files` | 读 + offset/limit 分页 |
| readFile | `vault_read_file` | 读 + **分段**（offset/limit 按 code unit 切片，sha256/modifiedAt 续读校验） |
| writeFile | `vault_write_file` | 写（CAS 乐观锁语义原样） |
| createUntitledFile | `vault_create_untitled_file` | 写 |
| createUntitledFileInFolder | `vault_create_untitled_file_in_folder` | 写 |
| createFolder | `vault_create_folder` | 写 |
| renameFile | `vault_rename_file` | 写 |
| deleteFile | `vault_delete_file` | 写（破坏性，页面级二次确认归 P5 面板） |
| resolveMedia | `vault_resolve_media` | 读 |
| savePastedImage | `vault_save_pasted_image` | 写 |
| setUserContext | `vault_set_user_context` | 写（会话焦点，进程内易失） |
| getUserContext | `vault_get_user_context` | 读 |

### IKnowledgeIndexService（9）— 锚点 `src/server/knowledge/knowledgeIndex.ts:23`

| 接口方法 | MCP 工具 | 形态 |
| --- | --- | --- |
| getStatus | `knowledge_index_get_status` | 读 |
| getInsights | `knowledge_index_get_insights` | 读 |
| refreshDecisionConfig | `knowledge_index_refresh_decision_config` | 写（配置热刷新；Jev 段在 D8 接线前恒 off） |
| testJevConnection | `knowledge_index_test_jev_connection` | 读（D8 静态化接线前恒「配置未完成」） |
| getSemanticStatus | `knowledge_index_get_semantic_status` | 读 |
| downloadSemanticModel | `knowledge_index_download_semantic_model` | 写（触发下载，首用下载落插件数据目录语义原样） |
| startReconcile | `knowledge_index_start_reconcile` | 写 |
| requestRebuild | `knowledge_index_request_rebuild` | 写 |
| cancelJob | `knowledge_index_cancel_job` | 写 |

### IKnowledgeQueryService（9 方法 + 1 事件）— 锚点 `src/server/knowledge/knowledgeQuery.ts:42`

| 接口成员 | MCP 工具/资源 | 形态 |
| --- | --- | --- |
| createRun | `knowledge_query_create_run`（clientRequestId 幂等键必填） | 写（run 生命周期） |
| search | `knowledge_query_search` | 读/写（decisionConsentId 扩展原样） |
| neighbors | `knowledge_query_neighbors` | 读 |
| grantDecisionConsent | `knowledge_query_grant_decision_consent` | 写 |
| revokeDecisionConsent | `knowledge_query_revoke_decision_consent` | 写 |
| getRun | `knowledge_query_get_run` | 读（订阅兜底/轮询降级入口） |
| cancelRun | `knowledge_query_cancel_run` | 写 |
| prepareEvidence | `knowledge_query_prepare_evidence`（runId+articleId） | 写（receipt 签发） |
| resolveCitation | `knowledge_query_resolve_citation` | 读（g9 openWith 后面板内解析） |
| **onRunUpdated**（事件） | **资源订阅** `vault://runs/{runId}` + `resources/read` 返回 run 视图 | 流（裁定 1） |

### IKnowledgeReviewService（15）— 锚点 `src/server/knowledge/review/reviewService.ts:46`

| 接口方法 | MCP 工具 | 形态 |
| --- | --- | --- |
| createProposal | `knowledge_review_create_proposal` | 写（L2 治理唯一入口） |
| reviseProposal | `knowledge_review_revise_proposal` | 写 |
| getProposal | `knowledge_review_get_proposal` | 读 |
| listProposals | `knowledge_review_list_proposals` | 读 + offset/limit 分页 |
| approveProposal | `knowledge_review_approve_proposal` | 写（破坏性，页面级二次确认归 P5） |
| rejectProposal | `knowledge_review_reject_proposal` | 写 |
| applyProposal | `knowledge_review_apply_proposal` | 写（唯一写盘路径，CAS 语义原样） |
| reconcileOperation | `knowledge_review_reconcile_operation` | 读 + 账本落定 |
| listRecentOperations | `knowledge_review_list_recent_operations` | 读 + offset/limit 分页 |
| reconcileStuckOperations | `knowledge_review_reconcile_stuck_operations` | 写（重启恢复） |
| undoOperation | `knowledge_review_undo_operation` | 写 |
| getProposalChangeContent | `knowledge_review_get_proposal_change_content` | 读 |
| isWritePathEnabled | `knowledge_review_is_write_path_enabled` | 读 |
| isWritePathActivationAllowed | `knowledge_review_is_write_path_activation_allowed` | 读 |
| setWritePathEnabled | `knowledge_review_set_write_path_enabled` | 写（S03 GO 门语义随迁不变） |

### 元状态（非接口成员）

| 工具 | 说明 |
| --- | --- |
| `knowledge_server_status` | D14 状态机 + §5 迁移门结构化状态；dual_db_conflict 时全部数据工具返回同构拒绝 |

### Agent 工具面（P4，§4/§10-P4）— 锚点 `src/mcp/agent-tools.ts`

与四服务 1:1 面的区别：这是 **agent 消费契约**（C8 契约随迁——HEAD
`contracts/src/tools/vault-search.ts`、`vault-neighbors.ts` @ bf872a6c0），不是服务面
原始形状。CLI 经既有插件 stdio MCP client 直连（g3 传输 = 既有插件 MCP 通道，无新传输）。

| 工具 | 契约来源 | 形态 |
| --- | --- | --- |
| `vault_search` | C8 `VaultSearchInput/Output`（strict 入参 query≤512 + limit 1-10；出参白名单经 `vaultSearchProtocol.ts` 同一收口） | 一次性 createRun+search（不携带 decisionConsentId，§5f.2 零出站；run 不绑会话）+ **evidence 工具内复验**：逐候选在调用时刻对当前文件核验（文件 sha256 → quote 切片 sha256，与 `prepareEvidenceFromRun` 同一道核验），候选新增 `evidence: {status: current\|stale\|missing}` 注解（§4.2/D9：三层接线收窄为工具内单层，「agent 携带证据的输入复验」由工具调用时序保证） |
| `vault_neighbors` | C8 `VaultNeighborsInput/Output` | 服务面 `queryService.neighbors` 直通（结果即白名单 DTO，收口在 `query/knowledgeNeighbors.ts`）；近邻是向量事实非引用核验，**无 evidence 注解**（HEAD 同口径） |

- **D15 常驻首发（建议值先行）**：manifest `mcpServers.knowledge.alwaysLoad: true` →
  54 工具随 server 常驻每会话 context（§9 已知差异⑧如实记录）。deferred 收敛时在
  manifest 加工具级 `tools.vault_search.deferred: true` / `tools.vault_neighbors.deferred:
  true`（P2 g3 机制，优先级压过 server 级 alwaysLoad），工具实现无需改动。
- **入参 limit 兼容位**：`vault_search` 的 limit 为 C8 契约兼容位，检索服务按自身缺省
  （候选 ≤5）截断——HEAD 反向链路同行为（host 分支不消费 limit），等价基准下不做新截断。
- **CLI 双轨**：旧面（core 两个 handler + bootstrap 协议端口 + contracts C8 契约）保留
  并标记 deprecated，读旧路径不受影响（§5 时序）；P7 随 C7/C8 拆除，本节成为唯一契约位。
- **契约测试**：`test/knowledgeAgentTools.test.ts`（8 用例：入参契约随迁/白名单+evidence
  三态/no_source/neighbors 直通与降级/dual_db_conflict 拒绝/D15 manifest 断言）。

## 不在本面（如实）

- **fs watcher**：明确不迁（§3），维持「装配后延迟一次 + search TTL」两触发点
  （server 装配 `autoIndexEnabled: true` 与 desktop host 同语义）。
- **Jev 出站决策**：D8 静态化（userConfig）接线前 server 不注入凭据读取器，
  `resolveKnowledgeJevAssembly` 走 fail-closed 关闭分支（迁入件 P3/D8 改点）。

## 面板 UI 资源面（P5，§2/§10-P5）— 锚点 `src/mcp/uiResources.ts`

面板页面（`ui://obsidian/panel.html`，React 单文件内联，`src/ui/`）的数据通道走
**`resources/read`（`mcp/uiReadResource`：限同插件 server、8 MiB、MIME 白名单）而非工具**：
页面工具调用复用 Agent 权限链逐次弹审批（bootstrap `mcp-ui/handlers.callTool` →
`authorizeAppTool` → `resolveToolPermission`），浏览/检索/轮询将不可用——drora-site
（读走资源不弹窗）与 office-runtime（panel/file chunk 全资源）同款先例。§3 工具面继续
服务 agent；下表只服务面板（D13 保守缺省：全部只读）。

统一封套 `{ok:true,data}` / `{ok:false,error:{code,message,…}}`；`dual_db_conflict`
返回结构化冲突封套（面板呈现取舍提示，不静默合并）。

| 端点（`ui://obsidian/data/…`） | 服务锚点 | 形态 |
| --- | --- | --- |
| （面板本体 `ui://obsidian/panel.html`） | dist/ui/panel.html | `text/html;profile=mcp-app` + `_meta.ui.backgroundRetention:true`（§2 display modes；conflict 态也可读——页面要能呈现冲突） |
| `status` | `knowledge_server_status` 同源 + `indexService.getStatus` + `vault.getSummary` | 面板启动分支（conflict / 未配置 / ready）唯一入口 |
| `summary` | `IObsidianVaultService.getSummary` | 未配置返回 null |
| `files?offset&limit` | `IObsidianVaultService.listFiles` | 分页（缺省 200、上限 1000，tools.ts 同款纪律） |
| `file?path&offset&limit` | `IObsidianVaultService.readFile` | 分段读取（UTF-16 code unit 窗口，缺省 48k、上限 200k；sha256/modifiedAt 续读校验） |
| `insights` | `IKnowledgeIndexService.getInsights` | 洞察快照（含 N4 health 段） |
| `neighbors?path&limit` | `IKnowledgeQueryService.neighbors` | N2/N3 相关笔记（limit 1-10） |
| `lookup?q&requestId` | `IKnowledgeQueryService.createRun`+`search` | N1 Smart Lookup（检索即终点：不暴露 answer/compare 发起面；clientRequestId 页面生成幂等） |
| `citation?receiptId` | `IKnowledgeQueryService.resolveCitation` | g9 宿主→面板 openWith 后的面板内解析（§3 映射） |
| `proposals?offset&limit` / `proposal?id` / `proposal-content?id&path` | `IKnowledgeReviewService` 对应读方法 | review 视图只读呈现 |
| `write-gate` | `isWritePathEnabled` + `isWritePathActivationAllowed` | L2 总门状态（approve/apply 降级提示，D13） |

面板行为与降级边界（对照 HEAD `v4/VaultView.tsx` + `vault/` 行为清单）：
- **四视图**：notes（树/分段读取/wikilink 跳转/滚动记忆/N2 相关笔记）+ ask（N1 lookup
  + g9 handoff）+ insights（§5g + N4 体检）+ review（提案只读 + 写门状态）。
- **写操作面未交付**（D13 保守缺省，等 g10 终裁另批）：编辑器（CodeMirror）、标题提交、
  新建/改名/删除、N2 一键插入 wikilink、N3 确认插入、审核 approve/apply/reject、
  configureVault 写入、startReconcile/requestRebuild——各处降级提示，不放死按钮。
- **草稿**：视图/打开笔记/检索草稿/树展开态经 `ui/set-widget-state` 落宿主内存
  （回收重建时 `hostContext["drora/widgetState"]` 下发恢复）；「自持久化到插件 server」
  形态（工具调用续活跃，§2）随写操作面补批。
- **i18n**：页面自带 zh-CN/en 资源（`src/ui/i18n.ts`，语义对照本体 vault.* 文案）；本体
  342 键×2 的迁移对账归 P7/P8（双轨期旧面板仍引用）。

- **契约测试**：`test/vaultUiResources.test.ts`（4 用例：面板 meta/conflict 封套、
  分页分段与只读端点、N1 lookup+幂等、citation 落空与 invalid_params）+
  `test/vaultPanelModel.test.ts`（8 用例纯模型）。
