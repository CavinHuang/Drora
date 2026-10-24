# 语音功能完整性与规范复审汇总报告

- 日期：2026-10-24
- 审查对象：worktree `D:/workspace/projects/drora-voice-agent`，分支 `feat/voice-agent-phase1`，HEAD `6d754098`（语音 Phase 2 提交）
- 审查方式：三路独立审查（功能面完整 / 音色与角色 / 规范符合）+ 对 medium 级发现逐条独立复核；单测证据为审查人实跑结果（修订轮已按 5.4 固定命令全量复跑核对，计数一致、全绿）
- spec 引用约定：所有 §x.y 指同提交内的 `specs/voice-agent-integration.md` @ `6d754098`（995 行；该 spec 随 HEAD 提交入库、工作树无未提交改动——修订轮 `git status` 核验，spec 与 HEAD 同步）。原版中的裸行号引用（spec:463/:673/:790）已改为章节号：463→§6.1 开关3 行、673→§9.3 交付物文件表 VoiceSection 行、790 附近→§9.6.5-1/-3（「复用决策」实际在 §9.6.5-1，原文 :790 为其相邻行）
- 汇总裁决：本文把三路结论收敛为明确判定，发现逐条标注 **复核成立 / 复核不成立(降级) / low 未复核**。本轮 3 条受复核发现全部成立，无降级条目；7 条 low 级建议未经复核，如实标注

---

## 一、三个问题的直接回答

### 1. 功能是否完整可用？

**是（静态与单测层面成立）。** spec §5/§6.1/§9.6 枚举的 21 个用户可感知功能面逐一完成「设置 UI / 真实读写路径 / 消费方 grep」闭环核验，全部 complete，无 missing-impl；上轮 6 条 NO-GO 修复均在当前代码以修复后形态确认存在（清单与锚点见下，修订轮逐条读码/grep 复核）。三批测试实测 246 项全绿（voice 模块 188 + 契约/设置/拼接 29 + Esc/store 29；命令、工作目录与修订轮复跑结果见 5.4）。功能面 lens 仅有 2 条 low 级维护性建议（注释漂移、死 API）——注意口径：这是功能面单一 lens 的计数，全报告三路合计 7 条 low，见 5.3 汇总表。无 high/medium 功能缺陷。**但注意：桌面 E2E 实机证据不成立——不仅第四轮工件缺失（运行未完成、summary 从未生成），第三轮还存在一次 2/3 过 1 败的完整失败记录（见第六节），不能视为已实机验证。**

上轮 6 条 NO-GO 修复清单（对应 2026-10-23 实现审查报告 `docs/voice-agent-implementation-review-2026-10-23.md` 的 P0 六项；修复形态锚点为修订轮核验）：

1. **F1（high）** 听写六种提示零可见帧 → `V4ComposerVoiceEntry.tsx:106-127`：渲染门扩为「绑定入口 + 未过期 notice 也渲染预览条」（`VOICE_NOTICE_VISIBLE_TTL_MS`；源码注释自证「修复轮 F1」）；
2. **F2（medium，复核加重）** 听写入口开关死控件 → `VoiceSection.tsx:108/:155-157`：`entryVisible = voiceComposerEntryHidden === false` 直读、写侧消除定点（矩阵 #1 的「修复后语义」即此）；
3. **S1（medium）** baseUrl 无 https 强制 → `voiceVendorBaseUrl.ts`（https 强制 + localhost 明文例外；源码注释自证「修复轮 S1」）+ `VoiceSection.tsx:220-289` onBlur 校验与 reason 分型（矩阵 #14）；
4. **S2（medium）** 云 TTS 数据流披露不实 → `VoiceSection.tsx:290-297` 数据流披露（任一云引擎开启且 baseUrl 非空时渲染，对齐 spec §9.6.5-4 补记）；
5. **C1（medium）** toolBriefPlanner 10s 合并窗未生效 → `toolBriefPlanner.ts:80/:114/:127`：`lastBriefAtByTool` 已有读取接线（以最近实际播出为基准；矩阵 #12 的「C1 修复后形态」）；
6. **S7（待甄别项，甄别后确认缺失并修复）** partial 预览接线缺失 → `useVoiceDictation.ts:351-356`：onPartial → setPartial 真实订阅（矩阵 #3 的「S7 修复后真实接线」）。

### 2. 音色选择与角色设置是否完整？

**音色：在 spec 已定义的深度上完整，但 spec 深度不足。** 基础链（设置键 → reader → speechSynthesis/云 TTS 双引擎映射 → 失配回落）complete 且有单测钉住。语速数值契约的准确表述：**设置域 0.5–2.0 在 zod（`validationAppSettings.ts:535`）与 reader（`voiceComposerEntryState.ts:51`，界外回落 1）两处一致；云 TTS 端点钳制更宽（`cloudTtsAdapter.ts:66-72` clampTtsSpeed 0.25–4），对设置域全覆盖**——即「域内一致、端点更宽」，并非三处同值（原版「三处一致」表述不成立，已更正）。5 个深查缺口中 **4 条（#1–#4）是 spec 未定义的需求缺口、1 条（#5）为建议级体验 nit（非缺口亦非遗漏），零实现遗漏**——其中盲填与云 TTS 复用两条 medium 已复核成立。**角色设置：不存在，且属 missing-in-spec。** 五组 grep（spec 全文 / voice 模块 / VoiceSection / 两份 locale / ui+shared src，明细见 4.1）确认零 persona/角色/character 概念，Phase 1 范围本就未定义该需求，非实现遗漏。

