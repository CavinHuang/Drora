# 04 · P4 详设（watchdog / auto 信任门 / 汇报卡完整版 / 配额中心）

- 对应 master plan §5。前置：P1-P3 台账数据齐备（would-accept/放行/usage/代际均已归账）。

## 1. watchdog（host cron 驱动）

- 挂载：复用 `desktop/src/host` cron 基建（`cronBotDelivery`/`cronRunLifecycle` 先例，`host/index.ts:151/:172`）注册内部定时任务（默认 15 分钟/轮，kv 可调）——**不进任何会话**，纯 host 侧读台账。
  **落地注记（2026-11-05，feat/mate-p4 host 侧批次）**：定时器=`host/cronMateWatchdog.ts`
  新文件（setInterval 粗 tick，照 `startManualClaimHeartbeat` 先例），每 tick 调 services
  node.ts 装配的 host face `getAssistantTicketsHostFace(services).runWatchdogRound()`；
  是否到轮由服务按 kv 裁决（`watchdog_interval_ms` 缺省 900000/15min、
  `watchdog_last_round_ms` 记账）——kv 改值即时生效，定时器不重启。判据在
  `assistant-tickets/watchdog.ts`（纯函数 compute + 事务 apply）：stale 标记=ticket
  新列 `stale_ms`/`stale_kind`（schema v5 只加不破）；判据解除同轮清除；通知经
  §4 配额中心 `admitDisturbance(kind=report)` 判定，配额内进快照有界通知区
  （`watchdogNotices ≤5`，kv `watchdog_notices`），超额自动落次日摘要。awaiting 滞留
  判据留 `awaitingCandidates` 入参接缝（§3 工件核验交付后喂入，缺席=不激活）。
- 判据表（读 TicketService 快照，只标记不改写）：

| 判据          | 计算                                                                     | 动作                                           |
| ------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| running 停滞  | status=running 且 updated_ms 距今 > 30min 且无新 turn 事件               | ticket 置 `stale` 标记+通知（决策卡/桌宠气泡） |
| awaiting 滞留 | done 前产出未确认（**P4 起**引入工件核验，见 §3；核验失败即滞留）> 60min | 同上，建议人工核验                             |
| 排队饥饿      | queued > 24h                                                             | 告知卡提醒调整预算                             |

- 通知动作仅三类：标记（stale 字段）、通知（配额内）、无动作；**永不自动终止/换代/重试**（spec §10）。
  **落地注记（2026-11-05，feat/mate-p4 修复轮）——通知频次语义**：通知按「停滞回合」
  计——同 (ticketId, kind) finding 已有未解除通知时不重复过配额闸计数、不重复入列；
  判据解除（状态流转/新事件推进 updated_ms/工单删除）出清通知后再次命中才重新过闸
  （跨类别翻转=新回合）。通知区构建保持一工单一条（新条目让同工单旧条目让位）。
  反例（修复前）：持续停滞工单每轮无条件 admit+push，15min/轮 × 配额 5/日 约 75 分钟
  耗尽当日 report 预算并把 ≤5 条通知区挤满同工单重复条目。

## 2. auto 信任门

- 统计（kv 聚合，watchdog 同轮更新）：`releaseRate = 人工放行数 / (would_accept 数 + 人工放行数)`；样本数=`would_accept+放行` 总数。
- 开放条件：`releaseRate ≥ 0.8 且样本 ≥ 15`（阈值 kv 可调）。
- 唯一入口：Surface B `MateTrustBar` 达标后出现「切换 auto」→ 确认 dialog（不可逆提示：列出当前名单与预算）→ `setMode("auto")` 解锁（P1 的 `mate.auto.locked` 拒绝码移除）。
- auto 下规则：explicit→直接执行（告示卡）；inferred→Router 评估**必须命中 evidence 引用原文**（01 号 §1.2 schema 强校验），否则降级 Tier3 问人。
  **落地注记（2026-11-05，feat/mate-p4 host 侧批次）**：统计口径=admission_decision
  实时 SQL（与快照 trust 同一出处）；kv `trust_gate_stats` 为 watchdog 同轮落账的
  审计投影，**setMode 判定读实时 counts 不读 kv 缓存**（单一事实源，无第二判定路径）；
  阈值 kv `trust_gate_min_rate`/`trust_gate_min_samples`，缺省
  `ASSISTANT_TRUST_GATE_DEFAULTS`（contracts 单出处）。`mate.auto.locked` 保留为
  「未达标」拒绝码（不再是 P1 恒拒）。auto 执行语义：outcome 枚举新增
  `auto_notice`（告知卡=已自动执行的 explicit/inferred 评估通过事件；decided_by 恒
  gate，不进放行率统计）；explicit 带目标→事务内建票+runPostApproval（目标探测失败
  /无目标→降级 decision_card 进候选卡循环问人）；inferred→候选卡循环挂
  `onSuggested` 钩子，建议须 dispatch/attach 臂且 evidence ≥1、模式仍 auto、探测通过
  才自动建票（`assistant-tickets/autoDispatch.ts`，与人工放行同事务形状；
  hold/reject/失败→留在 decision_card）。UI 入口=MateTrustBar 达标（mode≠auto 且
  trust.gateOpen）出「切换 auto」按钮 → 仓库全局 confirmDialogStore 确认框（列出
  名单与预算+不可逆提示）→ mateStore.setMode。

