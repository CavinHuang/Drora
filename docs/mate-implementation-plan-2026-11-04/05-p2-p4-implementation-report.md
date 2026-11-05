# 05 · Mate P2–P4 实施报告（跨阶段终审）

- 日期：2026-11-05 · 工作流 run id：`dwfrun-e8aa12b4-73d3-4a6e-b597-f9dfd4530fb2`
- 范围：feat/mate-p2 → feat/mate-p3 → feat/mate-p4 三阶段堆叠分支（基线 feat/mate-p1，6 commits）
- 分支形态：p1(6) → p2(21) → p3(16) → p4(21)，合计 64 commits；全程未 push
- 分支整合（2026-11-05 用户裁定「不分四支、并一个功能分支」）：四堆叠分支已并为单一功能分支 **feat/drora-mate**（=原 feat/mate-p4 线性历史改名，feat/mate-p1/p2/p3 中间指针删除；零历史改写，修复轮与终审后增量仍在同链上）；本文档中的 p1/p2/p3 保留为阶段批次标识
- 终审时点：feat/mate-p4 @ 4fa3863e5，工作区干净；本文档与状态修正为终审唯一新增改动；终审后增量=i18n 守卫清单补齐 bd23fd421（§6 遗留 15 关闭）+ 上述分支整合
- 关联：00 总计划 §0 阶段地图、`specs/drora-personal-assistant.md`（§14 验收行）、台账 16、两份 CONTRACT.md（services/assistant-tickets 与 ui/src/mate）、coverage matrix 五节（MOUI/MSA/MSP/MRP/MTA）

## 1. P2 交付清单（feat/mate-p2，21 commits）

**host 内核批**：
- §1 Router：`routerDecision.ts` zod 严格校验（dispatch/attach/hold/reject 四臂互斥 + 证据 ≤3 条 ≤80 字）；`routerShell.ts` 无状态壳（mate-session-\<seq\> 轮转 N=10、候选卡 verbatim 截断 1500 + 读指针 + 路由约言；轮转簿记 ROUTER_KV_KEYS 落装配层）；`routerEvaluation.ts` 候选卡循环（router_evaluation 表 v2 迁移；评估失败降级 Tier3 不重试模型）。
- §2 Mode C：attachToSessionId 放行路径（放行事务前 Tier2 派发桥预检，失败零消费可改选）；attach 端口走同一 v4 sendText（busy 排队合法）；Tier2 候选集经 `listSessions` 端口 + `filterAttachCandidates` 硬过滤（审查修复接线）。
- §3 代际：`generationRollover.ts`（带序 commandId=\<ticketId\>-\<seq\> 行内计数 + 锚回写、锚对账 reconcile 优先、「不可用≠失配」不触发换代、换代事务=旧代归档 + 浓缩段重派 + 续用 worktree、session.removed 触发源）。
- §4 写域：`writeDomain.ts` 纯规划（W1 worktree `.drora/mate/<id>` + 分支 `mate/<id>`、W2 空声明整域互斥、W3 附着查冲突）、软预算回 3 + queued FIFO 释放（释放前复检预算与写域冲突、按落库 dispatch_intent v3 重放派发形态）、终态 worktree 清理（分支保留）。
- §5 Mode B：prompt 驱动 /team lead 会话 + teamActivity 第三信号（completed→done、cancelled→failed）。
- §6 assistantActivity：`computeMateActivityByWorkspace` 纯折叠 + desktop host 折叠缓存 → controller 任务行 activity.mate 合成（sessionOverlay 同位、deep-equal 零空帧、CLI 零改动）。
- node.ts 装配七端口桥（dispatch/attach/frame/router/sessionsIndex/probe/gitWorktree）。