### 3. 是否符合项目规定？

**整体符合度高，但有 1 条复核成立的 medium 违规应在合并前清理。** i18n zh/en 字典语音键 61/61 全等且占位符同构、契约键全链单一出处、VOICE_SETTINGS_KEYS 与 validationAppSettings 十二字段 parity 实测通过、UI 全部使用主题 token 无硬编码色值、语音日志不落转写原文/凭据/音频。新发现：Phase 2 新测试文件 `useVoiceAnnouncement.wiring.test.ts` 残留三处 DEBUG `console.error` 调试输出（复核人实跑测试确认每次运行都向 stderr 打调试 JSON），违背 AGENTS.md「UI 不直接使用 console」规范，建议进 PR #30 清理后再合并。另如实披露 1 条未复核 a11y low：听写预览条「清除」与 notice「关闭」按钮 tabIndex=-1、纯键盘用户无法 Tab 触达（见 5.2 #2；有 spec §5.2「预览条不获焦」设计依据且存在等价键盘路径——Esc/再次点按停录音即清空——判建议不算缺陷，此处披露不计入上述「符合」面）。

---

## 二、功能面完整度矩阵（spec 枚举 21 面，全量）

| # | 功能面 | spec 依据 | 实现锚点（证据摘要） | 判定 |
|---|--------|-----------|----------------------|------|
| 1 | 听写入口开关 | §6.1 开关1（默认隐藏） | `VoiceSection.tsx:148-161` 开关（checked=hidden===false 修复后语义）→ `voiceComposerEntryState.ts:11-15` reader → `useVoiceComposerEntry.ts:67` 门控；VoiceSection.test.tsx 10 项覆盖 | complete |
| 2 | 隐私确认门 | §6.1 开关8 / FD-5 | `VoiceSection.tsx:78-103` pendingPatch（取消回落/确认生效）+ `useVoiceComposerEntry.ts:74-81` mic 兜底门 + `VoicePrivacyDisclosureDialog.tsx` 弹层 | complete |
| 3 | 听写预览条/partial | §5.2 / EG-14 | `DictationPreviewOverlay.tsx`（只读/tabindex=-1/清除按钮）+ `useVoiceDictation.ts:351-356` 订阅 + `webSpeechAsrAdapter.ts:343-346` partial 发射（S7 修复后真实接线） | complete |
| 4 | final 注入（append+会话绑定） | §5.1 / §2.4 / §3.4 | `useVoiceDictation.ts:218-236` → `droraSessionStoreWorkspaceSlice.ts:309-343` 写入请求 → `SessionPane.tsx:5428-5432` 消费门定向 → `ConversationComposer.tsx:338-350` append 应用 | complete |
| 5 | 恢复上次转写（右键菜单） | §5.4 / FD-4 | `V4ComposerVoiceEntry.tsx:138-161,205-213` ContextMenu + `voiceSessionStore.ts:181-190` TTL 300s freshness（过期不渲染） | complete |
| 6 | Esc 仲裁 | §4.4 键位仲裁表 | `composerEscapePlan.ts` 纯函数 + `ChatPromptEditor.tsx:246-253` props 注入 + `SessionPane.tsx:4600-4607` 窗口监听双接缝 + `voiceSessionStore.ts:197-204` consume（「停止录音」只停本地录音腿，**不发出任何 v4 stop 协议命令**——spec §4.4 仲裁表语义） | complete |
| 7 | 播报开关 | §6.1 开关2（默认关） | `VoiceSection.tsx:300-312`（FD-5 确认门内）→ `useVoiceAnnouncement.ts:354-363` 开关关闭即停播回 AnnIdle | complete |
| 8 | 播报跟随 focused | §3.4 | `useVoiceAnnouncement.ts:281-288` 仅 focused 消费轮尾 + `:290-298` 切离即停旧播；聚合文本与复制同源 | complete |
| 9 | 播报指示与停止按钮 | §9.3 / FD-1 层①载体 | `AnnouncementIndicator.tsx:49-59`（TID_VOICE_ANN_STOP，`test-ids.ts:596` 单一出处）→ `SessionPane.tsx:5720-5725` 仅 focused 渲染；层①为**纯 renderer 本地停止（tts.cancel()，不发任何协议命令**，spec §4.3 层①「不映射 v4 stop，零协议」） | complete |
| 10 | 打断词（层①） | §4.5 / §4.3 层① | `interruptionWords.ts:16-19` 词表 + classify（zh 精确/en 词数/第三语言回退）→ `useVoiceDictation.ts:204-206` → `turnSpeechPlanner.ts:676` uninterruptible 段外判定 | complete |
| 11 | 「停掉任务」（层③） | §4.8-1 / §4.3 层③ / §9.6.8 | `interruptionWords.ts:21-24` 短语表 → `turnSpeechPlanner.ts:680-712` requestCancelTask（静音入 Cancelling + 5s 兜底 + 无条件 deps.cancelTask()）→ `SessionPane.tsx:4537-4568` handleStop("voice") | complete |
| 12 | 工具简报开关 | §6.1 开关7 / §4.2 规则 EG-1 | `toolBriefPlanner.ts` 按 spec §4.2 编号实现：规则 1 首见触发 / 规则 2 10s 合并窗（EG-1 拍板，基准=最近实际播出）/ 规则 3 最小间隔 5s / 规则 4 只播最新 / 规则 6 每 turn ≤6 上限 / 规则 7 文案模板（规则 5「不打断正文与权限段」不在 planner 内、由播报调度层让位判定承担，锚点见 #10）+ 开关关闭零产出；`useVoiceAnnouncement.ts:394-435` 接线（C1 修复后形态） | complete |
| 13 | 听写引擎选择（webSpeech/remote） | §6.1 开关6 / §9.6.6 | `VoiceSection.tsx:190-216` Select（档不完整 disabled）+ `useVoiceDictation.ts:77-113` pickAsrAdapter（不完整回退 webSpeech+info，§9.6.6 回退树） | complete |
| 14 | 厂商档（baseUrl/asrVendorModel/apiKey） | §9.6.2 / §9.6.2-5/-6 | `VoiceSection.tsx:220-289`（onBlur 校验+reason 分型警告、apiKey 经 credentialService、数据流披露 :290-297）+ `voiceVendorBaseUrl.ts` https 强制 + `remoteAsrAdapter.ts:232-248` 真实 multipart POST | complete |
| 15 | TTS 引擎选择（system/cloud） | §9.6.2-4 / §9.6.5 | `useVoiceAnnouncement.ts:184-225` resolveTtsEngineNow（连续 3 句失败回落 :334-352、cancel 双停双引擎）+ `cloudTtsAdapter.ts:74-80` | complete |
| 16 | 播报模型（ttsVendorModel） | §9.6.2-4 / §9.6.5-1 | `VoiceSection.tsx:339-353` → `useVoiceAnnouncement.ts:150-169` 三元组 getVendorConfig → cloudTts POST body model 字段 | complete |
| 17 | 音色 | §6.1 开关3 | `VoiceSection.tsx:354-367` → `voiceComposerEntryState.ts:41-53` reader → `speechSynthesisTtsAdapter.ts:111-119` 名称匹配（完整 if 块，与 3.1 链路图同一范围）/ `cloudTtsAdapter` voice 字段（深查见第三节） | complete |
| 18 | 语速 | §6.1 开关4 | `VoiceSection.tsx:368-387` number Input（越界不写）→ `speechSynthesisTtsAdapter.ts:109` rate / `cloudTtsAdapter.ts:66-72` clampTtsSpeed（端点 0.25–4 钳制，全覆盖 0.5–2 设置域） | complete |
| 19 | 语言选择 | §6.1 开关5 | `VoiceSection.tsx:162-189` Select（auto 写空串）→ `voiceComposerEntryState.ts:32-38` resolve（空=跟随 locale）→ 仅喂 ASR | complete |
| 20 | 隐私三条披露 | §6.2（冻结成稿） | `VoiceSection.tsx:407-418` 三条 li + `VoicePrivacyDisclosureDialog.tsx:28-30` 弹层同三键；文案与 spec §6.2 逐字对照一致（zh-CN.ts:8256-8260 / en-US.ts:8731 起） | complete |
| 21 | 输出设备披露 | §6.2 末段 | `VoiceSection.tsx:388-390` 静态披露（键 `voice.settings.announcement.outputDisclosure`，zh-CN.ts:8253 / en-US.ts:8729，与 spec 成稿一致） | complete |

