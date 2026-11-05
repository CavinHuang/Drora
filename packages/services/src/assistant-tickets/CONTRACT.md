# assistant-tickets

Drora Mate 个人助理工单台账（specs/drora-personal-assistant.md；台账 16——有意自研扩展，
上游无对应能力）。P1：准入（off/observe × explicit/inferred）+ 决策卡人工放行 + Mode A
直派 + sqlite 台账。**P2 host 内核（feat/mate-p2）**：Router 候选卡循环、Mode B·C、
代际锚校验、写域 W1/W2、软预算 queued、assistantActivity 聚合。

不变量：

- 单一写者：trigger/admission_decision/mandate/ticket/router_evaluation/usage_log 全部
  经 IAssistantTicketService 事务写（派发执行细节在 dispatchEngine/generationRollover，
  仍是同一 db 连接）；其他模块不得直连 mate.sqlite。
- 消息不能改变权限：名单与模式只经 setAllowlist/setMode 变更；Trigger 正文只是输入
  （Mandate 仅 accept 创建 / 用户 stop / 校验失败撤销三条变更途径，spec §5）。
- 诚实失败：派发失败 → ticket=failed+fail_reason+mandate revoked，不静默重试、
  不用超时兜底；同 decision 二次放行幂等返回首次结果；Router 评估失败 →
  routerState=failed（决策卡降级 Tier3 问人，不重试模型）。
- Router 候选卡循环（02 §1.3）：决策卡产出后异步送 Router（路由约言随候选卡重发，
  (a) 结构化文本路线，CLI 零改动）；输出经 routerDecision.ts zod 严格校验（四臂互斥、
  evidence ≤3 条 ≤80 字），建议预填 router_evaluation → snapshot 决策卡；人工终审
  Y/N/E 不变。轮转簿记（ROUTER_KV_KEYS）在装配层（services/node.ts，kv 同库）；
  每张卡都自带约言，无状态壳轮转零交接依赖。
- 带序 commandId 与锚（02 §3）：`<ticketId>-<投递序号>`（incarnation.dispatchSeq 行内
  计数，与锚回写同事务——详设 kv 计数器的等价原子化，偏差已登记）；anchor=最后成功
  sendText 的 commandId；follow-up/换代前经会话索引对账（reconcile 优先，缺席≠删除）。
- 换代（spec §8）：触发源仅锚失配/生命周期删除归档/lease 失效（禁超时）；换代事务=
  旧代归档（appendGeneration 闭合纪律，最多一代 active）+浓缩段重派（原文+产出摘要+
  usage 合计+未确认增量标注）+续用同一 worktree；usage_accum 按 ticketId 记账不改写。
- 写域（02 §4）：W1=本地 git 根 worktree `.drora/mate/<ticketId>` + 分支 `mate/<id>`
  （终态清理保留分支，清理失败追加 fail_reason 附属日志；换代续用不重复 add）；
  W2=非 git/关 W1 → 声明域（空集=待声明整域，彼此互斥）；W3=附着不隔离但查冲突。
  不变式「Mate 派生活动工单两两写域不相交」由 detectWriteDomainOverlap+排队闸执行；
  探测不可用（远程/非本地路径）→ 降级 workspace 域（未隔离明示，不阻断派发）。
- 软预算（spec §9）：默认 3（ASSISTANT_DEFAULTS 单出处），活动=dispatched/running；
  超出或写域重叠 → queued（queued_reason=告知卡文案）+终态 FIFO 释放（created_ms 序；
  详设 kv cursor 的等价简化，偏差已登记）。
- Mode B（02 §5）：prompt 驱动建队（lead 会话 + /team 指示，审批门原样）；teamActivity
  第三信号经 sessions-index 桥按 sessionId 反查归账（completed→done、cancelled/archived
  →failed、其余→running）。
- turn 事件归账（01 §3）：`applyTicketTurnEvent` host 内部入口——状态机/usage 差值/
  单调丢弃不变；P1 语义原样（turn_completed→done，awaiting_output 四态恢复随 P4 汇报
  管线）。帧接线经 `setAssistantFrameSource`（P2 起带 hostPath 定位——W1 会话落位
  worktree 目录）。
- 端口纪律：本模块不 import drora-agent/git——v4 命令、会话索引、workspace 探测、
  git worktree 七端口全在装配层（services/node.ts set*，assistantPorts.ts 唯一形状）；
  未注入按各语义诚实降级（派发=dispatch.rejected、Router=无建议、会话索引=候选空集/
  锚不可校验、探测=降级 workspace 域）。
- assistantActivity（02 §6）：事实源=本服务快照；`computeMateActivityByWorkspace`
  纯折叠（经 services node 入口导出），desktop host 折叠缓存 → controller 任务行
  activity.mate 合成（SESSION_MATE_ACTIVITY_KEY 在 shared contracts 单出处）；
  CLI→host wire 零改动。
- 并发幂等（PR-1B 三审发现 7）：同 decisionId 并发放行由 approve 事务内按 decision_id
  查重（alreadyExisted 臂跳过派发）+ ticket(decision_id) UNIQUE 索引双防线闭合。
  Tier2 附着预检在放行事务之前（失败零消费，人工可改选"开新会话"）。
- observe=全量零执行：explicit 出决策卡、inferred 记 would-accept；
  auto 在信任门（P4）开启前恒拒（mate.auto.locked）。

与其它模块的交集：派发经 droraAgentService（装配层 setAssistant* 注入，本模块不 import
drora-agent）；UI 只经 channel 代理消费快照与动作（type-only 类型从 services index
引用）。P2 接缝（供下一棒）：快照 v2 决策卡 routerState/routerSuggestion/routerError
预填面、工单 dispatchMode/writeDomain/generationCount/anchorCommandId/queuedReason、
approveDecision 新参 dispatchMode/attachToSessionId 与返回 queued、任务行 activity.mate
（Surface A·C 与 session-line 徽标按这些字段渲染）。
