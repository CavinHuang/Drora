# Drora Team 面全维度审查汇总报告（2026-10-24）

## 0. 元信息

- **审查基线**：`HEAD = 5982f5b5`（分支 `feat/team-staged-approval-panel` 已提交状态）。现状面盘点已核对：工作区约 39 个未提交 WIP 文件均不含 team 面（`git status --porcelain | grep team` 为空），对有 WIP 污染的文件以 `git show HEAD:` 核对。
- **审查对象**：agents-team 全链——`specs/agents-team.md`（2517 行）、core 内核（`apps/drora-cli/packages/core/src/team`）、bootstrap 装配（`drora-team` / `agents-team-skill-gate` / v4 handlers）、shared wire 契约、ui-team 受管模块、i18n、core/bootstrap/UI 测试面与 desktop staged-approval E2E 登记。
- **方法**：四个维度独立复核后汇总——**gap**（规范缺口：spec 承诺 vs 实现与登记）、**norm**（规范符合：AGENTS.md/DESIGN.md/architecture-policy/oxlint 治理）、**regression**（回归与测试锁定）、**wire**（契约与协议纪律）；另以两份盘点作覆盖参照：规范清单（66 条成文规则，出自 AGENTS.md 98 行 / DESIGN.md 694 行 / architecture-policy.yaml 1003 行 / specs 2517 行 / .oxlintrc.json 127 行 / .oxfmtrc.json 46 行全文）与现状面盘点（17 个 area 的只读描摹 + 区间 `b7c2e810..5982f5b5` 五笔提交逐笔影响）。
- **证据纪律**：各发现条目内的实读行号与实跑命令/输出均转录自四维复核材料；本汇总撰写员另抽验了两条最重发现（见 §2 H-1 与 M-6 的「汇总抽验」标注），抽验结果与材料一致。除抽验外本报告未重跑各维度命令。
- **计数口径**：新发现 23 条（high 1 / medium 11 / low 11，其中 1 条为跨维度合并条，覆盖原 3 条发现）；已登记复述（登记订正）1 条（medium）。全报告合计 24 条，high 1 / medium 12 / low 11。

---

## 1. 结论摘要

### 1.1 还剩什么缺口

1. **正确性级（唯一 high）**：E12「写成功才算发送成功」门在生产装配下不可达——`saveSessionEntry` 按 port 契约即 async，写失败只变成被 `.catch` 吞掉的 warn，hub 的 `mailbox_persist_failed` 拒绝路径生产不可达；而 5982f5b5 写进 spec 的订正文案把这条不可达路径登记为已达契约（详见 H-1）。
2. **行为不变量破口**：`deliverLeadMail` 逐条注入中途 return false，与 hub「失败整批释放留 queued 重投」组合出部分注入重复投递 + 离册死件永久滞留两个幂等破口，spec §16 契约 3「重投恰一次」不变量在角落路径被破，测试零覆盖（M-1）。
3. **契约纪律失守**：`historyTeamMismatch` 自造错误码逃逸封闭联合且 spec 零登记（M-4）；单一出处常量三组「已立未接」——`TEAM_LEAD_ASSIGNEE`、`TEAM_MEMBERS_MAX_DEFAULT`、`TEAM_MEMBER_DEFAULT_MAX_TURNS`/`TEAM_LIMITS.memberDefaultMaxTurns` 在生产代码被手写字面量绕过（M-5）。
4. **验证门失真**：HEAD 架构检查 FAILED（`agents-team-skill-gate` 受管模块缺 `contract.test.ts`，`verify:pre-push` 在该分支恒红，M-7）；`core/src/team` oxlint 1 error（hub.ts 超 800 行）+ 3 warnings（M-6）。
5. **spec 回写半边系统性缺位（gap 维度主诉）**：已实现的行为不登记（送达翻转补通知，M-9；§20 两契约缺实现验证段，L-1）；承诺已废弃/被取代却不回写（摘要行/idle 折叠，L-3；产物区落盘，L-5；wire 注释「可改负责人/依赖」，L-2）；「必填/待评估」既无实现也无取舍留档（fork 世代链 M-10、MobileTeamPanel M-11、§8.6 workspaceIdentity L-4、M4 具名工具策略评估 L-6）。
6. **UI 与远程面残留**：幽灵 token `bg-neutral-foreground/40` 三处不生成 CSS（M-8，上轮清除漏网同族）；手机远控状态面板 team 分区整体缺席、退化形态与 spec 登记不符（M-2）；`useTeamHistory` refreshKey 活性缝零测试锁定且信号漏两类真实活动边缘（M-3）；i18n 守卫扫描清单漂移（L-7）；44px 补齐登记清单漏成员行消息按钮（§3 登记订正 R-1）。

### 1.2 规范符合度画像

对照规范清单 66 条规则与现状面 17 个 area：

**符合面（基本盘稳固）**
- 数据所有权链单一：TeamHub 进程内唯一写者 → journal 事实流 → `TeamStateChanged` → product-projection 键级替换 → UI `conversationProjectionStore` 单通道派生；命令走 `team/commands.ts` 单一通道；desktop main 零 team 业务状态；未发现重复状态或多条写路径违规。
- 灰度三缝同源：`resolveAgentsTeamEnabled` 单一裁决，装配门/slash 门/skill 门同源，env 字面量收口 shared 常量。
- 测试面主力健在：core `tests/team` 13 文件 166 用例全绿（复核实跑）；ui team 侧抽测 4 文件 52 用例全绿；staged E2E 3/3 绿证据已登记（a708bb71）；i18n 双向守卫当前绿。
- 契约级「零 wire 词表扩展」声明齐备（§16/§19/§20 三处）；还原/自研物理隔离未被破坏；teammate 复用 `subagent_child` 无新 taskType。

**失守面（集中在三类机制）**
1. **spec 先行纪律只有「先写」缺「回写」**：gap 维度 9 条全部属于「spec 与事实脱节」——要么实现了不登记，要么不实现了不登记改期，要么登记文案与实现方向相反（E12 属此类的最重形态）。
2. **单一出处常量「声明了但消费不接线」**：常量定义全部在案，生产代码各自手写字面量，值靠人肉同步（M-5 三组、L-2 wire 注释同族）。
3. **登记与验证门的准确性漂移**：arch check 红、oxlint 红、44px 登记清单与实况差一处、i18n 守卫白名单与真实消费面漂移——「登记本身失准」开始成为独立风险源。

**维度分布**：gap 9 条（3 medium / 6 low）、norm 8 条（4 medium 新 + 1 登记订正 / 3 low）、regression 4 条（1 high / 2 medium / 1 low）、wire 5 条（3 medium / 2 low，其中 1 medium 并入 M-5）。

### 1.3 最要紧的三件事

1. **先修 E12 不实陈述（唯一 high）**：把 `specs/agents-team.md:900-908`、§2.1 术语表 TeamMailbox 行与 `install.ts:149-188` 的注释/warn 文案改为如实口径（当前实现 = 入队成功即发送成功、刷盘失败只 warn、恢复源 journal 且同一 DB 故障下同丢）；再决策是否做真门（同步可校验写或 hub await 化，动 port 面须按 spec 决策流程登记）或登记启动对账补崩溃窗口。
2. **收口 deliverLeadMail 幂等破口**：spec 先登记「离册死件处置 + 批内已注入条目不重投」边界，再改逐条容错 + 补 removed-sender 单测与重投不重复断言（M-1）。
3. **恢复验证门可信度**：补 `agents-team-skill-gate/contract.test.ts` 让 `pnpm architecture:check` 回绿（否则 `verify:pre-push` 恒红失去门的作用，M-7）；hub.ts 做拆分或按 steering.ts 先例登记降级并清掉 3 个 `no-unused-vars`（M-6）。