**Surface 批**：
- Surface A：MateStatusStrip 状态条（mode/活动·软预算/排队/待决策；打扰配额 P4 前诚实省略）+ MateDecisionCard Router 预填（pending/suggested 四臂/failed 三态，放行携带预填参）+ 工单行 queued 灯档与模式/代际徽标。
- Surface C：MateTicketDetail 下钻二级（返回 + 时间线（代际站 mate-trace token）/汇报/证据（decisionId 关联）/成本四页签）；快照补 decisionId 可选投影。
- /mate：`.drora/commands` markdown 文档片段 + 启用说明。
- session-line 接缝：MateSessionLine 挂 task-row/TaskListItem（activity.mate 透传，架构边双登记）。
- mate scope token 四主题段 + DESIGN.md 登记；i18n 双语 +60 键；master plan §0 与 spec §14 P2 更新为已实施。

**审查修复轮（1 轮，判决 GO-WITH-FIXES ×3 后收敛）**：锚对账「不可用」≠失配（followUp 如实报错）、queued FIFO 按 dispatch_intent 重放、workspace 探测失败三口径收口（放行前预检不消费卡）、Router 端口失败臂、浓缩段原因与增量分列、Tier2 候选集真实接线、W1 用户开关入口（setWorktreeDisabled）、wire schema 迁入受管根（架构门禁）、快照补 decisionId、attach 建议 target 预填双路径补齐（首跑 e2e 捕获）。

**门禁（P2 收尾时点）**：typecheck 绿；lint 0 错（432 警告=基线）；architecture:check 0 违例；mate 7 文件 106 项绿；MSA01–09 chromium 27.3s 0 fail + MOUI01–06 回归 32.4s 0 fail。

## 2. P3 交付清单（feat/mate-p3，16 commits）

**host 批（Source 体系）**：
- shared contracts：ASSISTANT_SOURCE_KINDS / ASSISTANT_CREDENTIAL_KEYS，schema v4（trigger.channel_ref / trigger.remote_session_id / ticket.channel_ref + 直通索引）。
- `sources/` 统一入口 sourceIngest（channelRef 命中活动工单→followUp 直投 Tier1 不过 gate；真实强度规则 mention && allowlist→explicit 进 gate；放行建票回填通道绑定）、注册表（kv 配置惰性启停、终态回复端口差分幂等）、飞书 Source（bots assistantForwarder 回调出口，bots 内部逻辑零改动）、手机 Source（submitSourceEntry channel 可见入口，identity 由 host 决定防伪造、remoteSessionId 贯穿；`phone.enabled` 门收尾覆盖直通臂）、GitHub Source（comments 轮询 ETag 304 + 游标双防重、整词 @点名（Unicode \p{L}\p{N} 词字符）、POST 评论 Co-authored-by 回复）。
- node.ts 可变桥晚绑定 / 凭证 / fetch 注入与 dispose 登记；CONTRACT.md 登记不变量。

**接缝批（桌宠 + UI 呈现）**：
- shared `assistantPet.ts` 有界 MatePetProjection schema + MATE_PET_COMMANDS 四通道字面量；desktop Main 桥 matePetBridge.ts（来源窗口校验 + zod + open-ticket/decide 映射纯核）；菜单「打开大副」、托盘速览（desktopPetMateTrayDom 纯 DOM，textContent 防注入）、badge 待决策数优先/汇报气泡、rendererEvent 导航端口三点共用（宠物本体零改动、pet/tray 不建第二 Host）。
- UI：决策卡/观察行来源徽标（decision.sourceKind 可选投影）、工单详情「直通通道」站（channel_ref 不透明值）、发布方 MatePetSync（登记键差分气泡）、导航端口 useMatePetEvents（decide 与面板放行同参同服务、suggestedTier 预填）、i18n 双语键。

**审查修复轮（1 轮，判决 GO-WITH-FIXES/GO/GO）**：气泡判定单源化（宠物窗本地时间戳→发布方投影帧差分）、source_kind 字面量回填单出处、MatePetSync 挂载门补 hasCompletedFullRestore、跨阶段「随下一棒」悬空指征收口。

**门禁（P3 收尾时点）**：typecheck 绿；lint 0 错（432 警告=基线，新文件零告警）；architecture:check 0 违例；fork-isolated 完整清单 164 项 0 失败；MSP01–06 26.3s 0 fail + P1/P2 资产同轮回归通过。

## 3. P4 交付清单（feat/mate-p4，21 commits，含修复轮）

