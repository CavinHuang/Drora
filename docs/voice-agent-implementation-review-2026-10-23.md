# 语音功能实现审查汇总报告（2026-10-23）

- **审查对象**：worktree `D:/workspace/projects/drora-voice-agent`，分支 `feat/voice-agent-phase1`，tip `09d6246c`（2026-10-23 13:39，「feat(voice): Phase 2——厂商 ASR/TTS 适配器、工具简报、busy 语音指令」）。
- **推送范围声明**：语音工作全部在单分支 `feat/voice-agent-phase1` 上，含 2 个提交：`68871687`（「feat(voice): 语音接入 Phase 1——端上听写+轮尾播报」）与 tip `09d6246c`（提交标题「Phase 2」）。本报告覆盖两提交的合并效果，审查口径为「Phase 1/1b 与 §9.6 批次」。分支名（phase1）、tip 提交标题（Phase 2）与审查口径（Phase 1/1b+§9.6 批次）三者命名不一致，属命名漂移，如实保留、不改动历史提交名；是否单 PR 推送或拆批，在修复完成后的推送决策时一并定，PR 描述须说明三者对应关系。分支当前**无对应远端 ref**（汇总人实跑 `git branch -r | grep phase1` 零命中）。
- **重要上下文**：当前主检出 `D:/workspace/projects/Drora @ ee9c97b0`（`fix/d-g20-1-and-cleanups`）**不含任何语音代码**（汇总人实跑 `ls packages/ui/src/voice` → No such file or directory；`git worktree list` 与 `git log` 确认 voice worktree 与分支 tip）。全部发现、行号与修复动作均针对上述 voice 分支；**后续修复必须在该分支上进行**。
- **输入材料**：四路独立审查（功能完备 / 架构红线 / 代码标准 / 安全隐私）+ 5 条独立复核结论 + 编排审查流程提供的终态门禁结果。
- **发现总量**：22 条立项 = 1 high + 4 medium + 17 low；其中「DEBUG console.error」一条被架构（A3）与代码标准（C5）两维度各自立项，实为同一问题——去重后 **21 个独立问题 = 1 high + 4 medium + 16 low**。5 条进入复核，**全部复核成立，无一条被推翻降级**。
- **spec 引用与编号约定**：正文所有 §x.y 节号与「附录 C/D」均指 `specs/voice-agent-integration.md`（voice worktree @ `09d6246c`）；spec 附录 C 为编号条目列表，一律引用为「附录 C 第 N 条」。**spec §9.6.8 的交付物编号 S1–S7 与本报告的发现编号 F×/A×/C×/S× 是两套体系**：凡指 spec 条目一律写作「§9.6.8 交付物 S×」，与发现 S1–S7（安全隐私维度）无关。FD-x/EG-x/TV-x/OQ-x 为该 spec 的裁决/任务/开放问题编号（见其附录 A 与 §10）。

---

## 1. 裁决与理由

**裁决：NO-GO（不可推送 / 不提 PR）**

**裁决规则（重申，便于复算）**：本报告适用的规则来自编排审查流程输入（规则原文不在本报告内，此处按本报告实际用法重述）：① 存在任一条「复核成立」的 high → 直接 NO-GO；② medium 不单独触发 NO-GO，构成转 GO 前必须整改的清单；③ low 不要求复核、不影响裁决方向。按此可复算：F1 = high 且复核成立，单项即触发 NO-GO；F2/S1/S2/C1 = medium → 整改清单；其余 16 条 low（去重后）不影响方向。

理由（结论先行）：

1. **触发规则**：存在 1 条「复核成立」的 high（功能维度 F1：听写全部 6 种用户提示永久不可见，§9.2 三条验收的用户可见半边落空）→ 按裁决规则直接 NO-GO。
2. **F1（high，复核成立）**：`voiceSessionStore` 全部 4 个 notice 写入点均与「回 idle」同批落库，形成不变量「notice 非 null ⇒ inputLeg=idle」（同批写入；反向不成立——idle 态可以没有 notice）；而唯一渲染入口 `V4ComposerVoiceEntry` 只在 `inputLeg==="recording"` 时挂载 `DictationPreviewOverlay`——notice 落地瞬间渲染门已为假，**零可见帧**。permission / network / device / aborted / requestingMicTimeout / sessionGone 六种提示全部不可见。组件级无任何测试（18 个语音测试文件无一引用该组件），死路未被 217 个语音单测捕获。
3. **F2（medium 记录，复核成立，且比原判更重）**：设置页「在输入框显示麦克风按钮」开关读侧语义反转（显示值 = 可见性取反）；复核**推翻了原发现「写路径正确、双击可恢复」的缓解说法**——写侧把 Radix 受控回调的下一状态再取反写入（`voiceComposerEntryHidden: !checked`，而回调参数 `checked` 本身已是显示值取反），故写盘值恒等于当前显示值，true/false 均为定点；该写点是全分支唯一写者，composer 侧入口隐藏时不渲染、无兜底开启路径 → **听写入口永远无法经设置开启，是死控件**。本轮修订已在源码上逐行复核该推导并附代码原文（见 §4.1 F2 行证据与文末修订记录），审读阶段「实为单击即开启、仅显示反转」的相反读法系对回调参数语义的误读，不成立。按「功能不可用」标准实际已达 high 档（本报告按原判 severity 记录并如实标注复核加重结论；裁决已由 F1 确定为 NO-GO，不受此分档影响）。
4. 另有 3 条复核成立 medium（S1 baseUrl 无 https 强制、S2 云 TTS 数据流披露不实、C1 toolBriefPlanner 合并窗偏差）。其中 **C1 的缺陷身份以 spec §4.2 EG-1 拍板为前提**（该条目自标「建议，待拍板」）：若拍板为「按 spec 收口」则 C1 成立为缺陷；若拍板为「有意分歧」则 C1 退出缺陷清单、转 spec 修订项，复核成立 medium 余 2 条（S1/S2）——因此 C1 不与 F1/S1/S2 并列为同等坚实的裁决支柱。此外 1 条未复核的**跨维度口径冲突项**（S7：partial 预览接线疑似缺失，与功能覆盖矩阵「已实现+有测试」相抵，见 §4.4-S7）需专项甄别；**若甄别成立，S7 将构成第 2 条 high**（§9.2 partial 验收半边落空）。**上述不确定均不改变 NO-GO 方向**：F1（high，复核成立）单项已触发，S1/S2（medium，复核成立）独立支撑整改清单。
5. **终态门禁双绿不构成对冲**：`verify:pre-push` 按仓内合同（AGENTS.md / docs/testing/pre-push-hook.md）只覆盖 Lint、架构检查与受影响单测，**不含桌面 E2E 与组件级渲染断言**——恰好绕过本批两条主要缺陷的捕获面。本批新写的桌面 E2E 从未在任何环境实机运行，且 F2 复核静态推演其两处断言在当前实现下必失败（精确到行：test 2 :86、test 3 :113-118，见 §4.1 F2 行）。

