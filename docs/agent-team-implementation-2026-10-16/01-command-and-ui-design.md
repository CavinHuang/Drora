# /team 命令与 Agents Team UI/交互设计

状态：设计定稿（先于实现，应用户「先设计自己的 UI 和交互行为」要求）。
上位文档：`specs/agents-team.md`（产品规则/状态所有者/协议）、
`00-master-design.md`（v2 集成架构）。本文聚焦**入口命令**与**全部用户可见交互**，
是 UI 实现的权威依据；与上位文档冲突时先改上位文档再改本文。
设计约束遵循 `DESIGN.md`（text-ui-\* 刻度强制、语义 token、冷静致密操作型、
键盘一级、i18n zh/en 全量、Side Pane 帧、移动端 R3 shell 规则）。

2026-10-18 三处显示面的视觉细化提案见
[`02-three-surface-ui-design.md`](02-three-surface-ui-design.md)：左侧会话列表、主消息摘要与
右侧任务/成员面板。本提案尚待评审，不代表新增显示面或后续编辑能力已经实现。

## 1. `/team` 命令契约（对齐 `/workflow` 先例）

先例解剖（`bootstrap/src/builtin-workflow-command.ts` 全文实读）：`/workflow` 是
**代码定义的 prompt 型内置命令**——名字进 `BUILTIN_DRORA_SLASH_COMMAND_HELP_ENTRIES`
（`packages/shared/src/drora-slash-command-help.ts`，保留字/TUI 候选/App 目录的唯一
出处）；正文复用 contracts 的 `expandCustomCommandPrompt`（`$ARGUMENTS` 替换 +
`skills:` 前言），指向 bundled skill 并要求调用对应工具；历史教训（2026-09-19 事故
注释）：命令曾属插件，插件停用即与加号菜单入口一起消失——内置命令两个入口都有。

### 1.1 命令定义

| 项               | 值                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 名称             | `team`（保留字，进 shared 帮助表 additive 条目）                                                                                       |
| usage            | `/team [goal]`                                                                                                                         |
| 无参数行为       | 不发模型请求：打开 TeamPanel；无团队时显示空态引导（如何描述目标）                                                                     |
| 带参数行为       | 展开为 prompt：要求模型按 `agents-team` skill 的 staged 流程起草团队（先花名册+任务 DAG，**不 spawn**），调用 TeamSpawn 进入 staged 态 |
| summary（zh/en） | 「组建代理团队协同完成目标」/ "Assemble an agent team for a goal"                                                                      |
| 正文骨架         | 复用 `expandCustomCommandPrompt`；`skills: [agents-team]`；`$ARGUMENTS` 必须在场（否则参数成尾块，先例注释）                           |
| 子上下文守卫     | child runtime（subagent_child 等）禁用 `/team`（照 `create-app.ts:904` 对 workflow 名的同款守卫）                                      |
| 灰度             | team 功能关闭时命令不注册（帮助表条目与命令注册同门：灰度关→斜杠菜单无候选，面板不出现）                                               |

### 1.2 与状态命令的关系（刻意不做子命令）

`/workflow` 有 status/resume/stop 语义；team 的对应操作**全部走面板**（可视化状态
本来就有）与既有 v4 命令（haltTeam/resumeTeam 等，经 γ 接缝注册）。`/team` 无参
= 打开面板即覆盖 status 场景；v1 不解析 `/team status` 之类的子命令——面板是团队
状态的唯一可视面，避免两套状态入口。

### 1.3 实现落点（全部 additive/新文件，计入接缝账 C 档）

| 落点                                                                                  | 形态                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `bootstrap/src/builtin-team-command.ts`                                               | 新文件（照 builtin-workflow-command.ts 体例）                                        |
| `packages/shared/src/drora-slash-command-help.ts`                                     | additive 条目（Drora 自有文件）                                                      |
| `bootstrap/src/builtin-prompt-command.ts`                                             | 分发表加一个分支                                                                     |
| `create-app.ts` 子上下文守卫                                                          | :904 同款条件加一判（可并入 α hunk）                                                 |
| contracts `AGENTS_TEAM_SKILL_NAME` 常量 + bundled skill `skills/agents-team/SKILL.md` | additive + 新文件（skill 正文 = lead 的团队编排指引：staged 流程/扩缩规则/交接纪律） |

