# Team UI 深度评审报告（三维复核汇总）

- 日期：2026-10-22
- 范围：agents-team UI（packages/ui/src/team 及其 v4/CLI 接线），以 workflow 同位实现为对照物
- 方法：usability / timeliness / systematicness 三维度独立复核后汇总；所有行号与断言均经本仓检出源码逐行实读、grep 实跑或 vitest 实跑核实
- 严重度计数：**high 3 · medium 5 · low 7**（同根因发现已合并，合并条计 1 条）

---

## 1. 结论摘要

### 整体差距画像

team staged 审批链的「呈现规则层」已对齐 workflow 先例：问句表头、失败出显（三动作）、44px 触达、状态所有者单一（CLI hub 唯一投影、UI 零第二真相）、命令通道单一出处（commands.ts）均逐条核实成立。差距集中在两条系统性缺线：

1. **命令生命周期反馈**：workflow 有 responding 全控件禁用 + 客户端飞行锁（PermissionDialog/V4InteractionDialogs）、Cancel/Resume 拒绝行内出显并随状态清除（WorkflowRunSidePane）；team 的三动作无在途态，五条侧栏命令 fire-and-forget 只进 logger，成员发消息草稿发前即清空。
2. **运行态呈现**：workflow 运行中有轮尾摘要卡、完成卡、状态面板分区、composer 徽标直达四处呈现；team 仅时间线尾部一张 footerSlot 摘要卡 + tab 状态点，用户滚离尾部后团队在跑/完成零感知，终态无完成卡对应物，且 spec 的「正文摘要行」承诺悬空未承接。

治理面上另有三处 spec/测试缺口：§10 与 §15 自相矛盾、dock 迁移后 E2E 滞留 pending 且无 dock 形态场景、i18n 消费键守护覆盖缺口。

### 最要紧的三件事

1. **给 staged 三动作补 in-flight 态并堵 hub 竞态复查**（H1）——唯一直接命中审批主路径的 high：approve 长事务期间 UI 可继续点击、零中间投影帧，abandon 排队后落在已结算态被拒，用户视角「点了放弃、队伍照样启动」。
2. **按 spec §19 契约 5 把五命令接到失败出显，sendTeamMessage 至少「ACK 前不清草稿」**（H2）——halt 团队后发消息被拒但 UI 静默且草稿已丢，是当前最伤信任的一条静默失败链。
3. **补齐 team 运行态最低限呈现 + 对齐 spec 悬空承诺**（H3 + M4）——状态面板 team 分区与轮尾完成行是最低闭环；同时修订 §10:519-520 与 §15 的矛盾措辞、把 §10:515 摘要行承诺与 PR-2.5b 改期登记的承接状态对齐。

---

## 2. 发现清单（severity 降序）

### H1 ｜ staged 三动作零在途反馈 + hub 侧 approve 竞态复查缺失 ｜ high

- **涉及维度**：usability + timeliness（两维度同一根因，合并）
- **位置**：`packages/ui/src/team/TeamStagedEditor.tsx:224-251`（三动作按钮无 disabled/pending）；`packages/ui/src/team/TeamStagedEditorConnected.tsx:28-58`（仅 failure state，三回调发起时只 `setStagedFailure(null)`）；`apps/drora-cli/packages/core/src/team/hub.ts:500-542`（approveStage）
- **问题**：三动作发起后按钮无任何反馈、无在途标记、无禁用，命令长事务期间 UI 停留在 dock 上且可继续点击；spawn 全程零中间投影帧——`confirmMemberSpawned` 只 journal 不 notify（hub.ts:621-637），`refreshStatus` 对 staged 早退零推帧（hub.ts:1740-1750），approve 到 status=active 之间没有一帧中间态。后果链全链实读确认：approve handler 同步 await 全程（handlers/team.ts:84-91），v4-gateway 在 executeCommand 返回后才 settle（v4-gateway.ts:2683、:2702/:2731），inbox settle 才 releaseSession（command-inbox.ts:187-206）——长 spawn 期间同 session 的 abandon 排队；approve 结算翻 active（hub.ts:528 无条件下发，await 后无 status 复查）后 dock 因守卫卸载（SessionPane.tsx:5605-5610），abandon 被 team_lead_only 拒（hub.ts:483-485），失败 setState 落在已卸载组件无 UI 效果——用户视角即「点了放弃、队伍照样启动」。hub 侧的竞态腐蚀点生产路径暂被网关 FIFO 兜住（见 §4 被推翻项），属纵深防御缺失。
- **workflow 对照**：PermissionDialog 确认按钮 `disabled={responding || …}`（PermissionDialog.tsx:1088-1094）、responding 挡选项点击（:633）与设置控件（:878 `settingsDisabled={responding}`）；宿主设 flight guard + `setPermissionResponse({pending:true})`（V4InteractionDialogs.tsx:343-345、:352-355）。
- **建议方向**：Connected 层记 pending action，发起即禁用全部动作按钮并给在途文案（approve 因耗时可加「正在启动成员…」），对齐 responding 语义；消除投影滞后窗口内第二条命令被拒后的误导性失败提示；hub 侧 approveStage 在 await spawn 后复查 record.status 仍为 staged 再提交（纵深防御，唯一生产调用方已被网关串行化，仅测试直调可重入）。
- **证据**：两维度独立实读一致；实测 `npx vitest run --config packages/ui/vitest.config.ts packages/ui/src/team` → 19 个测试文件 121 用例全过；grep disabled/pending/重入 在 TeamStagedEditor.test.tsx 与 TeamStagedFailureWiring.test.tsx 零命中——approve 在途/双击场景确无测试覆盖。spawn 时长「数秒~数十秒」为估计值，未实测（见 §4）。

