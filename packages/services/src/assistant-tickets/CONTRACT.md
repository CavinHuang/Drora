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
- **P7 对话式查询直答（08 号详设 §3）**：routerDecision 五臂（+query_status）→
  queryReply.ts 确定性应答器（四 scope 直答，数据面复用快照投影零第二读路径）；
  router_evaluation.answer_text（v7）+ decision outcome=status_replied 同事务落
  （唯一写者=评估循环）；dismissQueryReply（status_replied→ignored 出清）；
  Source 答复外发经 replyPort status="query"（registry 快照差分幂等 decisionId）。
- **P5 设置中心（06 号详设 §2）**：configActions.ts 六 setter（setBudget/
  setTrustGateThresholds/setWatchdogIntervalMinutes/setSourcesConfig/
  setSourceIdentityMap/setModelPreference）为 kv 可调参数的**唯一生产写入口**
  （bounds=ASSISTANT_CONFIG_LIMITS fail-closed；publish 即 sourceRegistry reconcile——
  Source 启停/映射改动即时生效）。模型偏好（model_preference，modelSelection JSON）
  由 node.ts 在 dispatch/Router 两处 createSession config.modelSelection 消费——
  「下一次建会话生效」，在途会话不热切。
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
- **P8 全域工作台账 host 侧地基（09 号详设 §1 v2 定案，feat/drora-mate P8a）**：
  三源（mate 工单快照/sessions-index 内存投影/tasks-index 全量 meta）→ 视图
  `MateWorkInventoryView`（contracts mateWorkInventorySchema：workspaces[{key,rows}]，
  三 kind 行 ticket/session/offpeak+managed 可选；界 inventoryWorkspaceMax=6/
  RowMax=20/WorkspaceSetMax=16/TitleMax=120 单出处 ASSISTANT_SNAPSHOT_LIMITS）。
  接缝=provider 端口（`setAssistantInventoryProvider`，assistantPorts.ts 同款 set*
  模式）：装配层（node.ts）经 workInventoryBootstrap.ts 组装，服务 publish 时读
  provider 挂 extras.inventory（assistantSnapshot.ts buildAssistantSnapshot 第三参
  扩展）；**部分源缺席=inventory 整体缺席**（provider 返回 null/抛错/未注入 → 快照
  不携带字段；冷启动=订阅快照未 ready 同缺席——UI「投影就绪中」态归 P8b）。
  bootstrap 三步（09 §1.3）：初始集=deriveInventoryBootstrapTargets（近 14d 工单
  target workspace∪tasks-index 项目集，identity 键 AGENTS 规则单出处
  resolveInventoryWorkspaceKey）→ 逐 workspace 常驻 watchSessions（持有者=装配层
  disposer，watchSessions 端口 dispose 语义保证引擎 watcher 非零期间底层订阅不被
  清零、台账退订也不拆引擎在用的域）→ 刷新驱动重推导动态发现（desired 集对账：
  reconcileInventoryTargets 补订阅/超 16 最久未活动退订；**v4 delta 无跨域 workspace
  引用，动态发现收敛为刷新驱动重推导——09 §1.1「无全域订阅形态」现实边界，spec
  §14 P8 行已登记**）。刷新环路：常驻订阅 delta/state:projects·task-groups 广播 →
  host face `refreshInventory?()`（**可缺席**，旧消费方 optional-call）→ 服务
  refreshInventory 节流（kv `inventory_refresh_interval_ms` 缺省 30s，前沿+尾沿补
  一拍，dispose 收口）重 publish。tasks-index 读点=listTaskMetas({}) 不传
  workspacePath 查全部（repo 支持），**装配层缓存**（provider 同步读缓存，
  refreshOffPeakCache 在途去重）+**变更指纹跳过**（09 §4 对策后半「组装输出 hash
  未变则复用引用」，2026-11-06 复审落地：assembleWorkInventory 不读时钟为纯函数，
  provider 对输入域（工单行/订阅域会话投影/off-peak 缓存）算稳定指纹，未变则复用
  上次视图引用跳过重组装——工单事件高频 publish 不再产新对象，快照按内容序列化与
  UI memo 吃引用稳定；workInventoryBootstrap.inventoryInputFingerprint 注释即对账点，
  回归=assistantWorkInventory.test.ts「provider 变更指纹跳过」矩阵）。纯函数测试
  落点 workInventory.ts 矩阵 →
  services/test/assistantWorkInventory.test.ts（登记 drora-isolated 清单）。
