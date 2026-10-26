# Drora 语音 Agent 接入 Spec

- 日期：2026-10-22
- 状态：已立项、定稿。本文件是语音接入决策记录的冻结权威，**冻结范围 = 除正文标注「建议，待拍板」的条目与 §10 open/keptOpen 条目之外的全部决策**；`docs/voice-agent-integration-design-2026-10-22.md`（下称「设计报告」）保留为论证基础，其 §1.1 决策总表与 §1.2 不做清单自本文件起视为冻结，冲突处以本文件为准。
- 输入材料：设计报告（含附录 A 评审落实对照、附录 B 核验记录）+ 2026-10-22 待决点清单（14 项 extraGaps + 17 项 items）+ 2026-10-22 定稿评审（3 项矛盾消解、4 项补充缺口、1 项行号纠错；裁决记 FD-1~FD-7，见附录 A）。逐条裁决见附录 A。
- 证据约定：文中 `path:line` 为 2026-10-22 在本仓检出源码上实际读取核验所得（本核验记录见附录 B）；引用自设计报告前期勘察且本轮未复验的行号一律标注「未复验」。本 spec 为 spec 先行交付物，实现未开始，不含任何实现代码。

---

## 1. 背景与形态选型决策记录

### 1.1 形态路线（冻结）

**Phase 1 = A+B（端上 ASR 听写 + 轮尾 TTS 播报，全部 renderer 侧，零协议音频）→ Phase 2 = D 的事件语义（voice 来源契约、三层打断映射、任务运行中语音 steer/queue）→ Phase 3 = 完整 D 音频旁路（条件触发）。跳过 C（语音 peer 会话），不做 E（端到端 S2S）。**

依据（继承设计报告 §2，本 spec 采纳为冻结决策）：

1. D 所需的四项运行时预留 Drora 已全部具备，无需任何协议面预留：
   - **常驻会话**：CommandInbox 串行 admission + per-session FIFO + session resident pool；
   - **运行中指令注入**：turn-loop guide drain（`apps/drora-cli/packages/core/src/runtime/methods/turn-loop.ts:57-72`，本轮核验 `drainPendingRuntimeCommandsForActiveLoop` 与 `drainedSteerForNextRequest` 消费点）；
   - **三层取消**：foreground controller → turnAbortScope → call-runner AbortSignal 贯通 + stop 带 `expectedForegroundExecutionId` 防误杀（命中即 `throw new V4CommandNoopError("guard.stopTargetChanged")`，`session-flow.ts:346` 本轮核验）；
   - **进度事件**：SessionEventType 全集经 conversation topic 按 30ms/150ms profile 分发（`packages/shared/src/drora-protocol-v4/core.ts:35-60` `DELIVERY_PROFILES` 本轮核验：continuous `flushWindowMs:30, toolProgress:false`；replayable `flushWindowMs:150, toolProgress:true`）。
2. C 的存在理由（绕过常驻化改造）在 Drora 不成立；旁路会新开第二条输入面，与「turn 循环内 guide drain 是唯一内联插话机制」冲突，且与 admission 幂等（同 commandId 幂等 + settled LRU）打架。
3. E 放弃产品核心（工具生态/权限/owner/lease/审计全在文本侧）换对话体验天花板，上游对齐约束下属重依赖决策，无对应需求。
4. always-listening 后台监听不做（隐私红线）；语音自动提交与权限语音 allow Phase 1 均不做（防误发/防误授权，开放问题 OQ-4）。

### 1.2 relay rpc-frame 信封 1MiB 修正（评审 wrongClaims #1 落定）

设计报告已修正、本轮逐项复核属实：

| 常量 | 值 | 位置（本轮核验） |
|---|---|---|
| relay rpc-frame 信封上限 `MAX_PHYSICAL_FRAME_BYTES` | **1MiB**（缺省，无生产方 override） | `packages/relay-client/src/clock.ts:7`、`rpcFrameChannel.ts:71`（`maxEnvelopeBytes ?? MAX_PHYSICAL_FRAME_BYTES`） |
| 16MiB 的真正归属：v4 wire 层 `logicalFrameAssemblyMaxBytes` | 16MiB | `packages/shared/src/drora-protocol-v4/core.ts:67`（设计报告行号本就正确；本 spec 初稿漂移表误记「实际 :69」——:69 实为 `logicalFrameAssemblyMaxConcurrent: 32`，定稿轮复核纠正，见附录 B） |
| 高水位 `RELAY_SATURATION_HIGH_WATER_MARK_BYTES` | 1MiB | `packages/shared/src/relay-wire/constants.ts:9` |
| 重放缓冲 / 宽限 | 8MiB / 45s | 同文件 :13 / :15 |

修正后的论据**更强**：持续音频流会在秒级写满 1MiB 信封与高水位，随后写满 8MiB 重放缓冲触发 `RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED`，把文本控制面一起拖垮。故**不新增音频帧通道、不启用 binaryFrames（两处 hello 硬编码 false、无物理载体）、不新增 clientMode（`.strict()` 握手整条拒收老 Host 未知值）**。Phase 1/2 音频不过 relay、不过 v4 wire；Phase 3 音频走 Host 内 sidecar（照 `packages/desktop/src/host/remoteMediaPreviewProxy.ts` lease+TTL+并发上限先例，存在性本轮核验），届时独立 spec。

### 1.3 明确不做清单（Phase 1/2，冻结）

1. 无音频帧通道、无 WebRTC/实时音频栈（Phase 3 条件另议，音频不过 relay/v4 wire）。
2. 不启用 binaryFrames 能力位（启用即空承诺）。
3. 不新增 clientMode。
4. 无 always-listening、无后台监听；麦克风仅显式点按后开启。
5. 无语音自动提交：final 转写必经 composer 人工发送（OQ-4 跟踪）。
6. 无权限语音 allow：语音对权限请求 Phase 1 只播报不消费；Phase 2 至多 decline/cancel（待决策），allow 必须点按。
7. 无三层打断之第②层（按播放位置截断上下文）：CLI 无原语（`cancelled-stream-persistence.ts:16-17`「只 flush 已经到达本进程的 text/reasoning」本轮核验；实现 :37-53 只落快照内已有 text/reasoning）。开放问题 OQ-1/TV-2。
8. CLI 不承载 UI 语义：durable intent 只固化 `source={kind:"voice"}` 数据事实；「来自语音」等文案全部在 renderer i18n。
9. 自研代码不进还原目录、不内联进 `ConversationComposer`（2900+ 行收口文件）、不进 CLI runtime；`ChatPromptEditor` 保持纯 props 壳，语音态经 props 注入。

---

## 2. 契约与接缝

### 2.1 `packages/shared/src/contracts/voice.ts` 常量区（逐键清单）

照 `packages/shared/src/contracts/desktopPet.ts` 先例（对象常量 + 嵌套 channel 命名，本轮核验其结构）。**契约键单一出处**：以下字面量只在此定义一次，生产方与消费方引用同一常量；改名任何一侧前全链 grep 生产与消费（AGENTS.md）。

```ts
/** wire 契约：input-intent source kind 字面量。input-intent.ts 的 schema 以
 *  z.literal(VOICE_INPUT_SOURCE_KIND) 引用，禁止两处独立写字面量。 */
export const VOICE_INPUT_SOURCE_KIND = "voice";

/** appSettings 持久化键（validationAppSettings.ts schema 字段名与此一一对应，
 *  由 parity 单测钉住；见 §6.1）。 */
export const VOICE_SETTINGS_KEYS = {
  composerEntryHidden: "voiceComposerEntryHidden",
  announcementEnabled: "voiceAnnouncementEnabled",
  announcementVoice: "voiceAnnouncementVoice",
  announcementRate: "voiceAnnouncementRate",
  dictationLang: "voiceDictationLang",
  asrEngine: "voiceAsrEngine",
  toolBriefEnabled: "voiceToolBriefEnabled",
  privacyDisclosureAcknowledged: "voicePrivacyDisclosureAcknowledged",
} as const;

/** 跨窗口 claim 键（经既有 BroadcastHub 通用 claim 通道，Main 不解析语义）。 */
export const VOICE_BROADCAST_CLAIM_KEY = {
  announcement: "drora:voice-announcement-claim",
  /** 预留键（FD-7）：Phase 1 零生产/消费方，唯一潜在消费方 EG-7 keptOpen（§10）；
   *  随 EG-7 裁决启用或移除。Phase 0 的 dep:refs 同源断言不覆盖本键（§9.1）。 */
  mic: "drora:voice-mic-claim",
} as const;
```

**明确不进 contracts/voice.ts 的东西**：行为阈值（录音超时、简报限流窗口、claim 续约间隔、lastDictation TTL）是 renderer 行为参数而非跨进程契约键，放 `packages/ui/src/voice/voiceTuning.ts`，调参不牵动 shared 包；打断词表放 `packages/ui/src/voice/interruptionWords.ts`（UI 交互判定，不进 wire）。跨窗口偏好即时广播若 Phase 1b 实测 appSettings 既有同步不满足（跨窗口同步机制现状见 `packages/ui/src/store/codingPlanQuotaResetState.ts:75-85` sourceWindowId 防回环先例），届时再在此补 `drora:voice-preference-sync` 频道键——键先进常量区、消费方后接，避免撕裂。

### 2.2 `voiceInputSourceSchema` additive 扩展与 `.strict()` 偏斜方向

扩展点（本轮核验）：`packages/shared/src/drora-protocol-v4/input-intent.ts:31-47`，`conversationInputSourceSchema` 是 `.strict()` discriminatedUnion，现仅 `pluginUi`（:31-37）/`genUi`（:40-46）两个成员；`conversationInputIntentSchema.source` 已是 optional 字段（:115）。

```ts
export const voiceInputSourceSchema = z
  .object({
    kind: z.literal(VOICE_INPUT_SOURCE_KIND),
    /** BCP-47；听写发生时的 locale 快照（诊断面，不参与路由）。 */
    lang: z.string().min(1).max(35).optional(),
    /** 引擎标识；新增引擎 = additive 追加枚举成员，同样遵守 CLI 先行。 */
    engine: z.enum(["webSpeech", "remote"]).optional(),
  })
  .strict();
// 追加进 conversationInputSourceSchema 的 union 成为数组第三项。
```

**偏斜方向（关键，冻结）**：schema 是 `.strict()` discriminatedUnion，旧 CLI 收到 `kind:"voice"` 会整条拒收 sendText。落地顺序必须 **CLI 先行**（schema + admission 固化 + source 数据随既有投影面下发先合入，无任何文案），renderer 在 CLI 具备后才携带 source；灰度期内听写照常以纯文本发送（source 本就 optional），功能不受影响。方向是 **CLI→renderer，不可倒置**。偏斜安全先例：`packages/shared/src/drora-protocol-v4/transport.ts:355-356`「新方法天然偏斜安全——旧桌面根本不会调用它」（本轮核验）。不引入运行时探测/降级重发分支——桌面同仓同发 CLI，顺序门禁（PR 依赖声明）足够。

**固化不变量**：source 在 admission/drain 边界一次性写进 durable session_input 账本（`apps/drora-cli/packages/core/src/runtime/methods/input-intent-persistence.ts:5-9` 头注「在 admission/drain 边界一次性固化，后续消费者只能读取，不能重新猜测」本轮核验）；恢复后 renderer 按 `intent.source` 投译卡片文案。CLI 侧改动 = sendText 参数→intent 固化路径纳入 source（既有 `source` 字段透传不剥离）+ 投影面下发，Phase 0 实现时按 `session-flow.ts` 的 sendText admission 现状读码定位，schema 之外零新协议概念。

### 2.3 ASR/TTS 端口与播报规划器接口签名（签名级，不写实现）

```ts
// packages/ui/src/voice/voiceAsrPort.ts
export type VoiceAsrErrorCode =
  | "not-allowed" | "service-not-allowed"   // 权限 → 提示 + 设置引导
  | "network"                               // 网络 → 保留已注入文本 + 提示
  | "audio-capture"                         // 设备 → 设备检查提示
  | "aborted" | "no-speech";                // 同静音超时处理

export interface VoiceAsrStartParams {
  lang: string;        // BCP-47，跟随当前 locale，不硬编码（现状 speech-input.tsx:90 硬编码 en-US）
  hints?: string[];    // 打断词等偏置词，引擎支持时使用
}

/** 一次录音会话；端口实现负责 getUserMedia 约束
 *  { echoCancellation: true, noiseSuppression: true, autoGainControl: true }（全仓首批，现状 grep 零使用）。 */
export interface VoiceAsrSession {
  /** 手动停止（点按/Esc）：等待最终结果，resolve final 文本（可能为空串）。 */
  stop(): Promise<{ final: string }>;
  /** 丢弃式停止（错误/超时/绑定会话关闭）：不产生 final。 */
  abort(): void;
}

export interface VoiceAsrPort {
  isSupported(): boolean;
  /** 授权失败/引擎不可用 throw VoiceAsrError(code)。 */
  start(params: VoiceAsrStartParams): Promise<VoiceAsrSession>;
  /** partial 订阅；返回退订函数。partial 只进预览条（§5.1），永不上协议。 */
  onPartial(cb: (text: string) => void): () => void;
}
```

```ts
// packages/ui/src/voice/voiceTtsPort.ts
export interface VoiceTtsUtterance {
  text: string;
  lang: string;
  voice?: string;   // 系统音色名；缺省 = 系统默认
  rate?: number;    // 语速倍率，缺省 1
}

export interface VoiceTtsHandle { readonly utteranceId: string; }

export interface VoiceTtsPort {
  /** 单句合成播报；排队/分句策略归规划器，端口不排队。 */
  speak(u: VoiceTtsUtterance): VoiceTtsHandle;
  /** 无参 = 全停（点按播报指示停止按钮立即，任何状态含 uninterruptible 段——层①载体消歧见 §3.3 FD-1）。 */
  cancel(): void;
  /** 句边界推进回调（引擎支持 onboundary 时）；返回退订函数。
   *  reason="error" 时实现必须吞异常并落 voice.tts warn（照 taskNotificationSound.ts:19-42 吞 autoplay 异常先例）。 */
  onDone(cb: (handle: VoiceTtsHandle, reason: "end" | "cancelled" | "error") => void): () => void;
}
```

```ts
// packages/ui/src/voice/turnSpeechPlanner.ts —— 播报规划器
/** 只作 conversation 投影的消费者：轮尾正文取 ConversationTurnGroup 聚合同源
 *  （assistantTextRows，照 packages/ui/src/v4/assistantPreviewCards.ts:19-37 的
 *  join("\n\n") 聚合（join 链在 :34-37），与 assistantCopyText/复制文本一致），不建第二事件流、不建第二状态源。 */
export interface TurnSpeechPlannerDeps {
  getFocusedTurnTail(sessionId: string | null): { turnId: string; text: string } | null;
  tts: VoiceTtsPort;
  claim: VoiceAnnouncementClaimPort;
  isAnnouncementEnabled(): boolean;   // 照 taskNotificationPreferences.ts:33 reader 收口先例
}

export interface TurnSpeechPlanner {
  /** focused 会话轮尾终态就绪（TurnComplete）时调用；内部判定 claim/互斥/顺延规则。 */
  consumeTurnTail(turnTail: { turnId: string; text: string }): void;
  /** 输入腿进入 Recording：当前句播完即停（句粒度，§4.7 裁决）。 */
  notifyUserRecordingStarted(): void;
  /** 输入腿退出 Recording：轮尾仍最新 → 句边界续播；已更新 → 作废只播最新。 */
  notifyUserRecordingEnded(): void;
  /** 点按播报指示停止按钮（层①载体，非 TID_V4_STOP——§3.3 FD-1）：任何播报态（含 uninterruptible 段、AnnPaused）立即 cancel 回 AnnIdle，不取消任务。 */
  notifyStopPressed(): void;
  /** ASR final 命中打断词表：层①停播报不续播（uninterruptible 段外）。 */
  notifyInterruptWordHit(): void;
  /** 「停掉任务」命中：层③，发既有 v4 stop（带 expectedForegroundExecutionId）。 */
  requestCancelTask(): void;
}
```

```ts
// packages/ui/src/voice/voiceAnnouncementClaim.ts —— 单播报者 claim（经既有 BroadcastHub 通用 claim 通道）
export interface VoiceAnnouncementClaimPort {
  /** reserve+commit；false = 他窗持有。key = VOICE_BROADCAST_CLAIM_KEY.announcement。 */
  acquire(key: string): Promise<boolean>;
  /** 续约；false = 已被抢，调用方必须立即 tts.cancel() 回 AnnIdle（以 claim 为准校正本地态）。 */
  renew(key: string): Promise<boolean>;
  release(key: string): void;
}
```

### 2.4 `ComposerTextInsertRequest.mode="append"`（UI 包内部 additive，非 wire）

扩展点（本轮核验）：`packages/ui/src/store/droraSessionStoreTypes.ts:127-139`，`mode?: "replace" | "prepend-if-missing"`（:131），`targetSessionId` 消费门注释「主/辅 pane 可同时 focused，按会话定向保证单一消费者」。

- `mode` 增 `"append"`：正文为空 → 直接写入；正文非空且尾字符非空白 → 先补一个空格再追加（确定性规则，避免中英混排粘连；不覆盖用户已编辑内容）。生产方 Phase 1 仅语音。
- 同批适配 `SessionPane` 消费门匹配函数（按 `(targetSessionId ?? null) === (sessionId ?? null)` 既有匹配 + mode 分支），含单测「拼接不覆盖用户编辑」。

### 2.5 接缝清单（全部本轮核验存在）

| 接缝 | 位置 | 用途 |
|---|---|---|
| 听写逻辑先例（只复用逻辑、重写 UI） | `packages/ui/src/components/ai-elements/speech-input.tsx`（:90 lang 硬编码 en-US、:151-153 handleError 静默关闭、:287-303 裸色样式——三者均为本设计要修复的现状，无消费方） | WebSpeechAsrAdapter 逻辑来源 |
| 输入来源契约扩展点 | `input-intent.ts:31-47` | §2.2 |
| 定向注入消费门 | `droraSessionStoreTypes.ts:127-139` | §2.4、§3.4 |
| composer 按钮插槽 | `packages/ui/src/prompt-editor/ChatPromptEditor.tsx:65/:119`（leadingActions）、:67/:127（betweenCancelAndSubmitAction）、渲染点 :424/:450 | mic 按钮进 leadingActions |
| Esc 仲裁先例 | `packages/ui/src/v4/composer/escapeStop.ts:1-24`（dialog 路径忽略判定）、`ChatPromptEditor.tsx:226`（Esc→onCancel） | §4.4 键位仲裁 |
| 入口默认隐藏哲学 | `packages/ui/src/hooks/useCuaComposerEntry.ts:70-73`（`!== false` 判定 + 防闪烁注释）、:35-36（isWebRemoteControl） | §6.1 入口开关 |
| 轮尾文本聚合同源 | `packages/ui/src/v4/assistantPreviewCards.ts:19-37`（export :19，join("\n\n") 链 :34-37） | §4.1 播报内容 |
| 跨窗口 claim 先例 | `packages/desktop/src/main/broadcastHub.ts:24-25`（TTL 5000ms / retry 250ms）、:82-92（窗口关闭清理 reserved、commit 保留 + 过期清理） | §3.5 |
| 偏好 reader 收口先例 | `packages/ui/src/lib/taskNotificationPreferences.ts:33`、`taskNotificationSound.ts:19-42` | §6.1、§7.1 |
| 契约常量先例 | `packages/shared/src/contracts/desktopPet.ts` | §2.1 |
| appSettings 持久化先例 | `packages/shared/src/validationAppSettings.ts:527/:650`、`packages/shared/src/protocol.ts:293` | §6.1 |
| 权限自动处置先例 | `packages/ui/src/hooks/useTaskInteractionAutoResolutionSnooze.ts`（存在）、`packages/ui/src/v4/V4InteractionDialogs.tsx`（存在） | §4.6 |
| Host 内旁路先例 | `packages/desktop/src/host/remoteMediaPreviewProxy.ts`（存在） | Phase 3 |
| 停止按钮（层③既有面，**非层①载体**——FD-1） | `packages/shared/src/test-ids.ts:594` `TID_V4_STOP`、`packages/ui/src/v4/ConversationComposer.tsx:1442`（`canStop && !hasDraftToSubmit` 渲染条件）、:2504-2505（onClick=handleStopClick→onStop）、`packages/ui/src/v4/SessionPane.tsx:4594`（`handleStop("button")`，:5435 接线） | §4.3 层③、§3.3 FD-1 消歧 |
| 音频附件类型（Phase 3 才用） | `packages/shared/src/drora-task-types-core.ts:245/:274` `DroraPromptAudioAttachment` | Phase 1 不做音频附件发送 |

---

## 3. 状态所有者与状态机

### 3.1 状态所有者表（单一所有者，无第二写路径）

| 事实 | 所有者 | 说明 |
|---|---|---|
| partial/final 转写、录音态、绑定会话、lastDictation 暂存、ASR 错误态 | renderer `voiceSessionStore`（`packages/ui/src/store/voiceSessionStore.ts`，落 store/ 目录照 AGENTS.md 约定与 `composerAttachmentUploadStore` 先例，不做 feature-colocation 豁免） | 局部事实，不进协议；partial 亦不进 composer 正文 |
| 播报腿（annState、当前句序号、播报 claim 持有、uninterruptible 段标记） | 同上 | 纯 UI 态，不进 CLI 账本；跨窗口仲裁见 §3.5 |
| composer 正文 | Composer（唯一写入 = composerTextInsertRequest 通道，含 targetSessionId 消费门） | 语音生产方不绕过 requestId 版本号；final 文本自动随既有草稿机制持久化 |
| 会话事实（admission/queue/busy） | CLI CommandInbox | 语音=文本同路，无快速通道；partial 不逐条过 admission |
| busy 权威 | snapshot.control.canStop | 播报门禁复用，不另设 busy 判定（useCuaComposerEntry.ts:36 注释先例） |
| 偏好（§6.1 八键） | appSettings（validationAppSettings schema）+ reader 函数收口 | 跨窗口广播照既有机制，sourceWindowId 防回环（codingPlanQuotaResetState.ts:75-85 先例） |
| ASR final 输入事实 | CLI durable intent（source 一次性固化，无文案） | §2.2 |
| 音频 buffer | **禁入任何 store** | 录音结束即弃，零持久化 |

### 3.2 两条腿状态机（按本 spec 裁决更新）

原设计报告单张状态机把 Recording 与 Speaking 画成串联态，无法承载互斥规则。修订为**两条腿**，由 `voiceSessionStore` 单实例持有，互斥规则表（§3.3）链接。

**输入腿（听写）**——相对设计报告的更新：新增「绑定会话关闭」强制出边（EG-6 裁决）：

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> RequestingMic: 点按 mic（绑定 = 入口所在会话；同会话已有录音腿则 no-op）
    RequestingMic --> Idle: 拒绝(提示+设置引导) / 超时10s / 用户取消
    RequestingMic --> Recording: 授权
    Recording --> Injecting: final 转写（手动停止/静音 endpointing；命中打断词表则改走打断命令，见 §4.5）
    Recording --> Idle: Esc（无更高优先消费者时最高优先） / 静音超时(空转写) / ASR 错误(保留已得文本+提示)
    Recording --> Idle: 绑定会话关闭/卸载（强制停，partial 丢弃，轻提示 voice.dictation.sessionGone）
    Injecting --> Idle: 注入请求已发出（乐观, mode=append, targetSessionId=绑定会话）
    Injecting --> Idle: 注入未达（消费门不匹配/绑定会话消失）→ lastDictation 暂存 + 入口菜单「恢复上次转写」（FD-4：mic 右键/长按）
    note right of Recording: partial 仅进听写预览条；正文不写入；指示常驻显示绑定会话名
```

**播报腿（TTS）**——相对设计报告的更新：AnnPaused 暂停/续播定为**句粒度**（EG-9 裁决，§4.7）；Speaking 进入条件含「持 claim 且未被他窗抢走」；claim 续约贯穿 AnnPaused（FD-2，§3.5）；停止面按 FD-1 消歧（§3.3）：

```mermaid
stateDiagram-v2
    [*] --> AnnIdle
    AnnIdle --> Speaking: focused 会话轮尾就绪 & 播报开 & 持播报claim & 输入腿≠Recording
    Speaking --> AnnPaused: 输入腿进入 Recording（当前句播完即停，记已播句序号；点按播报指示停止按钮不受此约束）
    AnnPaused --> Speaking: 录音结束 & 轮尾仍最新 & claim 仍持有（renew=false 已先回 AnnIdle；自下一句边界续播）
    AnnPaused --> AnnIdle: 录音中点播报指示停止按钮 / 打断词命中 / 轮尾已更新（作废；「改播最新」待录音结束经 AnnIdle→Speaking 发生，非本边即时改播）/ renew=false（claim 被抢，作废续播意图）
    note right of AnnPaused: AnnPaused 是持约态非释放点：claim 照常每 2s 续约（§3.5-1，FD-2）
    Speaking --> AnnIdle: 播完 / 点播报指示停止按钮（任何播报含 uninterruptible 立即）/ 打断词命中（uninterruptible 段外）/ claim 被他窗抢走（renew=false 立即 cancel）
    Speaking --> Cancelling: 「停掉任务」短语命中（既有 v4 stop + expectedForegroundExecutionId）/ 任务被任何停止面取消（TID_V4_STOP、Esc 停止生成——播报同步静音，§3.3 FD-1）
    Cancelling --> AnnIdle: TurnComplete(cancelled) / 超时5s兜底（voice.tts warn，取消结果未知，UI 回落显示任务实际状态）
