# ui-team（Agents Team 面板）

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