### 1.4 新发现 vs 已登记复述

- **新发现 23 条**（§2）：high 1 / medium 11 / low 11。全部经各维度复核确认 `registeredDup=false` 准确——即 specs/agents-team.md 与既有登记中均无对应载体。
- **已登记复述 1 条**（§3 登记订正）：44px 触达（TeamPanel.tsx:392）——行为缺口本身在 spec §19 契约 6 E 节的「全局一致性破口」登记射程内，但登记清单（四处）漏了这一处，属登记失准的订正而非新立缺口。
- **被推翻项**：四个维度返回的 `rejected` 数组全部为空，本轮无被推翻发现（复核过程中的内部订正见 §5）。

---

## 2. 发现清单（新发现，severity 降序）

每条格式：位置 / 问题 / 维度 / 建议方向 / 证据。

### high

**H-1｜E12「写成功才算发送成功」门在生产适配器上不可达，spec 已达契约表述与生产行为不符**
- **维度**：regression
- **位置**：`apps/drora-cli/packages/bootstrap/src/app/drora-team/install.ts:176`（关联 `install.ts:149-188`、`core/src/team/hub.ts:1478-1484`、`specs/agents-team.md:900-908` 与 `:150` 术语表 TeamMailbox 行）
- **问题**：`SqliteSessionStore.saveSessionEntry` 是 async 方法（port 契约 `session-store.port.ts:1141` 本身即 `Promise<void>` 签名），写失败只变成 rejection 被 install 侧 `.catch` 吞成 warn；hub 的 `mailbox_persist_failed` 拒绝路径（`hub.ts:1478-1484`）只在 persist **同步**抛错时可达，生产装配下不可达。5982f5b5 写进 spec 的不变量（含订正文案「写成功才算发送成功…同步抛错由 hub enqueueMail 转 mailbox_persist_failed」，`specs/agents-team.md:900-908`、`:150`）与生产行为不符。锁定该语义的测试⑫（`team-install-runtime.test.ts:576-580`）注入点自注明「非异步函数 + 同步 throw」（:577 无 async），生产适配器不命中该形态——测试绿不能证明生产门存在。
- **建议方向**：先修不实陈述，再补真门：① `specs/agents-team.md:900-908` 与 `install.ts:149-188`（含 :172-173 注释、:180 warn 文案）改为如实口径，并注明「同一 DB 故障下 journal 恢复源同丢、E12 在其目标失效模式上未增益」；② 若要真守住，需把邮箱持久化做成真实同步可校验写（适配器暴露同步写入路径，或 hub 侧 await 化 + TeamSendResult 变异步——后者动 port 面须按 spec 决策流程登记）；③ 或登记启动对账（`team.mailbox` 条目与 journal `message_appended` 比对）补崩溃窗口。
- **证据**：`install.ts:172-173` 注释称「saveSessionEntry 同步抛错自然向上传播」，:176-177 实际 `const pending = store.saveSessionEntry?.(durable); pending?.catch(...)` 异步拒绝只 warn；生产适配 `sqlite-session-store.ts:645-648` 为 `async saveSessionEntry`（dist 编译产物 :486 同）；async 方法内任何 throw（含 `repositories/session-entries.ts:20-22` JSON 序列化 throw）只以 rejection 冒出；生产装配确为 SqliteSessionStore（`bootstrap/src/app/session-store.ts:90-100`、`create-app.ts:277-279`）。复核者以 `node -e` 实证 async 方法 throw 后「调用点同步抛错 = false → try/catch 捕获不到 = true」。附加实锤：journalSink 与 persistMailboxEntry 落同一 sessionStore（`install.ts:136-147` vs `:160-161`），`install.ts:180` warn 文案声称「journal message_appended fact stays the restore source」——同一 DB 故障下该恢复源同样丢失，兜底声明在其目标失效模式上不成立。`registeredDup=false` 准确：spec:900-908 是「已达契约」登记而非已知缺口登记。
- **汇总抽验（本会话实读）**：`install.ts:149-188` 已直接读取，:176 `const pending = store.saveSessionEntry?.(durable);` 与 :177 `pending?.catch(...)` 属实，:172-173 注释与实现矛盾属实。

### medium

**M-1｜deliverLeadMail 部分注入 + 离册死件永久滞留，两处幂等破口，spec §16 契约 3「重投恰一次」在角落路径被破**
- **维度**：wire
- **位置**：`apps/drora-cli/packages/bootstrap/src/app/drora-team/install.ts:350-355`（关联 `hub.ts:1638-1648`、`mailbox.ts:80-89`/:233-246、`subagent-messages.ts:25-75`、`runtime-command-queue.ts:25-48`）
- **问题**：`deliverLeadMail` 逐条注入中途遇失败条目 return false，而 hub 侧 `accepted=false → releaseDeliveryLease(...)` 整批释放留 queued 等下个投递边缘重投（重投边缘四处：routeMail lead 分支 `hub.ts:1505-1507`、kickTeam 末尾 `hub.ts:878`、lead TurnComplete `install.ts:532`、冷恢复 `install.ts:587`）。组合出：① 批次内失败条目**之前**的条目已注入，整批重投时重复注入——`enqueueSubagentMessage`/`enqueueRuntimeCommand` 均无 responseId 幂等去重，`persistSubagentMessageCommand` 每次 `createMessageId()` 新 ID 并 `messageHistory.addUser`，重入即双写；② 发件人已被移除的无世代键邮件 `isCurrentMail` 恒 true（`mailbox.ts:80-89` 走到 :89 `return true`），`discardStaleMail` 只清 `isCurrentMail=false` 条目——且 `discardStaleMail` 生产代码零调用点（grep 仅命中定义处），「世代过滤/清理路径收敛」（`install.ts:349` 注释）与实现矛盾，死件每个投递边缘重试失败、永不收敛。core/tests/team 对该场景零覆盖。
- **建议方向**：spec 先登记「离册死件处置 + 批内已注入条目不重投」边界后改码：deliverLeadMail 改逐条容错（离册条目跳过并回报跳过清单，hub 对不可投条目按丢弃/显式标记处理而不是整批 release）；补 removed-sender 单测与重投不重复断言；`install.ts:349` 注释与实现一并对齐。
- **证据**：`install.ts:352-355` 实读（失败条之前条目已注入）；`hub.ts:1638-1648` 实读（false → 整批 release 留 queued）；`removeMember`（`hub.ts:810-843`）只失效任务/翻状态/kick 不清理被移除成员未投递邮件；`mailbox.ts:233-246` 只清 isCurrentMail=false；`grep -rn discardStaleMail apps/drora-cli/packages/*/src` 仅命中定义 `mailbox.ts:234`；测试盲区复现 `grep -rn "deliverLeadMail|deliverPendingLeadMail|lead_injected" tests/team/*.ts | grep -i "removed|missing|partial|false"` 零命中（exit=1）；spec `:1573` 不变量、§20（:2370-2515 全文实读）与 §14 缺口12（:1242-1263）均未登记本边界——`registeredDup=false` 准确。