```

### 3.3 互斥与裁决规则表（冻结）

| 规则 | 内容 |
|---|---|
| Recording 优先 | 输入腿 Recording 时播报腿不得处于 Speaking；已在播 → 当前句播完即停入 AnnPaused（句粒度，§4.7） |
| 顺延规则 | Recording 期间轮尾就绪 → 不立即播；录音结束时该轮尾仍最新 → 从句边界起播；期间已更新 → 作废旧轮尾只播最新。不排队多轮 |
| 停止面消歧（FD-1） | 两个停止面语义不同、永不合并：① **播报指示停止按钮**（AnnouncementIndicator 内，Phase 1b 新增，test id `TID_VOICE_ANN_STOP`）= 层①——任何播报态（含 uninterruptible 段、AnnPaused）点按立即 `tts.cancel()` 回 AnnIdle，零协议、不取消任务；轮尾正文播报（主场景：TurnComplete 后 canStop=false、`TID_V4_STOP` 不渲染）的唯一静音载体。② **`TID_V4_STOP`** = 既有 v4 stop（层③取消任务），渲染条件 `canStop && !hasDraftToSubmit`（ConversationComposer.tsx:1442）与点击链（:2504-2505 → SessionPane.tsx:4594）零改动，不挂任何语音逻辑；权限播报恰逢任务运行（canStop=true）时点按 = 取消任务 + 播报同步静音（经 Cancelling 边，§3.2），不为「只静音」改其语义。物理输入永远压倒语音通道 |
| uninterruptible 界定 | 仅约束语音打断词通道（权限内容播报段内语音「停」不生效，防回声与播报正文字误触发）；点按通道不受限 |
| Cancelling 兜底 | 5s 内无 TurnComplete 即回 AnnIdle + `voice.tts` warn。依据：guard.stopTargetChanged 命中是 throw V4CommandNoopError 无 ACK（session-flow.ts:346 本轮核验）；host 崩溃/断连同理 |
| Injecting 乐观 + 暂存 | composerTextInsertRequest 无回执类型（requestId 单向递增）；注入后乐观回 Idle，final 文本暂存 `lastDictation`（TTL 300s），入口菜单「恢复上次转写」（FD-4：mic 按钮右键/长按，§5.4）以新 requestId 重试；绑定会话消失走同一暂存路径 |
| 会话跟随 | 听写绑定 = mic 入口所在会话，录音期间不变；播报跟随 = 当前 focused；切换 focused 停旧播报；非 focused 完成 → 文字+未读徽标既有面，不播不排队 |
| 绑定会话生命周期 | 绑定会话关闭/删除/归档（composer 卸载）→ 强制停录音、partial 丢弃、轻提示；final 未注入的进 lastDictation。主/辅 pane 同会话双 mic 入口：同会话同时只允许一个录音腿，第二点按 no-op 并短暂高亮既有录音指示 |
| 单播报者 | 同 workspace 多窗口经 BroadcastHub claim 仲裁（§3.5），未持有者静默（UI 不出「其他窗口播报中」指示，Phase 1 从简） |
| 打断词 | 词表精确命中 OR en 词数阈值兜底；按 locale 配置 + 第三语言回退 en（§4.5）；命中的 final 不注入 composer |

### 3.4 会话绑定与播报跟随

`voiceSessionStore` 是全局单例，而 `ComposerTextInsertRequest.targetSessionId` 消费门明示「主/辅 pane 可同时 focused，按会话定向保证单一消费者」（droraSessionStoreTypes.ts:127-139 本轮核验）。因此：

- **听写绑定**：`dictationTargetSessionId` = mic 按钮所在 composer 的会话 id，按下即捕获，录音期间不变（含切换 focused）。final 经 `composerTextInsertRequest(targetSessionId=绑定会话, mode="append")` 定向注入——消费门保证单一消费者，**不存在插错会话的路径**。录音中切换 focused：不改绑定，录音指示常驻显示绑定会话名；此时 Esc 停录音（§4.4）。
- **播报跟随**：播报只跟随当前 focused 会话的轮尾正文。非 focused 会话 TurnComplete 不自动播报。focused 切换时正在播旧会话内容 → 立即停播；新 focused 会话若有就绪轮尾则从 AnnIdle 起播。多会话并行 TurnComplete：只播 focused 那个，不排队。

### 3.5 单播报者 claim（含续约与接管语义裁决）

「播放位置/播报中 = renderer 本地态」+ 偏好跨窗口广播，意味着不仲裁时桌面多窗口同 workspace 会叠音。

**机制（照 BroadcastHub 通用 claim 通道，零新协议）**：claim 通道已有 reserve/commit/release 三消息与过期清理（broadcastHub.ts:64-92 本轮核验；`BROADCAST_CLAIM_RESERVATION_TTL_MS = 5_000`、`BROADCAST_CLAIM_RETRY_MS = 250`）。播报 claim 与「完成提示一次性 claim」的语义差异及裁决：

1. **TTL 5s + 周期续约**： Speaking 与 AnnPaused 全程持 claim，每 2s `renew` 一次（约束：续约间隔 < TTL/2；数值初值如此，Phase 1b 多窗口实测后可在 voiceTuning.ts 调）。**AnnPaused 不释放 claim（FD-2）**：录音时长无上限、超 5s TTL 是常态，暂停期不续约会被他窗按规则 2「空窗即抢」抢走，录音结束经 AnnPaused→Speaking 直接续播即双窗叠音，违反单播报者。不用「commit 后永久持有」语义——窗口崩溃会泄漏 claim 导致所有窗口永久静音；TTL 过期即视为主播报者死亡。
2. **空窗即抢**：claim 过期不静默等待，任何窗口 `acquire` 成功即可开播（立即抢占）。不设随机退避（播报开始不是高频竞争面）。
3. **漂移校正以 claim 为准**：`renew` 返回 false（被他窗抢走，Speaking 或 AnnPaused 期间均可能）→ 本地立即 `tts.cancel()` 回 AnnIdle——AnnPaused 被抢则作废续播意图，录音结束后按顺延规则从 AnnIdle 重新竞争，不播「被抢」提示（Phase 1 从简）。
4. **release 时机**：AnnIdle、播报开关关闭、窗口关闭（Composer 卸载）三处 release；AnnPaused 是持约态不是释放点（FD-2）；窗口崩溃依赖 TTL 过期兜底。
5. mic 跨窗口互斥与播报 claim 复用同一机制与键空间（`VOICE_BROADCAST_CLAIM_KEY.mic`），Phase 1 仅产品约定 + 窗口内互斥，Phase 2 验证后决定是否启用（EG-7 keptOpen）。

**跨端（桌面+手机）**：不做强仲裁。手机播报为手动触发的本地 TTS（§8.2），桌面播报默认关，「默认关 + 手动触发」把叠音概率压到产品可接受；跨端仲裁列开放问题（OQ-3）。

---

## 4. 播报设计

### 4.1 播报内容分级表

**白名单闭集原则：只有下表「播」级内容可进入 TTS；新增任何播报内容必须先改本表再实现。**

| 级别 | 内容 | 数据源（同源约束） | 时机 | Phase |
|---|---|---|---|---|
| 播 | 轮尾正文 | ConversationTurnGroup 聚合 `assistantTextRows`（与 assistantCopyText/复制文本同源，assistantPreviewCards.ts:19-37 聚合方式，join("\n\n") 在 :34-37） | TurnComplete 终态后整段分句播，不跟流式 text_delta 中间态 | 1b |
| 播 | 权限请求内容摘要 | V4InteractionDialogs 既有 pending 队列条目的标题+问题文本 | 权限请求到达且播报开；到达时正在播正文/简报 → 当前句播完后插队进权限段（权限 > 正文 > 简报，句粒度让位，FD-3）；正在播权限段 → 新权限段排队背靠接连播（段间句隙不开放正文/简报）；播报前不触碰 interaction-registry 状态（§4.6 裁决）；超长截断至 200 字符 + 尾缀「内容已截断，请在卡片查看」；标记 uninterruptible 段（段 = 一次权限请求的完整播报，整段闭合，见 §4.2-5） | 1b |
| 播 | 工具简报（「正在编辑 foo.ts」） | ToolCall 行「从无到有」提交事件（见 §4.2） | 播报空闲插播，限流规则见 §4.2 | 2 |
| **永不播** | 工具 stdout/stderr、diff、日志等 chunk 级输出（tool output 行内容、streamOutputCap 内的增量） | — | — | 永久 |
| **永不播** | reasoning 内容与流式增量 | — | — | 永久 |
| **永不播** | 流式 text_delta 中间态（只播轮尾终态） | — | — | 永久 |
| **永不播** | partial 转写回读 | voiceSessionStore partial | 防回声自触发 + 隐私 | 永久 |
| **永不播** | 非 focused 会话的任何内容 | — | — | 永久 |
| **永不播** | 失败堆栈、诊断、内部错误详情 | — | — | 永久 |

### 4.2 工具简报合并限流规则（EG-1 裁决：合并窗基准=最近播出，已拍板）

代码事实（本轮核验）：`DELIVERY_PROFILES` continuous `flushWindowMs:30, toolProgress:false`、replayable `flushWindowMs:150, toolProgress:true`（core.ts:35-60）——桌面 renderer 收到的是 30ms 级 flush 的行提交，进度级增量（toolProgress 流）在桌面 continuous 上**不到达**。规则：

1. **触发源收窄**：简报只在 ToolCall 行「从无到有」（新工具调用开始）时生成一条候选；同一次调用的进度级更新不生成（桌面本就收不到；手机 replayable 收到的 progress 事件同样只用于行渲染，不生成简报候选）。
2. **同类时间窗合并（EG-1 拍板：窗口基准 = 该工具类最近一次实际播出时刻）**：同名工具在该类最近一次**实际播出**后 `sameToolMergeWindowMs = 10s` 窗口内的后续候选不上交，只把待上交目标持续刷新为最新（连续 Edit a.ts / b.ts → 只保留最新一次）；窗过期后由下一次快照驱动上交一条（仍受规则 3 间隔约束），被合并者不补播。拍板理由（防机关枪是本规则的目的）：若以「候选到达」为基准，首条候选即时上交后基准并不前移，同类后续候选每满 5s 间隔就各播一条——连续编辑 5 个文件会以 5s 间隔连报 5 条；以播出时刻为基准后，同类简报至多每 10s 一条（实现与守护：`toolBriefPlanner.ts` / `toolBriefPlanner.test.ts` 含 [5s,10s) 偏差区间用例）。
3. **最小间隔**：任意两条已播简报间隔 ≥ `minGapMs = 5s`；不足则丢弃，**不排队**（简报是可丢弃的增强信息，排队会造成播报积压）。
4. **只播最新**：窗口内多条候选只保留最新一条，被合并者不补播。
5. **不打断正文与权限段（FD-3）**：简报永不打断正在播的轮尾正文/权限内容；插播点仅限播报腿 AnnIdle 或**正文句间空隙**——让位条件 = 无待播正文**且无待播权限段**，二者齐备才消费。uninterruptible 段的粒度 = **整段**（一次权限请求的完整播报：标题+问题文本），权限段内句间空隙不开放简报插播（否则简报插进被标记 uninterruptible 的权限序列，打断词通道的失效窗口被拉长且边界模糊）；连续权限段背靠背连播，段间同样不插简报。
6. **上限**：每个 turn 简报 ≤ `maxPerTurn = 6` 条，超出静默丢弃；轮尾正文播报不受影响。
7. 文案模板：「正在 {action} {target}」（目标取工具输入中文件路径/命令首段，截断 40 字符）；i18n 键 `voice.brief.*`（§6.3）。

阈值常量落 `packages/ui/src/voice/voiceTuning.ts`（§2.1），Phase 2 真机调参不动契约。

### 4.3 三层打断映射表（对照现有 v4 stop 与事件集）

| 层 | 语义 | 触发 | 现有机制对照 | Phase |
|---|---|---|---|---|
| ① 停播报 | renderer 本地 `tts.cancel()`，任务不受影响 | 点按播报指示停止按钮（任何播报态含 uninterruptible，立即；FD-1——`TID_V4_STOP` 非层①载体）/ 打断词命中（uninterruptible 段外）/ claim 被抢 | 纯 renderer 行为，**不映射 v4 stop**，零协议 | 1b |
| ② 截断上下文 | 按播放位置截断被打断轮次已生成文本 | — | **CLI 无原语**：persistCancelledStreamSnapshot 只 flush 已到达本进程的 text/reasoning（cancelled-stream-persistence.ts:16-17/:37-53 本轮核验），被打断轮次已生成文本完整留在上下文。显式不做（OQ-1/TV-2） | 不做 |
| ③ 取消任务 | 取消当前 foreground 执行 | 仅「停掉任务」短语精确命中（§4.8） | 既有 v4 stop（`TID_V4_STOP` 同一命令面）带 `expectedForegroundExecutionId` 防误杀；命中 guard.stopTargetChanged 时 throw V4CommandNoopError 无 ACK → Cancelling 5s 兜底（session-flow.ts:346） | 1b |

D 语音网关所需事件集 ↔ Drora 现有机制的映射（设计报告 §2.1 四项预留的逐项落点）：实时输入通道 → CommandInbox 串行 admission（语音=文本同路，无快速通道）；运行中插话 → guide drain / steer / queue（`requestedDelivery=auto` 让 inputRouting 裁决；听写型输入不设 evidenceRefs，天然规避「带上下文禁 guide 回退 queue」分支，session-flow.ts:90-96 本轮核验）；打断 → 上表三层；进度 → SessionEventType 全集经 conversation topic 30ms/150ms profile（core.ts:35-60）。

### 4.4 键位仲裁表（录音态在 composer 域最高优先）

composer 域既有两处 Esc 消费（本轮核验）：`escapeStop.ts:1-24`（Esc→停止生成，`shouldIgnoreEscapeForStopGeneration` 的 dialog 路径忽略判定）与 `ChatPromptEditor.tsx:226`（Esc→onCancel）。仲裁按 composedPath 消费者判定：

| 优先级 | 场景 | Esc 归属 |
|---|---|---|
| 1 | Radix dialog 打开（`shouldIgnoreEscapeForStopGeneration` dialog 路径命中） | 弹层（关闭弹层），听写不受影响 |
| 2 | mention/补全菜单打开 | 关菜单（composer 内部既有消费），不停录音不停生成 |
| 3 | 录音中（无更高优先消费者） | **停录音**（stopPropagation），不触发停生成。理由：录音态下用户意图是结束拾音；误停任务代价高且 Stop 按钮始终可达 |
| 4 | 非录音态 | 既有语义不变（停生成 / onCancel） |

实现接缝（最小分支）：在 escapeStop 消费点与 ChatPromptEditor handleKeyDown 各加一处「voice 录音态优先」前置检查，不改 escapeStop.ts 纯函数本身。验收覆盖「mention 菜单开时 Esc 关菜单不停录音」「录音中 Esc 停录音且任务不中断」。

### 4.5 打断词表与语言扩展位（含 EG-5 第三语言回退裁决）

```ts
// packages/ui/src/voice/interruptionWords.ts（UI 交互判定，不进 wire）
export const VOICE_INTERRUPT_WORDS: Record<string, { exact: string[]; minWords?: number }> = {
  "zh-CN": { exact: ["停", "停下", "停止", "别说了", "取消"] },          // 1-2 字精确匹配即打断
  "en-US": { exact: ["stop", "stop it", "quiet", "cancel"], minWords: 3 },
};
export const VOICE_CANCEL_TASK_PHRASES: Record<string, string[]> = {
  "zh-CN": ["停掉任务"],
  "en-US": ["stop the task", "cancel the task"],   // 建议，待拍板
};
export const VOICE_INTERRUPT_FALLBACK = "en-US";   // 第三语言回退
```

判定语义（设计引用的 `MinWordsUserTurnStartStrategy` 本仓 grep 零命中，属外部来源，en 阈值语义据此处定义——建议，待拍板）：

- **zh-CN**：转写（trim 后）与词表项**精确相等** → 打断；否则正常听写注入。
- **en-US**：精确相等（大小写不敏感）→ 打断；词数 < 3 且未命中词表 → 视为噪声，丢弃（不注入、不打断，AnnPaused 正常续播）；≥3 词 → 正常听写注入。
- **第三语言回退（EG-5 裁决，建议，待拍板）**：locale 非 zh-CN/en-US 时整体回退 en-US 规则与词表（打断判定是加速器不是硬门槛，禁用语音打断的收益不抵体验损失）；新增语言 = 词表 map 加一项 + 本 spec 补记，结构已留扩展位。
- **命中的 final 不注入 composer**（打断词被语音命令通道消费）；「取消」∈通用词表 → 仅层① 停播报，不映射 UI 取消/任务取消/关闭弹层（§4.8）。
- 词表真机调优列开放问题（OQ-6）。

### 4.6 权限播报与 snooze（EG-2 code 裁决：设计报告 §4.6 断言不成立，本 spec 修订）

**读码裁决（本轮核验）**：设计报告 §4.6「既有 snooze 语义已支持」不成立——

1. auto-resolution 倒计时与 snooze 仅覆盖 `kind === "askUserQuestion"`：`interaction-registry.ts` register() 中 `autoResolutionEligible` 只对 askUserQuestion 置真（:126 一带），`snoozeAutoResolution` 入口 kind 门同样只认 askUserQuestion（:191-206，非该 kind 直接 return false）。**permission 类交互既无倒计时也无 snooze 入口**——「权限播报与倒计时竞争」在现实现上没有对象。
2. 现有 snooze 语义是「首次有效操作**永久**暂停」（:192-193 注释，state→snoozed 无 resume API），与「播报结束或用户处置后恢复倒计时」不匹配，无恢复型命令。

**本 spec 修订（冻结）**：Phase 1b 权限内容播报**不引入 snooze 联动**，语音通道不触碰 interaction-registry 任何状态。原 Phase 1b 验收项「权限内容播报开始时倒计时已 snooze」删除，改写为：「权限请求内容播报期间，askUserQuestion 类交互的既有 auto-resolution 行为不变；权限卡片点按动作始终可用且不受播报影响」。

**残余产品决策（keptOpen，见 §10）**：若未来给 permission 引入倒计时，需新设计 pause/resume 型 CLI 命令（additive）+ renderer 播报触发点；在此之前本条不重开。

### 4.7 AnnPaused 续播粒度（EG-9 裁决：句粒度，冻结）

设计报告两处表述（执行摘要「说完从断句处续播」/ §5.4「句边界暂停，记播放位置」）统一为：**播放位置以句为粒度（句序号），不记句内 charIndex**。

- 暂停请求（输入腿进入 Recording）在**当前句播完**时生效（最坏一句时长延迟）；记已播句序号。
- 续播从**下一句边界**起；不存在句内中断、半句重读、半句跳过三种行为中的任何一种。
- 点按播报指示停止按钮不受句边界约束（立即 cancel 当前句，FD-1 载体）——紧急静音永远可即时达成。
- 「断句处」一词按句边界解释。此裁决使 Phase 1b 验收「结束后续播最新轮尾」可测。

### 4.8 「停掉任务」确认与「取消」语义边界（EG-8 裁决，建议，待拍板）

1. **「停掉任务」属明确指令，Phase 1b/2 首版直接执行层③**，不做二次确认回路——语音追问需要重新开麦，链路长且引入新的误触发面；「停掉任务」是完整短语精确命中（不在通用打断词表内，见 §4.5 独立短语表），误命中面足够小。若 Phase 2 使用数据表明误取消真实发生，再评审确认形态（语音追问 vs UI 确认卡片）与超时回落策略。
2. **「取消」∈通用打断词表 → 仅层① 停播报**：不升级为取消任务、不关闭任何弹层、不触发 UI 取消语义——通用 UI 取消语义保留给点按通道。zh 词表含「取消」的价值只在播报场景的口语习惯，语义收窄到停播报是唯一无歧义解释。

---

## 5. 听写设计

### 5.1 写入规则（冻结）

- **partial 只进听写预览条，不写 composer 正文、不进协议**：正文在录音期完全归用户键盘；每句 final 以 `mode="append"` 追加进正文，连续多句顺序拼接，不覆盖用户已编辑内容。取舍：牺牲「实时落正文」的即时感，换取零写入冲突（与人工编辑、多句 replace 歧义两个事故面从构造上消除）。
- **转写保留在输入框由用户手动发送**（Phase 1 不做语音自动提交，防误发 + 发送前人工审阅，与隐私披露互为支撑）。转写未发送时随既有草稿机制持久化。
- 听写语言跟随当前 locale（zh-CN/en-US），不硬编码（修复 speech-input.tsx:90 现状）；`getUserMedia` 显式约束 AEC/NS/AGC = true。
- **打断词命中优先**：Recording 期间 ASR final 若命中 §4.5 词表 → 消费为打断命令，不注入 composer（AnnPaused 场景下「停」必须能生效而不是打进正文）。

### 5.2 听写预览条交互（EG-14 裁决，建议，待拍板）

- 预览条**只读展示** partial 与进行中的听写状态，不做点按编辑——编辑入口就是 composer 正文（final 已落正文，随时可改），双编辑面只会制造第二写路径。
- 预览条提供「清除」按钮：一键丢弃当前未定 partial 缓存（已落正文的 final 不受影响，那些已是用户正文）。
- **清空时机**：每句 final 注入发起即从预览条移除该句；录音结束时预览条随录音腿回 Idle 一并清空。
- **焦点互斥**：预览条不获焦（`tabindex={-1}`），录音中键盘焦点保持在 composer——Esc 仲裁（§4.4）因此不需要处理预览条分支。

### 5.3 RequestingMic 超时与 ASR 错误处置（冻结）

- 权限对话框被忽略/折叠 → **10s 超时**自动回 Idle + 轻提示（voice.dictation.requestingMicTimeout）；拒绝 → 提示 + 设置引导（IPlatformService optional 引导方法，照 openCuaPermissionOnboarding 模式，前期勘察未复验）。
- ASR 运行中失败：`not-allowed`/`service-not-allowed` → 权限提示 + 设置引导，回 Idle；`network` → **保留已注入文本** + 「语音服务不可用」提示，回 Idle；`audio-capture` → 设备检查提示；`aborted`/onend 无结果 → 同静音超时处理。**不自动重启**（防后台白跑与隐私顾虑），重试 = 用户再次点按。修复 speech-input.tsx:151-153 静默关闭的先例行为。

### 5.4 注入失败与 lastDictation

composerTextInsertRequest 无回执类型；注入后乐观回 Idle，final 文本暂存 `lastDictation`（TTL 300s），覆盖两条失败路径：消费门不匹配（§3.2 输入腿 Injecting→Idle 暂存出边）与绑定会话消失（§3.3 生命周期规则）。**「恢复上次转写」入口（FD-4）挂在 mic 按钮上**：lastDictation 非空且未过 TTL 时，mic 按钮右键（桌面）/长按（触屏）弹出单项菜单；左键点按仍是开始听写，不受影响。恢复以**新 requestId** 重试，目标 = 触发恢复的 mic 入口所在会话（原绑定会话已消失或消费门不匹配，重试不指向旧目标）；恢复成功即清空暂存。TTL 300s 过期后菜单项不再渲染（直接消失，不置灰）。乐观模型无法区分注入成败，菜单对两条失败路径同样可用，重复恢复产生重复文本属用户显式动作（语义同再次粘贴）。残余风险（记档不解决）：重试窗口内用户若已手动编辑正文，append 规则保证不覆盖，但文本顺序可能与口述顺序交错。

---

## 6. 设置面设计

### 6.1 voice 分节开关 × 默认值 × 持久化键 × 广播字段（EG-3 裁决，建议，待拍板）

新 `SettingsSectionId = "voice"`（settingsNavigation.ts:6-27 type union + isSettingsSectionId 联合守卫两处 additive，本轮核验现状无 voice；`packages/ui/src/SettingsPage.tsx:132` 引入处挂载），照 ComputerUseSection「能力+权限引导+设置项」先例。appSettings schema 字段落 `validationAppSettings.ts`（照 `computerUseComposerEntryHidden: z.boolean().default(true)` :527/:650 先例 + `protocol.ts:293` wire 面 optional 字段），键名与 `VOICE_SETTINGS_KEYS` 一一对应由 parity 单测钉住：

| # | 开关 | settings 键（= VOICE_SETTINGS_KEYS 值） | 默认值 | 跨窗口广播 |
|---|---|---|---|---|
| 1 | 听写入口（mic 按钮）显示 | `voiceComposerEntryHidden` | `true`（**隐藏**；`!== false` 判定照 CUA 哲学：新用户不闪按钮、不后台白跑权限查询，useCuaComposerEntry.ts:70-73 先例） | 是（appSettings 既有同步） |
| 2 | 播报总开关 | `voiceAnnouncementEnabled` | `false`（**关**） | 是 |
| 3 | TTS 音色 | `voiceAnnouncementVoice` | `""`（系统默认） | 是 |
| 4 | TTS 语速 | `voiceAnnouncementRate` | `1.0`（范围 0.5–2.0，step 0.1） | 是 |
| 5 | 听写语言 | `voiceDictationLang` | `""`（跟随 locale） | 是 |
| 6 | ASR 引擎 | `voiceAsrEngine` | `"webSpeech"` | 是 |
| 7 | 工具简报 | `voiceToolBriefEnabled` | `false`（Phase 2 生效） | 是 |
| 8 | 隐私披露已确认 | `voicePrivacyDisclosureAcknowledged` | `false`；**首次开启任一语音能力时必须先展示三条披露并显式确认**（FD-5：确认门覆盖两个开启入口——设置页任一语音开关的开启动作，以及入口可见但 `acknowledged=false` 时点按 mic 的兜底门，两入口共用同一 reader 守卫；确认后**中止本次动作**，再次显式点按才开始——与披露 3「仅点按后开启」一致，不做「确认即连续开录」；取消则开关回落 / 回 Idle） | 是 |

消费读取一律经 reader 函数收口（照 `isTaskNotificationSoundEnabled` taskNotificationPreferences.ts:33 先例：播放/入口消费点不直接读 store，保证设置关闭后运行时行为一致）。权限引导走 IPlatformService optional 方法；权限结果是一次性生产事件经同通道回报 renderer；Web/手机缺席即不出入口（能力探测，不写 UA 分支）。

### 6.2 隐私三条披露（zh/en 双语成稿，冻结进设置面）

设置 voice 分节固定披露三条（键 `voice.settings.privacy.asr / .persistence / .mic`）：

**zh-CN**

1. **语音识别引擎与数据去向**：听写默认使用浏览器/系统内置语音识别（Web Speech API），音频与转写由该引擎的云服务处理，Drora 不额外存储音频；若切换为其他引擎，此处会如实标注其数据处理方。**（2026-10-23 增补，§9.6.5 落地配套）配置云厂商 TTS 后，设置面数据流披露（voice.settings.vendor.dataHandler）如实标注：助手回复正文、权限请求摘要与工具简报目标会发送给该厂商处理。**
2. **口述文本的持久化与流转**：您确认发送后的口述内容与键盘输入完全同等对待——进入会话记录、可随会话导出或分享、不会自动删除。口述可能包含密码、路径等敏感信息，发送前请在输入框中审阅。
3. **麦克风边界**：麦克风仅在您点按麦克风按钮后开启，录音期间界面持续显示录音指示，按 Esc 或再次点按立即停止；Drora 没有任何后台监听或免提常开模式；日志不记录转写原文与音频数据。

**en-US**

1. **Speech recognition engine & data flow**: Dictation uses your browser/system built-in speech recognition (Web Speech API) by default. Audio and transcripts are processed by that engine's cloud service; Drora stores no audio itself. If another engine is added, its data handler will be disclosed here.
2. **Persistence of dictated text**: Once you send it, dictated text is treated exactly like typed text — it is stored in the session transcript, can be exported or shared with the session, and is not auto-deleted. Dictation may contain credentials or paths; please review it in the composer before sending.
3. **Microphone boundaries**: The microphone turns on only after you press the mic button, a recording indicator stays visible while recording, and Esc or a second press stops it immediately. Drora has no background listening or always-on mode; transcripts and audio are never written to logs.

另设输出设备披露（键 `voice.settings.announcement.outputDisclosure`）：「播报使用系统默认输出设备；蓝牙拔出或系统切静音可能转为外放。播报中点按播报指示上的停止按钮可立即静音。」/ "Announcements play through the system default output device; unplugging Bluetooth or muting the system may route audio to speakers. Press the stop button on the announcement indicator to mute immediately."（停止按钮实体 = 播报指示停止按钮，FD-1 消歧。）

### 6.3 用户可见文案 i18n 键清单（EG-4 裁决，建议，待拍板）

现状（本轮核验）：locale 为扁平 `Record<string, string>` 点分键（`packages/ui/src/i18n/locales/` 仅 en-US.ts / zh-CN.ts），`voice.*` 键零存量。统一 `voice.*` 命名空间，enforced-by-test 照 `packages/ui/src/team/i18n.test.ts:1-16` 三断言先例（双语键集一致 / 消费键存在非空 / 占位符同构），守护测试落 `packages/ui/src/voice/voiceI18n.test.ts`：

```
voice.settings.title / voice.settings.description
voice.settings.dictation.entry.label / .description
voice.settings.dictation.lang.label / voice.settings.dictation.lang.auto
voice.settings.asr.engine.label / voice.settings.asr.engine.webSpeech / voice.settings.asr.engine.remote
voice.settings.announcement.enable.label / .description
voice.settings.announcement.voice.label / voice.settings.announcement.voice.default
voice.settings.announcement.rate.label
voice.settings.announcement.outputDisclosure
voice.settings.toolBrief.enable.label / .description
voice.settings.privacy.title / voice.settings.privacy.asr / voice.settings.privacy.persistence / voice.settings.privacy.mic
voice.settings.privacy.acknowledge
voice.entry.mic.start.aria / voice.entry.mic.stop.aria / voice.entry.mic.tooltip
voice.dictation.preview.hint / voice.dictation.preview.clear
voice.dictation.requestingMic / voice.dictation.requestingMicTimeout
voice.dictation.error.permission / voice.dictation.error.network / voice.dictation.error.device / voice.dictation.error.aborted
voice.dictation.sessionGone
voice.dictation.restoreLast
voice.dictation.recordingIndicatorAria        # 占位符 {session} = 绑定会话名
voice.ann.indicator / voice.ann.indicatorAria
voice.ann.stop.aria                          # 播报指示停止按钮（FD-1 层①载体，Phase 1b）
voice.source.fromVoice                        # 「来自语音」/ "From voice"
voice.brief.prefix / voice.brief.truncated    # Phase 2，简报模板与截断尾缀
voice.interrupt.hint                          # Phase 2
```

「来自语音」投译规则：renderer 按 `intent.source.kind === "voice"` 投译（照 pluginUi「来自插件 X」先例的 renderer 侧）；CLI 账本零文案。

---

## 7. 日志与冷热等价

### 7.1 日志映射与分级（voice scope：info/warn/error 边界）

走 `packages/ui/src/logger.ts`（renderer 模块约定），scope 划分与级别边界：

| scope | debug（生产不落盘） | info | warn | error |
|---|---|---|---|---|
| `voice.asr` | partial 事件、endpointing 触发、打断词命中（**只记事件类型/文本长度/命中与否，不记转写原文**） | 适配器选择结果、引擎可用性探测 | onerror 错误码（network/audio-capture/not-allowed）、非静音超时的 onend | 适配器创建失败致入口不可用 |
| `voice.tts` | 句边界 boundary 事件 | 首次播报启动（引擎名+语言） | 播放失败（吞异常但落 warn + reason）、claim 竞争失败与被抢、Cancelling 5s 超时兜底 | —（播放失败不升级 error，属可恢复） |
| `voice.entry` | 门控判定中间值 | 权限授予/拒绝结果、设置变更生效 | 权限拒绝后的再次尝试、sendText 携带 source 被旧 CLI 拒收 | — |

硬边界：不落音频数据、不落转写原文到任何级别的日志（隐私边界，与 §6.2 披露一致）。

### 7.2 冷热等价不变量边界

| 进持久化（admission 固化/账本，冷恢复后可见） | 纯 UI 态（不进协议、不持久化） |
|---|---|
| final 转写文本（=普通 text 输入，随 session_input 账本与 user message 持久化，可随会话导出/分享——conversationShareItems 先例，`packages/ui/src/v4/conversationShareItems.ts`，SessionPane.tsx:7 消费） | partial 转写（「仅 live」事实，天然不进 snapshot/recovery，照 transport.ts:418-419 conversationTelemetryFact 注释先例）、录音态、绑定会话 id、ASR 错误态 |
| `source={kind:"voice", lang?, engine?}` 数据事实（§2.2） | 播报腿全态（annState、句序号、claim、uninterruptible 标记）、播报开关即时值（冷恢复按 settings 默认/持久值重读） |
| delivery/order/steer/dispatch 既有字段（不新增） | lastDictation 暂存、音频 buffer（**禁入**）、播放位置 |

- **TTS 产物零持久化**：冷恢复重放文字事实，不重播 TTS 音频；恢复后重播需消费端显式重新 TTS。
- **不变量**：冷恢复后用户看到的文字事实与热态一致；播报是否发生过不留任何冷态痕迹。

---

## 8. 身份、双语义与手机落位

### 8.1 身份（冻结）

语音订阅/命令复用 DroraWorkspaceRef（workspacePath + workspaceIdentity? + remoteSessionId? + workspaceKey），不新造身份格式；远程 workspace 缺 workspaceIdentity/remoteSessionId 即 throw（`packages/desktop/src/main/desktopMobileRelayProtocol.ts:399` 本轮核验）；不手写 workspaceKey 三元表达式，引用 resolveWorkspaceKey/connectionScope 既有工具。

### 8.2 desktop-continuous vs web-remote-replayable（双语义分叉验收）

- **桌面 continuous**：播报消费 30ms flush 流式路径（output.text/summaryText 可用，toolProgress 不到达——§4.2），轮尾终态整段播报。
- **手机 replayable**：流式仅 text 路径 + WebView autoplay 限制 → 播报 = 手动触发的本地 TTS 消费同一文字投影（Phase 2）；重连后语音会话以文字事实从 snapshot/resume 恢复，不重播。
- 音频腿（未来若有）重建而非续传。两种语义各自验收（AGENTS.md 要求同验）。

### 8.3 手机听写入口落位（TV-7 code 裁决：设计报告落位假设推翻）

**读码裁决（本轮核验）**：`packages/mobile-web/README.md:3` 明示「当前版本以 packages/web + packages/ui 为唯一页面实现」；生产宿主优先托管 upstream 官方 3.14.3 原始字节；设计报告引用的源码轨 `src/app`、`src/ui`、`src/intl` 在当前 checkout 的 `packages/mobile-web/src` 下不存在（实测仅 `recovered/`）。改 upstream 字节违反还原资产规则（AGENTS.md）。

**落位修订（冻结）**：手机语音入口 Phase 2 落在 **packages/web + packages/ui 的受控远控 composer 扩展**（isWebRemoteControl 判定放行 mic 入口，能力探测不写 UA 分支），不改 mobile-web upstream 字节、不新建源码轨。若受控入口实测不可行，需先过 DESIGN.md R3 与上游对齐评审再立项——在此之前手机听写不实施。链路不变：手机浏览器 getUserMedia → 本地 ASR（Chrome Android SpeechRecognition；iOS Safari 无 → Phase 1/2 缺席，OQ-5）→ 转写文本进远控 composer → 既有 web-remote-replayable 链路 → desktop Host 同一 CommandInbox。**音频从不过 relay，过线的是文本。**

---

## 9. 分阶段实施清单与验收

每个 Phase 的验收写成可执行断言级；「given/when/then」中状态名对应 §3.2 状态机。所有 Phase 共同门禁：`pnpm typecheck`、`pnpm lint` 实际执行并报告真实结果；UI 改动遵守 DESIGN.md token 规则（speech-input.tsx 的裸色样式是反面教材，不搬入）。

### 9.1 Phase 0：契约先行（CLI 先行合入）

**新建**

| 文件 | 内容 |
|---|---|
| `packages/shared/src/contracts/voice.ts` | §2.1 常量区（VOICE_INPUT_SOURCE_KIND、VOICE_SETTINGS_KEYS 八键、VOICE_BROADCAST_CLAIM_KEY 两键） |
| `packages/shared/src/contracts/voice.test.ts`（位置照该包测试现状） | 常量 parity：validationAppSettings voice 字段名集合 === VOICE_SETTINGS_KEYS 值集合 |

**修改**

| 文件 | 改动点 |
|---|---|
| `packages/shared/src/drora-protocol-v4/input-intent.ts` | + `voiceInputSourceSchema`（§2.2，kind 引用常量）并追加进 conversationInputSourceSchema |
| `packages/shared/src/validationAppSettings.ts` | + §6.1 八字段（含 default 值） |
| `packages/shared/src/protocol.ts` | + appSettings wire 面 optional 字段（照 :293 先例） |
| sendText admission→intent 固化路径（`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/session-flow.ts` 及其调用的固化函数） | source 透传不剥离；实现时读码定位，schema 外零新协议概念 |
| intent→投影下发面 | source 数据随既有投影面下发（无文案） |

**验收（断言级）**

- `.strict()` 解析往返：`{kind:"voice",lang:"zh-CN",engine:"webSpeech"}` parse 通过；未知 kind / 多余字段整条拒收；`conversationInputIntentSchema.source` 收 voice source 后往返不变。
- 旧 renderer + 新 CLI 灰度：sendText 不带 source 照常受理（既有测试全绿即证）。
- 顺序门禁：renderer 携带 source 的改动 PR 依赖声明在本批之后（新 renderer + 旧 CLI 不出现的合并顺序保证）。
- 契约 parity 单测通过；`pnpm dep:refs --list-exports packages/shared/src/contracts/voice.ts` 确认生产/消费引用同一出处——断言范围为已有生产/消费方的键（`VOICE_INPUT_SOURCE_KIND`、`VOICE_SETTINGS_KEYS`、announcement claim 键）；`VOICE_BROADCAST_CLAIM_KEY.mic` 为 EG-7 预留键（FD-7），Phase 1 零生产/消费方，豁免本断言，随 EG-7 裁决启用或移除。

### 9.2 Phase 1a：桌面听写

**新建**

| 文件 | 内容 |
|---|---|
| `packages/ui/src/voice/voiceAsrPort.ts` | §2.3 ASR 端口 |
| `packages/ui/src/voice/webSpeechAsrAdapter.ts` | 复用 speech-input.tsx 逻辑、重写 UI；AEC/NS/AGC 约束；错误码映射 §5.3 |
| `packages/ui/src/voice/voiceComposerEntryState.ts` | 纯函数门控判定（照 useCuaComposerEntry 三段式） |
| `packages/ui/src/voice/useVoiceComposerEntry.ts` | 入口 hook（platform/services/settings 汇聚 + 权限门控懒查询） |
| `packages/ui/src/voice/V4ComposerVoiceEntry.tsx` | mic 按钮 + 录音态（token 化指示，禁裸色）+ lastDictation 恢复菜单（§5.4 FD-4：右键/长按单项菜单，TTL 过期不渲染） |
| `packages/ui/src/voice/DictationPreviewOverlay.tsx` | 听写预览条（§5.2） |
| `packages/ui/src/voice/voiceTuning.ts` | 行为阈值常量（10s 超时、lastDictation TTL 300s 等） |
| `packages/ui/src/voice/voiceI18nKeys.ts` + `voiceI18n.test.ts` | 消费键清单 + 双语守护（§6.3） |
| `packages/ui/src/store/voiceSessionStore.ts` | 输入腿状态 + lastDictation（§3.1） |
| `packages/ui/src/settings/VoiceSection.tsx` | voice 分节（含三条隐私披露与确认流） |
| `packages/desktop/src/main/voicePermissionPolicy.ts` | app 主窗口 session 的 media(microphone) 权限 handler，照 `embeddedBrowserPermissionPolicy.ts` 模式（现 main 仅 embeddedBrowser/pluginSandbox 两处 handler——前期勘察结论，本轮未逐行复验两文件行号） |

**修改**

| 文件 | 改动点 |
|---|---|
| `packages/ui/src/lib/settingsNavigation.ts` | type union + isSettingsSectionId +（如需默认隐藏语义则 HIDDEN set）+ "voice" |
| `packages/ui/src/SettingsPage.tsx` | voice 分节挂载（:132 引入区） |
| composer 组装侧（`packages/ui/src/v4/ConversationComposer.tsx` 的 leadingActions 构造，行级位置实现时确认） | 注入 V4ComposerVoiceEntry；不改 ChatPromptEditor 壳 |
| Esc 仲裁接缝（escapeStop 消费点 + `ChatPromptEditor.tsx` handleKeyDown） | 「录音态优先」前置分支（§4.4，单处分支） |
| `packages/ui/src/store/droraSessionStoreTypes.ts` | mode + "append"（§2.4） |
| `packages/ui/src/v4/SessionPane.tsx` | 消费门 mode=append 分支 |
| `packages/ui/src/i18n/locales/zh-CN.ts` / `en-US.ts` | §6.3 Phase 1a 键 |
| `packages/shared/src/platform.ts` + desktop host/web 实现 | IPlatformService optional mic 权限引导/结果回报方法（Web 缺席即不出入口） |
| `packages/ui/src/hooks/useCuaComposerEntry.ts` 同型的语音门控消费点 | 入口 hiddenBySettings 判定接 voiceComposerEntryHidden |

**验收（断言级）**

- given 入口已启用且非 isWebRemoteControl 且 ASR isSupported()，when 点按 mic，则 getUserMedia 约束含 echoCancellation/noiseSuppression/autoGainControl=true 且输入腿=Recording。
- given Recording，when partial 到达，则预览条更新且 composer 正文不变、零 v4 帧发送（mock transport 断言零调用）。
- when 句 final 到达，则 composerTextInsertRequest(mode="append", targetSessionId=按下时会话) 恰好一次；非空正文尾无空白时恰好插入一个空格。
- given 用户已手动编辑正文，when final 追加，则编辑保留且新句在尾部。
- when 连续 3 句 final，则正文按序拼接 3 段。
- given Recording 中切换 focused，when final，则注入目标仍为绑定会话。
- given Recording，when Esc，则录音停止、零 v4 stop 调用（任务不中断）；given mention 菜单打开，when Esc，则仅关菜单且录音继续。
- when 权限对话框 10s 无响应，则回 Idle + 轻提示。
- when ASR network 错误，则保留已注入文本 + 提示，且不自动重启。
- given final 未发送即刷新，则文本随 composer 草稿恢复。
- given isWebRemoteControl 或 isSupported()=false 或入口隐藏，则 mic 入口不渲染。
- given 绑定会话在录音中被关闭，则录音强制停止 + 轻提示 + 零注入。
- given `acknowledged=false`，when 点按 mic，则先展示三条披露且不进入 RequestingMic；显式确认后回 Idle（不自动开录），再次点按才开始录音；取消同样回 Idle（FD-5）。
- given `acknowledged=false`，when 在设置页开启任一语音开关，则开关保持关闭直至披露确认，确认后本次开启生效（FD-5）。
- given lastDictation 非空且未过 TTL，when mic 右键/长按，则出现单项「恢复上次转写」；when 点按该项，则以新 requestId 发出恰好一次 `composerTextInsertRequest(mode="append", targetSessionId=当前入口会话)`，暂存清空，正文尾部追加且不覆盖既有编辑（FD-4）。
- given lastDictation 超 TTL 300s，则恢复菜单项不渲染（FD-4）。
- given 主/辅 pane 同会话各持 mic 入口且 A 已在录音，when 点按 B 的 mic，则 B 侧 no-op 且 A 的录音指示短暂高亮；partial 只出现在 A 的预览条（FD-6）。
- 双主题 + 390px/1200px 快照；voiceI18n 守护测试通过。

### 9.3 Phase 1b：轮尾播报

**新建**

| 文件 | 内容 |
|---|---|
| `packages/ui/src/voice/voiceTtsPort.ts` + `speechSynthesisTtsAdapter.ts` | §2.3 TTS 端口 + Chromium 内建实现（仓内 speechSynthesis 零使用，绿地；云 TTS 同端口后置换） |
| `packages/ui/src/voice/turnSpeechPlanner.ts` | §2.3 规划器（分句、句粒度暂停/续播、顺延规则） |
| `packages/ui/src/voice/interruptionWords.ts` | §4.5 词表 |
| `packages/ui/src/voice/voiceAnnouncementClaim.ts` | §3.5 claim 端口（走既有 BroadcastHub claim 通道，零新协议） |
| `packages/ui/src/voice/AnnouncementIndicator.tsx` | 播报中指示（**行外 overlay**，见 TV-6 裁决）+ 专用停止按钮（层①唯一载体，FD-1：onClick → planner.notifyStopPressed()，test id `TID_VOICE_ANN_STOP`） |
| `packages/ui/src/lib/voiceAnnouncementPreferences.ts` | reader 收口（照 taskNotificationPreferences 先例） |

**修改**

| 文件 | 改动点 |
|---|---|
| `packages/ui/src/store/voiceSessionStore.ts` | + 播报腿状态 |
| `packages/shared/src/test-ids.ts` | + `TID_VOICE_ANN_STOP`（additive）；`ConversationComposer`/`SessionPane` 既有 stop 链路（ConversationComposer.tsx:1442/:2504-2505 → SessionPane.tsx:4594）**零改动**——`TID_V4_STOP` 不挂任何语音逻辑（FD-1，原「Stop 按钮处理点点按调 notifyStopPressed」方案废止） |
| `packages/ui/src/settings/VoiceSection.tsx` | 播报开关/音色/语速 + 输出设备披露 |
| locales | voice.ann.* / voice.source.fromVoice 等 |

**验收（断言级）**

- given 播报开 + focused 轮尾终态，则 TTS 逐句播报的全文 === assistantTextRows 聚合文本（与复制文本一致）。
- given Speaking，when 点按播报指示停止按钮（`TID_VOICE_ANN_STOP`），则 50ms 内回 AnnIdle 且零 v4 stop 调用（任务继续）；given 权限内容播报（uninterruptible 段），when 点按播报指示停止按钮，则同样立即停（FD-1）。
- given 权限内容播报且任务运行中（canStop=true，`TID_V4_STOP` 可见），when 点按 `TID_V4_STOP`，则既有取消任务语义不变（发出 v4 stop）且播报同步静音、经 Cancelling 回 AnnIdle；对照断言：零 `notifyStopPressed` 调用，播报静音不依赖层①路径（FD-1）。
- given 轮尾正文播报中（TurnComplete 后 canStop=false），则 `TID_V4_STOP` 不渲染，播报静音唯一载体为播报指示停止按钮（FD-1 主场景断言）。
- when 语音「停掉任务」，则发出既有 v4 stop 且携带 expectedForegroundExecutionId；TurnComplete(cancelled) 后 AnnIdle 且不再播。
- given stop 命中 guard.stopTargetChanged（无 ACK），则 5s 超时回 AnnIdle + voice.tts warn。
- given Speaking 时开麦，则当前句播完即停（句粒度）；录音结束且轮尾仍最新 → 自下一句续播；轮尾已更新 → 只播最新；不排队多轮。
- given 两个窗口同 workspace 且都开播报，则仅 claim 持有者出声；given 持有者窗口关闭，则另一窗口 5s 内可接管。
- given 非 focused 会话 TurnComplete，则零播报。
- given ASR final=「停」（AnnPaused 下），则停播报不续播且「停」不出现在 composer 正文。
- given 权限内容播报，则 askUserQuestion 类交互倒计时行为与不开播报时逐一致（interaction-registry 零新调用）。
- 播报中指示为行外 overlay：ConversationRowView 行组件的 memo/props 零变化（对照 git diff 断言）。
- 双主题 + 390px/1200px。

### 9.4 Phase 2：D 事件语义

**新建/修改**

| 文件 | 内容 |
|---|---|
| `packages/ui/src/voice/remoteAsrAdapter.ts` | MediaRecorder blob → 云 provider，经 services 注册（TV-1 spike 结果决定是否需要） |
| `packages/ui/src/voice/toolBriefPlanner.ts` | §4.2 简报合并器（同类 10s 窗 / 间隔 5s / 只播最新 / 空闲插播 / 每 turn ≤6） |
| 受控远控 composer（packages/web + packages/ui 受控面，§8.3 裁决落位） | 手机 mic 入口 + 手机本地播报手动触发 |
| `packages/ui/src/v4/V4InteractionDialogs.tsx` 扩展 | 权限语音 decline/cancel 消费（**待 OQ-4 拍板后实施**；allow 永远点按） |
| locales | voice.brief.* / voice.interrupt.hint |

**验收（断言级）**

- given agent streaming（busy），when 语音新指令，则 inputAccepted(guide|queue)，无第二条输入面、无旁路会话。
- given 手机 Chrome Android，when 远控听写，则转写经 relay → desktop CommandInbox 串行受理；抓包断言 relay 载荷零音频字节。
- given Speaking，when 语音「停」，则打断且播报正文字不误触发（真机，麦克风/噪声环境，OQ-6 数据同步采集）。
- given 无转写噪声（咳嗽），则静默观察后恢复播报（观察时长/恢复条件 Phase 2 设计时定，EG-11 keptOpen）。
- given 10s 窗内同工具 5 次调用，则简报 ≤1 条；given 正文播报中到达简报，则正文不被打断、简报在其后空闲插播；given 一个 turn 12 个工具调用，则简报 ≤6 条。
- given 权限段播报中到达简报（含两句权限内容之间的句间空隙），则简报不插播、权限段整段播完后 AnnIdle 才消费；given 正文播报中到达权限请求，则当前句播完即插播权限段（句粒度让位，FD-3）。
- 工具简报开关关闭时零简报。

### 9.5 Phase 3（条件触发，另立 spec）

触发条件：Phase 2 验证「用户要在 agent 跑工具时说话」核心假设。范围：音频留档（chatAttachments audio 序列化分支 + attachmentRead 白名单扩展 + artifact 引用，改动前全链 grep）与 Host 内实时双工旁路 sidecar（照 remoteMediaPreviewProxy lease+TTL+并发上限先例）。音频不过 relay/v4 wire；隐私合规（OQ-7）与自建 relay-server 对照在独立 spec 决策。验收由该 spec 定义。

### 9.6 Phase 2 批次一：厂商对接与接口完善（2026-10-23 增补，工作树 feat/voice-agent-phase1）

增补性质：本章在 Phase 1 落地（附录 C 记录的批次）之后，对 §9.4 Phase 2 清单做批次切分并裁决「厂商对接与接口完善」批次的全部设计面。**不改写任何既有冻结裁决**；本章新增裁决自增补日起纳入头部冻结范围，标注「建议，待拍板」条目除外。与 §9.4 的关系：本批次实施 §9.4 新建表中的 `remoteAsrAdapter`（原注「TV-1 spike 结果决定是否需要」——TV-1 是 Phase 1a SpeechRecognition 可用性 spike，与远程 ASR 无关，该注作废，以本章为准）与 `toolBriefPlanner`，以及 busy 语义验收；§9.4 的手机入口行、权限语音消费行（待 OQ-4）不在本批次（见 9.6.9）。证据约定同头部；本轮新增核验见附录 D。

#### 9.6.1 厂商与协议：第一适配面（裁决）

**裁决：第一适配面 = 「OpenAI 兼容音频端点族」整段 HTTP 批量（ASR: `POST {baseUrl}/audio/transcriptions`，TTS: `POST {baseUrl}/audio/speech`），多厂商经 baseUrl/model/apiKey 三元组可配置，不按厂商写死适配器；流式 WS 与非 OpenAI 兼容格式只留扩展位（9.6.4/9.6.9）。**

端点事实（本轮一手核验，详见附录 D）：

| 端点 | 认证/请求 | 模型与响应 | 出处 |
|---|---|---|---|
| `POST https://api.openai.com/v1/audio/transcriptions` | Bearer；multipart/form-data（file + model） | model ∈ {whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe}；参数含 language/prompt/response_format（json/text/srt/verbose_json/vtt）；webm 在支持格式列表 | developers.openai.com API reference「Create Transcription」与 Speech-to-Text 指南（WebSearch 摘要，2026-10-23） |
| `POST https://api.siliconflow.cn/v1/audio/transcriptions` | Bearer；multipart/form-data（file + model） | model ∈ {FunAudioLLM/SenseVoiceSmall, TeleAI/TeleSpeechASR}；响应 `{"text": string}`；≤50MB / ≤1h | docs.siliconflow.cn「创建语音转文本请求」（webReader 全文抓取，2026-10-23） |
| `POST https://api.siliconflow.cn/v1/audio/speech` | Bearer；JSON（model/input/voice/response_format∈{mp3,opus,wav,pcm}/speed/gain/sample_rate/stream） | 响应 = 二进制音频；speed 0.25–4.0；文档样本模型 fnlp/MOSS-TTSD-v0.5，body 另有 CosyVoice2-0.5B 页签 | docs.siliconflow.cn「创建文本转语音请求」（webReader 全文抓取，2026-10-23） |