### H2 ｜ 五条团队命令失败全静默，成员发消息草稿被无条件清空 ｜ high

- **涉及维度**：timeliness + systematicness（同一根因，合并）
- **位置**：`packages/ui/src/app-shell/TeamSidePane.tsx:138-140`（注释自认 fire-and-forget 先例）、:181-186（halt/resume `void` 不消费 outcome）、:211-222（stop/rename 同）、:290-300（sendTeamMessage 同）；`packages/ui/src/team/commands.ts:69-77`（被拒仅 logger.warn）；`packages/ui/src/team/TeamMemberSidePane.tsx:105`（onSendMessage 为 `(message: string) => void`）、:110-115（send() 同步 `setDraft("")`）
- **问题**：八条团队命令中五条（halt/resume/stop/rename/send）被拒或传输失败只进 logger，UI 零提示零等待态。最具体的后果：halt 团队后在成员下钻框发消息，hub 以 `team_halted` 拒绝（hub.ts:1321-1331），但 UI 已在发送前同步清空草稿且无任何提示——用户以为已送达、原文丢失。TeamPanel 的 HaltTeamButton/ResumeTeamSection 无失败位（TeamPanel.tsx:427-487）。
- **workflow 对照**：WorkflowRunSidePane 的 Cancel/Resume 均走 recordAck → rejection state → 行内出显，并随 runStatus 变化自动清除（WorkflowRunSidePane.tsx:180-212、:214-223、:244-260）——「拒绝必出显」的既有标准 team 未对齐。
- **建议方向**：按 spec §19 契约 5（specs/agents-team.md:2179-2229，登记先于实现；:2217 草稿永不丢不变量、:2223-2229 测试要求）施工：TeamMemberSidePane send() 改 async await outcome（ok 才清草稿，否则回填原文 + role=alert）；TeamSidePane 面板四命令补 outcome 消费行内出显（可复用 teamCommandOutcomeToStagedFailure 的 reasonCode 映射模式，在 TeamPanel/下钻头部加 alert）；i18n 补四个拒绝键（zh/en）；补 vitest 与「halt 后发消息」E2E 场景。
- **证据**：两维度独立实读一致；hub 拒绝路径实读（hub.ts:1321-1381：team_halted / message_target_terminal_retired / name_redirect）；resume 被拒门槛 hub.ts:578-586（status 非 halted/escalated 或空理由）。一处证据修正：halt 不存在「第二条被拒」——halt 拒绝门槛只含 staged/archival（hub.ts:549-551），第二条 halt 幂等成功（:552），被拒场景只在 resume。

### H3 ｜ team 运行态在会话流/状态面板/composer 三层全部缺席，spec 摘要行承诺悬空 ｜ high

