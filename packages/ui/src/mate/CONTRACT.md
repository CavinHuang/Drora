# ui-mate

Drora Mate（个人助理「大副」）UI 面：Side Pane 的决策卡 / 工单行 / 汇报卡 / 观察行与
配置区（specs/drora-personal-assistant.md；台账 16——有意自研扩展，上游无对应能力）。
P1 范围：observe 模式 + 本地双测试按钮 + 决策卡人工放行（Mode A 直派）+ 汇报卡消费。

设计基线：`docs/mate-implementation-plan-2026-11-04/01-p1-detailed-design.md` §5 与
`00-master-plan.md` §2 PR-1B。

## 边界

- **只消费快照投影**：唯一数据入口是 `useAssistantTickets()`（getSnapshot 拉一次 +
  onDidChange 推送订阅）；快照类型经 services index type-only 引用，UI 不做二次运行时
  校验。快照本体不复制进 zustand——`mateStore` 只存 `filter / selectedTicketId /
expandedDecisionId` 三件 UI 局部态，按 workspace 分域（`byWorkspace`，键=
  `tab.workspaceKey` 即 `workspaceIdentity?.trim() || workspacePath` 的身份键规则；
  mate tab 每 workspace 一个且 side pane 对全部 tab 常挂载，单例会跨区串扰），动作
  single-flight key 同域隔离（无快照副本、无 error/operationId 第二状态）。
  **与 01 §5 字面的有意偏差（登记）**：01 写「useSyncExternalStore」，实现为
  useEffect 订阅 + getSnapshot() 拉取 + updatedAtMs 单调丢弃（hook :44-49）——服务
  getSnapshot() 是异步 Promise，useSyncExternalStore 需要同步 getSnapshot，需另建
  renderer 侧缓存层才成立；现实现与 master plan §2 指定的 useModelCapabilities 模板
  同构，推模式语义（快照不复制、推送跟随）等价。替换条件：P2 若引入 renderer 侧
  快照缓存（Surface A/C 需要跨面板共享快照），届时再切 useSyncExternalStore。
- **动作全走 service 方法**：`mateStore` 的动作以 service 为参数注入（store 不保存服务
  引用）；同 key 并发调用 single-flight 合并，后续动作使更早动作的本地收尾按代际丢弃。
  动作结果经 Promise 返回给调用方（toast 按 `resolveMateErrorMessageId` 映射
  `mate.error.*`），store 不落错误状态。
- **服务缺席即不可用**：`assistantTicketService` 未注册（远程 workspace / 旧 Host）时
  hook 返回 null，面板渲染不可用态；不建本地缓存顶替、不伪造空快照。
- **单一口径投影**：待决策卡 = `outcome=decision_card && decidedBy=gate`；观察行 =
  `outcome=would_accept`；进行中 = `status ∈ {dispatched, running}`。全部经
  `view-model.ts` 纯函数（`deriveMateViewModel` / 判定谓词），组件不得各写一份判定。
  分组键 = `targetWorkspaceIdentity`（null/"" 归未指名组）；决策卡/观察行投影无目标
  字段，不参与分组。
- **放行即人工决策（服务侧已对齐，2026-11-05 审查轮修复）**：`approveDecision` 事务
  reaffirm `outcome=decision_card` 且写 `decided_by='user'`（此前 PR-1A 漏写 decided_by，
  导致放行后卡片无法脱离待决策集、releaseCount 恒 0；修复由
  `packages/services/test/assistantTicketsService.test.ts` 锁定）。UI 判定按契约语义
  （decidedBy=gate 为待决策）实现，与此口径一致。
- **预估行的诚实降级**：01 §5 写「预估（模型/tier）」，AssistantDecisionView 契约无
  model 字段（P1 模型随 P2 assistant preset 注入）——决策卡只渲染 tier；tier 徽标与
  放行动作共用 `ASSISTANT_PERMISSION_TIERS.build` 单一出处，P2 加档位选择时同源替换。
- **目标 workspace 选择推迟（登记，PR-1B 三审发现 8）**：00 §2 PR-1B 卡片清单写
  「目标 workspace 选择」，P1 未实现——P1 本地触发即本 workspace 语境（触发按钮携带
  pane 的 workspaceIdentity），服务侧 approve 以 `decision.workspace_identity` 兜底；
  接口通道 `approveDecision.targetWorkspaceIdentity` 已存在（assistantTickets.ts）而
  UI 恒不传，多目标选择随 P2 Mode A 目标解析统一（00 §3.5）交付。

## 不变量

- 快照唯一事实源是 service 推送；本模块任何位置不得缓存/复制快照进入独立状态容器。
- 权限与名单只经 `setMode` / `setAllowlist` 变更；Trigger 正文只是输入（消息不能改变
  权限，spec §5）。auto 按钮 P1 恒禁用 + tooltip（mate.auto.locked）；yolo 无 UI 入口
  ——P1 无档位选择器，放行动作显式传 build，yolo 仅以服务端拒绝码
  mate.yolo.requiresHumanApproval 存在（强于早前「auto / yolo 按钮恒禁用」的表述，
  PR-1B 二审发现 2 对齐）。
- 状态灯五档映射（01 §5 视觉契约）：待决策=destructive（仅灯）、运行=warning、
  观察=foreground-subtlest 空心、完成=success、失败=destructive；只用 DESIGN.md 语义
  token，不为状态发明新色。
- i18n 键单一出处 `i18n/mateMessages.ts`（zh「大副」/en "Mate"），经 zh-CN/en-US 顶部
  spread 合入；键一次建齐，组件不写字面量文案。

## 与其它模块的交集

- `services`（assistant-tickets）：channel 代理消费快照与动作；类型引用只走 services
  index 公开出口。
- `ui`（宿主）：Side Pane tab 七处接缝**已全部接入**（workspaceSidePane → useAppPanels →
  WorkspaceShellLayout → AnimatedSidePanePanel → SidePaneTabTrigger →
  sidePaneTabPresentation → app-shell/MateSidePane；launcher 项与 handleOpenMateSession
  跳转通道同批交付）；store/hooks（`store/mateStore.ts`、`hooks/useAssistantTickets.ts`）
  与 i18n 属宿主 ui 模块，经本模块公开入口（index.ts/contract.ts）引用契约类型与纯函数。