## 2. 入口面（三个）

1. **Composer 斜杠菜单**：输入 `/` 出现候选（TUI 与 App 共用帮助表）；
2. **加号菜单**（`+`）:「组建团队」入口（workflow 同款双入口，插件事故教训）；
3. **TeamPanel 自身**：已有团队时面板即继续操作的入口（无团队的
   TeamPanel 显示空态引导 + 最近归档团队列表）。

## 3. 端到端交互流（生命周期 × 用户动作）

### 3.1 创建与 staged 审批

```
用户输入 /team 调研三个竞品的定价页并出对比报告
  → lead 模型（按 agents-team skill）产出 staged 草案：
     会话正文出现【团队计划卡片】（紧凑摘要行：N 成员 / M 任务 / 预估路由，
     照 workflowRun 行的呈现形态——细节不进会话流）
  → staged 审批面（TeamStagedEditor）内联进会话流团队计划卡的 staged 分支，侧栏
    TeamPanel 同样可达——入口始终用户驱动（spec §10 实现登记 2026-10-22 裁定：
    本节原「TeamPanel 自动打开」语义作废），不抢焦点
```

staged 审批态的面板 = **草案编辑器**：

- 成员行：名称/角色提示词/路由（provider/model/思考档，取自 host 模型目录，
  与主输入区同源元数据）/profile 颜色；行内编辑（点选即改，无弹窗链）。
- 任务行：标题/负责人/依赖（下拉选已有任务；依赖以缩进+连线示意 DAG）。
- 三个动作（面板主按钮区与会话计划卡片双入口，动作语义唯一）：
  - **确认并启动**（approveTeamPlan v4 命令）——唯一创建成员的入口；批准前
    零成员零会话（面板在 staged 态不显示任何成员会话）。
  - **回对话修改**——面板标记草案 waiting-feedback，取消规划回合，会话输入框
    预填「要调整什么？」；用户回复后模型必须原子更新同一草案（不另起团队）。
  - **放弃**——二次确认后归档草案（archived 态），并禁止模型自动重建
    （再次创建需用户重新 `/team`）。

呈现规则（2026-10-22 对齐 workflow 确认面板 WorkflowPermissionBlock 的问句表头/
信息层级语汇；权威登记在 specs/agents-team.md §10「staged 审批视图」，本处同步；
会话流卡 staged 分支与侧栏面板两个挂载点一体适用）：

- **问句表头**：编辑器顶部问句行（「启动这支团队？」语义，i18n）+「N 名成员 ·
  N 项任务」计数（原 stagedSummary 文案移作表头计数）；会话流卡头已有团队名与
  状态徽标，表头不重复。表头为 team 自有实现，不 import WorkflowCardChrome /
  WorkflowPermissionBlock——workflow 图标硬编码于
  WorkflowCardChrome.tsx:24/:176，team 决策卡不借 workflow 徽记（对齐问句/层级
  语汇，不是徽记资产）。
- **审批面全量呈现**：编辑器所见即草案全量（wire 刻意只投影
  taskId/title/assignee/dependsOn 等呈现字段），不设「显示完整草案」折叠；
  结构校验（重名/悬空 assignee 拒绝）不得冒充知情批准。
- **信息层级**：成员组/任务组分组呈现；技术值（路由/任务 id/依赖 id）等宽；
  字级只用 text-ui-* 刻度（§4 token 纪律）。
- **三动作失败出显**：approveTeamPlan/reviseTeamPlan/abandonTeamPlan 的
  TeamCommandOutcome 必须有 UI 消费面——编辑器内联失败提示（role=alert，按
  ack.reasonCode 出 i18n 文案，未知 reasonCode 有兜底文案），废除「失败只进
  logger」现状；hub/wire 零结构改动（借形不借管线，命令单一通道不变）。