## 3. 汇报卡完整版

字段升级（在 P2 Surface C 基础上）：

- 成本按代分解：`usage_log JOIN incarnation_generations` 分组展示（每代 inputTokens/输出/时长）；
- 工件核验：done 判定从"turn ended"升级为"turn ended + 派发桥只读核验"——W1 工单查 `mate/<id>` 分支新提交/PR 存在性（git 服务）；核验失败→`awaiting_output` 滞留交 watchdog；
- 未确认增量行：换代工单常驻显示（直至人工确认按钮清除）；
- 证据页签：brief verbatim+Router evidence+工件链接全量（只读）。

  **落地注记（2026-11-05，feat/mate-p4 第二棒批次）**：
- **按代成本**：快照 ticket 增可选 `usageByGeneration`（assistantSnapshot 投影：
  usage_log 行按 `at_ms` 落窗归代——归档代窗口 `[fromMs,toMs]`、当代=
  `[incarnation_current.boundAtMs, ∞)`；早于首窗的行归第 1 代；Σ分代=usage_accum
  合计不丢账；每代 input/output/durationMs（当代=投影时刻迄今）。条数界 contracts
  `ASSISTANT_SNAPSHOT_LIMITS.usageGenerationsMax`）。UI 展示在 Surface C 成本页签；
  字段缺席（旧 Host）沿用 P2 合计+说明诚实降级。
- **工件核验**：ledger turn_completed 仅对 W1 worktree 写域工单进入新状态
  `awaiting_output`（schema v6 列 `awaiting_since_ms`；非 W1 工单无工件契约，维持
  turn ended→done 不变），事务提交后异步跑只读核验（assistantPorts 新增
  `artifactVerify` 端口；node.ts 经 gitCommandProvider `rev-parse`/`merge-base`
  实现，零写引用）：分支相对工作区 HEAD 有新提交→done（终态钩子 worktree 清理+
  queued FIFO 释放照旧）；无新提交=核验失败→滞留 awaiting_output 喂 watchdog
  `awaitingCandidates`（>60min→stale+通知，§1 判据表第 2 行激活）；端口缺席=无
  核验面，照 P1 形态直落 done（诚实降级，同 workspace 探测端口缺席先例）；git
  命令失败=「不可校验」≠核验失败，滞留等待人工（锚对账 unavailable≠失配同款
  语义）。人工核验出口=新接口 `confirmTicketOutput`（awaiting→done+终态钩子），
  汇报卡/详情汇报页签出「人工确认交付」按钮。awaiting_output 占软预算活动位
  （worktree 未清理，dispatchEngine activeCountFor/listActiveWriteDomains 收入该
  状态——「两两写域不相交」不变式对滞留工单仍成立）。
- **未确认增量行**：schema v6 列 `increments_confirmed_ms`（人工确认时刻，唯一写者
  =confirmTicketIncrements）。快照投影 `incrementsConfirmedMs`；UI 派生「第 N 代
  重启，第 N-1 代末尾改动未确认」横幅（generationCount>0 且未确认时常驻，spec §2.4
  措辞同源），确认按钮置列后横幅出清；不回写 brief（原文不改写）。
- **证据页签**：快照 ticket 增可选 `briefFull`（界 `ticketBriefFullMax`=1500，与
  候选卡 verbatim 上界同值口径）；工件链接=writeDomain 既有投影只读展示
  （worktree=path+branch；paths/workspace=「无 git 工件」诚实降级）；Router 证据
  沿用 decisionId 关联（P2 形态不动）。

## 4. 配额中心（每日打扰）