**矩阵结论：21/21 complete，功能面维度无 missing-impl / partial**（「partial」一词在 5.1 日志规范维度另有结论，两处维度不同、口径互不否定）。spec §9.6.9「明确不做与 keptOpen（裁决 g）」明列的 keptOpen 项与实现对齐：CLI source 透传（§9.6.9 条 7，附录 C 第 2 条）、输出设备选择（条 3，OQ-2）、手机端播报与 mic 入口（条 4，§8.2/§9.4，TV-7 前置勘察未做）、TV-8 默认厂商连通性 spike（§9.6.9「新增 open 条目」表）。「对齐」的判定依据与推理链：keptOpen 按 spec 裁决**不应实现**，「对齐」= 实现侧未出现违反裁决的半成品——可 grep 证据为 renderer 零处引用 `VOICE_INPUT_SOURCE_KIND`（常量定义于 `packages/shared/src/contracts/voice.ts:16`、消费在 CLI/wire 侧 input-intent 契约，修订轮 grep `packages/ui/src` 零命中），即「renderer 不携带 source、CLI-first 顺序门禁维持」与 spec 附录 C 第 2 条「未实施、维持」一致；输出设备选择与手机端未发现越界实现代码（审查人核验）。

附带 2 条 low 级维护性建议（**均未复核**，不影响完整性判定）：