- **涉及维度**：usability + timeliness + systematicness（三维度同一根因，合并）
- **位置**：`packages/ui/src/v4/SessionPane.tsx:5853-5870`（唯一 footerSlot 摘要卡）；`packages/ui/src/v4/ConversationStatusPanel.tsx`（实跑 grep "team" 零命中）；`packages/ui/src/v4/conversationStatusPanelModel.ts:131、:341-408`（输入类型只有 backgroundWorks/runningSubagents/workflowRuns，无 team 键）；SessionPane.tsx:4846-4888（composer 徽标只认 bash/subagent/workflow）
- **问题**：workflow 运行中有四处呈现（轮尾摘要卡随每轮 ConversationTurnGroup.tsx:1651-1664、完成卡、状态面板 WorkflowRunRow 分区 ConversationStatusPanel.tsx:1209-1229、composer 徽标直达 SessionPane.tsx:4876-4882），team 仅时间线尾部一处摘要卡 + tab 状态点（TeamTabStatusDot，SidePaneTabTrigger.tsx:260）——用户滚离尾部后团队在跑/完成零感知渠道；团队终态无完成卡/通知行对应物；halt 入口仅侧栏（grep haltTeam 生产消费仅 TeamPanel.tsx:229/:260）；成员卡/任务卡无 running 时长（team 目录 grep Elapsed 零匹配）。spec §10:514-516「lead 会话正文只留一行紧凑 team 摘要行（照 workflowRun）」承诺经 PR-2.5b 改期（:876-879）后未在 §18/§19 重申承接（grep「摘要行|PR-2.5b」全 spec 仅六处，§18/§19 均未再提），实现无对应组件（git status 实跑确认 v4 改动仅 SessionPane + 新增 dock 两文件）。
- **修正**（复核纠正原发现的过强措辞）：摘要卡并非纯静态计数——还有 TeamStageRail 三段相位 rail（TeamConversationSummary.tsx:148）与 TeamRecentMessages 末 3 条邮箱记录（:149、:31-88，带投递态/详情入口）；「右侧缺 team 详情面板」的登记项已过时——侧栏 TeamPanel tab 已挂载。
- **workflow 对照**：见问题栏四处；另 Workflows 分区随 0→≥1 自动展开（SessionPane.tsx:4862-4870），WorkflowRunRow 带 now/startedAt 时长与 Stop。
- **建议方向**：最低限两件——①ConversationStatusPanel 增加 team 分区（statusPanelModel 侧消费 snapshot.team 派生在跑成员数/当前任务，行点击复用 TeamNavigation 开侧栏）；②团队终态在发起轮附近出轮尾完成行（TeamStateChanged 投影驱动即可，不必新开 wire 词表）。composer 徽标在有唯一 active 团队时给「团队运行中」直达；成员卡/任务卡补 running 时长（投影已带 createdAt/updatedAt，UI 起时钟即可）。spec 侧：把 §10:515 摘要行承诺与 PR-2.5b 改期登记对齐（要么施工、要么在 §18/§19 重申改期）。
- **证据**：三维度独立实读/实跑一致：`grep -n -i team packages/ui/src/v4/SessionPane.tsx`（team 呈现仅订阅注释 :751-752、staged dock :5602-5617、footerSlot :5853-5870 三处）；`grep -i team ConversationStatusPanel.tsx`、`ConversationTurnGroup.tsx` 均零输出；`grep -i "Elapsed" team 目录` 零匹配。

### M1 ｜ dock 与远端摘要卡无成员改名入口，「呈现规则一体适用」被打破 ｜ medium

- **位置**：`packages/ui/src/team/TeamStagedEditorConnected.tsx:18-60`（props 仅 draft/sessionId/sendCommand，无 onRenameMember）；`packages/ui/src/team/TeamApprovalDock.tsx:48-52` 与 `TeamConversationSummary.tsx:97-103`（均经 Connected 渲染）；`TeamStagedEditor.tsx:285-287`（onRenameMember 缺席即不渲染 DraftMemberRename）
- **问题**：改名入口只在侧栏（全仓 grep onRenameMember 非测试接线唯一为 TeamSidePane.tsx:324 → TeamPanel.tsx:206 → TeamStagedEditor），用户在 dock 审批时成员行只读且无「去侧栏可改名」指引。与 spec specs/agents-team.md:523-525「审批面挂载于会话流卡与侧栏两处，呈现规则一体适用」及 :1158-1160「改名入口放 staged 编辑器成员行」偏差——同一 staged 编辑器在侧栏有改名、在会话流两表面没有。
- **workflow 对照**：WorkflowRunSidePane.tsx:348-350 WorkflowRunPaneSaveSlots 保存槽位 + useWorkflowRunSave.ts:1-9 文件头「完成卡与 run 侧板共用的『保存 / 再次运行』控制器」——同 run 的保存控件跨表面共享同一控制器，team 的改名未做同款跨面共享。
- **建议方向**：onRenameMember 提升为 TeamStagedEditorConnected 的可选 prop 并在 dock/摘要卡接线（复用侧栏同款 handleRenameMember），或至少在 dock 成员行给「改名请在侧栏进行」提示文案。

### M2 ｜ staged dock 无可达性语义（role/aria-live/焦点管理全缺） ｜ medium