**证据独立性上限（推送决策者须知）**：全部发现均来自四路审查自报实跑 + 5 条只读静态复核 + 本报告修订轮的只读源码核验（见文末修订记录）。F1「零可见帧」、F2 定点、E2E 必败、S7 接线缺失均**未经实机运行证实**（E2E 从未在 Electron 实机运行）；两项终态门禁绿为编排方提供且未附运行 commit。裁决建立在纸面证据链上，此局限如实声明。

## 2. 终态门禁结果

| 门禁 | 结果 | 来源与说明 |
| --- | --- | --- |
| `architecture:check` | **exit=0（绿）** | 编排审查流程提供的终态结果（本汇总未重跑）；架构维度审查另实跑 `architecture:check --changed`（merge-base=ee9c97b0）violations:0 / new:0，两者一致 |
| `verify:pre-push` | **exit=0（绿）** | 编排审查流程提供的终态结果（本汇总未重跑）；主检出不含语音代码，在主 worktree 重跑无意义 |

补充说明：

- 两项门禁结果由编排审查流程提供，汇总人未重跑，如实记录。**两项结果均未随附运行时的 commit、worktree、时间与原始输出**，无法核实是否运行于 tip `09d6246c`——若门禁运行早于 tip 最后一次提交，「终态」不成立。推送决策前（及修复后）必须在目标 tip 上重跑并留存原始输出。
- **门禁绿 ≠ 可推送**：`verify:pre-push` 合同不含桌面 E2E；桌面 E2E（`packages/desktop/test/e2e/voice-composer-entry.test.ts`）已写但从未实机运行（需 Electron 目标运行时），静态推演 test 2（:86 断言取消后 `data-state="unchecked"`，实际显示恒 checked——取消不落盘）与 test 3（:113-118 确认后 `waitForDisplayed` mic 入口，hidden 恒 true 不渲染；其 :106-110 的 `checked` 断言反而会通过——恰是「写值=显示值」定点的体现）在当前实现下必失败。修复后必须实机运行 E2E 作为转 GO 证据。
- 各审查维度自报实跑项（引自审查材料，汇总人未复跑）：功能维度实跑 217 个语音单测、`pnpm typecheck`、`pnpm lint`（voice 路径 0 warning）、contract parity、`dep:refs` 同源全绿；架构维度实跑 `architecture:check --changed` + 3 个定向 vitest 文件（48 测试全绿）+ contracts parity 单测（`packages/shared/src/contracts/contract.test.ts`，13 条 it）13/13；代码标准维度实跑 `pnpm typecheck` exit 0。

## 3. spec 验收场景覆盖矩阵（来自功能完备维度）

共 37 项场景：**23 项已实现+有测试（含 #33「✅⚠️偏差」双标项，其偏差即 C1）、6 项部分实现/待甄别（#5 待甄别关联 S7；#9/#10/#13 关联 F1；#15 关联 F2；#18 为快照 keptOpen + E2E 几何子集缺口，与 F1/F2 无关）、5 项已实现无测试、1 项已实现（diff 核实口径）、2 项 keptOpen（spec 明列延后）**。符号：✅ 已实现+有测试 ｜ ⚠️ 部分实现/待甄别 ｜ ○ 已实现无测试 ｜ ● 已实现（diff 核实口径）｜ ⏸ keptOpen。「有测试」口径：存在至少一组本环境实跑通过的自动化断言（单测/store 层）钉住该场景主干；E2E 已写但从未实机运行，不计为测试证据（证据列如实注明）；仅有实现而无断言归 ○。