1. **层③接线注释与实现相反（low，未复核）**：`useVoiceDictation.ts:203` 与 `voiceCommandBus.ts:9-11` 注释仍称 cancelTask 由 planner 按播报腿活动态 gate，实际 `turnSpeechPlanner.ts:706-711` 已改为无条件分发（多 pane 双发由 handleStop canStop 守卫 + guard.stopTargetChanged 防误杀）。注释漂移误导维护，非行为缺陷。
2. **`toolBriefPlanner.resetTurnCounters` 是死 API（low，未复核）**：接口文档称「wiring 会话/轮次变更时清 per-turn 计数」但 wiring 零调用，`announcedCountByTurn`/`seenToolCallIds`/`lastBriefAtByTool` 随会话内工具调用数无界增长（仅内存面；spec §4.2 规则 6「每 turn ≤6 条」的计数仍正确执行——规则编号按 spec §4.2 原文，即上文矩阵 #12 所列六条中的上限规则）。

---

## 三、音色选择深查

### 3.1 现状链路（实现自洽，有单测钉住）

```
设置面自由文本 Input (VoiceSection.tsx:354-367, placeholder=「系统默认」)
  → voiceAnnouncementVoice 键（appSettings）
    → reader 收口 (voiceComposerEntryState.ts:41-53，空=系统默认)
      → planner getAnnouncementVoiceConfig (useVoiceAnnouncement.ts:266-269)
        ├─ system 引擎：speechSynthesisTtsAdapter.ts:111-119
        │    按 candidate.name === u.voice 精确匹配；失配 → voice.tts warn + 回落系统默认（单测钉住）
        └─ cloud 引擎：cloudTtsAdapter.ts:179-181
             body.voice 直传（厂商音色 id，spec §9.6.5-1 明文「复用既有 voiceAnnouncementVoice」）
```

- 语速数值契约：**设置域 0.5–2.0 在 zod（`validationAppSettings.ts:535`）与 reader（`voiceComposerEntryState.ts:51`）两处一致（界外回落 1），云 TTS 端点钳制 0.25–4（`cloudTtsAdapter.ts:66-72`）全覆盖设置域——「域内一致、端点更宽」，非三处同值。**
- i18n 键 `voice.settings.announcement.voice`（label/default 两键）zh/en 成对存在，与 spec §6.3 清单（本就只列两键）一致，`voiceI18n.test.ts` 三断言实跑通过（修订轮复跑 3/3）。

### 3.2 缺口清单（逐条标注类型）

| # | 缺口 | 级别 | 复核状态 | 定性：实现遗漏 vs spec 未定义的需求缺口 |
|---|------|------|----------|------------------------------------------|
| 1 | 设置面音色为盲填自由文本：无系统音色枚举下拉、无按语言过滤、无试听按钮，用户无从得知合法音色名；控件无 data-testid、无 description 行（对照同页其他控件） | medium | **复核成立**（复核人亲自核到 VoiceSection.tsx:354-367、getVoices 设置面零消费、spec §6.1 开关3（只定义键名/默认值）与 §9.3 交付物文件表（VoiceSection 行只列「播报开关/音色/语速 + 输出设备披露」，未定义控件形态）；「实现与 spec 自洽，缺口确在 spec 层」定性准确） | **spec 未定义的需求缺口**（§6.1 只定义键名/默认值，§9.3 只写「音色」二字；§6.3 键清单本就无 .description/.placeholder） |
| 2 | speechSynthesis 音色列表异步加载语义未处理：全仓无 voiceschanged 监听，getVoices 仅 speak 时同步取一次；Windows/Chrome 首次 getVoices() 返回空数组的平台行为下，早期播报按「音色名失效」warn 静默回落系统默认 | low | 未复核（审查人 grep 实跑零命中为据；修订轮 grep `packages/ui/src` 旁证：getVoices 仅端口声明 `speechSynthesisTtsAdapter.ts:36`、生产调用 `:112`、测试 mock `speechSynthesisTtsAdapter.test.ts:39`，无 voiceschanged、无设置面消费） | **spec 未定义的需求缺口**（§6.1/§9.3 未提及列表加载语义；有兜底不崩溃，且首次播报通常晚于页面加载——**此为推断而非实测**，Windows/Chrome 首播 getVoices 空数组回落的实际触发率本轮未评估，若实测触发率高可升档，故 low） |
| 3 | 云 TTS voice 复用 voiceAnnouncementVoice 且零校验直传：同一键在 system/cloud 两引擎下分属两个命名空间（系统音色名 vs 厂商音色 id），错配 → 厂商 4xx → 连续 3 句失败（voiceTuning.ts:43）→ 中止本轮 + 会话内静默回落系统引擎，UI 零反馈（notice 机制只在听写腿） | medium | **复核成立**（复核人独立追通全链路，确认实现逐字遵守 spec §9.6.5-1 的复用决策（`voice=u.voice ?? 缺省`，原文引 :790 实为该条所在行）、失败回落语义在 §9.6.5-3、UI 零反馈属实、spec §10 open 条目无一覆盖此缺口） | **spec 未定义的需求缺口**（§9.6.5-1 已定义「复用」映射本身；厂商侧合法性校验/提示深度未定义，附录 D.11 也未抓取厂商音色枚举值） |
| 4 | 播报语言（utterance.lang）来源未定义：实现取 UI locale（useVoiceAnnouncement.ts:266-269），voiceDictationLang 仅喂 ASR，语言选择与音色/播报零联动；跨语言会话（UI=en-US 播中文回复）时音色/语言可能错配 | low | 未复核 | **spec 未定义的需求缺口**（§2.3 端口只写 lang: string 无来源语义，§6.1 键 5 明确是「听写语言」；实现与 spec 一致非偏差） |
| 5 | 语速控件为受控 number Input 无草稿态：越界/中间态输入被拒后 DOM 显示值与持久值可短暂背离，与同页 baseUrl 的 draft+onBlur 模式不一致 | low | 未复核 | **建议级体验 nit**（数值契约无缺陷——设置域 0.5–2 两处一致、端点 0.25–4 全覆盖，见 3.1；非缺口亦非遗漏） |