**host 第一棒**：
- §1 watchdog：`host/cronMateWatchdog.ts`（setInterval 粗 tick，startManualClaimHeartbeat 先例）经 host face（getAssistantTicketsHostFace WeakMap）调服务 `runWatchdogRound`；到轮节流按 kv（`watchdog_interval_ms` 缺省 15min 可调）；判据=running 停滞 >30min / queued >24h / awaiting 滞留接缝；只置 stale 标记（schema v5 stale_ms/stale_kind，watchdog 唯一写者）+ 配额判定通知；永不终止/换代。
- §2 auto 信任门：releaseRate/样本实时 SQL（admission_decision 单一事实源；kv trust_gate_stats 仅审计投影）；阈值 kv 可调（缺省 0.8/15=contracts 单出处）；setMode("auto") 信任门判定；auto 下 explicit 带目标事务内建票直派（新 outcome auto_notice，decided_by 恒 gate 不进放行率）；无目标/探测失败降级 decision_card；inferred 走候选卡循环 onSuggested 钩子（autoDispatch.ts，dispatch/attach 臂 + evidence ≥1 + 模式复核 + 探测通过才自动建票）；模式执行时点复核。
- §4 配额中心：kv `quota:<yyyy-mm-dd>` 日记账；admitDisturbance / getDisturbanceQuota / markDailyDigestDelivered 三方法；decision 类永不抑制仍计数；配额值 AppSettings `droraMateDailyQuota`（protocol.ts + validationAppSettings 挂载，node.ts 注入 settings 端口实时读）。
- Surface B：MateTrustBar「切 auto」唯一入口 → 全局 confirmDialogStore 确认框（名单+预算+不可逆）→ mateStore.setMode。

**host 第二棒（汇报卡完整版）**：
- schema v6（awaiting_since_ms / increments_confirmed_ms）：W1 工单 turn_completed 升级「turn ended + 只读核验」（setAssistantArtifactVerifyPort，gitCommandProvider rev-parse/merge-base 零写引用）；三分支诚实矩阵（通过→done / 无新提交→awaiting_output 滞留喂 watchdog awaiting 判据 >60min / git 失败=不可校验≠失败→滞留待人工；端口缺席→P1 形态降级 done）；人工出口 confirmTicketOutput / confirmTicketIncrements；awaiting_output 占软预算活动位（写域不相交不变式对滞留工单仍成立）。
- 快照补 usageByGeneration（落窗归代 Σ=合计不丢账、usageGenerationsMax 有界）/ briefFull（1500 与候选卡同值口径）/ 增量确认投影；UI 汇报卡 awaiting 滞留面 + 未确认增量常驻横幅 + 详情成本页签按代分解 + 证据页签全量只读。
- 配额中心 UI：MateStatusStrip 配额行、MateDigestCard 摘要卡（watchdogNotices ≤5 + pendingDigest ≤7 日 + 投递回执）、MateConfigSection 每日配额调整（AppSettings 写入、草稿-dirty 纪律）。
- 桌宠气泡闸接线：MatePetSync 弹泡差分先过 admitDisturbance fail-closed（并修复「判定自身推快照触发 effect 重跑吞气泡帧」竞态——e2e 首跑捕获）。

**修复轮（1 轮，判决 GO/GO/GO 收敛后补漏）**：
- watchdog 持续停滞跨轮单通知（同 (ticketId,kind) finding 不再重复过配额闸/入列；修复前 15min/轮 × 配额 5 ≈ 75 分钟耗尽当日预算并挤满通知区）。
- 配额 decision 类生产接线（gate 落 decision_card 同事务计数，recordTrigger/sourceIngest 双路径；used.decision 不再恒 0）。
- 「切 auto」UI 链路验收资产 mate-trust-auto.test.mjs（MTA01–03：入口出现/确认框名单预算不可逆/setMode 成功臂/locked 失败臂——此前该交互链零自动化覆盖）；MOUI06 陈旧文案断言修复（第一棒改文案未回归该资产，非本批引入）。