- **位置**：`packages/ui/src/team/TeamApprovalDock.tsx:35-56`（外层普通 div，:36，无 role/aria-live/autoFocus，逐行核实）；`SessionPane.tsx:5605-5617`（dock 在 composerNode :5618 之前条件渲染，出现即把 composer 下推）
- **问题**：dock 静默插入 timeline 底部：读屏不可感知，打字中的用户被布局顶动也无解释——「同位同 chrome」（spec §18）只对齐了视觉，没对齐可达性。
- **workflow 对照**：workflow 确认窗有 role=alert 失败播报（PermissionDialog.tsx:1073-1077）与 Shift+Tab 回焦设置控件的焦点路由（:454-462、:749-768），dock 两者皆无。**对照措辞修正**：PermissionDialog 本体非 dialog 语义（全文件 grep role="dialog"/aria-modal/aria-live 零命中）；「主动聚焦」不准确——:755/:767 是键盘导航回焦路由，无开启时落焦（grep autoFocus 仅反馈/选项场景 :606-607/:1010）。可达性差距本身成立。
- **建议方向**：dock 容器加 `role="status"` + `aria-live="polite"` 播报眉题文案（复用 team.stagedDock.title）；失败出显参照 workflow 的 role=alert 先例保证读屏可感知；焦点管理以不打断输入为前提（原建议「把焦点移到 approve 按钮」与 workflow 现状不符，降为可选增强）。

### M3 ｜ 团队历史/过程面板无活性刷新触发器，跑动期间停帧 ｜ medium

- **位置**：`packages/ui/src/hooks/useTeamHistory.ts:36-91`（effect 依赖仅 [source, cursor, refresh]，:70；refresh 只由 latest()/retry() 手动触发，:87-91）；`packages/ui/src/team/TeamProcessPanel.tsx:31-41`（仅手动刷新按钮 onClick={history.latest}）
- **问题**：查询一次后停帧，团队跑动中新 journal 事件（任务领取/邮件/终态）不会自动出现，必须手动点「回最新」——长任务期间打开过程面看到的是打开时刻的一页历史。
- **workflow 对照**：useWorkflowRunJournalSummaries.ts:42-44 专门设计 refreshKey 缝（注释明言「`refreshKey` 是收口之后**主动**重取的唯一缝」），目录页注入 workflowRunDirectoryRefreshKey（WorkflowRunDirectorySidePane.tsx:169-177，:169 注释记载这是实测修过的 bug：「跑完的 run 不会挪到…」；派生在 workflowRunDirectoryModel.ts:99-105）——team 未做同款。
- **建议方向**：给 useTeamHistory 加等效 refreshKey：调用方（TeamProcessPanel 及宿主）持有投影 team 键的单调信号（如 mailboxTail 长度 + 末条 messageId，或 board.tasks updatedAt 最大值），抬升即重查当前页；保留手动「回最新」作兜底。

### M4 ｜ spec §10 与 §15 自相矛盾：正文仍承诺可编辑，§15 裁决「明确不做」 ｜ medium

- **位置**：`specs/agents-team.md:519-520`（「成员行（路由/角色/思考档可改…）、任务 DAG（负责人/依赖可改）」）vs `:1329-1339`（§15「明确不做（归后续卡，本卡不得出现）：……成员路由可调……必须先解决两套词汇的适配」「任务 DAG 时间线……上界冲突」）
- **问题**：:1297-1298「规则正文已先行改写进 §10」属实但 :519-520 可改措辞未收窄；实现停在只读（TeamStagedEditor.tsx:15 头注「v1 **只读展示**」、:280-284 modelSelection 只读 span、:382-412 DraftTaskRows 无编辑入口），wire 恰八命令无草案编辑/路由调整命令（packages/shared/src/drora-protocol-v4/team.ts:288-323）——spec 正文与后登记裁决自相矛盾，后来者按 §10 直接开工会踩 §15 已登记的坑。
- **workflow 对照**：SessionPane.tsx:2982-2989 onAmendWorkflowRunSettings 经 resolveWorkflowResumeHandler 灰度门、WorkflowRunSidePane.tsx:233-243 useWorkflowRunPaneSettings 配置链——workflow 的运行设置编辑有完整灰度门与单一供给点先例。
- **建议方向**：修订 §10:519-520 与 §15 对齐（标注「路由/角色/思考档与负责人/依赖编辑归后续卡，前置条件见 §15」）；后续动工先按 §15 解决 team modelSelection 与 command 面 ModelSelection 两套词汇适配，再决定是否新增 wire 命令。

### M5 ｜ dock 迁移后 E2E 停留内联形态且滞留 manual-review/pending 未转正 ｜ medium

