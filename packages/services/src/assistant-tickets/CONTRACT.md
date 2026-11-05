# assistant-tickets

Drora Mate 个人助理工单台账（specs/drora-personal-assistant.md；台账 16——有意自研扩展，
上游无对应能力）。P1：准入（off/observe × explicit/inferred）+ 决策卡人工放行 + Mode A
直派 + sqlite 台账。**P2 host 内核（feat/mate-p2）**：Router 候选卡循环、Mode B·C、
代际锚校验、写域 W1/W2、软预算 queued、assistantActivity 聚合。
**P3 Source 注册表（feat/mate-p3 host 侧批次）**：`sources/` 子目录（注册表/飞书/手机/
GitHub/统一入口）；schema v4（trigger.channel_ref、trigger.remote_session_id、
ticket.channel_ref）；Thread 直通 Tier1。

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
  Y/N/E 不变。Tier2 候选集生成（02 §2）：评估链内经 sessions-index 端口 listSessions
  取目标 workspace 快照，routerShell.filterAttachCandidates 纯函数硬过滤（busy
  running/prewarming、已结束、无转录 draft、updatedAt>7d）后有界截断
  （attachCandidatesMax=5）进候选卡【附着候选】段；候选空集/通道不可用/目标缺省 →
  不出段，约言恒约束 attach 臂 sessionId 只能取自清单（缺席/不合适 → hold，
  禁止编造）——派发桥 Tier2 校验 fail-closed 兜底。轮转簿记（ROUTER_KV_KEYS）在
  装配层（services/node.ts，kv 同库）；每张卡都自带约言，无状态壳轮转零交接依赖。
  轮转裁剪登记（P2）：仅建新会话、不执行旧会话归档动作（02 §1.1 原案「归档旧会话」
  静默省略——无状态壳语义下旧会话残留为 CLI 内存事实，编排事实在台账；待 CLI 会话
  生命周期处置动作可用时对账补齐），浓缩交接同样不发送（零交接依赖）。
- 带序 commandId 与锚（02 §3）：`<ticketId>-<投递序号>`（incarnation.dispatchSeq 行内
  计数，与锚回写同事务——详设 kv 计数器的等价原子化，偏差已登记）；anchor=最后成功
  sendText 的 commandId；follow-up/换代前经会话索引对账（reconcile 优先，缺席≠删除）。
- 换代（spec §8）：触发源仅锚失配/生命周期删除归档/lease 失效（禁超时）；锚对账的
  unavailable（reconcile 抛错/快照投影未就绪）=不可校验，**不是失配**——followUp 如实
  报错（anchorMismatch 码+原因），不换代、不猜测、不自动重试（端口契约注释同口径）；
  换代事务=旧代归档（appendGeneration 闭合纪律，最多一代 active）+浓缩段重派（原文+
  产出摘要+usage 合计+未确认增量标注）+续用同一 worktree；usage_accum 按 ticketId
  记账不改写。
- 写域（02 §4）：W1=本地 git 根 worktree `.drora/mate/<ticketId>` + 分支 `mate/<id>`
  （终态清理保留分支，清理失败追加 fail_reason 附属日志；换代续用不重复 add；
  **「用户关闭 W1」开关已补交互入口**——setWorktreeDisabled（kv worktree_disabled
  唯一写路径，快照 worktreeDisabled 投影，UI=MateConfigSection 开关；P2 审查修复），
  只影响之后的派发规划，已建工单写域不回改）；
  W2=非 git/关 W1 → 声明域（空集=待声明整域，彼此互斥；**声明域「决策卡可编辑」入口
  P2 裁剪**——空集=待声明整域自动互斥进队列，编辑入口随声明域 UI 批次交付）；
  W3=附着不隔离但查冲突。
  不变式「Mate 派生活动工单两两写域不相交」由 detectWriteDomainOverlap+排队闸+释放
  复检执行；workspace 探测端口缺席（P1 形态）→ 跳过 W1 规划按 workspace 域派发
  （未隔离明示）；端口在位而目标探测失败（远程/非本地路径/目录不存在）→ 放行前预检
  失败，决策卡不消费、不建票（spec §8「拒绝猜测，问人」，attach 预检同构——此前
  「文档称降级不阻断 / 实现 fail-fast 已消费卡 / spec 要求问人」三口径矛盾收口于
  本形态，2026-11-05 审查修复）。
