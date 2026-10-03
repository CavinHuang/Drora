# 移动端远程控制（手机扫码连接）Spec

用户需求：对齐原版 3.14.3 的"移动端远程控制"——桌面端生成二维码，手机扫码后在
浏览器里查看会话、发送输入、处理权限请求。

原版实现依赖 z.ai 云端 relay（`webRemoteControl.failure.relayUnavailable` 等失败面）
与托管手机 Web 应用，均未随开源树发布（上游 zai-org/ZCode 亦无）。Drora 需自建，
路线已裁定：**LAN 直连优先**（无需任何服务器；协议层预留中继抽象，将来可叠加云中继）。

## 架构

（下图为已退役的 M1 LAN 直连架构，仅作历史记录——现行传输见「LAN 传输替换：统一
relay 协议」节与 `specs/mobile-relay-server.md` §12。）

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

## 安全模型（2026-09-27 二轮对齐后修订）

1. 服务**默认关闭**；用户在"移动端远程控制"弹层显式开启才监听（0.0.0.0 随机端口）。
2. 配对令牌：128-bit 随机、一次性、仅出现在二维码 URL 路径
   `http://<lan-ip>:<port>/p/<pairToken>`；配对成功即作废，换发 256-bit 会话令牌。
   等待配对**无 TTL**（对齐原版：relay pair_status 停留在 waiting，二维码长期有效，
   泄露用"刷新二维码"重置——对齐原版 resetPairing 轮换凭据）。
3. 除配对端点外全部要求会话令牌（WS 握手首帧 + 页面资源 sessionStorage）。
4. 停止时机（对齐原版，**无空闲自停**）：用户显式"停止"（清除恢复上下文）、
   承载工作区的窗口关闭（window-closed → 手机收 workspace-closed 终态）、
   应用退出；弹层关闭**不**停服。
5. 同一时刻最多 1 台设备配对（原版语义：单设备会话）；新配对踢掉旧会话（kicked 帧）。

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
  **（已删除，2026-09-29，见「LAN 传输替换」节；`pickLanAddress` 迁入
  `desktopMobileLanRelayHost.ts`）**
- **M1b（已落地）**：`desktopMobilePairingServer.ts`（http+ws 宿主 + 手机静态页 +
  rpc 桥接）+ IPC 通道 + 弹层扫码 UI + 手机页交互面。**（已删除，2026-09-29，
  见「LAN 传输替换」节）**
- **M2（已落地）**：手机页准实时（时间线 2s/列表 8s 轮询）、WS 断线自动重连、
  工具调用状态渲染、phonePageSyntaxCheck 页面语法门禁。**（该门禁脚本已随 M1b
  栈删除；relay-server 手机页语法由 `packages/relay-server/test/phonePageSyntax.test.ts`
  守护）**
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

- relay 运行状态、凭据与会话生命周期：Main `desktopMobileRelayControl`（协议纯逻辑
  在 `desktopMobileRelayProtocol.ts`）；LAN 内嵌服务端归 `desktopMobileLanRelayHost`。
  （旧 LAN 直连令牌所有者 `desktopMobilePairingCore/Server` 已删除，2026-09-29。）
- UI 状态：WebRemoteControlDialog 本地 state + IPlatformService mobileRelay 通道。
- 手机页状态：页面内存（刷新=重配对，令牌在 Cookie 内自动恢复）。

## 验收

1. 纯逻辑单测：令牌 TTL/一次性、状态机、URL/LAN 地址选择。
2. 桌面弹层开启后，手机同 Wi-Fi 扫码完成配对，可见任务列表与会话内容，可发送输入、
   批准/拒绝权限请求、停止生成；桌面端实时可见同样内容（同一 Host 真相源）。
3. 停止边界（对齐原版）：弹层关闭服务保持运行；显式"停止"后端口关闭且恢复上下文被清除；
   关闭承载窗口后端口关闭、手机收 workspace-closed；应用重启后自动恢复上次开启的远控；
   配对令牌一次性，重放被拒。

## 原版 3.14.3 发行 bundle 实现档案（2026-09-27 逆向，对齐依据）

证据源：官方发行版安装目录 `resources/app/out/`（minified 但 `s(fn,"name")` 保留原名）。
原版扫码链路为**云端 relay 中转**，手机页是 z.ai 托管 Web 应用（不在 bundle 内）：

```
手机浏览器                      z.ai relay                        桌面 Main
┌──────────────┐  WSS(role:mobile) ┌─────────────┐  WSS(role:device) ┌──────────────────┐
│ zcode.z.ai/  │ ◄───────────────► │ wss://zcode │ ◄───────────────► │ webRemoteControl │
│ remote/v3|v4 │                   │ .z.ai/ws    │                   │ Manager + 桥接    │
└──────────────┘                   └─────────────┘                   └────────┬─────────┘
                                                                     MessagePort 附着窗口 Host
```

- **设备鉴权（注册一次、长期持久）**：首连发 `device_register_init{device_mid, pass_hash}`
  → `device_register_ack{device_sid}`；`deviceSid` 存 settings、`passHash` 存系统凭据链。
  此后 `auth_init` → `auth_challenge{nonce}` → `auth_response{proof=HMAC-SHA256(passHash,
"nonce|device|deviceSid")}`。挑战-应答，口令不出本机。
- **二维码 = 设备长期凭据**：`buildWebRemoteControlExternalQrUrl` 生成
  `https://zcode.z.ai/remote/v3?sid=<deviceSid>&hash=<passHash>&t&mid&name&app_version`。
  泄露二维码需整体轮换凭据（`resetPairing("leaked-qr")` = 删除并重注册）。
- **配对语义**：relay `pair_status` ∈ waiting/matched；心跳 `pair_status_query` ≈10s±抖动、
  30s ack 看门狗；单会话——新页面接管时 relay 回 `KICKED`，旧页面显示会话冲突失败面。
- **状态机与推送**：Main 每窗口 runtime {status: idle/starting/running/active/error,
  qrUrl/connectUrl, mobileConnected, failure}，经 `WebRemoteControlStatusChanged` 推送
  renderer；trigger 常显状态（未开启/启动中/等待手机连接/手机已连接）。
  服务**独立于弹层运行**（弹层只是控制面），应用重启后按
  `webRemoteControlLastEnabledContext` 自动恢复。
- **启动授权**：`authorizeStart` 签发 30s 一次性令牌绑定窗口+workspace，
  `startAuthorized` 消费后作废。
- **手机↔桌面帧（`zcode_type`）**：bootstrap / workspace-list(-updated) /
  platform-request（手机可调桌面平台能力）/ workspace-bridge-open(-ready/-error,
  带 bridgeGeneration/recoveryId 恢复) / **rpc-frame(-ack)**（手机页跑服务客户端，
  Main 透明转发到 Host 附着端口）/ telemetry / mobile-diagnostic。
- **失败面**：sessionNotFound/sessionExpired/sessionConflict/kicked/workspaceClosed/
  desktopDisconnected/relayUnavailable 等 i18n 家族。

## 原版对齐决策表（2026-09-27）

