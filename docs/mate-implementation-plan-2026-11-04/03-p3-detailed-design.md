# 03 · P3 详设（Source 注册表 / 飞书 / 手机 / GitHub / 直通 / 桌宠）

- 对应 master plan §4。P1 的 gate/ledger/台账零改动消费新 Source——新增 Trigger 的 `source_kind` 取值扩展即可。

## 1. Source 注册表（`assistant-tickets/sources/`）

```ts
interface MateSource {
  kind: "feishu" | "phone" | "github";
  start(emit: (t: SourceEvent) => void, config: MateSourceConfig): Promise<void>;
  stop(): Promise<void>;
}
// SourceEvent = { identity, workspaceIdentity?, remoteSessionId?, text, mention: boolean, atMs, channelRef }
// 注册表按 config.enabled 惰性启停；emit 后统一进 admissionGate——strength 判定从 P1 的
// simulated 升级为真实规则：mention && allowlist 包含 identity → explicit；否则 inferred。
```

## 2. 飞书 Source

- 接线：`createBotsService` 增可选注入 `assistantForwarder?: {onChannelMessage(evt)}`（`node.ts:3040` 装配处传入闭包→`assistantTicketsService.ingestSourceEvent`）；channelRuntime 既有事件流+`channelMentionResolver` 判 mention——**bots 服务零内部逻辑改动，仅加回调出口**。
  **落地注记（2026-11-05）**：装配处实际为 node.ts `createBotsService` 注册链（行号自 3040 漂移，终审时实测 3118——P4 批次装配段继续后移所致）；回调出口落在 `handleProviderCallback` 入站去重成功点（botsService.ts markInboundDelivery 后），evt 携带 Provider 核验的 `actor.mentionedBot`（mention 事实来自 Provider 而非正文解析）；命令/卡片交互/补答类入站由 feishu Source 侧过滤（commandText/groupCardAction/elicitationResponse），bots 零逻辑改动兑现。
- 回复路径（P3 最小）：工单终态经 bots 的 `channelReply` 回原会话一句话+工单卡片链接；群聊只回被 @ 的线程（沿用 bots 既有线程归属）。
  **落地注记（2026-11-05，偏差）**：实证 `replyToChannel`→`replyToBotChannel`（bots/channelReply.ts:27-106）要求「恰好一个 bots 任务绑定 + 原生输入锚点」——Mate 工单无 bots 任务归属，直接复用恒抛 binding 错误。等价意图=Source 回复端口 `AssistantSourceReplyPort` 定型（注册表终态通知器：快照差分检测 done/failed 首次进入→端口一句话+工单 id），飞书端口真实接线随凭据/真机验收批（无凭据不伪造连通）。
- 名单：飞书 user id ↔ workspaceIdentity 映射进 allowlist 条目（kv JSON）。
- 验收前置：用户侧配好飞书智能体应用凭证（forum 流程已有文档）。

## 3. 手机 Source

- **前置探查（开工首任务）**：window host attachment 事件面——手机消息进入 Host 的确切事件/通道（`windowHostControllerService`/attachment 订阅面），产出一份锚点清单回填本节。
  **探查回填（2026-11-05，feat/mate-p3 开工实读）**：
  - 手机（web-remote-replayable）经 Main `packages/desktop/src/main/webRemoteControlSharedHostAttachments.ts:42-206` 附着窗口 Host——`HostMessageTypes.AttachServicePort` 携带 `clientMode: "web-remote-replayable"`（:98/:140）。
  - Host 侧 `packages/desktop/src/host/index.ts:2740-2915` 按 attachment 的 clientMode 建 service connection（`connectionContext = { connectionId: "host-rpc-*", clientMode }`，:2774/:2834/:2915）。
  - 手机用户输入不经过任何可订阅的「入站消息总线」——它经 attachment 端口**直接调用窗口 Host 的服务 channel**（如 `IDroraAgentService.sendConversationCommandV4`，可信连接上下文经 `withTrustedConnection` carrier 注入且覆盖 UI 可伪造字段，`packages/services/src/drora-agent/droraAgentConnectionScope.ts:95-114/:744-760`）。
  - **结论（与详设原文「attachment 消息中 @大副→SourceEvent」的偏差与等价意图）**：详设假想的「attachment 消息事件面」在现实代码中不存在可拦截的 host 侧总线；等价意图=手机大副入口经既有 `IAssistantTicketService` channel（replayable attachment 同样透传窗口 Host 服务集合）进入，新增 channel 可见方法 `submitSourceEntry`（仅开放 sourceKind="phone"，identity=host 侧本机用户，renderer 不可自报外部身份），remoteSessionId 贯穿落 trigger.remote_session_id。手机端不建 runtime 红线满足：触发/决策/汇报全部经既有快照推送通道（onDidChange + assistantActivity 透传）。