依据：

1. **批量形态与 v1 交互严格同构**：调研报告 §7.2 已核验 OpenAI Chat Completions 音频「整段音频进出（`input_audio` 分片 + `message.audio{data,transcript}`），非流式会话，适合异步整段」——push-to-talk 批量（9.6.4）正是整段进出；整段 HTTP 不引入任何会话/帧协议，与冻结 §1.2「不新增音频帧通道」同向。
2. **多厂商横移成本最低**：调研报告 §6.6 核验「端到端事件协议正向 OpenAI Realtime 风格收敛……学会一套事件族即可低成本横移多家供应商」——音频端点族同理；流式扩展位届时按同一事件族风格预留，不另造协议。
3. **默认厂商建议（建议，待拍板）**：SiliconFlow——双腿同域 OpenAI 兼容、ASR/TTS 模型即调研 §4.2 的 FunAudioLLM 系（SenseVoiceSmall / CosyVoice2，与 §1.3「全中文栈 FunASR+CosyVoice」血统一致），且 **CORS preflight 本轮实测放行**（`Access-Control-Allow-Origin: *`，附录 D）。备选：① OpenAI 官方 transcriptions（海外/英文优先；其 CORS 本环境不可达未能核验，引入前须过 OQ-8 spike）；② 任意自托管 OpenAI 兼容网关（自托管面即调研 §1.3 中文栈路线的自托管部署；FunASR/CosyVoice 仓库本身只核验到「runtime WebSocket 服务」等事实，其 OpenAI 兼容 facade 属实现侧工作，不在调研核验范围）。
4. **明确排除**：GLM-4-Voice 直连——调研 §4.2「2024-12 后停更」+ §4.5「商用需在开放平台登记」；MiniMax——调研 §6.2「未检索到公开的实时语音对话协议文档」，公开面仅 T2A 合成（可作未来 TTS 备选格式，v1 不做多格式适配）。开源权重自托管（SenseVoice/CosyVoice 仓库）不作为「厂商」，按备选②的自托管网关形态接入。

#### 9.6.2 凭据与配置面（裁决）

**裁决：复用既有两套存储，零新凭据机制——baseUrl/model 等**非秘密**配置进 appSettings（voice 键区 additive），apiKey 进 `ICredentialService`（host 侧加密凭据，renderer 经既有 `useCredentials` hook 读写）；不进 LLM provider registry，不进 appSettings 明文。**

证据与理由：

1. **不进 provider registry**：provider 配置域是 LLM 模型域——`providerApiTypeDataSchema` 枚举仅 `anthropic-messages / openai-chat-completions / openai-responses`（`packages/provider/src/config/provider-data-schema.ts:4-8`），连通性测试是模型测试（`providerFacadeServices.ts:67-71` testModelConnectivity），配置面（baseUrl/apiKey 编辑：`InlineEditableProviderCard.tsx:193/:241`、`ProviderDraftSave.ts:46-62`、`ApiKeyInput.tsx:20-40` password 形态）全部围绕 model membership 与 registry 资格。语音厂商档塞进去会牵动 model-selection/registry 语义，收益为零。**复用的是 pattern（baseUrl+apiKey 输入形态、配置/凭据分层），不是 registry 本体。**
2. **apiKey 不进 appSettings**：appSettings 全 schema 无任何 apiKey 字段（`validationAppSettings.ts` grep 零命中，附录 D）；appSettings 走 protocol.ts wire 面跨窗口同步，秘密不宜上 wire。
3. **既有凭据通道全链在仓**：契约 `ICredentialService`（`packages/services/src/credential/credential.ts:1-15`，实现端负责加密、renderer 只经 RPC）；实现为 app config 目录 `credentials.json` + cipherProvider 加密 + 跨进程文件锁（`credentialService.ts:19-34/:139-154`）；UI 既有消费 hook `useCredentials`（`packages/ui/src/hooks/useCredentials.ts:9-16`）与命名空间键先例 `oauth:${family}:access_token`（`useCodingPlanEntryPlanList.ts:49`）。
4. **配置键 additive 四枚**（进 `VOICE_SETTINGS_KEYS`，parity 单测同步扩展，照 `contracts/voice.ts:20-29` 现状）：

```ts
// contracts/voice.ts 本批次 additive：
vendorBaseUrl: "voiceVendorBaseUrl",      // 厂商档根地址（双腿共用），default ""
asrVendorModel: "voiceAsrVendorModel",    // ASR model id（如 FunAudioLLM/SenseVoiceSmall），default ""
ttsEngine: "voiceTtsEngine",              // "system" | "cloud"，default "system"
ttsVendorModel: "voiceTtsVendorModel",    // TTS model id，default ""
// 凭据键（持久化键前缀，AGENTS.md 契约键单一出处；照 oauth: 命名空间先例）：
export const VOICE_VENDOR_CREDENTIAL_KEY = "voice:vendor:api-key";
```

   `voiceAsrEngine` 既有枚举 `["webSpeech","remote"]`（validationAppSettings.ts:537/:669）不动；TTS 引擎新增 `voiceTtsEngine`。双腿共用单一厂商档（baseUrl + 一枚凭据）是 v1 裁决：默认厂商双腿同域（9.6.1），用户「换厂商」只改一档；双腿异厂商的拆档 = 后续 additive 加键（键先进常量区、消费方后接）。
5. **厂商档完整判定**（选型函数纯谓词，9.6.6 消费）：`baseUrl.trim() && asrVendorModel.trim() && apiKey.trim()`（TTS 腿用 `ttsVendorModel`）。设置面 = `VoiceSection.tsx` 内厂商档分组（照 model-provider-section 的 ApiKeyInput password 形态，凭据经 useCredentials 读写）；`remote` 引擎选项仅在 ASR 厂商档完整时可选（消除无实现/无配置的可选态，照 `VoiceSection.tsx:125-129` disabled 占位先例）。
6. **隐私边界延伸**：§7.1 硬边界（不落音频、不落转写原文）延伸到 apiKey 与 Authorization 头——任何日志级别不落凭据；厂商错误对象透传 message 前须确认不含请求头。§6.2 披露 1「若切换为其他引擎，此处会如实标注其数据处理方」在本批次落地：任一云引擎开启且 baseUrl 非空时，设置面渲染该 baseUrl 为数据处理方。

#### 9.6.3 网络通道：renderer 直连（裁决）

**裁决：语音厂商调用一律由 renderer 进程直连厂商（浏览器 fetch），不经 host 代理、不经任何 Drora 协议通道；音频在本机（桌面 Chromium / 浏览器）内直接到厂商。**

证据与理由：

1. **决定性约束（远程语义）**：web/手机远控的 host 服务通道经 relay；若厂商调用在 host 侧，音频必须走 renderer→relay→host，直接违反冻结 §1.2「Phase 1/2 音频不过 relay、不过 v4 wire」与 §8.3「音频从不过 relay，过线的是文本」。renderer 直连使桌面/远控/手机三 surface 同一路径，构造性满足两处冻结。
2. **renderer 直连外部 URL 有仓内先例**：`cloudLottieRuntime.ts:36`（外部资源 fetch，`credentials:"omit", redirect:"error"` + 2MB 上限）、`mcpStatusProbe.ts:51`（renderer fetch 探测**用户配置的任意 baseUrl**——与语音厂商档同构）。市场索引、更新检查、captcha solver 分别走 CLI/host/Main 进程（`packages/desktop/src/main/autoUpdater.ts`、`captchaSolverWindow.ts`），属 agent/宿主流量，不构成「外部 HTTP 必须代理」的先例。
3. **代理与证书免费继承**：桌面 defaultSession（app renderer 出口）已按设置页代理显式收敛（`desktopNetworkPolicy.ts:56-74` fallback `direct`，注释「Drora 自身对后端与模型 API 的出口，收敛到设置页的显式配置」；:103 setProxy；:107-110 自定义 CA verify proc）——renderer 直连的厂商流量自动走同一代理/CA 策略。host 侧 fetch 则是另一套 env 代理体系（`agentProxyEnv.ts:11-22` HTTPS_PROXY；`nodeApiNetwork.ts:99` 注释「Host 是独立 Node 进程，Electron Session.setProxy 不会影响它的 globalThis.fetch」）——语音若走 host，桌面（session 代理）与远程（env 代理不可达）行为必然分叉。
4. **可行性事实**：主 renderer 入口 `packages/web/index.html` 无 CSP meta（全文读取，connect-src 无限制）；全仓 `webSecurity` 无一处禁用（grep 仅两处显式 `true`：pluginSandbox/guestPolicy.ts:45、electronBrowserWebmRecorder.ts:298）。
5. **代价与缓解（如实记录）**：CORS 是每厂商属性，直连仅在厂商允许浏览器来源时可用——默认厂商已实测放行（9.6.1-3、附录 D）；其他厂商连接失败走回退树（9.6.6）+ warn，不阻塞功能。厂商 CORS/容器格式能力矩阵列 **OQ-8（新增，keptOpen）**，**TV-8（新增）：默认厂商端到端连通性 spike 为本批次实施前置**（真实凭据直调两端点 + 桌面 renderer 环境 CORS 实测；SiliconFlow transcriptions 的容器格式支持列表本轮未抓取到，MediaRecorder 产出的 webm/opus 可用性以 spike 为准）。