| #   | 原版行为                                                                                                                                        | Drora 实现                                                                                                                                                                                                                            | 状态                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | 云端 relay 中转 + 托管手机页                                                                                                                    | LAN 直连 + 本机静态手机页（传输可插拔，云中继留 M4）                                                                                                                                                                                  | 有意分歧（既定裁定）                                                                                                                                                                                                                                                         |
| 2   | 二维码携带长期设备凭据 hash（等待期无 TTL）                                                                                                     | 二维码携带一次性 128-bit 配对令牌、路径传递、**无 TTL**（对齐原版等待期不过期），泄露用刷新重置                                                                                                                                       | 有意分歧（令牌形态），时效语义已对齐                                                                                                                                                                                                                                         |
| 3   | 服务独立于弹层运行；停止 = 显式停止/窗口关闭/应用退出，**无空闲自停**                                                                           | 已对齐：弹层关闭不停服；停止按钮清除恢复上下文；窗口 closed 即停服（原 disposeWindow）；已移除 Drora 自加的 15min 空闲自停                                                                                                            | 已对齐                                                                                                                                                                                                                                                                       |
| 4   | 刷新二维码 = 重置配对（轮换凭据 + 踢除）                                                                                                        | `resetPairing`：作废旧票据、旧手机收 `kicked` 后断开、换发新票据，服务不重启                                                                                                                                                          | 已对齐                                                                                                                                                                                                                                                                       |
| 5   | 单会话踢除通知（relay KICKED → 会话冲突失败面）                                                                                                 | 新配对生效即踢旧连接并送达 `kicked` 帧；手机页显示会话冲突文案并停止重连                                                                                                                                                              | 已对齐                                                                                                                                                                                                                                                                       |
| 6   | 状态推送 StatusChanged；六态 idle/starting/running/connecting/active/error；payload 含工作区上下文                                              | `MobilePairingStateChanged` 推送；六态全对齐（connecting = WS 已建立、握手未完成）；payload 含 workspacePath/workspaceIdentity                                                                                                        | 已对齐                                                                                                                                                                                                                                                                       |
| 7   | 应用重启自动恢复上次开启状态（restorePreviouslyEnabled）                                                                                        | `desktopMobilePairingRestore.ts`：start 成功持久化、手动停止清除、窗口 Host 就绪且 workspaceKey 匹配时恢复一次                                                                                                                        | 已对齐（LAN）。**relay 同语义已补齐（2026-09-28）**：`startupRestoreStorage`（~/.drora/v2/mobile-relay-restore.json）start 成功 save、手动 stop clear；renderer 推送工作区时 `restorePreviouslyEnabled` 至多恢复一次，上下文工作区须仍在推送清单（官方"工作区不匹配不恢复"） | 已对齐（双传输） |
| 8   | rpc-frame 透明桥 + zcode_type 帧；手机端可切换工作区；platform-request；列表推送                                                                | 保留手机协议 v1（list 轮询、单工作区绑定）；手机页重构为服务客户端时切 v2（M5）                                                                                                                                                       | 暂缓（M5 路径）                                                                                                                                                                                                                                                              |
| 9   | 30s 一次性启动授权令牌（main 进程 start 处理器内部一次性签发+消费）                                                                             | main 的 start 处理器直接校验发起窗口与 Host 就绪（原版授权亦为 main 内部模式，无可观察差异）                                                                                                                                          | 等价，不另行引入                                                                                                                                                                                                                                                             |
| 10  | 失败面家族：kicked / desktopDisconnected / workspaceClosed / sessionConflict 等                                                                 | kicked ✅、desktop-stopped ✅、workspace-closed ✅（窗口关闭与 Host 缺失两种来源）、会话冲突文案 ✅；sessionNotFound/Expired 由 unknown-token/invalid-session 承担                                                                    | 已对齐                                                                                                                                                                                                                                                                       |
| 11  | mobile-view-state-update / 设备信息回传（状态里带 deviceInfo）                                                                                  | 未实现（手机页 v1 不上报）；随 M5 补                                                                                                                                                                                                  | 暂缓                                                                                                                                                                                                                                                                         |
| 12  | initialTaskId / remoteSessionId 绑定                                                                                                            | 状态负载预留语义，当前恒为本地单工作区                                                                                                                                                                                                | 暂缓（随 M5）                                                                                                                                                                                                                                                                |
| 13  | bridge-error reason 词汇表 = FW 映射 4 键（workspace-closed/desktop-disconnected/unsupported-action/unexpected-error）；手机页 i18n 仅含这 4 键 | 已对齐（2026-09-28 M4c）：workspace-reconnect-response 无 reason 字段只回 success/error 字符串；bridge-error reason 按 Error.code 经 FW 映射，M4b 曾用 workspace-not-found/desktop-host-missing（官方页无此键，落通用失败面），已切换 | 已对齐（M4c）                                                                                                                                                                                                                                                                |

生命周期安全姿态变更记录（2026-09-27 审查后二次修订）：一轮曾自加"弹层关闭即停服 +
15 分钟空闲自停 + 令牌 5 分钟 TTL"，审查确认原版均无，已按原版移除；现行边界 =
显式停止 / 窗口关闭 / 应用退出。补偿控制：令牌一次性（首个扫描者赢得配对）、单设备
绑定、随机端口、仅局域网、泄露可一键重置。

## M4：接入官方 z.ai relay（云中继传输，2026-09-27 裁定并探测通过）

用户决策：直接使用官方原版的远程服务端能力（`wss://zcode.z.ai/ws` + 托管手机页
`https://zcode.z.ai/remote/v4`），与 LAN 直连并存。最小探测（一次性脚本，未入库）已
全链路验证：`device_register_init → device_register_ack → auth_init → auth_challenge →
auth_response(HMAC) → auth_ack{pair_status:"waiting"} → pair_status_query 心跳`，官方
relay 接受无账号的设备级注册。

### 分期

- **M4a（已落地）**：relay 客户端（传输/鉴权/心跳/KICKED 语义）+ v4 二维码 + 应用帧
  bootstrap/workspace-list/mobile-view-state（telemetry/diagnostic 只记日志）。
  **多工作区聚合（2026-09-27 二次定案，逆向官方实现）**：bootstrap 与
  workspace-list 的 workspaces/tasks 聚合窗口全部工作区（原为单工作区简化）。
  官方实现=**renderer 推送**（`syncWebRemoteControlWorkspaces/Tasks` IPC，tab 变化
  时推送，main 侧注册表 + `pushWorkspaceListUpdated` 指纹变化广播
  workspace-list-updated；`getAvailableWorkspaces` = 推送清单 + 运行时目标）。
  本仓同款：`MobileRelaySyncWorkspaces/Tasks` 通道 + IPlatformService
  `syncWebRemoteControlWorkspaces/Tasks`（ui 在 useRootPlatformEffects 的 tabs
  effect 推送全部工作区 tab 摘要——官方 jjn 构造器语义：connectionState 仅远程携带、
  workspacePurpose/lastConnectionError 有才带；任务由 Root 挂载的隐藏组件
  WebRemoteControlTaskSync（官方 AMn 同款）在 relay 运行期间用 useGlobalTaskList
  推送跨工作区 timeline）；main 按窗口缓存最近一次推送（官方无 runtime 即丢弃；
  本仓额外缓存，relay 后启动立即拿全量，有意增强）并在 start 时灌入，仅属主窗口的
  推送进入运行时。推送到达且已配对时指纹变化即广播 workspace-list-updated。
  **多工作区开桥（2026-09-28）**：workspace-bridge-open 接受推送清单中的任意本地
  工作区（窗口 Host 服务面覆盖全部本地工作区，rpc 调用自带工作区 scope）；
  **远程工作区开桥（2026-09-28 M4c 已落地）**：经 remote-scoped attach
  （`remoteSessionManager.attachRemoteWorkspaceSessionHost`，scope kind=remote +
  clientMode=web-remote-replayable），要求远程已连接（isBridgeableRemoteTarget：
  kind=remote 须同时带 workspaceIdentity+remoteSessionId，官方 pl 同语义）。
  （第一版曾用 Host Window Controller 投影订阅，实测 facts 不可靠已废弃。）