**M-2｜手机远控状态面板 team 分区整体缺席：登记的「行退化为不可点」退化形态在 mobile-web 面不成立**
- **维度**：regression
- **位置**：`packages/ui/src/v4/RemoteConversationTimeline.tsx:163`
- **问题**：RemoteConversationTimeline 渲染 ConversationStatusPanel 时未传 team prop（只传 goal/plan/backgroundWorks/runningSubagents/layoutMode），spec §19 契约 6 与组件注释登记的「宿主缺席（手机远控未接线）时行退化为不可点事实行」在 mobile-web 面不成立——实际是分区连 hasContent 一起消失，而非行退化为不可点。spec `:2311-2316` 的「有意取舍（登记，不做）」清单只有 composer 徽标与 running 时长两条，无「手机面板不出 team 分区」的登记。
- **建议方向**：补传 `team={statusSnapshot?.team ?? null}`（onOpenTeamPanel 保持缺席即得登记的不可点退化行；buildTeamModel/TEAM_LIVE_STATUSES 已在模型层过滤 staged/终态，`conversationStatusPanelModel.ts:469-472`）；若有意不让手机面板出 team 分区，则先修 `specs/agents-team.md:2309-2310` 与 `ConversationStatusPanel.tsx:1341-1347` 注释的表述再实现。
- **证据**：数据在手——`RemoteStatusSnapshot` 类型 :26-28 的 Pick 含 "team"，footerSlot :188-196 在用 `statusSnapshot.team` 渲染 TeamConversationSummary，测试夹具 `test/fixtures/agents-team-remote-browser.fixture.tsx:108` 亦按 `statusSnapshot={{ team }}` 注入；ConversationStatusPanel 侧 team 通道完整（props :131-133、模型层 :175/:443/:462/:469-472）；SessionPane 侧退化形态已实现（`SessionPane.tsx:5854-5857`），唯独 mobile-web 宿主漏接——宿主链核实：`mobile-web/legacy-v3.14.3/app/App.tsx:719` → `RemoteTaskTimeline.tsx:36/:98` 原样透传 → RemoteConversationTimeline :163 处丢弃 team。

**M-3｜useTeamHistory refreshKey 活性缝零测试锁定，且信号拼接漏 delivered 翻转与无板活动的 halt/resume 两类真实活动边缘**
- **维度**：regression
- **位置**：`packages/ui/src/hooks/useTeamHistory.ts:63`（关联 `TeamProcessPanel.tsx:26-46`、`specs/agents-team.md:2329-2332`）
- **问题**：00670ca1 修复「查询一次后停帧」引入的 refreshKey 活性缝零测试锁定，修复本身可无声回归；activitySignal 仅含看板四列计数 + working 成员数 + 最大 task.updatedAt + 尾窗末条 messageId，漏两类边缘：(a) 送达翻转只改 `mailboxTail[].delivered` 与新增 journal `message_delivered`，messageId/计数/updatedAt 全不变——已打开的过程页对「已送达/待投」历史事实不自动刷新（尾窗徽标可见但历史页漏）；(b) idle 队 halt/resume 仅迁移 record.status + 记 journal + notifyChange（`hub.ts:573-588`/:605-618），不动板计数与任务 updatedAt——信号不动。spec `:2329-2332`「任一活动边缘抬升即重查当前页」的表述与实际信号覆盖不符。
- **建议方向**：补两块测试（refreshKey 变化触发重查 + activitySignal 纯函数单测）；信号侧把 mailboxTail 末条 delivered 与 team.status 拼进 signal（均为投影既有字段，零 wire 词表扩展）；spec 表述随信号补齐或如实收窄。
- **证据**：`grep -rln "useTeamHistory|TeamProcessPanel|activitySignal|refreshKey" packages/ui/test/` 仅命中 workflow 侧，team 侧零命中；`find packages/ui -name "*useTeamHistory*"` 仅 src 一个文件无测试；`git show --stat 00670ca1` 确含两文件改动；另实跑 `npx vitest run test/teamCollaboration.test.ts` 5/5 绿（论证不建立在失败测试上）；「ui 侧七文件 66 用例全绿」未逐文件重跑，不影响成立（零覆盖为静态可证事实）。

**M-4｜getTeamHistory 自造错误码 historyTeamMismatch 逃逸封闭联合，spec 零登记**
- **维度**：wire
- **位置**：`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/team.ts:293-297`
- **问题**：teamId 不匹配拒绝自造 `"historyTeamMismatch"`（reasonCode=`fault.command.teamRejected.historyTeamMismatch`）——既不在 TeamPortErrorCode 联合（`team.port.ts:210-239` 共 21 码），也无 errors.ts 文案；`handlers/team.ts:46` 类注释声称「TeamPortErrorCode 透传为 reasonCode 后缀，文案单一出处 core errors.ts」，两承诺皆不成立。specs/agents-team.md 全文对该码与 teamHistoryUnavailable 拒绝语义零登记，封闭联合被 handler 层打破。而 smoke 测试已固化该码（`team-commands-smoke.test.ts:154-158`）。
- **建议方向**：spec 补登记 getTeamHistory 拒绝语义（teamId 不匹配→该码、持久化缺席→fault.command.teamHistoryUnavailable）并附词表声明；或把 historyTeamMismatch 纳入 port 联合/errors.ts 单一出处。二选一收口，改码侧须同步改 smoke 测试断言。
- **证据**：`handlers/team.ts:293-297` 实读（文案内联英文）；errors.ts switch 21 case 与联合一一对齐无此值；`grep -n "historyTeamMismatch|teamHistoryUnavailable|getTeamHistory" specs/agents-team.md` 零命中（exit=1），TEAM_HISTORY_QUERY 仅 :2323 UI 通道收口一处。附注：UI 侧 reasonCode 进 recordV4CommandAck 观测环但失败统一 `{ok:false}` 不消费文案，无用户面缺口，属契约登记与错误码族纯度问题。措辞校准：所引 spec 行并无字面 standing 规则「未经登记不得扩词表」，该约束由词表声明 + AGENTS.md spec 先行与契约键单一出处纪律共同确立——违反实质不受影响（详见 §5）。

**M-5｜契约字面量与限额缺省单一出处纪律执行缺口：常量已立、消费未接线（跨维度合并条，涉及维度 norm + wire）**
- **维度**：norm + wire（原 3 条发现合并：norm「lead 字面量」medium + norm「membersMax 缺省 5」low + wire「maxTurns 四处字面量」medium；合并依据见 §4）
- **位置**：
  - a) `apps/drora-cli/packages/core/src/team/message-format.ts:33`、`:46`
  - b) `apps/drora-cli/packages/bootstrap/src/app/drora-team/install.ts:295` 与 `core/src/team/hub.ts:245`
  - c) `apps/drora-cli/packages/bootstrap/src/app/drora-team/install.ts:76`（关联 `member-runtime.ts:149`、`contracts/src/interfaces/team.port.ts:52`、`shared/src/drora-protocol-v4/team.ts:43`）
