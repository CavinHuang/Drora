# assistant-tickets

Drora Mate 个人助理工单台账（specs/drora-personal-assistant.md；台账 16——有意自研扩展，
上游无对应能力）。P1 范围：准入（off/observe × explicit/inferred）+ 决策卡人工放行 +
Mode A 直派（v4 createSession/sendText，commandId=ticketId 幂等）+ sqlite 台账。

不变量：

- 单一写者：trigger/admission_decision/mandate/ticket/usage_log 全部经
  IAssistantTicketService 事务写；其他模块不得直连 mate.sqlite。
- 消息不能改变权限：名单与模式只经 setAllowlist/setMode 变更；Trigger 正文只是输入
  （Mandate 仅 accept 创建 / 用户 stop / 校验失败撤销三条变更途径，spec §5）。
- 诚实失败：派发失败 → ticket=failed+fail_reason+mandate revoked，不静默重试、
  不用超时兜底；同 decision 二次放行幂等返回首次结果。
- turn 事件归账（01 §3）：服务工厂暴露 host 内部入口 `applyTicketTurnEvent`
  （不在 IAssistantTicketService，renderer 不可达）——状态机 running/done+output_summary
  （120 截断）/failed+reason+mandate 撤销、usage 差值行写 usage_log、updated_ms 单调
  丢弃迟到重放，服务测试锁定。**帧接线已交付**（2026-11-05）：派发成功即经
  `setAssistantFrameSource` 端口订阅 `droraAgentService.onDynamicConversationFrame`
  （workspace 目标与派发同形），帧→`parseTicketFrameEvents` 防御式解析（userInput 行=
  turn_started；assistantText 行 streaming/complete/failed/interrupted=started/completed/
  failed/cancelled；state.updated·usage/snapshot·usage=usage_snapshot，cumulative 嵌套
  解包）→ ledger 归账；工单终态或 stopMandate 自动退订。服务测试 22 项锁定（含 4 项
  帧接线用例：订阅同形/状态机推进/usage 差值/stop 退订/异常帧空数组）。
- 并发幂等（PR-1B 三审发现 7）：同 decisionId 并发放行由 approve 事务内按 decision_id
  查重（alreadyExisted 臂跳过派发）+ ticket(decision_id) UNIQUE 索引双防线闭合。
- observe=全量零执行：explicit 出决策卡、inferred 记 would-accept；
  auto 在信任门（P4）开启前恒拒（mate.auto.locked）。

与其它模块的交集：派发经 droraAgentService.sendConversationCommandV4（装配层
setAssistantDispatchPort 注入，本模块不 import drora-agent）；UI 只经 channel 代理消费
快照与动作（type-only 类型从 services index 引用）。