- **M4b（已落地）**：rpc-frame 透明桥——`workspace-bridge-open` 每桥新建 Host 附着端口
  （clientMode=web-remote-replayable），Host 侧为该附着同时注册 `zcode-*` 官方通道别名
  （`toOfficialRpcChannelAlias`：drora-_ → zcode-_，同一 channel 实例；参照插件市场
  改名桥接先例）。帧封装对齐官方 frameShell/L3（2026-09-27 终审定案，取证官方
  chunk-GJUBRD53.js 的 ko schema 与 frameShell 构造）：{zcode_type:"rpc-frame",
  bridgeSessionId,[bridgeGeneration],[recoveryId],seq,messageSeq,fragmentIndex,
  fragmentCount,messageBytes,checksum,dataBase64}——总长字段名是 **messageBytes**
  （logicalBytes 属 v4 实时流协议，勿混）；`checksum.value` 是 **8 位小写十六进制
  字符串**（官方/手机端组装器以 /^[0-9a-f]{8}$/ 校验，数字被判
  proto.frameAssemblyMetadataMismatch 静默丢弃——桌面→手机 rpc 响应全灭的最后一环，
  真机取证）；dataBase64 须规范 base64（≥4 字符）；schema strict（多余字段即拒）。
  我方入站 checksum 兼容数值与 hex 两种线格式。每条入站完整消息回
  rpc-frame-ack（对端流控依赖）。**发送侧流控/重放（2026-09-28 M4c 核心项已落地，
  官方 AcknowledgedRelayProtocol 子集）**：`createRelayReplayBuffer`
  （desktopMobileRelayProtocol.ts 纯逻辑，常量逐项对齐官方 chunk-C6VCYWB4.js
  @6729：1MiB/256KiB/8MiB/45s）——rpc-frame 发送后逐批 reserve（outerBytes=出站
  data 信封字节数，对齐官方 measureFrameBytes 口径）；rpc-frame-ack
  releaseThrough 释放未确认字节；越高水位（1MiB）记 saturated warn、回落低水位
  （256KiB）记 drained info；future-ack / 缓冲超限（8MiB）/ grace 超时（45s，按
  最旧未确认批次，官方 deadline 语义）→ 桥终态降级（对齐官方 enterDegraded：
  后续 sendFrame 拒绝、入站帧丢弃、清缓冲与看门狗；不发 app-error、不拆桥，页面
  上层靠超时失败面恢复）；`replayFrames()` 供重连后重发未确认帧组。
  **宿主背压 + onSendReady 重放（2026-09-28 M4c 收尾，已落地）**：
  ① 水位越限沿（reserve 后 false→true）经桥附着端口 postMessage
  `messagePortFlowControl("saturated")`（rpc 包单一出处工厂），ack 回落到
  ≤256KiB 沿发 `"drained"`——护栏对齐官方事件接线（桥存活且未降级才发）；
  ② 设备 socket 重连/同 socket 重新配对（matched 且 lastPairedSocketGeneration>0，
  官方 applyPairStatus 分支）触发 onSendReady 处理：先全量重发重放缓冲内未确认
  rpc-frame（与首次发送同路径同编码，帧内 messageSeq/seq/checksum 不变；不重新
  reserve、不改水位、不刷新 grace——对齐官方 resetReplay+flushPendingFrames
  记账），后 flush 新 pending（官方 flushPendingFrames 按 reserve 顺序出帧，旧
  在前）；首次配对（gen=0）与无活跃桥/空缓冲不触发。
  stale-waiting 恢复已随 R1 能力缺口补齐落地（mobile-relay-server.md §7）。
  桥错误面（M4c 起按官方 FW 词汇表）：unexpected-error（未知工作区/未连接远程/
  superseded 等，message 带官方中文文案）/ workspace-closed / desktop-disconnected
  / unsupported-action（M4b 曾用 workspace-not-found/desktop-host-missing，已切换）。
  **官方桥传输协议全貌（2026-09-28 逆向定案，chunk-C6VCYWB4.js AcknowledgedRelayProtocol，
  M4c 实现依据）**：每条完整消息必须回 rpc-frame-ack（ackMessageSeq）；发送侧维护
  未确认字节水位——超过 saturationHighWaterMarkBytes=1MiB 置 saturated 并向 Host
  附着端口发 flow-state "saturated"（回压），ack 落到 ≤256KiB（low）恢复发 "drained"；
  已发送未确认消息进重放缓冲（max 8MiB / grace 45s），重新配对/恢复时
  replayUnacknowledged() 全量重发（onSendReady 触发）；故障分级：future-ack/无效帧/
  组装超时(30s)/sendFrame 异常 → enterDegraded（终态，桥宣告失败）；重复帧重 ack
  不重复投递。
  **ack 身份过滤（2026-10-03 真机故障修复，用户裁定方案①）**：官方页 ack 的 zod
  schema 为 strict 且 `bridgeSessionId` 必填（upstream `src-dNkcRypW.js`
  `ry=O({zcode_type:"rpc-frame-ack",bridgeSessionId,bridgeGeneration?,recoveryId?,ackMessageSeq}).strict()`）
  ——ack 只对它所确认的那条桥生效。桌面 `handleRpcFrameAck` 此前不校验身份，快速切
  任务/工作区时旧桥在途 ack 落进新桥 replayBuffer 被误判 future-ack → 桥终态降级
  （真机日志 2026-10-03 10:29:36：两次 workspace-bridge-open 仅隔 8s，第二个桥建立
  0.9s 后被旧桥 ack 打死，页面卡「已配对，正在加载工作区」，仅 reload 重建桥可恢复）。
  修复=ack 携带的 bridgeSessionId ≠ 当前桥 → 丢弃（info 日志带双侧 sessionId，
  可定位性优先；bridgeGeneration 若携带且不匹配同样丢弃）；缺身份字段的旧形态 ack
  维持旧行为（视为当前桥）。同桥内的真 future-ack 仍终态降级不变。与入站 rpc-frame
  的 assembler 三字段身份校验（relay-wire/rpcFrame.ts `accept`）对齐——ack 是此前
  唯一未按身份过滤的入站面。回归：desktopMobileRelayControl.test.ts 双桥竞态用例。官方开桥（Q）差异：attach 请求携带 remoteSessionId/kind（远程工作区
  可开桥，要求远程已连接）、异步附着后校验 bridge 未被更新请求取代（superseded）、
  发送超限抛 envelopeTooLarge 而非静默。配对遥测事件族（2026-09-28 已全量对齐，
  证据 chunk-GJUBRD53.js@741857-742900 ctor 族 + index.js@387052/401850/658155）：
  web_remote_control_start_result / pair_result（pair_kind=initial|reconnect）/
  bridge_result / remote_workspace_connect_result（result/error_category/
  workspace_kind/remote_kind/entry_kind），经 reportRemoteUsageEvent 上报（信封
  eventRegion="web_remote_control"，仅 remote_workspace_connect_result 独立用
  "remote_workspace"，见「遥测缺口收口」节）。