**深查结论：5 个缺口中零条是实现遗漏——基础链无缺陷；其中 4 条（#1–#4）源于 spec 未定义控件形态、枚举/试听、校验与语言联动语义，#5 为建议级体验 nit（非缺口亦非遗漏）。** 需求缺口中最有实际用户影响的是 #1（盲填不可发现）与 #3（云引擎错配静默降级且无 UI 反馈），两条均已复核成立。

---

## 四、角色设置判定

### 4.1 存在性结论

**missing-in-spec：角色设置（persona）不存在，且属需求层面未定义，非实现遗漏。**（low，未复核；审查人五组 grep 实跑为据，范围与问题 2 回答一致：spec 全文 / voice 模块 / VoiceSection / 两份 locale / ui+shared src）

- spec `voice-agent-integration.md` 全文零 persona/角色/character 概念；
- voice 模块 + VoiceSection + 两 locale 零命中（唯一 role 命中是 `DictationPreviewOverlay.tsx:58` / `AnnouncementIndicator.tsx:37` 的 ARIA `role="status"`，无障碍属性非概念；唯一「角色」命中是 team.stagedEditor/subagents/桌面宠物三条无关文案）；
- `voicePersona`/`voice.character`/`voice.persona` 于 ui/shared src 零命中。

### 4.2 若要做的建议清单（均为**需求建议，非缺陷**；实现前须先补 spec）

1. 角色 = 音色 + 语速 + 语言的预设组合（依赖第三节缺口 #1 的音色枚举先落地）；
2. 角色名与播报开场白/称呼模板：i18n 双语，走 `voice.*` 命名空间并入 voiceI18nKeys 清单三断言守护；
3. system/cloud 双引擎下同一角色双轨音色映射（各配一个合法音色 id，顺带解第三节缺口 #3 的命名空间冲突）；
4. 明确角色是否影响打断词表（§4.5 词表现按 locale 维度，角色维度叠加与否需产品拍板）；
5. 角色切换生效时机对齐 §9.6.5-2 既有引擎解析点（设置变更=下一解析点生效，不建第二事件流）；
6. 持久化走 appSettings additive 键 + VOICE_SETTINGS_KEYS 常量区单一出处（对齐 §6.1 键表与 contracts/voice.ts 模式，且 parity 单测自动覆盖）。

**归属说明**：persona 不在 spec Phase 1/Phase 2/Phase 3（§9.5 Phase 3 为音频留档与实时双工 sidecar、条件触发另立 spec）任何清单内，「是否进 Phase 2」是开放产品拍板项，与本节六条建议一并决策（见 7.2）。

---

## 五、规范符合结论与新发现

### 5.1 五维复核结果（规范符合 lens，守护测试 38 项实跑全过；38 项与三批 246 项的账目关系见 5.4——已确认至少重叠 16 项，两者不相交相加不成立）

| 维度 | 结论 | 要点 |
|------|------|------|
| i18n 双语语音键 | complete | zh/en 各 61 键全等、占位符同构（node 脚本实测差集空）；voiceI18nKeys 清单与字典全等；JSX 零裸中文；voiceI18n.test.ts 三断言通过 |
| 契约键单一出处 | complete | VOICE_SETTINGS_KEYS(12 键)/VOICE_VENDOR_CREDENTIAL_KEY/claim 键/TID_VOICE_ANN_STOP/input source kind 全链 git grep 无散落字面量（消费方全引常量；测试文件字面量属刻意值守护） |
| 设置校验 parity | complete | validationAppSettings 十二 voice 字段与 VOICE_SETTINGS_KEYS 值集全等；contract.test.ts 13 tests 实测通过（含 persisted+patch 双 schema parity） |
| 日志规范 | **partial** | 7 个 voice 模块文件统一 `logger` scope voice.asr/voice.tts/voice.entry；生产代码 console 零命中；warn 只落错误形状与 HTTP status 不落 URL 查询串/凭据/音频，debug 级只记 len 不记原文。**扣分项：测试文件 3 处 DEBUG console.error 残留（见 5.2 #1）** |
| DESIGN.md token 与 a11y | complete | 硬编码色值零命中，全用 border-border/text-warning/bg-surface 等主题 token；aria-label 全覆盖（mic 另带 aria-pressed）；Esc 仲裁纯函数+单测。a11y 面另有 1 条未复核 low 建议（tabIndex=-1，见 5.2 #2），按 spec §5.2 设计依据判建议不算缺陷 |