- **位置**：`packages/desktop/test/e2e/conversation-session/manual-review/pending/conversation-session-agents-team-staged-approval.test.ts:153`
- **问题**：staged 审批面已迁 timeline bottom dock（spec §18，用户裁定的交互改动，实现在工作区：git status 确认 TeamApprovalDock.tsx untracked），但桌面 E2E 仍停留内联编辑器形态——实跑 `grep -n -i "dock|team-approval"` 该文件零命中，:153/:166/:213 选择器实读为 team-staged-editor/team-staged-approve/team-staged-command-error（内联/侧栏形态），:90 注释「五件套（team-staged-rename\*）仅在侧栏挂载点渲染」——且用例滞留 manual-review/pending 未转正。AGENTS.md「交互改动需要 E2E 场景」当前仅由 ui 单测（实跑 12 文件 74 测试全过）+ 一句 CDP 手工回归结论兜底。另 spec §18:1901-1902「团队自测回归（CDP）：见本节末尾」实读 §18 末尾（:1904-1916）仅为 DESIGN.md 对齐的设计审查登记、无 CDP 清单——「见本节末尾」指向落空。
- **证据修正**：实跑 `git log --oneline -3 -- <该文件>` 显示最后触碰是 **b7c2e810**（当前 HEAD，内联审批提交）而非原发现所称 ee9c97b0；dock 迁移尚无提交——断言不受影响反而更强：进行中的交互改动，E2E 未被触碰。
- **建议方向**：为 dock 形态补 E2E 场景（守卫五条 + stagedEditorSuppressed 摘要卡退化 + dock 三动作信封），把既有 staged-approval E2E 更新到 dock 挂载点后推动转正出 pending；§18 补可复现 CDP 清单（步骤+断言）并修正 :1901 悬空指向。

### L1 ｜ 44px 触达纪律只覆盖 staged 编辑器，staged 之外四处漏齐 ｜ low

- **位置**：`packages/ui/src/team/TeamPanel.tsx:440-449`（HaltTeamButton 无 pointer-coarse 类）、:464-480（Resume 理由 Input + Button 均无）；`TeamMemberSidePane.tsx:138`（原生 input）、:146（发送 button）均无；`TeamSessionLine.tsx:39-40`（主行基串无；同文件 :99 成员展开钮、:122 成员行**有**——反差逐字核实）
- **问题**：DESIGN.md:661-662「keep touch targets at 44px (size-11/min-h-11)」为全局纪律（specs/agents-team.md:549-551 引用），但 team 域只落在 TeamStagedEditor（:223-252 三动作、:339-375 改名控件全部 pointer-coarse:min-h-11/min-w-11），staged 之外的可交互控件漏齐，破坏一致性。
- **建议方向**：四处补 pointer-coarse:min-h-11（按钮同时 min-w-11），照 TeamStagedEditor 既有写法；可加一条样式守护测试锁 team 目录内可交互控件指针触达。

### L2 ｜ 成员模型/路由在 active 态连可见性都没有 ｜ low

- **位置**：`packages/ui/src/team/TeamStagedEditor.tsx:280-284`（staged 成员行 modelSelection 是纯 span 只读展示）；`packages/ui/src/team/TeamPanel.tsx:402-424`（MemberCardBody 只渲染名称/画像/状态/currentTaskId，:420，不含 modelSelection）
- **问题**：staged 态只读展示、active 态连可见性都没有；调整路由唯一途径是 revise 回对话经模型轮。workflow 的子代理模型在 run 侧板摘要行直接可见（WorkflowRunSidePane.tsx:151-178 subagentModel memo + summaryParts）并可经「配置」弹层修改（:235-243、:373-374）、不经模型轮——可见性差距成立。
- **建议方向**：短期先在 active 态成员卡补路由只读展示（投影已带 modelSelection，纯派生可出）；可调路由按 spec 节奏走后续卡，但「可见性」缺口不必等编辑能力。

### L3 ｜ 任务 DAG 无时间线/图视图（有意分歧）+ relations 12 节点截断缺提示 ｜ low