### flow-state sideband 帧格式（2026-09-28 取证定案，M4c 宿主背压实现依据）

**关键结论：flow-state 不是 relay 数据帧，不走手机方向**——它是桌面 main 经
**workspace Host 附着端口**（clientMode=web-remote-replayable 的 MessagePort）发给
本机 Host 的控制对象，Host 据此暂停/恢复 CLI 出站（v4 conversation 链路的
transport flow gate）。官方接线（createWorkspaceBridge 内）：
`onSaturated → ve.sendFlowState("saturated")`、`onDrained → sendFlowState("drained")`，
其中 `ve = new MessagePortProtocol(attachmentPort)`——与 rpc 数据同一端口、不同
消息形态分流。

线格式（MessagePort postMessage 负载，结构化克隆对象，非二进制、非 JSON）：

| 字段                | 类型                         | 值                     | 说明                                                               |
| ------------------- | ---------------------------- | ---------------------- | ------------------------------------------------------------------ |
| `__zcodeRpcControl` | 字符串字面量                 | `"connection-flow-v1"` | 控制对象判别键；本仓改名 `__droraRpcControl`（rpc 包工厂单一出处） |
| `state`             | `"saturated"` \| `"drained"` | 水位沿状态             | 恰好 2 个键，多余字段即非法（isMessagePortFlowControl 校验）       |

本仓消费链（取证时已具备，本次仅补 main 侧发送端）：Host `host/index.ts`
`MessagePortProtocol.onFlowState → forwardFlowState → connectionScope.
setTransportFlowState`（serial chain，dispose 时补发 "closed"），与官方 host 侧
`exposeServicesOnMessagePort`（host index.js@1482463：`c.onFlowState →
f.setTransportFlowState`）同构；官方更下游经 RPC `setConnectionFlowStateV4`
（host index.js@360242，trusted-host-relay 校验）进入 CLI flow route。改名分歧：
官方判别键 `__zcodeRpcControl`，本仓 `__droraRpcControl`（两端同为自研代码，不与
官方互操作——附着端口不出机器）。

### 原版证据索引（2026-09-28，官方 3.14.3 安装树 `D:\software\zcode\resources\app\out\main\`，偏移为该构建 minified 文件的字节偏移）

| 结论                                                            | 位置                   | 偏移                             |
| --------------------------------------------------------------- | ---------------------- | -------------------------------- | ----------------- | -------------------------------- |
| 应用帧分发表 routePayload（9 case 全表）                        | index.js               | 400878                           |
| 手机 platform-request 8 方法注册表                              | index.js               | 709575                           |
| workspace 推送→同步+恢复（官方内联触发）                        | index.js               | 731576                           |
| restorePreviouslyEnabled（至多一次/清单校验）                   | index.js               | 405987                           |
| start 成功 save 恢复上下文                                      | index.js               | 405268                           |
| 仅手动 stop clear 上下文                                        | index.js               | 405856                           |
| isBridgeableRemoteTarget / isBridgeableRemoteTask               | index.js               | 385786 / 385903                  |
| getAvailableWorkspaces（注册表+运行时目标合并）                 | index.js               | 393711                           |
| WRONG_PARAM 仅 paired/waiting 走 onError（只记日志）            | index.js               | 380403                           |
| onError 接线=仅 logger.warn 不断连                              | index.js               | 404384                           |
| 应用帧超限拒收（warn+丢弃）                                     | index.js               | 392023                           |
| WS mid 参数 / X-Device-ID 头 / 心跳 10s / QR app_version        | index.js               | 376115 / 376220 / 381194 / 59072 |
| 流控+重放默认常量（1MiB/256KiB/8MiB/45s）                       | chunk-C6VCYWB4.js      | 6729                             |
| AcknowledgedRelayProtocol 类 / data 信封 client_ts              | chunk-C6VCYWB4.js      | 8551 / 16244                     |
| 协议 limits 引用 / 物理帧 1MiB 常量表                           | chunk-GJUBRD53.js      | 672222 / 532564                  |
| checksum hex strict / frameShell=messageBytes                   | chunk-GJUBRD53.js      | 672722 / 675450                  |
| 配对遥测构造族（pair/bridge/start_result）                      | chunk-GJUBRD53.js      | 742394                           |
| 遥测 ctor 族全貌（Af/Ef/aee/see/cee/lee）                       | chunk-GJUBRD53.js      | 741857–742900                    |
| remote_kind 遥测 schema enum（ssh/wsl/docker/server）           | chunk-GJUBRD53.js      | 507075                           |
| resolveRemoteKind（attach 优先/identity 兜底）                  | index.js               | 387052                           |
| resolveRuntimeWorkspaceDimensions（pair 维度）                  | index.js               | 387232                           |
| pair_result 状态沿（nI：paired/kicked/error）                   | index.js               | 401850–402465                    |
| hasEverPaired（pair_kind 旗标，仅新会话重置）                   | index.js               | 404928                           |
| start_result IPC 沿（runStartOperation/e1/StartWebRemote…）     | index.js               | 658100–658820                    |
| ConnectRemote connectTrigger 归一（reconnect/restore→else new） | index.js               | 665263                           |
| ARMS remote_usage 组（remote_connect_result 等）                | index.js               | 580856–581084                    |
| 端点族构造（api/v1、relay /ws、remote v3/v4 按 semver）         | chunk-GJUBRD53.js      | 4737                             |
| onSaturated/onDrained → Host 端口 sendFlowState 接线            | index.js               | 397846 / 397922                  |
| onSendReady 触发（applyPairStatus matched，非首次配对）         | index.js               | 379650                           |
| onSendReady 处理：flush pending + replayUnacknowledged          | index.js               | 404240 / 404330                  |
| replayUnacknowledged（resetReplay+flush，不改水位记账）         | chunk-C6VCYWB4.js      | 12892                            |
| 饱和/排空发射沿（updateSaturationAfterReserve/processAck）      | chunk-C6VCYWB4.js      | 11617 / 14812                    |
| flow-state 线格式（postMessage 控制对象，非 relay 帧）          | chunk-BMP2VTTL.js      | 4958 / 7872                      |
| Host 侧 MessagePortProtocol.onFlowState 分流                    | host/chunk-UHHNTW2R.js | 2711 / 5625                      |
| Host 消费：onFlowState → setTransportFlowState                  | host/index.js          | 1482463                          |
| Host 下游：setConnectionFlowStateV4（trusted-host-relay）       | host/index.js          | 360242                           |
| respondToWorkspaceReconnectRequest（reconnect 分支全貌）        | index.js               | 399799                           |
| reconnectWorkspace=reconnectWebRemoteControlWorkspaceIn…        | index.js               | 409793                           |
| routePayload reconnect case（无前置守卫直发）                   | index.js               | 401307                           |
| reconnect IPC 通道名 zcode:web-remote-control-reconnect-…       | chunk-GJUBRD53.js      | 11408                            |
| preload onWebRemoteControlReconnectWorkspace（同通道回复）      | preload/index.cjs      | onWebRemoteControlReconnectWork… |
| renderer 重连处理（handleReconnectRemoteWorkspace 委托）        | 托管页 index-NjWRUABD  | 5942240                          |
| 手机页 reconnect 请求/响应匹配（workspaceKey 必须回显）         | 托管页 index-NjWRUABD  | 6086587                          |
| createWorkspaceBridge（开桥全貌：attach+superseded+telem…       | index.js               | 395979                           |
| respondToWorkspaceBridgeOpen（ready 后 readyAnnounced+fl…       | index.js               | 398793                           |
| mapWorkspaceBridgeFailureReason（FW）/getErrorCode（UW）        | index.js               | 385109 / 385003                  |
| isBridgeableRemoteTarget（pl）/isBridgeableRemoteTask（HW）     | index.js               | 385786 / 385903                  |
| toExternalBridge 远程分支（kind=remote 必带 id+remoteSes…       | index.js               | 386100                           |
| isCurrentBridgeRuntime（v=superseded 判定）                     | index.js               | 388704                           |
| disposeRuntimeBridgeResources（y：开新桥先拆旧桥）              | index.js               | 388667                           |
| attachLocalHost（n：scope kind=local，DESKTOP_HOST_MISSING）    | index.js               | 583400                           |
| attachWorkspaceHost 远程分支（i：remoteSessionId/kind 面）      | index.js               | 584400                           |
| attachRemoteWorkspaceSessionHost（re：四段校验+remoteKind）     | index.js               | 577400                           |
| 手机页 bridge-error/app-error 消费（I9(reason,message)）        | 托管页 index-NjWRUABD  | 6044547 / 6030112                |
| 手机页失败面 i18n（4 个 reason 键=官方 reason 词汇表）          | 托管页 index-NjWRUABD  | 6046621–6052021                  |
| resolveWorkspaceKey（identity?.trim()                           |                        | workspacePath）                  | chunk-GJUBRD53.js | oz 函数（"resolveWorkspaceKey"） |

