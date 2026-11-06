# 10 · 大副管理动作面与对话管理台（P10a/P10b，2026-11-07 设计 v2）

> **v2 修订（2026-11-07，用户裁定修正）**：v1 把愿景理解为「入口倒转」（用户交流对象从
> agent 改为大副、新任务默认经大副）——**理解错了**。用户原意：**大副是 harness 的
> 管理员/管家**——可以管理 harness 里的任何东西（会话/项目/agent/任务），**只对用户
> 一个委托人负责**；既有直连入口**全部保持**，不是把所有入口改成大副。v2 撤回
> Mate-first 路由（v1 P10b），改为**管理动作面**（经批准的管理动作）；对话面重定位为
> **管理台**（下管理指令与问询的地方，非默认入口）。见 §8 修订记录。
> **v2.1 审查修订（2026-11-07，用户钉死事实复审）**：用户钉死事实=「现有的
> harness 的动作和行为**完全不变**，大副是**增量**的管理管家」。逐件复审 v2 后两处
> 修正——①新增 **harness 零改动铁律**为第一原则并补「mate 无特权路径」条款；②P10c
> 主区一级入口涉及壳层手术，**违反铁律，降级为不做**。见 §0/§3.1/§4/§8。

## 0. 愿景与设计原则（v2 重述）

**定位**：大副=harness 之上的**管理员/管家层**。用户既有的一切直连用法（composer 直发、
开任意会话、/team、工作区切换）原样保留；大副是**增量的管理面**——看见全部（P8 台账已
建成）、管理全部（本批）、只对用户负责。

- **harness 零改动铁律（v2.1 第一原则）**：P10 一切件落在 mate 自有面（新文件/新
  组件/既有服务面的**新调用方**）；既有 harness 路径——命令语义、守卫、协议 wire、
  壳层结构——**零 diff**。调用既有命令（v4 stop）时其全部守卫恒适用，**mate 无特权
  路径、无旁路**；守卫拒绝=管理卡如实失败（不放宽、不重试、不加兜底）。任何一件
  需要「顺手改一下 harness」即设计违规，回炉。
- **单委托人原则**：大副的一切动作只服务本地用户（localIdentity）；Source allowlist
  身份映射即「谁能以我的名义触发」——该语义既有，本批明文升格为原则。
- **接管=经批准的管理动作**（红线修订，替代 v1 的「投影不等于接管」绝对禁令）：大副对
  **非自有** harness 对象（用户会话/闲时任务/他人建的 team）的任何写动作，**每一步都经
  决策卡人工 Y/N**；observe 与 auto **同规**——管理动作永不 auto 放行（auto 只自动建票
  派发，管理≠自动）。
- **自主≠自批不变**：autonomy 循环对管理动作最多 suggest 建卡（建议你停掉 X），永不执行。
- **对话=台账的消息投影 / 双脑禁令**（v1 原文保留）：对话流是 trigger/decision/reply 的
  时间线投影，零新状态所有者；写意图唯一出口=准入门，答案源于账本或标记轮。

## 1. 现状与差距（v2：差的是管理权，不是入口）

| 对象 | 看见（P8 已建） | 管理（现状） | 本批 |
| --- | --- | --- | --- |
| 大副自有工单/会话 | 工单台账 | ✅ 全套（派发/换代/停止 stopMandate/确认） | — |
| 用户手开会话 | 台账 session 行 | ❌ 只读投影+「建议接管」卡（永不操作） | **manage 臂**（§3） |
| off-peak 任务 | 台账 offpeak 行（禁用态） | ❌ 只读 | **cancel 接线** |
| teams | 台账 teamStatus 徽标 | ⚠️ Mode B 可建队（自己的）；他人建的只读 | 一期维持只读（§7） |
| 项目 | 台账分组视图 | 视图即管理入口（点行导航既有） | — |

**harness 侧动作面核实（本批执行面的依据）**：v4 `stop` 命令（停当前回合，
`expectedForegroundExecutionId` 守卫防误杀迟到 Stop，command.ts:162）；
`offPeakTaskService.cancelTask(offPeakTaskId)`（真服务面，offPeakTaskService.ts:332）；
team 工具族（TeamTask*/TeamSendMessage——仅自有 lead 可用）；automations CRUD。