- 形态：attachment 消息中 @大副/私聊助理入口→SourceEvent（identity=手机账号绑定 identity；remoteSessionId 贯穿）；手机端不建 runtime（replayable 红线）——推送=决策卡精简版（controller 通知面既有推送通道复用）+footerSlot 摘要（assistantActivity 透传，02 号 §6）。
- 手机 UI 形态：单列+drawer；`回放 · 未建 runtime` 徽标常驻任务中心头部。
  **落地注记（2026-11-05，P3 收尾审查）**：本句 UI 形态 P3 未实现（任务中心头部徽标/
  单列+drawer 改版无落码），与手机 UI 触发入口接线、Source 开关/身份映射配置写入口
  一并登记为 spec §14 P3 遗留，去向=后续 Source 配置 UI/手机入口批（排期未定）；
  手机当前对 Mate 仅有既有快照推送/任务行 activity 透传（无触发大副的 UI 入口，
  channel 口 `submitSourceEntry` 备而未接）。

## 4. GitHub Source（`sources/github.ts`）

- 轮询：单仓库起步——`GET /repos/{o}/{r}/issues/comments` + `GET /issues`（state=all 增量窗）+ 开放工单绑定 PR 的 CI 结论；ETag 304 省额（每 60s 一轮，kv 记游标）。
  **落地注记（2026-11-05，裁剪）**：P3 host 批实现 comments 轮询（触发面：ETag If-None-Match 304 省额 + comments id 单调游标双防重；点名=整词 @mentionName 且评论者经 login↔identity 映射进 gate）。`/issues` 增量窗与 CI 结论暂缓：详设未定义其触发规则（点名单指评论正文），CI 结论的消费方是 P4 watchdog——不预设产品规则、不实现无消费方的轮询面；真机验收批按需回补。
- 凭证：PAT 经 credential service（不落 kv、不进日志）；点名=评论正文整词 @大副 且评论者 ∈ allowlist（GitHub login ↔ identity 映射）。
  **落地注记（2026-11-05）**：PAT credential 键 `ASSISTANT_CREDENTIAL_KEYS.githubPat` 在 contracts/assistant.ts 单出处；PAT 缺失→该轮跳过并 warn（诚实不连通，不伪造）。
- 回复：工单终态→PR/issue 评论（Co-authored-by 大副署名，复用 git 服务凭证链或独立 PAT scope）。**P3 host 批按端口实现（POST issues/{n}/comments 适配层，fetch 注入可测）**；真实 PAT 连通遗留。

## 5. Thread 直通

- 同 ticket follow-up（SourceEvent 携带 channelRef 命中活动工单的 channel 绑定）→ 跳过 gate 直投 `incarnation_current` 会话（v4 sendText 同通道）——延迟路径与 Router 路径分离（对齐 spec §8 Tier1）。
- 绑定：ticket 增 `channel_ref` 索引（feishu thread / issue number / phone session）；直通投递在 brief 上不追加（原文即输入）。

## 6. 桌宠接缝（desktop，台账 16 范围）

| 件                 | 落点                                                                       | 说明                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 菜单项「打开大副」 | `desktopPetMenu.ts` 动作表加一项                                           | 走 Main→主窗口导航端口（02 号 §7 的 /mate 直达）                                                                                                                 |
| 单击→tray 速览     | 复用 `desktopPetInteractionLayout.ts:23-24` 330×400 几何 + tray 窗既有基建 | 内容=待决策卡精简（可 Y/N）+进行中列表+最新汇报一行；数据=Main 经 IPC 转发 TicketService 快照投影（**Main 只转发**）；tray 内点卡→主窗口直达对应工单（导航端口） |
| badge              | 宠物窗渲染层                                                               | 待决策数（0 无显示）；数据同上转发                                                                                                                               |
| 气泡               | 宠物窗渲染层                                                               | 新汇报一句话，点击直达汇报卡；**计入每日打扰配额**（P4 配额中心同一计数）                                                                                        |
| IPC 字面量         | shared 常量区新增 `MATE_PET_COMMANDS`（照 PlatformChannels 形态）          | 不裸写                                                                                                                                                           |