- 软预算（spec §9）：默认 3（ASSISTANT_DEFAULTS 单出处），活动=dispatched/running；
  超出或写域重叠 → queued（queued_reason=告知卡文案）+终态 FIFO 释放（created_ms 序；
  详设 kv cursor 的等价简化，偏差已登记）。释放前双重复检：预算（活动计数）与队头
  写域冲突（与当前活动工单比对，重叠则保持 queued 并终止本轮释放——FIFO 不越位，
  不变量「两两写域不相交」在释放侧同被强制）。释放按建票事务落库的 ticket.dispatch_intent
  重放派发形态（dispatchIntent.ts：mode/attachSessionId/tier；Mode B 重套 /team 指示、
  Mode C 走 attachDispatch 附着原目标、权限档恢复放行值）——用户放行动作不因排队被
  静默改写（spec §2.4/§7）。
- Mode B（02 §5）：prompt 驱动建队（lead 会话 + /team 指示，审批门原样）；teamActivity
  第三信号经 sessions-index 桥按 sessionId 反查归账（completed→done、cancelled/archived
  →failed、其余→running）。
- turn 事件归账（01 §3）：`applyTicketTurnEvent` host 内部入口——状态机/usage 差值/
  单调丢弃不变；**P4 第二棒（04 详设 §3）**：W1 worktree 工单 turn_completed 不再直落
  done——进 `awaiting_output`（schema v6 列 awaiting_since_ms）交只读核验（新端口
  `setAssistantArtifactVerifyPort`，node.ts 经 gitCommandProvider rev-parse/merge-base
  零写引用；判定矩阵在 reportCompletion.ts：通过→done、无提交→滞留喂 watchdog
  awaiting 判据（>60min→stale+通知）、端口缺席→P1 形态降级 done、git 失败→滞留待
  人工）；人工出口=`confirmTicketOutput`（awaiting→done+终态后续）与
  `confirmTicketIncrements`（置 increments_confirmed_ms，唯一写路径）。awaiting_output
  占软预算活动位（queuedRelease.ts ACTIVE_STATUSES 单一口径，UI isMateActiveTicket
  同参）。快照增量投影：usageByGeneration（落窗归代 Σ=合计）/briefFull/awaitingSinceMs/
  incrementsConfirmedMs。FIFO 释放子侧拆 queuedRelease.ts、mandate stop/revoke 拆
  mandateActions.ts（单文件 ≤800 行纪律，行为不变）。
- 端口纪律：本模块不 import drora-agent/git——v4 命令、会话索引、workspace 探测、
  git worktree、工件只读核验（P4 第二棒）、AppSettings 配额读（P4）八端口全在装配层
  （services/node.ts set*，assistantPorts.ts 唯一形状）；
  未注入按各语义诚实降级（派发=dispatch.rejected、Router=无建议、会话索引=候选空集/
  锚不可校验、探测=跳过 W1 规划按 workspace 域派发）。Router 端口双臂解除（装配层实现）：候选卡
  turn 的 assistantText complete→输出、failed/interrupted→{ok:false}（帧状态即事件
  信号，非超时兜底）——服务侧评估落 router_evaluation=failed 降级 Tier3，评估串行链
  不因 turn 失败挂起。
- assistantActivity（02 §6）：事实源=本服务快照；`computeMateActivityByWorkspace`
  纯折叠（经 services node 入口导出），desktop host 折叠缓存 → controller 任务行
  activity.mate 合成（SESSION_MATE_ACTIVITY_KEY 在 shared contracts 单出处）；
  CLI→host wire 零改动。
- 并发幂等（PR-1B 三审发现 7）：同 decisionId 并发放行由 approve 事务内按 decision_id
  查重（alreadyExisted 臂跳过派发）+ ticket(decision_id) UNIQUE 索引双防线闭合。
  Tier2 附着预检在放行事务之前（失败零消费，人工可改选"开新会话"）。
- observe=全量零执行：explicit 出决策卡、inferred 记 would-accept；
  auto 在信任门（P4）开启前恒拒（mate.auto.locked）。