| # | 场景（spec 条款） | 状态 | 说明 / 证据（引自功能维度审查） |
| --- | --- | --- | --- |
| 1 | §9.1 契约常量区 / strict 往返拒收 / parity 单测 / 默认值抽查 | ✅ | `packages/shared/src/contracts/contract.test.ts` 13 条 it 实跑全绿（含 §9.6 四键 additive 与 voiceTtsEngine 默认 system） |
| 2 | §9.1 CLI sendText source 透传 + intent→投影下发 | ⏸ | spec 附录 C 第 2 条明列未实施；CLI-first 门禁维持；renderer 未携带 source，一致 |
| 3 | §9.1 dep:refs 同源断言（mic 预留键豁免 FD-7） | ✅ | 本轮实跑 `pnpm dep:refs --list-exports packages/shared/src/contracts/voice.ts`，4 导出可见 |
| 4 | §9.2 mic 点按 AEC/NS/AGC=true 且输入腿 Recording | ✅ | webSpeechAsrAdapter.ts:89/:324 + useVoiceDictation.test |
| 5 | §9.2 partial 只进预览、composer 不变、零 v4 帧 | ⚠️ 待甄别 | useVoiceDictation.test:246（never dispatches）只断「composer 不变」半边；**S7 代转项质疑「partial 进预览」半边**：生产代码疑似无 onPartial→setPartial 接线（修订轮 git grep 复核：非 test 代码仅端口定义 voiceAsrPort.ts:62 与两适配器实现 webSpeechAsrAdapter.ts:343 / remoteAsrAdapter.ts:329，无订阅方），测试 :249 注释自称的 wiring 不存在——需专项甄别（§4.4-S7） |
| 6 | §9.2 final append 恰一次+空格规则；用户编辑保留；连续 3 句拼接 | ✅ | useVoiceDictation.test:225 + composerTextAppend.test 6 测试 |
| 7 | §9.2 录音中切 focused 注入仍为绑定会话 | ✅ | 绑定捕获 store 层 + 定向注入 hook 层各有测；字面切换场景无独立用例 |
| 8 | §9.2 Esc 仲裁：录音停零 v4 stop；mention 仅关菜单 | ✅ | composerEscapePlan.test 5 + useVoiceDictation.test:267 + voiceSessionStore.test:208 + SessionPane/ChatPromptEditor 双接缝；不可达角落见 F6（low） |
| 9 | §9.2 RequestingMic 10s 超时回 Idle+轻提示 | ⚠️ | 超时回 Idle 有测；「轻提示」因 **F1** 死路不可见 |
| 10 | §9.2 ASR network 错误保留已注入文本+提示、不自动重启 | ⚠️ | 保留文本+不重启有测；「提示」不可见（**F1**） |
| 11 | §9.2 final 未发送刷新随 composer 草稿恢复 | ○ | append 走 scheduleDraftPersist 既有草稿通道，无新专项测试 |
| 12 | §9.2 isWebRemoteControl/不支持/入口隐藏不渲染 | ✅ | voiceComposerEntryState.test 11 测试；E2E 已写、本环境未运行 |
| 13 | §9.2 绑定会话录音中关闭：强制停+提示+零注入 | ⚠️ | 强制停+零注入有测（voiceSessionStore.test:172）；sessionGone 提示不可见（**F1**） |
| 14 | §9.2 FD-5 两入口隐私确认门（确认即中止） | ○ | 单测面仅 reader（voiceComposerEntryState.test:61）；接线与中止语义靠未运行的 E2E |
| 15 | §9.2 设置页开关开启动作的确认门（FD-5 设置侧） | ⚠️ | 门逻辑实现且取消回落；开关 checked 初态反转且为死控件（**F2**，复核成立且更重） |
| 16 | §9.2 lastDictation 恢复菜单（恰一次/不覆盖）+ TTL 过期不渲染 | ○ | store 层有测（voiceSessionStore.test:116/:130/:184）；右键菜单组件无单测 |
| 17 | §9.2 FD-6 同会话双 pane：第二点按 no-op+脉冲、partial 归属 | ✅ | useVoiceDictation.test:395/:434 + voiceSessionStore.test:192 |
| 18 | §9.2 双主题+390/1200 快照；voiceI18n 守护 | ⚠️ | 快照 keptOpen（spec 附录 C 第 4 条）；E2E 只断 390px 几何子集且未运行；voiceI18n 三断言实跑绿 |
| 19 | §9.3 轮尾播报全文 === assistantTextRows 聚合（复制同源） | ✅ | turnSpeechPlanner.test:198/:206 + buildTurnSpeechText 同链 |
| 20 | §9.3 TID_VOICE_ANN_STOP 任何播报态立即静音零协议 | ✅ | turnSpeechPlanner.test:421/:436 + AnnouncementIndicator 挂载 SessionPane:5718 |
| 21 | §9.3 TID_V4_STOP 既有语义零改动 + 播报经 Cancelling 同步静音 | ✅ | diff 核实 :1442/:2504 停止链零改动；turnSpeechPlanner.interrupt.test:350 + SessionPane handleStop 接线 |
| 22 | §9.3 「停掉任务」发 v4 stop 带 expectedForegroundExecutionId | ✅ | interruptCommandFlow.test:313/:335 + SessionPane.tsx:4557 + planner:505 |
| 23 | §9.3 stop 命中 guard.stopTargetChanged：5s 兜底回 AnnIdle+warn | ✅ | turnSpeechPlanner.test:557 + VOICE_CANCELLING_FALLBACK_TIMEOUT_MS=5000 |
| 24 | §9.3 Speaking 开麦句粒度暂停；续播/只播最新/不排队 | ✅ | turnSpeechPlanner.test:308/:326/:363/:377 + store FD-2 持约态 |
| 25 | §9.3 双窗口 claim 仲裁仅持有者出声；接管 | ✅ | voiceAnnouncementClaim.test 6 + claim-lost revert:593；5s TTL 靠 Main broadcastHub 既有机制，无字面双窗口集成测试（主干 claim 仲裁/接管有实跑单测，字面双窗口场景无独立用例——按「有测试」口径的边界情况如实标注） |
| 26 | §9.3 非 focused TurnComplete 零播报；切 focused 停旧播报 | ✅ | useVoiceAnnouncement.wiring.test:271/:294 |
| 27 | §9.3 AnnPaused 下「停」停播不注入不续播 | ✅ | interruptCommandFlow.test:260 + interruptionWords.test 8 |
| 28 | §9.3 权限播报期间 askUserQuestion 倒计时不变（零新 registry 调用） | ✅ | voice 模块 grep 零 registry 写入 + wiring.test:431 + FD-3 让位/去重/背靠背 14 测试 |
| 29 | §9.3 播报指示行外 overlay、ConversationRowView 零变化 | ● | git diff 核实 ConversationRowView.tsx 不在改动清单；AnnouncementIndicator 挂 pane 容器顶部 |
| 30 | §9.4/§9.6 remoteAsrAdapter 批量 ASR | ✅ | remoteAsrAdapter.test 12 + useVoiceDictation.test:359；「零音频载荷 mock transport 断言」缺位（F4，low） |
| 31 | §9.6 resolveAsrAdapter 选型回退树 | ✅ | resolveAsrAdapter.test 5 + useVoiceDictation.test:509-546 |
| 32 | §9.6 cloudTtsAdapter（逐句/跳句 warn/回落/恢复/system 回归） | ✅ | cloudTtsAdapter.test 10 + wiring.test:363/:373/:402 |
| 33 | §9.6 toolBriefPlanner 六规则 | ✅ ⚠️偏差 | toolBriefPlanner.test 9 + 简报 5 例 + wiring 接线；**规则 2「10s 合并窗」未按 spec 生效（C1，复核成立）** |
| 34 | §9.6.8 交付物 S6：VoiceSection 厂商档分组 | ○ | VoiceSection.tsx:196/:241/:251-258/:293 实现齐备；组件无单测，E2E 未覆盖厂商组 |
| 35 | §9.6.8 交付物 S7：i18n 新键双语守护 + CONTRACT.md 同步 | ✅ | voiceI18n.test 3 断言实跑绿；CONTRACT.md/contract.example 在 diff 中 |
| 36 | §9.6 busy steer/queue（零改动回归面） | ○ | SessionPane.tsx:3727 显式传参核实、CLI 无改动；spec 明示本批只做验收回归 |
| 37 | §9.4/§9.6.9 手机 mic/播报、权限语音 decline/cancel、流式 WS、真机打断与 EG-11、TV-8 spike、claim renew、输出设备、CLI source | ⏸ | spec 明列延后；未发现代码与冻结裁决相矛盾处（spec §9.6.8 交付物 S2/S4——remoteAsrAdapter/cloudTtsAdapter——已带 TV-8 校准注释与容器格式回退实现） |