宠物本体（动画/manifest/Codex 兼容）零改动；pet/tray 不建第二 Host。
  **落地注记（2026-11-05，接缝批次开工定型）**：数据通道照 DesktopPetPublish 同构——
  主窗口 renderer 把 TicketService 快照投影为有界 `MatePetProjection`（shared
  assistantPet.ts schema；待决策 ≤5/进行中 ≤5/最新汇报一条），Renderer→Main 走
  `MATE_PET_COMMANDS.publish`（contracts/assistant.ts 单出处，照 PlatformChannels 形态），
  Main 校验来源窗口（isMainWindow+safeParse）后经 `render` 转发给宠物窗/tray 窗；
  badge=待决策数（>0 时 destructive 级优先显示，=0 回落既有活动数语义——任务活动
  计数不回退）；气泡=最新汇报按 ticketId+updatedAtMs 判新，点击直达对应工单详情
  （汇报全文在详情汇报页签），**每日打扰配额计数归 P4 配额中心**——P3 不建第二计数器
  （避免重复状态），气泡只按事件驱动显示。
- 导航端口（本节三件共用的 Main→Renderer 通道）：`MATE_PET_COMMANDS.rendererEvent`
  三事件 open-mate / open-ticket / decide——菜单「打开大副」、tray 点卡直达、气泡点击
  共用；renderer 侧执行既有 handleOpenMateSidePane + mateStore.selectTicket + service
  动作（tray 放行=decide approve，与面板放行同参同服务——收尾注记 2026-11-05：待决策
  投影行携带 Router 建议档 `suggestedTier` 供 decide 预填与速览展示，yolo 建议不透传、
  建议缺席=默认 build，与面板 approveTier 预填同规则）。02 号 §7
  「CLI /mate 命令触发即开面板」依赖的 renderer 导航通道即本端口；CLI 命令执行体在
  host 进程，host→Main 的导航回调通道 03 未定义，本批不发明——/mate 文档片段保持
  P2 形态（提示词引导+人工打开面板），直连属后续批次。
- 装配落点：Main 侧桥=desktop/src/main 新文件 matePetBridge.ts（校验/路由纯核 +
  ipcMain 包装），挂接点=drora-extensions/desktopPet.ts 的宠物扩展装配（官方 Main
  index.ts 零改动语义不变）；托盘速览 DOM=desktopPetOverlayContent tray 模板扩展 +
  desktopPetTray.ts 消费 render 帧，命令经 `MATE_PET_COMMANDS.command` 回 Main。

## 7. P3 验收

1. 飞书群 @大副（名单内）→决策卡→放行→执行→channelReply 回线程；未指名→would-accept。
2. GitHub issue 评论 @大副→同上；ETag 命中不重复触发（游标单测）。
3. 手机私聊助理→决策卡推送→放行；手机全程无 runtime 建立断言。
4. follow-up 直通：同 thread 追加消息→不产生新 trigger、Router 无日志、目标会话收到输入。
5. 桌宠：badge 数=任务中心待决策数；单击出 tray；tray 放行与主窗口状态一致。
  **落地注记（2026-11-05，接缝批次验收分工）**：场景 1-4 的服务侧链路已由 host 批
  单测锁定（assistantSourceIngest/assistantSourceRegistry.test.ts：飞书点名→决策卡、
  未指名→would-accept、GitHub ETag+游标、手机 submitSourceEntry+无 runtime、
  直通不建新票且 decisions 数不变+目标会话收到 attachTexts、终态回复端口一次）。
  场景 5 与 UI 呈现面（Source 徽标/直通通道站）由接缝批交付：桌面侧桥路由纯核 +
  tray DOM 单测（jsdom/node:test）、MatePetProjection 投影单测（ui fork-isolated）、
  浏览器验收（mate fixture 扩展 + mjs：投影发布/导航直达/decide 传参/Source 徽标/
  通道站/双语），真机桌宠点击链路（Electron 窗口坐标交互）随总闸联调验收。