### 5.2 新发现

1. **测试文件残留三处 DEBUG console.error 调试输出 —— medium，复核成立。** `useVoiceAnnouncement.wiring.test.ts:249-256`（"DEBUG wiring:" + JSON.stringify）、`:414`（"DEBUG-A:"）、`:424`（"DEBUG-B:"），均在 it() 体内无条件执行。复核人实跑 `pnpm exec vitest run src/voice/useVoiceAnnouncement.wiring.test.ts`（于 `packages/ui` 内按文件相对路径）确认每次运行向 stderr 输出调试 JSON（11 用例全过）；`git log -S` 归属 HEAD 提交 6d754098（Phase 2）引入，非更早残留。违背 AGENTS.md「UI 不直接使用 console」规范精神。**判定：应清理后再合并。**
2. **听写预览条「清除」与 notice「关闭」按钮 tabIndex=-1（low，未复核）**：纯键盘用户无法 Tab 触达。有 spec §5.2 设计依据（预览条不获焦），且等价键盘路径存在（Esc/再次点按停录音即清空），作 a11y 建议报告，不算缺陷。

### 5.3 全部发现分级汇总（含三路）

| 发现 | 来源 lens | 级别 | 复核状态 |
|------|-----------|------|----------|
| 音色盲填自由文本（无枚举/过滤/试听） | 音色与角色 | medium | **复核成立** |
| 云 TTS voice 复用同一键跨命名空间、错配静默回落且 UI 零反馈 | 音色与角色 | medium | **复核成立** |
| 测试文件 3 处 DEBUG console.error 残留 | 规范符合 | medium | **复核成立** |
| 层③接线注释与实现相反 | 功能面 | low | 未复核 |
| toolBriefPlanner.resetTurnCounters 死 API（内存无界增长） | 功能面 | low | 未复核 |
| voiceschanged 异步加载语义未处理 | 音色与角色 | low | 未复核 |
| 播报语言来源未定义（与听写语言零联动） | 音色与角色 | low | 未复核 |
| 语速控件无草稿态 | 音色与角色 | low | 未复核 |
| 角色设置 missing-in-spec（三处 grep 零概念） | 音色与角色 | low | 未复核 |
| 预览条清除按钮 tabIndex=-1 键盘不可达 | 规范符合 | low | 未复核 |

**复核结果统计：3 条受复核发现全部成立、0 条降级；无 high 级发现。** 复核人还更正了审查记录中的一处 grep 计数描述（关联第三节缺口 #2 的证据行）：原记录称「两处测试命中 getVoices」，实为**一处测试文件**（`speechSynthesisTtsAdapter.test.ts:39` 的 mock）加**一处 dist 构建产物**；该计数更正不改变缺口 #2 的核心主张——生产代码无 voiceschanged 监听、getVoices 仅 speak 时同步取一次、设置面零消费（修订轮 grep `packages/ui/src` 旁证见 3.2 #2 复核状态栏）。

### 5.4 单测实跑命令与账目核对（修订轮补记）

三批 246 项在 voice worktree 根目录（`D:/workspace/projects/drora-voice-agent`）按根级 vitest workspace 配置实跑。修订轮用下列命令全量复跑，计数与「全绿」结论逐一吻合：

| 批次 | 命令（在 worktree 根目录执行） | 修订轮复跑结果 |
|---|---|---|
| voice 模块 188 | `pnpm exec vitest run packages/ui/src/voice` | 21 文件 / 188 tests 全过（5.7s） |
| 契约/设置/拼接 29 | `pnpm exec vitest run packages/shared/src/contracts/contract.test.ts packages/ui/src/settings/VoiceSection.test.tsx packages/ui/src/v4/composer/composerTextAppend.test.ts` | 3 文件 / 29 tests 全过（含 contract 13） |
| Esc/store 29 | `pnpm exec vitest run packages/ui/src/prompt-editor/composerEscapePlan.test.ts packages/ui/src/store/voiceSessionStore.test.ts` | 2 文件 / 29 tests 全过 |

- **38 项守护与 246 项存在重叠，不相交相加不成立**：5.1 点名的 voiceI18n.test.ts（3 断言）属 voice 模块 188 批、contract.test.ts（13 tests）属契约 29 批——即「246 + 38 = 284」高估实跑规模，去重后总数介于 246（若其余 22 项全在 246 内）与 268（若全在外）之间。38 项的完整文件构成未随报告留存，修订轮无法完全对账；已确认重叠的 16 项单独复跑通过（voiceI18n 3/3、contract 13/13）。
- **原始记录归档状态**：三路审查与复核的过程记录（含审查人 246 项的原始运行输出与 38 项守护的清单）未归档入仓，本报告为唯一载体；上表命令与 5.2 #1 的命令均可在 worktree 确定性复现。上轮（2026-10-23）审查报告归档于 `docs/voice-agent-implementation-review-2026-10-23.md`。