## 4. 分维度审查结论与发现清单

复核标注口径：**复核成立** = 独立复核人逐行核实成立（5 条，全部 holds=true）；**low未复核** = 未进入复核流程（裁决规则不要求 low 复核，如实标注；去重后 16 条）；本批无「复核不成立(降级)」项。复核方式均为只读静态核验（打开文件 + grep + 纸面推演），未运行测试/构建，复核人已逐一注明。

**F1 与 C2 的关系（调和注，避免误读）**：C2 以「notice 可见且可交互」为前提，而 F1 证明当前 notice 零可见帧——两条不矛盾：C2 是 `DictationPreviewOverlay` 组件**设计层的潜伏缺陷**（notice 分支 DictationPreviewOverlay.tsx:90-107、关闭按钮 :95-105 `tabIndex={-1}`、无自动清除），在 F1 修复（idle+notice 也挂载）后立即成为用户可达缺陷，故随 P0-1 一并修复。同理，若 S7 甄别成立，「清除 partial」按钮（:76-88，要求 partialText 非空 :51）在真实运行中同样不可达。

### 4.1 功能完备维度（1 high / 1 medium / 4 low）

**维度结论**：语音 Phase 1/1b 与 §9.6 批次的骨架接线全部真实——mic 入口挂 ConversationComposer（ConversationComposer.tsx:2620）、播报腿与 AnnouncementIndicator 挂 focused SessionPane（:846/:5718）、append 注入经消费门到 composer 应用分支（SessionPane.tsx:5428→ConversationComposer.tsx:338）、厂商档→选型回退树从入口贯通到运行时；实跑 217 语音单测、typecheck、lint、parity、dep:refs 全绿；TID_V4_STOP 链与 ConversationRowView 零改动经 diff 核实。keptOpen 之外无整项缺失，但存在以下需修缺陷。

| # | 严重度 | 复核 | 发现 | 关键证据 |
| --- | --- | --- | --- | --- |
| F1 | **high** | **复核成立** | 听写错误/超时「轻提示」链路死路：notice 只在离开录音腿（idle）时写入，唯一渲染入口只在 recording 态挂载，6 种提示（permission/network/device/aborted/requestingMicTimeout/sessionGone）零可见帧；§9.2 三条验收（超时轻提示/network 错误提示/绑定会话关闭提示）的用户可见半边全部落空 | store 4 个写入点均与回 idle 同批：voiceSessionStore.ts:280-287/:298-308/:340-348/:349-359，不变量「notice 非 null ⇒ inputLeg=idle」（同批写入，单向；反向不成立）；唯一消费面 V4ComposerVoiceEntry.tsx:109/:166（recording gate）；DictationPreviewOverlay.tsx:50-52/:90 自身支持 idle+notice 但永远等不到挂载，:70-72 requestingMic 分支同样被父 gate 排除；grep 证实无 toast/GlobalNotice 第二出口；测试只断 store 层 notice.code（voiceSessionStore.test.ts:68/:113/:167/:181、useVoiceDictation.test.ts:281/:300/:327），无组件级可见性断言。复核人逐行核实并独立收敛消费面，逻辑链闭合 |
| F2 | medium | **复核成立（更重）** | VoiceSection 听写入口开关 checked 读侧用「隐藏」语义（显示与行为双向相反）；**复核推翻「写路径正确、双击可恢复」的缓解说法**：写路径为定点（写盘值恒等于当前显示值），且为全分支唯一写者 → 听写入口永远无法经设置开启，是死控件（按「功能不可用」标准实际已达 high 档）；其桌面 E2E 两处断言静态推演必失败 | 读侧 VoiceSection.tsx:104 `settings?.voiceComposerEntryHidden !== false` 直接作 checked（:141），与可见性 reader（voiceComposerEntryState.ts:14 `=== false` 才可见）互补，默认 true（validationAppSettings.ts:532 `z.boolean().default(true)`），背离 CUA 先例（ComputerUseSection.tsx:622-623 先算 hidden 再取反）。写侧 VoiceSection.tsx:142-144 `onCheckedChange={(checked) => handleCapabilityToggle({ voiceComposerEntryHidden: !checked })}`：Switch 为 Radix 受控组件（`packages/ui/src/components/ui/switch.tsx`，SwitchPrimitive.Root），`onCheckedChange` 参数是被点开关的**下一状态 = 当前 checked prop 取反**，故写盘值 = `!下一状态 = checked prop = (hidden !== false)` = 当前显示值——true 写 true、false 写 false，**任意状态均为定点**；handleCapabilityToggle（:77-87）原样透传 patch，FD-5 确认路径（:89-96）同样原样写入，写前无归一化；git grep 证实 :143 是全分支唯一写者（useVoiceComposerEntry.ts 只写 privacyDisclosureAcknowledged）、V4ComposerVoiceEntry.tsx:105 隐藏时不渲染无兜底。E2E 静态推演（未实机运行）：test 2 :86 取消后断言 `data-state="unchecked"` 必败（取消不落盘、显示恒 checked）；test 3 :106-110 `checked` 断言恰因「写值=显示值」而通过，但 :113-118 返回 composer 后 `waitForDisplayed` 必超时（hidden 恒 true，入口不渲染） |
| F3 | low | low未复核 | 主进程 mic 权限策略 voicePermissionPolicy.ts 零测试：DI 注释明言「测试以 fake 结构断言」但全仓无对应测试文件，media audio 放行/含 video 拒绝/其余放行无回归钉 | voicePermissionPolicy.ts:20-27（DI 注释）/:70-108（策略）；grep 仅 main/index.ts:267/:2095 装配消费，无 *.test.ts 引用；新 E2E 不触碰权限面 |
| F4 | low | low未复核 | §9.6.8 交付物 S2 验收列名的「零 v4/relay 载荷含音频字节（mock transport 断言）」断言缺位；音频不过协议由构造保证（renderer 直连 fetch），但 spec 列名的断言缺位 | remoteAsrAdapter.test.ts 覆盖恰好一次上传/零 partial/错误映射（:94/:128/:139）；useVoiceDictation.test.ts:359 断注入链 mode=append；两文件均无 transport/dispatchCommand 层零音频载荷断言（grep dispatchCommand\|sendText\|transport 零命中） |
| F5 | low | low未复核 | i18n 键 voice.brief.truncated 双语定义但零消费：简报截断实际用字面「…」，与 §6.3 键清单偏差，宜删键或接消费（voice.source.fromVoice 同为零消费但与 spec 附录 C 第 2 条 CLI 延后一致，不计缺陷） | zh-CN.ts:8242、en-US.ts:8718 定义；grep 全 src 无 formatMessage 消费；useVoiceAnnouncement.ts:392 用「…」、:401 注释自证 |
| F6 | low | low未复核 | Esc 录音仲裁不可达角落：任务空闲（canStop=false）且焦点在 composer 外时窗口级 Esc 监听未注册，录音无法用 Esc 停，与 §4.4 优先级 3 字面不符；composer 内路径完整、mic 点按可停，低危；双 pane 双授权已被 defaultPrevented 检查兜住，无跨 pane 误停 | SessionPane.tsx:4599-4601 注册门含 canStop；composer 内路径 ChatPromptEditor.tsx→ConversationComposer.tsx:2835；escapeStop.ts:3-5 defaultPrevented 兜底核实 |