- **涉及维度**：usability + systematicness（同一根因，合并）
- **位置**：`packages/ui/src/team/TeamPanel.tsx:551`（`const indent = ["", "pl-3", "pl-6", "pl-9"][Math.min(task.dependsDepth, 3)] ?? ""`）；`view-model.ts:103、:106-132`（MAX_DEPENDS_DEPTH=3，dependsDepthOf 带环守卫）；`TeamSelectionDetails.tsx:116-137`（依赖逐条文字按钮）；`packages/ui/src/team/relations.ts:31`（NODE_LIMIT=12）、:99-133（超限仅保留焦点直接上下游再 slice(0,12)，totalNodes=all.size 如实计数但 nodes 被截断）
- **问题**：DAG 呈现只有看板缩进（≤3 级）与详情面依赖文字列表，无时间线/图视图。**定性修正**：这是 spec §15:1337-1339 登记的**有意分歧**（draftTasks 上界 boardTasksMax=100（team.ts:31/:244）对 workflow phases ≤32（create-workflow-display.ts:133、workflow-runs.ts:90）存在上界冲突——后续卡必须先定超界降级策略再动工），非遗漏。补充边界成立：relations dependencies 层 12 节点硬上限，超限任务在图上不可见，totalNodes 有数据仅缺呈现——图呈现可能反而弱于看板。
- **workflow 对照**：timeline-model.ts:205 buildWorkflowTimeline 横向时间线（站/轨/补全灯）；WorkflowRunSidePane.tsx:107-122 successor memo + handleOpenSuccessor「已被 run X 替代」跳后继（:357-359 传入状态头）。行号修正：onResume 实为 :90、onCancel 实为 :91（原发现漂移一格，实质不变）。
- **建议方向**：维持 §15 登记的缓期；后续动工先解决 100 对 32 的上界降级。短期可做两件纯派生小改：给任务卡加等待前置徽标（waitingDependencies 数据已在投影）；给 relations 超限加「还有 n 个任务未入图」显式提示。

### L4 ｜ TeamStateChanged 整键重发，未做节点级差（登记取舍） ｜ low

- **位置**：`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/product-projection.ts:4712-4721`（onTeamStateChanged 整键 JSON.stringify 比对、整键发 patch）、:5958-5998（teamProjectionViewOf 映射全部 members+tasks+mailbox）
- **问题**：每个成员状态边缘都整键重发 roster+board+mailboxTail——N 成员队伍一次轮换最多 N 帧全量（markMemberWorking/handleMemberTerminal→refreshStatus→无条件 notifyChange，hub.ts:640-666、:1756-1758→install.ts:239-243）。workflow 同文件走 reducer 发节点级差并有注释明示理由（:4723-4744，「整键重发是每事件 O(N) 字节、一条 run 全程 O(N²)」）——team 是同一维度上未做的同款工程。缓解事实：mailboxTail 截断 ≤10（team.ts:271、:34）、membersMax=5（install.ts:238）、boardTasksMax=100（team.ts:31）载荷有界，桌面 stdio 无感；手机远控走同一 v4 delta 通道经 relay，每成员边缘 O(N) 字节。
- **建议方向**：当前规模下登记为已知取舍不动；若手机远控实测带宽敏感，再照 workflowRuns 的 reducer 先例改节点级差。

### L5 ｜ TEAM_HISTORY_QUERY 绕开 commands.ts 单一出处，ACK 不进观测环 ｜ low

- **位置**：`packages/ui/src/hooks/useTeamHistory.ts:43-47`（直接 `createCommandEnvelope({type: TEAM_HISTORY_QUERY,…})`）、:48-66（发送链无 recordV4CommandAck，全文件无该 import；:62-66 catch 仅 logger.warn + error 态）
- **问题**：team 域第九条命令不走 commands.ts（八命令构造/发送/ACK 判定/ack 观测的单一出处，commands.ts:11-28 头注、:50-88），其 ACK 不进 commandAckObservability 环形缓冲——commands.ts:59-68 为八命令补观测环的登记理由（AT-01 实证 probe 不到 ACK）同样适用于历史查询。
- **建议方向**：把 TEAM_HISTORY_QUERY 的发送收进 team/commands.ts（或至少在发送处补 recordV4CommandAck 同口径观测），使 team 域全部 wire 命令的 ACK 可在观测环排查。

### L6 ｜ i18n 静态消费键守护覆盖缺口，双侧同删键无报警 ｜ low

- **位置**：`packages/ui/src/team/i18n.test.ts:96`（CONSUMED_KEYS 仅 TEAM_PANEL_KEYS + TEAM_STAGED_EDITOR_KEYS）、:108-110（键集一致断言以 zh 集为基准）
- **问题**：stagedDock（dock 迁移新增：zh-CN.ts:1473-1474 / en-US.ts:1608-1609 双语在词典，TeamApprovalDock.tsx:41/:45 消费）与 memberPane 等消费的 team.\* 键家族不在守护内；双语键集一致测试只能发现单侧缺失，两侧同时删键无任何报警（组件渲染裸键）。
- **建议方向**：把消费键守护从手写迁移清单改为从组件源码提取 formatMessage 字面量键（或至少补齐 stagedDock/memberPane/ui.\* 家族进 CONSUMED_KEYS），并加一条「词典中存在但零消费」的反向守护防键腐化。

### L7 ｜ staged 三动作失败状态机在两处宿主重复，侧栏未收拢 ｜ low