**门禁（P4 收尾时点）**：typecheck 0 错；lint 0 错（warning 432 与干净基线 stash 对照一致）；architecture:check 0 违例；mate 全回归 16 文件 209 项绿（修复轮后扩至 212 项）；MRP01–07 chromium 27.1s 0 fail（P1–P3 资产同轮回归 0 fail）；MTA01–03 29.2s 0 fail（五资产同轮回归通过）。

## 4. 终审复核（2026-11-05，本次跨阶段审计实跑）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 基线新鲜度 | `node scripts/check-workspace-freshness.mjs` | exit 0（ahead 1106 / behind 0） |
| 类型检查 | `pnpm -C D:/workspace/projects/Drora-mate typecheck` | exit 0 |
| Lint | `pnpm -C D:/workspace/projects/Drora-mate lint` | 432 warnings / 0 errors（=P4 基线） |
| 架构检查 | `pnpm -C D:/workspace/projects/Drora-mate architecture:check --changed` | 0 violations / 0 baseline / 0 new |
| Mate 全回归 | `pnpm exec vitest run --project drora-fork-isolated <14 文件>` + `--project drora <i18n/mateStore>` | **16 文件 212 项全绿**（200+12；较 P4 报告的 209 项多 3 项=修复轮新增单测） |

fmt:check 未跑（P1 实录：全树 CRLF 环境性基线即红；以 lint warning 数对照替代，修复留总闸）。verify:pre-push 按分工未跑（含浏览器五资产实跑已在各批完成）。

**接缝一致性核对（读码实证）**：
- shared 契约单一出处：`contracts/assistant.ts` 单文件承载 v1→v6 全演进（schema 版本注释逐版登记）+ 枚举只加不破（auto_notice、awaiting_output、source kinds、disturbance kinds）+ 有界容量常量；`assistantPet.ts` 投影 schema 经 shared index 导出。
- 快照生产/消费对齐：services `assistantSnapshot.ts` 投影 v2–v6 全部字段（routerState/routerSuggestion/sourceKind/channelRef/decisionId/dispatchMode/generationCount/anchorCommandId/queuedReason/staleSinceMs/awaitingSinceMs/incrementsConfirmedMs/usageByGeneration/briefFull/quota/watchdogNotices/pendingDigest）与 ui-mate 六个消费组件逐一对应，可选字段缺席降级路径齐全。
- 服务接口演进：P2（approveDecision 扩参+queued 返回）/P3（submitSourceEntry）/P4（admitDisturbance/getDisturbanceQuota/markDailyDigestDelivered/confirmTicketOutput/confirmTicketIncrements/setWorktreeDisabled）全部落 `assistantTickets.ts` 同一 channel 接口。
- 装配层：node.ts 十端口（dispatch/attach/frame/router/sessionsIndex/workspaceProbe/gitWorktree/artifactVerify/settings + host face WeakMap）与三阶段桥接齐备；desktop 侧 cronMateWatchdog 调 runWatchdogRound、matePetBridge/托盘 DOM/useMatePetEvents/MatePetSync 各接缝实证在位。
- **TicketService 唯一写入者未被破坏**：mate.sqlite 的 SQL 写入全部收敛于 assistant-tickets 模块（全仓 grep 实证）；node.ts 保留 ROUTER_KV_KEYS 轮转簿记（kv 同库直写）——CONTRACT.md:29-30 已登记为装配层簿记（非事务簿记），属 Router 会话（spec §4 所有者=CLI runtime）的记账，不构成第二业务写者。
- i18n：mateMessages.ts zh/en 各 140 键零差分；组件消费 89 键全部存在于词典（临时审计脚本实证，无裸键风险）；但 i18n.test.ts 守卫清单未随 P2–P4 扩键（见 §6 遗留 14）。
- 模块边界：architecture-policy.yaml 登记 assistant-tickets/ui-mate 两 managed 模块、project-sidebar requires ui-mate、P3 桌宠接缝与 P4 watchdog cron 的 path-exact 豁免；module.ts 双登记一致。
- 测试清单：16 个 mate 测试文件全部登记（14 入 drora-isolated-test-files.json 串行清单、i18n/mateStore 2 文件入 drora-test-files.json）；浏览器验收资产 5 份落 manual-review/pending 候选，coverage matrix 五节（MOUI01–06/MSA01–09/MSP01–06/MRP01–07/MTA01–03）实跑记录齐全，均未 promotion（诚实候选状态）。
- 状态文档一致性：master plan §0 三阶段均已标记已实施且遗留如实；spec 状态行/§14 验收行与实现一致。终审修正三处（见 §7）。