- **Source 注册表（P3，03 详设 §1-§5）**：`sources/` 统一入口 `sourceIngest.ts` 是 P3 起
  真实 Source 的唯一入口（P1 `recordTrigger` 模拟语义原样保留，本地双按钮=测试工具）。
  事件顺序：channel_ref 命中活动工单（ticket.channel_ref 等值 + 非终态）→ 跳过 gate
  直投 incarnation_current（engine.followUp，v4 sendText 同通道，原文即输入不追加）；
  直通投递失败**如实报错不落 gate**（同通道重复建票=重复执行风险，spec §8 人工承接）。
  否则进 gate：强度=真实规则 `mention && allowlist 包含 identity → explicit 否则
  inferred`（名单外由 gate 拒绝；消息不能改变权限不变式不变），trigger（source_kind/
  identity/channel_ref/remote_session_id）+decision 同事务单一写者，决策卡照常进 Router
  候选卡循环；放行建票事务回填 ticket.channel_ref。
  注册表（sourceRegistry.ts）按 kv 配置 enabled 惰性启停（reconcile 于快照推送执行，
  改配停启一次即生效）；同 kind 重复登记拒绝。channelRef 串接格式 channelRef.ts 单出处
  （encodeURIComponent 组件防碰撞；仅 mate.sqlite 自产自读，不跨进程）。
- **Source 事件面（P3 定型，真实连通遗留项见 03 详设 §2/§3/§4 落地注记）**：
  ① 飞书=bots `assistantForwarder` 回调出口（botsService 去重成功后唯一回调点，可选注入
  缺席零行为；bots 内部逻辑零改动；命令/卡片交互/补答由 feishu Source 侧过滤，不进 gate
  ——防 observe 信任数据污染）；mention=Provider 核验的 actor.mentionedBot；群聊绑定
  线程粒度、私聊会话粒度。② 手机=IAssistantTicketService 新增 channel 可见
  `submitSourceEntry`（仅开放 sourceKind=phone；identity 由 host 侧本机用户决定，
  renderer 不可自报 feishu/github 外部身份——防伪造；remoteSessionId 贯穿
  trigger.remote_session_id；**受 phone.enabled 门控**——关闭时整入口拒绝
  `mate.source.disabled` 含直通臂，与注册表「Source 停用=事件面全关」同语义，
  spec §6 收尾注记）。手机无独立入站消息总线（03 §3 探查回填：
  webRemoteControlSharedHostAttachments → host service connection 直调服务 channel），
  UI 接线随后续 Source 配置 UI/手机入口批（排期未定，spec §14 P3 遗留登记——
  当前手机无触发大副的 UI 入口）。③ GitHub=comments 轮询（每 60s 一轮；ETag If-None-Match 304
  省额 + comments id 单调游标 kv 双防重；点名=整词 @mentionName 且评论者 login 经 kv
  映射进 gate）；`/issues` 增量窗与 CI 结论裁剪（触发规则未定义/消费方 P4）。
  外部 id ↔ identity 映射存 kv source_identity_map（sourceConfig.ts 单出处；未映射原样
  透传由 gate 拒绝并记录）。Source kv 簿记（开关配置/游标/ETag）经装配层 kvGet/kvSet
  （Router 轮转簿记同口径，非事务簿记；UI 配置面随后续 Source 配置 UI/手机入口批
  ——排期未定，spec §14 P3 遗留登记；本阶段无写入口是诚实边界，kv 空值=三 Source
  恒关）。
- **Source 终态回复（P3）**：注册表订阅台账快照差分，工单首次进入 done/failed 且有
  channel_ref → `AssistantSourceReplyPort`（一句话+工单 id；fire-and-forget，失败/端口
  缺席诚实降级 warn，不重试不用超时兜底）。GitHub 端口=POST issue 评论
  （Co-authored-by 大副署名；绑定仓库与配置不一致不跨仓发送）；飞书端口未接线——
  实证 bots `replyToChannel` 要求 bots 任务绑定（channelReply.ts readBinding），Mate
  工单无归属不可复用（03 §2 落地注记），真实接线随凭据/真机验收批。

与其它模块的交集：派发经 droraAgentService（装配层 setAssistant* 注入，本模块不 import
drora-agent）；UI 只经 channel 代理消费快照与动作（type-only 类型从 services index
引用）。P2 接缝（供下一棒）：快照 v2 决策卡 routerState/routerSuggestion/routerError
预填面、工单 dispatchMode/writeDomain/generationCount/anchorCommandId/queuedReason、
approveDecision 新参 dispatchMode/attachToSessionId 与返回 queued、任务行 activity.mate
（Surface A·C 与 session-line 徽标按这些字段渲染）。
