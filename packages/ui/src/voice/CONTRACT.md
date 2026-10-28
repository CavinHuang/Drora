# voice

一页以内。只写类型与测试表达不了的三样：模块存在的意图、不变量、与其它模块的交集在哪个 hook 点处理。

意图：语音接入 renderer 侧底座（specs/voice-agent-integration.md §2.3、§9.6–§9.8）——听写/播报端口、
Web Speech/remote ASR、system/cloud TTS、播报规划器、音色/角色预设与打断词表；UI wiring 经本模块
端口接入，不内联进 ConversationComposer/ChatPromptEditor。

不变量：

- 状态单一所有者：输入腿/播报腿状态的唯一所有者是 ui 包 store/voiceSessionStore（spec §3.1）；
  本模块（含 TurnSpeechPlanner）只经 AnnouncementLegControl 受控迁移面写入，不保留第二状态源。
- 播报 control 必须持唯一 owner 凭证；非 owner 卸载/切离不能取消共享引擎或修改全局播报态。
  acquire/renew 结果复核意图代际，失效结果只释放自己的具体 lease。
- 录音 episode 经 voiceRecordingControl 定向终止资源后回 Idle；逐句 injecting 不结束 episode。
  任务取消只投递绑定 workspace/session 的一个处理者；停止播报只投递当前播报 owner。
- 入口与起录使用同一引擎能力解析；remote 可用不要求 SpeechRecognition。凭据不入 store。
- partial 只进预览条、永不进 composer 正文与协议（spec §5.1）；音频 buffer 禁入任何 store。
- 契约字面量单一出处：wire/appSettings/claim 键只在 @drora/shared contracts/voice.ts；
  本模块只放 renderer 行为阈值（voiceTuning）与打断词表（interruptionWords，不进 wire）。
- 隐私边界：日志只记事件类型/文本长度/错误码，不落转写原文与音频数据（spec §7.1）。
- 播报白名单闭集：只有 spec §4.1 分级表「播」级内容可进 TTS；轮尾正文与 assistantCopyText
  同源聚合（buildTurnSpeechText，join("\n\n") 链）。

与其它模块的交集：

- ui（store）：AnnouncementLegControl ↔ voiceSessionStore guarded actions（唯一写入路径）；
- shared（contracts）：VOICE_BROADCAST_CLAIM_KEY / VOICE_INPUT_SOURCE_KIND 单一出处；
- desktop（Phase 1b）：VoiceAnnouncementClaimPort 由 BroadcastHub claim 通道适配，零新协议。