### 4.2 架构红线维度（3 low）

**维度结论**：对仓库架构红线整体高度符合（最小接缝审计详见 §5）。3 条 low 中，A1 属「契约字面量单一出处」红线的**违例模式**（定级说明见 A1 行：因无运行时破损记 low、列 P2 修复，不构成豁免）；A2/A3 非红线违规。

| # | 严重度 | 复核 | 发现 | 关键证据 |
| --- | --- | --- | --- | --- |
| A1 | low | low未复核 | 引擎判别字面量（"webSpeech"\|"remote"、"system"\|"cloud"）未进 shared/contracts 常量区，5 处 wire/schema 位点独立书写且无两侧互检 parity；新增引擎（additive 路径）需手工同步 5 处，漏一处即 schema 间静默分叉。当前无运行时破损，属未来扩展风险。**定级说明（修订轮）**：按 AGENTS.md「契约键单一出处」红线衡量（wire 协议字段字面量多点独立书写），此属红线违例模式，不构成豁免；记 low 仅反映「运行时无破损 + 修复机械（收敛常量区 + parity 扩展）」，已列 P2 修复批次 | input-intent.ts:50、validationAppSettings.ts:534/:675（voiceAsrEngine 两 schema）、:540/:680（voiceTtsEngine 两 schema）、protocol.ts:303/:307；`packages/shared/src/contracts/contract.test.ts` 只单向钉（:125 拒 "whisper"、:91 缺省值 voiceAsrEngine="webSpeech"）；对照 VOICE_SETTINGS_KEYS 已有 parity 单测（同文件 :69-93，实跑 13/13） |
| A2 | low | low未复核 | 两个新测试 id 裸字面量未登记 shared test-ids.ts，与同组件直接先例（CUA 入口 TID_V4_COMPOSER_CUA_ENTRY 走共享常量）及本批 TID_VOICE_ANN_STOP 自身做法不一致；E2E 以字符串重复耦合，任一侧改名 E2E 静默失效 | V4ComposerVoiceEntry.tsx:146 硬编码 "v4-composer-voice-entry"、VoiceSection.tsx:140 硬编码 "voice-entry-toggle"；E2E voice-composer-entry.test.ts:39/:48/:72/:86/:92/:106 裸字面量 |
| A3 | low | low未复核 | 已提交单测内遗留 3 处调试用 console.error（DEBUG 字样、无断言作用），污染测试输出；与 C5 同源（同一问题两维度各自立项，修复一次即可）。生产代码零 console、零 window.drora（grep 核实） | useVoiceAnnouncement.wiring.test.ts:249/:414/:424 |

### 4.3 代码标准维度（1 medium / 5 low）

**维度结论**：整体良好——新 UI 组件零硬编码颜色与任意值（全语义 token，双主题天然覆盖）、i18n 三方对账（在用键 == voiceI18nKeys 声明 == zh/en 词典）闭合无硬编码文案、日志全量核对无 apiKey/Authorization/音频/转写原文落盘且分级合理、TS 干净（typecheck exit 0，0 any / 0 @ts-ignore / 0 新增 eslint-disable / 0 非空断言）、抽读测试以 spec 条款钉行为且 mock HTTP 形状与 §9.6.4/§9.6.5 端点契约逐字段一致。**限定（修订轮）**：「抽读测试以 spec 条款钉行为」为抽样结论、非全量核验——且已有两处反例（C1 的测试标题与实际钉住的规则不符；S7 的 useVoiceDictation.test.ts:249 注释自称的 wiring 不存在），该结论证据强度以抽读范围为限。