- **问题**：三组同一机制的违例——单一出处常量已在 shared/contracts 定义，生产代码不引用而手写字面量：
  - a) **lead 寻址键**：buildRevivalBody/buildSteerBody 两处 `entry.from === "lead"` 手写，绕过 `TEAM_LEAD_ASSIGNEE`（`shared team.ts:23-27` 注释明言「任何一侧不得再手写 "lead" 字面量」、core `types.ts:166-171` 自称仅再导出）；core 依赖 @drora/shared 可引未引。若寻址键改动，此两处静默漂移为把 lead 显示成 "member lead"。
  - b) **成员上限缺省 5**：`install.ts:295` 与 `hub.ts:245` 各自 `?? 5` 硬编码，绕过已定义的 `TEAM_MEMBERS_MAX_DEFAULT`（`team.port.ts:55`，shared `team.ts:46` 注释明言由该常量治理、spec `:130` 亦指向契约常量区）——零代码消费。值当前一致无行为影响，但 spec §1 改默认值时需同步两处。
  - c) **成员 maxTurns 40**：真实生效值是 `install.ts:76` 手写 `const TEAM_MEMBER_MAX_TURNS = 40`，`member-runtime.ts:149` 另有兜底字面量 `?? 40`；登记的两个单一出处常量 `TEAM_MEMBER_DEFAULT_MAX_TURNS`（team.port.ts:52，注释称「成队/建成员时 hub 兜底填入」——该消费路径实查不存在，属误导性契约注释）与 `TEAM_LIMITS.memberDefaultMaxTurns`（shared team.ts:43，注释自称「镜像登记」但镜像对侧无人消费）全仓零生产消费。改任一常量声明不影响任何行为，四处同值纯靠人肉同步。对照同族：`TEAM_LIMITS` 本身有规范消费先例（hub.ts:23 import、team-tools.ts:391-402 注释自言「§17 契约 4 单一出处」）。
- **建议方向**：统一收口——a) message-format.ts 改引 `TEAM_LEAD_ASSIGNEE`（或复用 types.ts:171 的 LEAD_ASSIGNEE_KEY 再导出）；b) hub.ts:245/install.ts:295 改引 `TEAM_MEMBERS_MAX_DEFAULT`；c) install.ts 删手写常量改引 `TEAM_MEMBER_DEFAULT_MAX_TURNS`，member-runtime.ts:149 兜底同步收口，订正 team.port.ts:52 误导注释。a 项同步在 spec 消息面小节补单一出处声明。
- **证据**：a) 全量 `grep -rn '"lead"' core/src/team bootstrap/src packages/ui/src/team`（排除 test）→ 代码字面量仅 message-format.ts:33/:46 两处，UI 与 hub 均走常量（grep -l 证实）；core/package.json:38 已依赖 @drora/shared。b) `grep -rn membersMax` 复现两处 `?? 5`；`TEAM_MEMBERS_MAX_DEFAULT` 生产消费点仅定义处与注释。c) `grep -rn "TEAM_MEMBER_DEFAULT_MAX_TURNS|memberDefaultMaxTurns"` → 仅两个定义处零消费；`grep -rn "TEAM_MEMBER_MAX_TURNS"` → install.ts:76 定义 + :486/:494 消费。bootstrap/core 均已在 package.json 依赖 @drora/contracts。

**M-6｜core/src/team oxlint 1 error + 3 warnings：hub.ts 有效行 1523 > 800 且无降级处置，spec 登记的 CLI 验证口径当前不成立**
- **维度**：norm
- **位置**：`apps/drora-cli/packages/core/src/team/hub.ts:1963`
- **问题**：specs/agents-team.md:1187-1189 登记的 CLI 侧验证口径「逐文件 oxlint --no-ignore（0 警告 0 错误）」当前不成立。error 为 hub.ts max-lines 有效行 1523 > 800（`.oxlintrc.json:6` error 级；存量 warn 降级清单 `.oxlintrc.json:10-38` 只含 steering/turn/turn-model-step 等文件，不含 hub.ts）；warnings 为 no-unused-vars 三处：`types.ts:9`（TeamSendDelivery 导入未用）、`team-tools.ts:94`（TeamTaskUpdatePatchSchema 死 schema）、`member-runtime.ts:74`（hasConcreteModel 解构未用）。行数追溯：05625f17~1 时 hub.ts 已 1360 行（超标为既有），5982f5b5（=HEAD）增至 1963 行且未做降级/拆分/豁免处置。spec:1186 该口径自带「批次报告转录，本节登记未复跑」标注——登记口径与当前实况矛盾属实。bootstrap 侧复跑：`product-projection.ts` 亦 1 error（当前总行 6007，05625f17 前已超标）。
- **建议方向**：按治理既有模式二选一：① hub.ts 按职责拆小（终态失败分类/交接三步/邮箱租约已有分段线）回到 800 内；② 短期不可拆则把 hub.ts 加入 `.oxlintrc.json:10-38` 降级清单并在 spec 登记（照 steering.ts 先例）；同时清掉三个 no-unused-vars（types.ts:9 与 team-tools.ts:94 为可直接删的死代码）。
- **证据**：复现 `cd apps/drora-cli/packages/core && npx oxlint src/team --no-ignore` → 「Found 3 warnings and 1 error. Finished in 27ms on 13 files」，error 块 `eslint(max-lines): File has too many lines (1523). -[src/team/hub.ts:1963:2] … Maximum allowed is 800`；行数 `git show "05625f17~1:…hub.ts" | wc -l` = 1360、`git show "5982f5b5:…hub.ts" | wc -l` = 1963。
- **汇总抽验（本会话实跑）**：同命令复跑输出「Found 3 warnings and 1 error. Finished in 42ms on 13 files with 96 rules」，与材料一致。

**M-7｜agents-team-skill-gate 受管模块缺 contract.test.ts：HEAD 架构检查 FAILED，verify:pre-push 在该分支恒红**
- **维度**：norm
- **位置**：`apps/drora-cli/packages/bootstrap/src/app/agents-team-skill-gate/module.ts:6`
- **问题**：HEAD 全量架构检查 FAILED——受管模块缺 `contract.test.ts`（missing-module-artifact，五件套 module.ts/contract.ts/contract.example.ts/contract.test.ts/CONTRACT.md 须俱在且位于模块 roots 内）。48a6b0dd 补了受管登记（`architecture-policy.yaml:830-843`）但工件未补全：模块目录现只有 CONTRACT.md/contract.example.ts/contract.ts/index.ts/module.ts 五文件，契约测试在模块外 `bootstrap/tests/agents-team-skill-gate.test.ts`（195 行）。该「修 arch 检查违规」的登记处置本身仍使检查红。
- **建议方向**：补 `agents-team-skill-gate/contract.test.ts`（可从既有模块外测试提炼契约级断言：bundled agents-team 剔除/用户同名技能不误伤），或经 architecture:adopt 流程调整该模块工件要求。
- **证据**：复现 `pnpm architecture:check` → 「architecture: FAILED / violations: 1 / baseline: 0 / new: 1 / - missing-module-artifact apps/drora-cli/packages/bootstrap/src/app/agents-team-skill-gate: 模块 agents-team-skill-gate 缺少 contract.test.ts」；判定逻辑 `scripts/architecture/index.mjs:91-113` 与输出吻合；`git status --porcelain` 对相关路径无输出——失败属 HEAD 已提交状态；specs/agents-team.md 全文无此缺失登记。

