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

## P3 增量（2026-11-05，Source/桌宠接缝批次）

- **来源徽标**：决策卡/观察行经 `MateSourceBadge` 渲染 `decision.sourceKind`（快照 v2
  可选追加字段，host 侧 trigger JOIN 既有列投影）；`mateSourceKindMessageId` 封闭映射
  跟随 `ASSISTANT_SOURCE_KINDS`，未知值不渲染。缺席（旧库行）诚实降级不渲染徽标。
- **桌宠接缝投影**（`petProjection.ts`）：快照 → 有界 `MatePetProjection`（shared
  assistantPet.ts schema）纯函数 `projectMatePet`；气泡判定 `deriveMatePetBubble` 按
  ticketId+updatedAtMs 登记键差分（发布方首帧只登记不弹、会话期内新到达/变化的汇报
  弹泡）。发布方=`root/MatePetSync.tsx`（窗口 Host services 作用域），Main 只转发
  （desktop matePetBridge 校验来源窗口），pet/tray 不建第二 Host。**打扰配额归 P4
  配额中心，本模块不建第二计数器**（03 §6 注记）。
- **导航端口**（`hooks/useMatePetEvents.ts`）：Main→Renderer 三事件 open-mate /
  open-ticket / decide 的执行体——面板打开走 `handleOpenMateSidePane` 同位入口、工单
  选中走 mateStore `selectTicket`（identity 键匹配已开 tab，无命中回落当前 workspace
  ——面板投影覆盖 Host 全部工单）、decide 直调 `IAssistantTicketService`（默认 build
  档，与面板放行同参同服务）。
- **直通绑定呈现**：工单详情时间线「直通通道」站渲染 `ticket.channelRef` 不透明串接值
  （格式=host 侧 sources/channelRef.ts 单出处，UI 不复制第二解析）。

## P4 增量（2026-11-05，第二棒：汇报卡完整版 + 配额中心 UI，04 详设 §3/§4）

- **状态灯六档**：新增 awaiting 档（04 §3 工件核验滞留）——与 queued 同为 warning
  空心（不发明新色，滞留文本伴随灯出现）；`isMateActiveTicket` 并入 awaiting_output
  （与服务 queuedRelease ACTIVE_STATUSES 同口径，软预算活动数一致）。
- **汇报卡完整版**：容器按状态路由 done/failed/**awaiting_output** → `MateReportCard`
  （awaiting 卡=滞留提示+「人工确认交付」；done/failed 卡补「未确认增量」常驻横幅
  （generationCount>0 且 incrementsConfirmedMs 缺席，`mateUnconfirmedIncrement` 纯函数
  出 {gen, prev}）+「确认增量」按钮；stale 停滞徽标 `mateStaleBadgeKind` 封闭映射）。
  动作经 mateStore single-flight（confirmTicketOutput/confirmTicketIncrements）。
- **Surface C 增强**：时间线补「工件核验滞留」站（awaitingSinceMs）；成本页签按代分解
  （`resolveMateUsageGenerations`，Σ=合计；字段缺席沿用 P2 说明诚实降级）；证据页签补
  briefFull 全量 verbatim 与工件链接（writeDomain 只读；paths/workspace=「无 git 工件」）。
- **配额中心 UI**：状态条配额行（`resolveMateQuotaLine`，snapshot.quota 缺席不渲染）；
  `MateDigestCard` 摘要卡（watchdogNotices ≤5 与 quota.pendingDigest 分节，「标记已投递」
  =markDailyDigestDelivered 回执，两节皆空整卡不渲染）；MateConfigSection 每日配额行
  （草稿-dirty 纪律同名单编辑，写 AppSettings `droraMateDailyQuota` 经 useSettings；
  settings 服务缺席输入禁用）。
- **气泡闸**（root/MatePetSync）：弹泡差分命中先过 `admitDisturbance(kind=bubble)`，
  未放行/判定通道失败皆不发布气泡帧（fail-closed）；在途判定期间跳过无弹泡帧发布
  （admitDisturbance 自身推快照会触发 effect 重跑——重跑即取消会让气泡永不出现，
  e2e 实测捕获）。兑现 P3「配额归配额中心同一计数」注记。

## 审查修复批（2026-11-06，运行链可用性/交付完整性审查）

- **放行/触发目标契约（F1）**：触发与放行的 `targetWorkspaceIdentity` **恒等于
  `workspaceKey`**（AGENTS 身份键 `workspaceIdentity?.trim()||workspacePath`）。本地 tab
  的 `tab.workspaceIdentity` 恒 undefined（node.ts prepareProjectExecution 显式
  undefined），旧实现「仅在 identity 真值时透传」使 `trigger.workspace_identity=NULL`
  → 服务 approve 兜底链全落空（validationFailed「缺少派发目标」死卡）。本地形态
  workspaceKey=本地绝对路径（workspaceProbe 端口合法形态）；远程形态=远程 identity，
  probe 诚实拒绝、卡不消费可改选（spec §8）。`MateConfigSection` 的
  `workspaceIdentity` prop 随之移除（死参数即断链根源）。
- **auto 告知卡（F4）**：`MateAutoNoticeRow` 只读行卡（MateObserveRow 同款形态），
  谓词 `isMateAutoNoticeDecision`（outcome=auto_notice×decidedBy=gate），随决策档展示；
  工单号经 `findMateTicketIdForDecision`（ticket.decisionId 反查）缺席不渲染。兑现
  spec §6「执行（出告知卡）」的 UI 侧。
- **触发反馈行（F2）**：MateConfigSection 按返回 outcome 出 role=status 反馈
  （`mateTriggerOutcomeFeedbackMessageId` 三态封闭映射；auto_notice 不在配置区重复出文案）。
- **barrel 收敛（G3）**：`matePetBubbleKey`/`matePetReportSummary` 为 petProjection
  内部辅助（模块外零引用），移出 index.ts 公开入口；`projectMatePet`/`deriveMatePetBubble`
  （MatePetSync 发布方消费）不变。

## 与其它模块的交集

- `services`（assistant-tickets）：channel 代理消费快照与动作；类型引用只走 services
  index 公开出口。
- `ui`（宿主）：Side Pane tab 七处接缝**已全部接入**（workspaceSidePane → useAppPanels →
  WorkspaceShellLayout → AnimatedSidePanePanel → SidePaneTabTrigger →
  sidePaneTabPresentation → app-shell/MateSidePane；launcher 项与 handleOpenMateSession
  跳转通道同批交付）；store/hooks（`store/mateStore.ts`、`hooks/useAssistantTickets.ts`）
  与 i18n 属宿主 ui 模块，经本模块公开入口（index.ts/contract.ts）引用契约类型与纯函数。
