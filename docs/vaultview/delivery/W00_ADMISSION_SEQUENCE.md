# W00 Admission 与重放时序（W00_ADMISSION_SEQUENCE）

**工作单：** W00 执行项 2　**日期：** 2026-10-10　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`（分支 `feat/vaultview-impl`，只读审计 + 临时目录 Spike，仓库零改动）

> 审计人：W00 审计-admission 时序；撰写人：W00 证据撰写员。
> **路径约定：** `path:line` 相对实施工作树根 `D:/workspace/projects/Drora-vaultview-handoff/`。
> **抽查声明：** 撰写员已复核本时序的全部承重行号并全部命中：`command-inbox.ts:32-33/:117/:131/:141/:162-164/:176-203/:340/:352/:366/:394`、`runtime-command-queue.ts:187/:196/:205`、`turn.ts:363-370/:372`、`v4-bridge.ts:599-672/:645-657/:1080-1083/:1575-1602`、`queue.ts:165-291`、`v4-gateway.ts:648-674/:2376/:2398/:2481/:2485`、`prompt-admission.ts:20-126`、`turn-guide-drain.ts:13-66`、`session-flow.ts:290-296`、`prompt-turn.ts:108/:150/:163`、`session.port.ts:281-316`；未抽查者（SessionPane/commandFactory/transport/droraAgentService/server.ts/steering.ts 等）引自审计员素材。

## 0. 范围与结论

完整追通 VaultView → Composer/SessionPane → Host Service → CLI Runtime/CommandInbox → Core admission 的发送/排队/admission 时序。真正把输入提交给模型的唯一收口是 Core runtime 命令队列 drain 中的 `executeTurnCommand`（`core/src/runtime/methods/runtime-command-queue.ts:205`）；其前最后一道可阻断闸门是 UserPromptSubmit hook（`turn.ts:363-370`）。

**S02 判定：有条件 GO**——执行前重新验证 Source/Receipt 的扩展点存在且可执行（CommandInboxHost.guard 类型预留 + spike 实证、sendQueuedNow 单漏斗、UserPromptSubmit hook），但当前缺三样：Receipt 引用的协议载体字段、promotion/guide 消费点的验证调用、auto-drain 旁路的覆盖（§5-§6）。

## 1. 权威时序图（文本）

```
[UI Renderer]            [Host Service]              [CLI Server/Runtime]                [Core Runtime]                 [模型]
     |                        |                              |                                |                        |
 handleSendText               |                              |                                |                        |
 SessionPane.tsx:2977         |                              |                                |                        |
     |--dispatchCommand-------|                              |                                |                        |
 SessionPane.tsx:1409         |                              |                                |                        |
  (createCommandEnvelope,     |                              |                                |                        |
   commandId=uuidv7)          |                              |                                |                        |
     |--sendCommand---------->|                              |                                |                        |
     |   agentConversationTransport.ts:350-366               |                                |                        |
     |   sendConversationCommandV4                           |                                |                        |
     |   droraAgentService.ts:5104/:5162                     |                                |                        |
     |----------------------->|--client.request(V4 command)->|                                |                        |
     |                        |                              |-server.ts:565-566 handleCommand|                        |
     |                        |                              |-v4-gateway.ts:2398 inbox.handle|                        |
     |                        |                              |  ┌─ ADMISSION（command-inbox.ts:117）                   |
     |                        |                              |  │ key gate(:131)→dedup(:134-153)→session FIFO gate(:141)
     |                        |                              |  │ decide(:155): revision(:352)/logEpoch(:340)          |
     |                        |                              |  │   /rowTarget(:366)/guard(:394)                       |
     |                        |                              |  │ admissionSeq(:162-164)→pin inFlight(:170)            |
     |                        |                              |  └─ admitCommandInput 账本（gateway:2481 → v4-bridge.ts:716）
     |                        |                              |<-ACK accepted（session gate 持有到 settle :176-203）      |
     |<--ACK------------------|------------------------------|                                |                        |
     |                        |                              |-executeCommand(gateway:2485)   |                        |
     |                        |                              |  → sendText（session-flow.ts:184-302，只做协议/held/model/附件校验）
     |                        |                              |  → startPromptTurn（prompt-turn.ts:60-202）              |
     |                        |                              |     → app.sendInput（:108，delivery:"start_turn"）        |
     |                        |                              |     preparePromptBoundary（input-facade.ts:214；仅 shell+resume 一次性准备）
     |                        |                              |     → runtime.admitPrompt（prompt-admission.ts:20-126）   |
     |                        |                              |        ├─ busy→ 可 steer 则 guide（:52-67）               |
     |                        |                              |        │   否则 enqueueDeferredInput（:71-83）             |
     |                        |                              |        │   （TurnSteerQueued 事件=队列事实，steering.ts:249-273）
     |                        |                              |        │   ACK: delivery="queue"（session-flow.ts:290-296）|
     |                        |                              |        └─ idle→ reserveTurnStart(:99)+入FIFO(:102)        |
     |                        |                              |           ACK: delivery=startNow                         |
     |                        |                              |                         drainRuntimeCommandQueue          |
     |                        |                              |                         （runtime-command-queue.ts:37）    |
     |                        |                              |                         runRuntimeCommand:187             |
     |                        |                              |                         beginForegroundExecution:196      |
     |                        |                              |                         mode="prompt"→                    |
     |                        |                              |                         executeTurnCommand:205  ★真执行点 |
     |                        |                              |                         → executeTurn                     |
     |                        |                              |                         → UserPromptSubmit hook           |
     |                        |                              |                           （turn.ts:363，可阻断:372-419）  |
     |                        |                              |------------------------------------------------------->|