#### 9.6.4 远程 ASR v1 形态：push-to-talk 批量（裁决）

**裁决：v1 = 批量整段转写。录音期间 MediaRecorder 本机收集；`stop()` 时整段上传，响应文本经既有 `onFinal` 交付一次；`onPartial` 永不发射。流式 WS 只留扩展位。**

1. **final 语义不变**：适配器实现既有 `VoiceAsrPort/VoiceAsrSession` 契约（`packages/ui/src/voice/voiceAsrPort.ts:34-63`，Phase 1a 已含 additive 的 `onFinal/onError`），`stop(): Promise<{final}>`、`onFinal` 逐句通道、`onError` 错误码语义（§5.3）零改动；下游 `useVoiceDictation.ts:250-266` 的错误处置与注入链（mode=append + 打断词分类）零改动。`input-intent.ts` engine 枚举 `"remote"`（:46-64 voiceInputSourceSchema 已落地）不区分批量/流式，wire 语义不变。
2. **v1 行为差异（如实记录，非缺口）**：① 无 partial——听写预览条（§5.2）空转，清除按钮行为不变；② 打断词命中判定从「句级实时」（§5.1）退化为「stop 时对整段 final 判定」——判定点与分类逻辑不变，判定时机变化；push-to-talk 下开停由用户手势控制，可接受。媒体参数：`VoiceAsrStartParams.lang` 映射端点 language 参数（格式转换在适配器内）、`hints` 映射 prompt 偏置（端点支持时，如 OpenAI transcriptions 的 `prompt`），不支持即忽略（照 webSpeech 适配器对 hints 的先例，webSpeechAsrAdapter.ts 文件头）。
3. **流式 WS 扩展位**：`VoiceAsrPort` 不变；未来流式 = 新适配器成员 + 选型函数加分支 + engine 语义按需细化，协议形态按调研 §6.6 OpenAI Realtime 事件族风格（`session` / `input_audio_buffer.*` / `response.*`）预留——届时独立增补本 spec，不预写无依据的帧格式。

#### 9.6.5 云 TTS v1 形态（裁决）

**裁决：v1 = 逐句批量合成。`speechSynthesisTtsAdapter` 之外新增 `cloudTtsAdapter` 实现同一 `VoiceTtsPort`（`voiceTtsPort.ts:24-34` 零改动）；句切分/排队/暂停续播仍全部归 `turnSpeechPlanner`。**

1. `speak(u)` → `POST {baseUrl}/audio/speech`（JSON：`model=voiceTtsVendorModel`、`input=u.text`、`voice=u.voice ?? 缺省`（复用既有 `voiceAnnouncementVoice` 作为厂商音色 id）、`speed=u.rate ?? 1` 映射端点 speed 0.25–4）；响应二进制音频在 renderer 解码播放；`u.lang` v1 不映射（默认厂商模型自判定语种，调研 §4.2 CosyVoice 多语种）。
2. 引擎选择在**播报腿解析点**（AnnIdle→Speaking 进入、设置变更、renderer 装配）解析一次：`voiceTtsEngine="cloud"` 且 TTS 厂商档完整 → cloud；否则 speechSynthesis（Phase 1b 行为逐字段不变）。`useVoiceAnnouncement.ts:133` 现状硬编码 `createSpeechSynthesisTtsAdapter()` 是本批次唯一接线点。
3. 失败语义：单句请求失败 = 既有「跳过坏句继续推进」（`turnSpeechPlanner.ts:322-325`）+ voice.tts warn，**不在播报中途换系统引擎重播同一句**（避免同会话混音色）；连续 `VOICE_TTS_CLOUD_CONSECUTIVE_FAILURES`（voiceTuning.ts 新常量，初值 3，调参面不冻值）句失败 → 中止本轮播报回 AnnIdle + warn，本次 renderer 会话内后续播报回落 speechSynthesis，至下一引擎解析点恢复。引擎选择结果落 §7.1 既有 voice.tts info 槽位（首次播报启动记引擎名+语言）。
4. **数据流披露（§6.2 配套，2026-10-23 实施轮补记）**：cloud 引擎开启且厂商档完整时，设置面数据流披露（voice.settings.vendor.dataHandler）如实标注：助手回复正文、权限请求摘要与工具简报目标会发送给该厂商处理（发送面 = speak(u.text) 的全部文本来源；§7.1 硬边界不变——日志仍不落这些内容）。

#### 9.6.6 引擎选择与回退树（裁决）

```mermaid
flowchart TD
    A[点按 mic] --> B{voiceAsrEngine}
    B -->|webSpeech| W[webSpeechAsrAdapter：Phase 1a 现状路径零变化]
    B -->|remote| C{厂商档完整? baseUrl+asrVendorModel+apiKey}
    C -->|否| W2[webSpeech + voice.asr info 记录选择结果<br/>现状行为完全不变]
    C -->|是| R[remoteAsrAdapter 起录]
    R -->|start 失败：预检/网络| W3[本次点按以 webSpeech 起录 + voice.asr warn<br/>回退发生在用户手势同一动作内，不构成 §5.3 自动重启]
    R -->|录音中厂商请求失败| E[onError network → 既有 §5.3 处置：<br/>保留已注入文本 + 提示 + 不自动重启不换引擎；下次点按重新选型]
```

- **未配置厂商 → 现有 web speech 行为完全不变**：选型纯函数（`packages/ui/src/voice/resolveAsrAdapter.ts` 新文件）对 webSpeech 路径返回既有适配器实例，行为差异为零；设置面 `remote` 选项档未完整时不可选（9.6.2-5）。
- **TTS 对称规则**（9.6.5-2/-3）：未配置 → speechSynthesis 完全不变；播报中厂商失败 → 跳句 warn，连续失败中止并回落。
- 选型结果与回退事件全部落 §7.1 既有槽位（voice.asr info=「适配器选择结果」、warn=错误码），无新 scope。

#### 9.6.7 工具简报与 busy steer/queue 落点（裁决确认）

1. **工具简报**：实现 §4.2 六规则合并限流（EG-1）——新建 `packages/ui/src/voice/toolBriefPlanner.ts`（同类 10s 窗 / 最小间隔 5s / 只播最新 / 每 turn ≤6 / 仅 AnnIdle 或正文句间且无待播权限段才插播 / 权限整段 uninterruptible 内外边界照 FD-3），阈值常量落 `voiceTuning.ts`（§4.2 已定调参面）；触发源 = ToolCall 行「从无到有」提交事件（§4.2-1，消费现有 conversation 投影，不建第二事件流）；开关消费走既有 `voiceToolBriefEnabled`（设置面开关与 i18n 键已落地：VoiceSection.tsx:63/:199-206、voiceI18nKeys.ts:57），缺的只有 planner 与播报腿消费接线；文案模板 `voice.brief.*`（§6.3 已预留）。
2. **busy 语音 steer/queue = 零新协议，走既有 CommandInbox admission**：语音 final 注入 composer 后由用户手动发送（§5.1 冻结不变），sendText 载荷**不带** `requestedDelivery`（SessionPane.tsx:3727 仅显式传参时携带）；CLI 侧 `session-flow.ts:88-99` 以 `payload.requestedDelivery ?? (routingMode==="guide" ? "guide" : routingMode==="enqueue" ? "queue" : "startNow")` 裁决，inputRouting=guide 时经既有 guide drain、enqueue 时进 queue——语音文本与键盘文本同路、无第二条输入面（§4.3 映射表既有裁决，本批次只做验收与回归，无 CLI 改动）。本批次不实施 CLI source 固化（附录 C 第 2 条 CLI-first 门禁维持，语音输入继续以纯文本发送）。

#### 9.6.8 本批次实现范围与逐条验收（裁决 f）

**范围清单（全部 `packages/ui/src/voice/` 模块内 + shared 契约 additive + VoiceSection 扩展，零还原文件改动、零 CLI 改动）**

| # | 交付物 | 内容 |
|---|---|---|
| S1 | `packages/shared/src/contracts/voice.ts` additive | VOICE_SETTINGS_KEYS 四键 + `VOICE_VENDOR_CREDENTIAL_KEY`；`contracts.test.ts` parity 扩展；`validationAppSettings.ts` persisted/patch 两 schema + `protocol.ts` wire 面 additive（照 :529-537/:666-668 先例） |
| S2 | `packages/ui/src/voice/remoteAsrAdapter.ts`（+test） | 9.6.4 批量 ASR；MediaRecorder 收集 → multipart 上传 → final/onError；错误码映射 §5.3 |
| S3 | `packages/ui/src/voice/resolveAsrAdapter.ts`（+test） | 9.6.6 选型纯函数 + `useVoiceDictation.ts:51` 单点接线（现状硬编码 createWebSpeechAsrAdapter） |
| S4 | `packages/ui/src/voice/cloudTtsAdapter.ts`（+test） | 9.6.5 云 TTS；`useVoiceAnnouncement.ts:133` 单点接线 + 连续失败回落 |
| S5 | `packages/ui/src/voice/toolBriefPlanner.ts`（+test） | 9.6.7-1 六规则合并限流 + 播报腿消费接线 |
| S6 | `VoiceSection.tsx` 厂商档分组 | baseUrl/model 输入（appSettings 四键）+ apiKey（useCredentials + ApiKeyInput 形态）+ `remote`/`cloud` 选项启用条件 + 数据处理方披露渲染 |
| S7 | i18n + 文档 | `voice.settings.vendor.*` 等新键进 zh/en + voiceI18n 守护；`packages/ui/src/voice/CONTRACT.md` 同步 |

共同门禁照 §9 头（typecheck/lint 实测报告）；TV-8 spike（9.6.3-5）为 S2/S4 实施前置。

**验收（断言级，逐条对应交付物）**

- S1：given 新 schema，parity 单测字段集合 === VOICE_SETTINGS_KEYS 值集合通过；patch schema 缺省时 persisted default 生效（voiceTtsEngine="system"）。
- S2：given engine=remote 且厂商档完整，when 说话后停止，则**恰好一次** `POST {baseUrl}/audio/transcriptions`（multipart file+model，Bearer 来自 ICredentialService），响应 `{text}` 经 onFinal 交付一次并注入 composer（mode=append，注入链与 webSpeech 逐字段一致）；全程零 partial；零 v4/relay 载荷含音频字节（mock transport 断言）。
- S2：given Recording 中厂商请求失败（网络错误/非 2xx），则 onError("network") → 保留已注入文本 + 提示、不自动重启、不换引擎续录；下次点按重新选型。
- S2：given 打断词命中整段 final，则消费为打断命令且不注入 composer（§5.1 判定点回归）。
- S3：given engine=webSpeech，则适配器选择返回既有 webSpeech 实例，Phase 1a 验收（§9.2）全量回归通过；given engine=remote 且厂商档任一字段为空，则解析为 webSpeech + voice.asr info；given engine=remote 档完整但 start 失败，则本次以 webSpeech 起录 + warn。
- S4：given ttsEngine=cloud 且档完整，when 轮尾终态，则逐句 POST `/audio/speech`（model/input/voice/speed 映射）且播报全文 === assistantTextRows 聚合；given 单句失败，则跳句 + warn 继续下一句；given 连续 3 句失败，则回 AnnIdle + warn 且后续轮尾回落 speechSynthesis；given ttsEngine=system，则 Phase 1b 验收（§9.3）全量回归通过。
- S5：given 10s 窗内同工具 5 次调用，则简报 ≤1 条；given 正文播报中到达简报，则正文不打断、简报空闲插播；given 一 turn 12 个工具调用，则简报 ≤6 条；given 权限段播报中（含段间句隙）到达简报，则不插播；given `voiceToolBriefEnabled=false`，则零简报（§9.4 既有简报验收并入本批）。
- S6：given 任一云引擎开启且 baseUrl 非空，则设置面渲染数据处理方（baseUrl）；given 档不完整，则 `remote`/`cloud` 选项不可选；apiKey 输入为 password 形态且任何日志零凭据（§7.1 延伸边界）。
- S7：voiceI18n 三断言守护通过（新键双语一致/非空/占位符同构）。
- busy steer/queue：given busy 且 inputRouting=guide，when 语音 final 注入后用户发送，则 sendText 无 requestedDelivery 字段且 CLI 裁决 inputAccepted(guide)；given inputRouting=enqueue，同路 → inputAccepted(queue)；given「停掉任务」命中（既有 voiceCommandBus 通道），when busy，则既有 v4 stop 带 expectedForegroundExecutionId（Phase 1b 回归断言）。

#### 9.6.9 明确不做与 keptOpen（裁决 g）

**本批次不做（对应清单/状态维持，不改既有裁决）**：

1. **barge-in AEC 真机验收**——EG-11（防误触参数/回声护栏真机数据）与 OQ-6 维持 keptOpen；本批次远程 ASR 批量形态无并行播报拾音场景，AEC 验收仍绑定 Phase 1b 词表真机验收执行时。
2. **原子 claim renew**——不引入原子续约原语；§3.5「TTL 5s + 周期 renew 2s + 以 claim 校正本地态」语义维持（EG-10 已闭环），重开条件 = 多窗口实测出现续约竞态双播。
3. **播报输出设备选择**——OQ-2 维持 keptOpen（需 Main 原生层设计）。
4. **手机端播报**——§8.2「手动触发的本地 TTS」形态裁决不变，本批次不实施；受控入口可行性 TV-7 维持 keptOpen。**手机 mic 听写入口同批延后**（§9.4 手机行延后，TV-7 前置勘察未做）。
5. **打断词表真机定稿**——OQ-6 维持 keptOpen；本批次沿用 §4.5 词表与 9.6.4-2 批量判定时机。
6. 流式 WS ASR、非 OpenAI 兼容格式适配器、TTS 逐句预取/缓存、双腿异厂商拆档——仅扩展位（9.6.1/9.6.4/9.6.5/9.6.2-4），实施前须增补本 spec。
7. 权限语音 decline/cancel（§9.4 待 OQ-4 拍板）、CLI source 透传（附录 C 第 2 条）——维持。

**新增 open 条目**：

| # | 问题 | 为什么暂不裁决 | 重新打开的触发条件 | 责任人角度 |
|---|---|---|---|---|
| OQ-8 | 厂商 CORS / 容器格式能力矩阵（OpenAI 直连 preflight 本环境连接超时未能核验；SiliconFlow transcriptions 支持格式列表未抓取到） | 每厂商属性，只能实测；默认厂商已放行，第二厂商未引入 | 引入任何非默认厂商前（含 OpenAI 官方） | Phase 2 实现者 |
| TV-8 | 默认厂商端到端连通性 spike（真实凭据直调 transcriptions/speech + 桌面 renderer 环境 CORS + MediaRecorder webm/opus 容器实测） | 需真实凭据与目标运行时，静态核验不足 | **S2/S4 实施前强制前置**（同 TV-1 之于 Phase 1a） | Phase 2 实现者 |

### 9.7 Phase 2 批次二：音色选择完善与角色设置（2026-10-24 增补）

增补性质：本章消化 `docs/voice-completeness-review-2026-10-24.md`（下称「复审报告」；**该报告与其引用的上轮 `docs/voice-agent-implementation-review-2026-10-23.md` 均随本批增补一并提交入仓，溯源链仓内可解析**）第三节五个音色缺口（#1 盲填 medium 复核成立 / #2 voiceschanged low / #3 云 voice 跨命名空间 medium 复核成立 / #4 播报语言来源 low / #5 语速草稿态 nit）、第四节 persona missing-in-spec（六条建议）与 7.2 后续动作 #1–#6。**不改写任何既有冻结裁决**；对 §9.6.5-1「voice=u.voice ?? 缺省（复用既有 voiceAnnouncementVoice 作为厂商音色 id）」云 voice 子句的取代，照 §9.6 头部对 §9.4「TV-1 注作废」的先例办理——原正文不改写，以本章为准。本章新增裁决自增补日起纳入头部冻结范围，标注「建议，待拍板」条目除外。

证据约定：本章代码锚点全部为 2026-10-24 在 worktree `D:/workspace/projects/drora-voice-agent`（分支 `feat/voice-agent-phase1`，HEAD `63479ef7`，工作树干净）实际读取核验。复审报告锚定 `6d754098`；其后继提交 `63479ef7` 经 `git diff 6d754098 HEAD` 实测仅涉 3 文件（wiring 测试删 10 行 DEBUG console.error、useVoiceDictation.ts/voiceCommandBus.ts 注释修正——即复审报告 7.1 #1/#2 清理已落地），voice 模块行为面与本 spec 零变化。本轮新增 grep 证据见本节末尾核验记。

#### 9.7.1 缺口 → 裁决对照表

| 复审缺口 | 本章裁决 | 小节 |
|---|---|---|
| #1 system 音色盲填自由文本（medium，复核成立） | system 音色改枚举 Select（zh*/en* 前缀过滤 + 「自动」项 + voiceschanged 异步刷新） | 9.7.2 |
| #3 云 TTS voice 复用同一键跨命名空间、错配静默回落（medium，复核成立） | 新独立键 `voiceTtsVendorVoice` + 端口 additive 字段 `vendorVoice`；取代 §9.6.5-1 云 voice 子句 | 9.7.3 |
| —（#3 的 UI 配套） | system 引擎「试听」边界 | 9.7.4 |
| #4 播报语言（utterance.lang）来源未定义（low） | 新 additive 键 `voiceAnnouncementLang`，缺省 ""=自动=UI locale（现状保持） | 9.7.5 |
| #5 语速控件无草稿态（nit） | 语速 Input 改 draft+onBlur（对齐 baseUrl 先例） | 9.7.6 |
| 功能面 low：`toolBriefPlanner.resetTurnCounters` 死 API + 三结构无界增长 | 接线 conversationKey 切换 + API 演进 `resetSessionState` + 首帧 prime 消化 | 9.7.7 |
| 4.1 persona missing-in-spec + 4.2 六条建议 | persona v1：builtin 目录 + 「自定义」派生档 + 选择=物化写底层键 | 9.7.8 |

#### 9.7.2 system 音色控件：枚举 Select（裁决）

**裁决：`voiceAnnouncementVoice` 的设置控件由自由文本 Input（VoiceSection.tsx:354-367，placeholder「系统默认」）改为枚举 Select——「自动」+ 系统音色枚举，按 `zh*`/`en*` 语言前缀过滤，订阅 `voiceschanged` 异步刷新；持久键与运行时匹配语义零变化。**

- **枚举来源**：`window.speechSynthesis.getVoices()`（经 `speechSynthesisTtsAdapter.ts:36` 既有 `SpeechSynthesisLike` 端口形状，不绕过抽象直摸 window）。新文件 `packages/ui/src/voice/systemVoiceCatalog.ts`（+test），签名级：
  - `listSystemVoices(synth: SpeechSynthesisLike | null): SpeechSynthesisVoiceLike[]`（空合成器 → 空表）；
  - `subscribeSystemVoices(synth, onChange: () => void): () => void`（挂 `voiceschanged`，卸载退订；synth 缺席时返回 no-op 退订）；
  - `filterVoicesForAnnouncement(voices): SpeechSynthesisVoiceLike[]`——`voice.lang` 小写前缀 `zh`/`en` 过滤（两语言面 = §6.3 locale 仅 zh-CN/en-US 的既有产品面，照听写语言 Select 固定 auto/zh-CN/en-US 同型先例 VoiceSection.tsx:175-185）；**过滤结果为空时回落全量列表**（防「系统无 zh/en 音色 → 空死控件」）。
- **「自动」项**：Select 哨兵值 `"auto"` → 写 `voiceAnnouncementVoice: ""`（照听写语言 auto→"" 写语义 VoiceSection.tsx:166-169）；文案复用既有键 `voice.settings.announcement.voice.default`（"系统默认"，zh-CN.ts:8251 已存），不新增键。
- **voiceschanged 异步语义（复审缺口 #2）**：Windows/Chrome 首次 `getVoices()` 常返回空数组（平台行为，触发率未实测——复审 3.2 #2 low 定级为推断）。裁决：**设置面列表不阻塞等待**——首帧空表时 Select 仅含「自动」+ 禁用的加载占位项（新键 `voice.settings.announcement.voice.loading`）；`voiceschanged` 到达后刷新选项。**播报腿运行时零改动**：speak 时同步取一次 + 失配 warn 回落系统默认（speechSynthesisTtsAdapter.ts:111-119）保持为兜底——设置面枚举只是可发现性增强，不把「列表就绪」变成播报前置条件（首播通常晚于页面加载，且兜底不崩溃；触发率实测列 TV-9）。
- 选中项写值 = 音色 `name` 原串（与适配器 `candidate.name === u.voice` 精确匹配键一致，speechSynthesisTtsAdapter.ts:112）；控件补 `data-testid="voice-announcement-voice"`（设置面本地字面量，照 voice-vendor-base-url 先例，不进 shared test-ids）。

理由：复审 3.2 #1 定性为「spec 未定义的需求缺口」——§6.1 只定义键名/默认值、§9.3 只写「音色」二字；实现与 spec 自洽，缺的是控件形态定义。枚举 Select 消除「用户无从得知合法音色名」的可发现性缺口；键与匹配语义不动，使其成为纯 UI 面改动（无契约迁移）。

#### 9.7.3 cloud 音色独立键 `voiceTtsVendorVoice` + 端口 additive 字段（裁决；取代 §9.6.5-1 云 voice 子句）

**裁决：云 TTS 音色改用独立 appSettings 键 `voiceTtsVendorVoice`（string，default ""）；`voiceAnnouncementVoice` 收窄为 system 引擎语义（系统音色名），两者永不互读。`VoiceTtsUtterance` additive 可选字段 `vendorVoice?: string`（厂商音色 id）；`cloudTtsAdapter` 的 `body.voice` 改读 `u.vendorVoice`（缺省省略字段 = 厂商默认音色），`speechSynthesisTtsAdapter` 仍读 `u.voice` 零改动。**

- 现状冲突（复审 #3，复核成立）：同一 `voiceAnnouncementVoice` 在 system/cloud 两引擎下分属两个命名空间——cloud 路径 `cloudTtsAdapter.ts:179-181` `body.voice = u.voice` 直传（源自 §9.6.5-1「复用 voiceAnnouncementVoice」裁决），system 音色名填入 → 厂商 4xx → 连续 3 句失败（voiceTuning.ts:43）→ 中止本轮 + 会话内静默回落系统引擎，UI 零反馈。
- 为什么在 utterance 层加字段而不是「reader 按引擎返回」：引擎路由在 wiring 组合端口的 `speak` 内单点裁决（useVoiceAnnouncement.ts:207-225 `resolveTtsEngineNow`），而句配置在 planner 每句 `speak` 前组装（turnSpeechPlanner.ts:351-357）——若 reader 按引擎挑值，等于在配置组装点复刻一份引擎判定（含 `cloudFallbackRef` 回落态），两处必须永远一致，脆弱。`vendorVoice` 字段让两个适配器各取各轨，路由仍单点。端口改动为 additive optional（既有调用方零影响）。
- **不迁移存量值**：旧语义下用户填进 `voiceAnnouncementVoice` 的厂商音色 id 本身就是错配输入（给 system 引擎也是失配回落），无「正确旧值」可迁；切换后 cloud 档 `voiceTtsVendorVoice` 缺省 ""= 厂商默认音色，用户在新键重填。设置面：厂商档分组 ttsModel 行后新增自由文本 Input（`voice.settings.vendor.ttsVoice.label`/`.placeholder`，恒可见，照 ttsVendorModel 行形态 VoiceSection.tsx:339-353；厂商音色枚举未抓取——附录 D.11/OQ-9——v1 不做校验下拉）。
- 消费链：reader `resolveVoiceAnnouncementVoiceConfig`（voiceComposerEntryState.ts:41-53）additive 返回 `vendorVoice?: string`（读 `voiceTtsVendorVoice`，空 = 缺省）→ `voiceAnnouncementPreferences.resolveVoiceAnnouncementOutputConfig` 透传 → planner `getAnnouncementVoiceConfig` 形状扩展 `{ lang, voice?, vendorVoice?, rate }` → speak(u) 双轨各取。

#### 9.7.4 试听（预览）边界（裁决）

**裁决：system 音色控件旁新增「试听」按钮，走 TTS 端口独立短句；不进播报腿状态机、不持播报 claim；输入腿 Recording 或播报腿非 AnnIdle 时禁用。cloud 试听 keptOpen（TV-8 同期）。**

- **载体**：VoiceSection 持 preview 专用 `createSpeechSynthesisTtsAdapter()` 实例（useRef），点按 = `cancel() + speak({ text: 试听短句键 voice.settings.announcement.voice.previewText, lang: 解析后播报语言（9.7.5）, voice: 当前选中 system 音色, rate: 当前语速 })`。试听短句文案按**当前 UI locale** 取键值（它只是发音样本，不承担播报语言链路验证）。
- **不进播报腿状态机**：preview 不调用 planner、不写 `voiceSessionStore.announcement`（相位/claim 态零变化）；试听播放态是设置面本地 useState（按钮态：空闲/播放中）。
- **不持 claim**：preview 是单窗设置面显式短句行为，不参与跨窗口单播报者仲裁（§3.5）。他窗正在播报时本窗试听可能叠音——接受（同 OQ-3「默认关 + 手动触发压叠音概率」哲学），不为他窗播报状态引入跨窗查询。
- **禁用门（防叠音的构造性保障，非时序侥幸）**：`voiceSessionStore.inputLeg !== "recording" && announcement.phase === "idle"` 才可点（VoiceSection 直接订阅 store 两既有事实）。两条理由：① §3.3「Recording 优先」是冻结互斥规则，任何 TTS 出声与拾音竞争且会被 ASR 拾入（回声/误转写）；② `speechSynthesis.cancel()` 是**引擎级全停、无逐句选择性**（speechSynthesisTtsAdapter.ts:154-168）——preview 与播报腿共用底层引擎，任何一侧 cancel 会停掉另一侧在播内容；置灰入口使两侧永不并存，比「抢停/让位」分支简单且可测。AnnPaused/Cancelling 期同禁用（AnnPaused 必然伴随 recording；Cancelling 是过渡态）。
- **cloud 试听 keptOpen**：需真实凭据直调厂商（计费）+ 音频回放链路复用度评估，与 TV-8 spike 同期裁决（9.7.10）。

#### 9.7.5 播报语言键 `voiceAnnouncementLang`（裁决）

**裁决：新增 additive 键 `voiceAnnouncementLang`（string，default ""）；""=自动=UI locale（现状语义原样保留为缺省，useVoiceAnnouncement.ts:266-269 `lang: localeRef.current` 零行为变化）；显式值优先。不做「跟随所选 system 音色 lang」联动。**

- 控件：播报分组音色行后新增 Select「播报语言」（键 `voice.settings.announcement.lang.label`/`.auto`/`.zh`/`.en`），auto→"" 写语义照听写语言行（VoiceSection.tsx:162-189 同型）。
- reader：新 `resolveVoiceAnnouncementLang(settings, currentLocale)`（照 `resolveVoiceDictationLang` voiceComposerEntryState.ts:32-38 同型收口）；planner 侧 `config.lang ?? defaultAnnouncementLang()`（turnSpeechPlanner.ts:354，fallback `navigator.language` :195-200）维持兜底不变。
- **不联动所选音色 lang 的理由**：lang 来源必须单一（状态所有者红线）。若 auto = 音色 lang，则「音色=自动」时回落 UI locale、「音色=具体」时跟随音色，同键两套推断链且随 voiceschanged 漂移；显式键 + 缺省 UI locale 是零迁移、零歧义的最小面。音色/语言错配（如 UI=zh 选英文音色）为既有行为，不因本章变化；两控件相邻排列由用户组合。
- **cloud 引擎 v1 不映射 lang**（§9.6.5-1「u.lang v1 不映射」维持）：本键 v1 仅 system 引擎生效，cloud 语种由厂商模型自判；如实记入设置面描述（不承诺 cloud 语言跟随）。
- 该键是 persona 物化的四个底层键之一（9.7.8）——persona 需要可写的语言键是选择显式键方案的决定性理由。

#### 9.7.6 语速 Input 改 draft+onBlur 草稿态（裁决）

**裁决：语速控件（VoiceSection.tsx:368-387 受控 number Input，越界不写 → DOM 显示值与持久值短暂背离）改 baseUrl 先例的草稿模式：onChange 只写本地草稿；onBlur 解析——合法（有限数且 ∈ [0.5, 2]）→ `updateSettings({ voiceAnnouncementRate })` 恰一次；非法/越界 → 草稿回退持久值 + 行内警告（键 `voice.settings.announcement.rate.invalidWarning`，warning 形态照 baseUrl 行 VoiceSection.tsx:222-235）。**