| # | 严重度 | 复核 | 发现 | 关键证据 |
| --- | --- | --- | --- | --- |
| C1 | medium | **复核成立** | toolBriefPlanner 规则 2「同类 10s 合并窗」未按 spec 以最近一次已播简报为基准生效：lastBriefAtByTool 声明后全文件零读取（死状态）；合并窗判定只锚 pendingByTool，而 pending 在同一次 consumeToolCallSnapshot 内即被 drain 清空 → 同名工具以 [5s,10s) 间隔到达时各自播出新简报，与 §4.2-2/§4.2-4 合并语义有偏差（§9.6.8 交付物 S5 验收「密集 5 次 ≤1 条」在密集调用下仍满足）；对应测试标题与实际钉住的规则 3 不符，偏差区间无测试。复核人以纸面推演 t=0 播 a.ts、t=6s 喂 b.ts 证实漏合并。**缺陷身份前提**：spec §4.2 标注 EG-1「建议，待拍板」——先拍板 EG-1，再定按 spec 收口（C1 成立）还是修 spec 记录有意分歧（C1 退出缺陷清单，见 §1.4） | toolBriefPlanner.ts:73（声明，:72 注释「合并窗基准」）/:138（唯一写入，零读取，且为局部 const 外部不可消费）；判定 :117-119 只取 pending；drainPending :84-96（:87 无条件 delete）于 :141-143 每快照执行；测试 toolBriefPlanner.test.ts:75-87 标题称规则 2/4 但 :83-84 注释自认按规则 3 达成、:86 断言播的是首个而非最新目标；偏差区间 [5s,10s) 无钉（其余用例 1s/:80、3s/:165/:168、15s 窗外/:92-93）；spec §4.2（specs/voice-agent-integration.md:339 标题、:897 EG-1 行）标「建议，待拍板」 |
| C2 | low | low未复核 | 听写预览条「清除 partial」「关闭错误提示」按钮 tabIndex={-1} 键盘不可达；错误 notice 无自动清除、只能鼠标关闭。**与 F1 的关系见 §4 调和注**：本条为组件潜伏缺陷，F1 修复后成为可达缺陷，随 P0-1 一并修复 | DictationPreviewOverlay.tsx:80-82/:98-100；DESIGN.md 键盘导航一等路径；spec §5.2 只要求容器不获焦未要求按钮不可获焦；voiceSessionStore.ts:269 notice 仅下次 startMicRequest 清空 |
| C3 | low | low未复核 | 听写预览条 overlay `w-max max-w-md`（448px）无窄视口钳制，容器/视口 <448px 横向溢出；仓内浮层钳制先例（ConversationShareSelectionPanel.tsx:189）未沿用。手机远控壳已按 §8.3 不渲染 mic 入口，风险限于窄窗口 Web/桌面 | DictationPreviewOverlay.tsx:61；AnnouncementIndicator.tsx:39 居中胶囊风险较小 |
| C4 | low | low未复核 | VoiceSection 厂商档输入 w-72/w-56（288/224px）超出 SettingsRow 默认控件列 192px，flex 收缩后宽度类实际不生效，与仓内「控件宽度匹配列宽」先例（McpServerForm w-48、HookForm w-full md:w-48）不符 | VoiceSection.tsx:210/:224/:240/:306/:319；SettingsPageParts.tsx:121-123 |
| C5 | low | low未复核 | 同 A3：wiring.test.ts 三条 DEBUG console.error 调试残留（测试卫生，非运行时日志违规；打印内容不含凭据/转写原文） | useVoiceAnnouncement.wiring.test.ts:249/:414/:424 |
| C6 | low | low未复核 | 两浮层表面用 bg-surface，偏离 DESIGN.md「浮层 Prefer bg-popover/bg-menu」软规则（非禁用项）；仓内浮层先例用 bg-surface-raised/bg-popover | DictationPreviewOverlay.tsx:61、AnnouncementIndicator.tsx:39；先例 Root.tsx:300、ConversationShareConfirmationDock.tsx:200 |

### 4.4 安全隐私维度（2 medium / 5 low）

**维度结论**：整体扎实——apiKey 全链路（ICredentialService 加密存储→renderer 经 RPC 读取→仅作 Bearer 头）逐语句核验无明文落点；麦克风严格 push-to-talk（唯一触发 mic 点按，无自动/常开/快捷键路径）；音频仅内存且 abort 即清、TTS 零落盘缓存；厂商请求 credentials:"omit"+redirect:"error"；UI 错误走类型化 i18n 不透传内部信息。

| # | 严重度 | 复核 | 发现 | 关键证据 |
| --- | --- | --- | --- | --- |
| S1 | medium | **复核成立** | 厂商 baseUrl 用户可配但无 https 强制、无明文传输警告、无 URL 合法性校验（UI/谓词/持久化三层均无）——apiKey 头与整段录音/合成文本可经 http 明文外发。复核精确化（不推翻）：请求带 credentials:"omit"+redirect:"error"，泄露面限于 Authorization 头+载荷本身；设置面有数据处理方披露但不区分 http/https、不警告明文。spec 全文无豁免，属真实缺口而非有意分歧 | VoiceSection.tsx:206-220 纯 Input 直写 settings（:216）；remoteAsrAdapter.ts:246 fetch `${baseUrl}/audio/transcriptions` + :248 Bearer + :232-242 整段录音 FormData；cloudTtsAdapter.ts:182/:185 同（body input=u.text :176）；isVoiceVendorConfigComplete（resolveAsrAdapter.ts:40-50）只 trim 非空；validationAppSettings.ts:540 无 .url()；全模块 grep 零校验（唯一命中 :37 JSDoc 示例） |
| S2 | medium | **复核成立** | 云 TTS 数据流向披露不实：开启 cloud TTS 后 assistant 回复正文、权限摘要、工具简报目标（工具输入首行 ≤40 字符）会发厂商，而设置面披露文案只写「音频与转写由 {baseUrl} 处理」（只描述 ASR 方向），全 locale 无 TTS 数据流文案——云 TTS 开启者无法得知 assistant 内容离机，违反 §6.2/§9.6-6「如实标注数据处理方」 | cloudTtsAdapter.ts:174-181（input=u.text = 播报句全文）；内容三来源：useVoiceAnnouncement.ts:287（轮尾正文=assistantTextRows 聚合）、:376-380（权限摘要）、:390-404（简报目标=extractToolBriefTarget 首行 40 字符截断）；接线 :150-169/:207-209；披露文案 zh-CN.ts:8234 / en-US.ts:8710 仅「音频与转写」；渲染位置 VoiceSection.tsx:251-258 在听写分组，播报分组（:260-352）仅输出设备披露（:349-351） |
| S3 | low | low未复核 | 数据处理方披露渲染条件宽于 spec：仅 baseUrl 非空即渲染「已启用云语音引擎」，即使 voiceAsrEngine=webSpeech 且 ttsEngine=system；偏差方向是过度披露，不构成泄露，但与「如实」相悖可能误导用户 | VoiceSection.tsx:251 条件仅 `vendorBaseUrl.trim().length > 0`；spec §9.6.2-6/交付物 S6 验收触发条件是「任一云引擎开启且 baseUrl 非空」 |
| S4 | low | low未复核 | ASR 云引擎选项文案「云引擎（即将支持）」与已实现并可选的 remote 引擎矛盾（Phase 1 占位残留），误导可用性与数据流判断 | zh-CN.ts:8238、en-US.ts:8714；VoiceSection.tsx:196-198 档完整时可选；useVoiceDictation.ts:77-113 已接线 createRemoteAsrAdapter，52 项相关单测通过 |
| S5 | low | low未复核 | voicePermissionPolicy 授权不按 origin 限定且 media 之外全部显式自动批准，注册于 session.defaultSession，captcha 隐藏窗口（未设 partition）同 session 可获 mic(audio) 授权；属 spec 附录 C 第 1 条记档的「行为保持」决策（其余权限放行 = 保持「无 handler 时代自动批准」现状——该等价性系 spec 记档主张，本报告未独立复验）、非本次回归，但与最小授权有距离，建议后续按 origin/分区收窄 | voicePermissionPolicy.ts:75-95（:84 audio 一律 true、:93-94 其余 true、:96-107 check 同）+ main/index.ts:2096 注册 + captchaSolverWindow.ts:70-76/:28 |
| S6 | low | low未复核 | cloudTtsAdapter 自然播完（ended）路径不 revoke objectURL，合成音频 blob 内存滞留至文档卸载（仅 stop() 路径回收）；不落盘不上传（满足 §7.2 零持久化），仅内存随句数增长 | cloudTtsAdapter.ts:128-144（createObjectURL :129、revokeObjectURL 仅 :141） |
| S7 | low（代转功能维度） | low未复核 ⚠️**跨维度冲突** | partial 预览条运行时接线疑似缺失：无任何生产代码订阅端口级 onPartial 写 store.setPartial，录音中 partialText 恒空，§9.2「partial 到达预览条更新」在真实运行疑似不成立（非隐私问题，安全维度明确「移交功能维度核验」）。**与功能覆盖矩阵第 5 行原「已实现+有测试」口径冲突**（修订轮已将第 5 行改标「⚠️ 待甄别」）：该测试实际只断「composer 不变、零 v4 帧」，其 :249 注释自称「setPartial 由 wiring 消费」但该 wiring 不存在。修订轮补充独立旁证：git grep 非 test 代码，onPartial 仅端口定义（voiceAsrPort.ts:62）与两适配器实现（webSpeechAsrAdapter.ts:343、remoteAsrAdapter.ts:329），setPartial 生产侧仅 store 定义（voiceSessionStore.ts:106/:292）与清除按钮回写空串（V4ComposerVoiceEntry.tsx:172），无订阅方。功能维度未复核此点——需专项甄别；若成立应升格为功能缺口处理（high 档，见 §1.4） | useVoiceDictation.ts:342-343 仅订阅 onFinal/onError；useVoiceDictation.test.ts:249 注释与实际断言不符 |