- **触达**：编辑器内全部可交互控件（三动作按钮、改名铅笔/输入/确认/取消）
  pointer-coarse ≥44px（DESIGN.md:661-662；参照 TeamConversationSummary.tsx:73
  的现有写法）。
- **明确不做面**（归后续卡，登记见 spec §15）：权限作用域四选项（内容审批没有
  「始终允许」）、并发上界控件、lineage/saved 徽标、成员路由可调（与 workflow
  WorkflowRunSettingsModel 刻意不共用 schema，须先解决词汇适配）、任务 DAG
  时间线（draftTasks≤100 对 phases≤32 上界冲突，须先定超界降级）。

### 3.2 active 态

- **状态头**：team 状态机徽标（staged/active/idle/halted/escalated/completed/
  archived，语义色+文字，不以色独行）+ 权限模式徽标（成队定死值，build/edit/…）
  - 成员数与板进度摘要（如 3/5 完成）。
- **任务板三列**：pending / in progress / completed（failed 入 pending 列头部
  error 态卡片）；依赖以缩进表达；任务卡显示负责人头像点、attempt 计数（>1 时
  角标）、artifactRefs 链接。
- **成员卡列表**：头像（profile 颜色点缀，不作大面积色块）、名称/角色/实时状态
  （working/idle/error + 当前任务标签）；**全 idle 30s 后折叠空闲行，>3 个 idle
  折叠为「N 个空闲成员」一行**（可展开）。
- **消息尾窗**：成员间消息摘要（最近 N 条，发件人色点 + 一行摘要；完整消息在
  成员下钻里）。
- **成员下钻**（TeamMemberSidePane）：点击成员卡 → 复用
  WorkflowActorSessionSidePane 的「父投影门 + 只读 SessionPane 租约」模式，看
  成员 transcript；底部输入框可给成员发消息（走 lead 侧团队命令→邮箱投递）。

### 3.3 干预动作（面板主操作区，按状态机出显）

| 状态               | 可用动作                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| active             | 停止团队（halt，二次确认，文案列明影响面：取消 lead 当前回合+中断全员+冻结调度，team 不删除）；给成员发消息；转派/接管（经 lead 工具，面板提供入口预制参数） |
| halted             | 恢复（TeamResume，必须填理由）；查看归档预览                                                                                                                 |
| escalated          | 升级卡片：展示循环上限原因 + 「继续加轮 / 停止」二选                                                                                                         |
| idle               | 收队（completed + 归档）；追加任务（转对话让 lead 拆）                                                                                                       |
| completed/archived | 归档视图：完整花名册/板/邮箱只读；「复制团队配置」（下次 /team 可粘贴复用）                                                                                  |

### 3.4 权限交互

- 成员权限 ask 经既有 pendingInteraction 链路上浮：**按 subagent origin 分组，
  成员徽标点名 `<memberName>`**（照 workflowActorInteractionDescription 先例）；
- 多成员并发 ask：逐条独立 interactionId，**不合并、不代理裁决**；面板状态头
  显示待决计数，点击跳转审批卡；
- 团队消息**永不**出现在审批通道（零授权硬边界在工具执行前门控，UI 不提供任何
  「同意成员转发请求」的控件）。

### 3.5 会话正文集成（刻意克制）

- 会话内只有：staged 计划卡片（一行）、团队生命周期行（启动/停止/归档的紧凑
  system 行）、成员**给 lead 的报告消息**（成员→lead 方向正常入流，带
  `[Source task X, attempt Y]` 溯源头）。
- 其余一切（板更新、成员互发消息、状态迁移）**只进面板**——会话流不被团队噪声
  淹没（对齐「lead 上下文有界」原则在 UI 侧的镜像）。

## 4. 布局与组件（DESIGN.md 合规）

- **位置**：Side Pane 帧的独立 tab（与 WorkflowRun 同级），复用侧栏框架/租约/
  只读守卫；非模态；窄宽度下面板内部滚动（照既有侧栏行为）。
