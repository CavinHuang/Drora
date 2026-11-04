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
- observe=全量零执行：explicit 出决策卡、inferred 记 would-accept；
  auto 在信任门（P4）开启前恒拒（mate.auto.locked）。

与其它模块的交集：派发经 droraAgentService.sendConversationCommandV4（装配层
setAssistantDispatchPort 注入，本模块不 import drora-agent）；UI 只经 channel 代理消费
快照与动作（type-only 类型从 services index 引用）。