**M-8｜幽灵 token：bg-neutral-foreground/40 在任何主题层都不存在，idle/cancelled/archived 状态圆点与两处 fallback 圆点实际无背景色**
- **维度**：norm
- **位置**：`packages/ui/src/team/team-status-presentation.ts:49`（关联 `TeamPanel.tsx:429`/:622）
- **问题**：`TONE_DOT_CLASS.neutral` 使用 `bg-neutral-foreground/40`，但 `--color-neutral-foreground` 在本仓任何主题层都不存在（styles.css @theme 区零此变量、node_modules/shadcn/dist/tailwind.css neutral 零命中、tailwindcss/theme.css 仅 --color-neutral-50..950、safelist 未列），该类不生成 CSS——三个状态圆点与 TeamPanel 两处 fallback 圆点（fromColor/assigneeColor 缺席时）视觉上消失。违反 DESIGN.md:245「不得用 ad hoc 值替换语义 token」。且 specs/agents-team.md:1938-1942 恰好登记过一轮同族幽灵 token 清除（bg-neutral-2/bg-neutral-3/text-neutral-foreground「类静默不生效」改语义 token），本三处是该轮漏网的同族残留——「类静默不生效」机制已由该登记实证过。`bg-neutral-foreground/40` 全仓仅 team 3 处。状态文字并行呈现故功能不致死，但 dot 形同虚设。
- **建议方向**：neutral tone 改本仓真实 token（如 `bg-foreground-subtlest`；不建议新登记 `--color-neutral-foreground` 引入第二套中性命名）；TeamPanel.tsx:429/622 两处 fallback 收口改引 TONE_DOT_CLASS；在 spec §1938 登记带上轮清除漏网补清。
- **证据**：`grep -n neutral packages/ui/src/styles.css` 全部为 50..950 引用；`grep -c neutral node_modules/shadcn/dist/tailwind.css` = 0；`grep -n color-neutral node_modules/tailwindcss/theme.css` 仅 50-950 共 11 档；`grep -rn neutral-foreground packages apps`（ts/tsx/css）仅三处命中；定义点与 DESIGN.md:245、specs:1938-1942 原文已读。

**M-9｜「送达翻转补通知」已实现但 spec 全文零登记，代码注释自称依据的留档项在 spec 与深审报告中均不存在**
- **维度**：gap
- **位置**：`apps/drora-cli/packages/core/src/team/hub.ts:935-940`、`:1541-1550`、`:1594-1597`
- **问题**：mailbox deliveredAccepted 翻转后补 refreshStatus+notifyChange（working/steered/resumed 三分支）已实现，但 specs/agents-team.md 全文零登记；代码注释自称依据「2026-10-23 留档项『成员邮件 delivered 翻转不通知』」，该留档项在 spec 与 `docs/team-ui-deep-review-2026-10-22.md` 中均不存在（两处 grep 均零命中）——实现溯源断链。5982f5b5 标题「§19 契约 1/6 追补收口」的表述也与实况不符：§19 契约 1（:1969 起）仅登记 abandonStage 补通知半边。
- **建议方向**：在 spec §16 契约 3 或 §19 补登记「送达事实翻转必发 TeamStateChanged」契约（三分支、markDelivered→journal→refreshStatus→notifyChange 次序、租约盖戳/释放与冻结门不动的边界）；订正 5982f5b5 的「契约 1/6 追补」表述为独立行为面。
- **证据**：实读三段代码注释原文与发现引用一致；`grep -n "翻转\|成员邮件\|delivered 翻转" specs/agents-team.md` exit=1；深审报告 `grep -n "翻转\|delivered"` exit=1；spec:1953「其余 confirmed 项按 severity/批次留档不落本节」实读；git log 5982f5b5 标题实读；AGENTS.md:3「先更新 spec」纪律。

**M-10｜§16.3 自称「必填」的 lead 世代链 fork 身份继承零实现且无改期登记**
- **维度**：gap
- **位置**：`specs/agents-team.md:814-818`（§16.3）
- **问题**：spec 自称「此规则必填」的 lead 世代链 fork 身份继承（fork 沿世代链继承 lead 身份、报告投递在世 fork 后代、成员 fork fail-closed、深度上界 32、环防护）零实现且无改期登记——真缺口。fork 会话种类真实存在（`core/src/runtime/methods/session-fork.ts:162` kind 默认 "fork"、`packages/shared/src/drora-slash-command-help.ts:88` /fork 命令）；hub 登记表单键（`install.ts:85`/:96/:538 均 leadSessionId 单键）；team 生产代码 grep "fork" 零命中。
- **建议方向**：两头二选一并落 spec：按 §16.3 补实现（世代链解析 + 深度 32 + 环防护），或明确登记「fork 身份链 v1 不做、fork 会话对 team 的可见语义（无 team/只读/拒绝）」的决策记录。
- **证据**：`grep -rn -i fork <team 三目录>` exit=1；install.ts 三处单键实读；spec `grep -n fork` 仅 :732（memberProvider fork 后端，另一概念）与本节两处，无「暂不做/改期」登记；spec:817/:818 原文实读。

**M-11｜MobileTeamPanel 在 spec 三处被承诺为交付物、CONTRACT.md 列名职责，但全仓零实现、无改期/取舍登记**
- **维度**：gap
- **位置**：`specs/agents-team.md:336`、`:555`、`:648`（M3 范围）
- **问题**：MobileTeamPanel 在 §6.1 文件总表、§10 Web/手机面、§12 M3 里程碑三处被承诺为交付物，`packages/ui/src/team/CONTRACT.md:20` 也列名职责，但全仓零实现（grep 全仓仅命中 CONTRACT.md 一处），`packages/ui/src/mobile/` 实际仅 MobileHomeShell/MobileTaskShell/StatusCards/index；spec 无改期/取舍登记（M3 实现登记 :886-919 未含、§18 移动端仅登记 RemoteConversationTimeline 摘要卡、:898 的 PR-3.2 只以冷恢复 E2E 名义出现）——里程碑验收物静默缺席。
- **建议方向**：落决策记录二选一：手机 team 面 =「RemoteConversationTimeline 摘要卡 + 既有 v4 命令链路即全部」（则订正 :336/:555/:648 三处与 CONTRACT.md:13/:20 职责），或补 MobileTeamPanel 实现。
- **证据**：`grep -rn MobileTeamPanel packages apps`（排 node_modules/dist）仅命中 CONTRACT.md:20；`ls packages/ui/src/mobile/` 实际四文件；M3 实现登记与 §18:1921-1922 实读；`grep -n "PR-3.2\|手机端\|MobileTeam" specs/agents-team.md` 仅五处、无缺席登记。

### low