- 计数：kv `quota:<yyyy-mm-dd>`，事件=决策卡推送/汇报推送/桌宠气泡（三端同源，经 TicketService 统一计数接口）；默认 5/日。
- 超额：非决策类推送聚合为次日摘要（决策卡类不抑制——安全优先于安静）。
- 设置：`drora.mate.dailyQuota` 进 AppSettings（P4 启用 01 号 §1.4 预留的 AppSettings 键路线：protocol.ts 接口+validationAppSettings 两处挂载+normalizeSettingsPatch）。
  **落地注记（2026-11-05，feat/mate-p4 host 侧批次）**：数据与判定面在
  `assistant-tickets/quotaCenter.ts`（kv 日记录=JSON {decision,report,bubble,digest,
  digestDelivered}，键格式 `quota:<yyyy-mm-dd>` 本地日；坏/缺值回落干净记录）。判定
  规则：三类事件都计数；decision 类永不抑制（allowed 恒 true）；report/bubble 类当日
  累计 > 配额即 `allowed=false` 并把摘要文本追加进当日 digest（有界：条数/单条长度
  contracts ASSISTANT_SNAPSHOT_LIMITS 单出处）。接口（IAssistantTicketService channel
  面，三端同源可达）：`admitDisturbance` / `getDisturbanceQuota`（当日用量+近 ≤7 日
  未投递摘要）/ `markDailyDigestDelivered`（投递回执，只结清今日之前的积压）。
  配额值=装配层注入的 settings 端口实时读 AppSettings（判定不经缓存；快照投影用
  服务闭包缓存值，判定与投影分离）。**AppSettings 属性名为 `droraMateDailyQuota`**
  （contracts `ASSISTANT_SETTINGS_KEYS.dailyQuota` 单出处；照 personaEnabled 先例
AppSettings 属性用 camelCase，`drora.mate.*` 命名空间归属记 spec §1）。UI 呈现
（状态条配额行/摘要卡/气泡闸接线）随 P4 UI 批次接力。
  **落地注记（2026-11-05，feat/mate-p4 第二棒批次）**：
- 状态条配额行：MateStatusStrip 消费 `snapshot.quota`（当日三类累计/生效配额/余量
  单行；字段缺席=旧 Host 不渲染，诚实降级）。
- 摘要卡：Mate 面板新增 MateDigestCard——近 ≤7 日未投递摘要（getDisturbanceQuota
  同口径快照投影 pendingDigest）+ watchdog 通知区（watchdogNotices ≤5）同卡分节，
  「标记已投递」按钮=`markDailyDigestDelivered` 回执（只结清今日之前的积压）。全部
  消费同一快照源，无第二计数器（P3 注记兑现）。
- 调整入口：MateConfigSection 增「每日打扰配额」行——草稿-dirty 纪律同名单编辑
  （快照推送不覆盖编辑中值），保存经 useSettings 写 AppSettings
  `droraMateDailyQuota`（键字面量 contracts 单出处；settings 服务缺席=输入禁用）。
  显示值=快照 quota.quota（服务闭包生效值）；保存 0-200 整数（validationAppSettings
  同界）。
- 气泡闸接线：MatePetSync 弹泡差分（deriveMatePetBubble）命中时先过
  `admitDisturbance(kind=bubble, summary=汇报首行)`——allowed=false 或判定通道失败
  皆不发布气泡帧（fail-closed；summary 已入 digest，汇报仍在 tray 速览与面板可见）；
  洗清「P3 不建第二计数器」注记。
  **落地注记（2026-11-05，feat/mate-p4 修复轮）——三类事件生产接线**：「三端同源」
  指统一经 admitDisturbance 进出（不建第二计数器），不假设三类各有常驻生产方：
  decision=gate 落卡事务（recordTrigger/sourceIngest 落 decision_card 同事务计数——
  落卡即推送事件；永不抑制，本接线兑现「仍计数」，quota 值对 decision 无判定效果，
  用快照投影同口径的缓存值+缺省回落）；report=watchdog 通知（§1）；工单终态汇报卡
  为快照被动呈现、无主动推送动作，其 report 计数生产接线随手机推送/主动推送通道
  批次补齐（spec §2.3 修复批注记/§14 遗留登记）——桌面现状下「汇报到达」的打扰
  语义由气泡闸（bubble）承接。auto_notice 告知卡不在三类分类学内，不计数。

## 5. P4 验收

1. 人为停滞（停掉目标会话进程）→ 30min 判据→stale 标记+通知，工单未被杀/未换代。
2. 信任条操纵测试数据达标→「切换 auto」出现→确认后 explicit 自动执行+告示卡；inferred 无证据→降级问人。
   **UI 半段验收资产（2026-11-05，feat/mate-p4 修复轮）**：浏览器候选
   mate-trust-auto.test.mjs（MTA01–03）覆盖入口出现→确认框（名单/预算/不可逆）→
   setMode 成功臂（快照收敛 auto+入口消失）与 mate.auto.locked 失败臂（专属文案+
   模式不翻转）——fixture 只造达标投影与一次复核失败，真实统计/复核在 host 侧单测
   （assistantP4Host）。coverage matrix「Mate P4 修复轮增量」节登记。
3. 汇报卡：三代工单成本分解正确合计；工件核验失败→滞留→watchdog 提醒。
4. 配额：6 次推送日→第 6 次起非决策推送聚合次日摘要；决策卡不受限。
