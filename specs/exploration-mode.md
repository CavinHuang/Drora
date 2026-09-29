# 探索模式（Exploration Mode）

状态：已裁定，实施中（2026-09-28）
裁定人：用户（三项裁定见「决策记录」）

## 1. 目标与问题

长会话进行中，用户常有拿捏不定的判断、边缘问题与支线好奇心。直接在主线提问会污染主线上下文；传统 fork 会「跳走」丢失主线工作区。探索模式提供**并行、可回收的上下文试验场**：

- 从主线任意 assistant 回复创建多个探索分支，分支继承分叉点之前的完整上下文；
- 分支在右侧 Side Pane 以完整可交互会话运行，与主线并行 streaming；
- 探索完成后通过「带回」把分支结论以会话引用注回主线草稿（不自动发送）；
- 主线 agent 收到引用后**渐进读取**分支锚点之后的增量内容，不重复消费 fork 复制的前缀；
- 分支重启后可从主会话头部重新打开。

对标 Proma 探索模式的最终形态（入口 popup、并行 Tab、带回、重开），但分支**只读**（见决策 2）。

## 2. 决策记录

1. **入口语义**：现有 fork 图标改为 popup 二选一——「分叉到新会话」（现状跳走语义，零回归）与「探索分支」（新开右侧 Tab）并存。
2. **文件效应隔离**：探索分支一律**只读执行态**（`ExecutionState.readOnly: true`），避免分支写操作与主线产生文件竞争/不同步。不借用 plan 模式（避免 plan 提示词副作用），不复用 toolDisallowlist（fork 注册路径不持久化、重启丢失）。执行态条目本就随会话持久化并在 resume 恢复，只读保证跨重启成立。
3. **形态**：按 Proma 最终形态实现右侧多 Tab、带回、头部重开；分支是 `taskType: "fork"` 的完整会话（服务端不新增受限 taskType）。

## 3. 语义契约

- **探索分支** = `forkAssistant` 携带 `exploration: { sourceLabel }` 产生的 child 会话，满足：
  - `taskType: "fork"`，`parentId` = 主线会话；
  - sqlite `session.fork_source_message_id` / `fork_source_label` 落库（锚点 = `boundaryMessageId`，与 `ForkChildSessionMetadata.forkOrigin` 同源）；
  - child 执行态 `{ mode: 继承, planEnabled: false, readOnly: true }`，随 execution-state entry 持久化、resume 恢复；
  - `SessionSummary` 增加可选 `forkSourceMessageId` / `forkSourceLabel`，sessions-index live 与冷启动两条构建链都要携带。
- **只读执行态**（新增能力，不只属于探索模式）：
  - 权限服务：readOnly 会话内，readOnly 且非 destructive 的工具放行（与 plan 模式同一放行面）；其余 deny；
  - EnterPlanMode / ExitPlanMode 在 readOnly 会话内一律 deny（planModeTransition 在判定序最前，先于 requiresUserInteraction 的 ask）；
  - `applyRuntimeExecutionState` 不得清除 readOnly（mode/planEnabled 补丁与之正交）；
  - `exitPlanMode` 端口在 readOnly 下抛错拒绝（纵深防御，与端口既有错误风格一致）；
  - **冷恢复保真**：modeOverride 场景跳过持久化 entry 的 mode/plan，但 readOnly 必须从 entry 合入（`applyResumeExecutionState`），否则重启后只读闸门失效。
- **带回** = 分支 Tab 头部按钮 → 主线 composer 插入 `#sess_<childId>` 会话引用（mention chip，草稿态，不自动发送）。主线发送后由既有链路生效：`turn.ts` 注入 reminder（引用不自动展开）→ agent 调 `ReadSessionContext`。
- **边界感知读取** = `ReadSessionContext` 读到 fork child 时自动检测 fork notice（`info.source === "fork"` 且 `info.metadata.forkOrigin`），材料只保留锚点之后的消息，输出报告 `forkBoundary`。不改工具输入 schema。
- **遥测**：沿用既有 `conversation.history.branch` featureId，`action` 维度区分 fork/explore（与 fork 按钮同一埋点面）。