**L-1｜§20 两契约已落地实现且测试全绿，但 spec 未补「实现验证」段，契约在 spec 中读作未落地状态**
- **维度**：gap
- **位置**：`specs/agents-team.md:2388-2517`（§20 契约 1/2）
- **问题**：终态源报告剥离（sourceAttemptId）与 findDuplicateMail target 双键两契约已随 05625f17 落地、测试全绿（core tests/team 13 文件 166 用例），但 §20 标题仍写「2026-10-23 登记，先于实现」——「实现验证」段（grep 六处全在 §16，§20 零命中）缺位使实现溯源断档；git log 05625f17 也只列「§19 契约 1-4」未提 §20。
- **建议方向**：照 §16 先例在 §20 两契约末尾各补实现验证段（实现落点、终局实跑 13 文件/166 绿、有意收敛用例锁定），订正契约状态；§20 末尾「不做」句后的状态表述同步回写。
- **证据**：`hub.ts:1376-1396`/:1450-1451、`mailbox.ts:42-52`/:96-128 注释引「spec §20 契约 1/2」实读；测试 `team-hub.test.ts:1500-1502`、`team-mailbox.test.ts:279` 实存；实跑 `cd apps/drora-cli/packages/core && npx vitest run tests/team` → Test Files 13 passed / Tests 166 passed（7.96s）；`grep -n "实现验证" specs/agents-team.md` 六处全在 §16；§20 标题 :2370 实读。

**L-2｜wire 注释宣称「编辑器可改负责人/依赖」，与 spec 现行登记（归后续卡、现状只读）及 TeamStagedEditor 实况矛盾**
- **维度**：gap
- **位置**：`packages/shared/src/drora-protocol-v4/team.ts:232`
- **问题**：staged 草案任务行注释称「编辑器可改负责人/依赖」，而 spec:521-522（2026-10-23 收窄）明确「负责人/依赖可改」归后续卡、实现与 wire 现状均为只读；TeamStagedEditor.tsx:479-485 两字段均为只读 span 渲染、无编辑控件（唯一编辑入口为成员改名）。旧措辞残留会误导后续卡动工或上游同步时的现状判断。
- **建议方向**：注释改为与 §10:521-522 同口径（呈现行只读、可改归后续卡）。
- **证据**：team.ts:232 与 spec:521-522 原文实读；TeamStagedEditor.tsx 只读渲染实读，`grep -n assignee\|dependsOn` 无编辑控件。

**L-3｜§10 承诺的「lead 会话正文紧凑摘要行 + idle 折叠」无实现；改期登记指向的承接批次已收口但未交付该面；footerSlot 摘要卡实际取代未回写**
- **维度**：gap
- **位置**：`specs/agents-team.md:519-520`（§10 摘要行段）
- **问题**：「全 idle 30s 折叠、>3 idle 折叠为 N idle agents」的呈现方案零实现（grep 零命中，i18n 仅有状态词）；改期登记（:878-881）指向的承接批次 PR-2.5b 已收口（缺口11 staged E2E，:1282-1301）但未交付该面；对话优先增量实际以 footerSlot 摘要卡取代该方案（§18:1919-1920 登记），取代关系未回写 §10——:519-520 成为无主承诺。
- **建议方向**：在 §10 或实现登记补一笔取代关系（或明确仍欠），订正 :878-881 的承接指向。
- **证据**：`grep -rn "30.*idle\|idle.*30\|N idle\|idle agents" packages/ui/src/team packages/ui/src/i18n` exit=1；en-US.ts:1547/zh-CN.ts:1415 仅有 team.status.idle；:878-881 与 :1282-1301 实读；footerSlot 摘要卡 §18 登记实读。

**L-4｜§8.6 承诺「team 实体绑定 workspaceIdentity」零落地、零分歧登记（实体实际绑定键为 leadSessionId）**
- **维度**：gap
- **位置**：`specs/agents-team.md:448-449`（§8.6 身份隔离）
- **问题**：spec 承诺 team 实体绑定 `workspaceIdentity?.trim() || workspacePath` 且远程链路贯穿传递，但 team 生产代码（core/src/team、drora-team、team.port.ts）grep workspaceIdentity 零命中；hub 登记键为 lead.sessionId，与 spec:129「team 绑定 lead 会话（session-scoped）」一致，ui-team CONTRACT.md:3-4 则按 workspace 身份隔离本地定位请求——三处口径未对齐裁决。
- **建议方向**：在 §8.6 补裁决记录：team 实体的身份隔离经 lead 会话归属传导（session-scoped 蕴含 workspace 归属），显式 workspaceIdentity 键不进 team 实体；或补齐该键。
- **证据**：`grep -rn workspaceIdentity <team 三处>` exit=1；spec:448-449/:129 与 CONTRACT.md:3-4 原文实读；install.ts:85 实读。

**L-5｜产物区 `.drora/team-artifacts/{teamId}/` 落盘承诺零实现，「产出默认落盘」的 team 侧目录无写入路径，spec 无登记**
- **维度**：gap
- **位置**：`specs/agents-team.md:195-196`（§2.3 交接纪律）；`apps/drora-cli/packages/contracts/src/interfaces/team.port.ts:49`
- **问题**：`TEAM_ARTIFACTS_DIR` 常量生产零消费（grep 排 test/dist 仅定义处与 shared 注释两处）；投影注释自认「hub v1 未落，缺席即无产物区」（`projection.ts:79`）；board 的 artifactRefs 仅承载 patch 追加引用回传；spec §12 开放问题④还在讨论一个不存在区域的清理策略。
- **建议方向**：spec 补登记产物区 v1 不落盘（artifactRefs 仅承载成员侧既有落盘产物引用）或排期落盘实现；订正 §12 开放问题④的预设。
- **证据**：`grep -rn TEAM_ARTIFACTS_DIR packages apps`（排 test/dist）仅 2 处；projection.ts:79、board.ts:346-348、team-tools.ts:305 实读；spec:195-196/:691-692 原文实读。

**L-6｜M4 验收清单中的「具名工具策略评估」既无评估结论登记也无 defer 登记——M4 实现登记六条唯独漏此项**
- **维度**：gap
- **位置**：`specs/agents-team.md:655`（§12 M4 范围）对照 `:921-937`（M4 实现登记）
- **问题**：M4 实现登记六条只覆盖静默通道/冷恢复/membersMax/空闲回收/hooks/token 预算，唯独漏具名工具策略；§8.8:468 的「v1 可先不做」是设计条目预设（登记时写就），非 M4 评估动作的结论留档；全文 grep 无评估结果。
- **建议方向**：在 M4 实现登记补一条与 hooks 第 5 条同格式的评估结论（即使结论是「继续不做」，也应留档评估依据），对齐 AGENTS.md「分歧与取舍须在 specs/ 登记」纪律。
- **证据**：spec:655/:464-469/:921-937/:719 实读；`grep -n 具名 specs/agents-team.md` 仅三处、无评估留档。

