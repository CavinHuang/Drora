# 移动端远程控制（手机扫码连接）Spec

用户需求：对齐原版 3.14.3 的"移动端远程控制"——桌面端生成二维码，手机扫码后在
浏览器里查看会话、发送输入、处理权限请求。

原版实现依赖 z.ai 云端 relay（`webRemoteControl.failure.relayUnavailable` 等失败面）
与托管手机 Web 应用，均未随开源树发布（上游 zai-org/ZCode 亦无）。Drora 需自建，
路线已裁定：**LAN 直连优先**（无需任何服务器；协议层预留中继抽象，将来可叠加云中继）。

## 架构

```
手机浏览器                    桌面 Main 进程                       窗口 Host (UtilityProcess)
┌──────────┐   WS(LAN)   ┌──────────────────────┐  AttachServicePort  ┌──────────────────┐
│ phone页   │ ◄─────────► │ desktopMobilePairing │ ──────────────────► │ scoped services  │
│ (静态单页) │  JSON 帧    │ Server               │  scope=local        │ (DroraTask/      │
└──────────┘              │  + rpc ChannelClient  │  clientMode=        │  DroraSession)   │
                          └──────────────────────┘  web-remote-replayable └──────────────────┘
```

- 复用 Host 既有的 `AttachServicePort`（scope=local）附着机制——host 侧注释已预留
  "刷新/手机 attachment 复用同一 Host"；服务面 = `IDroraTaskService` / `IDroraSessionService`。
- 发送输入走 `sendPrompt(clientMode: "web-remote-replayable", clientLabel: "mobile-web")`，
  经既有 CommandInbox 串行 admission；权限回复走 `respondPermission`；停止走 `stopGeneration`。
- 任务列表 `listTasks`；会话时间线 v1 拉取式 `readSessionMessages`（实时流 M2 经 agentService 帧通道）。

## 安全模型

1. 服务**默认关闭**；用户在"移动端远程控制"弹层显式开启才监听（0.0.0.0 随机端口）。
2. 配对令牌：128-bit 随机，一次性、5 分钟 TTL、仅出现在二维码 URL 路径
   `http://<lan-ip>:<port>/p/<pairToken>`；配对成功即作废，换发 256-bit 会话令牌。
3. 除配对端点外全部要求会话令牌（WS 握手首帧 + 页面资源 Cookie）。
4. 空闲自动关闭：无已配对设备 15 分钟 → 自动停服；弹层关闭/应用退出即停服。
5. 同一时刻最多 1 台设备配对（原版语义：单设备会话）；新配对踢掉旧会话。

## 手机协议 v1（WS JSON 帧，Main 与手机页之间）

```
→ {type:"hello", pairToken}          ← {type:"paired", workspacePath, sessionToken} | {type:"error", code}
→ {type:"resume", sessionToken}      ← 同 paired（刷新后凭 Cookie 内令牌恢复）
→ {type:"list"}                      ← {type:"taskList", tasks:[{taskId,title,status,updatedAt}]}
→ {type:"open", taskId}              ← {type:"timeline", taskId, messages:[...]}（readSessionMessages）
→ {type:"events", taskId, afterSeq}  ← {type:"events", taskId, events:[...], lastSeq, hasMore}
                                       （readSessionEvents 增量；页面投影流式内容与待决权限）
→ {type:"send", taskId, content}     ← {type:"accepted", taskId}（sendPrompt, web-remote-replayable）
→ {type:"permission", taskId, requestId, optionId, decision}
                                       （respondPermission；decision ∈ allow/deny/escalate/modify）
→ {type:"stop", taskId}              （stopGeneration）
← {type:"taskListChanged"}           （触发客户端重拉 list）
```

## 分期

- **M1a（已落地）**：配对核心纯逻辑（`desktopMobilePairingCore.ts`：一次性令牌/TTL/
  踢除语义状态机/LAN 地址挑选/URL 与路径解析）+ 单测（6 项）。
- **M1b（已落地）**：`desktopMobilePairingServer.ts`（http+ws 宿主 + 手机静态页 +
  rpc 桥接）+ IPC 通道 + 弹层扫码 UI + 手机页交互面。
- **M2（已落地）**：手机页准实时（时间线 2s/列表 8s 轮询）、WS 断线自动重连、
  工具调用状态渲染、phonePageSyntaxCheck 页面语法门禁。
- **M3a（已落地）**：手机端权限审批闭环——`events` 帧增量拉会话事件日志，
  页面投影 `permission.requested/resolved` 为待决权限卡片（选项按钮来自
  payload.options，decision 支持 allow/deny/escalate/modify）。
- **M3b（可选后续）**：实时流推送（part.delta 事件投影替代轮询）、多任务并行 watch。
- **M4（可选后续）**：云中继传输层（协议不变，替换传输；需用户提供服务器）。

## M1b 实施地图（勘察结论，直接照此实现）

1. **附着流**：Main 向窗口 Host UtilityProcess postMessage
   `{type: HostMessageTypes.AttachServicePort, scope:{kind:"local", workspacePath,
workspaceIdentity}, clientMode:"web-remote-replayable"}`（参考
   `desktopRemoteSessions.ts` 的 `attachRemoteWorkspaceSessionHost`，remote 版）；
   Main 留 port1 作 rpc 客户端端。host 侧 `host/index.ts:2729` 已处理 scope=local
   （注释"刷新/手机 attachment 复用同一 Host"），绑定 activeServices
   （IDroraTaskService/IDroraSessionService，见 `windowHostAttachmentRegistry.ts`）。
2. **rpc 客户端**：`@drora/rpc` 的 ChannelClient + MessagePort 协议
   （`packages/rpc/src/protocol.ts` 的 port.postMessage(VSBuffer) 契约对
   Electron MessagePortMain 适用；线格式 = VSBuffer(JSON)）。
   Main 侧此前没有 rpc 客户端先例——这是首例，注意 LoggingChannelServer 的对偶配置。
3. **服务面**（已核对接口签名）：
   `listTasks({workspacePath,workspaceIdentity})`、
   `readSessionMessages`、`sendPrompt({...,clientMode:"web-remote-replayable",
clientLabel:"mobile-web"})`、`respondPermission`、`stopGeneration`
   （`packages/services/src/session/droraTaskService.ts:199` 起；
   `droraSession.ts:135` 的 `readSessionMessages`）。
4. **权限请求可见性**：M1 手机端拉取式（打开会话时读 pending permission——
   若任务服务不暴露 pending 列表，M1 先支持"桌面弹出权限时若手机在线同步推送"，
   数据源走 TaskRealtimeBus 的 `permission_request` 流事件；
   `task-realtime.ts` 的 `TaskStreamMirrorBatchEvent`）。
5. **ws 依赖**：desktop package 已带 `ws@^8.20.0`。

## 状态所有者

- 配对/会话令牌、服务生命周期：Main `desktopMobilePairingCore`（纯逻辑）+
  `desktopMobilePairingServer`（http/ws 宿主）。
- UI 状态：WebRemoteControlDialog 本地 state + IPlatformService mobilePairing 通道。
- 手机页状态：页面内存（刷新=重配对，令牌在 Cookie 内自动恢复）。

## 验收

1. 纯逻辑单测：令牌 TTL/一次性、状态机、URL/LAN 地址选择。
2. 桌面弹层开启后，手机同 Wi-Fi 扫码完成配对，可见任务列表与会话内容，可发送输入、
   批准/拒绝权限请求、停止生成；桌面端实时可见同样内容（同一 Host 真相源）。
3. 关闭弹层/空闲超时后端口关闭；配对令牌过期后无法再次配对。