- 数值契约不变：设置域 0.5–2.0 在 zod（validationAppSettings.ts:535）与 reader（voiceComposerEntryState.ts:51）两处一致、端点 0.25–4 钳制全覆盖（cloudTtsAdapter.ts:66-72）——本条纯控件形态，零契约面。
- **草稿随外部变更重同步**（useEffect 照 VoiceSection.tsx:116-119 baseUrl 草稿同步先例）：persona 物化写 `voiceAnnouncementRate`（9.7.8）是控件外写入路径，草稿必须跟随，否则 Select 选完角色后 Input 仍显示旧草稿。

#### 9.7.7 toolBriefPlanner 会话边界重置与首帧消化（裁决）

**裁决：`resetTurnCounters` 死 API 演进为 `resetSessionState()`，wiring 在 conversationKey 变化时点调用；快照消费增 prime（首帧消化）语义；`announcedCountByTurn` 每快照修剪。turn 推进时点不接线。**

现状（本轮核验）：`resetTurnCounters`（toolBriefPlanner.ts:170-172）仅清 `announcedCountByTurn`，生产代码零调用（grep 全 ui src 仅定义/接口文档/测试命中）；`seenToolCallIds`（:73，Set）、`lastBriefAtByTool`（:80，Map）、`pendingByTool`（:85-94）、`announcedCountByTurn`（:105，Map）随会话内工具调用数无界增长（复审功能面 low #2；planner 实例生命周期 = pane 内 hook 生命周期，useVoiceAnnouncement.ts:394-407 useMemo）。既有语义约束：开关关闭时 seen 照常消化防「开启瞬间旧行涌入」（toolBriefPlanner.test.ts:176 用例）；EG-1 允许 pending 跨 turn 挂起（:99 注释）。

1. **接线时点 = conversationKey 变化**（`useVoiceAnnouncement.ts:275-288` 既有会话切换检测 effect——`lastConsumedTurnRef` 重置同批，单点接线）。**turn 推进不接线**：per-turn 计数已按 turnId 键控、跨 turn 归属由 drain 时刻 `currentTurnId` 裁决（:130，终审角落修复语义），无「turn 边界事件」可挂且无必要。
2. **API 演进**：`resetSessionState()` 清全部四结构（seen/lastBriefAtByTool/pendingByTool/announcedCountByTurn）+ `currentTurnId = null`；**保留** `lastAnnouncedAt`（全局最小间隔基准跨会话连续，方向安全：切换后首条简报至多被 5s 间隔约束丢弃一次）。原 `resetTurnCounters` 移除——死 API 无生产调用方，重命名零迁移成本，名字如实反映语义（「turn counters」名不副实：清的是会话态）。toolBriefPlanner.test.ts:154 用例同步改写。
3. **首帧 prime 消化**：`consumeToolCallSnapshot(rows, opts?: { prime?: boolean })` additive。`prime: true` 时**终态行（status ∈ {success, error, cancelled}，drora-protocol-v4/rows.ts:211 枚举）只进 seen 不生成候选；非终态行（inputStreaming/pendingApproval/running）走正常首见候选路径**；drainPending 照常。wiring：conversationKey 变化（含首挂载）→ `resetSessionState()` → 本帧快照以 `{prime: true}` 消化；后续快照正常调用。
   - prime 同时修复既有首帧涌入：现行挂载/切换即全量首见——投影含历史终态工具行时（units 全量喂入 useVoiceAnnouncement.ts:408-435），挂载即对历史工具出简报；wiring 测试与 planner 测试均未覆盖此形态（grep 双文件零相关断言）。prime 语义 = 「从无到有」以**本 planner 会话视图**为界，首帧存量不播——与 :176「开关关闭 seen 照常消化」同一哲学的补全。
   - 切回旧会话同理：reset 后 prime 消化历史终态行，构造性防「切回即重播历史简报」。
4. **修剪**：`consumeToolCallSnapshot` 末尾把 `announcedCountByTurn` 键集修剪至当前快照 turnId 集 ∪ {currentTurnId}——长会话内存有界，且不破坏跨 turn 挂起归属（挂起者上交时计入 currentTurnId，:130 语义保持）。

#### 9.7.8 persona v1（裁决；目录内容建议，待拍板）

**裁决：persona v1 = builtin 预设目录（4 个，内容建议待拍板）+「自定义」派生档；选择角色 = 一次 patch 物化写四个底层键；`voicePersonaId` 仅作设置面显示当前选择，运行时零读路径；双引擎双轨音色；角色不影响打断词表。**

```mermaid
flowchart LR
    P["VoiceSection persona Select 点选 builtin P"] -->|"单次 updateSettings 5 键（原子 patch）"| S[("appSettings: voicePersonaId / voiceAnnouncementVoice / voiceTtsVendorVoice / voiceAnnouncementRate / voiceAnnouncementLang")]
    S --> R["reader 收口（resolveVoiceAnnouncementVoiceConfig + resolveVoiceAnnouncementLang）"]
    R -->|"每句 speak 读取（句粒度生效）"| PL["turnSpeechPlanner speak(u): voice=system 轨 / vendorVoice=cloud 轨"]
    PL -->|system| A1["speechSynthesisTtsAdapter: u.voice"]
    PL -->|cloud| A2["cloudTtsAdapter: body.voice = u.vendorVoice"]
    D["Select 显示派生（四键与 P 物化值发散 → 显示「自定义」，不回写）"] -.只读.-> S
```

1. **目录形态**：新文件 `packages/ui/src/voice/voicePersonas.ts`（+test）。条目形状：`{ id: string; labelKey: string; lang: "" | "zh-CN" | "en-US"; rate: number; cloudVoice: string; systemVoiceHint: string }`——`cloudVoice`/`systemVoiceHint` 可空串 = 自动（cloud=厂商默认音色、system=系统默认音色）。名称走 i18n 静态键 `voice.settings.persona.preset.<id>` 进 `VOICE_SETTINGS_I18N_KEYS`（三断言守护覆盖；键清单静态，catalog 引用键名——照 EG-4 静态清单模式，不做动态键）。
2. **目录内容（建议，待拍板）**：4 个 builtin——`standard`（标准，lang 自动/rate 1.0/双音色自动）、`brisk`（明快，rate 1.3）、`composed`（从容，rate 0.85）、`narration`（讲述，rate 1.0/lang 定档）。具体 `systemVoiceHint`/`cloudVoice` 值**实现时落**：系统音色名按目标平台实测枚举填（Windows/macOS 名集不同，miss 即走既有失配回落 speechSynthesisTtsAdapter.ts:111-119，hint 语义=「尽力匹配」）；cloud 音色 id 依赖厂商音色枚举抓取（OQ-9，附录 D.11 补记；默认厂商 SiliconFlow 音色集），抓取前相关字段留空串=自动。preset 数量 4 ∈ 复审建议区间 3–5。
3. **物化写底层键**：点选 builtin P → **单次** `updateSettings({ voicePersonaId: P.id, voiceAnnouncementVoice: P.systemVoiceHint, voiceTtsVendorVoice: P.cloudVoice, voiceAnnouncementRate: P.rate, voiceAnnouncementLang: P.lang })`（单 patch 原子生效，照 handleAcknowledge 多键 patch 先例 VoiceSection.tsx:96）。**不新增第二读路径（§3.1 红线）**：运行时消费（reader→planner→适配器）只读四个底层键，`voicePersonaId` 的唯一消费方 = VoiceSection Select 显示。
4. **「自定义」= 派生档，不可点选**：持久键 `voicePersonaId`（string，default ""；非枚举——目录演进不需 schema 迁移，未知 id 自然回落自定义）。显示判定：`voicePersonaId` 命中 builtin 且四底层键与该 preset 物化值逐项相等 → 显示该 preset；否则显示「自定义」（键 `voice.settings.persona.custom`）。手改任一底层键（音色 Select/云音色 Input/语速/播报语言）→ 发散 → 显示回落自定义，**不回写** `voicePersonaId`（各控件保持 persona 无感知，零耦合）。「自定义」不出现在 SelectItem 列表（radix SelectValue 可显示非选项值）。
5. **双引擎双轨**：同一 persona 双轨各写各键——`systemVoiceHint → voiceAnnouncementVoice`（system 轨）、`cloudVoice → voiceTtsVendorVoice`（cloud 轨，9.7.3）；切引擎即换轨读，无需重选角色。异厂商（baseUrl 非 SiliconFlow）用户：preset cloudVoice 可能无效 → 走 §9.6.5-3 既有失败回落链；v1 不做异厂商映射表（keptOpen 9.7.10）。
6. **生效时机 = 句粒度（既有机制，零新事件流）**：planner 每句 speak 时读 config（turnSpeechPlanner.ts:351-357），设置变更下一句即生效——比复审建议 5「对齐 §9.6.5-2 引擎解析点（设置变更=下一解析点）」粒度更细，方向一致；播报中切换 persona = 当句播完下句换音色/语速，不中断本轮。
7. **角色不影响打断词表（v1 明确不做）**：打断词表按 locale 维度（interruptionWords.ts:16-19 现状），persona 不叠加维度——打断词命中是层①/层③分发判定（安全/仲裁面），「换角色打断词失效」是不可接受的意外面。重开条件 = OQ-6 真机调优数据表明需要。
8. **持久化**：`voicePersonaId` 进 `VOICE_SETTINGS_KEYS`（contracts/voice.ts additive，12→15 键——与 9.7.3/9.7.5 两键同批）+ validationAppSettings persisted/patch + protocol.ts wire 面，parity 单测自动覆盖（§9.6.2-4 先例）。

#### 9.7.9 实现范围与逐条验收（裁决 g）

**范围清单（`packages/ui/src/voice/` + `settings/VoiceSection.tsx` + shared 契约 additive，零还原文件、零 CLI 改动；对照 §9.6.8 无线协议面）**

| # | 交付物 | 内容 |
|---|---|---|
| V1 | `contracts/voice.ts` + `validationAppSettings.ts` + `protocol.ts` additive | 三键：`ttsVendorVoice: "voiceTtsVendorVoice"`、`announcementLang: "voiceAnnouncementLang"`、`personaId: "voicePersonaId"`（persisted default ""/""/""）+ patch optional + wire 面；parity 单测扩至 15 键 |
| V2 | `voiceTtsPort.ts` additive + `cloudTtsAdapter.ts` 改读 | `VoiceTtsUtterance.vendorVoice?: string`；cloud `body.voice = u.vendorVoice`（:179-181 改）+ test 更新 |
| V3 | `systemVoiceCatalog.ts`（+test） | 9.7.2 三函数（枚举/订阅/过滤） |
| V4 | `voiceComposerEntryState.ts` reader 扩展 | `resolveVoiceAnnouncementVoiceConfig` + `vendorVoice`；新 `resolveVoiceAnnouncementLang`；`voiceAnnouncementPreferences.ts` 透传 |
| V5 | `VoiceSection.tsx` 改造 | system 音色 Select（含自动项/加载占位）+ 试听按钮 + 云音色 Input + 播报语言 Select + 语速草稿态 + persona Select；data-testid：voice-announcement-voice / voice-announcement-voice-preview / voice-vendor-tts-voice / voice-announcement-lang / voice-announcement-rate / voice-persona |
| V6 | `toolBriefPlanner.ts` + `useVoiceAnnouncement.ts` 接线 | `resetSessionState`/`prime`/修剪（9.7.7）+ conversationKey effect 单点接线 |
| V7 | `voicePersonas.ts`（+test） | 目录 + 物化 patch 组装纯函数 + 「自定义」发散判定纯函数 |
| V8 | i18n | 新键（清单见下）进 zh/en + `voiceI18nKeys.ts` additive，三断言守护 |

新 i18n 键（15，清单随 EG-4 惯例属「建议，待拍板」，机制冻结）：`voice.settings.announcement.voice.loading` / `.preview` / `.previewText`；`voice.settings.announcement.lang.label` / `.auto` / `.zh` / `.en`；`voice.settings.announcement.rate.invalidWarning`；`voice.settings.vendor.ttsVoice.label` / `.placeholder`；`voice.settings.persona.label` / `.description` / `.custom` / `.preset.standard` / `.preset.brisk` / `.preset.composed` / `.preset.narration`。

共同门禁照 §9 头（typecheck/lint 实测报告；UI 遵守 DESIGN.md token）。

**验收（断言级）**

- V1：parity 单测字段集合 === VOICE_SETTINGS_KEYS 值集合（15 键）通过；patch 缺省时 persisted default 生效（三键均 ""）。
- V2-a：given ttsEngine=cloud 且 `voiceTtsVendorVoice` 非空，when 轮尾播报，则每句 POST body.voice === `voiceTtsVendorVoice` 值；given 该键空串，则 body 无 voice 字段（厂商默认）。
- V2-b：given `voiceAnnouncementVoice="Microsoft Huihui"`（系统音色名）且 ttsEngine=cloud，则请求体（mock fetch 断言 JSON.parse(body)）零含该值——跨命名空间冲突构造性消除。
- V2-c（system 回归）：given ttsEngine=system，则 utterance.voice 精确匹配 `voiceAnnouncementVoice`（speechSynthesisTtsAdapter.test.ts 既有用例全绿）。
- V3-a：given getVoices() 同步返回含 zh-CN/en-US/ja-JP 音色，则 Select 选项 = 「自动」+ zh*/en* 两前缀命中项，ja 项不出现；given 全部音色均非 zh*/en*，则选项 = 「自动」+ 全量列表（回落断言）。
- V3-b：given 首帧 getVoices() 返回 []，则选项仅「自动」+ 禁用加载项；when voiceschanged 触发，则选项刷新为完整过滤列表；组件卸载后订阅已退订（listeners 计数断言）。
- V3-c：given 选中「自动」→ 持久值 `voiceAnnouncementVoice === ""`；given 选中具体项 → 持久值 === 该音色 name 原串。
- V4-a：given `voiceAnnouncementLang === ""`，则 utterance.lang === UI locale（现状回归：wiring 注入 `localeRef.current` 零改动（useVoiceAnnouncement.ts:266-269），lang 透传既有钉住面为 turnSpeechPlanner.test.ts:130/:217——config.lang → utterance.lang）。
- V4-b：given `voiceAnnouncementLang === "en-US"` 且 UI locale=zh-CN，则 utterance.lang === "en-US"。
- V4-c：given ttsEngine=cloud，则请求体不含 language 类字段（v1 不映射回归）。
- V5-a（试听边界）：given inputLeg=idle 且 announcement.phase=idle，when 点试听，则恰一次 speak（文本 === previewText 键值；lang/voice/rate === 当前设置解析值），且 `voiceSessionStore.announcement` 前后快照逐字段相等（不进播报腿状态机）、claim 端口 acquire 零调用（mock 断言）。
- V5-b：given inputLeg="recording"，则试听按钮 disabled（点按零 speak）；given announcement.phase ∈ {speaking, paused, cancelling}，则同 disabled。
- V5-c：given 试听播放中再次点按，则先 cancel 后 speak（preview 实例内重播）。
- V5-d（语速草稿）：given onChange 输入 "0.3"/""/"abc"（中间态），则 updateSettings 零调用；when onBlur 越界值，则草稿回退持久值 + 行内警告渲染；when onBlur "1.5"，则恰一次 `updateSettings({voiceAnnouncementRate: 1.5})`。
- V5-e（草稿同步）：given persona 物化写入 rate=1.3（外部 patch），则语速 Input 显示 1.3（草稿随 settings 重同步）。
- V6-a：given 会话 A 已消化 3 个工具行，when conversationKey 切至会话 B，则 `resetSessionState` 恰调用一次，B 首帧以 prime 消化——B 的终态行零 `consumeBrief` 上交、B 的 running 行正常候选。
- V6-b（首帧/切回防涌入）：given 挂载（或切回）时投影含 10 条历史终态工具行，则零简报上交（修复既有首帧全量首见形态）。
- V6-c（内存有界）：given 同一会话内 turn 推进 N 轮后快照，则 `announcedCountByTurn` 键集 ⊆ 当前快照 turnId 集 ∪ {currentTurnId}（暴露内部态的测试断言或等价行为断言）。
- V6-d：grep 生产代码 `resetTurnCounters` 零命中（死 API 移除干净）。
- V7-a（物化）：given 点选 builtin P，则恰一次 updateSettings，patch 键集 === {voicePersonaId, voiceAnnouncementVoice, voiceTtsVendorVoice, voiceAnnouncementRate, voiceAnnouncementLang} 且值 === P 目录值（空串原样物化）。
- V7-b（零第二读路径）：grep `voicePersonaId` 生产消费方 === VoiceSection 显示派生单处；planner/adapters/readers 零命中。
- V7-c（自定义派生）：given 选 P 后手改语速，则 SelectValue 显示「自定义」文案且 `voicePersonaId` 持久值仍 === P.id（不回写）；given 四键与 P 逐项相等，则显示 P。
- V7-d（生效粒度）：given 播报 Speaking 中 persona patch 落盘，则当前句以旧配置播完、下一句以新 voice/rate 播（句粒度，无中途重播）。
- V7-e（词表隔离）：given persona=brisk 与 custom 两态，`classifyVoiceDictationFinal("停", "zh-CN")` 输出一致（词表函数零 persona 输入）。
- V8：voiceI18n 三断言守护通过（新 15 键双语一致/非空/占位符同构）。

#### 9.7.10 明确不做与 keptOpen

**本批次不做**：

1. **cloud 试听**——需真实凭据直调厂商（计费）与回放链路评估，与 TV-8 spike 同期；重开条件 = TV-8 完成后随厂商音色枚举（OQ-9）一并裁决。
2. **persona 开场白/称呼模板**——复审 4.2 #2 后半；依赖播报内容白名单表（§4.1）扩行，属内容分级面非配置面，须独立增补再实现。
3. **persona 影响打断词表**——9.7.8-7 裁决；重开条件 = OQ-6 真机数据。
4. **自定义角色的保存/导入/导出**——「自定义」= 手动调底层键的派生态（9.7.8-4），不持久化自定义 persona 对象（避免第二配置真源）。
5. **厂商音色枚举 Select 化与校验**——依赖 OQ-9 抓取；现云音色为自由输入（照 ttsVendorModel 同形态）。
6. **preset cloudVoice 异厂商映射表**——preset 音色按默认厂商音色集落值；异厂商用户走自定义（9.7.8-5）。
7. **voiceschanged 首帧空表触发率与跨平台行为矩阵实测**——语义已由 9.7.2 定义并兜底；实测列 TV-9 校准复审 #2 的 low 定级。

**新增 open 条目**：

| # | 问题 | 为什么暂不裁决 | 重新打开的触发条件 | 责任人角度 |
|---|---|---|---|---|
| OQ-9 | 厂商音色枚举值抓取（附录 D.11 补抓；preset cloudVoice 落值与云音色 Select 化/校验前置） | 需真实凭据拉取各厂商音色列表，静态核验不足 | V7 目录落值前 / 云音色枚举化立项前 | Phase 2 实现者 |
| TV-9 | Windows/Chrome 首播 getVoices 空表触发率 + macOS/Linux voices 加载行为矩阵（校准复审 #2 low 定级） | 需目标运行时实测；本章语义已兜底不阻塞 | V3 实施后随真机验证批执行 | Phase 2 实现者 |

**本轮核验记（2026-10-24，worktree @ 63479ef7 实际执行）**：读码 VoiceSection.tsx（全文 427 行）、speechSynthesisTtsAdapter.ts、cloudTtsAdapter.ts、voiceComposerEntryState.ts、voiceAnnouncementPreferences.ts、useVoiceAnnouncement.ts、toolBriefPlanner.ts、voiceTtsPort.ts、voiceTuning.ts、voiceI18nKeys.ts、contracts/voice.ts、turnSpeechPlanner.ts（:190-200/:340-358）；grep 三组——`voiceschanged` 于 ui src 零命中、`resetTurnCounters` 生产调用方零命中（仅定义/接口文档/测试）、`voicePersona|voice.persona|voice.character` 于 ui+shared src 零命中；validationAppSettings.ts:528-545/:669-681（12 键 persisted/patch）；drora-protocol-v4/rows.ts:211（toolCall status 枚举）；zh-CN.ts:8250-8253（音色/语速既有键）；`git diff 6d754098 HEAD` 实测仅 3 文件（DEBUG 清理 + 两处注释修正）。未执行：单测/E2E 实跑（本章为 spec-only 增补，无实现改动，不触发测试面；复审 5.4 的 246 项基线可作回归参照）。

### 9.9 时间阶段审查修复（2026-10-26）

增补性质：消化 2026-10-26 时间阶段审查 fixPlan 20 项（A 级 M3/M2/H6/H4，B 级 M11/M9/M10/L8/L7，C 级 L1/L2/L3/L4/L6/L9/L10/L13/L14/L11/L12）。**不改写任何既有冻结裁决**（FD-1/2/3、§3.3 互斥表、§3.5、§4.x、§5.3、§9.6/§9.7）；对冻结条款的实现欠账（H6/L4/L14 等）标注为「对齐冻结」而非新裁决；与并行批次的冲突消解集中在 9.9.5。本章为 spec 先行交付物（本批角色只写 spec 不改代码），每条验收均含「回退即红」回归测试要求（删掉修复代码测试必失败）与中文注释修复依据（仓库铁律）；实现批门禁照 §9 头（typecheck/lint 实测报告）。

章节编号与并行批次的关系：**§9.8「生命周期与多 pane 隔离修复（2026-10-24）」属并行批次**（工作树 `D:/workspace/projects/drora-voice-agent`，分支 feat/voice-agent-phase1，未提交），其 spec §9.8 与代码形态本轮实读取证；本 worktree spec 暂缺该章，两批合并时 §9.8 随并行批次入册、本章（§9.9）紧随其后，编号即为此预留。本章所有「并行兼容」注以该实读形态为基线。

证据约定：本章代码锚点全部为 2026-10-26 在本 worktree（分支 feat/voice-audit-fixes，基线 dc2a60fb，`git status` 实测零本地改动）实际读取；并行形态锚点标注「并行」= 该 worktree 未提交 diff 实读。核心锚点：`useVoiceAnnouncement.ts`（469 行全文）、`turnSpeechPlanner.ts`（784 行全文）、`voiceSessionStore.ts`（469 行全文）、`useVoiceDictation.ts`（381 行全文）、`V4ComposerVoiceEntry.tsx`/`DictationPreviewOverlay.tsx`/`webSpeechAsrAdapter.ts`/`voiceAnnouncementClaim.ts`/`toolBriefPlanner.ts`/`resolveAsrAdapter.ts`/`useVoiceComposerEntry.ts` 全文、`SessionPane.tsx` 局部（:849-856/:4593-4615/:5427-5444）、`droraSessionStoreWorkspaceSlice.ts:309-360`、`useComposerTextInsertApplied.ts` 全文、`droraSessionStoreTypes.ts:127-144`、`broadcastService.ts:140-230`/`broadcast.ts:19-50`、`rows.ts:175`、locales zh-CN.ts:8240 / en-US.ts:8716、VoiceSection.tsx（:93-123/:307）。

#### 9.9.1 裁决总表

| id | 一句话裁决 | 冲突消解 | 并行兼容 |
|---|---|---|---|
| M3 | AnnPaused 续播分支按「在播队列身份」分派：null-turnId（权限/简报）恢复队列，不改播 latest 轮尾 | §3.2 AnnPaused 出边前置仅定义于轮尾在播形态，本章增补（9.9.5-1） | F5 prunePermissions/isPermissionPending/unshift 正交叠加 |
| M2 | speaking 分支保留顺延轮尾：clearPauseRequested 后 pendingTail 非空走既有「作废旧只播最新」supersede 路径 | 对齐 §3.3 顺延规则冻结（实现欠账）；对 fixPlan「句界消费」措辞收敛（9.9.5-2） | 并行同分支未改（实读），直接叠加 |
| H6 | 可播终态收窄为 `state === "complete"` 单值，interrupted 移出；截断策略备选否决 | 对齐 §4.1「TurnComplete 终态」冻结（9.9.5-3） | 无涉 |
| H4 | composerTextInsertRequest 单槽改按 `targetSessionId ?? ""` 多槽 + 同槽 append 合并 | §3.1「composer 唯一写入通道」不变，通道内寻址扩展（9.9.5-4） | §9.8.1 定向命令同构，无方向冲突 |
| M11 | useVoiceAnnouncement 增 isWebRemoteControl 门（SessionPane 传 compactForRemoteControl），消费全停 | 对齐 §8.2/§8.3 冻结与 §9.8.3「远控壳仍隐藏入口」（补全覆盖缺口） | 并行未动消费门（实读） |
| M9 | 入口隐藏 = 持有者定向停止（abort 引擎 + store 出腿），不卸载 hooks | §6.1 reader 收口哲学的输入腿对称项（9.9.5-5） | 复用 §9.8.1 终止清理序列（幂等），不建第二清理路径 |
| M10 | 凭据三态进 cloud 路由判定，消除 `?? "unknown"` 占位；三层（路由/适配器/回退）统一凭据真实状态 | §9.6.5-2 解析点清单 additive 增补「凭据加载完成」（9.9.5-6） | 并行改引擎路由段，本条在判定输入，合并叠加 |
| L8 | announcedPermissionIds 升 voiceSessionStore 跨 pane 共享账本 + pending 集修剪；owner 交接方案否决 | §3.1 store 单一所有者的回归（播过什么=播报腿状态族） | 与 F5 isPermissionPending 互补（已处理复核 vs 已播去重） |
| L7 | claim unavailable 二分：仅 service 缺席（无仲裁面）降级持有；请求超时/传输失败 unavailable 一律不持有 | 对齐 §3.5-3「以 claim 为准」+ broadcastService.ts:186 自述语义（9.9.5-7） | 并行 lease 形态同义落地（映射语义为准） |
| L1 | requestingMic 两条用户取消出边：持有者再点按、Esc（consumeVoiceRecordingEscape 扩展） | §3.2 RequestingMic→Idle「用户取消」边落地（既有冻结边，零调用方） | 迟到授权清理并归 §9.8.1；卸载出边不重复（并行已接） |
| L2 | 预览条 bound 判定扩至腿活动（requestingMic/recording/injecting）&& 持有者 | §5.2/§5.3 既有键激活，零语义变化 | 与 L6 同源判定共用 |
| L3 | Esc 窗口监听注册条件去 canStop 前置；handler 内 canStop 守卫后置 | §4.4 优先级 3 的覆盖缺口补全，优先级 4 语义不变（9.9.5-8） | 并行未改 SessionPane（实读清单） |
| L4 | 自发 onend 看门狗：settle 窗内 trailing final 照常、窗尽 dead+停轨+onError("no-speech") | 对齐 §5.3「onend 无结果→同静音超时」冻结（实现欠账） | abort/resolveStop 路径不重复（并行已修） |
| L6 | Entry 停止图标/预览/脉冲统一换轨 `recordingOwnerEntryId === entryId` | FD-6 冻结语义的正确实现（store :85 注释明言按实例区分） | store 侧零改动（并行未动该字段） |
| L9 | planner 埋 turn.start/sentence.boundary/pause/resume 四类 voice.tts debug 事件（零文本载荷） | §7.1 voice.tts debug「句边界 boundary 事件」槽位落实 | 并行仅新增 claim warn（实读），时序槽位归本条 |
| L10 | 选型/适配器创建异常 → voice.asr **error** + failMicRequest；start 失败槽位 voice.entry→voice.asr warn | §7.1 槽位表对齐（error=创建失败致入口不可用原文） | 无涉 |
| L13 | cloudFallback 恢复签名拼入凭据指纹（二值，不落日志） | §9.6.5-3「用户修复凭据后恢复」自述条款兑现 | 并行改引擎路由段，本条在签名 effect，无重叠 |
| L14 | drainPending 入口开关检查：关闭即清 pendingByTool | 对齐既有冻结验收「开关关闭时零简报」（§9.4/§9.6.8-S5） | 并行未动 toolBriefPlanner（实读清单） |
| L11 | 确认门两入口时序不对称**记档为有意设计**（设置=确认即生效；mic=确认即中止需再点按），零代码 | FD-5/§9.2 验收原文两处已各自冻结，本章合并显式化 | 无涉 |
| L12 | remote ASR 文案去「即将支持/coming soon」，键名不动 zh/en 同步 | §9.6 已实现能力与文案矛盾的修正 | 无涉 |

#### 9.9.2 A 级：时序正确性（M3/M2/H6/H4）

**M3+A：notifyUserRecordingEnded AnnPaused 分支——null-turnId 在播恢复队列而非改播 latest 轮尾**