- **组件树**（建议命名，全部新文件于 `packages/ui/src/team/`，托管模块 ui-team）：
  `TeamPanel`（容器+状态路由）→ `TeamStatusHeader` / `TeamStagedEditor` /
  `TeamBoardView` / `MemberCard` / `TeamMessageTail` / `TeamArchiveView`；
  下钻 `TeamMemberSidePane`。
- **token 纪律**：字级只用 `text-ui-*` 刻度；状态色语义化（pending=neutral、
  working=accent、idle=muted、completed=success、failed=error、halted/escalated=
  warning）且**色+文字并行**；成员颜色仅头像点与消息色点；无大面积品牌填充；
  技术值（attempt id/taskId/路由）用等宽。
- **断点**：宽面板三列板；窄（<侧栏阈值）单列堆叠（板变分组列表，语义不变）；
  遵循「断点只改布局不改语义」。
- **键盘**：面板 Tab 序列完整；`Enter` 打开选中任务/成员；三动作按钮均键盘可达；
  全流程可键盘-only 完成（E2E 断言）。
- **i18n**：全部文案走 `packages/ui/src/i18n/locales/*` zh-CN/en-US 双语全量
  （含状态标签/动态摘要/无障碍文案），随主题与语言实时切换。

## 5. 手机远控（web-remote-replayable）

- 复用 R3 shell 原语（StatusCards/TaskShell/InteractionCards）与
  `@drora/ui/remote-timeline` / `remote-frame` 公开入口；不引入桌面私有实现。
- **MobileTeamPanel**：任务板只读（分组列表）+ 成员状态行 + 两个动作（给成员发
  消息 / 停止团队，走既有 v4 命令链路，inputOrigin=mobile 语义不变）；触达
  ≥44px（size-11）；staged 审批在手机 = 只读摘要 + 「批准启动 / 放弃」两动作
  （修改引导回桌面——replayable 面板不做编辑器）。
- 冷快照必须携带 team 字段：手机冷恢复后面板完整（成员/板/权限模式/状态机）；
  replayable 不产生 telemetry/CUA observation 的现状对 team 无例外。
- i18n 走 mobile-web `src/intl`，官方键从 `packages/ui` 词典逐字补、包内键标注。

## 6. 异常与边界交互

| 场景                       | 交互                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 成员失败（模型侧重试耗尽） | 成员卡 error 态 + 失败原因（路由命名错误，可行动文案）；板任务 failed 态；面板提供「转派给其他成员 / lead 接管」入口 |
| 预算/成员数超限            | 状态头下方警示横幅；spawn 拒绝文案明确（哪个上限、当前值）                                                           |
| 名字冲突/重定向            | staged 编辑器与 TeamSpawn 即时校验；移除过的名字重用需显式确认（绑定新 agentId）                                     |
| 投递失败/成员离线          | 消息尾窗显示「待投递」态；不阻塞其他交互                                                                             |
| 团队命令在 child 上下文    | `/team` 不可寻址（斜杠菜单无候选）；面板不存在                                                                       |
| 面板 vs journal 不一致     | 面板如实反映 hub/journal 状态（诚实边界）；头部提供「刷新」重放投影                                                  |

## 7. 交互级验收

1. E2E（desktop-continuous）：`/team` 输入→斜杠菜单候选→staged 卡片→面板编辑
   成员路由与任务依赖→批准启动→active 观察板推进→成员下钻发消息→权限卡成员
   徽标→halt 二次确认→resume 带理由→收队归档——全链路 + 键盘-only 复跑一遍。
2. 会话克制断言：active 期间会话正文仅新增（生命周期行/成员报告），板更新与
   成员互发消息不出现在会话流。
3. 手机 E2E（web-remote-replayable）：冷恢复面板完整；只读板 + 两动作可达；
   staged 批准/放弃可用。
4. i18n 断言：zh/en 切换后面板全量文案切换（无裸键）；主题四态（Light/Dark/
   Zai Light/Zai Dark）对比度检查。
5. 灰度断言：功能关→`/team` 无候选、加号菜单无入口、面板不存在；开→全量可用。