```

**重放路径（busy/queued 输入何时真正执行）：**

```
① 手动提升：UI sendQueuedNow 命令 → inbox admission → queue.ts:165 handler
   （读完整 QueueItem:180 → promotion lease:184-196 → reserve:198 → preempt:216 →
     markPromoting:223 → startPromptTurn(requireIdle):247-256 → remove:264）
② auto-drain：turn 结束 afterLegacyStateMutation（v4-bridge.ts:1080-1083）
   → autoDrainV4QueueIfReady（v4-bridge.ts:599-672）→ shouldAutoDrainV4QueueHead（queue-auto-drain.ts:7-19）
   → 合成 envelope（commandId=auto-…、clientId="v4-auto-drain"，:645-657）直调 nativeExecutor.execute
   ★绕过 inbox.handle/guard/dedup 表/admitCommandInput 账本，但汇入①的同一 sendQueuedNow handler
③ guide 行内：drainInlineGuideForNextRequest（turn-guide-drain.ts:13-66）在 tool-batch 边界
   （turn-tools.ts:470、turn-stop.ts:195）splice 出队（steering.ts:1172）直接注入下一模型请求
   ★不新建 turn、不重跑任何 hook、无任何复验
```

## 2. 关键结论

1. 「真正提交给模型」= `executeTurnCommand`（`runtime-command-queue.ts:205`）；UI/Host 的 ACK 只证明 admission，不证明执行。
2. admission 有两层：RPC 层 CommandInbox（幂等 + CAS + guard，spike 实证 FIFO/duplicate/guard 可拦截）与 Core 层 `admitPrompt`（busy → steer/queue/idle 三分）。
3. 队列事实源唯一：`TurnSteerQueued` 会话事件 → 事件投影 `pendingSteerInputs` → v4 投影 `queue.items`（`getQueueHead` 读 publisher 快照，`v4-gateway.ts:2598-2612`）；`queueItemId ≡ core pendingInputId`。
4. 既有 stale 校验全是投影一致性（revision/logEpoch/rowTarget），与外部世界（文件内容版本、Vault 身份、授权）**完全无关**——排队期间文件被改/撤权，现有闸门不会拒绝提升（对照 W03.3：`docs/vaultview-agent-handoff/03_WORK_ORDERS/W03_EVIDENCE_AND_REAL_AGENT.md:7`）。

## 3. 两层 admission 细节

**RPC 层 CommandInbox**（`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/command-inbox.ts`）：per-session FIFO gate 持有到 settle 才释放（`:141`、`:176-203`），admission 顺序由 `admissionSeq` 权威编号（`:162-164`）；dedup 覆盖 inFlight / liveInputs / settled LRU + 4 个持久化 lookup（`:284-306`）；`decide()` 在 admission 时做 baseRevision（`:352`）/ baseLogEpoch（`:340`）/ rowTarget（`:366`）/ guard（`:394`）校验。`guard` 键契约注释「业务 guard…缺省一律放行」（`:32-33`）。

**Core 层 admitPrompt**（`core/src/runtime/methods/prompt-admission.ts:20-126`）：按 `hasActiveOrQueuedTurnWork`（busy 判据 `runtime-command-queue.ts:100-109`）三分——可 steer 则入 `activeTurn.pendingInputs`（guide/steer，`:52-67`）；否则 `enqueueDeferredInput`（future queue，`:71-83`）；空闲则 `reserveTurnStart`（`:99`）+ `enqueueCancellableRuntimeCommand` 入 runtime FIFO（`:102`）并立即返回 started receipt（`:125`）。

**执行链**：gateway admission 通过后先经 `admitCommandInput` 写 durable `ConversationInputIntent` 账本（`v4-gateway.ts:2481` → `v4-bridge.ts:1579-1602`、`admitInputCommand → sessionStore.saveSessionInput`，`:716-790`），再 `host.executeCommand`（`v4-gateway.ts:2485`）→ `nativeExecutor.execute` 直调 NATIVE_HANDLERS（`v4-bridge.ts:1575-1578`；`drora-protocol-v4/commands/executor.ts:39-60`、`handlers/index.ts:15-26`）。`sendText` handler 只做协议/held/model/附件校验（`session-flow.ts:181-302`），start/queue 裁决全部交给 Core admission；`startPromptTurn` 是所有 prompt 启动的引导面（`prompt-turn.ts:60-202`，`ensureModelReady` `:85`、`sendInput` `:108`、rejected `:150`、queued `:163`、started 挂后台 completion `:173`）。

## 4. 执行前复验 Source/Receipt 的扩展点盘点

| 扩展点 | 触发时机 | 覆盖 | 缺口 |
| --- | --- | --- | --- |
| `CommandInboxHost.guard`（`command-inbox.ts:32`，**类型已预留未接线**：`v4-gateway.ts:648-674` 构造处无 guard 键） | RPC 命令 admission | 所有经 gateway 的命令（spike 实证可拦截） | auto-drain 直调 executor 绕过；且排队输入的原始 admission 早已通过，复验必须发生在**提升时** |
| `admitCommandInput`/`admitInputCommand` 账本（`v4-bridge.ts:1579`/`:716`） | RPC 输入命令 admission 时写 `dispatch.state=admitted` | sendText/sendGoalCommand/compact/editUserQuery/retryTurn（`v4-bridge.ts:400-408`） | 仅 RPC 路径；不随提升重放 |
| `sendQueuedNow` handler（`queue.ts:165`） | 每次队列提升（**手动 + auto-drain 都汇于此**） | ★队列通道唯一漏斗，已读完整 QueueItem（`:180`） | 今天只验 reservation/lease/idle，无 Receipt 复验 |
| UserPromptSubmit hook（`turn.ts:363`，`preventContinuation` 可阻断 `:372-419`） | 每条 started turn 调模型前 | queue 提升轮也会跑 | guide 注入与 subagent/notification turn 按标志跳过（`runtime-command-queue.ts:277/:364` 传 `skipUserPromptSubmitHooks:true`）；hook 属 workspace 信任体系，非结构化 Receipt 校验 |
| `prepareUserExecutionBoundary`（`app/create-app.ts:514-521`；调用点 `app/input-facade.ts:57-59/:214`） | 每次发送闸前 | 全部路径 | 只做 shell 环境初始化 + resume 一次性准备（`resumePrepared` 短路），**非逐输入闸门**，不能承载 Receipt 复验 |
| `drainPendingInput`（`steering.ts:1140-1214`） | guide 消费 | guide 通道唯一收口 | 当前无任何复验/hook（`turn-guide-drain.ts:13-66`） |

## 5. 缺口清单（S02 判定依据）

1. **协议无 Receipt 载体**：`TurnInputIntentMetadata`（`contracts/src/interfaces/session.port.ts:281-316`）与 sendText payload 只有 text/attachmentRefs/sharedContextRefs/modelSelection 等字段，无 sourceEpoch/fileSha/receipt 引用；VaultView 现状 `createConversationSelectionReference`（`packages/ui/src/v4/VaultView.tsx:654-664`）传的是 `{text,path}`，W03.4 明确这不是 Receipt（`W03_…MD:8`）。
2. **auto-drain 合成 envelope 绕过 inbox**（clientId=`v4-auto-drain`，`v4-bridge.ts:647-653`）：仅做 inbox-level guard 的方案结构性不足；缓解事实是 auto-drain 与手动提升汇入同一 `sendQueuedNow` handler（`queue.ts:165`），故在漏斗处复验可同时覆盖两条路径。
3. **guide 通道零闸门**：`drainInlineGuideForNextRequest`（`turn-guide-drain.ts:13-66`）无 hook 无复验。
4. **全链无任何「执行时对外部世界复验」调用点**：W03.3 场景（排队期间改文件/撤权/切库后旧 evidence 被当 current 执行）当前必然发生。

## 6. S02 初判与最小接线建议（最终判定归工作单 owner）

**有条件 GO**：扩展边界存在且改动面有界，不需要修改队列语义（符合 W03:13「禁止修改 Runtime 队列语义来掩盖问题」）。最小接线：

- (a) 在 shared contracts 增加 Receipt 引用字段（单一出处常量），随 sendText payload / intent 与 QueueItem 持久化；
- (b) 在 `sendQueuedNow`（`queue.ts:165`，覆盖手动 + auto-drain）与空闲直发闸前（`admitCommandInput` 或 `startPromptTurn` 闸前）调用 VaultView 服务复验 授权 + fileSha + sourceEpoch，失败按 guard 拒绝并落账本终态；
- (c) guide 通道要么在 `drainPendingInput`（`steering.ts:1140`）加等价复验 port，要么规定 VaultView 输入 routedDelivery 禁用 guide。

**复验失败语义**：拒绝该项提升（queue 保留/取消），**不得静默降级为 current**。若不复验，排队期间改文件/撤权后旧 evidence 会在执行时被当作 current，违反 W03.3，则 VaultView 只能保留只读检索分支。

## 7. 已运行验证

- `node --import tsx --test C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/admission-seq-spike.test.ts`（在 `D:/workspace/projects/Drora-vaultview-handoff` 下执行）→ **exit 0，tests 3 / pass 3 / fail 0**：同 session 第二条命令在第一条 settle 前不被 admission（FIFO 串行）；guard 钩子提供时在 admission 时裁决 reject；settle 后同 commandId 重试返回 duplicate 不再执行。测试文件仅写在 Temp，仓库只读。
- 其余为只读源码审计（读取即证据）；本专项无代码改动。

## 8. 未执行项

- 完整 `pnpm typecheck` / 全量 `node --test`（非本审计分工，由脚本统一跑；见 `W00_EVIDENCE_REPORT.md` §2）。
- W00.4 双 Host DB spike、W00.5 Hook Patch 审查、工具写盘矩阵（分别见 `W00_DB_HOST_SPIKE.md`、`W00_EVIDENCE_REPORT.md` §5、`W00_TOOL_WRITE_MATRIX.md`）。
- S03 判定所需的各工具写盘路径与 PermissionRequest matcher 覆盖面审计（本审计仅定位 admission 侧钩子）。