- **位置**：`packages/ui/src/team/TeamStagedEditorConnected.tsx:28-57`（服务 dock+摘要卡）与 `packages/ui/src/app-shell/TeamSidePane.tsx:136-190`（:136 stagedFailure useState、:145-179 三 case 同构清空与回填）
- **问题**：映射函数 teamCommandOutcomeToStagedFailure 单一出处（TeamStagedEditor.tsx:93-100），但「发起即清空/拒绝回填」状态机在两处宿主各写一遍；spec §18 收拢声明（specs/agents-team.md:1898-1899「收拢 TeamStagedEditorConnected（dock 与摘要卡共用，单一实现）」）只圈两表面，侧栏是第三发起面未收拢——与登记一致，属可收拢而未收拢的结构性重复，非断链。
- **workflow 对照**：SessionPane.tsx:2975-2999 Resume/amendSettings/save 三命令收敛单一供给点经 resolveWorkflowResumeHandler、workflowResumeGate.ts:13-24 门控单一出处，叶子不自带状态机。
- **建议方向**：后续把侧栏三动作改走 TeamStagedEditorConnected（或抽 useTeamStagedActions hook 收拢状态机）使三发起面共享同一实现，并在 spec §18 或 §19 登记该项为后续收拢卡。

---

## 3. 未确认 / 被推翻

### 被推翻（1 项，核心断言不成立）

- **[usability] 「spawn 窗口内双击『确认并启动』会二次重入 spawnMembers、整批成员进程重复 launch、roster 绑定被第二批覆盖（install.ts:410 前提被 UI 无禁用直接打破）」不成立。**
  复核证据：approveStage 虽无重入锁（hub.ts:500-542 属实），但生产路径唯一调用方是 handlers/team.ts:84-91（`grep '.approveStage('` 全仓仅此一处非测试调用），命令必经 v4-gateway.ts:2596 `this.inbox.handle`，而 command-inbox.ts:142-144 注释明确「session gate 持有到 settle，同 session 不同 commandId 以 admission 顺序串行」、:205 settle 才 releaseSession——双击的第二条命令在第一条 spawn 完成后才执行，此时 hub.ts:503 的 staged 检查失败、以 team_lead_only 拒绝，不产生第二次 launch；install.ts:410 的「无并发交叠」假设实际被网关 FIFO 维持，未被 UI 打破。仅测试（team-journal.test.ts 等）直调 approveStage 可重入。
  处置：该发现其余主体（无在途反馈、按钮无禁用、workflow responding 对照）全部成立，已修正为 **H1** 保留；hub 侧 in-flight 门从「必须新增」降为「纵深防御建议」。

### 措辞修正（复核中纠正的过强/失准断言，均已吸收进对应发现）

1. **PermissionDialog 非 dialog 语义、无主动落焦**：全文件无 role="dialog"/aria-modal/aria-live（仅 :1074 role="alert"）；「主动聚焦」实为 Shift+Tab 键盘回焦路由（:749-768），无开启时 autofocus——影响 M2 的 workflow 对照措辞，可达性差距本身成立。
2. **halt 无「第二条被拒」场景**：halt 拒绝门槛只含 staged/archival（hub.ts:549-551），第二条 halt 幂等成功（:552），被拒场景只在 resume 及空理由 resume（:578-586）——影响 H2 证据。
3. **「只有一张静态计数摘要」过度概括**：摘要卡还有 TeamStageRail 相位 rail 与 TeamRecentMessages 末 3 条邮箱记录（轻量过程尾巴），修正为「无逐成员执行卡、无干预动作入口」——影响 H3。
4. **「右侧缺 team 详情面板」登记项已过时**：侧栏 TeamPanel tab 已挂载——影响 H3。
5. **E2E 归属修正**：实跑 `git log --oneline -3` 该文件最后触碰是 b7c2e810（当前 HEAD）而非 ee9c97b0；dock 迁移尚无提交、仅在工作区——影响 M5（断言更强而非更弱）。§18:1901「见本节末尾」实读为设计审查登记、无 CDP 清单，指向落空。
6. **未实测项**：approve 长事务时长「数秒~数十秒」为估计值（单次 launch 耗时无证据）；手机远控带宽敏感度未实测；旧 CLI/灰度关闭场景只做代码级核对。
7. **计数与行号偏差**（结论均不受影响）：ui team 单测实跑 19 文件 121 用例（原发现记 22 文件）；dock/摘要卡专项实跑 12 文件 74 测试（原发现记 72）；WorkflowRunDigest onResume 实为 :90/onCancel 实为 :91；team_halted 拒绝实读 hub.ts:1331（spec:2190 写 1322-1323，漂移约 8 行，行为属实）；TeamPanel 缩进实为 :551。

---

## 4. 覆盖范围

### 审了什么