## 4. 状态所有者与事件顺序

```text
【创建】hover assistant 行 fork 图标 → popup 选「探索分支」
  → SessionPane.handleFork(mode="exploration")
  → dispatchCommand("forkAssistant", {target, exploration}, baseRevision, logEpoch)   [CAS]
    → CommandInbox per-session admission
    → fork-edit-retry handler → host.forkStableConversation（透传 exploration）
    → core commitAtomicConversationFork
      → sqlite 单事务：child 行(+fork_source 列) + 消息 remap 副本 + forkOrigin notice + execution-state entry(readOnly)
    → registerForkedSession → child 独立 live runtime
  ← result { type:"forkAssistant", sessionId }
  → onExplorationBranchCreated → useAppPanels.handleOpenExplorationBranch
  → openExplorationBranchPane（Side Pane Tab，按 parentSessionId 收窄可见性）

【消费】分支 Tab = 完整 SessionPane；readOnly 权限闸门在 core 权限服务，UI 无重复判定。

【带回】分支 Tab 头「带回」
  → dispatchConversationSelectionAdd({targetSessionId: 主线, reference: session-mention})
  → 主线 ConversationComposer(listenAddToChatEvents) 插入 #sess_ mention chip（草稿）

【引用消费】主线 sendText → turn.ts reminder → agent ReadSessionContext(child)
  → buildSessionContextMaterial 入口切片（fork notice 检测）→ 有界增量返回

【恢复】重启 → sessions-index 冷启动种子（sqlite fork_source 列）→ 主线头部「探索分支」弹层 → 点击重开 Tab
```

状态所有者：分支 Tab 打开态 = renderer `sidePaneState`（本地 UI 态，不广播）；分支事实（父子关系/锚点/标签/只读态）= CLI sqlite + sessions-index 投影；权限判定 = core 权限服务唯一所有者。

## 5. 边界与不变量

- `workspaceIdentity?.trim() || workspacePath` 照常用于 Tab/会话归属隔离。
- 分支会话进入 sessions-index（`TASK_LIST_SESSION_TYPES` 含 "fork"），V1 不改侧栏成员资格；`web-remote-replayable` 模式下隐藏探索入口与头部弹层（Side Pane 在该模式本就关闭），分支在手机端作为普通会话出现在列表。
- fork 幂等键 `(parentSessionId, sourceCommandId)` 不变；探索元数据进 commandFact.metadata 使重放路径存活。
- 现有「分叉到新会话」路径零行为变化（不传 exploration 即现状）。
- UI 不重复实现权限判定；只读语义由 core 权限服务唯一裁决。

## 5.1 对齐补记（2026-09-28 审查后）

- 命令幂等 fact（`v4_command_fact`）的 metadata 携带 `exploration`，重放路径保留探索 provenance。
- 头部分支弹层按 `forkedFromTaskId === 当前会话 && forkSourceMessageId 存在` 过滤——普通分叉会话不得混入。
- `web-remote-replayable` 下头部弹层与行级入口同一信号（`remoteSessionId` 存在即隐藏）。
- 创建拒绝（`guard.forkTargetAmbiguous`/`guard.forkTargetNotStable`）与成功均需用户可见 toast；带回在分支无新增回复时空态提示，不注入零增量引用。
- `sourceLabel` 持久化稳定标识（`i18n:<key>` 前缀约定），展示层本地化；无前缀旧数据按原文。
- 入口语义已对齐 Proma：fork/探索入口出现在**任意 turn 的轮尾段**（CLI 投影 `row.actions.canFork` 本就是 per-turn 轮尾段裁决，UI 不叠加 latest 短路——单一裁决源）；多段回复的中间段无入口（投影 canFork=false，与服务端段 guard 一致）。划词/历史选择层入口留 V2。
- 带回引用 label 动态化：优先取分支投影当前标题（多分支在主线可区分），标题未生成时退回分叉来源标签。
- **Goal 语义**：探索分支强制 `goalBoundary: none`（不继承 Goal/verifier——只读分支跑不了验证），且不受「parent 有 active target」的 fork guard 阻塞（resolver `goalBoundaryPolicy: "none"`）；none 不写回锚点，普通 fork 的既有 goal 语义（goal-active 时拒绝，属产品既有裁定）不变。
- **只读的 UI 一致性**：`snapshot.config.readOnly` 投影（runtime `isReadOnly()` → config seed → SessionModeChanged 事件），探索分支 composer 的模式切换控件禁用（core 闸门不接受 mode 补丁解除只读，UI 不得显示可切换误导用户）。
- 分支 Tab 无完成徽标（Proma 同样没有，非对齐缺口，留后续体验项）；主会话删除/归档后分支成为独立会话保留（悬挂 parentSessionId，与 Proma 语义一致）；手机端分支会话无只读徽标（只读由 core 服务端裁决，安全无虞，仅展示差异）。

