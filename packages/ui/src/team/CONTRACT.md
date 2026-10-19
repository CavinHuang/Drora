# ui-team（Agents Team 面板）

2026-10-19 对话优先：导航增加 TeamUiFocus 与 useTeamFocus，按 workspace 身份、父会话和 teamId
隔离本地定位请求；TeamPanel 接受可选历史 connection 与任务引用回调。默认总览，另有过程/
协作。只读 getTeamHistory 走 hooks 与既有 v4 transport；历史只保留一页，不写回业务状态。

2026-10-19：公开入口新增 TeamNavigationProvider / TeamOpenTarget、TeamConversationSummary、
TeamSessionLine、TeamCollaborationPanel。导航只携带父会话与 workspace 三键，主体只消费投影。
依赖/消息/交接是局部图层；交接没有证据时为空。文案置于 ui/i18n/teamMessages.ts，避免
locale → ui-team index → IntlProvider 形成循环。下钻时保持 TeamPanel 挂载，返回保留本地选择。

托管模块五件套之一（architecture-governance SKILL.md:45）。骨架期（PR-0.2），
实现在 M2（PR-2.4/2.5）与 M3（PR-3.2 手机端）。

## 职责

- TeamPanel / TeamStagedEditor / TeamBoardView / MemberCard / TeamMessageTail /
  TeamArchiveView / TeamMemberSidePane / MobileTeamPanel 的渲染与交互；
- 从 v4 conversationProjectionStore 的 team 投影派生视图模型（唯一数据通道）；
- 用户动作全部转 v4 团队命令（approveTeamPlan / haltTeam / …）。

## 边界（禁止）

- 不建第二份 team 状态真相（投影派生 + store 派生缓存而已）；
- 不直连 services/host 服务；交互走既有命令链路；
- 不 import 还原/上游文件实现；
- 依赖方向：ui-team → ui(store/components)、shared（类型）。

## 公开入口

- `contract.ts`：TeamPanelViewModel / TeamPanelController / TeamUiStatus；
- `revise-prefill.ts`：「回对话修改」会话输入框预填文案构造（`buildTeamReviseComposerPrefill`
  纯函数 + `TEAM_REVISE_PREFILL_PROMPT_KEY`；注入通道 = TeamSidePane 的
  `onPrefillComposer` 回调，实现由挂载点提供）；
- `index.ts`：re-export。

## 契约演进

TeamUiStatus 八值与 shared `teamProjectionStateSchema.status` 保持同源
（M2 PR-2.1 落 schema 后改为从 `@drora/shared` 引用，删除本地副本）。

## 会话行入口

`session-line.ts` 是仅导出 TeamSessionLine 的轻量公开入口；会话列表通过它组合团队摘要，
不加载成员会话与工具渲染器。无 teamActivity 时无需团队或国际化 Provider，保持旧行契约。
