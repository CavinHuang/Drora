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

## 5. P4 验收

1. 人为停滞（停掉目标会话进程）→ 30min 判据→stale 标记+通知，工单未被杀/未换代。
2. 信任条操纵测试数据达标→「切换 auto」出现→确认后 explicit 自动执行+告示卡；inferred 无证据→降级问人。
3. 汇报卡：三代工单成本分解正确合计；工件核验失败→滞留→watchdog 提醒。
4. 配额：6 次推送日→第 6 次起非决策推送聚合次日摘要；决策卡不受限。