---

## 六、E2E 实机证据

**结论不变：实机验证不成立，合入前必须补上。** 修订轮在 `packages/desktop/.e2e-artifacts/` 找回全部四轮工件，前史与第四轮缺口的成因如下（run id 内时间戳为 UTC；工件为证，逐轮列出）：

| 轮 | run id（开始时间 UTC） | 覆盖 | 结局 | 工件完整度 |
|---|---|---|---|---|
| 1 | desktop-e2e-20261024-011855-074（01:18） | voice-composer-entry.test.ts | **prepare 阶段失败**：`build-desktop-agent-cli.mjs` 命令失败，测试从未开始 | 仅 manifest/lifecycle/perf，无 summary |
| 2 | desktop-e2e-20261024-012410-460（01:24） | 同上 | 同一构建命令再次失败于 prepare | 同上 |
| 3 | desktop-e2e-20261024-012754-090（01:27） | 同上，3 例 | **完整跑完：2 过 1 败**。败例「确认披露后入口开关生效，返回 composer 可见（390px 与默认宽度，FD-5 + 几何子集）」，失败类型 Unknown、512ms、worker exit 1，整体 exit 1 | 完整（summary.md/json、test-results、runtime-logs） |
| 4 | desktop-e2e-20261024-013331-793（01:33） | 同上 | prepare 通过（01:35:41 记录）后生命周期**再无任何事件**——worker/测试/汇总阶段从未开始，summary.md **从未生成**（非生成后被清理）；中断原因（进程崩溃或外部中止）工件无法区分 | 仅 manifest/lifecycle(1 条)/perf，无 summary |

第四轮工件读取失败的原证据（保留）：

```
== E2E_LOG_TAIL ==
(no matching lines)
== E2E_SUMMARY ==
ERROR ENOENT: no such file or directory, open
'D:\workspace\projects\drora-voice-agent\packages\desktop\.e2e-artifacts\desktop-e2e-20261024-013331-793\summary.md'
```

据此把原判「该轮 E2E 不能记为通过，也不能记为失败——是证据不可用」修正为：**第四轮 = 证据不可用（运行未完成，summary 从未生成）；且第三轮存在一次完整的实机失败记录（2/3 过、exit 1、败因 Unknown 未定位），从未转绿**——实机层面不是「零证据」，而是「有一次未消化的失败 + 最近一轮未完成」。

**版本绑定限制**：四轮 E2E 均运行于 2026-10-24 01:18–01:35 UTC，早于 HEAD `6d754098` 的提交时间（02:58 UTC / 10:58 +0800），且 manifest 未记录源码 commit（`versions: {}`）、当前工作树干净（中间态已随提交消失）——四轮均**不能绑定到 6d754098 或任何已知源码状态**，第三轮败因不能据此外推到 HEAD，同理也不能据此时序否定其参考价值。

**阻塞口径（统一确认）**：7.1 #4 与 7.3 的「补上实机证据后」是同一要求——**实机 E2E 证据是合并硬性前置**，不是可选动作。需在最终 tip 实机重跑并留存完整工件（含 summary.md），并将第三轮败例定位转绿（或定位为环境问题并记录证据）。**由谁重跑：截至修订轮无人认领**（上轮报告已记「Electron 目标运行时环境当前无人认领」，本轮工件与仓内均无认领记录），此为合并前必须落实的开放项。本报告全部「complete」判定仍基于静态闭环核验与单测实跑（三批 246 项，见 5.4），不以静态审查替代实机验证。

---

## 七、建议的后续动作

### 7.1 该进 PR #30（合并前处理；#1–#3 为小改动，#4 为实机验证动作）

（截至修订轮，`gh pr view 30` 于远端 CavinHuang/Drora 查无此 PR——**PR #30 尚未开立**，以下为其 scope 建议，最终 scope 以开立时为准。）

1. **清理 `useVoiceAnnouncement.wiring.test.ts` 三处 DEBUG console.error**（:249-256/:414/:424）——复核成立 medium，改动零风险，合并前必做。
2. **顺手修正层③接线注释漂移**：`useVoiceDictation.ts:203`、`voiceCommandBus.ts:9-11` 更新为「无条件分发 + handleStop canStop/guard.stopTargetChanged 防误杀」的现实描述——low，纯注释改动。
3. **处置 `toolBriefPlanner.resetTurnCounters`**：要么在 wiring 会话/轮次变更处接线（顺带解内存无界增长），要么删掉死 API 并同步接口文档——low。
4. **在最终 tip 实机重跑桌面 E2E 恢复证据链**（第四轮 summary 从未生成；第三轮有 2/3 过 1 败记录待定位），把实机验证从「证据不可用 + 有失败记录」变为有结论——这是验证动作而非代码改动，分量与第六节「不以静态审查替代」对齐。