- 现状证据：`turnSpeechPlanner.ts:566-591`——`referenceTurnId = pendingTail?.turnId ?? announcedTurnId`（:569）；权限/简报专用起播走 `ensureClaimAndSpeak(null, …)`（:505/:336）使 `announcedTurnId = null` → `stillCurrent` 恒 false（:570-571 null 不等于任何 turnId）→ 落 tailSuperseded 分支：作废在播队列、改播 latest 轮尾（:583-590）。后果：被打断权限段剩余句永失——`announcedPermissionIds` 在 consumePermissionSegment 入口已记（:648-651），不重播；且 latest 轮尾多为旧正文，重播无信息量。
- 裁决机制：**状态迁移**——AnnPaused 分支新增前置子分支：`pendingTail == null && announcedTurnId == null`（在播队列无轮尾身份=权限/简报段）时跳过轮尾比对，直接续播：`control.resumeSpeaking()` 成功 → `speakCurrent(control.snapshot())` 续播剩余句（句序号/`permissionWindow`/uninterruptible 覆盖原样保留，句界拼接继续消费 `pendingPermissionSegments`）；claim 仍持（FD-2 持约态）。**顺延轮尾排空点（新增）**——`pendingTail != null && announcedTurnId == null`（录音期间另有新轮尾就绪）时同样先续播权限队列、`pendingTail` 保留不清；planner 的 onDone annIdle 分支在 `drainPendingPermissionFromIdle()`/`drainPendingBriefFromIdle()`（:431-432）之后追加 `drainDeferredTail()`：相位仍 AnnIdle 且非 recording 时重读 `getFocusedTurnTail(null)`、仍最新则 `ensureClaimAndSpeak` 起播（与 :599-608 顺延起播同款新鲜度校验）；`ensureClaimAndSpeak` 的 finally（:478-482）同批追加该排空调用。**守卫**——resumeSpeaking 的 claimHeld 前置（voiceSessionStore.ts:419-423）不变；renew=false 已先回 AnnIdle（§3.5-3）。**数据**——pendingTail/permissionWindow/句序号维持 planner 实例瞬态（§3.1），零新 store 字段。
- 并行兼容（partial）：合入 §9.8/F5 形态后——(a) 续播前先 `prunePermissions()`（并行形态：按 `deps.isPermissionPending?.(id) !== false` 过滤 `pendingPermissionSegments`，已处理段不复活），与 §9.8.2「开播前复核请求仍 pending，已处理者作废」同向；(b) F5 的 `pendingPermissionSegments.unshift(...opts.permissionSegments)` 顺延形态发生在「起播链在飞遇录音」路径（并行 ensureClaimAndSpeak 内），与本条「录音结束的续播路径」正交，两者都保留；(c) F5 在本函数尾部的 `schedulePermissionDrain()/scheduleBriefDrain()` 保留，`drainDeferredTail()` 排其后。
- 验收（回退即红）：
  - given 权限段播至第 2/4 句开录（sentenceCompleted→annPaused）、录音 8s 结束且无新轮尾，则自第 3 句续播、uninterruptible 覆盖 3-4 句、零改播轮尾（mock tts 断言播报序列 === 权限句 3、4，getFocusedTurnTail 的返回不产生任何 speak）；删除该子分支则测试红（落 tailSuperseded 改播 latest）。
  - given 同场景但录音期间新轮尾 T2 就绪（pendingTail=T2），则序列 === [权限句3, 权限句4, T2 句1…]（权限先、正文后，FD-3 顺序断言）。
  - given（合入 F5 后）权限 P 已处理（isPermissionPending(P)=false），则 P 的剩余句不复活。
  - 回归：announcedTurnId 非空的既有 AnnPaused 续播/改播用例（turnSpeechPlanner.test.ts 既有）全绿。

**M2+A：notifyUserRecordingEnded speaking 分支——不再无条件清 pendingTail**

- 现状证据：`turnSpeechPlanner.ts:593-598`——`clearPauseRequested(); pendingTail = null;`。录音短于一句（暂停请求未在句界生效）结束时顺延轮尾被无条件丢弃：T2 永不播（wiring 的 `lastConsumedTurnRef` 已在 consumeTurnTail 前标记消费，useVoiceAnnouncement.ts:320-324，不会重发）——违反 §3.3 顺延规则冻结「录音结束时该轮尾仍最新 → 起播」。
- 裁决机制：**状态迁移**——speaking 分支保留 `clearPauseRequested()`（撤销未生效暂停，正常续播语义不变）；`pendingTail` 非空时执行与 consumeTurnTail speaking 分支（:543-546）完全同款的「作废旧轮尾只播最新」：`deps.tts.cancel()` + 重读 `getFocusedTurnTail(null)` + `ensureClaimAndSpeak(latest)`——实现上把该块提为私有函数供 AnnPaused「改播最新」段（:580-590）与本分支共用（单一 supersede 代码路径，不复制第三份）。**对 fixPlan 措辞的收敛（如实记档）**：fixPlan 原文「交由句界/pause 流程消费」——句界流程的 pause 已被 clearPauseRequested 撤销、录音已结束无再触发点，唯一与 §3.3 冻结表一致的确定性归宿是立即 supersede（非录音态轮尾到达 speaking 的既有冻结行为就是立即 cancel 当前句，:543-546）；「等下一句界再换」会引入冻结表中不存在的第二种 supersede 时序，故不采。
- 并行兼容：并行形态该分支与基线逐字一致（实读），直接叠加；F5 以 `isRecording()` 代换 `recording` 变量后语义不变。
- 验收（回退即红）：
  - given speaking 播 T1 第 2/5 句时开录又立即结束（句界未到，pauseRequested 已置未生效）且录音期间 T2 就绪，则 tts.cancel 恰一次（T1 第 2 句中止）+ T2 全文起播（speak 序列 === T2 各句）；
  - given 同场景无 T2，则 clearPauseRequested 后 T1 自第 3 句原序续播（零 cancel、零新起播）；
  - 回退即红：恢复 `pendingTail = null` 则 T2 用例红。

**H6+A：interrupted 移出可播终态**

- 现状证据：`useVoiceAnnouncement.ts:92`——`latest.state !== "complete" && latest.state !== "interrupted"` 跳过，即 interrupted ∈ 可播终态（:82 注释自述「terminal = complete|interrupted」）；`rows.ts:175` 枚举 `state ∈ {streaming, complete, interrupted, failed}`，interrupted = 停止生成打断的半截正文——整段播报半截正文。冻结 §4.1 播级表「轮尾正文……TurnComplete 终态后整段分句播」与 §3.2「轮尾终态就绪（TurnComplete）」从未包含 interrupted；§3.2 Cancelling 出边「TurnComplete(cancelled) 后 AnnIdle 且不再播」。
- 裁决机制：**守卫**——`resolveFocusedAnnouncementTail` 终态判定收窄为 `latest.state !== "complete"` 单值跳过（仅改该行判定 + 注释，:82 注释同步改「terminal = complete」）。「按半截正文截断策略播报」的备选**否决**：属 §4.1 白名单表新增播级内容形态（截断标记文案、粒度规则均未定义），须按白名单闭集原则独立增补拍板，本批不做；重开条件 = 产品明确要求播报被打断轮次。
- 冲突消解：无冻结冲突——本条是把实现欠账对齐 §4.1/§3.2 冻结文字，非语义变更（9.9.5-3）。
- 验收（回退即红）：
  - given 轮尾 state=interrupted 且文本非空，则零 consumeTurnTail（resolveFocusedAnnouncementTail 返回 null）；
  - given state=complete 同文本，则正常消费（既有用例回归）；
  - given Cancelling 相位收到 TurnComplete（consumeTurnTail :527-531 路径），行为零变化（cancelled 完成信号与可播终态解耦回归）；
  - 回退即红：判定改回双值则 interrupted 用例红。

**H4+A：composerTextInsertRequest 单槽 → 按目标多槽 + 同槽 append 合并**

- 现状证据：`droraSessionStoreWorkspaceSlice.ts:319-337`——workspace 桶内单槽 `composerTextInsertRequest`，任何新 request 直接覆盖（latest-wins）；消费门 `SessionPane.tsx:5429` `focused && (targetSessionId ?? null) === (sessionId ?? null)`——失焦 pane 的 final 留槽期间，被任何后续插入（他会话 final、草稿 mention 预填等）覆盖即丢，语音侧仅剩 FD-4 手动恢复菜单；`useComposerTextInsertApplied.ts:32-39` 以全局 `composerTextInsertVersion > requestId` 判 superseded，同样只认「最新」。该 applied 布尔有真实 await 消费方（2026-10-26 评审修订轮核验）：插件推荐流 `ConversationDraftSuggestedPromptsContainer.tsx:498-503` 将其传入 `finishMutation`，`:319-330` 以 `succeeded ? "Succeeded" : "Failed"` 弹结果 popover；第二消费点 `:675-690` `if (!applied)` 清反馈静默返回——谓词误报 false 是用户可见的「失败」弹层，非纯诊断信号。
- 裁决机制：**数据保在哪**——droraSessionStore workspace 桶内 `composerTextInsertRequest: ComposerTextInsertRequest | null` 演进为 `composerTextInsertRequests: Record<string, ComposerTextInsertRequest>`，槽键 = `targetSessionId ?? ""`（空串=草稿 composer 槽，既有非语音生产方语义原地保留）；`composerTextInsertVersion` 保持全局单调递增（requestId 唯一性来源不变，消费幂等键不变）。**状态迁移**——`requestComposerTextInsert` 按槽写入；**同槽叠加且新旧 mode 均 `"append"` → 合并为单请求**：`text = 旧.text +（旧.text 尾字符非空白则补一空格，否则直连）+ 新.text`（与 §2.4 消费端空格规则同款确定性规则，在合并点先行应用；requestId 取新 version，mention 不参与）；非 append 叠加维持槽内 latest-wins（mention 预填/replace 族行为逐字段不变）。**消费**——SessionPane 选择器按 `sessionId ?? ""` 读槽（:1679-1681 改造），focused 门保留（:5429 不变）；`clearComposerTextInsertRequest(workspacePath, requestId, identity)` 扫槽按 requestId 清除（签名不变）。`useComposerTextInsertApplied` 判定改（**2026-10-26 评审修订：弃用全局 version 比较，以槽态区分**——原稿谓词「superseded = `version > requestId && 全槽无该 requestId` / applied = `version === requestId && 该槽已清`」在跨槽并发交错下把「已成功消费」误判 superseded：`composerTextInsertVersion` 是全局单调计数（slice :325-329），任何**其他槽**的新请求（如语音 final 注入他会话槽）在该请求创建与消费之间 bump version，都会使一个被正常消费、槽已清的请求落入 superseded 分支，向插件推荐流误弹 Failed popover——现状单槽下同交错会真丢请求（Failed 报告准确），多槽化救回了插入本身而谓词仍报 false，属新设计内部不一致；原稿豁免注只覆盖同槽 merge 场景，未覆盖此多槽化新引入的常态并发）。修订后机制：hook 回调签名 additive 槽键参数（发送方传自己写入的 `targetSessionId ?? ""`，与 requestComposerTextInsert 的 targetSessionId 缺省语义同构；requestId 全局唯一故扫槽无歧义）；inspect 判定序——① 槽内 requestId === 本 id → pending 继续等；② 本 id 已不在槽且**该槽为空** → applied（依据：消费 clear 与任何后续写入是两个独立 set，Zustand 订阅同步触发，inspect 在 clear set 上即 settle 为 applied，不会观察到「清除后新写入」复合态；promise 创建与 inspect 首跑之间的同步间隙内不可能完成消费+新写入——消费依赖 effect/re-render 异步任务）；③ 该槽内是**更晚** requestId（同槽 replace 替换或 append 合并）→ superseded（合并场景旧发送方判 superseded 语义保留——语音 fire-and-forget 无消费方，可接受；replace 族未消费替换亦判 superseded，与现状语义一致）。全局 version 仅作 requestId 发号来源，**不参与** applied/superseded 判定；abort 路径（handleAbort）finish(false) + 扫槽清除本 id，语义不变。
- 冲突消解（9.9.5-4）：§3.1「composer 正文唯一写入 = composerTextInsertRequest 通道」不变——多槽是通道内寻址扩展，非第二写路径；§2.4 冻结（mode/消费门语义）零改动。
- 并行兼容：§9.8.1「定向命令携带捕获的 workspace/session 目标」以 (workspace, session) 寻址——与本条槽键同构，方向一致；voiceSessionStore 侧零改动。
- 验收（回退即红）：
  - given 会话 A 听写 final 落槽后焦点切至 pane B、B 会话 final 到达，则 A 槽保留、B 槽独立写入；焦点回 A 时 A 消费恰一次且文本 === A 的 final（旧单槽实现下该断言红：A 槽被 B 覆盖）；
  - given 同会话（同槽）同 tick 两句 final，则合并为一次插入、正文 === 句1+一空格+句2（尾空白时直连）；
  - given 草稿槽 mention 预填连续两次（replace 族），则行为与现状逐字段一致（既有测试全绿）；
  - given 草稿槽插件预填 R1（id=5）等待期，语音 final 注入会话 A 槽（id=6，全局 version=6），随后草稿 composer 消费并清除 R1，则 waitForComposerTextInsertApplied(R1, 草稿槽) resolve **true**（finishMutation 收 succeeded=true，零 Failed popover）——谓词若按全局 version 比较则该断言红（version=6>5 且全槽无 5 → 误判 superseded）；
  - given 同槽更晚请求替换或 append 合并（旧 id 仍在等待），则旧 id resolve false（superseded）；given 调用方 abort，则 resolve false 且该 id 已从槽中清除；
  - 回退即红：槽结构退回单槽则跨会话保槽用例红；谓词退回全局 version 比较则跨槽交错用例红。

#### 9.9.3 B 级：边界与状态所有者（M11/M9/M10/L8/L7）

**M11+B：播报腿挂载 isWebRemoteControl 门控**

- 现状证据：`SessionPane.tsx:849-856`——`useVoiceAnnouncement` 无条件挂载（无远控门）；mic 入口已有（V4ComposerVoiceEntry `isWebRemoteControl` → view 不可见，§9.2 验收「given isWebRemoteControl……mic 入口不渲染」）；SessionPane 自持 `compactForRemoteControl` 事实（:378 props/:626/:5441 传 ConversationComposer）。
- 裁决机制：**守卫加在哪**——`UseVoiceAnnouncementParams` additive `isWebRemoteControl?: boolean`（SessionPane 传 `compactForRemoteControl`）；hook 内全部消费 effect（轮尾消费 :307-325、focused 切换停止 :330-335、腿互斥转发、权限段消费 :404-419、简报快照 :423-452）以 `focused && !isWebRemoteControl` 为门——hook 保持整挂载（hook 顺序稳定），planner/claim/TTS 实例照常创建但零消费零出声。对齐冻结 §8.2（手机 replayable 播报 = 手动触发的本地 TTS，Phase 2 才做；自动播报腿属 desktop-continuous 语义）、§8.3（受控远控壳约束）与 §9.8.3「远控壳仍隐藏入口」——本条是同一冻结在播报腿上的覆盖补全，非新裁决。
- 验收（回退即红）：
  - given compactForRemoteControl=true 的 pane 有就绪轮尾 + pending 权限 + 新工具行 + 播报开，则零 consumeTurnTail/零 consumePermissionSegment/零 consumeBriefSegment/零 claim.acquire/零 tts.speak（mock deps 断言）；
  - given compactForRemoteControl=false（桌面），既有 §9.3 验收全量回归；
  - 回退即红：去掉门参数则远控用例红。

**M9+B：录音中设置隐藏入口 → 持有者定向停止（不卸载 hooks）**

- 现状证据：`V4ComposerVoiceEntry.tsx:129`——`if (!view.visible) return null` 位于全部 hooks 之后：录音中把 `voiceComposerEntryHidden` 设回隐藏，组件仍挂载、录音腿继续、本组件内的预览条（:194-203）与停止按钮一并消失——无入口的继续拾音。
- 裁决机制：**定向停止而非卸载**。`useVoiceDictation` 参数 additive `entryVisible?: boolean`（useVoiceComposerEntry 传 `view.visible`）；hook 内 effect 监听 true→false 沿：若 `useVoiceSessionStore.getState().recordingOwnerEntryId === 本实例 entryId`——recording 态：`generationRef+1` → `sessionRef.current?.abort()`（停引擎/音轨）→ `cleanupSession()` → `store.stopRecording()`（partial 丢弃、无 notice——隐藏入口是用户显式动作）；requestingMic 态：`store.cancelMicRequest()` + `generationRef+1`（迟到授权由既有守卫 useVoiceDictation.ts:338-346 丢弃）。非持有者实例零动作（他人 pane 入口隐藏不停别人的录音——FD-6 边界同源）。**为什么不是「真正卸载 hooks」**：可见性判定收口在 voiceComposerEntryState 纯函数（组件内部），父级条件渲染会复制门控逻辑成第二判定源；且真实卸载语义（含迟到授权资源释放）由 §9.8.1 定义且幂等——本条接入同一终止清理序列，不建第二条卸载路径。与 §6.1 reader 收口哲学对齐：播报开关关闭 → notifyStopPressed（useVoiceAnnouncement.ts:391-400）的输入腿对称项。
- 并行兼容：§9.8.1「错误、超时、卸载共用终止清理，重复调用幂等」——合入后本条 effect 的清理体替换为对 §9.8 终止清理函数的调用（触发条件不同：可见性丢失 vs 卸载）。
- 验收（回退即红）：
  - given 本入口持有 recording 且设置隐藏入口，则 view.visible=false 后：inputLeg=idle、session.abort 恰一次、partialText=""、零 notice、getUserMedia 音轨 stop（mock 断言）；
  - given 他 pane 持有录音、本入口隐藏，则录音腿与引擎会话不受影响；
  - given requestingMic 中隐藏，则 cancelMicRequest 即时生效（不等 10s 超时；超时计时器同步清除——subscribe effect :161-164 既有清理）；
  - 回退即红：移除该 effect 则隐藏用例红（inputLeg 恒 recording）。

**M10+B：消除 apiKey 'unknown' 占位，三层判定统一凭据真实状态**

- 现状证据：`useVoiceAnnouncement.ts:197`——`apiKey: cloudApiKeyRef.current ?? "unknown"`：凭据未加载（null）被占位为非空串 → `isVoiceVendorConfigComplete`（resolveAsrAdapter.ts:42-55）判「档完整」→ cloud 被乐观选择 → `cloudTtsAdapter` 的 `getVendorConfig`（:153-165 真读凭据）返回 null → 单句失败 → 连续 3 句（`VOICE_TTS_CLOUD_CONSECUTIVE_FAILURES`）→ 会话内静默回落 system（§9.6.5-3）——启动期凭据竞态可造成整会话降级，UI 零反馈。§9.6.2-5 冻结谓词 `apiKey.trim()` 非空隐含「凭据已加载」前提，未定义未加载态。
- 裁决机制：**三态判定**——`cloudApiKeyRef: string | null` 语义细化为 null=未加载（含已加载确认缺失），非空=已加载且有效。三层统一：(1) **路由层** `resolveTtsEngineNow`（:184-206）：`engine=cloud && baseUrl/model 完整 && 凭据已加载且非空` 才判档完整选 cloud；未加载 → 本次解析 system，`voice.tts` info 记一次 `tts engine resolved: system (credential pending)`（沿用 :200-204 一次性日志形态）；(2) **适配层** `cloudTtsAdapter.getVendorConfig` 真读兜底不变；(3) **回退层** 连续失败计数只在 cloud 被真实选择后可能发生——占位消除后构造性满足（未加载期根本不进 cloud 管线）。**凭据加载完成 = 新解析点**：加载 effect（:231-243）完成时驱动重渲染（ref 升 state 或 credentialVersion 计数器），下一句 speak 按最新状态解析——§9.6.5-2 括注「speak 路由以最新解析结果执行」本就允许逐句路由，非新增时序面（9.9.5-6 记 additive 增补）。**grep 断言**：voice 模块生产代码零 `"unknown"` 占位字面量（该用途）。
- 验收（回退即红）：
  - given ttsEngine=cloud、baseUrl/model 完整、凭据未加载，则首句解析结果 = system（info 恰一次 credential pending）；when 凭据加载完成且非空，则下一句起走 cloud（mock fetch 恰一次 POST /audio/speech）；
  - given 凭据加载完成但为空串，则持续 system，且 `cloudFallbackRef` 保持 false（未加载/缺失期零连续失败计数——mock cloudTts 断言 onConsecutiveFailures 零触发）；
  - 回退即红：恢复占位则「未加载→system」与「零回落计数」两断言红。

**L8+B：announcedPermissionIds 升 voiceSessionStore 跨 pane 共享**

- 现状证据：`turnSpeechPlanner.ts:226`——`const announcedPermissionIds = new Set<string>()` planner 实例级；每 SessionPane 一个 planner（useVoiceAnnouncement.ts:17-18 注释、:253-278 useMemo）——切 focused 至另一 pane 后新 planner 的 Set 为空 → 同一 pending 权限整段重播。
- 裁决机制：**数据保在哪**——voiceSessionStore 新增字段 `announcedPermissionIds: Set<string>` + guarded actions `hasAnnouncedPermission(id)` / `markPermissionAnnounced(id)` / `pruneAnnouncedPermissionIds(currentPendingIds: ReadonlySet<string>)`；planner 的 `consumePermissionSegment` 去重查 store（写经 action，单一写路径红线保持——§3.1 冻结「播报腿状态所有者 = voiceSessionStore」：已播账本是播报腿状态族，归 store 是对该冻结的回归）。**修剪**——wiring 在 pendingInteractions 变化时 prune 至当前 pending id 集（账本有界；权限离开 pending 后 wiring 不再消费该 id，剪除安全）。**作用域 = 窗口内跨 pane**，不跨窗口（跨窗口单播报者由 §3.5 claim 决定只有一窗出声）。**备选「owner 交接」否决**：需要定义 owner 迁移时账本随交协议，复杂度高于 store 字段；§9.8 owner 凭证只仲裁「谁在播」不承载「播过什么」，正交。
- 并行兼容：F5 的 `isPermissionPending`（开播前复核已处理）与本条（已播去重）互补——前者防「已处理仍播」，后者防「未处理重播」；合入后两者都保留。
- 验收（回退即红）：
  - given pane A 播完权限 P（P 仍 pending）后 focused 切至同 workspace pane B，则 B 的 planner 零重播（store.hasAnnouncedPermission(P)=true，mock tts 断言零 P 文本 speak）；
  - given P 离开 pending 集，则 prune 后账本不含 P（暴露内部态断言或等价行为断言：P 再次进入 pending 时会重新播）；
  - given 新权限 Q 到达，则正常播（既有用例回归）；
  - 回退即红：退回实例级 Set 则切 pane 用例红。

**L7+B：voiceAnnouncementClaim 区分两类 unavailable**

- 现状证据：`voiceAnnouncementClaim.ts:47-49`（acquire）与 :71（renew）——`return result.status === "unavailable"` → 视为持有（乐观降级）。而服务层 `broadcastService.ts:185-196`（超时路径，`BROADCAST_CLAIM_TIMEOUT_MS = 2_000`，:16）注释明示「**claim 超时不能乐观播放；Main 可能已经把同一 key 授予另一窗口**。迟到的 acquired 结果会在消息处理器中按 token 主动 release」、:210-216（postMessage throw）同族——即经由非空 broadcastService 出现的 unavailable 只能是超时/传输失败，乐观持有=他窗可能同时持有=双窗叠音，违反 §3.5-3「以 claim 为准校正本地态」与 §3.5 单播报者。真正的「无仲裁面」= `broadcastService` 缺席（适配器 :38-41 null 分支返回 true，本就正确）。
- 裁决机制：**映射收窄**（适配层单处）：acquired → 持有；busy/committed → 不持有（既有）；**unavailable → 不持有**——acquire 侧 planner 维持静默（§3.3「未持有者静默」，info 落 `claim unavailable; staying silent`），renew 侧 false → 既有 claimLost 链（cancel + 回 AnnIdle，§3.5-3）。null-service 降级分支保留不动。**已知代价如实记档**：host 桥启动竞态下首次播报可能静默一次（2s 超时窗），以 claim 真值为准，不做乐观播放、不加超时重试掩盖（AGENTS.md 禁用超时掩盖同步问题）。
- 并行兼容：并行批次已把端口改为 lease 形态（`VoiceAnnouncementLease`、renew/release 按 lease/token，实读并行 diff）——本条是适配层**状态映射**裁决，两种端口形态同义落地（布尔形态：unavailable→false；lease 形态：unavailable→null lease/不持有）。两批同改本文件，合并时以本条映射语义为准（并行 diff 未动 unavailable 映射，实读确认）。
- 验收（回退即红）：
  - given mock broadcastService.acquireClaim 恒 resolve `{status:"unavailable"}`，则 acquire() === false、零 tts.speak、voice.tts info 恰一次；
  - given broadcastService === null（无仲裁面），则 acquire() === true（降级持有回归不变）；
  - 双窗叠音断言：窗 A 恒 unavailable + 窗 B 正常 acquired，则仅 B 出声（A 静默）；回退即红：映射改回 unavailable→true 则 A/B 同时 speak 红；
  - given renew 恒 unavailable，则 cancelAnnouncement("claimLost") + 回 AnnIdle（既有链回归）。

#### 9.9.4 C 级：可达性、日志与文案（L1/L2/L3/L4/L6/L9/L10/L13/L14/L11/L12）

**L1+C：requestingMic 用户取消出边（Esc / 持有者再点按）**

- 现状证据：store 动作 `cancelMicRequest` 已存在（voiceSessionStore.ts:273-279，RequestingMic→Idle）但生产代码零调用方（grep 实测仅定义/注释命中）；`toggleMic` 在 requestingMic 态再点按走 `startMicRequest` 被 store 拒绝=静默 no-op（useVoiceDictation.ts:284-290）；`consumeVoiceRecordingEscape` 只认 recording（voiceSessionStore.ts:197-204）→ requestingMic 期 Esc 死键，唯一出路是 10s 超时（§5.3）。§3.2 输入腿冻结图 RequestingMic→Idle 出边已含「用户取消」，本条是落地该边。
- 裁决机制：**状态迁移**——(1) 再点按：`toggleMic` 在 `inputLeg === "requestingMic"` 时，`recordingOwnerEntryId === 本实例 entryId` → `cancelMicRequest()` + `generationRef+1`；非持有者点按维持 no-op（不代取消他人的请求，FD-6 边界同源）。(2) Esc：`consumeVoiceRecordingEscape` 扩展为两段：recording → stopRecording()（既有）；requestingMic → cancelMicRequest()。两接缝（ConversationComposer.tsx:2835 `onVoiceRecordingEscape` 与 SessionPane.tsx:4604 窗口监听）共用该消费函数，自动获得。**迟到授权**：既有守卫 useVoiceDictation.ts:338-346（inputLeg 已非 requestingMic → session.abort()）覆盖；generation 同步失效对齐 §9.8.1「RequestingMic 的迟到授权也须释放资源」——合入并行形态后由其终止清理统一覆盖。**卸载出边不做**（并行批次已接，按 fixPlan 明示勿重复）。
- 验收（回退即红）：
  - given requestingMic，when 再点按持有入口，则 inputLeg=idle、迟到授权被 abort（fake 授权延迟到达断言）、零 notice；
  - given requestingMic，when Esc（composer 内或对话区焦点），则同结果且零 v4 stop、零停生成；
  - given 非持有者入口点按，则维持 requestingMic（不代取消）；
  - 回退即红：移除两条出边则对应用例红。

**L2+C：DictationPreviewOverlay requestingMic 文案可达**

- 现状证据：Overlay 自身已支持（DictationPreviewOverlay.tsx:48 active 判定含 requestingMic、:68-69 渲染 `voice.dictation.requestingMic`，键已落 locales）；不可达根因在 Entry 传参——V4ComposerVoiceEntry.tsx:196 `bound={recording && isBoundEntry}`，而 `recording` 仅认 `inputLeg === "recording"`（:133）→ requestingMic 期 bound=false → active=false → 文案零可见帧。§5.3「权限对话框被忽略/折叠 → 10s 超时」期间请求麦克风无任何可见反馈。
- 裁决机制：**守卫加在 Entry 的 bound 计算**（Overlay 纯函数零改动）：`bound = 腿活动（requestingMic/recording/injecting）&& isOwner`（isOwner 见 L6：`recordingOwnerEntryId === dictation.entryId`；requestingMic 期 store 已设 recordingOwnerEntryId，voiceSessionStore.ts:264-270，天然成立）。
- 验收（回退即红）：given requestingMic，则持有者入口渲染预览条且文案 === voice.dictation.requestingMic 键值（zh/en 双语断言）；授权转 recording 后文案切换为 partial/hint；非持有者入口零活动段渲染；回退即红（恢复 recording-only 判定则 requestingMic 用例红）。零新 i18n 键（既有键激活），voiceI18nKeys 守护零变化。

**L3+C：SessionPane Esc 窗口监听注册条件扩展至无任务态**