**补充定案（版本门控机制细化）**：桌面侧 `Wx(appVersion)` 为 semver 合法性校验，
合法→页面路径 `/remote/v4`，非法（dev 版本）→`/remote/v3`（chunk-GJUBRD53.js:4737
`Wx(n.appVersion)?"v4":"v3"`）；服务端为**按已发布版本的页面资产库**
（`/remote/v4/{version}/assets`，3.14.0–3.14.3 存在，其余 404，无参数走 latest）。
Drora 版本号不在资产库中，故二维码 app_version 固定 3.14.3 的决策不变。
**手机侧证据不在本地安装树**（页面由 zcode.z.ai 托管）：role:`terminal` auth、
applyPairStatus stale-waiting、handleRelayError KICKED/DEVICE_OFFLINE 等位于
`https://zcode.z.ai/remote/v4/3.14.3/assets/index-NjWRUABD.js`
（@6032109 / applyPairStatus 段 / 6036560），可按 URL 重新取证。
**服务端行为（版本门控 404、WAF 挑战、区域 307）为线上直测结论，无本地证据**。

- **M4c（2026-09-28 收口）**：~~workspace-reconnect-request~~（已落地，见下节取证与
  实现）、~~远程工作区开桥（remote-scoped attach）~~（已落地，经既有
  `attachRemoteWorkspaceSessionHost`）；platform-request 已随 M4a 落地；
  恢复代次（bridgeGeneration/recoveryId）随 M4b 帧封装透传（手机端自增 generation，
  桌面按代校验 superseded 已落地）。~~遥测缺口两项~~已随「遥测缺口收口（2026-09-28）」
  节对齐（`remote_workspace_connect_result` 经既有 ConnectRemote 管道闭环、
  `bridge_result.remote_kind` 按 attach 优先/identity 兜底填充），无遗留缺口。

### 遥测缺口收口（2026-09-28，官方取证 chunk-GJUBRD53.js@741857-742900、index.js@581066 组、387052、401850-402465、665263、658155-658820）

两条记录在案的遥测缺口的对齐结论与实现位置：

1. **`remote_workspace_connect_result`（eventRegion="remote_workspace"）**：官方
   上报点只有 ConnectRemote IPC handler（index.js@665200-665500：成功/失败都发，
   `remoteKind=target.kind`、`connectTrigger` 取 renderer 传参——赋值点 @665263
   `g==="reconnect"||g==="restore"?g:"new"`，枚举即 new|reconnect|restore），
   **重连委托链（qb @409793 / lt @399799）官方无任何遥测**。本仓同构早已接通：
   手机重连 → renderer `reconnectRemoteWorkspaceHistoryEntry` 携
   `connectTrigger:"reconnect"`（packages/ui/src/root/reconnectRemoteWorkspaceHistoryEntry.ts@141）
   → preload → main `ConnectRemote`（desktopMainIpcRemote.ts）→
   `buildRemoteWorkspaceConnectResultTelemetry`（shared/remoteUsageTelemetry.ts，
   官方 aee 逐字还原）+ ARMS `remote_connect_result`（desktopRemoteUsageArmsTelemetry）。
   **不在 `reconnectWebRemoteControlWorkspaceInRenderer` 的解析沿补上报**：那会与
   ConnectRemote 的官方同位上报双计（成功/失败路径各发两条），偏离官方单发语义。
   ARMS `remote_active_session_count` / `remote_disconnect`（group="remote_usage"，
   index.js@581066 组）本仓同组已实现并接线。
2. **`bridge_result.remote_kind`**：官方 resolveRemoteKind（index.js@387052）=
   remote 目标取 attach 结果 `remoteKind`（attachRemoteWorkspaceSessionHost 返回
   `descriptor.target.kind`），缺失回退 `parseRemoteWorkspaceIdentity(identity)?.kind`。
   本仓 `desktopMobileRelayControl.resolveTargetRemoteKind` 同构：remote-scoped attach
   成功/superseded 面用 attach 返回的 `remoteKind`，未连接拒绝面/附着失败面走
   identity 解析兜底（desktopRemoteSessions.ts 注册表的 RemoteTarget.kind 枚举
   ssh|wsl|docker|server 与官方 @507075 遥测 schema 一致），非远程恒空串。
   连带修复：信封 `eventRegion` 误写 "result" → 官方 `Af` 的
   "web_remote_control"（chunk-GJUBRD53.js@741857）；`start_result` 此前未接 → 在
   `start()` 成功/失败沿上报（官方 runStartOperation index.js@658155：维度在 start
   上下文入口解析，失败面 errorCategory=classifyRemoteUsageError）；`pair_result`
   维度接 `resolveWorkspaceTelemetryDetail`（官方 resolveRuntimeWorkspaceDimensions
   index.js@387232 的还原），并把 pair_kind 改为独立 `hasEverPaired` 旗标（官方
   index.js@404928：仅新会话重置，stale 恢复重连不重置——与 stale 探测旗标
   wasPaired 是两个变量；修复此前 emit 时 wasPaired 已置位导致的恒 "reconnect"），
   kicked/error 终态沿补发 failure+relay（官方 nI @402198/402476）。