## 5. 架构合规声明（最小接缝审计）

**结论：整体通过，附一项红线违例模式的遗留项（A1，low，P2 修复）。**（以下为架构红线维度审查结论，其实跑项记录在该维度审查材料中）

- **19 个既有文件改动逐一核验全部为最小接缝**（单处 import / union 追加 / 必要挂载点 / 行为保持的纯函数外移重构），无一处把自研状态机或业务逻辑写进既有文件，无自研主体内联展开。
- **还原/上游隔离零破口**：`.oxlintrc.json` ignorePatterns 登记的还原目录与 `packages/zcode-cua` 在 diff 文件清单中交集为空，改动文件均无「还原」头，无还原文件 import 自研实现。
- **契约字面量单一出处**：生产/消费两侧收敛到 `contracts/voice.ts` 与 `test-ids.ts`，并有 parity 单测实跑钉住（`packages/shared/src/contracts/contract.test.ts`，13/13 通过）；**遗留 A1（引擎判别字面量 5 处散写）属「契约键单一出处」红线的违例模式**，因无运行时破损记 low、列 P2 修复（定级说明见 A1 行），不作为本节「通过」的豁免。
- **状态所有者唯一**：voiceSessionStore 经架构维度逐文件核验确认为语音两腿（听写+播报）唯一状态所有者；main 侧 voicePermissionPolicy 只登记权限双 handler、不载业务状态，与既有 permission policy 无 session 覆盖冲突。
- **实跑门禁**：`architecture:check --changed`（merge-base=ee9c97b0，即本审查范围）violations:0 / new:0，与终态门禁 exit=0 一致。
- 遗留 3 条 low（A1/A2/A3）：A2/A3 属工程卫生，A1 属上述红线违例模式的遗留项，修复前不构成新的合入阻塞（本裁决 NO-GO 已由 F1 触发），但 A1 须按红线要求修复、不得长期挂账。

## 6. 建议的后续动作

**P0（阻塞推送；全部在 `feat/voice-agent-phase1` @ drora-voice-agent worktree 上修复）**

1. **修 F1**：打通轻提示可见性——渲染门与状态迁移方向对齐（idle+notice 态也挂载提示，或将提示迁至独立于录音腿的出口，requestingMic 预览条提示同理）；补组件级可见性断言测试，恢复 §9.2 三条验收（#9/#10/#13）的用户可见半边。**若选「idle+notice 也挂载」，须同步处置 C2**（错误 notice 的自动清除/超时策略 + 关闭按钮键盘可达性），否则 F1 修复后 C2 立即成为可达缺陷。
2. **修 F2**：开关读写两侧语义一起纠正——读侧对齐 CUA 先例（先算 hidden 再取反），写侧消除定点（写盘值恒等于当前显示值；修订轮已在源码坐实，见 F2 行推导）；补组件级断言并在 Electron 目标运行时**实机运行桌面 E2E**（当前预期失败的 test 2 :86 与 test 3 :113-118 断言转绿作为回归证据）。
3. **甄别 S7**：partial 接线是否真缺失（组件级/实机验证 partial 是否到达预览条）；成立则按功能缺口修复并补测试，同时更正功能矩阵 #5 口径与 useVoiceDictation.test.ts:249 误导性注释；不成立则记录证伪证据。

**P1（转 GO 前置或紧随其后）**

4. **修 S1**：baseUrl 增加 https 强制或明文传输警告 + URL 合法性校验（UI/谓词/持久化至少一层强制、其余警告），双语文案。**按仓规先改 spec 再改码**（§6.1/§6.2/§9.6 相应条款），并先拍板本地/局域网自托管端点（如本地 Whisper server）的产品策略——硬性 https 阻断会切断合法自托管场景，「阻断 vs 警告+披露」本报告不代为拍板，列为 S1 修复的前置决策项。
5. **修 S2**：补云 TTS 数据流披露文案（assistant 正文/权限摘要/工具简报目标离机，中英双语）；顺带收口 S3 渲染条件至 §9.6.2-6（任一云引擎开启且 baseUrl 非空）。
6. **甄别 C1**：先拍板 EG-1（spec §4.2 标注「建议，待拍板」）——按 spec 接线 lastBriefAtByTool 实现 10s 合并窗，或修 spec 记录有意分歧；同步修正测试标题（当前标题与实际钉住的规则不符）并补 [5s,10s) 偏差区间用例。

**P2（可随后续批次）**