- 现状证据：`SessionPane.tsx:4593-4595`——`if (!focused || readOnly) return; if (!sessionId || !snapshot?.control.canStop) return;`：无任务态（canStop=false）整个窗口监听不注册 → 焦点在 composer 外时 Esc 死键；语音优先消费（:4604 consumeVoiceRecordingEscape，§4.4 优先级 3）随之失效——录音中但无任务运行 + 焦点在对话区 → Esc 停不了录音。
- 裁决机制：**注册条件**收窄为 `focused && !readOnly && sessionId`（去 canStop 前置）；**handler 内后置守卫**：语音优先分支不变；其后的停生成分支加 canStop 现值守卫（经 ref 读，避免注册随快照抖动重挂）——canStop=false 时原样 return（不 preventDefault、不 handleStop），保持「无任务态无消费者 → Esc 无动作」的现状语义（§4.4 优先级 4「非录音态既有语义不变」）。
- 冲突消解（9.9.5-8）：§4.4 冻结仲裁表优先级 3 的实现覆盖缺口补全；与 §9.8.1 Esc=丢弃式 abort 正交（那是消费后的清理语义，这是监听注册条件）。
- 验收（回退即红）：
  - given 录音中、canStop=false、焦点在对话区（composer 外），when Esc，则录音停止、零 v4 stop、event.preventDefault 恰一次；
  - given 无任务无录音，when Esc（composer 外），则零动作零 preventDefault（现状回归）；
  - given canStop=true 既有停生成路径全量回归（§4.4 既有验收）；
  - 回退即红：恢复 canStop 注册前置则第一条红。

**L4+C：webSpeechAsrAdapter 自发 onend 看门狗**

- 现状证据：`webSpeechAsrAdapter.ts:223-231`——非 stopping 的 onend（引擎自发断流）：「不自动重启（§5.3），也不判死——等待调用方 stop()/abort() 或 error 事件定论」→ 引擎已停但 store 停在 recording、`closeSession` 未调用（getUserMedia 音轨未停）→ Recording 悬挂 + 麦克风持续占用。与冻结 §5.3「aborted/onend 无结果 → 同静音超时处理」直接相悖（实现欠账）。
- 裁决机制：handleEnd 非 stopping 分支加看门狗：arm `VOICE_ASR_SPONTANEOUS_END_SETTLE_MS`（voiceTuning 新常量，与 `VOICE_ASR_STOP_SETTLE_TIMEOUT_MS`（:36，2000ms）同量级、独立命名；调参面不冻值）——窗口内 trailing final（部分平台 end 先于 final 派发）照常经 onFinal 交付并顺延看门狗；窗口内 error 走既有 handleError；窗口耗尽仍无定论 → `dead = true` + `closeSession`（停轨）+ `onError(new VoiceAsrError("no-speech"))`——输入腿经 useVoiceDictation.ts:358-374 既有映射 `abortRecording("aborted")`（同静音超时：提示 + 不自动重启，§5.3）。abort()/stop() 清理点（:242-247/:289-303）同步清该定时器。**abort/resolveStop 相关路径不重复实现**（并行已修，按 fixPlan 明示）。
- 验收（回退即红）：
  - given fake 引擎 start 后无 error 直发 end 且 settle 窗内无后续事件，则看门狗到期：onError("no-speech") 恰一次、音轨 stop 恰一次、inputLeg=idle + aborted notice；
  - given end 后窗内补发 final，则该句正常交付、看门狗顺延、腿不中止；
  - given stop() 后 onend（既有 stopping 路径）行为零变化（既有用例回归）；
  - 回退即红：移除看门狗则悬挂用例红（inputLeg 恒 recording、音轨未停）。

**L6+C：V4ComposerVoiceEntry 停止图标/预览/脉冲按 recordingOwnerEntryId 区分**

- 现状证据：`V4ComposerVoiceEntry.tsx:133`（recording 判定）/`:135`（isBoundEntry）/`:196`（Overlay bound）/`:219`（sr-only 指示）全按 `boundSessionId === sessionId`——同会话主/辅 pane 双入口全部命中 → 停止图标/预览条/指示双显（违反 §9.2 FD-6 验收「partial 只出现在 A 的预览条」）；脉冲更宽（:77-88）：任何挂载入口在 inputLeg==="recording" 时都高亮（含他会话录音——违反 FD-6「持有录音指示的入口短暂高亮」原语义）。store 已备 `recordingOwnerEntryId`（voiceSessionStore.ts:81-86，注释明言「仅按 sessionId 无法区分」）；`entryId` 在 useVoiceDictation 已有（:116-117）但未暴露。
- 裁决机制：useVoiceDictation 返回值 additive 暴露 `entryId`；`useVoiceDictationSnapshot`（useVoiceComposerEntry.ts:126-137）additive 订阅 `recordingOwnerEntryId`；Entry 判定统一换轨 `isOwner = snapshot.recordingOwnerEntryId === dictation.entryId`——停止图标（recording）= `inputLeg === "recording" && isOwner`；预览条活动段 bound（含 L2 扩展）= 腿活动 && isOwner；sr-only 绑定会话名指示同轨；脉冲 effect 仅 isOwner 触发。跨会话入口照旧显示普通 mic（点按走 store 拒绝 + 持有者脉冲）。notice 分支不按 owner 过滤的现状保留（F1 修复的 v1 简化已记档，不在本条范围）。
- 验收（回退即红）：
  - given 会话 S 双 pane A/B、A 开录，则 A 显示停止图标+预览+指示、B 显示普通 mic 且零预览；
  - when 点按 B 的 mic，则 A 脉冲高亮恰一次、B 零脉冲；
  - given 会话 T（他会话）入口挂载，则录音态变化时其图标/预览/脉冲零变化；
  - 回退即红：退回 sessionId 判定则双显与跨会话脉冲用例红。

**L9+C：voice.tts 句界/起播/暂停时序 debug 槽位**

- 现状证据：voice 模块 logger.debug 仅 3 处且全在 voice.asr（grep 实测：remoteAsrAdapter.ts:266、useVoiceDictation.ts:199、webSpeechAsrAdapter.ts:186）；turnSpeechPlanner 零 debug 调用（全文实读）——§7.1 冻结「voice.tts debug = 句边界 boundary 事件」槽位未实现；M2/M3 族时序问题排查零日志。并行批次仅新增 claim warn（实读并行 diff：`announcement claim lost`/`claim request failed`），时序仍零日志。
- 裁决机制：planner 埋 4 类 debug 事件（生产不落盘，§7.1 debug 行落实）：`turn.start`（startSpeaking 落地后：`{turnId: string|null, sentenceCount}`）、`sentence.boundary`（sentenceCompleted 推进后：`{index, total}`）、`pause`（`{phase: "requested"|"effective", index}`——markPauseRequested 时 / sentenceCompleted→annPaused 时）、`resume`（resumeSpeaking 后：`{index}`）。**硬边界**：载荷只含 id/序号/计数，零播报文本（§7.1 隐私边界同源审慎：播报正文亦不落任何日志级别）。
- 验收（回退即红）：given 一次 3 句播报含开录暂停与续播，则 debug 事件序列 === [turn.start, sentence.boundary, pause(requested), pause(effective), resume, sentence.boundary, …]（logger 订阅断言）；断言全部载荷零文本字段；回退即红：移除埋点则序列断言红。

**L10+C：适配器选型/创建失败补 voice.asr error 槽位映射（choice 与 start 失败分离）**

- 现状证据：`useVoiceDictation.ts:301-334` 起录链 `await pickAsrAdapter()` 无 try/catch——`createRemoteAsrAdapter` 构造/选型链 throw = 未处理 rejection（store 悬在 requestingMic 至 10s 超时），零日志（fixPlan「或无日志」即此路径：选型无法给出适配器）；webSpeech start 最终失败落 `logger.warn("voice.entry", …)`（:330）——§7.1 voice.entry warn 槽位语义为「权限拒绝后的再次尝试、sendText 携带 source 被旧 CLI 拒收」，ASR 失败应归 voice.asr。
- 裁决机制：两分映射：(1) **选型/适配器创建异常**（pickAsrAdapter 或适配器构造 throw——「choice=null」语义：选型函数无法产生适配器）→ catch：`logger.error("voice.asr", …)`（§7.1 error 槽位原文「适配器创建失败致入口不可用」；VoiceAsrError 用其 code，未知归 "device"）+ `failMicRequest(映射码)` + `generationRef+1` + `cleanupSession()`——即时出腿，不悬 10s；(2) **start 失败**（适配器已得、起录失败）→ 日志槽位 :330 由 voice.entry 移至 **voice.asr warn**（remote 回退 warn :313 已在 voice.asr 不动）；级别依据：创建失败=入口本次不可用（error 族），start 失败=可恢复错误码且回退树已处理（warn 族）。
- 验收（回退即红）：
  - given mock pickAsrAdapter throw（同步/异步各一），则恰一次 voice.asr error 日志 + inputLeg 即时=idle + notice(device) + 零 10s 悬挂；
  - given webSpeech start not-allowed，则 voice.asr warn（非 voice.entry——scope 断言）+ failMicRequest(permission)；
  - given remote start 失败回退 webSpeech 成功，则既有 :313 warn 不变、正常起录；
  - 回退即红：移除 catch 则 throw 用例红（unhandled rejection / 悬挂）。

**L13+C：cloudFallback 恢复签名纳入凭据修复事件**

- 现状证据：`useVoiceAnnouncement.ts:379-389`——恢复签名 `ttsEngineSignature = engine + "\0" + baseUrl + "\0" + model`：用户只补凭据（三字段不动，凭据走 ICredentialService）时签名不变 → `cloudFallbackRef` 会话内不解除。§9.6.5-3 注释自述恢复条件含「用户修复 baseUrl/**凭据**/网络后恢复」——凭据一半未兑现，属实现欠账。
- 裁决机制：凭据状态进签名：`cloudApiKeyRef` 升为 state（或增 `credentialVersion` 计数 state，加载 effect :231-243 完成时递增）驱动重渲染；签名拼入**凭据指纹二值**（`非空 ? "present" : "absent"`——判定只需区分空/非空迁移，不拼原文亦可；指纹不得落任何日志，§7.1 延伸边界）。签名变化 → 既有 effect（:384-389）清 `cloudFallbackRef`，下一解析点按最新凭据重试 cloud。数据保在哪 = hook 本地 state（会话级回落标记本就是 hook ref，粒度不变，不进 store 不持久化）。
- 验收（回退即红）：
  - given cloudFallback=true（连续失败置位），when 用户补 apiKey（凭据 load null→非空），则 cloudFallbackRef=false 且下一句 speak 走 cloud（mock fetch 断言恰一次 POST）；
  - when 凭据非空→空（清除），则同样触发重析（回落 system）；
  - 断言本轮全部 logger 调用载荷零凭据原文/指纹值；
  - 回退即红：签名去掉凭据分量则补凭据用例红。

**L14+C：toolBriefPlanner drain 增加简报开关检查，关闭时清 pending**

- 现状证据：`toolBriefPlanner.ts:122-152`——`drainPending` 无 `isBriefEnabled()` 检查（候选生成侧 :173 有）：开关开着时候选已进 `pendingByTool`（合并窗内保留），用户关闭开关后窗过期、下一次快照驱动 drain 仍上交——违反既有冻结验收「工具简报开关关闭时零简报」（§9.4 末条/§9.6.8-S5）。
- 裁决机制：**守卫加在 drainPending 入口**：`if (!deps.isBriefEnabled()) { pendingByTool.clear(); return; }`——关闭即清已 pending 简报（fixPlan 明示「关闭时清」，非挂起重开重放——简报是可丢弃的增强信息，§4.2-3 同哲学）；seen 消化照常（:173 既有，防「重开瞬间旧行涌入」语义不变）。
- 验收（回退即红）：
  - given 开关开时同名工具候选进 pending（窗内），when 关闭开关且窗过期后快照驱动 drain，则零 consumeBrief 上交、pendingByTool 空（暴露内部态断言或等价行为断言：重开后旧候选不补播）；
  - given 重新开启后新工具行首见，则正常候选上交（既有六规则用例全量回归，含 [5s,10s) 偏差区间）；
  - 回退即红：移除入口检查则关闭后 drain 用例红。

**L11+C：配置确认门两入口时序不对称——记档为有意设计（零代码）**

- 现状证据：VoiceSection.tsx:110-117 `handleAcknowledge` 确认即连同 `pendingPatch` 写入（本次开启生效——§9.2 验收原文「确认后本次开启生效」）；mic 入口 useVoiceComposerEntry.ts:83-90 `acknowledgePrivacy` 只写 `voicePrivacyDisclosureAcknowledged`、本次动作中止（§9.2 验收原文「显式确认后回 Idle（不自动开录），再次点按才开始」）。
- 裁决：**有意不对称，本章记档**：设置开关 = 状态设置动作，确认即落开关（若不落则死锁——用户已表达「确认后要开」，开关回落迫使其第四次交互）；mic 开录 = 持续拾音动作，必须新手势（隐私披露 3「仅点按后开启」+ FD-5 明文「不做确认即连续开录」）。两入口共用同一 reader 守卫与同一 acknowledged 键（FD-5 冻结不变）。不对称是两条冻结验收的合取结果，非缺陷；零代码改动。

**L12+C：remote ASR「即将支持」文案与已实现矛盾修正**

- 现状证据：zh-CN.ts:8240 `"voice.settings.asr.engine.remote": "云引擎（即将支持）"`、en-US.ts:8716 `"Cloud engine (coming soon)"`——remote ASR 已于 §9.6 批次实现（remoteAsrAdapter.ts 存在；VoiceSection.tsx:307 档完整即可选），文案与实现矛盾。
- 裁决机制：值改文案、键名与键集零变化：zh「云引擎」/ en "Cloud engine"（与 `voice.settings.tts.engine.cloud`「云引擎」措辞对齐）；zh/en 同步改（i18n 铁律），voiceI18nKeys 守护覆盖键集（无新键、无删键）。
- 验收（回退即红）：断言 zh/en 两 locale 该键值 === 上述文案、全 `voice.*` 命名空间 grep「即将支持/coming soon」零命中；voiceI18n 三断言守护全绿；回退即红：恢复旧文案则断言红。

#### 9.9.5 与既有冻结裁决的冲突消解记录（集中）

| # | 冲突点 | 消解 |
|---|---|---|
| 1 | M3 vs §3.2 AnnPaused→Speaking 出边前置「轮尾仍最新」 | 该前置只对**轮尾正文在播**形态有定义（比对对象 = 在播/顺延轮尾 vs focused 最新轮尾）；null-turnId（权限/简报专用起播 `ensureClaimAndSpeak(null,…)`）在播时无比对对象，`stillCurrent` 恒 false 是判定空缺不是裁决意图。按 FD-3「权限段整段闭合、权限>正文」续播剩余句；新轮尾顺延至权限段排空后的 AnnIdle 排空点起播。**本章为 §3.2 图示的增补裁决**（照 §9.6/§9.7 先例：原冻结文字不改写，以本章为准），FD-1/2/3 零推翻：FD-2（AnnPaused 持约续期）照旧、FD-3 顺序强化、停止面（FD-1）零触及 |
| 2 | M2 vs §3.3 顺延规则 | 现状（无条件清 pendingTail）**违反**冻结「录音结束时该轮尾仍最新 → 起播」；本条为对齐修复。supersede 采用立即 cancel（与非录音态 consumeTurnTail speaking 分支 :543-546 冻结行为一致），不引入「等句界」新时序。fixPlan「交由句界/pause 流程消费」措辞按此收敛（9.9.2-M2 论证） |
| 3 | H6 vs §4.1/§3.2 | 实现将 interrupted 加入可播终态是对冻结的偏离（§4.1「TurnComplete 终态」从未含 interrupted）；收窄为 complete 单值 = 对齐冻结。「截断播报半截正文」备选属 §4.1 白名单新增播级内容，闭集原则下须独立增补拍板，本批不做 |
| 4 | H4 vs §3.1/§2.4 | composer 正文唯一写入通道不变；多槽 = 通道内按 `targetSessionId` 寻址扩展（消费门匹配函数语义同源）；§2.4 mode 语义与空格规则零改动（同槽 append 合并复用同一规则） |
| 5 | M9 vs §6.1/§3.5-4 | 「设置关闭后运行时行为一致」（reader 收口）在输入腿的对称落地：播报开关关闭 → notifyStopPressed 是既有实现（useVoiceAnnouncement.ts:391-400），入口隐藏 → 定向停止补齐同一哲学；与 §3.5-4 release 时机三处清单不冲突（claim 侧零变化） |
| 6 | M10 vs §9.6.5-2 解析点清单 / §9.6.2-5 完整谓词 | 解析点清单（装配/设置变更/AnnIdle→Speaking）**additive 增补第四点「凭据加载完成」**——原裁决未考虑凭据异步到达，括注「speak 路由以最新解析结果执行」本就允许逐句路由，无时序新面；§9.6.2-5 谓词 `apiKey.trim()` 语义不变，只是「未加载」不再被占位值伪装成「已加载非空」 |
| 7 | L7 vs §3.5-3/broadcastService 自述 | §3.5-3「以 claim 为准校正本地态」+ 服务层 broadcastService.ts:186 注释「claim 超时不能乐观播放」共同裁定：unavailable（超时/传输失败）→ 不持有；「无仲裁面可降级持有」仅保留 service 缺席分支（该分支才是真正的无仲裁面）。已知代价（桥启动竞态首播静默一次）如实记档，不加超时重试掩盖 |
| 8 | L3 vs §4.4 优先级 4 | 注册条件放宽不改变优先级表：无任务态无消费者时 Esc 仍零动作（handler 内 canStop 后置守卫、不 preventDefault）；优先级 3（录音优先）获得无任务态覆盖。§4.4 表零改写 |
| 9 | 全批 vs §9.8（并行） | 叠加关系非冲突：并行改「谁在播/谁持有/资源清理」（owner 凭证、generation/lease、Esc abort、卸载清理），本批改「播什么/何时播/可达性与观测」（队列身份分派、顺延保留、终态收窄、多槽注入、门控、日志）。同文件重叠点（turnSpeechPlanner notifyUserRecordingEnded、voiceAnnouncementClaim、useVoiceAnnouncement、useVoiceDictation）已在各条「并行兼容」注定义合成形态；M2 分支并行未改（实读）、M3 分支并行未改（实读）、claim unavailable 映射并行未改（实读）——三处均为单向叠加 |

#### 9.9.6 明确不做与 deviations

1. **interrupted 轮次的截断播报策略**（H6 备选）——否决，§4.1 白名单闭集原则，须独立增补拍板（9.9.2-H6）。
2. **H4 消费门 focused 条件的放宽**——失焦 pane 即刻消费可进一步缩小丢失窗，但改变「主/辅 pane 同时 focused 的单一消费者」契约面，超出本批；多槽已消除覆盖丢失，focused 门维持现状。
3. **L4 看门狗窗口值**——voiceTuning 新常量（`VOICE_ASR_SPONTANEOUS_END_SETTLE_MS`），初值 2000ms 与 stop settle 同量级，调参面不冻值。
4. **L9 时序日志的 warn/info 升级**——时序事件全量 debug（生产不落盘）；已知可恢复异常维持既有 warn 槽位，不重复落。
5. **桌面 E2E/真机**——本环境无 Electron 桌面运行时（附录 C 第 3/4 条既有约束持续有效）：本章交互断言以受控单测/wiring 测试（mock transport/deps）形态定义并执行；双主题/快照与真机项维持既有 TV/E2E 清单跟踪，不在本批伪造通过。
6. **fixPlan 措辞偏离两处**——M2「句界/pause 流程消费」收敛为立即 supersede（9.9.5-2）；M9「真正卸载 hooks 或定向停止」二选一裁决定向停止（9.9.3-M9 论证）。均记档于此，不改冻结语义。
7. **提交纪律**——本批不执行 git add/commit/push（铁律 3），提交由流程统一处理。

#### 9.9.7 本轮核验记（2026-10-26，worktree feat/voice-audit-fixes @ dc2a60fb 实际执行）

`git status` 零本地改动（实测）；全文读取：useVoiceAnnouncement.ts、turnSpeechPlanner.ts、voiceSessionStore.ts、useVoiceDictation.ts、useVoiceComposerEntry.ts、V4ComposerVoiceEntry.tsx、DictationPreviewOverlay.tsx、webSpeechAsrAdapter.ts、voiceAnnouncementClaim.ts、toolBriefPlanner.ts、resolveAsrAdapter.ts、useComposerTextInsertApplied.ts；局部读取：SessionPane.tsx（:835-870/:4580-4615/:5427-5444/:1677-1698）、droraSessionStoreWorkspaceSlice.ts（:309-360）、droraSessionStoreTypes.ts（:100-180）、broadcastService.ts（:140-230 + :16-18 常量）、broadcast.ts（全文）、rows.ts（:82/:175/:187）、locales zh-CN.ts（:8235-8248）/en-US.ts（:8710-8722）、VoiceSection.tsx（头注/:93-123/:291-307）。grep 实测：`cancelMicRequest` 生产调用方零命中；`logger.debug` voice 模块仅 3 处且全在 voice.asr；`consumeVoiceRecordingEscape` 消费接缝 2 处（ConversationComposer.tsx:2835、SessionPane.tsx:4604）；`TID_VOICE_ANN_STOP` 在 test-ids.ts:596；`compactForRemoteControl` 为 SessionPane prop（:378/:626）。并行 worktree（drora-voice-agent，feat/voice-agent-phase1）实读：spec §9.8 全文；未提交 diff 的 turnSpeechPlanner.ts（F5 形态：prunePermissions/isPermissionPending/unshift/owner+generation+lease，notifyUserRecordingEnded 与基线逐字一致）、voiceAnnouncementClaim.ts（lease 形态，unavailable 映射未动）、未提交清单（SessionPane.tsx/toolBriefPlanner.ts 不在其中）。评审修订轮（同日第二遍）：实读 ConversationDraftSuggestedPromptsContainer.tsx（:319-330 finishMutation Failed popover、:498-503 与 :675-690 两处 await applied）并复核 useComposerTextInsertApplied.ts:32-39 判定结构——证实 H4 原谓词在跨槽 bump 交错下误报 superseded，按 9.9.2-H4 修订注改槽态判定。未执行：typecheck/lint/单测（本批 spec-only，零代码改动，不触发测试面——实现批按 §9 头门禁实测报告）。

---

### 9.8 生命周期与多 pane 隔离修复（2026-10-24）

本批修复当前实现审查已复现的 F1–F6，取代此前依赖 `canStop` 防止跨会话语音取消的假设。
不扩展 CLI/wire、手机语音或实时双工范围。状态仍由 `voiceSessionStore` 单独持有，IO 资源由
录音入口 / 持有播报凭证的 planner 管理；不把 MediaStream、凭据或音频放进 store。

#### 9.8.1 输入腿资源与定向命令

- 开始录音时捕获 workspace ref、sessionId、入口实例和 episode 代际，期间不随 focus 改绑。
  workspace key 使用 `workspaceIdentity?.trim() || workspacePath`；远程身份复用已有 ref。
  仅切换其他 pane 的 focus 不结束本入口；本入口被替换为另一会话/workspace 则先释放旧
  episode，等同旧 composer 离场，绝不把旧结果送入新目标。
- Esc 是丢弃式 `abort()`：保留已注入的 final，丢弃 partial/未结算 final，先使代际失效、
  停底层引擎/音轨、退订，再回 Idle；点 mic 停止仍是 `stop()` 等待 final 恰一次交付。
  错误、超时、卸载共用终止清理，重复调用幂等。逐句 `Recording→Injecting→Recording`
  不是 episode 结束，不能据此停引擎或恢复播报。RequestingMic 的迟到授权也须释放资源。
- `cancelTask` 携带捕获的 workspace/session 目标，只送一个匹配的会话处理者；草稿或目标
  消失时 no-op，不回退到当前 focused。`canStop` 与 expectedForegroundExecutionId 保留，
  分别负责能力与 stale-run 校验，不再被当作目标路由。相同会话双 pane 仅处理一次，
  优先选择其中的播报持有者，以保证取消任务同时静音；无播报时选一个匹配处理者。
- `stopAnnouncement` 定向当前播报持有者，保持权限整段 uninterruptible 守卫；不取消任务。

#### 9.8.2 播报唯一所有者与异步意图

- 每个 planner 有独立 owner 凭证，store 原子仲裁窗口内唯一持有者；进入获取跨窗口 claim
  前先占本地所有权。所有播报状态写入都经凭证校验的 control，非持有者不能 cancel 共享
  TTS、不能重置全局相位；非持有 pane 卸载只释放自己的订阅和候选。
- 起播使用 generation，续约使用 owner + 具体 lease 身份作为代际；停止、切离、会话切换、
  关闭播报、卸载使旧意图失效。每次 await 返回后复核对应代际、disposed、owner 和当前条件，
  旧结果不得开播或覆盖新态。同 owner 仅替换正文时保留有效续约，不误释放它的新 lease。
- claim acquire 返回具体 lease；renew/release 都针对该 lease。旧请求迟到成功只释放自己的
  lease，不能按 key 释放新请求的占用；同一 planner 续约不重叠。TTL/周期沿用 §3.5。
- 指示器停止操作送实际播报 owner；同窗其他 pane 的停止/卸载不改变当前播报。
- 录音释放、句完成和起播链完成进入同一调度点，按权限 > 正文 > 简报处理。
  AnnIdle 且只有权限 pending 也必须起播；开播前复核请求仍 pending，已处理者作废。

```mermaid
sequenceDiagram
    participant E as 录音入口/episode
    participant S as voiceSessionStore
    participant P as 持有凭证的 planner
    participant H as 既有 claim/会话命令端口
    E->>S: 捕获绑定目标和入口
    E->>E: Esc：失效代际、abort、释放资源
    E->>S: 输入 episode 结束
    S->>P: 录音释放，调度有效权限/正文
    P->>S: 原子取得本地 owner
    P->>H: acquire/renew 具体 lease
    H-->>P: 异步结果
    P->>P: 校验代际、owner、开关和录音
    alt 结果已过期
      P->>H: 仅 release 该结果 lease
    else 结果有效
      P->>S: 经 owner 校验迁移并播放
    end
```

#### 9.8.3 能力解析与验收

- 入口与起录共用引擎选择：webSpeech 检查 SpeechRecognition；remote 检查 MediaRecorder、
  getUserMedia、FormData/fetch 和完整厂商档（凭据只经 credentialService 读取）。remote
  可用时不再要求 SpeechRecognition；回退只在对应能力可用时执行。远控壳仍隐藏入口。
- 回归先行：Esc 后底层 abort/音轨停止、零 task stop/迟到注入；final 注入微态不结束
  episode；A/B 并行时只取消绑定目标；同会话双 pane 与远程身份隔离；无关 pane 卸载不
  停播；停止/切离/卸载后迟到 acquire/renew 零播放且不释放新 lease；仅权限 pending 的
  录音释放起播；已处理权限不播；无 SpeechRecognition 的 remote 入口可见并可起录。
- 交互场景以受控 ASR/TTS 的桌面候选 E2E 验证资源释放、命令路由与 pane 隔离，不要求
  真实麦克风/云端凭据。真实语音质量、厂商连通性和跨平台能力矩阵仍按 TV 项独立验证。
- 实测门禁：目标测试、typecheck、lint、显式功能基线架构检查；桌面 E2E 留存运行结果，
  环境阻塞须记实，不以测试存在代替实跑。候选不自动提升正式 CI/Docker 覆盖。

## 10. 开放问题清单（含触发条件与责任人角度）