### workspace-reconnect-request 与远程开桥取证定案（2026-09-28，M4c 实现依据）

**workspace-reconnect-request 全链（官方 3.14.3）**：

1. 手机页发起（托管页 @6086587）：`{zcode_type:"workspace-reconnect-request",
requestId, workspaceKey}`；响应匹配 `zcode_type==="workspace-reconnect-response"
&& requestId 一致 && workspaceKey 回显一致`；`success:false → throw Error(error)`
   （error 字符串兼作失败面键）。
2. 桌面 main 分发（routePayload @401307）：`case"workspace-reconnect-request":
lt(h,b)`，无前置守卫。
3. `respondToWorkspaceReconnectRequest`（lt @399799）：
   `await e.reconnectWorkspace(h.windowId, b.workspaceKey)` → 成功回
   `{zcode_type, requestId, workspaceKey, success:true}`；catch 回
   `{..., success:false, error: e.message}`。**无独立 reason 字段，错误语义全在
   error 字符串**。
4. `reconnectWorkspace` = `reconnectWebRemoteControlWorkspaceInRenderer`（qb
   @409793）：BrowserWindow.fromId(windowId) 缺失 → throw "Desktop window is not
   available for Web remote control reconnect."；经 IPC 通道
   `zcode:web-remote-control-reconnect-workspace`（chunk-GJUBRD53.js@11408）向
   **发起窗口 renderer** 发 `{requestId:"web-remote-reconnect-<ts>-<rand>",
workspaceKey}`，等 renderer 同通道回复（sender.id 过滤 + schema
   {requestId, workspaceKey, success, error?} + requestId 匹配），120s 超时 →
   throw "Web remote control reconnect request timed out."。重连事实在 renderer
   （远程连接历史/target/凭据都在窗口侧），main 只做转发与等待。
5. preload（官方 index.cjs onWebRemoteControlReconnectWorkspace）：ipcRenderer.on
   同通道 → await 回调 → `event.sender.send(同通道, result)`；回调抛错 → 回
   `{requestId, workspaceKey, success:false, error}`。
6. renderer（托管页 @5942240）：
   `handleReconnectRemoteWorkspace(workspaceKey, {activateWorkspaceAfterReconnect:
false, showErrorToast:false, throwOnFailure:true})` → 成功
   `{requestId, workspaceKey, success:true}`，catch → `{..., success:false,
error}`。本仓同款 hook 已存在（useRemoteWorkspaceHistory.ts
   handleReconnectRemoteWorkspace，选项名一致；未知 key 抛
   "远程 workspace 不在当前窗口中，无法重连: <key>"）。

**远程开桥 attach 面（官方 createWorkspaceBridge Q @395979）**：

- 目标解析：`getAvailableWorkspaces`（@393711，推送清单 + 运行时目标合并）按
  workspaceKey 查找；找不到 → throw "目标工作区不在当前桌面窗口中，无法创建 Web
  远程控制 bridge。"（无 code）。
- 可桥判定 `isBridgeableRemoteTarget`（pl @385786）：
  `kind!=="remote" || !!(workspaceIdentity && remoteSessionId)`——远程工作区断连后
  renderer 推送条目不带 remoteSessionId，即以"identity+remoteSessionId 齐备"为
  已连接代理；不满足 → throw "目标远程工作区尚未连接，无法创建 bridge，请先重连。"
  （无 code）。
- 开新桥先拆旧桥（y @388667 disposeRuntimeBridgeResources），currentBridge 在
  **异步 attach 前**同步置为新桥对象。
- `attachWorkspaceHost`（@584400）按 kind 分流：local → `attachLocalHost`（n
  @583400：窗口 Host 进程 + MessageChannelMain，`scope:{kind:"local"}`，Host 缺失
  抛 code=DESKTOP_HOST_MISSING）；remote → 校验 remoteSessionId 存在（缺 →
  REMOTE_SESSION_MISSING）与 workspaceIdentity.trim()（缺 →
  REMOTE_WORKSPACE_IDENTITY_MISSING），经 `attachRemoteWorkspaceSessionHost`
  （re @577400）四段校验：注册表查 session（REMOTE_SESSION_MISSING）→
  attachmentState=attachable（REMOTE_SESSION_OFFLINE）→ 窗口归属（
  REMOTE_SESSION_WINDOW_MISMATCH）→ descriptor 匹配且 workspaceKey===identity
  （REMOTE_WORKSPACE_IDENTITY_MISMATCH）；随后向窗口 Host 发 AttachServicePort
  `scope:{kind:"remote", remoteSessionId, workspacePath, workspaceIdentity}` +
  clientMode，返回 `{process, port, remoteKind: target.kind}`。本仓
  `desktopRemoteSessions.ts attachRemoteWorkspaceSessionHost` 与官方逐段同构
  （同名错误码已存在），直接复用。
- **superseded 校验**（@396694 附近）：`await attachWorkspaceHost` 后
  `isCurrentBridgeRuntime`（v @388704：runtime 仍注册且 currentBridge===本桥），
  不满足 → release attachment + throw "Workspace bridge request was superseded."
  （respondToWorkspaceBridgeOpen catch 统一回 bridge-error：reason=FW(error)，
  error=message——superseded 无 code → "unexpected-error"）。ready 发出后再次
  按代校验（ee @398793：currentBridge.bridgeSessionId 与 bridgeGeneration 均
  匹配才置 readyAnnounced=true 并 flushPendingFrames）。
- **envelopeTooLarge**：Q 的 sendFrame（af 协议回调）对 `me(h, frame)
.kind==="oversize"` 抛 `Error("remote.rpcFrame.envelopeTooLarge")`——发送侧
  超限从静默改为显式抛出（协议侧捕获 → enterDegraded 终态）。手机页同款
  （@6084714 sendFrame 抛同键）。
- bridge-error reason 词汇表 = `mapWorkspaceBridgeFailureReason`（FW @385109，
  经 UW @385003 取 Error.code）：DESKTOP_HOST_MISSING→`desktop-disconnected`；
  REMOTE_SESSION_MISSING/REMOTE_SESSION_WINDOW_MISMATCH→`workspace-closed`；
  REMOTE_WORKSPACE_IDENTITY_MISSING/REMOTE_WORKSPACE_IDENTITY_MISMATCH→
  `unsupported-action`；**其余（含 REMOTE_SESSION_OFFLINE、无 code 的校验错误）
  →`unexpected-error`**。托管页 i18n（@6046621–6052021）恰好只含这 4 个键
  （workspace-closed/desktop-disconnected/unsupported-action/unexpected-error），
  未知键落通用失败面。
- bridge-ready 外形 `toExternalBridge`（zW @386100）：kind=remote 时必须带
  workspaceIdentity+remoteSessionId（缺则 throw），且多 `workspaceIdentity`、
  `remoteSessionId` 两字段。
- 遥测：bridge_result（wc）带 `workspaceKind=T.kind`、`remoteKind=attach 结果的
remoteKind`、`entryKind=taskId?"task":"home"`。
- 手机页开桥（@6084714）：bridgeGeneration 由页面自增（++u），bridge-ready 仅按
  bridgeSessionId 匹配。