## 5. 已知偏差（deviations 汇总，全部已在 spec/详设/CONTRACT.md 登记）

**P2（30 条，要点归组）**：
- Router：persona preset 注入修订——(a) 路线契约以候选卡首条输入的路由约言承载（host 拼装、CLI 零改动），personaControlV1 迁移后置；虚拟 workspacePath 定案 `~/.drora/workspace/mate-home`（identity=ASSISTANT_IDENTITY 为隔离键）；「上下文超阈值」轮转分支不实现（host 无上下文规模信号，挂 P4 watchdog）；轮转裁剪为仅建新会话（无归档/浓缩交接，每卡自带约言）。
- 代际：kv 计数器改行内记账（commandId 投递序号与锚回写同事务）；awaiting_output 四态恢复顺延 P4（无推进路径的悬挂态不建）。
- 写域：探测降级本地限定（远程目标探测失败→workspace 域「未隔离明示」，不阻断派发；identity→真实路径 resolver 随 P3）。
- Surface：状态条落 Mate 面板顶部而非 SessionPane header 插槽（会话本体经「打开会话」既有通道，零对话流壳侵入）；Y/N/E 键盘流降级按钮流（跨卡全局键盘流后置）；卡内 queued 告知=即时反馈瞬态（持续告知由工单行灯档+时间线承接）；打扰配额不渲染（P4 事实源）。
- 测试：新测试登记 drora 清单后平移 fork-isolated 串行清单（生成器收敛，remoteServiceAccess 手登条目逐批手工保全——相对基线零 diff）；fmt:check 基线即红不列入门禁（oxfmt 单文件验证 + git diff 复核替代）。
- 架构：mate/session-line 照 ui-team 先例轻量公开入口（module.ts + policy 双登记）；wire schema 迁入 shared-contracts 受管根。

**P3（15 条，要点归组）**：
- 手机 Source：详设假想的 attachment 消息事件面实证不存在——手机经 attachment 直调窗口 Host 服务 channel（trusted carrier 注入不可伪造 clientMode）；等价定型=channel 可见 submitSourceEntry（仅 phone，identity=host 本机用户）+ phoneSource.ts 事件面桥。
- 飞书回复：replyToBotChannel 要求恰好一个 bots 任务绑定，Mate 工单不满足——回复以 AssistantSourceReplyPort 定型（注册表终态通知器），真实接线随凭据/真机批，缺席诚实 warn。
- GitHub：/issues 增量窗与 CI 结论裁剪（详设未定义触发规则；CI 结论消费方=P4 watchdog——不实现无消费方的轮询面）；词字符用 Unicode \p{L}\p{N}（\w 不含 CJK，@大副 会误命中——单测先行发现）。
- schema v4 范围微扩（trigger.channel_ref/remote_session_id 直通与远程贯穿落库，只加不破）。
- 桌宠：badge 语义合并（待决策>0 优先，=0 回落既有活动数，不回退宠物既有功能）；气泡判定单源化（投影帧差分，宠物窗只做展示）；配额闸不建（P3 不建第二计数器，P4 兑现）；CLI /mate 导航直达后置（host→Main 导航回调通道 03 未定义，不擅自发明）。
- 跨卡 Y/N/E 全局键盘流：03 未定义 side pane 焦点管理与多卡竞争裁决——不擅自发明，登记遗留。

