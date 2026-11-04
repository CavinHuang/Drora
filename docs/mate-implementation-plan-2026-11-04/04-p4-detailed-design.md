# 04 · P4 详设（watchdog / auto 信任门 / 汇报卡完整版 / 配额中心）

- 对应 master plan §5。前置：P1-P3 台账数据齐备（would-accept/放行/usage/代际均已归账）。

## 1. watchdog（host cron 驱动）

- 挂载：复用 `desktop/src/host` cron 基建（`cronBotDelivery`/`cronRunLifecycle` 先例，`host/index.ts:151/:172`）注册内部定时任务（默认 15 分钟/轮，kv 可调）——**不进任何会话**，纯 host 侧读台账。
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

## 5. P4 验收

1. 人为停滞（停掉目标会话进程）→ 30min 判据→stale 标记+通知，工单未被杀/未换代。
2. 信任条操纵测试数据达标→「切换 auto」出现→确认后 explicit 自动执行+告示卡；inferred 无证据→降级问人。
3. 汇报卡：三代工单成本分解正确合计；工件核验失败→滞留→watchdog 提醒。
4. 配额：6 次推送日→第 6 次起非决策推送聚合次日摘要；决策卡不受限。