**本仓落地裁定（2026-09-28）**：重连走官方同构的全链委托（main→renderer IPC，
通道 `drora:web-remote-control-reconnect-workspace`，改名豁免；preload 同通道
回复；Root 注册 handleReconnectRemoteWorkspace 委托，选项同官方）；远程开桥复用
`attachRemoteWorkspaceSessionHost`（remote-scoped attach 在本仓等价物），预热
（M4b 自研，官方无）仅对本地工作区执行——远程 scope 的服务面在 remote attach
端口上，本地 Host 的 agent.listSessions 覆盖不到。bridge-error reason 全面切换
官方 FW 词汇表（M4b 曾用 workspace-not-found/desktop-host-missing，官方页无此
二键，属还原缺口修正，见决策表 #13）。

### 协议常量（逐项取证自官方 3.14.3 bundle，探测复核）

- 端点：`wss://zcode.z.ai/ws?mid=<deviceMid>`，头 `X-Device-ID`，permessage-deflate。
- 注册：`device_register_init{device_mid, pass_hash, meta{platform,version,name}, client_ts}`
  → `device_register_ack{device_sid}`；凭据长期有效（deviceSid+passHash 持久化）。
- 鉴权：`auth_init{role:"device", device_sid, meta, client_ts}` →
  `auth_challenge{nonce}` → `auth_response{device_sid,
proof=HMAC-SHA256(passHash, "<nonce>|device|<sid>", base64url)}` → `auth_ack{pair_status}`。
- 口令派生：password=randomBytes(24).base64url；passHash=sha256(password).base64。
- 心跳：`pair_status_query{device_sid}` 间隔 10s±抖动(≤2s)；ack 看门狗 30s。
- pair_status：waiting/matched；新页面接管 → 旧连接收 `error{code:"KICKED"}`。
- 错误处理：AUTH_FAILED（persisted 凭据失效→重注册一次）；INTERNAL（waiting 态按
  可恢复处理重连）；WRONG_PARAM（**paired||waiting_terminal 态只记日志**——官方
  3.14.3 bundle handleError 取证：该条件走 `options.onError`，其接线仅
  `logger.warn("[web-remote-control] external relay device error")`，不断连、不停
  心跳、不刷新 ack 时间戳。relay 在手机接管/离开的过渡期会对 pair_status_query
  周期性回 WRONG_PARAM（真机实测 10s 心跳节奏），属链路常态噪音；期间手机帧继续
  流动，30s ack 看门狗到期自然重连自愈——重连重新鉴权回 waiting，二维码恢复有效。
  2026-09-27 真机首配实锤：按终态处理会把刚配对上的会话 10s 内误杀）。
- Host 服务调用封送（2026-09-27 真机首配实锤修复）：rpc 线协议的方法参数是
  **位置参数数组**（服务端 `ProxyChannel.fromService` 用 `target.apply(handler,
args)` 展开）。移动远控的服务附着（`desktopMobileServiceAttach.ts`）必须经
  `ProxyChannel.toService` 返回类型化服务（IDroraTaskService/IDroraSessionService）；
  裸 `channel.call("method", {对象})` 会被 apply 当成空参数列表，首个 listTasks 即以
  "reading 'workspacePath' of undefined" 崩掉。类型化调用同时让
  readSessionMessages/readSessionEvents 补齐必填的 workspacePath（此前缺失）、
  readSessionEvents 按返回数组（而非 { events } 包装）解构（此前恒为空，
  手机端事件投影从未真正工作过）。
- 二维码：`https://zcode.z.ai/remote/v4?sid=&hash=&t=&mid=&name=&app_version=`
  （v3 页已 404，版本门控现走 v4）。**app_version 固定上报 `3.14.3`**
  （`OFFICIAL_REMOTE_PAGE_APP_VERSION`，2026-09-27 实测定案）：官方托管页按版本清单
  分发页面资源，未知版本直接 404——实测 0.0.x/1.0.0/2.0.0/3.13.0/3.14.4/3.15.0/
  99.0.0 → 404，3.14.0–3.14.3 → 200，省略参数 → 200（走默认页）。Drora 自身版本
  （0.0.1）不在清单内，手机扫码必 404；二维码的 app_version 语义是"手机页协议版本"
  而非产品版本，固定为还原协议版本 3.14.3（同步上游协议时随之调整）。WS 注册/鉴权的
  `meta.version` 仍上报真实版本——relay 不校验该值（0.0.1 注册实测通过）。
- 应用帧（zcode_type）：bootstrap-request→bootstrap-response{result:
  {windowControlSessionId, desktopAppVersion, workspaces[], tasks[],
  initialViewState?, mobileViewState?}}；workspace-list-request→
  workspace-list-response{result:{workspaces, tasks, activeWorkspaceKey?,
  activeTaskId?}}；mobile-view-state-update{viewState, deviceInfo}（状态所有者：runtime）。
  **platform-request（2026-09-28 对齐官方 q 处理器落地）**：官方 8 方法注册表
  （isDockerAvailable/listWSLDistros/listDockerContainers/listSSHConfigAliases/
  createTempTextAttachment/loadMcpFromUserDirectory/saveMcpToUserDirectory/
  migrateLegacyCommonMcp），装配处复用 main IPC 同名实现（MCP 保存失败折叠为
  {success:false,error} 结果帧）；未知/失败回 platform-response success:false。
  **telemetry-report**：转发进桌面遥测汇（rendererTelemetryEventPayloadSchema 校验
  后 appTelemetryCore.reportEvent，对齐官方 reportRendererTelemetryEvent）。
  **出站超限守卫**：应用帧 >1MiB 拒收并 warn（对齐官方 maxPhysicalFrameBytes）。
  **手机页 zod schema 必填字段（2026-09-27 真机取证，缺失即整帧静默丢弃→页面无限
  重试 bootstrap 停在"正在加载工作区"）**：workspace 必填 `label`（目录 basename，
  对齐官方 ul(path)）；task 必填 `workspacePath`/`workspaceLabel`/`workspaceKind`/
  `createdAt`（此外 taskId/title/updatedAt；status 为多余键被 schema 剥离）。
- **出站应用帧必须裹 `{type:"data", payload:{zcode_type...}}` 信封**（2026-09-27
  真机取证修复）：relay 与双端的应用帧统一走 data 信封，入站侧同款解包；裸帧
  （无 type 字段）会被 relay 以 WRONG_PARAM 拒收——bootstrap-response 发出后
  50ms 内收到 WRONG_PARAM、手机页收不到响应而 10s 重试，永远停在"正在加载工作区"。
  全部出站路径（bootstrap/workspace-list 响应、rpc-frame、rpc-frame-ack）统一经
  sendAppFrame 的信封封装。

### Renderer 集成面（2026-09-27 缺口修复）

preload 与 main 的 relay 实现落地后，renderer 侧 `createDesktopPlatform`
（`packages/desktop/src/renderer/src/desktopPlatform.ts`）一度只转发了 LAN 的
start/stop/get 三项，relay 全部 5 个方法（`startMobileRelayControl` /
`stopMobileRelayControl` / `refreshMobileRelayControl` / `getMobileRelayControlState` /
`onMobileRelayStateChanged`）与 LAN 的 `refreshMobilePairing` /
`onMobilePairingStateChanged` 均未转发。UI 经 `usePlatform()` 拿到的适配对象上这些
方法是 `undefined`：切到"云中继"tab 后状态查询返回兜底 idle（"未开启"）、自动开启
条件永不成立、无状态推送、二维码区落入无超时的"正在准备二维码"分支且弹层内无手动
开启入口——用户完全无法自恢复。