- **P8 台账消费侧（P8b，09 号详设 §1.6/§1.7；feat/drora-mate）**：查询直答第六 scope
  kind `"work"`（±workspaceIdentity）——`composeQueryReply` 读调用方传入的台账视图
  （routerEvaluation 评估链内读 provider 一次、候选卡速览与应答共用同视图）：
  inventory 有值=每项目一行（kind 计数/teams 注记/最近活动/停滞点），缺席=回落工单账
  并注明「仅工单视角」（不拼半张账）；scoped 未命中注记「台账视图有界」不臆测无工作。
  `composeLedgerDigest` 消费 inventory：速览段追加「全域 …」行（会话/teams/闲时计数，
  工单事实不重复），工单账空但全域有会话时速览段仍出现（attach 佐证扩为全域，约言
  routerShell 同步）；全文界两界并存——纯工单 400（本地 LEDGER_DIGEST_MAX）、携全域
  `ledgerDigestInventoryMax=600`（contracts 单出处）。快照 `inventoryReady?` 就绪信号
  （publish 读端口后携带：provider 装配即 true，含视图 null；未装配不携带）——UI 三态
  区分的结构性依据（true+inventory 缺席=「投影就绪中」/字段缺席=旧 Host 卡不渲染，
  不用超时兜底）。UI 落点=MateWorkOverview（ui/mate，面板顶部状态条下；行点击=
  selectTicket / onOpenMateSession 既有导航 / 闲时禁用提示），验收=MSA15+服务单测
  （assistantQueryReply work scope 矩阵、assistantWorkInventory inventoryReady 投影）。
- **P9 自主节奏层（09 号详设 §2 v2 定案；feat/drora-mate）**：自主评估循环
  autonomy.ts——心跳=watchdog cron tick 同源（host face `runAutonomyRound` **fire-and-forget
  不进 watchdog await 链**；kv `autonomy_interval_ms` 缺省 30min 节流+`autonomy_enabled`
  总闸缺省 true；off=整体停跳含评估读）。自主评估=composeLedgerDigest 速览直调 router port
  （输入含「本输入为自主评估」互扰标记；`countTowardsRotation=false` 不计入
  ticketsSinceRotation）→ 独立 zod `autonomyVerdictSchema` 三臂恰现其一（quiet/report{text≤800}
  /suggest{brief,dispatch|attach+参数}——非 routerDecisionSchema 第六臂；解析失败=quiet+warn
  不落 router_evaluation 不进 Tier3 不计轮转）。三臂出口：quiet 零动作；report→
  admitDisturbanceTx(kind=report) 过闸→自主通知区 kv `autonomy_notices`（与 watchdog_notices
  **分键单写者**——watchdog 轮判据出清按 ticket 事实维护，混写会被吞并；快照
  watchdogNotices 合并投影=MateDigestCard 既有面零改动）+桌宠气泡（ui petProjection
  autonomyBubble+deriveMateAutonomyBubble，发布方不二次计数；通知 kind 字面量
  `autonomy_report`/`autonomy_first_notice` 单出处 shared contracts
  ASSISTANT_AUTONOMY_NOTICE_KINDS——2026-11-06 复审上收，services autonomyProjection
  再导出+ui petProjection 消费方同引，删除跨包字面量副本）；suggest→独立建卡事务
  `insertAutonomySuggestCardTx`（trigger source_kind=autonomy+strength=`autonomous`
  字面量如实标注（contracts ASSISTANT_AUTONOMY_STRENGTH）+decision outcome=decision_card
  decided_by=gate+同事务 decision 配额计数+**建卡即写 `autonomy_muted:<对象hash>` 24h**
  （对象 hash=suggest 的 workspace/sessionId/brief 排序序列——autonomy.ts 注释即规则出处）
  ；**不调 scheduleRouterEvaluation——auto 模式无任何自动建票路径**，卡上 routerState
  缺席=无建议区人工终审）。防打扰五闸：配额闸/速览指纹去重 24h（kv `autonomy_fingerprint`
  ；hash 输入域=对象集合+状态摘要，排除一切时刻类字段）/建卡即冷却/否定记忆 48h
  （服务 ignoreDecision 事务内 `writeAutonomyNegationTx`——对象 hash 经
  `autonomy_object:<triggerId>` 登记回取，消费即清）/总闸+首启一次性告知通知。快照
  `rhythm?` 投影（设置区节奏区数据源；setter=setAutonomyEnabled/setAutonomyIntervalMinutes
  在 configActions）。验收=assistantAutonomy.test.ts（24 项）+cron fire-and-forget 3 项
  +petProjection 自主气泡差分 3 项+MSA16。
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
- **配额中心与 watchdog（P4，04 详设 §1/§4；spec §2.3/§10 修复批注记）**：kv
  `quota:<yyyy-mm-dd>` 日记录三端同源计数（decision/report/bubble，统一接口
  admitDisturbance 进出，不建第二计数器）。生产接线：decision=gate 落卡事务计数
  （recordTrigger/sourceIngest 落 decision_card 同事务；永不抑制仅计数）、
  report=watchdog 通知、bubble=桌宠气泡闸（ui 侧 MatePetSync）；工单终态汇报卡为
  快照被动呈现、无主动推送动作，其 report 计数生产接线随主动推送通道批次补齐
  （spec §14 遗留登记）。watchdog 通知按「停滞回合」计——同 (ticketId, kind) 已有
  未解除通知不重报不重计，通知区 kv `watchdog_notices` ≤5 一工单一条；watchdog.ts
  是 stale 列与通知 kv 的唯一写者（只标记不改状态机，spec §10 不变式）。
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
  恒关）。运行注记：注册表启停 Source 仅随快照推送 reconcile（sourceRegistry.ts
  `attachMateSourceRegistry` 只挂快照订阅，无独立配置观察通道）——kv 手改
  source_config 后需等下一次快照推送才生效（属遗留「Source 配置写入口」域内现状，
  配置 UI 批次接入正式写路径时一并收敛）。
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