**L-7｜i18n 双向守卫的扫描清单与真实消费面漂移（守卫当前绿，但存在漏网形态）**
- **维度**：norm
- **位置**：`packages/ui/src/team/i18n.test.ts:153`
- **问题**：① teamSourceFiles()（:153-161）只平铺扫 team 目录 + 目录外挂载点仅 TeamSidePane.tsx，而 `v4/ConversationStatusPanel.tsx:1395` 也消费 `team.ui.title` 且不在清单内——若 team 目录内消费全删而 ConversationStatusPanel 仍用，正向守不查它（漏裸键）、反向守判它死键（误删）；② readdirSync 非递归，将来出现子目录即静默漏扫；③ :173 正则只认双引号字面量（该形态当前无实例，仅边界说明）。
- **建议方向**：目录外清单扩为与真实挂载面一致（至少补 ConversationStatusPanel.tsx；更稳做法是 grep 全 packages/ui/src 提取目录外消费点），readdirSync 改递归。
- **证据**：grep 证实目录外 team.* 消费源码仅 ConversationStatusPanel.tsx 与 TeamSidePane.tsx 两文件；team 目录内 team.ui.title 恰 3 处（TeamWorkspaceViews.tsx:53、TeamPanel.tsx:201、TeamConversationSummary.tsx:83）；实跑 `cd packages/ui && npx vitest run src/team/i18n.test.ts src/team/TeamStagedEditor.test.tsx src/team/TeamStagedFailureWiring.test.tsx src/team/commands.test.ts` → 4 文件 52 用例全绿（守卫当前绿，本条为结构风险）。

**L-8｜同一文件内同类事件日志级别错位：sendTeamCommand 传输异常 error vs queryTeamHistory 传输异常 warn**
- **维度**：norm
- **位置**：`packages/ui/src/team/commands.ts:214`（对照 `:82`）
- **问题**：两处 catch 捕获同一类异常（sendCommand 传输异常族）却一 error 一 warn，无从按级过滤，违反 AGENTS.md:96 分级口径的执行一致性。5982f5b5 补 catch 半边时沿用各自原有级别（diff 证实 logger 行为未改动的上下文行）。spec 登记的是函数内分支区分现状，未登记跨函数错位，亦未声明为有意取舍。
- **建议方向**：按分级口径统一（可重试降 warn 或按不可恢复升 error，取其一），两处注释互指。
- **证据**：commands.ts:82/:214 实读；两处 catch 体结构同构（均补 recordV4CommandAck status="transport-error"）；`git show 5982f5b5 -- packages/ui/src/team/commands.ts` diff 实读。

**L-9｜transport-error 观测环 reasonCode 口径不一致：SessionPane 记 String(error)，team 两处 catch 只记 status 不带 reasonCode**
- **维度**：regression
- **位置**：`packages/ui/src/team/commands.ts:93`（关联 `:220-225`、`SessionPane.tsx:2215-2221`）
- **问题**：probe 环形缓冲时 team 命令的传输失败原因（断线/能力缺席/握手失败）不可见；queryTeamHistory 同函数内成功路径带 reasonCode（:200 条件展开）、catch 半边不带，口径不齐。属观测面打磨项，不涉契约键收口。
- **建议方向**：team/commands.ts 两处 catch 补 `reasonCode: String(error)` 与 SessionPane 同口径（UI 本地观测面字段，两处注释互指已存在）。
- **证据**：SessionPane.tsx:2215-2221 与 commands.ts:93-97/:200-201/:220-225 实读；V4CommandAckSummary.reasonCode 为可选字段（commandAckObservability.ts:11-16）；spec 各 reasonCode 登记处均为其他语义，无本条登记。

**L-10｜TeamStageInput.skipApproval 是死参数 + 死契约：三元两分支同值，port 注释与 spec 产品规则承诺的「直通」不存在**
- **维度**：wire
- **位置**：`apps/drora-cli/packages/core/src/team/hub.ts:406`
- **问题**：`status: input.skipApproval === true ? "staged" : "staged"` 两分支字面相同，「直通」分支不存在；而 port 注释（team.port.ts:203-204「仅用户明确要求跳过审批时直通」）与 spec 产品规则（:136）都承诺该例外——契约面虚假承诺、实现面永不直通、spec 无「v1 不实现直通」登记，三方静默漂移。生产不可达（TeamSpawn 工具 schema 不暴露该键，:1208 登记）故 low。
- **建议方向**：二选一收口：spec §1/port 注释明确「v1 不实现直通、参数保留待后续卡」，或登记直通实现契约后补分支；不留两分支同值的三元表达式冒充实现。
- **证据**：hub.ts:406 实读；`grep -rn skipApproval`（排 dist/test）仅 hub.ts:406 与 port 声明两处；team-tools.ts grep 零命中；handlers/team.ts 重建草案处均不传该键。

**L-11｜resume 空理由防御分支复用 team_lead_only 文案，对「调用方就是 lead、因 reason 空白被拒」的场景是错误教学**
- **维度**：wire
- **位置**：`apps/drora-cli/packages/core/src/team/hub.ts:610-613`
- **问题**：错误文案「This action is reserved for the team lead.」（errors.ts:78-82）与实际拒绝原因（reason 空白）语义无关，违反「错误分类即协议」的教学文案纪律（§16.1）。生产不可达（wire schema `reason: z.string().min(1)` 网关先拒，shared team.ts:317-320；handlers/team.ts:168 注释自认纵深防御）故 low；但直调 hub 的测试/工具路径可触达。spec 对该分支文案零登记。同文件 errors.ts:45-49/:66-71 展示了正确的教学文案做法。
- **建议方向**：为空白理由改用可行动文案（如并入 team_halted hint 的「explicit resume with a reason」语义族），不新增码；若新增专属码须先在 spec 登记。
- **证据**：hub.ts:610-613、errors.ts:78-82/:45-49/:66-71、shared team.ts:317-320、handlers/team.ts:168 实读。

---

## 3. 登记订正（registeredDup=true，1 条）

行为缺口本身已在此前登记射程内、但登记清单与实况不符的发现，集中在本节，不与新发现混排。

**R-1｜44px 触达补齐处置不完全：成员行「给成员发消息」图标按钮漏网，§19 契约 6 E 节登记的补齐清单（四处）失准**
- **维度**：norm（registeredDup=true，severity medium）
- **位置**：`packages/ui/src/team/TeamPanel.tsx:392`
- **问题**：该按钮（data-testid=team-member-message）为 size-7（28px）且无 pointer-coarse 补偿，不在 specs/agents-team.md:2344-2346（§19 契约 6 E 节）登记的补齐四处（HaltTeamButton/ResumeTeamSection/下钻 composer/TeamSessionLine 主行）内；对照同功能 `TeamMemberSidePane.tsx:193` 发送按钮已带 `pointer-coarse:min-h-11 pointer-coarse:min-w-11`，同功能两处不一致。违反 DESIGN.md:660-662 触达纪律。python 扫描 team 目录 14 个 tsx 复现唯一小图标漏网即此一处。spec E 节以「全局一致性破口」收口宣称登记，同文件同面板漏一处属登记清单失准的核对，非新立缺口——故归登记订正。
- **建议方向**：给该按钮补 `pointer-coarse:min-h-11 pointer-coarse:min-w-11`（照 TeamMemberSidePane.tsx:193 写法），并把 §19 E 节补齐清单从「四处」订正为含此按钮，使登记与实况一致。
- **证据**：TeamPanel.tsx:392-403 实读（`flex size-7 shrink-0`，无 pointer-coarse）；TeamMemberSidePane.tsx:190-196 实读；spec:2344-2346 E 节原文实读；DESIGN.md:661-662 原文实读；自写 python 正则扫描（<button 后 1200 字符内提取 className，过滤含 pointer-coarse/size-11 者）复现 5 行命中，逐一读上下文确认仅 :392 为小图标按钮且无补偿。

---

## 4. 跨维度合并说明