## 2. P10a · 对话管理台（v1 对话面重定位）

设计不变项（v1 §2 原样保留）：对话流=四类消息投影（用户消息=trigger verbatim/决策卡
内嵌/答复气泡/工单摘要行）；composer 发送=recordTrigger(explicit) 进准入门；chat scope
kind（Router 会话聊天轮：互扰标记+不计轮转+无工具+约言禁承诺执行）；readMateThread
分页只读；mode 矩阵（off=对话面只读）。

**重定位后的差异**：
- 对话面的角色=**管理台**：用户在这里下管理指令（「把那个卡住的会话停了」「取消那个
  闲时任务」）与问询（四 scope 直答/chat 轮）——而不是所有工作的默认入口；工作直连
  照旧。
- 决策卡内嵌使管理指令的批准发生在对话现场（Y/N 即答）。
- **不做 Mate-first 路由**（v2 撤回）：草稿态提交恒直连建会话，不拦截、不加开关。

## 3. P10b · 管理动作面（v2 全新，替代 v1 入口倒转）

### 3.1 manage 臂（routerDecisionSchema 第六臂——候选卡评估的自然扩展）

```
manage: {
  targetKind: "session" | "offpeak_task",
  targetRef: string,            // sessionId / offPeakTaskId（只能取自台账可见集）
  action: "stop_turn",          // session: 停当前回合（v4 stop，含 executionId 守卫）
           | "cancel",          // offpeak_task: cancelTask
  reason: string,               // ≤200，必填（卡上呈现）
  evidence: [...]               // 既有 evidence 规则（台账行引用）
}
```

- **判定**：用户管理意图（对话面/面板按钮/Source 文本）→ Router 评估输出 manage 臂；
  `targetRef` 只能取自候选卡输入的**台账可见集**（attach 臂同款反编造纪律：清单外
  sessionId=失配拒绝）。
- **批准与执行**：决策卡（动作/对象/理由/证据）→ 人工 Y → host 执行面：session=
  经该会话的 dispatchCommand `stop`（expectedForegroundExecutionId 取自 sessions-index
  活动执行帧）；offpeak=`offPeakTaskService.cancelTask`。执行结果回写卡
  （executed=ok/failed+原因；失败不重试）。N=忽略。**auto 模式同样必须人工 Y**（§0）。
- **执行失败语义**：目标已终态（会话已停/任务已完）=幂等成功（如实标注「已无需执行」）；
  执行通道失败=failed+原因，可重新触发（新卡新决策，不自动重试）。
- **无特权路径（v2.1 铁律落点）**：mate 执行走与 UI 同一的既有调用面，守卫
  （expectedForegroundExecutionId CAS、cancelTask 的归属校验）**原样适用**；任何
  守卫拒绝都如实落卡（failed+守卫原因），禁止为 mate 放宽守卫或加旁路。

### 3.2 一期动作族（封闭集，逐项登记）

| 对象 | 动作 | 执行面 | 一期纳入 |
| --- | --- | --- | --- |
| 用户会话 | stop_turn（停当前回合） | v4 stop | ✅ |
| off-peak 任务 | cancel | cancelTask | ✅ |
| 用户会话 | delete/rewind/fork | — | ❌（破坏性/凭证语义复杂，二期另议） |
| 他人 team | 停成员/改派 | team 工具族仅自有 lead | ❌（一期只读维持） |
| automations | 启停 | automations 服务 | ❌（P11 随主动推送批评估） |

动作族封闭（schema enum），新增动作=新设计决策+登记，不做通用「任意命令透传」。

### 3.3 台账行管理入口（对话面之外的直达路径）

MateWorkOverview 会话行/闲时行（现只读/禁用）长按或菜单出「经大副停掉/取消」→ 走
**同一 manage 决策卡**（不建第二条执行路径——入口多样、准入门唯一）。闲时行的
「无任务中心导航面」禁用态解除为「可发起管理动作」。

## 4. P10c · 主区一级入口（v2.1 降级：不做）