规则（回归边界）：

1. `IPlatformService` 的移动远控方法面（relay 5 项 + M4c 增补的
   `onWebRemoteControlReconnectWorkspace` 重连委托；旧 LAN 直连 5 项已随栈删除，
   2026-09-29）必须在
   `createDesktopPlatform` 逐一转发到 `window.drora`；后续在 preload 新增任何
   移动远控方法时，renderer 转发与弹层消费必须同步补齐。
2. renderer 子项目不在根 `pnpm typecheck` 覆盖范围内（typecheck 只构建到
   `packages/desktop/tsconfig.host.json`），且 `window.drora` 的全局类型声明不在
   renderer 工程内——缺失转发不会被类型检查拦截，由
   `packages/desktop/test/desktopRendererPlatformMobileFace.test.ts`
   （node:test + `mock.module("@drora/ui")` + window stub）守护。
3. 弹层自动开启闸门：每次弹层打开、每个传输至多自动开启一次
   （`packages/ui/src/lib/webRemoteControlAutoStart.ts` 的
   `createWebRemoteControlAutoStartGate`，`admit(state, transport)` 仅在
   `state.status === "idle"` 且该传输未占用名额时准许）。默认传输 LAN 在打开弹层时
   消耗自己的名额后，切到"云中继"tab 仍可自动开启 relay——修复前是跨传输共享的
   单一布尔，切 tab 后 relay 永远停在"未开启"。弹层关闭 `reset()` 清空全部名额。

4. 2026-09-29 真 Electron + CDP 回归：Main 查询返回 `status: idle` 时，
   Renderer 必须保留这个状态传给自动开启闸门；只过滤其他传输的非 idle 运行状态。
   原实现先用 `state.status !== "idle"` 筛掉 idle，再把 `undefined` 交给闸门，
   结果弹层永久显示“正在准备二维码”。状态所有者仍是 Main，Renderer 只决定当前
   tab 的投影及单次启动命令；关闭弹层重置名额，不另存服务端运行事实。

   ```text
   Main: idle ──状态查询──> Renderer: 当前 tab 投影 idle
                                  └─闸门准许一次──> startMobileRelayControl
                                                        └─Main: running + QR URL──> Renderer
   ```

   验收：隔离 Electron 实例打开弹层后，无需手动刷新即出现可复制的本地 QR URL；
   LAN 与云中继切换仍各自最多自动启动一次；已在其他传输运行时不得误判为本 tab
   可用状态。

### 边界

- relay 只承载转发；Drora 不实现服务端（官方 z.ai relay）。**自建兼容服务端的设计
  已定案**：见 `specs/mobile-relay-server.md`（线协议完全兼容，桌面端仅切 URL；
  动机=官方不可自控+版本资产库不含 Drora 版本号）。
- 凭据持久化：`~/.drora/v2/mobile-relay-device-<sha8(origin)>.json`（deviceSid+passHash
  按 effective origin 路由，2026-09-28 起云端/LAN 内嵌各自独立，见「LAN 传输替换」节；
  Electron safeStorage 可用时加密存 passHash，不可用回落明文——passHash 仅授权
  relay 转发，非账号凭据）。旧单文件 `mobile-relay-device.json` 不迁移不删除。
  原版用 settings+OS 凭据链，本仓 Main 不写 setting.json
  （Host settings 服务独占写盘），故用 Main 自有单键文件。
- 手机页是官方托管应用：其 rpc 调用走官方通道名，M4b 前打开工作区会收到
  bridge-error（bridge-not-available）降级失败面。

## LAN 传输替换：统一 relay 协议（2026-09-28，specs/mobile-relay-server.md §12）

「局域网连接」传输不再使用本 spec 前文记录的 LAN 直连配对服务
（`desktopMobilePairingServer`：HTTP+WS、协议 v1 hello/token、一次性配对令牌），
改为**进程内嵌自建 relay-server**（`desktopMobileLanRelayHost` + `@drora/relay-server`）。
手机侧与云中继统一走 relay 协议（M4 帧族），手机页复用 R2 自建页（/m）。架构、端口、
凭据隔离与安全模型变化详见 `specs/mobile-relay-server.md` §12，此处只记录双端接线面：

- **Main**：`mobileRelayControl` 装配增加 `transport` 维度——
  `startMobileRelayControl({transport:"lan"})` 时先 `ensureStarted` 内嵌 relay
  （随机端口 + registry.json 持久），`resolveEndpoints` 固定注入
  `{relayWsUrl: ws://127.0.0.1:<port>/ws, remotePageUrl: http://<lanIp>:<port>/m/index.html}`；
  `transport:"cloud"`（缺省）走 §8 设置键→env→官方解析链。凭据仓按 effective origin
  路由（`mobile-relay-device-<sha8(origin)>.json`；旧单文件不迁移不删除）。
- **stop 语义**：transport=lan 的 stop 同时停 relay 控制链与内嵌服务端；应用退出
  （will-quit）兜底清理；refresh（刷新二维码）= 轮换凭据重启，内嵌服务端保持监听。
- **恢复语义**：`startupRestoreStorage` 上下文新增 `transport` 字段，应用重启后按记录
  的传输恢复对应链路（load 钩子内完成传输准备）；旧 `desktopMobilePairingRestore` 的
  LAN 恢复触发点摘除（onWindowHostWorkspaceReady 不再读 pairing 恢复文件）。
- **Renderer**：弹层两个 tab 统一调 `startMobileRelayControl`（lan tab 传
  `transport:"lan"`）；状态推送单一来源 `onMobileRelayStateChanged`，按状态携带的
  `transport` 字段过滤（`MobilePairingRuntimeState.transport`，未携带=兼容匹配）。
  **单一活跃链路**：两传输共用控制链，同一时刻至多一条活跃；弹层内切换 tab 会把
  运行中的链路切到目标传输（原双服务端可并存的行为不再存在，有意收敛）。
- **旧栈已删除（2026-09-29，前轮「只拆线不删码」的收尾）**：`startMobilePairing/
stopMobilePairing/refreshMobilePairing/getMobilePairingState/onMobilePairingStateChanged`
  方法与 `MobilePairingStart/Stop/State/Reset/StateChanged` IPC 通道、
  `desktopMobilePairingServer/Core/Restore` 文件及其测试、`phonePageSyntaxCheck.mjs`
  均已删除；保留 `MobilePairingRuntimeState` 等状态类型（relay 沿用）、
  `desktopMobilePageBridge`（relay 手机页桥共用）与 `desktopMobileServiceAttach`。
  删除清单与保留理由见 `specs/mobile-relay-server.md` §12.4。
- **协议面同步修复（E2E #1-#4，spec §11）**：终端角色 `pair_status_query` 受理
  （官方手机页心跳）、auth_ack 补 `device_sid`/`terminal_sid` 字段、device 死亡序列
  前置 `pair_status_ack{waiting}`、KICKED/DEVICE_OFFLINE 改 terminate（客户端见
  1006）——服务端帧序见 `specs/mobile-relay-server.md` §4，状态表 §11 已标记修复。