**合并 A（→ M-5）**：norm 维度「lead 字面量绕过 TEAM_LEAD_ASSIGNEE」（medium）、norm 维度「membersMax 缺省 5 手写两处」（low）、wire 维度「maxTurns 40 四处独立字面量、两个单一出处常量零消费」（medium）合并为一条。合并依据：三者机制完全同构——单一出处常量已在 shared/contracts 契约常量区定义（含注释声明），生产代码不引用而手写字面量，值靠人肉同步；且 lead 条（norm）与 maxTurns 条（wire）分属两个维度，构成跨维度同根因。合并条 severity 取原最高（medium）。修复宜一并收口（同一模式：改引常量 + 订正误导性契约注释 + spec 补单一出处声明）。

未合并的相近条目及理由：M-9（送达翻转 spec 零登记）与 M-3（refreshKey 信号漏 delivered 边缘）主题相关但根因不同——前者是 spec 回写缺失，后者是 UI 活性信号拼接与测试缺位，保持分立并互为参照；gap 维度各「承诺悬空」条目（M-10/M-11/L-3/L-4/L-5/L-6）各自对应不同的 spec 承诺与修复动作，不宜并为一条。

---

## 5. 未确认 / 被推翻

**被推翻项**：四个维度返回的 `rejected` 数组全部为空——本轮四维复核无被推翻的发现。

**复核过程中的内部订正与措辞校准**（原发现个别细节在复核中被修正，修正后结论维持成立；如实列出）：

1. **TeamSessionLine.tsx:46 误判订正**（归属 R-1 的复核过程）：原扫描称其为「无补偿整行」不确——其主行经模板变量（TeamSessionLine.tsx:40-46 的 className 变量）实际携带 `pointer-coarse:min-h-11`，扫描抓到的是外层串；TeamRelationGraph.tsx:102 / TeamCollaborationPanel.tsx:182 抓的是 button 内 span 类，button 本体为整卡/整行大点击区。归类结论（唯一漏网为 TeamPanel.tsx:392）不受影响。
2. **wire 维度 standing 规则措辞校准**（归属 M-4）：所引 specs/agents-team.md:1363-1364/:2061-2062/:2182-2183/:2465-2468 实读为「词表声明」与纪律援引，并无字面 standing 规则「未经登记不得扩词表」——该约束由词表声明 + AGENTS.md spec 先行与契约键单一出处纪律共同确立。handler 层自造码逃逸封闭联合且零登记的违反实质不受影响。
3. **数值/行号微差**（不影响定位）：product-projection.ts 当前总行 6007（原发现记 5998，差 9 行或为工作区时点差；「05625f17 前已超标」定位不变）；smoke 测试断言实为 :154-158（原记 159）；.oxlintrc 降级清单行号实为 :10-38（原记 :29-41，指向的清单确实无 hub.ts）。
4. **未重跑项声明**（归属 M-3）：发现材料中「ui 侧七文件 66 用例全绿」未逐文件重跑；零覆盖为静态可证事实（grep/find 证实），该发现成立不依赖未重跑项。M-9/L-1 的 core tests/team 13 文件 166 用例为维度复核实跑结果，本汇总撰写员未复跑（抽验仅覆盖 H-1 与 M-6 两条，见各条「汇总抽验」标注）。

---

## 6. 覆盖范围

### 6.1 审了什么

- **规范面**：AGENTS.md（98 行全文）、DESIGN.md（694 行全文）、architecture-policy.yaml（1003 行全文）、specs/agents-team.md（2517 行全文逐段）、.oxlintrc.json（127 行全文）、.oxfmtrc.json（46 行全文）——提取 66 条可逐条对照判定的成文规则（规范清单盘点自述；另跑 `grep -i team` 佐证五文件中 team 条目无遗漏）。
- **现状面**：17 个 area 的只读描摹——core 内核、投影/历史读面、contracts 端口、bootstrap 装配、灰度三缝、v4 handlers、product-projection team 半边、shared wire、wire 装配诊断、ui-team 全目录、hooks、v4 挂载点、i18n、desktop E2E 与夹具、CLI 测试面、spec 决策记录；区间 `b7c2e810..5982f5b5` 五笔提交（05625f17 / 00670ca1 / a708bb71 / 48a6b0dd / 5982f5b5）逐笔影响核对。
- **四维复核**：gap（spec 承诺 vs 实现/登记，9 条）、norm（治理与规范符合，8 条）、regression（回归与测试锁定，4 条）、wire（契约与协议纪律，5 条），合计 26 条原始发现，合并后本报告 24 条。

### 6.2 怎么审的（材料中实际执行的验证）

- **静态证据**：逐行实读关键代码与 spec 段落；全量 grep 字面量/常量/消费点扫描（含排除 test/dist 的生产面收敛）。
- **实跑命令**（转录自四维材料）：`cd apps/drora-cli/packages/core && npx vitest run tests/team` → Test Files 13 passed / Tests 166 passed；`cd packages/ui && npx vitest run src/team/i18n.test.ts src/team/TeamStagedEditor.test.tsx src/team/TeamStagedFailureWiring.test.tsx src/team/commands.test.ts` → 4 文件 52 用例 passed；`npx oxlint src/team --no-ignore`（core）→ 3 warnings + 1 error；bootstrap 侧定点 oxlint → 0 warnings + 1 error（product-projection.ts max-lines）；`pnpm architecture:check` → FAILED（violations 1）；`node -e` async 方法 throw 语义实证；`git show`/`git log` 提交归属与行数追溯（05625f17~1 vs 5982f5b5）。
- **本汇总撰写员抽验**：`install.ts:148-192` 实读（H-1 注释/实现矛盾属实）；`npx oxlint src/team --no-ignore` 复跑（M-6 属实）；`ls docs/` 命名习惯确认。除抽验外未重跑各维度命令。

### 6.3 没审什么（未覆盖，如实声明）

- **运行时行为**：除 `node -e` 语义实证与上述定向单测外，未运行完整运行时链路（无 hub 实际启停、无投递边缘的真实时序演练）；H-1/M-1 的生产行为结论建立在代码路径与 port 契约签名推演上，未以运行进程复现。
- **真机 / 模拟器 / 全量 E2E**：staged E2E「3/3 绿」为 a708bb71 的登记证据，本次四维复核未重跑任何 desktop E2E；手机/Web 真机渲染（含 M-8 幽灵 token 的实际视觉结果、M-2 手机面板分区缺席的实际表现）未实机验证。
- **全仓 typecheck / lint**：`pnpm typecheck` 与 `pnpm lint` 全仓未跑（norm 维度仅做 core/bootstrap 侧定点 oxlint）；`pnpm knip`、`pnpm verify:pre-push` 完整链路未跑（M-7 的 arch check 红已单点复现，但 pre-push 其余环节未验证）。
- **文档来源边界**：`docs/agent-team-implementation-2026-10-16/` 三份设计文档与 `CONTEXT.md` 未纳入本次必扫来源（规范清单盘点自述）；`docs/team-ui-deep-review-2026-10-22.md` 仅作为 M-9 的零命中对照被 grep，未全文复读。
- **上游同步面**：`check-bundle-key-parity` 未跑，team 键族与官方上游的差分不在本次范围。
- **性能与资源**：hub.ts 1963 行的运行时性能影响、journal/邮箱的容量增长行为未测。