v1/v2 原案=workspace 栏一级对象（管理台为主区视图）——实现需 WorkbenchPane pane
家族新增非会话视图类型=**壳层结构改动，违反 harness 零改动铁律，降级为不做**。
重启条件（缺一不可）：①壳层未来自身提供**纯注册式**非会话 pane 扩展点（既有面零
diff）；②用户明确裁定启用。大副的一级触达在铁律内已足额：/mate 命令、面板
launcher、桌宠直达三入口。

## 5. 风险与对策（v2 增删）

| 风险 | 对策 |
| --- | --- |
| manage 臂误伤在途工作 | executionId 守卫（v4 stop 既有）+台账可见集封闭+逐卡人工 Y（auto 不放行） |
| 管理动作变成第二个执行引擎 | 执行面**全部是既有 harness 服务**（dispatchCommand/cancelTask），大副零新执行逻辑，只做判定+批准编排 |
| 对话里口头承诺管理动作 | 双脑禁令：聊天轮约言禁承诺执行；manage 只有卡上 Y 才动 |
| 聊天轮/对话流风险（v1 表） | 原样保留（互扰标记/不计轮转/拉取视图/800 截断） |
| 台账行管理入口绕过准入门 | §3.3 钉死：入口多样、准入门唯一（都产 trigger→manage 卡） |

## 6. 分批与工作量（v2 重估）

| 批 | 内容 | 预估 |
| --- | --- | --- |
| P10a-1 服务面 | chat scope kind+router port chat 轮+readMateThread+单测（**已实施 2026-11-07**——落地注记见 spec §2「P10a-1 落地注记」；验收=assistantMateChat/assistantMateThread 两件登记 drora 清单） | 1 天 |
| P10a-2 UI 面 | 对话管理台组件（四类消息+composer）+MSA18（**已实施 2026-11-07**——落地注记见 spec §2「P10a-2 落地注记」；MateThreadSection 新组件+原 MateQueryReply 卡区撤除+兄弟资产 locator 按 mate-inbox-list 收敛） | 1-1.5 天 |
| P10b | manage 臂 schema+执行面接线（stop/cancelTask）+台账行管理入口+决策卡 manage 呈现+单测+MSA19（**已实施 2026-11-07**——落地注记见 spec §2「P10b 落地注记」；验收=assistantManageActions.test.ts 17 项登记 drora 清单+view-model 6 项+MSA19） | 1-1.5 天 |

依赖：P10a-1→P10a-2；P10b 独立可并行（manage 臂不依赖对话面——面板按钮即可触发）。

## 7. 登记与不做

- spec §2 P10 设计注记改 v2+§14 P10 行改 v2；CONTRACT services 增量（manage 臂/执行
  faces）；matrix MSA18/19。
- 不做：**Mate-first 路由（用户裁定否决，撤回）**、delete/rewind/fork 管理动作（二期）、
  他人 team 写动作（一期只读）、automations 管理（P11）、附件触发（二期）、聊天轮工具
  （永不做）、主区入口（P10c 条件触发）、retention（P11 统一）。

## 8. v2 修订记录（用户裁定修正）

| v1 项 | v2 处置 |
| --- | --- |
| 愿景=入口倒转（用户↔大副替代用户↔agent） | **修正**：大副=管理员/管家，可管理 harness 任何对象、只对用户负责；入口不倒转，直连全保留 |
| P10b Mate-first 路由开关 | **撤回**（用户否决：「不是所有入口都是变成大副」） |
| 对话面=默认交流入口 | 重定位为**管理台**（下管理指令/问询处；设计本体不变） |
| 「投影不等于接管」绝对禁令 | 修订为「**接管=经批准的管理动作**」：非自有对象动作逐卡人工 Y，auto 永不放行 |
| （无管理动作面） | **新增** P10b 管理动作面（manage 第六臂+封闭动作族+既有服务执行面） |
| P10c 主区入口 | v2 维持后置 | **v2.1 降级为不做**（壳层手术违反零改动铁律；重启=纯注册式扩展点+用户特批） |
| （无明文约束） | — | **v2.1 新增** harness 零改动铁律+mate 无特权路径条款（§0/§3.1） |