### 7.2 需先补 spec 再实现（不建议在 PR #30 内顺手做）

**排期与责任人截至修订轮均未定**（上轮要求的 Electron 运行时认领同样未落实）；下列六项的先后与归属在 spec 补齐轮一并排定。

1. **音色控件形态**（枚举下拉 + 按语言过滤 + 试听预览）→ 先在 spec §6.1/§6.3/§9.3 定义控件形态与新增 i18n 键，再实现；这是其余音色缺口的前置。
2. **云 TTS 厂商音色校验/错配提示** → §9.6.5-1 补校验深度与错配回落的 UI 提示语义；附录 D.11 补抓厂商音色枚举值。
3. **voiceschanged 异步加载语义** → §9.3/§9.6.5 补定义（是否等列表就绪、失配是否提示）；同时补实测 Windows/Chrome 首播 getVoices 空数组触发率，校准缺口 #2 的 low 定级（现为推断）。
4. **播报语言来源语义** → §2.3 端口 lang 定义来源与是否与听写语言联动。
5. **角色设置（persona）** → 全新 spec 章节：先按第四节六条建议拍板产品形态（尤其角色是否影响打断词表、是否进 Phase 2——现不在任何 Phase 清单内），再排实现。
6. （可选）语速控件草稿态对齐 baseUrl 的 draft+onBlur 模式——体验一致性 nit，可与 #1 同批。

### 7.3 一句话裁决

功能本体达标可合（清完 DEBUG 残留、补上 E2E 实机证据后——两项均为合并硬性前置，与 7.1 #1/#4 同一要求，两处口径一致）；音色与角色的所有缺口都是 spec 欠账不是代码欠账——下一轮先把 spec 补到位，再谈实现。**两点需显式拍板而非默认**：① 两条 medium spec 缺口（#1 盲填、#3 云 TTS 错配静默回落）不随 PR #30 修复、延后至 spec 轮——#3 对已配置云引擎的真实用户意味着错配后整轮中止 + 会话内静默降级且 UI 零反馈，该延后是否可接受须由合并决策人确认；② E2E 重跑责任人无人认领，合并前必须落实。

---

*报告由三路审查 + 逐条复核结果汇总裁决生成；所有代码锚点与测试结论引自审查/复核人实跑记录，E2E 证据状态如实标注。*

## 修订记录（2026-10-24，按审读意见修订）

按外部审读意见修订；**裁决与分级结论不变**（21/21 complete、3 条复核成立 medium、0 降级、E2E 实机验证不成立）。修订人在 voice worktree（@ `6d754098`，工作树干净）实际核验：

1. **E2E 前史补全（第六节重写）**：找回 `.e2e-artifacts` 四轮工件——第 1/2 轮 prepare 构建失败、第 3 轮完整跑完 2/3 过 1 败（exit 1）、第 4 轮 prepare 通过后中止（summary 从未生成，非被清理）；四轮均早于 HEAD 提交时间、不能绑定源码状态。原「不能记为失败」表述按第 3 轮工件更正。
2. **单测账目核对（新增 5.4）**：三批 246 项的命令与工作目录固定并全量复跑（188/29/29 全绿）；38 项守护与 246 至少重叠 16 项（voiceI18n 3 + contract 13），「246 + 38」不相交相加不成立。
3. **上轮 6 条 NO-GO 枚举（问题 1）**：F1/F2/S1/S2/C1/S7 逐条附当前代码锚点，修订轮读码/grep 逐条确认修复形态。
4. **口径修正**：语速「三处一致」→「设置域两处一致、端点 0.25–4 更宽」；「5 缺口全部 spec 未定义」→「4 条 spec 缺口 + 1 条 nit」；「partial」加维度限定；grep 计数统一为「五组」（原「三处」与「五组」并存）；spec 裸行号改章节引用并绑定 @ 6d754098（原文 :790 实指 §9.6.5-1）。
5. **行话解码**：「停录音零 v4 stop」「层①零协议」「VOICE_INPUT_SOURCE_KIND 零引用 ⇒ keptOpen 对齐」的推理链在矩阵行与矩阵结论展开；keptOpen 定义引 spec §9.6.9（含 TV-8 open 条目）。
6. **拼写与锚点统一**：getVoices（原 getVoics）；speechSynthesisTtsAdapter 音色匹配统一 `:111-119`；工具简报规则改按 spec §4.2 编号表述（规则 6 = 每 turn ≤6，原压缩清单漏列规则 5）。
7. **开放项显式化**：PR #30 未开立（`gh pr view 30` 查证）；7.2 六项排期/责任人未定；persona 不在任何 Phase 清单、是否进 Phase 2 待拍板；两条 medium 延后需合并决策人确认；E2E 重跑无人认领；缺口 #2 的 low 定级依据标注为推断未实测。
8. 三路审查与复核的过程记录未归档入仓，本报告为唯一载体（见 5.4）；问题 3 回答补充披露 a11y low（tabIndex=-1）。