- **team UI 全部表面**：staged 审批 dock（TeamApprovalDock）、staged 编辑器与失败接线（TeamStagedEditor / TeamStagedEditorConnected）、会话流摘要卡（TeamConversationSummary）、侧栏主面板（TeamSidePane / TeamPanel）、成员下钻（TeamMemberSidePane）、三视图工作区（TeamWorkspaceViews / TeamOverview / TeamProcessPanel / TeamCollaborationPanel / TeamRelationGraph / TeamSelectionDetails）、任务列表摘要行（TeamSessionLine / session-line.ts）、tab 状态点（TeamTabStatusDot）、导航（TeamNavigation / contract.ts）、命令通道（commands.ts / revise-prefill.ts / workspace-config-catalog-sync.ts）、i18n 词典（team.\* 87 键）。
- **CLI 侧关键链路**：hub.ts（approveStage / halt / resume / portSend / journal 回调）、install.ts（spawnMembers / onChange→emitTeamStateChanged）、command-inbox.ts（per-session admission gate）、v4-gateway.ts（executeCommand / settleOnce）、product-projection.ts（TeamStateChanged 投影与 teamProjectionViewOf）、handlers/team.ts（生产调用方唯一性）。
- **workflow 对照物**：PermissionDialog、V4InteractionDialogs、WorkflowRunSidePane、WorkflowRunDigest、ConversationWorkflowDigests / ConversationWorkflowCompletion、ConversationStatusPanel、workflow-timeline 族（timeline-model）、useWorkflowRunJournalSummaries / WorkflowRunDirectorySidePane / workflowRunDirectoryModel、useWorkflowRunSave、product-projection 的 workflowRuns reducer 先例。
- **spec 对齐**：specs/agents-team.md §10（:514-516、:519-525、:1158-1160）、§15（:1297-1298、:1329-1339）、§18（:1898-1916）、§19 契约 5（:2179-2229）、后续卡登记（:1825-1829）；DESIGN.md:661-662 触达纪律。
- **实跑验证**：
  - `npx vitest run --config packages/ui/vitest.config.ts packages/ui/src/team` → 19 文件 121 用例全过；
  - dock/摘要卡 + test/ 下 team\* 专项（`cd packages/ui && npx vitest run --config vitest.config.ts src/team test/teamApprovalDock.test.tsx test/teamConversationSummaryStagedApproval.test.tsx`）→ 12 文件 74 测试全过（3 个失败文件均在 .zcode/worktrees/mobile-relay-server/ 旧 worktree 副本，非本仓检出）；
  - grep 实证：SessionPane / ConversationStatusPanel / ConversationTurnGroup 的 team 命中情况、onRenameMember / haltTeam / `.approveStage(` 全仓生产消费点、disabled/pending/重入 在 staged 测试零命中、team 目录 Elapsed 零匹配；
  - git 实证：`git status --short`（工作区 v4 改动仅 SessionPane + 新增 dock 两文件）、`git log --oneline -3` E2E 文件触碰提交。
- **范围核实**：grep packages/web/src、packages/desktop/src 无 team 组件 import——team UI 全部收敛在 packages/ui（web/desktop 经 @drora/ui 复用）；composerTeamMenu / teamPlanDisplayName 名带 team 实为 BigModel 团队套餐（计费），已排除。

### 怎么审的

usability / timeliness / systematicness 三维度独立复核：每条发现先逐行实读源码定位，再对照 workflow 同位实现，再对 spec 条款逐字核对；复核阶段对原发现的可疑断言（双击重入、dialog 语义、halt 二拒、E2E 归属、静态摘要定性）用 grep / git log / vitest 实跑反向证伪——成立项保留（含行号/计数修正），推翻项在 §3 单独标注，不做静默吸收。

### 没审什么（未覆盖）

- **运行时行为**：未启动真实桌面会话跑通「staged 审批 → spawn → active」全流程；零中间投影帧的持续时长、abandon 排队被拒的用户视角后果均为静态链路推演，未实测复现。
- **真机/远控端**：手机远控（RemoteConversationTimeline 内联编辑器、useRemoteTeamHistoryConnection 经手机服务代理）只做代码级核对，未真机验证；投影帧粒度对 relay 带宽的实际影响未测。
- **桌面 E2E**：未运行任何桌面 E2E（含滞留 manual-review/pending 的 staged-approval 用例）；dock 形态在真实 Electron 环境的焦点/布局/composer 下推行为未验证。
- **CLI 全量测试与灰度链路**：灰度开关关闭、旧 CLI 投影缺席等场景只做代码级核对，未实测降级表现；CLI 侧单测未在本轮运行。
- **安全/权限面**：不在本轮三维（可用性/时效/结构）范围内，未审。
