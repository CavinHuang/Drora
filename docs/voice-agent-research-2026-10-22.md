# 语音交互 Agent 调研报告（2026-10-22）

> **读者画像**：想给自己的 agent 框架接入语音能力的工程师。
> **方法与可信度**：本报告汇总五路独立调研（交互架构、开源生态、学术论文、商业 API、框架接入）并落实核查意见。所有关键论断均经原始来源抓取核验（官方文档全文抓取、GitHub API 实测、arXiv 摘要页/HTML 原文核对）；核查中被证伪的内容已删除或改正（见[附录 A](#附录-a核查修正与存疑清单)），未能一手核验的内容在文中以「**存疑**」明确标注。活跃度/star 数据均为 2026-10-22 实测，时效性请以来源为准。

---

## 一、执行摘要

### 1.1 核心问题的答案：除了「语音转文字再读文字」，还有哪些真正不同的做法

级联管线（ASR→LLM→TTS）只是语音 agent 的一种实现，而且是工程上最保守的一种。经五路调研交叉证实，「真正不同」的做法有六类，差异不在组件快慢，而在**接口形态与语义**：

1. **语音原生 turn-taking**：不用「静音 N 毫秒 = 说完了」，而是用声学+语义模型直接从音频预测话轮是否结束（[LiveKit turn detector](https://docs.livekit.io/agents/logic/turns/turn-detector)、[Pipecat smart-turn](https://github.com/pipecat-ai/smart-turn)、Kyutai STT 内建 semantic VAD），或由模型自己在生成中决策（全双工）。
2. **全双工并行流**：模型同时建模「我说的」和「你说的」两条流，边说边听、边听边附和，轮次不再是显式状态而是模型行为（[Kyutai Moshi](https://arxiv.org/abs/2410.00037)；豆包 Seeduplex 3.0 新协议）。
3. **副语言直通**：情绪、语调、迟疑、讽刺不经过转写直接进入决策——要么端到端模型直接「听」（厂商口径：OpenAI Realtime、Gemini Live、Hume EVI；各家 API 的副语言感知能力未逐家核验——Gemini 有 affective dialog 官方功能，OpenAI 侧证据存疑，见 §2.5/§6.4），要么把韵律测量作为结构化信号旁路注入文本主脑（SLIMER、emotion2vec、Hume expression measures）。
4. **语音原生打断语义**：打断不是「停一下」，而是一整套级联取消协议——取消 LLM 流式生成、清空 TTS 缓冲、丢弃未播放音频、按声明决定是否取消工具调用、上下文只保留「实际说出口的部分」、状态对齐到用户实际听到的播放位置（Pipecat `InterruptionFrame` 机制、OpenAI `conversation.item.truncate`、豆包 `ConversationTruncate(audio_end_ms)`）。
5. **工具调用期间的语音交互**：进度双通道播报、静默期填充语、投机工具调用、异步非阻塞结果调度（Gemini `NON_BLOCKING` + `INTERRUPT/WHEN_IDLE/SILENT`）、不可逆操作等话轮结束（Deepgram `defer_until_eot`）。
6. **音文双流输出**：一条回复同时产出 audio delta 与 transcript delta 两条流，听感连续性与可审计文本不冲突（OpenAI Realtime 的 `modalities: ["text","audio"]`，经 Azure 文档逐字核验；另一拼法 `output_modalities` 未获一手核验，见附录 A.2。Qwen Realtime 侧未在本次核验中获得该能力证据，不作断言）。

### 1.2 十条核心结论

1. **生产系统默认选级联**。[LiveKit 官方文档](https://docs.livekit.io/agents/models/pipelines)对级联的定位是 "Choose this for most production agents"——每一层都是文本，可审计、可注入 RAG/工具/PII 脱敏、可随时换供应商；电话部署受 8kHz G.711 物理约束（端到端模型按 16–48kHz WebRTC 音频训练，不覆盖该场景）；受监管行业选级联的依据是每层文本可审计、可脱敏、数据流可控——工程通行做法，非逐条合规结论。
2. **「级联一定更慢」已被证伪**。两架构共同的主导项是 LLM 首字延迟，现代 TTS TTFB P99 已可低于 100ms（[Inworld 分析](https://inworld.ai/resources/cascaded-vs-speech-to-speech-voice-architecture)称「级联更慢」是"语音代理架构中最持久的迷思"；[LiveKit 博客](https://livekit.com/blog/realtime-vs-cascade)原话 "the pipeline can get close, it just takes more engineering to get there"）。**「端到端一定更强」同样不成立**：[τ-Voice 基准](https://arxiv.org/abs/2603.13686)实测文本 LLM 任务完成率 ~85%，语音 agent 干净条件下仅 31–51%、噪声/多口音下 26–38%——干净条件下语音通道保留文本能力的约 36–60%、噪声/多口音下降至约 31–45%，且 79–90% 的失败源于 agent 自身行为。
3. **turn-taking 正从声学 VAD 迁移到语义/声学端到端轮次模型**，这是级联管线体验提升的最大杠杆：smart-turn v3.2（8M 参数、CPU ~10ms、BSD-2 全开源）、LiveKit turn detector（14 语种、模型专有许可）、TEN Turn Detection。VAD+轮次模型叠加是当前产品级体验的最低配置。
4. **打断必须一次做对三层语义**：① barge-in 停播报；② 对话历史截断（只保留用户实际听到的，防上下文污染）；③ 任务取消与否显式建模——**打断 ≠ 取消**（[LiveKit async tools](https://livekit.com/blog/async-tools-voice-agents) 用 `ToolFlag.CANCELLABLE` + `get_running_tasks()/cancel_task()` 单独建模任务取消）。把三层塞进一个布尔开关是最常见的错误。
5. **Backchannel（附和）与打断在音频上几乎相同**：[Deepgram 工程文章](https://deepgram.com/learn/backchannels-vs-interruptions-voice-agents)的数据是能量检测器对 45% 的 backchannel/噪声误触发；听者附和的频率约为打断的 7 倍。需要按「肯定/否定 token + 是否有后续语音」序列判定，这是半双工系统最易被忽视的自然度来源。
6. **延迟预算的三个锚点**：ITU-T G.114 单向 150ms（注意是 network one-way 口径）、人类话轮间隙约 200ms（[Stivers et al., PNAS 2009](https://www.pnas.org/doi/10.1073/pnas.0903616106)，10 种语言普遍）、agent 响应 <1s（LiveKit，具体页面未定位——**存疑**，见附录 A.2）。主要手段：全流式重叠、interim results、增量 TTS、投机工具调用、WebRTC 传输（建连 ~100ms vs WebSocket ~200ms，Azure 官方口径——注意是一次性建连开销，非每句稳态延迟，见 §3.4）。
7. **编排框架三强格局**：[Pipecat](https://github.com/pipecat-ai/pipecat)（16.7k★，帧式管线，打断策略最完整）、[LiveKit Agents](https://github.com/livekit/agents)（14.9k★，一体化+语义轮次+误打断恢复）、[TEN Framework](https://github.com/ten-framework/ten-framework)（11.2k★，扩展图编排）；Vocode 已停更两年。[Unmute](https://github.com/kyutai-labs/unmute)（1.5k★，MIT）是「文本主脑+流式语音外设」的中间路线代表。
8. **端到端开源模型约两年洗了一轮牌**（首批停更时点 2024-11/12 距今 22–23 个月）：2024 年同期的先行者多数停更——Mini-Omni、GLM-4-Voice 分别于 2024-11/2024-12 后无更新，例外是 Moshi（2024 年论文，至今活跃，见 §4.2）；当前综合最强的开放底座是 Qwen3-Omni（Thinker–Talker，Apache-2.0）；开放权重中官方声明语音原生工具调用的，本次检索仅见 Step-Audio 2 mini（Apache-2.0）——未对 Qwen3-Omni 等其他开放权重模型逐一实测对比，「仅见」是检索结论而非穷举证明。**端到端模型当前的真实定位是「对话体验天花板+多模态理解底座」，而非 agent 执行主体**——工具生态、可观测性、鉴权、审计都仍在文本世界。
9. **端到端事件协议正向 OpenAI Realtime 风格收敛**：阿里 Qwen-Omni-Realtime 与豆包 Seeduplex 3.0 新协议均沿用 `session`/`input_audio_buffer`/`response.*`/`conversation.item.*` 事件族（细节有两处命名出入，见 §6.6）。学会一套事件族即可低成本横移多家供应商。
10. **编码 agent 的语音接入现状 = 听写 overlay 基线**：Claude Code `/voice` 官方文档明示「只把语音转成文字插入输入框、没有语音回应、Esc doesn't interrupt Claude's response」；开源社区的双向尝试全部停在 MCP 工具旁路。**「任务运行中可插话 + 可取消 + 进度播报」的完整闭环，在本次调研检索范围内（7 个主流编码产品官方文档 + 4 个开源旁路实现 + 通用搜索，2026-10-22）未发现实例——按现有证据这是空白区与差异化机会，但全称否定无法穷举证明**（原语已齐，见 §7）。

### 1.3 选型速查

| 你的场景 | 建议 |
|---|---|
| 生产客服/电话/合规审计 | 级联：LiveKit Agents 或 Pipecat + Deepgram/Cartesia（海外）或 FunASR+CosyVoice（中文栈） |
| 共情型 C 端 WebRTC 对话 | 端到端 S2S：OpenAI Realtime / Gemini Live / Qwen-Omni-Realtime；注意 τ-Voice 的能力折损数据 |
| 保住文本 agent 全套工具链 + 语音界面 | Unmute 式全流式级联，或 Realtime 会话 + MCP 工具（OpenAI/Azure 官方支持形态） |
| 长任务 agent 的远控/移动监督（边跑边聊） | 模式 D（实时语音网关 + 文本 agent 大脑），协议按 §7.4 提前预留 |
| 全中文栈自托管 | 级联：FunASR（Paraformer-streaming）+ CosyVoice2 + silero/TEN-VAD + smart-turn + 任意中文文本 LLM。注意：CosyVoice2 许可为快照级证据、CosyVoice 3.0 许可未核（§4.5）；smart-turn 宣称 23 语种但本报告未见中文轮次实测数据（§3.1）。若走端到端，Qwen3-Omni / Step-Audio 2 mini 是开放权重选项——那是以语音模型替换整条管线（§4.2 定位），不是级联组件，不要混装进同一条栈 |
| 边缘/端侧/自有硬件 | 全本地优先：Moonshine（全 MIT）+ Kokoro（Apache）+ silero-vad，无云端依赖；若可接受云依赖：整机起 [xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) + 自托管 server——但其体验上限取决于云端模型、端侧无本地智能（§4.4），与全本地路线方向相反，按约束二选一 |
| 纯对话陪伴/低结构场景 | 全双工（Moshi 系开源、或 Seeduplex 3.0 类托管） |

---

## 二、语音交互 Agent 的架构范式

### 2.1 级联管线（Cascade：ASR → LLM → TTS）

三个专用模型串联，每个边界都是文本。[LiveKit 官方文档](https://docs.livekit.io/agents/models/pipelines)把语音 agent 分为 cascaded / turn-based realtime / full-duplex realtime 三类，对级联的定位是：**"Choose this for most production agents. It gives you full control over each stage and is the easiest path to debug and audit."**

- **延迟**：三段延迟相加，但全流式实现下各段可重叠。LiveKit 博客原话："the pipeline can get close, it just takes more engineering to get there."。Inworld 称「级联更慢」是迷思——两架构共同主导项是 LLM 首字延迟。第三方口径（Coval/Gradium，原文未抓取——**存疑**，见附录 A.2）级联端到端多在 1.5–3s，优化好的流式管线可到数百毫秒。
- **副语言保真**：最差。LiveKit 文档明确："prosody and emotional cues in the user's speech don't reach the LLM"。转写边界天然丢弃语气、迟疑、讽刺、笑声。
- **成本**：逐层可控、可按档位裁剪——简单查询路由小 LLM、高流量用便宜 STT、只在需要时用高端 TTS。Inworld 给出的量级：STT ~$0.15/小时、TTS ~$0.02/分钟（合计 ≈$1.35/小时），低于 gpt-realtime 系按音频 token 计费的高价位（$32/M 输入、$64/M 输出音频 token）。**注意这只是「高价 S2S 档 vs 级联」的比较，不是「级联更便宜」的普适结论**：§6.5 榜单显示端到端成本跨约两个数量级、最低 $0.0331/小时（Qwen Audio 3.0 Realtime Plus）——比上述级联口径还低约 40 倍；最便宜端到端与级联的质量差距，本报告未获量化数据。
- **可控性**：最强。每层都是文本，可审计、可注入 RAG/工具/PII 脱敏、可随时换供应商；电话（8kHz G.711）是物理约束——端到端模型按 16–48kHz WebRTC 音频训练、不覆盖该场景；受监管行业（HIPAA/GDPR）选级联的依据是每层文本可审计、数据流可控（工程通行做法；合规义务与采样率是两类约束，本报告未逐条核对监管条文）。
- **适用**：客服、电话外呼、合规审计要求高、需要品牌克隆音色、成本敏感的高流量场景。

### 2.2 端到端语音对话（speech-to-speech / native audio）

单一模型直接消费音频 token 并产出音频 token。LiveKit 文档明确区分两个子类：

- **Turn-based realtime**（如 OpenAI Realtime API）：等用户说完再回应；Azure 官方文档描述为低延迟 "speech in, speech out"，WebRTC 接入连接延迟约 ~100ms（WebSocket ~200ms）。
- **Full-duplex realtime**：边说边听、模型自主决定轮次（LiveKit 文档以 "GPT-Live" 类模型为例；Kyutai Moshi 是开源代表）。

代表实现：

- **OpenAI Realtime API**（经 [Azure 官方文档](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/realtime-audio)逐字核验）：`session.update` 配置 `turn_detection`（`none`/`server_vad`/`semantic_vad`）、工具调用与 MCP server 直连、`conversation.item.truncate` 实现打断同步；支持 `modalities: ["text","audio"]` 音文双模态输出（Azure 文档逐字核验：`response.create` 与 session 对象均用 `modalities`；另一拼法 `output_modalities` 未获一手核验，见附录 A.2）与 out-of-band 响应；会话上限 60 分钟。
- **Gemini Live API**（[官方文档](https://ai.google.dev/gemini-api/docs/live)）：原生音频双向会话、服务端 VAD 自动响应、原生音频模型仅输出 AUDIO 模态。
- **Moshi**（[arXiv:2410.00037](https://arxiv.org/abs/2410.00037)）：首个实时全双工口语大模型。多流 Transformer 分别建模自身语音与用户语音，**移除显式轮次划分**，支持打断与插话；Inner Monologue（文本 token 作为音频 token 前缀）显著提升语言质量并顺带提供流式 ASR/TTS；理论延迟 160ms、实测约 200ms。论文对级联的经典批评：延迟达秒级、丢失情绪等非语言信息、无法处理重叠语音。
- **Hume EVI**（[官方文档](https://dev.hume.ai/voice/docs/speech-to-speech-evi/overview)）：以韵律测量（expression measures，流式绑定到每句话）为核心卖点的情感语音接口。归类说明：官方按 speech-to-speech 产品形态提供，故列于本节；其内部实为「ASR+LLM+TTS 跑在同一服务上」的工程混合体（EVI 3 可外挂第三方 LLM，见 §2.3）——两种口径并存，以官方产品分类为准。⚠️ 文档标注其 TTS 与 EVI API 将于 **2026-11-13 日落**，选型需注意。

能力上限要警惕（两条定量反证）：

- [τ-Voice](https://arxiv.org/abs/2603.13686)：文本 LLM（GPT-5 推理模式）任务完成率 ~85%，语音 agent 干净条件下 31–51%、噪声/多口音下 26–38%，且 79–90% 的失败源于 agent 自身行为。
- [The Cascade Equivalence Hypothesis](https://arxiv.org/abs/2602.17598)：语音 LLM 在很多任务上仍表现得像 ASR→LLM 管线（依赖转写而非音频）。

**适用**：面向消费者的共情型 WebRTC 对话、追求自然交互、对话轮次短、对推理深度要求不高的场景。

### 2.3 混合式

经核验的三种混合形态：

1. **文本主脑 + 语音外设**：[Kyutai Unmute](https://github.com/kyutai-labs/unmute)——"Make text LLMs listen and speak"：用 Kyutai 低延迟 STT/TTS 包住任意文本 LLM（生产用 GPT OSS 120B 经 OpenRouter），保持文本主脑的全部推理/工具能力。README 实测：STT/TTS 与 LLM 同卡时 TTS 延迟 ~750ms，三卡分离后降到 ~450ms。底层模型论文为 [Delayed Streams Modeling](https://arxiv.org/abs/2509.08753)。
2. **Realtime hybrid（半级联 half-cascade）**：LiveKit 给出两种官方混合——Realtime + 独立 STT（受监管场景要完整时间戳转写）；Realtime + 独立 TTS（保留情感感知输入，同时用品牌音色输出）。
3. **模型内文本主脑**：Moshi 的 Inner Monologue 本质是在一个模型里保留文本推理通道；Qwen 的 Thinker–Talker（文本推理与流式发声解耦，见 §5.1）是同一思想的工业级收敛；Hume EVI 兼具两种口径：官方按 speech-to-speech 产品归类（§2.2），内部则是「ASR+LLM+TTS 跑在同一服务上」的工程混合体（文档自述 EVI 3 可外挂 Anthropic/OpenAI/Google 的 LLM）。

**适用**：想要端到端的语音体验但拒绝供应商锁定的团队；需要文本推理深度 + 语音自然度的产品；从级联向端到端迁移的中间态（Inworld 建议：先建级联——级联→端到端容易，反向重建 turn-taking/音色/可观测性成本极高）。

### 2.4 全双工与半双工

- **半双工系统** = turn-taking 技术栈（§3.1）+ 显式状态机（`listening/thinking/speaking`，见 §3.3）。工程可控、可审计，是当前绝大多数生产系统的形态（少数例外：豆包 Seeduplex 3.0 已是无需 commit 即可边听边说的真全双工生产协议，见 §6.2）。
- **全双工系统** = 没有外部 turn 栈，轮次成为模型内部行为。Moshi 用并行双流实现；豆包 Seeduplex 3.0 新协议宣称无需 commit 即可边听边说。[全双工综述（arXiv:2606.19453）](https://arxiv.org/abs/2606.19453)给出 **L0–L3 架构层级**（双工决策发生在哪一层）、**T×I×R 交互本体**、**IDLE/LISTEN/SPEAK/WAIT/DUAL 决策状态机**三件套，并指出普遍存在「实现差距」——架构上能全双工，实际行为仍受训练与评测中的交互模式限制。
- **观点**：全双工最大的短板不是建模而是**评测**——多数论文的全双工优势至今缺乏统一量化证据（Full-Duplex-Bench 系列是少数认真做行为评测的，见 §5.4）。工程上建议从显式状态机起步，全双工作为表达自然度的增量而非架构前提。

### 2.5 四维对比与选型观点

| 维度 | 级联 | Turn-based S2S | Full-duplex S2S | 混合（Unmute/Thinker-Talker） |
|---|---|---|---|---|
| 端到端延迟 | 中（可流式优化逼近 S2S） | 最快 | 最快（且无轮次等待） | 取决于外设质量 |
| 副语言保真 | 丢失（文本边界） | 证据不全：Gemini 有 affective dialog 官方功能（§6.4），OpenAI 侧未逐家核验 | Moshi 天然保留且可实时附和（§3.2）；托管全双工同左，未逐家核验 | 可选保留输入侧 |
| 成本 | 逐层可控；托管口径 ≈$1.35/hr，未必低于廉价端到端（§2.1/§6.5） | 高价档（gpt-realtime 系）至 $0.033/hr 档均有（§6.5） | 同左，端到端整体跨约两个数量级 | 中 |
| 可控性/可审计 | 完整文本轨迹 | 有限 | 模型自主，最难 | 输入或输出侧可控 |

**观点**：生产系统默认级联（LiveKit 官方建议），共情型 C 端产品选端到端，既要推理深度又要语音自然的选 Unmute 式混合或 Thinker–Talker 式解耦。「级联一定更慢」「端到端一定更聪明」与「级联更便宜」三个流行叙事都不能当普适结论用——前两个已被证伪，第三个只在高价 S2S 档的比较中成立（§2.1/§6.5）。对要给**自己的 agent 框架**接入语音的团队（而非做纯语音产品），结论更直接：**agent 大脑留在文本世界，语音作为 I/O 模态接进来**——这是 §7 的主题。

---

## 三、关键技术问题

### 3.1 Turn-taking：从能量 VAD 到端到端轮次模型

人类参照系：Stivers et al.（[PNAS 2009](https://www.pnas.org/doi/10.1073/pnas.0903616106)，10 种语言语料）证明人类话轮间隙普遍只有 **约 200ms**——agent 必须在用户住口后 ~200ms 内开口才显得自然。

工程实现从粗到细分四层（各层均经源码/官方文档验证）：

1. **能量 VAD**：判断「有没有人在说话」。[Silero VAD](https://github.com/snakers4/silero-vad)：单 CPU 线程对 30ms+ chunk 推理 <1ms、JIT 模型 ~2MB、MIT、支持 8/16kHz——便宜且快，但完全不理解语义。
2. **静音超时 endpointing**：VAD 之上的固定静音窗。[Deepgram 文档](https://developers.deepgram.com/docs/endpointing)：`endpointing=500` 表示 500ms 静音才终化并置 `speech_final=true`。问题：窗口调短误触发、调长响应慢，「我想想……」的停顿会被误判为说完。
3. **语义 VAD（semantic endpointing）**：基于已转写文本的含义判断是否说完。OpenAI Realtime（经 Azure 文档核验）：`turn_detection.type="semantic_vad"`——按用户已说出的词判断其是否完成表达；`server_vad` 则按 `threshold/prefix_padding_ms/silence_duration_ms`（默认 0.5/300ms/200ms）切分。代价：语义 endpointing 依赖 ASR 先行，串行链路本身加延迟。
4. **声学+语义端到端 turn 模型**：直接从音频预测「他说完了吗」，不依赖转写。
   - **LiveKit turn detector**（[官方文档](https://docs.livekit.io/agents/logic/turns/turn-detector)）：v1（跑在 LiveKit Inference）与 v1-mini（本地 CPU）；官方示例（用户一句话内含两次中途停顿："Hi. I'd like to book a flight" @2.53s → "from Dublin to New York." @4.85s → "This Friday." @~6.4s）：文本（STT）版在 2.76s、4.88s、6.40s 三个话内时刻反复误判「说完」并提交，音频版顶住停顿、直到 6.41s 话轮真正结束才提交一次——**数字均为话内提交时刻（时间轴位置），不是停顿时长**；文本版基于 Qwen2.5-0.5B-Instruct，且**文本版方案本身已标弃用**（官方称 2.0 版移除，现役推荐音频版与 v1-mini）；支持 14 语种（含中文）；启用后端点延迟默认 min 0.3s / max 2.5s。配套基准 [eot-bench](https://github.com/livekit/eot-bench)。**注意：框架 Apache-2.0，但 turn detection 模型权重为 LiveKit Model License，商用需读条款。**
   - **Pipecat smart-turn v3.2**（[README](https://github.com/pipecat-ai/smart-turn)）：audio-native，直接吃 PCM 以捕捉韵律线索；23 语种；部分 CPU 上推理仅 ~10ms；CPU 版 8MB int8 / GPU 版 32MB fp32；BSD-2 完全开源（数据集+训练脚本+权重）；设计上与 Silero VAD 协作——**只在静音期运行**，这是延迟上的关键工程取舍。
   - **TEN Turn Detection**（[仓库](https://github.com/TEN-framework/ten-turn-detection)）：面向全双工对话的开源轮次检测；配套 [TEN-VAD](https://github.com/TEN-framework/ten-vad) 是轻量低延迟 VAD。
   - **Kyutai STT 内建 semantic VAD**：把「是否说完」做成 ASR 模型内建能力（0.5s 延迟版自带，见 [delayed-streams-modeling](https://github.com/kyutai-labs/delayed-streams-modeling)），省掉独立 VAD+轮次模型组合。

**观点**：VAD 决定「有没有人在说话」，轮次模型决定「话说完没有」；二者叠加（LiveKit 默认做法）是当前产品级体验的最低配置。纯 VAD 方案在真实对话里会把「等等，让我想想」当成句尾。

### 3.2 Backchannel（附和）与误打断

术语出自 Victor Yngve（1970）。[Deepgram 工程文章](https://deepgram.com/learn/backchannels-vs-interruptions-voice-agents)给出迄今最系统的实现论述：

- **本质区别**：backchannel 话语权仍归说话者（"nodding out loud"），interruption 是夺权；音频上几乎相同，能量 VAD 无法区分 "uh-huh" 与 "wait, that's the wrong address"。文中数据：**能量检测器对 45% 的 backchannel/噪声误触发**；听者附和的频率约为打断的 **7 倍**。
- **实现**：Deepgram `filler_words` 参数返回统一拼写的七个发声词（uh/um/mhmm/mm-mm/uh-uh/uh-huh/nuh-uh），其中肯定类（mhmm/uh-huh）= 继续说、否定类（uh-uh/nuh-uh/mm-mm）= 必须让位——"The two sets call for opposite actions"。
- **决策序列（顺序关键）**：① 播放中检测短促发声 → ② 是否在 token 集内、肯定还是否定 → ③ token 后是否还有后续语音（"uh-huh, but..." 是抢话）→ ④ 执行：单独肯定→hold，任何否定→立即 yield，肯定+后续→yield，无匹配→按普通 barge-in yield。
- **运维指标**：误打断率 = agent 停止说话后 2s 内用户没有完整发言的次数 / 停止次数；同时跟踪「漏掉的更正」——两个指标随单阈值反向移动，需按流程阶段（支付确认必须 yield，闲聊可 hold）分别设策略，且 token 列表不能跨语言照搬。
- **平台化**：Retell 官方文档有「Add backchannel」设置（可开关注率与用词；该页为 JS SPA，具体页面 URL 未能抓取——**存疑**，仅确认设置存在）；Pipecat 文档确认 [Krisp VIVA](https://docs.pipecat.ai/pipecat/fundamentals/interruptions) 可过滤 backchannel。全双工模型（Moshi）天然能出附和——这正是它「更像人」的来源之一。

### 3.3 打断（Barge-in）：级联取消协议与三层语义

以 [Pipecat 官方文档](https://docs.pipecat.ai/pipecat/fundamentals/interruptions)为范本，一次打断是**全管线级联取消协议**，不是简单静音：

1. user aggregator 广播 `InterruptionFrame`（SystemFrame，各 processor 立即处理不排队）；
2. 每个 processor 取消当前任务、丢弃排队的 DataFrame/ControlFrame；`FunctionCallResultFrame`、`EndFrame` 等标了 `interruptible=False` 的保留；
3. LLM 流式补全中途取消，注册了 `cancel_on_interruption=True` 的函数调用发出 `FunctionCallCancelFrame`；
4. TTS 停止合成、清空文本聚合缓冲；transport 排空未播放音频（背景混音器只排空人声，背景音不断）；
5. **上下文语义**：只提交「实际说出口」的文本作为 assistant 消息——LLM 下轮看到的是真实对话记录，不是被截断的原始生成。

端到端侧（Azure 文档核验）：服务端出音频快于实时，客户端用 `conversation.item.truncate` 截断未播放音频并同步删除服务端文本，"to ensure there isn't text in the context that the user doesn't know about"（WebSocket 下由客户端发送，WebRTC/SIP 服务端自动处理）。豆包旧协议的 `ConversationTruncate(audio_end_ms)` 是同一思想：**把上下文截断对齐到用户实际「听到」的播放位置**。

防误打断工程细节：Pipecat 的 `MinWordsUserTurnStartStrategy(min_words=3)` 防止 "okay" 触发打断；Krisp VIVA 策略用模型区分真打断与 "uh-huh"；无转写的打断（咳嗽/噪声）由 `empty_user_turn` 策略决定是否请用户重复。LiveKit 的**误打断恢复机制**最工程化：VAD 有声但转录为空 → `false_interruption_timeout` 静默观察 → 无词则发 `agent_false_interruption` 事件并可 `resume_false_interruption` 从中断处续播（[Turns 文档](https://docs.livekit.io/agents/logic/turns)）。

**观点**：语音 agent 的状态机难点不在枚举状态（LiveKit 的 `connecting → initializing → idle/listening/thinking/speaking → disconnected/failed`，以 `lk.agent.state` 参与者属性发布，见[官方文档](https://docs.livekit.io/frontends/build/agent-state)），而在**打断的原子性**——生成、合成、播放、工具、上下文五个层面必须同时收敛到一致状态；且必须一次做对三层语义：

1. **停播报**（barge-in）；
2. **截断历史**（只保留用户听到的部分，防上下文污染）；
3. **任务取消与否显式建模**——打断 ≠ 取消（见 §3.5 LiveKit async tools）。

文本 agent 没有这个问题，因为「未发送的消息」天然不存在。

### 3.4 延迟工程

**预算基准（经核实的锚点）**：

| 锚点 | 数值 | 出处 |
|---|---|---|
| ITU-T G.114 单向传输时间 | ≤150ms 多数用户满意；150–400ms 部分应用可接受；>400ms 不可接受 | [ITU 官方](https://www.itu.int/rec/T-REC-G.114/en)（注意 150ms 指 network one-way；mouth-to-ear 口径见 G.131 等关联建议，很多文章混用两者） |
| 人类话轮间隙 | ~200ms（10 语言普遍） | Stivers et al., PNAS 2009 |
| 「自然对话」的 agent 响应 | <1s | LiveKit 官方文档（具体页面未定位——**存疑**，见附录 A.2） |
| 传输层连接延迟 | WebRTC ~100ms / WebSocket ~200ms | [Azure OpenAI 官方文档](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/realtime-audio) |
| 全双工模型延迟 | Moshi 理论 160ms（实测 ~200ms） | arXiv:2410.00037 |
| 现代 TTS 首包 | Cartesia 宣称 <90ms（**厂商营销口径**，出自官网营销页而非 docs 页；其 docs 页无任何数字指标。「独立实测 166–440ms」**存疑**——第三方原始出处未核验） | Cartesia 官网 |
| Kyutai Unmute TTS 段 | 同卡 ~750ms → 三卡分离 ~450ms | Unmute README |
| 端到端 TTFA（第三方榜） | 主流端到端模型约 0.4–1.2s | [Artificial Analysis](https://artificialanalysis.ai/speech-to-speech) |

二手口径（未独立核实，仅作量级参考）：业界普遍把 TTFA ≤500ms 当「够快」、实测中位数 ~1400ms；[pipecat-ai/stt-benchmark](https://github.com/pipecat-ai/stt-benchmark) 把 **TTFB/TTFS + Semantic WER** 作为流式 STT 的标准度量对。

**常见手段（每条有出处）**：

- **流式 ASR**：interim results（部分假设先行）+ endpointing 调参协同（Deepgram 官方建议搭配）；STT 选型看 TTFB 而非只看 WER。
- **增量 TTS**：LLM token 流式喂 TTS、句级分块，首包先行；TTS 与 STT 独立 GPU 部署降首包（Unmute 实测 300ms 改善）。
- **LLM 首字**：两架构共同主导项（Inworld）；按查询复杂度路由小模型（LiveKit 博客）。
- **重叠执行**：STT 部分结果 → LLM → TTS 三段流水线化。
- **投机执行**：见 §3.5。
- **网络**：浏览器/移动端用 WebRTC 而非 WebSocket（Azure：~100ms vs ~200ms）；WebRTC 栈免费提供 jitter buffer、自适应码率、浏览器端 AEC/AGC（回声消除直接决定「agent 说话时能否听见用户打断」）与 Opus DTX——WebSocket 实现这些都要手搓。电话场景受 8kHz G.711 限制。

### 3.5 工具调用期间的语音交互

这是文本 agent 完全没有、语音 agent 必须回答的问题：**工具执行数秒到数分钟，用户听什么？能说什么？**

**四种基础处理（均有出处）**：

1. **填充语（filler phrases）**：agent 先说 "let me check on that" 再等结果；Vapi 等平台可在 system prompt 或 function-call 事件上触发 say 消息。⚠️ 风险：第三方测试（Roark；VAmoS 基准——**存疑**，细节未独立核验）发现填充语连发或截断用户反而导致挂断，需要调参而非默认开启。
2. **投机工具调用（speculative tool calling）**：填充语音频与工具执行**并行**，结果回来后无缝衔接（[GetStream 博客](https://getstream.io/blog/speculative-tool-calling-voice/)；学术化为 [Speculative Interaction Agents](https://arxiv.org/abs/2605.13360)——用异步 I/O + 投机工具调用构建实时 agent）。
3. **背景音**：Vapi 支持 `backgroundSound`（2025-03 起支持自定义音频 URL）；Pipecat 的背景混音器在打断时只排空语音保留背景音——背景音已被当作一等公民而非补丁。
4. **进度播报**：长任务拆分为多次 say()（级联管线特有能力，LiveKit 对比表中标注端到端模型不支持）。

**最成熟的工程范本：[LiveKit 异步工具](https://livekit.com/blog/async-tools-voice-agents)（`livekit-agents>=1.6`）**，系统性解决了「工具运行分钟级时用户听到死寂」：

- **进度通道 1**：工具内 `await ctx.update(message)`——首次调用立即把控制权交还 LLM（message 作为合成工具返回值马上播报），工具转后台继续跑；后续 update **只在 agent 和用户都空闲时播出**，不打断正常对话；进度写进聊天上下文由 LLM 自然表述。
- **进度通道 2**：`ctx.with_filler(...)` 绕过 LLM，在静默间隙直接 `session.say()` 播填充语（支持 delay/interval/max_steps）。
- **取消语义**：`ToolFlag.CANCELLABLE` 让框架自动向 LLM 暴露 `get_running_tasks()` / `cancel_task(call_id)` 两个工具；工具内抛 `asyncio.CancelledError` 实现取消。关键区分：**用户打断（barge-in）≠ 取消**——打断只丢弃工具结果，代码仍在跑；真停止必须走 cancel_task。读阶段可取消、写阶段用 `ctx.disallow_interruptions()` 保护。
- **并发治理**：`on_duplicate` 按工具名处理重复调用（allow/reject/replace/confirm）。

**各托管 API 的语音特有工具语义**（详见 §6）：

- **OpenAI Realtime**：模型发出 function call 后**会话保持打开**，客户端执行工具期间用户仍可说话；工具结果经 `conversation.item.create(function_call_output)` + `response.create` 回灌；out-of-band responses（`conversation:"none"`）可在不污染上下文的情况下插播进度/确认语音。
- **Gemini Live**：声明 `behavior: NON_BLOCKING` 后模型不必等函数返回即可继续说话，`FunctionResponse` 里用 `scheduling: INTERRUPT|WHEN_IDLE|SILENT` 控制结果何时回来（INTERRUPT 立即插话、WHEN_IDLE 等模型说完、SILENT 只进上下文）——「工具执行期间语音体验」最细粒度的产品化。注意：异步 FC 当前仅 Gemini 2.5 Flash Live 支持，3.1 Flash Live 仅同步。
- **Deepgram Voice Agent**：用户打断会收到 `FunctionCallCancelled`；`defer_until_eot:true` 让不可逆操作（挂断等）等用户话轮结束再触发。
- **ElevenLabs**：Tool Call Sounds（工具执行期间播放环境音）与 Tool Interruptions（用户能否打断工具执行）做成一等配置项。

**观点**：长任务语音 agent 的全部原语已齐——进度双通道、静默填充、可取消标记、打断与取消分离、重复调用治理、结果调度、不可逆操作门。但把它们组合进一个真实 agent 框架（分钟级工具 + 权限门 + 多任务队列）的完整开源实现，在本次调研检索范围（§1.2 第 10 条）内未发现——这是接入设计的核心增量，见 §7。

---

## 四、开源产品与框架盘点

> 活跃度数据均为 2026-10-22 当天用 GitHub API 实测（star、`pushed_at`、license）。huggingface.co 在调研环境不可达，模型卡许可以 WebSearch 快照交叉核验并逐条标注；检索不到的内容标「存疑」或注明证据等级，不做推测。

### 4.1 语音 Agent 编排框架

| 框架 | 仓库 / star（实测） | 活跃度 | License | 一句话定位 |
|---|---|---|---|---|
| Pipecat | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) 16.7k | 推送至当日 | BSD-2 | 帧式（frame）流式管线，服务可任意插拔 |
| LiveKit Agents | [livekit/agents](https://github.com/livekit/agents) 14.9k | 推送至当日 | Apache-2.0（**轮次模型例外**） | 与 SFU 深度一体化的全托管 agent 运行时 |
| TEN Framework | [TEN-framework/ten-framework](https://github.com/ten-framework/ten-framework) 11.2k | 推送至当日 | Apache-2.0+附加条件 | 扩展（extension）图编排，Agora 系 |
| Unmute（Kyutai） | [kyutai-labs/unmute](https://github.com/kyutai-labs/unmute) 1.5k | 2026-09 | MIT | 文本 LLM 内核 + 流式语音 I/O 的「中间路线」 |
| Vocode | [vocodedev/vocode-core](https://github.com/vocodedev/vocode-core) 3.8k | **2024-11 后停更** | MIT | 早期电话语音 agent 库，历史地位大于当前实用 |

- **Pipecat**（Daily 出品）：一切皆 Frame——音频、转录、文本、控制信号在 FrameProcessor 链中流动；传输层可换（Daily WebRTC、FastAPI WebSocket、LiveKit、SmallWebRTC、Vonage 等）。工具调用走 `llm.register_function(name, handler)` + context aggregator（当前 API 为 `LLMContextAggregatorPair`，返回 user/assistant 双聚合器，自动把函数结果注回 LLM 上下文）。打断处理是各家最完备的（§3.3）；另有用户静音策略（如保护开场白）、多 agent 形态（handoff、fan-out、sidecar、跨进程分布式）。**取舍**：服务自由组合+打断策略最完备，适合自建栈、需要精细控制每一帧的团队；代价是自己理解帧流与上下文聚合。
- **LiveKit Agents**：`AgentServer → AgentSession → RoomIO`，模型以 plugin 接入，README 宣称原生 MCP 支持；`@function_tool` 装饰器 + `ChatContext`；agent 间 handoff 是一等公民；异步工具语义最完整（§3.5）。轮次检测 5 种模式：turn detector 模型（默认）、realtime model（跟随 S2S 服务端）、纯 VAD、STT endpointing、manual（push-to-talk）。误打断恢复机制（§3.3）是对「咳嗽/键盘声误打断」最好的解法。**取舍**：一体化程度最高（README 客户名单含 Spotify、Tinder、Retell、HeyGen），绑定 LiveKit 生态是主要锁定成本；turn detector 模型权重为 LiveKit Model License。
- **TEN Framework**：核心抽象是**扩展图**——ASR/LLM/TTS/VAD/RTC 各为 extension，以 cmd/data/audio_frame/video_frame 消息在 JSON 定义的有向图中流转，Go 运行时 + Python/C++ 扩展；官方 voice assistant 示例同时支持 RTC 与 WebSocket，另有 SIP 扩展接电话。**取舍**：图编排对「可视化积木、多语言混编」最友好，与 Agora RTC 组合适合国内实时互动场景；框架复杂度高于 Pipecat/LiveKit。
- **Unmute**：STT（流式+语义停顿判定）→ **任意文本 LLM**（OpenRouter/vLLM 均可）→ TTS（流式），全 WebSocket 链路。它证明：**不换 LLM 也能把「转文字再读文字」做到接近端到端的体感**——关键不在去掉 ASR/TTS，而在每一环都流式、且把轮次判定下沉到 STT 模型本身。**取舍**：保留文本 agent 全套工具链（RAG、MCP、代码解释器）；放弃全双工与输入侧副语言信息。
- **Vocode**：2023-2024 电话语音 agent 的标准答案，最后推送 2024-11-15，近两年无维护。只建议考古参考。

### 4.2 端到端 / 语音对话开源模型

| 模型 | 仓库（star 实测） | 架构要点 | 开放权重与商用 | 活跃度 |
|---|---|---|---|---|
| Moshi | [kyutai-labs/moshi](https://github.com/kyutai-labs/moshi) 11.3k | 全双工三流 + inner monologue + Mimi 编码器（24kHz→12.5Hz） | 权重 CC-BY-4.0（GitHub README 原文证实），可商用 | 2026-09 |
| GLM-4-Voice | [zai-org/GLM-4-Voice](https://github.com/zai-org/GLM-4-Voice) 3.2k | 流式思考：文本/语音交替流式输出 | 权重按 GLM-4 模型协议；**商用需在开放平台登记（登记后免费商用）——要求出自 HF 模型协议，非 README** | **2024-12 后停更** |
| Mini-Omni/2 | [gpt-omni/mini-omni](https://github.com/gpt-omni/mini-omni) 3.6k | 「边想边说」并行解码（[arXiv:2408.16725](https://arxiv.org/abs/2408.16725)） | MIT（仓库声明） | **2024-11 后停更** |
| Step-Audio 2 | [stepfun-ai/Step-Audio2](https://github.com/stepfun-ai/Step-Audio2) 1.5k | 交错音频 token 生成 + **语音原生 tool calling + 音频 RAG**（[arXiv:2507.16632](https://arxiv.org/pdf/2507.16632)） | mini 系 **Apache-2.0**（README 明示） | 2026-03 |
| Kimi-Audio | [MoonshotAI/Kimi-Audio](https://github.com/MoonshotAI/Kimi-Audio) 4.7k | 连续+离散双路输入、文本/音频并行输出头、流式 detokenizer（[arXiv:2504.18425](https://arxiv.org/abs/2504.18425)） | 代码 Apache-2.0+MIT；权重 MIT **存疑**（HF 卡快照级证据，未能一手核验） | 2025-06 |
| Qwen2.5-Omni | [QwenLM/Qwen2.5-Omni](https://github.com/QwenLM/Qwen2.5-Omni) 4.1k | Thinker-Talker + TMRoPE，流式语音输出（[arXiv:2503.20215](https://arxiv.org/abs/2503.20215)） | Apache-2.0 | 2025-06 |
| Qwen3-Omni | [QwenLM/Qwen3-Omni](https://github.com/QwenLM/Qwen3-Omni) 4.1k | MoE Thinker-Talker + Au 预训练 + multi-codebook 低延迟（[arXiv:2509.17765](https://arxiv.org/abs/2509.17765)：36 项音视频基准中 32 项开源 SOTA、22 项整体 SOTA） | 30B-A3B Instruct / Captioner，Apache-2.0 | 2026-04 |
| SenseVoice | [QwenAudio/SenseVoice](https://github.com/QwenAudio/SenseVoice) 9.6k | ASR+语种+情感+事件四合一（组织已由 FunAudioLLM 更名 QwenAudio，gh 重定向实测） | 代码 MIT；**SenseVoiceSmall 权重为自定义 model-license，商用前必须读** | 2026-09 |
| CosyVoice | [QwenAudio/CosyVoice](https://github.com/QwenAudio/CosyVoice) 24.1k | LLM 式 TTS；Fun-CosyVoice 3.0（0.5B，2025-12）双向流式、首包低至 150ms、9 语言+18 方言、3 秒参考音克隆 | CosyVoice2-0.5B 权重 Apache-2.0 **存疑**（HF 卡快照级，GitHub 侧无一手证据） | 2026-05 |

要点：

- **Moshi 是全双工的极端样本**：没有轮次概念，听与说同流并行；Rust 实现面向生产。生态延伸：Kyutai STT（stt-1b-en_fr 带 0.5s 延迟与 semantic VAD；stt-2.6b-en 2.5s 延迟）、Kyutai TTS（权重同为 CC-BY-4.0）。
- **GLM-4-Voice 展示了「保智商」的折中**：12.5Hz 单码本语义 token + 语音-文本交错预训练（[arXiv:2412.02612](https://arxiv.org/abs/2412.02612)），语音以文本为参照；影响了后续 Qwen Thinker-Talker 的设计。缺陷：仓库停更约两年。
- **Step-Audio 2 mini 是开放权重中语音原生 agent 能力最完整的样本**（以官方声明与配套基准 StepEval-Audio-Toolcall 为据，未与其他开放权重模型如 Qwen3-Omni 做工具调用横向实测——「最完整」是检索归纳而非对比评测）：语音输入直接触发工具调用，音频 RAG 可按检索到的语音切换音色；官方维护 vLLM 分支后端。**Step-Audio 3 Realtime（[arXiv:2609.14005](https://arxiv.org/html/2609.14005v1)，2026-09）宣称全双工+自适应推理+agent 能力，但未见开放权重**（论文 CC BY-NC-ND）——能力前沿又回到了闭源侧。
- **Qwen3-Omni 是综合最强的开放 omni 底座**：119 文本语言 / 19 语音输入 / 10 语音输出，30B-A3B MoE 让语音对话推理成本可控；另有低幻觉 Audio Captioner。
- **观点**：端到端模型当前的真实定位是「对话体验天花板 + 多模态理解底座」，而非 agent 执行主体。工程上最稳的形态是 Qwen3-Omni 式 Thinker-Talker：**把 agent 循环锚定在文本侧，语音作为流式 I/O 模态**。纯全双工（Moshi 系）适合陪伴/硬件伴侣等低结构场景；需要结构化工具链的产品，仍应选级联或 Unmute 式混合，把预算花在轮次与打断上。

### 4.3 组件层

**流式 ASR**：

| 项目 | star（实测） | 特点 | License |
|---|---|---|---|
| [openai/whisper](https://github.com/openai/whisper) | 111k | 事实基线，非流式 | MIT |
| [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | 26.0k | CTranslate2 重写，同精度 4 倍速、int8；仍是「准流式」（VAD 分块） | MIT |
| [modelscope/FunASR](https://github.com/modelscope/FunASR) | 20.8k | Paraformer-zh-**streaming** 流式 + 2pass、runtime WebSocket 服务；**中文流式首选** | MIT（个别模型另有协议） |
| [moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine) | 11.3k | 面向实时：用户还在说话时就开始干活；谱系到 1MB 级 tiny；**唯一「代码+权重全 MIT」** | MIT |
| [kyutai-labs/delayed-streams-modeling](https://github.com/kyutai-labs/delayed-streams-modeling) | 3.0k | 流式 + 词级时间戳 + **semantic VAD**；Rust 生产实现 | Apache-2.0 |

观点：Whisper 系适合「批式够用」的场合；真交互场景要么上真流式架构（Paraformer-streaming / Kyutai STT / Moonshine），要么接受 300ms+ 的分块延迟。

**TTS**：

| 项目 | star（实测） | 特点 | 权重商用 |
|---|---|---|---|
| [QwenAudio/CosyVoice](https://github.com/QwenAudio/CosyVoice) | 24.1k | CV3 双向流式 150ms；中文方言覆盖最强 | CosyVoice2-0.5B Apache-2.0（存疑，快照级）✅ |
| [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) | 33.3k | 表现力/克隆见长 | ⚠️ Community License：年收入 <50 万美元可商用；**禁止托管 TTS 服务**；须署名；禁未经同意克隆真人声 |
| [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) | 63.4k | 1 分钟数据 few-shot 克隆 + WebUI | MIT ✅（自训权重归你） |
| [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | 9.6k | 82M 参数、CPU 可跑 | Apache-2.0 ✅（README 明示 Apache-licensed weights） |
| [SWivid/F5-TTS](https://github.com/SWivid/F5-TTS) | 15.4k | DiT+ConvNeXt V2（[arXiv:2410.06885](https://arxiv.org/abs/2410.06885)） | ⚠️ 代码 MIT，**Emilia 预训练权重 CC-BY-NC-4.0——直接商用违规** |

**VAD 与轮次检测（被低估的关键件）**：silero-vad（10.5k★，MIT，事实标准）+ smart-turn（1.6k★，BSD-2）/ LiveKit turn detector（模型专有许可）/ TEN-VAD（2.3k★）+ ten-turn-detection（620★）的组合，见 §3.1。

### 4.4 整机/硬件与传输层

- **xiaozhi（小智）生态**验证了开源语音硬件的「薄设备 + 厚服务端」分工：[78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32)（31.7k★，MIT）固件自述为 "An MCP-based Chatbot"——语音入口接 Qwen/DeepSeek 等大模型，**设备控制走 MCP 协议**（设备端 MCP：扬声器/LED/舵机/GPIO；云端 MCP：智能家居、PC 桌面、搜索、邮件），支持 WebSocket 与 MQTT+UDP 双传输、171 种板型；[xinnan-tech/xiaozhi-esp32-server](https://github.com/xinnan-tech/xiaozhi-esp32-server)（11.0k★，MIT）自托管服务端，ASR/LLM/TTS/VAD/记忆/意图全可插拔。端侧只做唤醒（ESP-SR）、VAD、编码与播放。它同时让 **MCP 成为语音控制物理世界的默认接口约定**。局限：体验上限取决于云端模型，端侧无本地智能。
- **传输层**：[livekit/livekit](https://github.com/livekit/livekit)（21.7k★，Apache-2.0，Go+Pion 分布式 WebRTC SFU）是语音 agent 场景的默认 WebRTC 底座（Pipecat 与 LiveKit Agents 都有官方 transport）；[aiortc/aiortc](https://github.com/aiortc/aiortc)（5.1k★，BSD-3，纯 Python）是 Pipecat SmallWebRTC 的底座——省掉 SFU 的本地/小规模路线；Daily 是 CPaaS 模式——**服务端 SFU 闭源**，开源的是各端 SDK（如 daily-js，BSD-2）；自建 SFU 替选项：mediasoup（7.4k★，ISC）、Janus（9.2k★，GPL-3）。**为什么语音 agent 应该上 WebRTC 而不是裸 WebSocket**：jitter buffer、自适应码率、浏览器端 AEC/AGC、Opus DTX 与弱网恢复都是白送的（§3.4）。

### 4.5 商用许可红线清单（本次逐一核验）

- F5-TTS Emilia 权重 **CC-BY-NC**（商用需自训或换数据）
- Fish Speech：**禁托管服务** + 年收入门槛 + 署名义务
- GLM-4-Voice：商用需在开放平台**登记**（HF 模型协议）
- SenseVoiceSmall 权重：**自定义 model-license**
- LiveKit turn-detector 模型权重：**专有 Model License**（框架本身 Apache-2.0）
- Kimi-Audio 权重 MIT、CosyVoice2-0.5B Apache-2.0：**存疑**（HF 快照级证据，商用前请自行到 HF 模型卡复核）；CosyVoice 3.0 许可状态未核验

---

## 五、学术论文脉络（2023–2026）

> 以下论文均经 arXiv 摘要页或官方仓库实际检索核对；凡摘要页未写明、需读正文的细节均已标注；核查发现的错误已在本文改正（见附录 A）。

### 5.1 端到端语音对话：语音表示的四条路线

端到端的学术分歧集中在四个维度——表示层（语音如何变 token）、生成层（串行还是并行流）、时间层（半双工 vs 全双工）、信息层（韵律是否一等公民）。背景工具链：声学码本以 [EnCodec](https://arxiv.org/abs/2210.13438) 为代表；语义-声学统一 token 化以 [SpeechTokenizer](https://arxiv.org/abs/2308.16692)（RVQ 首层对齐 HuBERT 语义）为代表。

四条表示路线的代表工作：

- **离散语义单元当「外语词汇表」**：[SpeechGPT](https://arxiv.org/abs/2305.11000)（2023）把 mHuBERT 离散语音单元当词表扩进 LLM，chain-of-modality（CoM）三阶段训练——证明 LLM 可「原生」听说，但串行设计注定高延迟，是路线起点。[GLM-4-Voice](https://arxiv.org/abs/2412.02612)（2024）用 12.5Hz 单码本语义 token + 1T tokens 语音-文本交错预训练，可按指令调整情感/语调/语速/方言。
- **多流与交错（文本成为语音的「草稿」）**：[Moshi](https://arxiv.org/abs/2410.00037)（2024）——Inner Monologue 把文本 token 作每帧音频的前缀草稿，多流并行，全双工；[SPIRIT-LM](https://arxiv.org/abs/2402.05755)（Meta，2024）在同一序列交错文本 token 与语音单元，Expressive 变体追加 pitch token 编码韵律。[Mini-Omni](https://arxiv.org/abs/2408.16725) 用 text-instructed 生成 + 推理期批并行采样实现「边听边想边说」。
- **连续特征进、离散 token 出（混合表示）**：[Kimi-Audio](https://arxiv.org/abs/2504.18425)（2025，Whisper 系编码器 + Qwen2.5-7B 骨干，1300 万小时预训练）；[Qwen2.5-Omni](https://arxiv.org/abs/2503.20215)（2025）——**Thinker–Talker 解耦**：Thinker（LLM）生成文本，Talker 直接消费 Thinker 隐层表征自回归生成音频 token，滑窗 DiT 降首包延迟。后续 [Qwen3-Omni](https://arxiv.org/abs/2509.17765) 在同一框架上做到 36 项音视频基准中 32 项开源 SOTA、22 项整体 SOTA。
- **只听不说（对照组：音频理解 LLM，勿与对话模型混淆）**：[Qwen2-Audio](https://arxiv.org/abs/2407.10759)、[SALMONN](https://arxiv.org/abs/2310.13289)（Whisper+BEATs 双编码器）——输出均为文本，语音回复仍需外挂 TTS。

另有生产级统一模型：[Step-Audio](https://arxiv.org/abs/2502.11946)（130B 统一理解+生成，指令驱动控制方言/情感/唱歌/说唱）；[Baichuan-Audio](https://arxiv.org/abs/2502.17239)（12.5Hz 多码本，随文开源 OpenAudioBench）；MiniCPM-o 2.6（8B 端侧 omni 流式——**无 arXiv 论文**，官方仅 Notion 技术报告与 [GitHub](https://github.com/OpenBMB/MiniCPM-V)；Notion 页正文未能直接渲染核验，但该 URL 在官方仓库技术报告索引中字节级一致；后续 [MiniCPM-o 4.5](https://arxiv.org/abs/2604.27393) 明确实时全双工）。

| 模型 | 语音表示 | 流式 | 全双工 | 训练思路 |
|---|---|---|---|---|
| SpeechGPT | 离散语义单元（mHuBERT） | 否 | 否 | 模态适应 + CoM 文本对齐 |
| Mini-Omni | 音频 codec 离散 token | 是 | 准并行 | 文本引导语音生成 + 批并行 |
| GLM-4-Voice | 12.5Hz 单码本语义 token | 实时对话 | 否 | 语音-文本交错 1T tokens 预训练 |
| Moshi | 语义蒸馏 RVQ（Mimi，80ms 帧） | 是 | 是 | 多流 + inner monologue |
| Kimi-Audio | 连续入 / 12.5Hz 离散出 | 是（flow matching 去分词） | 否 | 13M 小时继续预训练 |
| Qwen2.5/3-Omni | Talker 音频 token（滑窗 DiT） | 是 | 否 | Thinker–Talker 端到端 |
| Step-Audio | 双码本 | 生产级对话 | 否 | 统一理解生成 + 指令控制 |
| Baichuan-Audio | 12.5Hz 多码本（语义+声学） | 是 | 否 | 两阶段预训练 |
| Qwen2-Audio / SALMONN | 连续编码器特征入 | 否 | 否 | 仅文本输出（对照组） |

**取舍结论**：离散语义 token 对齐快、省参数、可直接继承 LLM 智能，但音色韵律损失大；声学码本保真高但训练难、成本高；多码本与「连续入离散出」是折中；**Thinker–Talker 式解耦是当前产品化最稳的骨架**。Moshi 的 inner monologue、Mini-Omni 的 text-instructed、Qwen 的 Thinker–Talker 是「文本草稿并行生成」这一思想的独立收敛，已成工程共识。

### 5.2 全双工对话建模：「何时说」的决策器不断向模型内部迁移

1. [dGSLM](https://arxiv.org/abs/2203.16502)（Meta，2022/TACL 2023）：首个 textless 双通道对话模型，联合建模两个说话人的离散语音单元——全双工的纯语音原点；但无文本锚点导致语言质量差，此后工作普遍退回「文本辅助」。
2. **Moshi**（2024）：inner monologue + duet 式并行流——全双工从「双通道音频续写」升级为「文本辅助的并行生成」，语言质量第一次可用；代价是打断/沉默行为完全隐式，难调试难评测。
3. [Freeze-Omni](https://arxiv.org/abs/2411.00774)（2024）：**全程冻结 LLM**，仅训三阶段适配 + 多任务双工即达低延迟端到端；把双工决策做成外挂「状态头」——工程可控、训练便宜（6 万条多轮文本问答、8 GPU 可训），是工业友好的折中；自然度低于隐式并行流。
4. [Voila](https://arxiv.org/abs/2505.02707)（Maitrix/UCSD/MBZUAI，2025）：全双工、195ms 响应延迟（摘要原话 "surpassing the average human response time"——指**快于**人类平均响应时间，即低于 §3.1 的 ~200ms 话轮间隙锚点，方向是更快而非更慢）、保留 tone/rhythm/emotion、百万级声音与 10 秒声音定制——把全双工与人格化绑定为「自主语音 agent」形态。
5. 产品化收尾：MiniCPM-o 4.5（端侧实时全双工）。

### 5.3 副语言与情感建模

价值论据（Moshi 摘要的标准表述）：文本中间模态丢失「改变语义」的情感与非语音信息。三条建模路线：

- **隐式保留**（语音原生 token 天然带韵律）：Moshi、GLM-4-Voice、Voila。
- **显式控制**（文本指令驱动说话方式）：GLM-4-Voice（情感/语调/语速/方言）、Step-Audio（方言/情感/唱歌/说唱）。适用：人设型 agent、内容生成。
- **表示与描述**（情感作为可计算/可生成的中间表示）：
  - [emotion2vec](https://arxiv.org/abs/2312.15185)（ACL 2024 Findings）：无标注情感数据上的自监督预训练，通用语音情感表征；
  - [SECap](https://arxiv.org/abs/2312.10381)（AAAI 2024）：HuBERT-large + Q-Former Bridge-Net + LLaMA，用自然语言**描述**语音情感（emotion captioning），情感监督来自人工标注——**注意：SECap 与 emotion2vec 是同期各自独立的工作（均 2023-12 发布），原文不含 emotion2vec，此前调研将两者错误拼接为一条流水线，已改正**；
  - SPIRIT-LM-Expressive：pitch 显式 token 化；
  - [SLIMER](https://arxiv.org/abs/2410.01162)：冻结 LLM + 副语言感知编码器即可注入风格/情感，回复共情性显著优于语义-only 基线。

**判断**：副语言研究重心仍在「表示与控制」，而「情感如何反哺对话策略」（何时共情、何时附和、语气如何随上下文变化）的系统性研究缺位——现有评测中 VoiceBench 不测情感、Full-Duplex-Bench v1 仅以 backchannel 维度间接触及。这是空白带，也是做差异化语音 agent 的机会点。

**工程落地建议**：级联架构不必整体换血——把副语言作为**旁路结构化信号**（情绪标签、语速、停顿时长、音高轮廓）在 ASR 之外并行抽取，与转写一起注入 LLM 上下文，即可低成本获得大部分副语言价值（emotion2vec/SLIMER/Hume prosody 路线）；这本质上就是 Unmute/half-cascade 的输入侧扩展。

### 5.4 评测基准：从静态题库到实时行为考

- [VoiceBench](https://arxiv.org/abs/2410.17196)（2024）：测 LLM 语音助手的**内容能力**（开放问答/多选知识/多轮/指令/推理/安全/口音），本质是把文本基准「读出来」考听力+答力，不考交互。
- OpenAudioBench（随 Baichuan-Audio，2025）：测语音 LLM 的**逻辑推理与口语对话**，GPT-4o 评判。
- [Full-Duplex-Bench](https://arxiv.org/abs/2503.04721) 系列：测**交互行为**——这才是区分端到端与级联的关键。v1（停顿处理/backchannel/话轮转换/打断四维度）→ v1.5（重叠语音）→ [v2](https://arxiv.org/abs/2510.07838)（WebRTC 实时多轮 + 自动考官）→ [v3](https://arxiv.org/abs/2604.04847)（真实不流畅语音下的**工具调用**）。
- StepEval-Audio-360（随 Step-Audio）：多轮 360° 语音交互。

**演进判断**：评测正从「静态题库读题」走向「实时多轮行为考」，2026 年已把语音 agent 的工具调用纳入全双工语境——对应「语音 agent ≠ 语音聊天机器人」的工程趋势。

### 5.5 综述

- [WavChat: A Survey of Spoken Dialogue Models](https://arxiv.org/abs/2411.13577)（2024）——口语对话模型全景：范式/表示/训练/流式/双工/交互/数据评测。**与本主题最相关的一篇**。
- [Recent Advances in Speech Language Models: A Survey](https://arxiv.org/abs/2410.03751)（ACL 2025）——技术脉络梳理。
- [A Survey on Speech LLMs for Understanding](https://arxiv.org/abs/2410.18908)——理解侧（语言/副语言/非语言线索），与生成侧互补。
- [A Survey of Full-Duplex Spoken Dialogue Systems](https://arxiv.org/abs/2606.19453)（2026）——全双工专述：L0–L3 层级 + T×I×R 本体 + 决策状态机 + 实现差距审计。

**给工程师的结论**：如果只能选一条技术栈，**Thinker–Talker 式「文本质量+流式 Talker」+ 显式双工状态头 + FDB 行为评测**是 2026 年证据最充分的组合；纯端到端全双工（Moshi 系）仍以研究价值为主，评测体系尚未跟上。

---

## 六、商业 API 与产品形态

### 6.1 模型直连端到端 API

**OpenAI Realtime API（gpt-realtime 系列）**（协议细节经 [Azure 镜像](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/realtime-audio)与 [Realtime conversations 指南](https://developers.openai.com/api/docs/guides/realtime-conversations)核验）：有状态 Session+Conversation+Response；浏览器 WebRTC、服务端 WebSocket、电话 SIP，客户端用 ephemeral token 直连；会话上限 60 分钟。事件协议：客户端 `session.update`、`input_audio_buffer.append/commit/clear`、`conversation.item.create/truncate`、`response.create/cancel`；服务端 `input_audio_buffer.speech_started/stopped`、`response.output_audio.delta`、`response.output_audio_transcript.delta` 等。VAD 三态：`server_vad` / `semantic_vad`（eagerness 可调，见[官方 VAD 指南](https://developers.openai.com/api/docs/guides/realtime-vad)）/ 手动 commit 的 push-to-talk。工具调用：`function_call` item + 流式参数 delta，客户端回 `function_call_output` 后 `response.create` 续上；Realtime 会话可挂 MCP 工具（Azure 文档证实 `session.update` 支持 MCP server 直连；OpenAI 侧 "Tools and MCP" 专页多次抓取失败，未能直接核实——细节以官方文档为准）。混合输出：`modalities` 同开 text+audio 时一条回复同时产音频与转写文本两条 delta 流（Azure 文档逐字核验 `response.audio.delta` 与 `response.audio_transcript.delta` 并行下发）——**听感连续性与可审计文本不冲突**。

**Google Gemini Live API**（协议经官方 [python-genai SDK](https://github.com/googleapis/python-genai) 类型核验，原页在调研环境多次连接超时）：WebSocket 双向会话，客户端 `setup`/`realtimeInput`，服务端 `serverContent`（含 `interrupted` 标记，原文明确 barge-in 语义）+ `toolCall`；输出 24kHz。工具面：function calling、Google Search grounding；**不支持代码执行与 Maps/URL context**（此前调研「部分模型支持代码执行」不成立，已改正）。**独有设计是异步函数调用**：`behavior: NON_BLOCKING` + `FunctionResponse` 的 `scheduling: INTERRUPT|WHEN_IDLE|SILENT`——当前仅 Gemini 2.5 Flash Live 支持，3.1 Flash Live 仅同步 FC。

**Amazon Nova Sonic**：走 Bedrock 的 `InvokeModelWithBidirectionalStream`（HTTP/2 双向流），事件风格自成一派：`sessionStart`→`contentStart`（`generationStage: SPECULATIVE` 投机内容）→`textOutput`/`audioOutput`/`toolUse`→`contentEnd`→`completionEnd`；打断以 `textOutput` 中 `{"interrupted": true}` 标记；工具调用以 `toolUse` 事件驱动，客户端回 `toolStart/toolResult/toolContentEnd` 三连（[双向流文档](https://docs.aws.amazon.com/nova/latest/userguide/speech-bidirection.html)）。差异化在**与 Amazon Connect 电话体系的原生集成**——语音 agent 直接长在客服呼叫中心上。

**Azure Voice Live**：「全托管语音 agent 单接口」——ASR+生成式 AI+TTS 合一，WebSocket 事件与 Azure OpenAI Realtime 基本对齐，**Azure 特有的语音层增强为可选叠加**：降噪、回声消除（防止 agent 听见自己）、鲁棒打断检测、高级 end-of-turn 检测；模型可换（gpt-realtime 系、gpt-5 系、gpt-4o、Phi 等），支持 140+ locale STT、600+ 音色 TTS；工具/知识采用 **VoiceRAG 模式**（[overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live)）。**观点**：它是「企业版 Realtime」——牺牲模型直连的极简，换来电话级语音前端（AEC/降噪）与企业合规选项。

### 6.2 国内三家

**字节豆包（火山引擎）**——两代协议并存，对比极具启发性：

- **旧端到端 Realtime API**（[接入文档](https://www.volcengine.com/docs/DoubaoVoice/End-to-endreal-timespeechlargemodelAPIaccessdocument)）：仅 WebSocket+私有二进制事件协议，仅 `server_vad`（`end_smooth_window_ms` 默认 1500ms），**无原生 function calling**——agent 能力靠「客户端检索后文本注入」：`ChatRAGText` 事件把外部 RAG 结果（≤4K 字符）注入上下文；多轮状态用 `dialog_id` + Conversation 系列事件管理（约 20 轮滚动记忆）；**独有设计 `ConversationTruncate(audio_end_ms)`**：把对话上下文对齐到用户实际「听到」的播放位置。
- **新 Seeduplex 3.0 全双工协议**（[文档](https://www.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version)）：切换到 OpenAI 风格事件族并补齐 function calling；真全双工（无需 commit 即可边听边说）；支持唱歌、方言、音色复刻、用户结束意图检测，以及 `speech_text_buffer.commit/replacement`（直接注入话术/文本接管播报）。

**阿里 Qwen-Omni-Realtime**（[百炼文档](https://help.aliyun.com/zh/model-studio/realtime)）：OpenAI 风格事件+扩展：流式音频+**视频帧输入**（1 帧/秒）、`server_vad`/`semantic_vad`/manual 三种轮次、`response.cancel` 打断后清播放队列；工具面支持自定义 FC 与**远程 MCP 工具**（公网 HTTPS Streamable HTTP，默认需审批）；联网搜索与工具调用**互斥**；上下文限制音频 600s/视频 240s，会话 120 分钟。

**MiniMax**：**未检索到公开的实时语音对话（S2S）协议文档**——官方 2024-10 发布过「实时交互 API」（[公告](https://www.minimaxi.com/news/%E5%AE%9E%E6%97%B6%E4%BA%A4%E4%BA%92api-%E6%AD%A3%E5%BC%8F%E5%8F%91%E5%B8%83)，域名已迁移至 minimax.cn），但协议细节页未见于公开文档；现行公开 API 集中在 **T2A 语音合成**（HTTP 同步 ≤1 万字符 + WebSocket 流式）。定位上 MiniMax 强项是音色与 TTS，常被第三方平台（如 Vapi）作为 voice 组件集成。

### 6.3 Voice Agent 平台：四种产品抽象

按产品抽象分四类。注意轴的方向：前三类沿「配置 → 图编排 → 代码框架」一条**自定义程度**轴排列；第四类「模型直连型」不在这条轴上——它放弃产品化外壳、换协议直控，单列以补全对比。agent 三件事（工具/状态/知识）在各层的解法不同：

1. **配置对象型（Vapi、ElevenLabs、Retell）**：assistant = 可换件的 `transcriber+model+voice` 三元组（几十家供应商可插），system prompt、tools、structured outputs 是一等配置。Vapi 提供 GitOps（assistants 进 git、PR 审核、模拟测试后发布）与多 assistant 编排 Squads（[docs.vapi.ai](https://docs.vapi.ai/)）。[ElevenLabs](https://elevenlabs.io/docs/eleven-agents/customization/tools) 工具分五类：client tools（设备端执行）/ webhook / code tools（平台沙箱 JS）/ MCP / system tools，并配 Tool Call Sounds 与 Tool Interruptions——把「等待工具」这个语音特有尴尬做成配置项。[Retell](https://docs.retellai.com/build/single-multi-prompt/function-calling) 的工具分为**电话域原语**（Transfer Call、End Call、Press Digits(DTMF)、Send SMS）+ 集成工具 + 自定义函数（支持**异步后台执行不阻塞对话**）+ Code Tool；另有 backchannel 设置（页面 URL 未能抓取，存疑）。
2. **图编排型（[Bland Pathways](https://docs.bland.ai/tutorials/pathways)）**：电话对话流画成节点图——Default/Webhook/Knowledge Base/End Call/Transfer Call/Wait for Response 六类节点，边上有路径标签（LLM 按语义选分支）、节点可设条件、变量三种来源注入，支持 draft→staging→production 版本化与逐节点回放测试。**观点**：本质是**把不确定性从 LLM 手里收回**——合规话术、固定流程用节点锁死，只把分支判断留给模型；适合高合规外呼，不适合开放域闲聊。
3. **代码框架型（Pipecat、LiveKit Agents）**：见 §4.1。Pipecat Cloud 负责托管扩缩；LiveKit Agents Cloud 提供 SIP 电话、Inference 与 traces。**观点**：框架型的价值是 vendor-neutral 的可组合性与自托管，成本是自己拼最优组件；平台型的价值是电话原语与运维开箱即用。
4. **模型直连型（[Deepgram Voice Agent](https://developers.deepgram.com/docs/voice-agents-function-calling)）**：介于直连与平台之间——WebSocket 的 Settings 消息里显式声明 `agent.think.functions`（JSON Schema），函数不带 endpoint 即 client 端执行、带 endpoint 则 Deepgram 服务端调用；消息流为 `FunctionCallRequest`→客户端执行→`FunctionCallResponse`，**用户打断会收到 `FunctionCallCancelled`**，`defer_until_eot:true` 让不可逆操作等用户话轮结束再触发。

### 6.4 消费端语音交互与电话外呼

- **ChatGPT 语音模式**：标准模式为「ASR+TTS 包住 LLM」，Advanced Voice Mode 由音频原生模型驱动，模型直接听音频、响应更快、可感知语气、可随时插话（[Voice Mode FAQ](https://help.openai.com/en/articles/8400625-voice-mode-faq)——该页抓取受限，细节**存疑**，以原页为准）；工程上的公开痛点是 server VAD 误打断——用户停顿 ~2 秒即被抢答（[社区反馈](https://community.openai.com/t/advanced-voice-mode-constantly-interrupting-me/963973)）。
- **Gemini Live**：官方支持页明确「可随时打断、可中途补充或改话题」（[Android 支持页](https://support.google.com/gemini/answer/15274899)）；API 侧另有 affective dialog（感知情绪的语调）。
- **电话外呼 agent**已是独立产品品类：转人工（上下文保持转接）、DTMF 穿越 IVR、按键确认、通话后分析（Retell/Vapi/Bland）；延迟与打断容忍度比 App 语音更苛刻（PSTN 音质、无回声消除保障），因此 Bland 把打断禁用、逐节点测试做成一等能力。

### 6.5 定价与延迟的第三方基准

[Artificial Analysis Speech to Speech 榜](https://artificialanalysis.ai/speech-to-speech)（43 个模型）指标：**Time to First Audio**（主流端到端约 0.4–1.2s）、Big Bench Audio 语音推理、盲测 Arena Elo、Full Duplex Bench 对话动力学、每输入音频小时成本。已核实：最低成本为阿里 Qwen Audio 3.0 Realtime Plus（$0.0331/hr，页面标注 cheapest）；Gemini 3.8 Live $0.84/hr；Nova 2.0 Sonic $4.89/hr——**成本跨约两个数量级**。**存疑**（本次未能从页面证实）：「GPT-Realtime-1.5 TTFA 0.81s」（0.81s 实际对应页面上 SpaceXAI Grok Voice 3.0）与「GPT-Realtime 系 ~$11/hr」。豆包未见收录；榜单中 2026 年新增模型命名（GPT-Live-1、Gemini 3.8 Live 等）以榜单页为准。另有 [Streaming STT 榜](https://artificialanalysis.ai/speech-to-text/streaming)（AA-WER、首/末转写延迟）。

### 6.6 事件协议的收敛

**核心观察**：端到端阵营的事件协议正向 OpenAI Realtime 风格收敛——`session`/`input_audio_buffer.*`/`response.*`/`conversation.item.*` 事件族在阿里 Qwen-Omni-Realtime 与豆包 Seeduplex 3.0 文档中均出现；阿里 WebRTC DataChannel 沿用 `"oai-events"` 名称。措辞上的两处出入（核查实测）：阿里文档无客户端 `session.create` 事件（服务端直接下发 `session.created`，该初始化事件仅确认存在于豆包 Seeduplex 3.0）；阿里音频 delta 事件名为 `response.audio.delta`，OpenAI GA 为 `response.output_audio.delta`——**「几乎逐名一致」应弱化为「事件族风格一致、个别命名有差异」**。工程含义：学会一套事件族即可低成本横移多家供应商；自研协议也应以此为模板（见 §7.3）。

---

## 七、面向通用 agent 框架的接入设计模式与选型建议

### 7.1 现状：编码 agent 的语音接入停在「听写 overlay」基线

2025–2026 年主流编码 agent 的语音接入几乎全部是「ASR→文字指令→agent」：

| 产品 | 形态 | 关键事实（均经核实） |
|---|---|---|
| Claude Code `/voice` | 官方原生听写 | `/voice hold\|tap\|off`；hold 为按住 Space 的 push-to-talk；tap 模式 15 秒静音或 2 分钟自动停。音频流式上云转写（非本地），需 claude.ai 账户；20 种语言；针对编程词汇优化，项目名与 git 分支名自动作为识别提示。官方文档明确：**只把语音转成文字插入提示输入框，没有任何语音回应**，且 "Esc doesn't interrupt Claude's response"（[官方文档](https://code.claude.com/docs/en/voice-dictation)） |
| Cursor 2.0 Voice Mode | IDE 原生听写 | 2025-10 发布公告确认含 voice input（[论坛公告](https://forum.cursor.com/t/cursor-2-0-composer-in-app-browser-voice-more/139132)）；社区帖提及 Cmd+Shift+Space 快捷键但官方公告未提及——快捷键细节**存疑** |
| Superwhisper | 系统级听写 App | macOS/Windows/iOS/Android、本地/云模型、100+ 语言、SOC 2 Type II（[官网](https://superwhisper.com)；HIPAA 说法未见于所引页面，已删） |
| Aqua Voice | 编码专用听写 | 自有模型 Avalon（厂商自述技术语音基准关键词准确率 97.4% vs Whisper large-v3 65.1%——**厂商口径，未见独立复现**）；自定义词典；"Deep Context" 读屏幕；官网明确 "Designed for Claude Code / Codex"，提供 MCP、CLI、API 与 "Send it" 语音命令（[官网](https://aquavoice.com)） |
| Wispr Flow | 系统级听写 | 全系统插入文本，与 Warp 有原生合作页；向终端 agent 口述 prompt 的主流方案（[wisprflow.ai](https://wisprflow.ai/vibe-coding/warp)） |
| Talon + Cursorless | 无障碍语音编程历史线 | 可编程语音命令引擎 + 「语音语法做结构化代码编辑」VS Code 扩展——证明语音命令可以比自然语言指令更精确，但不接 LLM agent 循环 |
| Hey, GitHub! | 已终止的实验 | 2022-11 Copilot 语音控制实验（[Verge](https://www.theverge.com/2022/11/9/23449175/hey-github-voice-copilot-code-programming-system)）；2024 年春结束预览未转正（第三方报道一致，未见官方 changelog） |

开源双向尝试（全部停在 MCP 工具旁路）：[voice-mcp](https://github.com/shreyaskarnik/voice-mcp)（给 agent 挂 `listen()`/`speak()` 工具，Apple Silicon 本地 STT/TTS）、[voicemode](https://github.com/mbailey/voicemode)（可安装为 Claude Code 插件的语音会话）、[mcp-voice-hooks](https://github.com/johnmatthewtennant/mcp-voice-hooks)（**持续监听麦克风**，把语音输入以 hook 形式投喂，让用户在 Claude 干活时插话打断/改向——目前检索到的唯一「coding agent 运行中并发语音指令」实现）、[openinterpreter/01](https://github.com/openinterpreter/01)（语音接口整机方案——**已休眠，最后提交 2024-11**）。

**基线的五个体验瓶颈**（以 Claude Code `/voice` 为解剖标本）：只进不出（无语音回应）、无打断（语音与 agent 执行状态完全解耦）、无轮次感知（没有 VAD/end-point/backchannel 基础设施）、延迟叠加且上下文断裂（听写器不知道 agent 正在跑什么，无法做「停一下」「换个方向」）、编程词汇仍是硬骨头（社区 issue 要求自定义词汇；这也是 Aqua 用自定义词典+专用模型做差异化的原因）。

**观点**：基线方案解决的是「输入效率」，不是「语音交互」。它值得做（成本几乎为零），但它与真正的语音 agent 是两个物种。

### 7.2 协议层现状：audio 在各协议里的形态

| 协议 | 音频能力 | 形态与局限 |
|---|---|---|
| MCP（2025-06-18 修订版） | ✅ audio content block | 工具结果 content 支持 `{"type":"audio","data":"<base64>","mimeType":"audio/wav"}`（[Tools 规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)）。但 `tools/call` 是一次性 JSON-RPC 往返：**无音频流、无会话、无打断语义**，音频只能整段搬运 |
| OpenAI Chat Completions | ✅ 整段音频进出 | `input_audio` 内容分片（base64）+ `modalities:["text","audio"]` 输出 `message.audio{data,transcript}`（[实测记录](https://simonwillison.net/2024/Oct/18/openai-audio)）。非流式会话，适合异步整段 |
| Anthropic Messages | ❌ 无 audio block | content block 全部类型清单中没有任何音频类型（原页区域屏蔽，经官方 [anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) 类型导出核验：`grep -ic audio` = 0）。语音只能在外围转成文字 |
| OpenAI Realtime API | ✅ 完整语音会话协议 | 事件协议见 §6.1；另支持在会话里挂 MCP 工具——「语音网关即模型、工具走 MCP」 |
| Gemini Live API | ✅ 完整语音会话协议 | WebSocket 双向会话、原生 barge-in、function calling、transcript（§6.1） |

**观点**：协议层「半支持」。content block 层面（MCP/Chat Completions）的 audio 是**数据形态**的补丁——整段 base64，不含时序；**会话语义**（流式帧、VAD、打断、truncate、cancel）只存在于 Realtime/Live 这类 S2S 会话协议里。

### 7.3 语音网关 ⇄ 文本 agent 大脑：事实标准事件集

三个开源框架 + 两个托管协议收敛出一套事实标准事件集——这就是接入接口。三条方向约定先行：**音频只存在于「用户 ⇄ 网关」段，大脑永远只见文本与控制事件**（§2.5「大脑留在文本世界」的前提）；**tool_call 由大脑自身的执行循环发起、tool_result 回灌大脑上下文，网关不代发工具调用**，只透传进度与结果播报；**用户打断的声学信号由网关检测，转化为对大脑的 barge_in / 取消请求**。

```
┌──────────────┐  audio 帧流 ↑              ┌────────────────┐  transcript / vad / barge_in ↑      ┌────────────────┐
│ 传输层（用户） │ ────────────────────────▶ │ 语音网关        │ ─────────────────────────────────▶ │ 文本 agent 大脑 │
│ 麦克风/电话/   │                           │ (Pipecat/      │ ◀───────────────────────────────── │ (agent runtime) │
│ 桌面客户端    │ ◀───────────────────────── │  LiveKit/TEN)  │  say() / 回复文本 / progress /       └────────────────┘
└──────────────┘  合成音频+字幕+状态 ↓       └────────────────┘  取消确认（工具调用在大脑内部闭环）
```

- **用户 ⇄ 网关（音频面）**：上行 `audio_in 帧流`；下行 `response_audio_delta`（TTS 合成流）、`response_text_delta`（字幕）、`agent_state(idle/thinking/speaking)`。
- **网关 → 大脑（文本/控制上行）**：`transcript_partial`、`transcript_final`、`vad_speech_start/stop`、`barge_in`（含转化为取消请求的语义）。**没有 audio_in——大脑不接收音频帧**。
- **大脑 → 网关（文本/控制下行）**：回复文本（交网关 TTS 合成下行音频）、`say(text)`（不经 LLM 的直接播报）、`progress_update`（长任务中间状态）、取消确认（打断后丢弃/保留哪些工具结果的回执）。
- **工具调用（大脑内部闭环，不过网关）**：大脑执行循环发起 `tool_call`、`tool_result` 回灌自身上下文；需播报的中间状态走 `progress_update`，最终结论随回复文本下发。（例外：模式 E 的 Realtime 会话由 S2S 模型向客户端发 function_call——那是「模型即网关」形态，见 §6.1，不在本图范围。）

OpenAI 把基线路线 SDK 化了：**Agents SDK VoicePipeline** 就是 "STT → 你的 agent workflow → TTS" 三步管线（[docs](https://openai.github.io/openai-agents-python/voice/pipeline/)），把任意 agentic 工作流变成语音应用；[openai-realtime-agents](https://github.com/openai/openai-realtime-agents) 展示 S2S 替代路线。

**关键判断**：接入一个已有文本 agent 的真实工作量**不在音频管线**（框架已全部解决），而在把 agent 的执行循环改造成**可被 tool_call 驱动的常驻服务**：能接收外部注入的指令、能流式吐进度、能被取消。这是「一次性进程跑完一条命令」的 CLI 类 agent 与「常驻多轮会话对象」的语音会话之间的根本模型差异，也是改造成本的大头——**这是唯一需要提前做协议预留的部分**。

### 7.4 五种接入模式（A–E）

| 模式 | 代表实现 | 用户体验增量 | 改造成本 | 适用场景 |
|---|---|---|---|---|
| **A. 听写 overlay**（语音输入增强） | Claude Code /voice、Cursor 2.0、Aqua、Wispr Flow、Superwhisper | 只解决输入：手不离键盘、3-5x 输入速度 | 极低：进程外即可，不动 agent | 所有工具的 80 分基线；差异化点在编程词汇/上下文（Aqua 路线） |
| **B. TTS 旁路播报**（只出声） | voice-mcp 的 `speak()`、各类 agent TTS hooks | 结果可听、后台任务完成可通知 | 低：hook 一条旁路 | 长任务结束提醒；与 A 组合可做到「听得进 + 说得出」，但仍是轮流独占、无 §2.4 定义的 turn-taking 技术栈，不构成半双工语音会话 |
| **C. 语音 peer 会话**（语音挂成工具/旁路会话） | voice-mcp 双向工具、voicemode、mcp-voice-hooks | 可对话；hooks 路线可在任务中插话 | 中：打断与并发指令要自己解决；MCP 往返延迟（整段转写→工具调用）限制实时性 | 想要双向体验但不动 agent 内核；本地隐私优先 |
| **D. 实时语音网关 + 文本 agent 大脑** | Pipecat / LiveKit / TEN 接任意 agent；OpenAI Realtime + MCP 工具 | 完整会话：轮次感知、可打断、边跑工具边播进度、语音新指令与运行中任务并发 | **高**：成本不在音频管线，而在 (1) agent 从「一命令一进程」改造成常驻会话服务；(2) 执行循环 tool-call 化 + 流式进度（LiveKit `ctx.update` 模式）；(3) 三层取消语义贯通；(4) WebRTC/WS 基建 | 长任务 agent 的远控/移动场景、「边跑边聊」的监督式交互 |
| **E. 端到端/全双工语音模型替换大脑** | OpenAI Realtime S2S、Gemini Live、Moshi、GLM-4-Voice | 延迟最低、轮次最自然（全双工可同时听说、backchannel） | 高且**能力封顶**：大脑受限于所选语音模型，无法等价替换带工具生态/长上下文/权限体系的强 agent | 问答/对话型助手；或作为 D 的「语音前端」（Realtime 模型 + MCP 工具就是这种折中的官方形态） |

### 7.5 选型建议与落地路线

1. **不要用模式 E 替换强 agent 大脑**，除非产品就是纯对话。Moshi/GLM-4-Voice 证明了体验上限，但工具编排、代码上下文、权限与审计都在文本 agent 这边；τ-Voice 的数据（干净条件保留约 36–60%、噪声/多口音约 31–45%）是定量警示——其任务类型与被测模型清单见原论文，对带工具调用、长上下文的真实编码/运维 agent 的外推性未验证（见附录 B）。
2. **模式 D 是终态，模式 C 是务实起步**：先用 C 验证「用户到底要不要在 agent 跑工具时说话」这个核心假设（代价是接受 MCP 往返延迟），一旦验证，把同一套事件语义（§7.3 事件集 + §3.5 进度/取消原语）迁移到 D 的实时网关上。
3. **打断设计必须一次做对三层**（LiveKit 的教训）：① barge-in 停播报；② 对话历史截断（只保留用户听到的部分）；③ 任务取消与否显式建模（「打断≠取消」，可取消性按工具/阶段声明——读可取消、写保护）。把三层塞进一个布尔开关是最常见的错误。
4. **进度播报走双通道**：结构化进度进上下文让 LLM 自然表述（`ctx.update`），静默期用固定填充语兜底（`with_filler`）；不可打断的关键播报（如权限确认）显式声明 uninterruptible。
5. **轮次与打断的预算优先于模型升级**：级联 + silero VAD + smart-turn 级轮次模型 + 三层打断语义，体验增益大于换更贵的 TTS/LLM。
6. **拥有桌面宿主 + CLI agent 架构的团队**（如 Electron 宿主 + agent runtime）：模式 A+B 可完全在宿主侧实现、零侵入；模式 C 走 MCP/协议旁路；只有模式 D 需要 agent runtime 暴露会话级接口（常驻会话、tool-call 注入、取消、进度事件）——如果语音在路线图上，**今天就该在 runtime 协议里预留这四样**（事件 schema、消息时序与幂等边界尚未成稿，见附录 B 开放问题 1）。
7. **分场景速查**见 §1.3；全中文栈注意 §4.5 许可红线；自研 wire 协议建议以 OpenAI Realtime 事件族为模板（§6.6），并对「播放位置对齐的状态截断」（`truncate(audio_end_ms)` 语义）做一等设计——这是纯文本 agent 协议里不存在、语音会话必须有的一类操作。

---

## 八、参考链接汇总

### 官方文档与标准

- LiveKit Agents：[Pipeline types](https://docs.livekit.io/agents/models/pipelines) / [Turns](https://docs.livekit.io/agents/logic/turns) / [Turn detector](https://docs.livekit.io/agents/logic/turns/turn-detector) / [Agent state](https://docs.livekit.io/frontends/build/agent-state) / [Models](https://docs.livekit.io/agents/models/)
- LiveKit 博客：[Realtime vs Cascade](https://livekit.com/blog/realtime-vs-cascade) / [Async tools for voice agents](https://livekit.com/blog/async-tools-voice-agents)
- Pipecat 文档：[Interruptions](https://docs.pipecat.ai/pipecat/fundamentals/interruptions) / [Speech Input](https://docs.pipecat.ai/pipecat/learn/speech-input) / [Function Calling](https://docs.pipecat.ai/pipecat/learn/function-calling) / [Frames](https://docs.pipecat.ai/api-reference/server/frames/overview) / [SmallWebRTC](https://docs.pipecat.ai/api-reference/server/services/transport/small-webrtc) / [Cloud](https://docs.pipecat.ai/pipecat-cloud/introduction)
- OpenAI：[Voice agents](https://developers.openai.com/api/docs/guides/voice-agents) / [Realtime](https://developers.openai.com/api/docs/guides/realtime) / [Realtime VAD](https://developers.openai.com/api/docs/guides/realtime-vad) / [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations) / [Realtime + MCP](https://developers.openai.com/api/docs/guides/realtime-mcp) / [Agents SDK VoicePipeline](https://openai.github.io/openai-agents-python/voice/pipeline/)
- Azure：[OpenAI Realtime](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/realtime-audio) / [Voice Live](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live) / [Voice Live how-to](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-how-to) / [samples](https://github.com/microsoft-foundry/voicelive-samples)
- Google：[Gemini Live API](https://ai.google.dev/gemini-api/docs/live) / [Live tools](https://ai.google.dev/gemini-api/docs/live-api/tools) / [Gemini Live 支持页](https://support.google.com/gemini/answer/15274899)
- AWS：[Nova Sonic 双向流](https://docs.aws.amazon.com/nova/latest/userguide/speech-bidirection.html) / [Nova Sonic](https://docs.aws.amazon.com/nova/latest/userguide/speech.html) / [Amazon Connect 集成](https://docs.aws.amazon.com/connect/latest/adminguide/nova-sonic-speech-to-speech.html) / [samples](https://github.com/aws-samples/amazon-nova-samples)
- Deepgram：[Endpointing](https://developers.deepgram.com/docs/endpointing) / [Voice Agent](https://developers.deepgram.com/docs/voice-agent) / [Function calling](https://developers.deepgram.com/docs/voice-agents-function-calling) / [Backchannels vs Interruptions](https://deepgram.com/learn/backchannels-vs-interruptions-voice-agents)
- 国内：[豆包端到端实时语音 API](https://www.volcengine.com/docs/DoubaoVoice/End-to-endreal-timespeechlargemodelAPIaccessdocument) / [豆包 Seeduplex 3.0 全双工](https://www.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version) / [阿里百炼 Qwen-Omni-Realtime](https://help.aliyun.com/zh/model-studio/realtime) / [MiniMax API overview](https://platform.minimax.io/docs/api-reference/api-overview) / [MiniMax 实时交互 API 公告](https://www.minimaxi.com/news/%E5%AE%9E%E6%97%B6%E4%BA%A4%E4%BA%92api-%E6%AD%A3%E5%BC%8F%E5%8F%91%E5%B8%83)
- 平台：[Vapi](https://docs.vapi.ai/) / [ElevenLabs tools](https://elevenlabs.io/docs/eleven-agents/customization/tools) / [ElevenLabs overview](https://elevenlabs.io/docs/eleven-agents/overview) / [Retell function calling](https://docs.retellai.com/build/single-multi-prompt/function-calling) / [Retell KB](https://docs.retellai.com/build/knowledge-base) / [Bland Pathways](https://docs.bland.ai/tutorials/pathways) / [Bland tools](https://docs.bland.ai/tutorials/tools/overview)
- 编码 agent：[Claude Code /voice](https://code.claude.com/docs/en/voice-dictation) / [Anthropic Messages API（经 SDK 核验）](https://github.com/anthropics/anthropic-sdk-python) / [MCP 2025-06-18 Tools 规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- 其他：[ITU-T G.114](https://www.itu.int/rec/T-REC-G.114/en) / [Hume EVI](https://dev.hume.ai/voice/docs/speech-to-speech-evi/overview) / [Inworld: Cascaded vs S2S](https://inworld.ai/resources/cascaded-vs-speech-to-speech-voice-architecture) / [GetStream: Speculative Tool Calling](https://getstream.io/blog/speculative-tool-calling-voice/) / [Artificial Analysis S2S](https://artificialanalysis.ai/speech-to-speech) / [AA Streaming STT](https://artificialanalysis.ai/speech-to-text/streaming) / [TEN 官网](https://theten.ai/en) / [TEN 概览（Agora）](https://docs.agora.io/en/ai/ten-agent/framework-overview)

### 论文

对话模型与表示：[SpeechGPT 2305.11000](https://arxiv.org/abs/2305.11000) / [Mini-Omni 2408.16725](https://arxiv.org/abs/2408.16725) / [LLaMA-Omni 2409.06666](https://arxiv.org/abs/2409.06666) / [Moshi 2410.00037](https://arxiv.org/abs/2410.00037) / [GLM-4-Voice 2412.02612](https://arxiv.org/abs/2412.02612) / [SPIRIT-LM 2402.05755](https://arxiv.org/abs/2402.05755) / [Kimi-Audio 2504.18425](https://arxiv.org/abs/2504.18425) / [Qwen2.5-Omni 2503.20215](https://arxiv.org/abs/2503.20215) / [Qwen3-Omni 2509.17765](https://arxiv.org/abs/2509.17765) / [Qwen2-Audio 2407.10759](https://arxiv.org/abs/2407.10759) / [SALMONN 2310.13289](https://arxiv.org/abs/2310.13289) / [Step-Audio 2502.11946](https://arxiv.org/abs/2502.11946) / [Step-Audio 2 2507.16632](https://arxiv.org/pdf/2507.16632) / [Step-Audio 3 Realtime 2609.14005](https://arxiv.org/html/2609.14005v1) / [Baichuan-Audio 2502.17239](https://arxiv.org/abs/2502.17239) / [MiniCPM-o 4.5 2604.27393](https://arxiv.org/abs/2604.27393) / [EnCodec 2210.13438](https://arxiv.org/abs/2210.13438) / [SpeechTokenizer 2308.16692](https://arxiv.org/abs/2308.16692) / [Delayed Streams Modeling 2509.08753](https://arxiv.org/abs/2509.08753)

全双工与交互：[dGSLM 2203.16502](https://arxiv.org/abs/2203.16502) / [Freeze-Omni 2411.00774](https://arxiv.org/abs/2411.00774) / [Voila 2505.02707](https://arxiv.org/abs/2505.02707) / [FireRedChat 2509.06502](https://arxiv.org/html/2509.06502v1) / [Speculative Interaction Agents 2605.13360](https://arxiv.org/abs/2605.13360)

副语言与情感：[emotion2vec 2312.15185](https://arxiv.org/abs/2312.15185) / [SECap 2312.10381](https://arxiv.org/abs/2312.10381) / [SLIMER 2410.01162](https://arxiv.org/abs/2410.01162) / [LLM Post-ASR Speech Emotion Challenge](https://github.com/YuanGongND/llm_speech_emotion_challenge)

评测：[VoiceBench 2410.17196](https://arxiv.org/abs/2410.17196) / [Full-Duplex-Bench 2503.04721](https://arxiv.org/abs/2503.04721) / [v1.5 2507.23159](https://arxiv.org/abs/2507.23159) / [v2 2510.07838](https://arxiv.org/abs/2510.07838) / [v3 2604.04847](https://arxiv.org/abs/2604.04847) / [eot-bench](https://github.com/livekit/eot-bench) / [τ-Voice 2603.13686](https://arxiv.org/abs/2603.13686) / [Cascade Equivalence Hypothesis 2602.17598](https://arxiv.org/abs/2602.17598)

综述：[WavChat 2411.13577](https://arxiv.org/abs/2411.13577) / [Speech LM Survey 2410.03751](https://arxiv.org/abs/2410.03751) / [Speech LLM Understanding Survey 2410.18908](https://arxiv.org/abs/2410.18908) / [Full-Duplex Survey 2606.19453](https://arxiv.org/abs/2606.19453) / [Stivers et al. PNAS 2009](https://www.pnas.org/doi/10.1073/pnas.0903616106)

### 开源仓库

框架与运行时：[pipecat](https://github.com/pipecat-ai/pipecat) / [livekit/agents](https://github.com/livekit/agents) / [ten-framework](https://github.com/ten-framework/ten-framework) / [unmute](https://github.com/kyutai-labs/unmute) / [vocode-core（停更）](https://github.com/vocodedev/vocode-core) / [openai-agents-python](https://github.com/openai/openai-agents-python) / [openai-realtime-agents](https://github.com/openai/openai-realtime-agents)

模型：[moshi](https://github.com/kyutai-labs/moshi) / [GLM-4-Voice（zai-org）](https://github.com/zai-org/GLM-4-Voice) / [mini-omni](https://github.com/gpt-omni/mini-omni) / [Step-Audio2](https://github.com/stepfun-ai/Step-Audio2) / [Kimi-Audio](https://github.com/MoonshotAI/Kimi-Audio) / [Qwen2.5-Omni](https://github.com/QwenLM/Qwen2.5-Omni) / [Qwen3-Omni](https://github.com/QwenLM/Qwen3-Omni) / [Qwen2-Audio](https://github.com/QwenLM/Qwen2-Audio) / [Freeze-Omni](https://github.com/VITA-MLLM/Freeze-Omni) / [Voila](https://github.com/maitrix-org/voila) / [MiniCPM-V](https://github.com/OpenBMB/MiniCPM-V) / [SenseVoice（QwenAudio）](https://github.com/QwenAudio/SenseVoice) / [CosyVoice（QwenAudio）](https://github.com/QwenAudio/CosyVoice) / [delayed-streams-modeling（Kyutai STT）](https://github.com/kyutai-labs/delayed-streams-modeling)

组件：[whisper](https://github.com/openai/whisper) / [faster-whisper](https://github.com/SYSTRAN/faster-whisper) / [FunASR](https://github.com/modelscope/FunASR) / [moonshine](https://github.com/moonshine-ai/moonshine) / [fish-speech](https://github.com/fishaudio/fish-speech) / [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) / [kokoro](https://github.com/hexgrad/kokoro) / [F5-TTS](https://github.com/SWivid/F5-TTS) / [silero-vad](https://github.com/snakers4/silero-vad) / [smart-turn](https://github.com/pipecat-ai/smart-turn) / [stt-benchmark](https://github.com/pipecat-ai/stt-benchmark) / [ten-vad](https://github.com/TEN-framework/ten-vad) / [ten-turn-detection](https://github.com/TEN-framework/ten-turn-detection) / [emotion2vec](https://github.com/ddlBoJack/emotion2vec)

硬件与传输：[xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) / [xiaozhi-esp32-server](https://github.com/xinnan-tech/xiaozhi-esp32-server) / [py-xiaozhi](https://github.com/huangjunsen0406/py-xiaozhi) / [livekit](https://github.com/livekit/livekit) / [aiortc](https://github.com/aiortc/aiortc) / [daily-js](https://github.com/daily-co/daily-js) / [mediasoup](https://github.com/versatica/mediasoup) / [janus-gateway](https://github.com/meetecho/janus-gateway)

编码 agent 语音旁路：[voice-mcp](https://github.com/shreyaskarnik/voice-mcp) / [voicemode](https://github.com/mbailey/voicemode) / [mcp-voice-hooks](https://github.com/johnmatthewtennant/mcp-voice-hooks) / [openinterpreter/01（休眠）](https://github.com/openinterpreter/01) / [cursorless-dev](https://github.com/cursorless-dev) / [Talon 评测](https://handsfreecoding.org/2021/12/12/talon-in-depth-review)

消费产品与基线：[Superwhisper](https://superwhisper.com) / [Aqua Voice](https://aquavoice.com) / [Wispr Flow](https://wisprflow.ai/vibe-coding/warp) / [Cursor 2.0 公告](https://forum.cursor.com/t/cursor-2-0-composer-in-app-browser-voice-more/139132) / [Hey, GitHub!（Verge）](https://www.theverge.com/2022/11/9/23449175/hey-github-voice-copilot-code-programming-system) / [ChatGPT Voice Mode FAQ](https://help.openai.com/en/articles/8400625-voice-mode-faq) / [AVM 误打断社区反馈](https://community.openai.com/t/advanced-voice-mode-constantly-interrupting-me/963973) / [Simon Willison 音频实测](https://simonwillison.net/2024/Oct/18/openai-audio)

---

## 附录 A：核查修正与存疑清单

### A.1 已改正（核查证伪/出处错位，本报告已按修正后表述落稿）

| 原表述 | 问题 | 修正后 |
|---|---|---|
| SECap 机制为「HuBERT + emotion2vec 特征接 LLM」 | 论文 HTML 全文 `emotion2vec` 出现 0 次；原文为 HuBERT-large + Q-Former Bridge-Net + LLaMA，情感监督来自人工标注；两者是同期独立工作 | 按 §5.3 改正，两者分开表述 |
| Voila 机构「MAAI」 | 论文署名为 Maitrix.org / UC San Diego / MBZUAI，全文无 MAAI | 改为 Maitrix |
| Qwen3-Omni「36 项基准与同规模单模态模型相当」 | 摘要原句为 36 项基准中 32 项开源 SOTA、22 项整体 SOTA | 按 §4.2/§5.1 改正 |
| GLM-4-Voice「商用需登记（README 原文）」 | README 只说遵循模型协议；登记要求在 HF 模型协议中；且仓库已由 THUDM 更名 zai-org | 出处改为 HF 模型协议，仓库链接改 zai-org |
| Step-Audio 3 Realtime「以 API 形态提供」 | 论文页对提供方式保持沉默，无证据 | 删除该表述，仅保留「未见开放权重」 |
| Pipecat 打断帧 `StartInterruptionFrame`、聚合器 `create_context_aggregator()` | 当前 main 的 frames.py 无 StartInterruption（打断帧现名 `InterruptionFrame`，SystemFrame）；聚合器现 API 为 `LLMContextAggregatorPair` | 按 §3.3/§4.1 改正 |
| Superwhisper「SOC 2 / HIPAA」 | 所引页面仅有 SOC 2 Type II | 删 HIPAA |
| Gemini Live 工具面「（部分模型）代码执行」 | 官方工具表对列出模型均为 Not supported | 删除；异步 FC 限定 Gemini 2.5 Flash Live |
| OpenAI 官方指南「两条架构」 | 该页现列三条：GPT-Live（全双工）/ Realtime API / Chained pipeline | 按 §2.2 三路线表述 |
| Cartesia「宣称首包 <90ms」出处为 docs 页 | docs 页无任何数字指标；<90ms 在官网营销页 | 出处改为营销页；第三方实测 166–440ms 标存疑 |
| FunAudioLLM/SenseVoice 仓库路径 | 已迁移至 QwenAudio org | 链接改 QwenAudio |
| 事件协议「几乎逐名一致」 | 阿里无客户端 `session.create`；delta 事件命名有差异 | 弱化为「事件族风格一致、个别命名有差异」（§6.6） |

### A.2 核验分级与存疑清单

**代理核验（原页不可达，经间接通道核验；证据等级低于一手抓取，引用时请注明通道）**：

- **Anthropic Messages 无 audio block**：原页区域屏蔽，经官方 [anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) 类型导出核验（`grep -ic audio` = 0，见 §7.2）。
- **OpenAI Realtime「Tools and MCP」专页**：多次抓取失败；MCP 支持以 Azure 官方文档（一手核验）为据。
- **`output_modalities` 拼法**：developers.openai.com 的 Realtime conversations 指南抓取返回 403，该拼法未获一手核验；正文以 Azure 文档逐字核验的 `modalities` 为准（§2.2/§6.1）。
- **semantic_vad 的 `eagerness` 参数**：经 OpenAI 官方 VAD 指南抓取成功确认（一手核验）；但同域名其他页（Tools and MCP、conversations 指南）403——同域抓取稳定性不均，遇 403 请以 Azure 镜像为底。
- **MiniCPM-o 2.6 Notion 技术报告正文**：JS 渲染页未能直接读取（URL 经官方仓库索引证实）。
- **Kimi-Audio 权重 MIT、CosyVoice2-0.5B 权重 Apache-2.0**：HF 卡搜索快照级（调研环境不可达 HF），商用前请到 HF 模型卡复核。

**存疑（未获任何核验通道确认，引用前请自行复核）**：

- **Artificial Analysis 两个数字**：GPT-Realtime-1.5 TTFA 0.81s（页面上 0.81s 实为 SpaceXAI Grok Voice 3.0）、GPT-Realtime 系 ~$11/hr（本次抓取未见该数字）。
- **Cartesia 第三方实测 166–440ms**：原始出处未核验。
- **VAmoS 基准「填充语导致挂断」**、Deepgram Flux smart-endpointing 延迟论断、各第三方延迟中位数（Hamming.ai 等）：来自检索摘要，未逐篇核实。
- **Coval/Gradium「级联端到端 1.5–3s」**（§2.1）：原文未抓取，仅作量级参考。
- **LiveKit「agent 响应 <1s」**（§1.2/§3.4）：本次未能在官方文档定位到具体页面；数字符合行业通行口径，引用前请自行定位原始出处。
- **Retell「Add backchannel」设置页 URL**：确认设置存在（JS SPA 未能抓取具体页）。
- **ChatGPT Voice Mode FAQ 细节**（AVM 驱动模型、可感知语气等）：页面抓取受限（403），以原页为准。
- **Cursor 2.0 快捷键 Cmd+Shift+Space**：仅见于用户回帖，官方公告未提及。
- **Aqua Avalon 基准数字（97.4% vs 65.1%）**：厂商自述，未见独立复现。
- **huggingface.co 全程不可达**：所有 HF 相关许可均为搜索快照级；Step-Audio 3 Realtime 未观察到开源仓库。

---

## 附录 B：开放问题（本次调研未回答，留待下一轮）

以下问题在审读中被提出，本报告现有材料不足以给出可落地的答案，如实挂起：

1. **模式 D「协议预留」的接口草案**：§7.5 第 6 条只有四样能力的名词（常驻会话、tool-call 注入、取消、进度事件），尚无事件 schema、消息时序与幂等边界——§7.3 的事件集是名词清单而非契约，可直接开工的接口草案待做。
2. **模式 C（MCP 旁路）下打断的最小可行设计**：§7.4 只说「打断与并发指令要自己解决」；「先用 C 验证、再迁 D」时 C 里哪些部分可保留，未分析。
3. **级联各段的延迟预算分配表**：150ms 网络 / 200ms 话轮间隙 / <1s 响应三个锚点如何折算成 STT partial、LLM 首字、TTS 首包的分段预算，§3.4 只给总锚点未给分配。
4. **τ-Voice 31–51% 的外推边界**：测量任务类型与被测模型清单未核，对带工具调用、长上下文的真实编码/运维 agent 的适用范围未验证（§7.5 第 1 条已加此限定）。
5. **中文轮次检测的实证缺口**：smart-turn 宣称 23 语种、LiveKit turn detector 支持 14 语种（含中文），但报告未获得任何中文轮次/误打断实测数据；全中文栈（§1.3）该选哪个轮次模型缺乏证据。
6. **打断与写副作用的事务/补偿语义**：「读可取消、写阶段保护」（§3.5/§7.5）未覆盖「写操作已执行 + 用户打断」的补偿设计——这对编码 agent 是常态场景。
7. **Hume EVI 日落后的开源副语言路线**：emotion2vec/SLIMER 旁路（§5.3）有无可用工程封装、旁路抽取的额外延迟代价，未调研。
8. **成本-质量联合决策**：最便宜端到端 $0.0331/hr 与 Inworld 口径级联 ≈$1.35/hr 差约 40 倍（§6.5 vs §2.1），两者质量差距无量化数据；「级联更便宜」在哪个模型档次之上成立，无边界条件。