**P4（21 条，要点归组）**：
- AppSettings 属性载体 camelCase `droraMateDailyQuota`（照 personaEnabled 先例；`drora.mate.*` 命名空间归属在 spec §1 注记）。
- 统计口径：setMode 判定读 admission_decision 实时 SQL（kv trust_gate_stats 仅 watchdog 同轮审计投影）——避免缓存陈时与第二判定路径。
- 三分支诚实矩阵：端口缺席=无核验面→P1 形态 done（同探测端口缺席先例）；git 失败=不可校验≠核验失败→滞留待人工；核验失败→滞留（锚对账 unavailable≠失配同款语义）。
- awaiting_output 占软预算活动位（worktree 未清理、终态统一释放；写域不相交不变式对滞留工单仍成立）。
- 按代成本：usage_log 无 generation 列→快照投影时落窗归代（归档窗口 [fromMs,toMs] + 当代 [boundAtMs,∞)，早于首窗归第 1 代；Σ=合计不丢账；条数有界超界最旧合并）。
- watchdog 判据第 2 行激活时点：第一棒留 awaitingCandidates 接缝，第二棒工件核验交付后喂入激活。
- 行数纪律拆分（行为等价、全量回归背书）：assistantTicketsService 拆 autoDispatch/quotaCenterService/mandateActions/triggerRecord；dispatchEngine 拆 queuedRelease；fixture 拆 mate-browser.fixture-service。
- 气泡闸竞态修复：admitDisturbance 判定自身推快照→effect 重跑误取消在途气泡帧——在途判定登记键期间跳过无弹泡帧发布，落定后发带裁决帧（MSP04/MRP06 实测）。
- 三类事件生产接线收窄（修复轮）：「三端同源」=统一经 admitDisturbance 进出（不建第二计数器），不假设三类各有常驻生产方——decision=gate 落卡计数、report=watchdog 通知、工单终态汇报推送的 report 生产随主动推送通道批补齐（桌面「汇报到达」打扰语义暂由气泡闸承接）；auto_notice 不计数（有意边界）。
- watchdog 停滞回合单通知（修复轮，反例与语义见 04 §1 修复轮落地注记）。

## 6. 遗留（终审汇总；实现层问题按铁律不改动，仅登记）

**随总闸联调验收（真机/真实链路）**：
1. 真实 Host 端到端：工件核验 git 真链路（rev-parse/merge-base 对真实 worktree）。
   另并入 P2 Surface 批同名遗留（源自 spec §14 P2 行，此前仅登记于 coverage matrix
   Mate P2 节）：候选卡→建议→人放行、换代重派、双链路随总闸联调验收——浏览器候选
   MSA01–09/MSA10 仅验 Surface 呈现与预填放行传参（fixture 边界），真实 Host 链路未跑。
2. watchdog 定时轮 30min 判据真机（人为停滞真实会话进程→stale+通知，工单未被杀/未换代）。
3. 配额跨端（桌面/手机/桌宠）一致性与手机快照透传。
4. 桌宠真机点击链路（Electron 宠物窗 badge/tray 坐标交互——桥路由与速览 DOM 已由单测覆盖）。
5. 手机 attachment 真机链路（submitSourceEntry 通道口已备，真机触发→建卡→放行全链未在真机走通）。

**外部 Source 真实连通**：
6. 飞书/GitHub 真实凭据连通（真机冒烟）；飞书回复端口（AssistantSourceReplyPort）真机接线。
7. GitHub /issues 增量窗与 CI 结论轮询面（详设裁剪注记：真机验收批按需回补）。