| # | 问题 | 为什么暂不裁决 | 重新打开的触发条件 | 责任人角度 |
|---|---|---|---|---|
| OQ-1 | 三层打断第②层（按播放位置截断上下文） | 需协议级「按播放位置截断」CLI 原语设计，非读码可裁决；层①③已覆盖主路径 | Phase 2 使用反馈表明打断后上下文污染不可接受，或第②层立项 | CLI 协议设计者 |
| OQ-2 | 播报输出设备选择 /「仅耳机播报」 | Web speechSynthesis 无设备选择 API，需 Electron Main 原生层（枚举/强制路由）设计 | 外放泄露成为实际使用问题（如蓝牙拔出转外放泄露敏感内容） | Desktop Main 负责人 |
| OQ-3 | 桌面+手机跨端播报仲裁 | 「桌面默认关 + 手机手动触发」已把叠音压到产品可接受 | 双端叠音被实际使用反馈为问题 | 产品 |
| OQ-4 | 语音权限 allow、语音自动提交 | 产品决策：误授权/误发风险 vs 效率；Phase 1 维持不自动提交、allow 必须点按 | Phase 2 带使用数据拍板 | 产品 |
| OQ-5 | iOS Safari 语音 | 平台能力缺失 + 仓内无转写服务端（grep 核验 SpeechRecognition 仅 speech-input.tsx 一处） | iOS 远控语音需求被真实验证 | 产品 + 服务端 |
| OQ-6 | 打断词表定稿（zh 词集、en 阈值语义） | 需真机（麦克风/噪声环境）调优数据；en「≥3 词」语义为本 spec 自定义（外部策略零命中），待验证 | Phase 2 验收「中文『停』可打断且正文字不误触发」执行时 | 语音/产品 |
| OQ-7 | Phase 3 音频过 relay 的隐私合规 | 条件触发项；音频不过 relay 前无风险 | Phase 3 立项时，独立 spec 对照 `specs/mobile-relay-server.md` | 产品 + 架构 |
| TV-1 | Electron 41.0.3（packages/desktop/package.json:122）renderer SpeechRecognition 可用性 | 依赖 Chromium 内建语音服务的网络/地区可用性，需目标运行时实测 spike；直接决定 Phase 1a ASR 选型（备选 RemoteAsr / 本地 whisper，whisper 体积/许可另评） | **Phase 1a 启动前的强制前置 spike** | Phase 1a 实现者 |
| TV-2 | 第②层上下文污染的实际影响 | 「污染存在」已由 cancelled-stream-persistence.ts 证实；「影响多大」需实测 | 与 OQ-1 同源同触发 | CLI 协议设计者 |
| TV-3 | speechSynthesis 中英双语播报质量 | 音质需真机听测（Windows SAPI/macOS/Linux 参差）；云 TTS 立项属产品/上游对齐决策 | Phase 1b 轮尾播报启动前 | 产品 + Phase 1b 实现者 |
| TV-5 | Electron 无 mic 权限 handler 时的默认行为 | 二进制运行时行为且要求跨版本一致，静态读码无法裁决（electron.d.ts 权限 handler 文档段 :12193 起提示需配合 setPermissionCheckHandler，未写明缺省行为） | Phase 1a「main 新增 mic 权限 handler」实现前的 spike；方案无条件采纳「request + check 双 handler 都显式登记」 | Desktop Main 负责人 |
| EG-2 残余 | permission 倒计时的 pause/resume 型 CLI 命令 | 现 permission 无倒计时，无对象；引入即新协议面（additive pause/resume）+ renderer 播报触发点 | 决定给 permission 引入倒计时时 | CLI 协议设计者 + 产品 |
| EG-7 | mic 跨窗口强互斥 | Phase 1 单 active 语音端产品约定 + 窗口内互斥；机制已备（§3.5 claim 同通道同键空间） | Phase 2 多窗口实测出现双开麦 | Phase 2 实现者 |
| EG-8 残余 | 「停掉任务」二次确认形态 | 首版直接执行（§4.8）；确认形态（语音追问 vs UI 卡片）与超时回落需使用数据 | Phase 2 使用数据表明误取消真实发生 | 产品 |
| EG-11 | Phase 2 防误触参数（静默观察时长、barge-in 回声护栏算法/阈值） | 需 Phase 2 前置设计 + 真机数据；spec 只冻结「列为前置设计与验收项」 | 路线图第 5 步 Phase 2 设计时 | 语音算法 + 产品 |
| TV-4 残余 | media-chrome 进 renderer bundle 的体积影响 | 依赖事实已裁决（已是 @drora/ui 直接依赖 ^4.18.2，packages/ui/package.json:88；lock 钉 4.19.0，pnpm-lock.yaml:10045；唯一消费方 audio-player.tsx:18 import media-chrome/react）；语音模块**不 import media-chrome**，bundle 不因语音新增该依赖，故只剩存量体积问题 | Phase 1a 若有复用 ai-elements 音频资产的需求时做构建产物分析 | Phase 1a 实现者 |
| TV-6 残余 | 播报指示 overlay 的具体挂点与渲染性能 | 机制已裁决（行外 overlay，行组件 memo/props 零变化——ConversationRowView.tsx 现有 13 处 memo( 本轮核验）；挂点位置是工程选型 | Phase 1b「播报中指示」实施时（长会话滚动 + 播报并行渲染验证） | Phase 1b 实现者 |
| TV-7 残余 | 受控远控 composer 能否承载手机 mic 入口 | 落位已改判 packages/web+ui 受控扩展（§8.3）；受控入口可行性未实测 | Phase 2 手机听写实施前勘察；不可行则走 DESIGN.md R3 + 上游对齐评审再立项 | Phase 2 实现者 + 架构 |

已闭环不再跟踪：EG-1（§4.2 六规则拍板，合并窗基准=最近播出，守护测试含 [5s,10s) 偏差区间）、EG-9（§4.7 句粒度裁决冻结）、EG-10（§3.5 claim 机制冻结，参数留 voiceTuning 调优面）、EG-12（附录 B 漂移表落定）、EG-13（本文档即立项，设计报告状态改冻结属编辑性后续动作）、EG-14（§5.2 裁决，待拍板项随 Phase 1a 评审收口）、APP-1/2/3（附录出处登记，分别同 OQ-3/OQ-2/OQ-6，不重复展开）。

---

## 附录 A：待决点裁决记录

| id | kind | 裁决 |
|---|---|---|
| EG-1 | open→裁决 | §4.2 六规则拍板（合并限流修复轮）：触发源收窄到 ToolCall 行新增 + 同类 10s 合并（**窗口基准 = 该工具类最近一次实际播出时刻**——防机关枪：以到达为基准会退化为每满 5s 连报）+ 间隔 5s + 只播最新 + 不打断正文空闲插播 + 每 turn ≤6。窗内候选保留待上交、目标刷新为最新，窗过期由快照驱动上交；实现 `packages/ui/src/voice/toolBriefPlanner.ts`，守护 `toolBriefPlanner.test.ts`（含 [5s,10s) 偏差区间用例） |
| EG-2 | code | 设计报告 §4.6 断言不成立（snooze 仅 askUserQuestion、无 resume API）；Phase 1b 权限播报不触碰 interaction-registry，验收项改写；残余 pause/resume 决策 keptOpen |
| EG-3 | product | §6.1 八开关四列表（入口默认隐藏 / 播报默认关 / 隐私披露确认门）。**建议，待拍板** |
| EG-4 | product | §6.3 voice.* 命名空间 + 43 键清单（Phase 1a 39 + Phase 1b/2 4，含 FD-1 新增 `voice.ann.stop.aria`；定稿轮纠正初稿「35 键」误记）+ team/i18n.test.ts 三断言守护。**建议，待拍板** |
| EG-5 | product | 第三语言回退 en-US 词表 + en ≥3 词语义自定义。**建议，待拍板**；新增语言 = 词表 map 加项 + spec 补记 |
| EG-6 | product | 绑定会话关闭即强制停录音 + partial 丢弃 + 轻提示；final 悬空走 lastDictation；同会话双入口窗口内互斥。**建议，待拍板** |
| EG-7 | open | Phase 1 产品约定 + 窗口内互斥；claim 机制已备，keptOpen（触发：多窗口实测双开麦） |
| EG-8 | product | 「停掉任务」完整短语精确命中直接执行层③，不做二次确认；「取消」仅层①。**建议，待拍板**；确认形态 keptOpen |
| EG-9 | open→裁决 | 句粒度暂停/续播（§4.7 冻结）；两处表述统一，「断句处」=句边界；点按播报指示停止按钮不受句边界约束（FD-1 载体） |
| EG-10 | open→裁决 | claim 机制冻结（§3.5：TTL 5s + 续约 2s + 空窗即抢 + 以 claim 校正本地态 + 三处 release）；参数 Phase 1b 实测可调（voiceTuning.ts） |
| EG-11 | open | keptOpen（触发：Phase 2 设计时；责任人：语音算法 + 产品） |
| EG-12 | code | 行号复验完成，漂移见附录 B；本 spec 引用的行号全部为本轮核验值。定稿轮纠正：logicalFrameAssemblyMaxBytes 行为初稿误报——core.ts:67 正确（设计报告无误），初稿误记「实际 :69」 |
| EG-13 | open→闭环 | 本文档即立项；设计报告头部状态改「已冻结」属编辑性后续动作，不阻塞 |
| EG-14 | product | 预览条只读 + 清除按钮 + final 即清 + 焦点不转移。**建议，待拍板** |
| OQ-1 / TV-2 | open | keptOpen（CLI 无按播放位置截断原语；触发：Phase 2 反馈） |
| OQ-2 / APP-2 | open | keptOpen（需 Main 原生层；触发：外放泄露成为实际问题） |
| OQ-3 / APP-1 | open | keptOpen（默认关+手动触发缓解；触发：双端叠音反馈） |
| OQ-4 | product | 维持 Phase 1 现状（不自动提交、allow 必须点按），Phase 2 带数据拍板 |
| OQ-5 | open | keptOpen（iOS 平台缺失 + 无转写服务端；触发：iOS 需求真实验证） |
| OQ-6 / APP-3 | open | keptOpen（词表定稿需真机数据；触发：Phase 2 词表验收执行时） |
| OQ-7 | open | keptOpen（Phase 3 条件触发；届时独立 spec 对照 mobile-relay-server.md） |
| TV-1 | open | keptOpen（**Phase 1a 前强制 spike**，结果决定 ASR 选型） |
| TV-3 | open | keptOpen（真机听测 + 云 TTS 产品决策；触发：Phase 1b 启动前） |
| TV-4 | code | media-chrome 已装（ui:88 / share-ui:50 / lock 4.19.0），唯一消费方 audio-player；语音不新增其消费，体积残余 keptOpen |
| TV-5 | open | keptOpen（Phase 1a spike；方案已定：request+check 双 handler 显式登记） |
| TV-6 | code | 行外 overlay 裁决（行 memo/props 零变化）；挂点 keptOpen（Phase 1b 实施时） |
| TV-7 | code | 落位假设推翻，改判 packages/web+ui 受控扩展（§8.3）；可行性 keptOpen（Phase 2 前） |
| FD-1 | code | 定稿评审：Stop 语义三处互斥表述消解（§3.2/§3.3/§4.3）。层①载体 = 播报指示停止按钮（`TID_VOICE_ANN_STOP`，AnnouncementIndicator 内新增）；`TID_V4_STOP` 保持既有 v4 stop 语义与渲染条件（canStop && !hasDraftToSubmit）零改动，播报中点按 = 取消任务 + 播报同步静音；主场景（canStop=false）唯一静音载体为指示停止按钮；§6.2 披露措辞同步指明实体 |
| FD-2 | code | 定稿评审：AnnPaused 是持约态——claim 照常每 2s 续约（§3.5-1/3/4），renew=false 回 AnnIdle 作废续播意图；AnnPaused→Speaking 出边补 claim 前置，AnnPaused→AnnIdle 出边标注「改播最新」的实际时机（§3.2） |
| FD-3 | product | 定稿评审：播报优先级 权限 > 正文 > 简报（§4.1/§4.2-5）。uninterruptible 段粒度 = 整段（一次权限请求的完整播报）；权限段内/段间句隙不开放简报插播；正文/简报当前句播完后让位给权限段；连续权限段背靠接连播。**建议，待拍板** |
| FD-4 | product | 定稿评审：「恢复上次转写」承载面 = mic 按钮右键（桌面）/长按（触屏）单项菜单（§5.4/§9.2）：lastDictation 非空且未过 TTL 才渲染，过期即消失不置灰；恢复目标 = 当前入口所在会话，成功即清暂存。**建议，待拍板** |
| FD-5 | product | 定稿评审：隐私确认门覆盖两个开启入口（§6.1 开关 8/§9.2）：设置开关与点按 mic 兜底门共用同一 reader 守卫；确认后中止本次动作、再次显式点按才开始，不做「确认即连续开录」。**建议，待拍板** |
| FD-6 | product | 定稿评审：同会话主/辅 pane 双 mic 入口验收补齐（§9.2）：第二点按 no-op + 既有录音指示短暂高亮 + partial 归属发起 pane。**建议，待拍板** |
| FD-7 | code | 定稿评审：`VOICE_BROADCAST_CLAIM_KEY.mic` 标注为 EG-7 预留键（§2.1）：Phase 1 零生产/消费方，§9.1 dep:refs 同源断言豁免该键，随 EG-7 裁决启用或移除 |

## 附录 B：核验记录（2026-10-22，本 spec 撰写轮）

**本轮实际读取核验的证据**（grep/read 命令与输出见会话记录）：

1. relay：`packages/relay-client/src/clock.ts:7`（1MiB）、`rpcFrameChannel.ts:71`（缺省信封）、`packages/shared/src/relay-wire/constants.ts:9/:13/:15`（1MiB/8MiB/45s）、`packages/shared/src/drora-protocol-v4/core.ts:35-60`（DELIVERY_PROFILES）、:67（16MiB；初稿误记 :69——:69 实为 `logicalFrameAssemblyMaxConcurrent: 32`，定稿轮复核纠正，见下方漂移表）。
2. 协议：`input-intent.ts:31-47/:115`、`transport.ts:355-356/:418-419`、`drora-task-types-core.ts:245/:274`、`test-ids.ts:594`、`validationAppSettings.ts:527/:650`、`protocol.ts:293`。
3. CLI：`interaction-registry.ts` register()（autoResolutionEligible 仅 askUserQuestion）与 snoozeAutoResolution（:191-206 kind 门 + 「首次有效操作永久暂停」注释 :192-193）、`session-flow.ts:90-96/:346`、`turn-loop.ts:57-72`（methods/ 子目录）、`input-intent-persistence.ts:5-9`（core/src/runtime/methods/）、`cancelled-stream-persistence.ts:16-17/:37-53`。
4. UI：`droraSessionStoreTypes.ts:127-139`、`speech-input.tsx:90/:151-153/:287-303`、`escapeStop.ts:1-24`、`ChatPromptEditor.tsx:65/:67/:119/:127/:226/:424/:450`、`useCuaComposerEntry.ts:35-36/:70-73`、`assistantPreviewCards.ts:19-37`（export :19，join("\n\n") 链 :34-37；初稿引 :20-34 未覆盖 join 行，定稿轮纠正）、`ConversationRowView.tsx`（13 处 memo( ）、`ConversationComposer.tsx:2505`、`team/i18n.test.ts:1-16`、`taskNotificationSound.ts:19-42`、`taskNotificationPreferences.ts:33`、`codingPlanQuotaResetState.ts:75-85`、`SessionPane.tsx:7`（conversationShareItems 消费）、`SettingsPage.tsx:132`、`settingsNavigation.ts:6-27/:48-60`。
5. Desktop：`broadcastHub.ts:24-25/:64-92`、`desktopMobileRelayProtocol.ts:399`、`packages/desktop/package.json:122`（electron 41.0.3）、`remoteMediaPreviewProxy.ts` 与 `embeddedBrowserPermissionPolicy.ts`/`pluginSandbox/session.ts` 存在性。
6. grep 零命中：`speechSynthesis`、`echoCancellation`（产品源码）、`MinWordsUserTurnStartStrategy`；locale 目录仅 en-US/zh-CN 且 voice.* 零存量；`packages/mobile-web/src` 仅 `recovered/`。
7. 前期材料引用、本轮未复验：`openCuaPermissionOnboarding` 模式细节、`useComposerAttachments.ts:92`、`useCuaComposerEntry.ts:109-113`、`conversationProjectionStore` 行号、electron.d.ts setPermissionRequestHandler 缺省行为文档（仅核验 :12193 起的 check-handler 配套提示）。

**相对设计报告附录 B 的行号/路径漂移表**（EG-12 裁决产物，本 spec 已按核验值引用）：

| 项 | 设计报告写法 | 本轮核验 |
|---|---|---|
| SettingsPage | `SettingsPage.tsx:75-95`（隐含 v4/ 下） | 实际 `packages/ui/src/SettingsPage.tsx`，settingsNavigation 引入在 :132 |
| ChatPromptEditor 渲染点 | :423/:450 | :424/:450（:423 为注释行） |
| turn-loop | `turn-loop.ts:57-72` | 路径为 `runtime/methods/turn-loop.ts`，行号成立 |
| input-intent-persistence | bootstrap/drora-protocol-v4/ 下 | 实际 `packages/core/src/runtime/methods/input-intent-persistence.ts` |
| drora-task-types-core | `drora-protocol-v4/` 下 | 实际 `packages/shared/src/drora-task-types-core.ts` |
| logicalFrameAssemblyMaxBytes | core.ts:67 | **初稿误报**：定稿轮复核确认设计报告 :67 正确——初稿误记「实际 :69」，该行实为 `logicalFrameAssemblyMaxConcurrent: 32` |
| desktopMobileRelayProtocol | :397-409 | 实际 `packages/desktop/src/main/`，throw 在 :399 |
| broadcastHub claim 细节 | 仅 :24 TTL | 另有 :25 retry 250ms 与 :82-92 reserve/commit/清理语义（对 §3.5 裁决有直接影响） |
| electron.d.ts | :12911-12915 | setPermissionCheckHandler 文档段实测在 :12193/:12216/:12243 |

**定稿轮补核（2026-10-22，FD-1~FD-7 裁决依据，本轮实际读取）**：

8. `packages/shared/src/drora-protocol-v4/core.ts:65-77`：:66 `maxFrameBytes: 1024*1024`、:67 `logicalFrameAssemblyMaxBytes: 16*1024*1024`、:68 `logicalFrameAssemblyMaxFragments: 1024`、:69 `logicalFrameAssemblyMaxConcurrent: 32`——据此纠正初稿漂移表对 :67/:69 的误报。
9. `packages/ui/src/v4/ConversationComposer.tsx`：:1442 `showStopControl = canStop && !hasDraftToSubmit`（Stop 按钮渲染条件）、:1938-1945 `handleStopClick` → `runUserAction({operation: onStop, completed: {resultSource: "optimistic_projection"}})`、:2498-2511 按钮渲染块（:2504 onClick、:2505 `data-testid={TID_V4_STOP}`）。
10. `packages/ui/src/v4/SessionPane.tsx`：:4594 `handleStopFromButton = useCallback(() => handleStop("button"))`、:5435 `onStop={handleStopFromButton}`——TID_V4_STOP 点击链终结于既有 v4 stop 动作。
11. `packages/ui/src/v4/assistantPreviewCards.ts:19-37`：`export function buildAssistantPreviewCardsForAssistantTextRow` 在 :19，`join("\n\n")` 聚合链在 :34-37。
12. `knip.json` 全文读取：无 contracts/ 专项 ignore；`desktopPet.ts` 导出有 5 个消费文件（desktopPetMenu/desktopPetConfiguration/desktopPetLibraryPort/desktopPetLibrary/desktopPetNativeInteraction）——`VOICE_BROADCAST_CLAIM_KEY.mic` 因对象整体被 announcement 消费方引用而不会触发未使用导出告警，「死键」是语义面而非 lint 面，仍按 FD-7 标注预留。

## 附录 C：实施批次记录（2026-10-23，范围修订与落地状态）

本附录记录正文清单各条目的落地状态与范围修订，是 AGENTS.md「新增或修改行为前，先更新对应 spec」的实施侧记录；不改写正文冻结决策，仅标注偏差与后续条件。

1. **§9.2 / §5.3 IPlatformService 权限引导方法——转后续批次**：Main 侧已落地 `packages/desktop/src/main/voicePermissionPolicy.ts`（§10 TV-5 方案：request + check 双 handler 显式登记；media audio 允许、含 video 拒绝、其余权限保持无 handler 时代自动批准现状），app 主窗口 session 权限面已成显式代码决定。但 renderer 的权限拒绝→设置引导跳转所依赖的 `IPlatformService` optional 引导方法（§5.3/§9.2 修改表）尚未实现，当前权限拒绝仅有 `voice.dictation.error.permission` 提示文案、无引导动作。该项与「权限结果一次性生产事件经同通道回报」（§6.1）合并为同一跨进程批次，实施前 §5.3 的「设置引导」分支以提示文案代位。
2. **§9.1 CLI 两项（sendText admission→intent 固化的 source 透传、intent→投影下发面）——未实施**：Phase 0 的 shared 侧（contracts/voice.ts、input-intent voiceInputSourceSchema、validationAppSettings 语音八键、protocol.ts wire 面）已落地；CLI 侧两项待独立批次读码定位实施。在 CLI 侧合入前，**携带 source 的 renderer 改动不得合入**（§2.2 偏斜方向 CLI→renderer 的顺序门禁保持有效）；当前听写以纯文本发送（source 缺省），功能不受影响。
3. **§10 TV-1（Electron renderer SpeechRecognition 可用性 spike）——未执行**：需目标运行时真机实测（桌面 app 启动 + getUserMedia/SpeechRecognition 探针），本仓实施环境无法运行 Electron 桌面端。TV-1 保持「Phase 1a 听写入口真机验证前的强制前置项」；若 spike 结论为不可用，Phase 1a ASR 按 §10 备选（RemoteAsr/本地 whisper）另评。
4. **§9.2/§9.3 验收末条（双主题 + 390px/1200px 快照）与交互 E2E——未交付**：需桌面 E2E 基建与真机运行。已交付的单测面：§4.4 Esc 仲裁顺序（composerEscapePlan 纯函数 + SessionPane/ChatPromptEditor 接线）、§3.3/FD-6 入口互斥（voiceSessionStore + useVoiceDictation wiring）、§9.3 层①/层③命令通道（voiceCommandBus + planner/wiring）。快照与 E2E 场景在桌面 E2E 基建批次补齐。
5. **§6.1 语音八键 appSettings 持久化——已提前落地**（原列 §9.1 Phase 0 修改表）：validationAppSettings persisted/patch 两 schema + protocol.ts wire 面 + parity 单测（contracts/contract.test.ts），Phase 1a 设置面（VoiceSection）与入口 reader 已消费。

## 附录 D：§9.6 增补核验记录（2026-10-23，工作树 feat/voice-agent-phase1 检出）

**本轮实际读取的仓库证据**（grep/read 于 D:/workspace/projects/drora-voice-agent）：

1. **provider 配置与 API key 模式**：`packages/provider/src/config/provider-config.ts:36-70`（ApiKeyAccessConfig：type/apiKey/apiKeyManagementUrl）、`:131-164`（ProviderApiConfig：type/baseUrl/headers）、`provider-data-schema.ts:4-8`（providerApiTypeDataSchema 仅 anthropic-messages/openai-chat-completions/openai-responses 三文本格式）、`:32-45`（apiKeyAccessDataSchema）；UI 读写链 `packages/ui/src/lib/providerApiKeyPersistence.ts:13-63`（经 IProviderSettingsService getView/savePersonalProviderOverlay）；服务契约 `packages/services/src/model-provider/providerFacadeServices.ts:30-71`；registry 装配在 host 侧 node 服务集合 `packages/services/src/node.ts:803/:1802`（ProviderRuntime 弱表 + createProviderRuntimeFromConfigRuntime）。设置面编辑先例：`InlineEditableProviderCard.tsx:193/:241`、`ProviderDraftSave.ts:46-62`、`ApiKeyInput.tsx:20-40`（password 形态）、`ProviderApiFormatSelect.tsx:7-11`（连接 API 格式三选一——均为文本 LLM 格式）。
2. **凭据通道**：契约 `packages/services/src/credential/credential.ts:1-15`（ICredentialService load/save/delete，实现端加密）；实现 `credentialService.ts:19-34`（credentials.json + cipherProvider，头注「当前持久化格式仍是 JSON，但 value 会在写入前加密」）、`:139-154`（跨进程文件锁 whole-file read-modify-write）；UI 消费 `packages/ui/src/hooks/useCredentials.ts:9-16`、命名空间键先例 `useCodingPlanEntryPlanList.ts:49`（`oauth:${family}:access_token`）；`packages/client/src/globals.d.ts:71`（「凭据管理已迁移到 ICredentialService（通过 RPC）」）。
3. **appSettings 无秘密先例**：`packages/shared/src/validationAppSettings.ts` grep `apiKey` 零命中；语音键现状 :529-537（persisted，voiceAsrEngine enum ["webSpeech","remote"] default webSpeech）/ :666-668（patch）。
4. **renderer 外部 HTTP 先例**：`packages/ui/src/components/cloud-content-dialog/cloudLottieRuntime.ts:36`（fetch 外部 URL，credentials:"omit"、redirect:"error"、2MB 上限）；`packages/ui/src/lib/mcpStatusProbe.ts:51`（fetch 用户配置 URL 探测 + AbortController 超时）。对照：更新检查 `packages/desktop/src/main/autoUpdater.ts`（Main）、captcha `packages/desktop/src/main/captchaSolverWindow.ts`（Main 窗口）——宿主流量不构成代理先例。
5. **网络策略与可行性**：`packages/desktop/src/main/desktopNetworkPolicy.ts:56-74`（defaultSession fallback direct + 注释「Drora 自身对后端与模型 API 的出口，收敛到设置页的显式配置」）、`:103`（setProxy）、`:107-110`（自定义 CA verify proc）；host 侧 env 代理 `packages/services/src/runtime-tools/agentProxyEnv.ts:11-22`、`nodeApiNetwork.ts:99`（「Host 是独立 Node 进程，Electron Session.setProxy 不会影响它的 globalThis.fetch」）；`packages/web/index.html` 全文无 CSP meta；grep `webSecurity` 全仓仅两处显式 `true`（pluginSandbox/guestPolicy.ts:45、browserView/electronBrowserWebmRecorder.ts:298）。
6. **语音模块现状（Phase 1 已落地面）**：`packages/ui/src/voice/` 目录清单（voiceAsrPort/voiceTtsPort/webSpeechAsrAdapter/speechSynthesisTtsAdapter/turnSpeechPlanner/voiceCommandBus/useVoiceDictation/useVoiceAnnouncement 等 33 文件）；`voiceAsrPort.ts:34-63`（端口 + onFinal/onError additive）；`voiceTtsPort.ts:24-34`；`useVoiceDictation.ts:51`（createWebSpeechAsrAdapter 硬编码接线点）、`:250-266`（§5.3 错误处置已实现）；`useVoiceAnnouncement.ts:133`（createSpeechSynthesisTtsAdapter 硬编码接线点）；`turnSpeechPlanner.ts:322-325`（error 跳句 warn）；`voiceTuning.ts:9-36`（六常量）；`VoiceSection.tsx:63/:100-130/:199-206`（asrEngine 选择器含 remote disabled 占位 :125-129、toolBrief 开关已落地）；`contracts/voice.ts:16-39`（VOICE_INPUT_SOURCE_KIND/VOICE_SETTINGS_KEYS 八键/claim 两键）；`validationAppSettings.ts:537/:669`。
7. **CLI busy 路由链**：`packages/shared/src/drora-protocol-v4/command.ts:88-95`（sendText requestedDelivery enum ["startNow","queue","guide"] optional）；`packages/ui/src/v4/SessionPane.tsx:3727/:3731-3736`（仅显式传参时携带 requestedDelivery）；`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/session-flow.ts:88-99`（routingMode + requestedDelivery + evidence-safe delivery 裁决）；`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/command-inbox.ts`（CommandInbox）；`packages/shared/src/drora-protocol-v4/input-intent.ts:46-64`（voiceInputSourceSchema 已落地，shared 侧）。

**本轮执行的外部核验**（2026-10-23）：

8. `curl -s -i -X OPTIONS https://api.siliconflow.cn/v1/audio/transcriptions`（Origin: http://localhost:5173, Access-Control-Request-Method: POST）→ `HTTP/1.1 204`，响应头 `Access-Control-Allow-Origin: *`、`Access-Control-Allow-Headers: *`、`Access-Control-Allow-Methods: GET,POST,DELETE,PUT,PATCH`、`Access-Control-Max-Age: 43200`——默认厂商 CORS preflight 实测放行（本机网络环境，非目标用户环境）。
9. `curl -X OPTIONS https://api.openai.com/v1/audio/transcriptions`（同 preflight 头）→ 连接超时（`http_code=000`，exit 28，~21s）——本环境不可达，OpenAI CORS **未能核验**，列 OQ-8。
10. OpenAI transcriptions 端点事实（`POST /v1/audio/transcriptions`：Bearer + multipart file/model，model ∈ {whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe}，language/prompt/response_format 参数，webm 在支持格式列表）：developers.openai.com「Create Transcription」API reference 与 Speech-to-Text 指南，经 WebSearch 结果摘要核验（未直接抓取原页）。
11. SiliconFlow 双端点事实（transcriptions：Bearer + multipart file/model，model ∈ {FunAudioLLM/SenseVoiceSmall, TeleAI/TeleSpeechASR}，响应 `{"text"}`，≤50MB/≤1h；speech：Bearer + JSON model/input/voice/response_format/speed(0.25–4)/gain/stream，响应二进制音频，样本模型 fnlp/MOSS-TTSD-v0.5、CosyVoice2-0.5B 页签）：docs.siliconflow.cn 官方 API 文档两页，经 webReader 全文抓取核验；**transcriptions 支持的容器格式列表未在抓取内容中出现**，MediaRecorder webm/opus 可用性列 TV-8 spike。
12. 调研报告引用（`docs/voice-agent-research-2026-10-22.md`，本仓文件）：§6.6 事件协议收敛、§7.2 Chat Completions 整段音频「适合异步整段」、§4.2 GLM-4-Voice 停更 2024-12 + 商用登记（HF 协议）、§4.5 许可红线（SenseVoiceSmall 自定义 model-license、CosyVoice2-0.5B Apache-2.0 存疑、CosyVoice 3.0 未核）、§6.2 MiniMax 无公开 S2S 协议文档仅 T2A、§1.3 中文栈自托管路线。调研报告对「各厂商 OpenAI 兼容 /v1/audio/* 端点覆盖面」未核验——本附录 8-11 为本轮补核，覆盖面仍以各家文档为准。