7. low 批次处理：A1 引擎枚举进 contracts 常量区+互检 parity（红线违例模式，见 A1 定级说明，不得长期挂账）；A2 两个 test id 登记 shared test-ids.ts；A3/C5 清理 3 处 DEBUG console.error；C2 按钮 tabIndex 与 notice 键盘处置（随 P0-1 联动）；C3 窄视口钳制（沿用 ConversationShareSelectionPanel 先例）；C4 控件宽度对齐 w-48/wide 变体；C6 浮层 token 对齐 bg-popover/bg-menu；F3 voicePermissionPolicy fake 结构单测；F4 零音频载荷 mock transport 断言；F5 voice.brief.truncated 删键或接消费；F6 Esc 注册门角落；S4「即将支持」文案更新；S6 ended 路径 revoke；S5 权限按 origin/分区收窄（可立后续工单）。

**流程要求**

- **修复落 commit**：全部修复以增量 commit 落在 `feat/voice-agent-phase1`（本地分支、无远端 ref）；推送边界（单 PR 含全部提交 vs 拆批）在修复完成后与 PR 描述一并定。
- **独立复检范围**：F1/F2/S1/S2/C1（复核成立项）与 S7（甄别项）修复后需再走独立复核（方式同本轮：只读静态核验 + 组件级断言 + E2E 实机证据）；其余 low 修复以测试与门禁绿自证即可。
- 修复后在目标 tip 重跑终态门禁（`architecture:check`、`verify:pre-push`）+ 217 语音单测，全部绿并**留存原始输出与运行 commit**（本轮两项门禁绿无运行 commit 记录，不构成「终态」凭据）；桌面 E2E 实机运行为转 GO 必要证据——**Electron 目标运行时环境当前无人认领**（spec 附录 C 第 3 条已记「本仓实施环境无法运行 Electron 桌面端」），须在修复批次开始前指定责任人落实。
- PR 描述按 AGENTS.md 逐项说明触发场景、根因证据、修复机制与回归验证（F1/F2 均为 bugfix，需附本报告对应证据链），并说明分支名/tip 提交标题/审查口径三者的对应关系（见头部「推送范围声明」）。
- 16 条 low未复核项（去重后）如需升档证据可按需补复核；本裁决由 F1（high，复核成立）单项触发，S1/S2/F2（medium，复核成立/复核加重）支撑整改清单；C1 的缺陷身份待 EG-1 拍板（见 §1.4），S7 待专项甄别——两者均不改变 NO-GO 方向。
- 与官方上游对齐注意：S5 属 spec 附录 C 第 1 条记档的行为保持决策，收窄时需同步更新 specs/voice-agent-integration.md 的差异记录。

---

## 修订记录（2026-10-23 修订轮，技术编辑）

按外部审读意见修订本报告；**裁决（NO-GO）与各发现的实质内容不变**。修订人在 voice worktree（@ `09d6246c`）上实际读取/运行核验如下（未实跑项见第 5 条）：

1. **F2「定点」断言由纸面推演升级为源码坐实**（审读意见质疑「按所引三处推不出定点、实为单击即开启」——该质疑不成立）：关键在 VoiceSection.tsx:142-144 的 `onCheckedChange` 参数 `checked` 是 Radix 受控 Switch 的**下一状态**（= 当前 checked prop 取反；`packages/ui/src/components/ui/switch.tsx` 为 radix-ui SwitchPrimitive.Root 受控用法），故写入值 `!checked` 恒等于当前显示值 `(hidden !== false)`——true/false 均为定点，开关无法改变 hidden。审读意见的相反推演把回调参数误读为当前显示值。配套核验：`git grep voiceComposerEntryHidden`（非 test）证实 :143 为全分支唯一写者；默认 true（validationAppSettings.ts:532）。E2E 断言精确化：test 2 :86 必败（取消不落盘、显示恒 checked）；test 3 :106-110 恰因「写值=显示值」而通过、:113-118 `waitForDisplayed` 必超时——「两处必败」结论维持。
2. **F1 零可见帧复核**：voiceSessionStore.ts 4 个 notice 写点（:281-286/:302-307/:341-347/:352-358）均与 `inputLeg:"idle"` 同批；唯一消费面 V4ComposerVoiceEntry.tsx:166 渲染门 :109 只认 recording；DictationPreviewOverlay 非 test 消费面仅 V4ComposerVoiceEntry.tsx:167（git grep）。原「⇔」不变量改写为单向「⇒」（同批写入只支撑 notice⇒idle；idle 可无 notice）。
3. **S7 获独立旁证**：git grep 非 test 代码，onPartial 仅端口定义与两适配器实现，setPartial 生产侧仅 store 定义与清除按钮回写空串——接线缺失方向证据加强；是否构成功能缺口仍需 P0-3 甄别（组件级/实机），S7 未据此改判，仅矩阵 #5 改标「⚠️ 待甄别」。
4. **引用与编号钉点**：A1、矩阵 #1、「parity 13/13」三处统一钉为 `packages/shared/src/contracts/contract.test.ts`（13 条 it；parity 断言为其中 :69-93 一条，:91 缺省值、:125 拒 "whisper" 均经实读核对）；「附录 C.2/C.4」改为「spec 附录 C 第 2/4 条」（该附录实为编号条目列表）；spec §9.6.8 交付物编号 S1–S7 与发现编号的碰撞消解（凡指 spec 条目写作「§9.6.8 交付物 S×」）；EG-1「建议，待拍板」钉到 specs/voice-agent-integration.md:339/:897；C1 与 F1/C2 矛盾以调和注显式收口；C1 移出「同等坚实裁决支柱」表述，裁决支柱改为 F1 + S1/S2。
5. **未实跑项维持如实标注**：桌面 E2E（voice-composer-entry.test.ts）、`architecture:check`、`verify:pre-push`、217 语音单测均未在修订轮实机运行；两项终态门禁绿的运行 commit/worktree/原始输出未随编排输入提供（§2 已注明），推送决策前须在目标 tip 重跑。矩阵计数改为显式口径（23 ✅+有测试 / 6 ⚠️ / 5 ○ / 1 ● / 2 ⏸ = 37，双标 #33 计入 ✅；原「5 项部分实现全部关联 F1/F2」因 #18 与 F1/F2 无关而更正）。

---

*报告生成：审查汇总人，2026-10-23；同日修订轮见上文修订记录。证据来源：四路审查材料 + 5 条复核结论（均为只读静态核验）+ 编排审查流程提供的终态门禁结果；汇总人自行核验的事实仅限报告头部「审查对象」与「推送范围声明」所列 git 命令（worktree list / log / ls / branch -r）。各审查维度自报的实跑项（单测/typecheck/lint/架构检查/parity/dep:refs）本汇总未复跑，如实转记。*