**后续批次（排期未定）**：
8. 手机端 UI 触发入口接线（channel 口已备、无 UI 触达面）与手机端 UI 形态（单列+drawer+「回放·未建 runtime」徽标）。
9. Source 开关/身份映射配置写入口（生产无写方，kv 手改；kv 空=三 Source 恒关为诚实缺省）。
10. 跨卡 Y/N/E 全局键盘流（需先定义 side pane 焦点管理与多卡竞争裁决的产品规则——03 未定义，不擅自发明）。
11. CLI /mate 命令触发即开面板（依赖 host 进程→Main 导航回调通道，03 未定义；rendererEvent 导航端口已交付可复用）。
12. 工单终态汇报推送的 report 计数生产接线（随手机推送/主动推送通道批；替换条件=存在主动推送通道）。
13. Router 会话归档/浓缩交接（待 CLI 会话生命周期处置动作可用时对账补齐）；personaControlV1 控制面迁移。
14. W2 声明域「决策卡可编辑」入口（P2 裁剪；空集=整域自动互斥已生效）。
15. **i18n 键守护清单未随 P2–P4 扩键**（终审发现）：`packages/ui/src/mate/i18n.test.ts:17-95` 的显式消费键清单停驻 P1（76 键），组件实际消费 89 键——41 个 P2/P3/P4 新键（mate.router.*、mate.detail.*、mate.trust.autoSwitch.*、mate.sessionLine.* 等）未被逐键存在断言覆盖（双语对齐断言仍全量有效、词典实际齐全，无裸键风险；守卫测试自述「组件 formatMessage 的每个键」与实际覆盖面不符）。**已关闭（终审后）**：实测差分为 55 键（formatMessage 调用点外的 mate.* 字面量消费也计入），清单补齐+分组注释，commit `bd23fd421`，drora 项目 3/3 绿。

**全链审查批新增遗留（2026-11-05，§9 修复批裁定不入码）**：
16. ~~dispose 链三缺口~~ **已关闭（同日收尾批）**：sessions-index 底层订阅改引用计数（watcher 清零即拆底层+删缓存条目，连接在途先置 disposed 中止）；engine 新增 `disposeWatchers` + 服务 `dispose()`（host 内部方法面）经 `assistantTicketDisposers` WeakMap 挂进 disposeServiceResources（先退订后停源，同步/等待两路径都收口）；watchdog cron face 按集合解绑（`unwireMateWatchdogCron`，仅当 face 仍指向被停集合才置空——换代路径不误伤新 face）。回归=帧接线件 dispose 用例（三域三订阅一次拆清）。
17. 飞书/手机 Source 无重投递幂等键（GitHub 有 ETag+游标双防线）——依赖上游至多一次投递假设，真机联调批验证（若上游有重试语义需补幂等）。
18. ~~两个测试文件超 800 行~~ **已关闭（同日收尾批）**：assistantP2Flows 按「软预算 queued FIFO」describe 拆出 assistantQueuedRelease.test.ts（693+429）；assistantTicketsService 按「帧接线」describe 拆出 assistantFrameLedger.test.ts（582+391）；两新件登记 drora-isolated-test-files.json，全量 19 文件 224 项绿。
19. architecture-policy.yaml 存量条目曾被 adopt 工具整文件格式重排（~300 行无关噪音）——无需回改，上游同步该文件时注意区分。
20. ~~assistant-tickets 的 contract.example.ts 为 TODO 桩~~ **已关闭（同日收尾批）**：补齐 recordTrigger→approveDecision→快照消费完整调用链示例（对照 ui-mate 先例；含 AssistantResult 纪律/「消息不能改变权限」/两事务幂等三点约定注记）。

## 7. 终审状态修正（docs/spec，零实现改动）

1. **master plan §0 P4 条目**补记修复轮（watchdog 停滞回合单通知 + 配额 decision 生产接线 + MTA01–03 验收资产与遗留收窄）——此前 §0 与 spec §14 P4 行不同步。
2. **spec §14 P4 行**：MTA01–03 原列于「遗留（随总闸联调验收）」枚举内却标注「修复轮交付」——移出遗留、改列「修复轮补齐」段，遗留清单收敛为真实未完项。
3. **03 详设**：§7 场景 2 错字「@大辅」→「@大副」；§2 装配行号注记「漂移至 ~3075」按终审实测更新为 3118（P4 装配段后移所致）。

## 8. 终审结论

三阶段（P2/P3/P4）按 00 总计划与各详设交付完整，验收行与状态文档如实标注；跨阶段接缝（契约字段、事件流、i18n、模块边界、TicketService 唯一写入者）经读码实证一致；门禁四项在终审时点全绿，mate 回归 16 文件 212 项全绿。实现层遗留 15 项全部有登记去向，无阻塞合入项。**判定：GO**（浏览器五资产与 fork-isolated 清单仍为 pending 候选未 promotion、fmt:check 与 verify:pre-push 留总闸，属既定分工而非缺口）。

