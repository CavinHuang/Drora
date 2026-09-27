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

| # | 原版行为 | Drora 实现 | 状态 |
|---|----------|------------|------|
| 1 | 云端 relay 中转 + 托管手机页 | LAN 直连 + 本机静态手机页（传输可插拔，云中继留 M4） | 有意分歧（既定裁定） |
| 2 | 二维码携带长期设备凭据 hash（等待期无 TTL） | 二维码携带一次性 128-bit 配对令牌、路径传递、**无 TTL**（对齐原版等待期不过期），泄露用刷新重置 | 有意分歧（令牌形态），时效语义已对齐 |
| 3 | 服务独立于弹层运行；停止 = 显式停止/窗口关闭/应用退出，**无空闲自停** | 已对齐：弹层关闭不停服；停止按钮清除恢复上下文；窗口 closed 即停服（原 disposeWindow）；已移除 Drora 自加的 15min 空闲自停 | 已对齐 |
| 4 | 刷新二维码 = 重置配对（轮换凭据 + 踢除） | `resetPairing`：作废旧票据、旧手机收 `kicked` 后断开、换发新票据，服务不重启 | 已对齐 |
| 5 | 单会话踢除通知（relay KICKED → 会话冲突失败面） | 新配对生效即踢旧连接并送达 `kicked` 帧；手机页显示会话冲突文案并停止重连 | 已对齐 |
| 6 | 状态推送 StatusChanged；六态 idle/starting/running/connecting/active/error；payload 含工作区上下文 | `MobilePairingStateChanged` 推送；六态全对齐（connecting = WS 已建立、握手未完成）；payload 含 workspacePath/workspaceIdentity | 已对齐 |
| 7 | 应用重启自动恢复上次开启状态（restorePreviouslyEnabled） | `desktopMobilePairingRestore.ts`：start 成功持久化、手动停止清除、窗口 Host 就绪且 workspaceKey 匹配时恢复一次 | 已对齐 |
| 8 | rpc-frame 透明桥 + zcode_type 帧；手机端可切换工作区；platform-request；列表推送 | 保留手机协议 v1（list 轮询、单工作区绑定）；手机页重构为服务客户端时切 v2（M5） | 暂缓（M5 路径） |
| 9 | 30s 一次性启动授权令牌（main 进程 start 处理器内部一次性签发+消费） | main 的 start 处理器直接校验发起窗口与 Host 就绪（原版授权亦为 main 内部模式，无可观察差异） | 等价，不另行引入 |
| 10 | 失败面家族：kicked / desktopDisconnected / workspaceClosed / sessionConflict 等 | kicked ✅、desktop-stopped ✅、workspace-closed ✅（窗口关闭与 Host 缺失两种来源）、会话冲突文案 ✅；sessionNotFound/Expired 由 unknown-token/invalid-session 承担 | 已对齐 |
| 11 | mobile-view-state-update / 设备信息回传（状态里带 deviceInfo） | 未实现（手机页 v1 不上报）；随 M5 补 | 暂缓 |
| 12 | initialTaskId / remoteSessionId 绑定 | 状态负载预留语义，当前恒为本地单工作区 | 暂缓（随 M5） |

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

- **M4a（本轮）**：relay 客户端（传输/鉴权/心跳/KICKED 语义）+ v4 二维码 + 应用帧
  最小面（bootstrap-request / workspace-list-request / mobile-view-state-update /
  telemetry-report / mobile-diagnostic；workspace-bridge-open 回 bridge-error 降级）。
  验收：桌面在官方 relay 到达 waiting、二维码可扫、手机配对（matched）后 bootstrap
  返回真实工作区/任务列表。
- **M4b（后续）**：rpc-frame 透明桥——`attachWorkspaceHost` 建桥 + 流控协议
  （官方常量：消息上限 16MiB、分片 64、重组超时 30s）+ 官方通道名兼容桥
  （手机页调 `zcode-task`/`zcode-session`，本仓为 `drora-*`；参照插件市场改名桥接先例）。
- **M4c（后续）**：workspace-reconnect-request、platform-request、恢复代次
  （bridgeGeneration/recoveryId）对齐。

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
  可恢复处理重连）；WRONG_PARAM（paired 态上报）。
- 二维码：`https://zcode.z.ai/remote/v4?sid=&hash=&t=&mid=&name=&app_version=`
  （v3 页已 404，版本门控现走 v4）。
- 应用帧（zcode_type）：bootstrap-request→bootstrap-response{result:
  {windowControlSessionId, desktopAppVersion, workspaces[], tasks[],
  initialViewState?, mobileViewState?}}；workspace-list-request→
  workspace-list-response{result:{workspaces, tasks, activeWorkspaceKey?,
  activeTaskId?}}；mobile-view-state-update{viewState, deviceInfo}（状态所有者：runtime）。

### 边界

- relay 只承载转发；Drora 不实现服务端。官方可随时变更协议/加账号绑定——静默失效
  风险由双传输承担（LAN 直连为默认回退，relay 为弹层内可选项）。
- 凭据持久化：`~/.drora/v2/mobile-relay-device.json`（deviceSid+passHash；
  Electron safeStorage 可用时加密存 passHash，不可用回落明文——passHash 仅授权
  relay 转发，非账号凭据）。原版用 settings+OS 凭据链，本仓 Main 不写 setting.json
  （Host settings 服务独占写盘），故用 Main 自有单键文件。
- 手机页是官方托管应用：其 rpc 调用走官方通道名，M4b 前打开工作区会收到
  bridge-error（bridge-not-available）降级失败面。