## 5.2 上游安全与模块化扩展声明

本功能遵守 AGENTS.md「上游对齐与模块化扩展」约束，未来从官方 ZCode（zai-org/ZCode 与 3.14.x bundle）同步时：

- **还原区零触碰**（已审计）：改动 57+ 文件无一位于 `.oxlintrc.json ignorePatterns` 登记路径或带「还原自」文件头（packages/ui 下唯一还原文件 `lib/markdown-math.ts` 未触碰）。上游同步的还原目录文件级 diff 不包含本功能任何改动，无需甄别。
- **改动面全部位于自研区**：`apps/drora-cli/**`（.oxlintrc 登记自研）、`packages/ui/src/v4`、`packages/ui/src/app-shell`、`packages/ui/src/lib/workspaceSidePane.ts` 等、`packages/shared/src/drora-protocol-v4`。这些目录不在上游 diff 单位内。
- **wire 变更全部 additive optional**：`forkAssistant.exploration`、`sessionSummary.forkSource*`、`executionState.readOnly`、`SessionModeChangedPayload.readOnly`、`SessionInfo/CreateSessionInput.forkSource*`、`DroraTaskMeta.forkSource*`。payload/summary schema 均为非 strict zod（未知 key 剥离），新旧 CLI/UI 任意组合可互通。
- **降级语义（已知且接受）**：新桌面连接旧远端 CLI 时，旧 CLI 剥掉 `exploration` key → 探索静默降级为普通 fork（child 可写、仍开右侧 Tab）。远端 CLI 与桌面版本配对由部署侧保证（同 specs/server-remote-workspace.md 约定），不在协议层加能力协商。
- **冲突面收敛**：对上游共享文件的改动仅限行级插入（i18n key、test-id、可选字段），无既有行改写；3-way merge 冲突时按「两边各自加行」常规解决即可。

## 6. 验收场景

1. 主线 hover assistant 行 fork 图标 → popup 出现「分叉到新会话 / 探索分支」两项；选分叉走原地切换（现状）；选探索右侧出 Tab、主线不切换。
2. 探索分支内请求写文件 → 权限 deny（`mode.readOnly.nonReadOnly`），无写副作用；读工具正常放行。
3. 分支内模型调用 ExitPlanMode → deny（`mode.readOnly.planTransition`）；分支只读态在重启后依旧生效。
4. 分支有新增回复后点「带回」→ 主线 composer 出现 `#sess_<child>` chip 且不自动发送；发送后 agent 调 ReadSessionContext，返回内容不含锚点前的 fork 前缀，输出带 forkBoundary 元信息。
5. 同一锚点连点探索两次 → 第二次 duplicate，仅一个分支。
6. 重启应用 → 主线头部探索入口列出全部分支并可重开；sessions-index 的 forkSource 字段在 live 与冷启动两条链一致。
7. `web-remote-replayable` 下探索入口与头部弹层隐藏。
8. `pnpm typecheck`、`pnpm lint`、架构检查通过；core 切片/索引等值/执行态只读有单测覆盖。