## 9. 全链审查修复批（2026-11-05，三路独立 subagent 审查后）

三路只读审查（设计符合性/项目要求符合性/跨阶段接缝）判决 GO-WITH-FIXES / GO / GO-WITH-FIXES，共 2 P1 + 4 P2 + ~15 P3；本批全量修复 P1/P2 并顺手修 P3 注释/登记类，其余入 §6 遗留。

| # | 级别 | 问题 | 修复 |
| --- | --- | --- | --- |
| 1 | P1 | Source 入口 auto 预检对账参误比 `autoPlan.finalOutcome`（recordTrigger 同位比 `preVerdict.outcome`）——无目标事件静默丢单+虚假 auto_notice | sourceIngest 对账基准改预检 verdict（同 recordTrigger 语义）+ 双路径孤儿 auto_notice 守卫（降级 decision_card 问人）；回归 2 例（无目标/探测失败 Source 路径，此前零覆盖） |
| 2 | P1 | 换代（recycle）在换代事务后读行退订——sessionId 已置 null 恒 no-op，旧会话帧订阅泄漏（旧代事件归账新代+二次换代放大） | 事务前捕获旧 incarnation 退订；换代重派档位自 dispatch_intent 恢复（顺修硬编码 build 降档）；回归=换代用例订阅/退订跟踪断言 |
| 3 | P2 | usage 归账 cacheWriteTokens 读平铺层（wire 嵌套形态恒记 0）且 usage_accum 漏累 cache 两字段 | readUsage 读 source（cumulative）层；ledger 四字段同行累进（Σ分代=合计不丢账口径补全）；回归=嵌套 cumulative 帧直查台账断言 |
| 4 | P2 | 「evidence 引用原文」仅约言（schema 只校验形状），Router 幻觉引文可在 auto 下自动建票 | auto 执行门补结构性包含校验（每条 evidence 须为触发原文子串，失配留卡问人；人工放行不受影响）；spec §6/04 §2 措辞对齐；回归 1 例 |
| 5 | P2 | commitDispatchSuccess 无终态守卫——stop 后在途 ACK 把 failed 复活 running 并重挂订阅（stop 释放的 queued 名额形成超放） | 事务内终态检查，终态放弃回写返回 false、调用方不挂订阅（ledger 同款守卫先例）；回归=stop 竞态用例 |
| 6 | P2 | auto 门 observe→auto 翻转竞态产孤儿 auto_notice（explicit 触发从所有可操作面消失，窗口=单微任务） | 与 #1 同款守卫（triggerRecord+sourceIngest 双路径）；竞态窗口无可注入接缝，由代码审读背书+守卫分支登记 |
| 7 | P3 | 快照 permissionTier 恒投影 build（死值）；任务行 activeCount 不含 awaiting（口径分叉）；直通 SQL 裸字面量；isBudgetActiveStatus 与 queuedRelease 活动集分叉 | permissionTier 自 dispatch_intent 真值投影；activeCount 对齐软预算口径（writeDomain 单一出处 ASSISTANT_BUDGET_ACTIVE_STATUSES，queuedRelease 改引同源）；字面量收编常量；回归 2 例（guarded 真值/口径） |
| 8 | P3 | 注释/登记类：quotaCenter 头注释失真（GitHub 主动 POST 已存在）、incarnation kv 双记账陈旧注释、view-model 头注口径、node.ts 与 generationRollover 两处「随 P3 接线」承诺未兑现、recordTrigger 丢弃 auto 直派失败返回值 | 全部修正（承诺未兑现项改遗留指向+§6 补登记；返回值对齐 sourceIngest 同口径如实上抛） |

**门禁（修复批时点）**：全仓 typecheck exit 0；lint 0 错（warning 432=基线）；architecture:check --changed 0 违例；fork-isolated 完整清单 17 文件 223 项全绿（+10 新回归用例）。fmt:check 不入门禁（全仓 CRLF 环境性基线红，P1 实录在案）；本批触碰文件未做整文件 oxfmt 归一（避免无关格式化漂移，P1/P2 批纪律）。
