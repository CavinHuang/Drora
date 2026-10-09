# Drora Relay Server（自建云中继服务端）设计

状态：**设计定案，未实现**。线协议依据 = `specs/mobile-web-remote.md` M4 段的官方
逆向定案（含原版证据索引）。动机：官方 relay（zcode.z.ai）不可自控——协议可变、
版本资产库不含 Drora 版本号（app_version 固定 3.14.3 是权宜）、无 SLA。自建服务端
提供协议兼容的替代部署点，桌面端一行配置切换。

## 1. 目标与非目标

**目标**

- G1 线协议与官方 relay 兼容：现有桌面客户端（`desktopMobileRelayControl`）仅改
  WS URL 即可接入，零客户端逻辑改动。
- G2 纯转发职责：不解析业务（rpc-frame/bridgeSessionId 对服务端不透明），桌面
  Host 仍是唯一业务真相源（对齐官方架构，spec「服务端设计倒推」）。
- G3 单节点部署：Node + `ws@8`（仓库既有依赖），无重依赖；TLS 由反代终结。
- G4 手机页托管（分期，见 §7）：R1 先协议核（测试 terminal），R2 自研极简手机页，
  R3 再评估完整移动前端。

**非目标**

- 不做账号体系/计费/营销触点（官方有账号绑定能力，Drora 私有部署不需要）。
- 不做多实例水平扩展（单机万级以下连接，内存注册表即可；扩展留待需要时）。
- 不重写完整官方手机页（React 同源移动构建）；R2 的极简页覆盖任务列表/会话查看/
  输入发送/权限审批即可（对齐 LAN 手机页能力面）。

## 2. 总体架构

```
桌面 Electron(device 角色)             Drora Relay Server                 手机浏览器(terminal 角色)
desktopMobileRelayControl ── WSS ──► ┌─────────────────────┐ ◄── WSS ── 手机页(R2 自研/兼容页)
  既有客户端,URL 可配置               │ WS 入口 /ws         │           auth_init{role:"terminal"}
                                     │  · 连接注册表(内存)  │
 desktop Host(业务真相源) ◄─ 桥 ──   │  · 会话状态机        │  ── rpc-frame 桥 ──► Host 服务面
                                     │  · 1:1 data 转发    │
                                     │ DeviceRegistry(SQL/文件,持久: sid↔pass_hash)
                                     │ 静态托管 /m/*(R2 手机页+版本门控)
```

所有者划分：**连接与配对状态** = relay 服务端；**设备凭据** = relay 持久层；**业务
数据（任务/会话/输入）** = 桌面 Host（与官方一致，服务端零业务参与）。

## 3. 线协议（与官方兼容，摘要）

端点 `GET /ws?mid=<deviceMid>`（Upgrade: websocket，permessage-deflate 开启，
单 WS 消息上限 1MiB，超限断开）。帧为 JSON 对象，服务端只认以下类型：

| 类型                                                           | 方向                                      | 语义                                                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------- |
| `device_register_init{device_mid, pass_hash, meta, client_ts}` | device→srv                                | 注册，生成 `device_sid`                                                                                                  |
| `device_register_ack{device_sid, server_ts}`                   | srv→device                                | 注册应答                                                                                                                 |
| `auth_init{role:"device"                                       | "terminal", device_sid, meta, client_ts}` | 双方→srv                                                                                                                 | 发起挑战 |
| `auth_challenge{nonce, server_ts}`                             | srv→双方                                  | 挑战                                                                                                                     |
| `auth_response{device_sid, proof, client_ts}`                  | 双方→srv                                  | `proof=HMAC-SHA256(passHash, "<nonce>                                                                                    | <role>   | <device_sid>", base64url)` |
| `auth_ack{pair_status, device_sid, terminal_sid, server_ts}`   | srv→双方                                  | 鉴权应答：device ack 带 `device_sid`+`terminal_sid`（未配对 `""`），terminal ack 带 `device_sid`+自身 sid（E2E #2 对齐） |
| `pair_status_query{device_sid, client_ts}`                     | 双方→srv                                  | 心跳/状态查询（device/terminal 双角色受理，E2E #1 对齐）                                                                 |
| `pair_status_ack{pair_status, server_ts}`                      | srv→双方                                  | 状态应答（**也作为配对变化时的主动推送**；terminal 查询应答附 `terminal_sid:""`，官方观测形状）                          |
| `data{payload:{zcode_type...}, client_ts}`                     | 双方                                      | 应用帧（**matched 态才转发**，转发时补 `server_ts`）                                                                     |
| `error{code, message?, server_ts}`                             | srv→双方                                  | 错误面（见 §5）                                                                                                          |

校验面（反推自官方行为，spec M4 段有实证记录）：

- `data` 信封必须有 `client_ts`（缺失静默丢弃——官方行为：接受但不转发）；
- `pair_status_query` 双角色受理（2026-09-28 E2E #1 P0 修复：官方 terminal 角色以
  query 为唯一心跳，拒绝即官方手机页 ~10s 终态死亡），任意 pair 态回当前
  `pair_status_ack`；`device_sid` 与鉴权会话不符回 `WRONG_PARAM`；
- 未知 `type` / 非对象帧 → `error{code:"WRONG_PARAM"}`；
- 超 1MiB 的 WS 消息：断开连接（官方在应用帧层拒收 + 物理帧上限，服务端从严）；
- `payload` 非对象 / `bridgeSessionId` 超出 `[A-Za-z0-9._~-]{1,64}`：静默丢弃
  （字符集约束取证自手机页 `transportEnvelopeIdMaxChars` schema）。

## 4. 服务端状态机与事件顺序

**DeviceRegistry（持久）**：`device_sid → {device_mid, pass_hash, created_at,
last_seen_at}`。注册即新增（旋转语义：同 device_mid 重复注册生成新 sid，旧 sid 保留
至未命中）；`device_register_init` 永远成功（官方无账号门槛），但按 IP 限速（§6）。

**每 device_sid 的连接会话（内存，唯一所有者 = SessionStore）**：

```
                device_register/auth
 [无会话] ────────────────────────────► WAITING(仅 device 已鉴权)
                                          │  terminal 鉴权成功(首个)
                                          ▼
                    ┌── terminal 断开 ── MATCHED ◄── terminal 鉴权成功(踢旧)
                    ▼      (KICKED 旧)    │
                WAITING ◄─────────────────┘
   device WS 断开(任意态) → 会话销毁;若 terminal 在线 → error{DEVICE_OFFLINE} 后断开
```

事件顺序不变量（实现必须保证）：

1. **踢除顺序**：新 terminal 鉴权成功时，先向旧 terminal 发
   `error{code:"KICKED"}` 并 **terminate 断开**（E2E #4 对齐：官方不发 close 帧，
   客户端见 1006），**再**向新 terminal 发
   `auth_ack{pair_status:"matched"}`——避免旧 terminal 在 matched 后仍能抢发 data。
2. **配对通知**：terminal attach/detach 时向 device **主动推**
   `pair_status_ack`（附心跳应答兜底，设备 ≤10s 内必知状态）；两条路径幂等。
3. **转发窗口**：`data` 仅在 MATCHED 且双向 socket 均存活时转发；同一连接内严格
   FIFO，跨连接不保证全局有序（端到端靠 rpc-frame seq/ack 语义，spec M4c）。
4. **转发时盖章**：服务端解析 data 信封 → 置 `server_ts` → 重序列化转发（官方手机
   页 schema 含 server_ts 的来源）。
5. **device 死亡**：WS close/ping 超时 → 依次向 terminal 推
   `pair_status_ack{waiting}`（E2E #3 对齐：官方先推状态再报错）→
   `error{code:"DEVICE_OFFLINE"}` → **terminate 断开**（E2E #4，客户端见 1006）；
   会话销毁（device 重连重走鉴权，matched 关系不持久）。
6. **鉴权竞态**：单连接同一时刻至多一个在途 auth（challenge 后未应答前收到新
   auth_init → 按 WRONG_PARAM 处理）；terminal 与 device 可并发鉴权互不阻塞。

**心跳与死亡检测**：服务端对每连接 30s WS ping；客户端心跳（10s±2s query）兼作
应用层存活；ping 3 次无 pong → 视为死亡走 §4.5。

## 5. 错误面（对齐官方错误码族）

| code             | 触发                                    | 接收方行为（已验证的官方客户端语义）           |
| ---------------- | --------------------------------------- | ---------------------------------------------- |
| `AUTH_FAILED`    | proof 不匹配 / sid 不存在               | device：清凭据重注册一次；terminal：终态失败页 |
| `WRONG_PARAM`    | wrong-state query / 未知类型 / 形状非法 | paired 态仅记日志（desktop）；terminal 终态    |
| `KICKED`         | 新 terminal 接管                        | terminal：会话冲突终态（"已被其他设备接管"）   |
| `DEVICE_OFFLINE` | device WS 死亡                          | terminal：可恢复，展示"桌面离线"并轮询重连     |
| `INTERNAL`       | 服务端内部错误                          | waiting 态可恢复重连；paired 态按可恢复处理    |

## 6. 安全模型

- **口令不出机**：passHash 仅在注册时上送一次，之后全部挑战-应答（HMAC-SHA256，
  nonce 服务端随机、一次性）；QR 泄露 = terminal 配对能力泄露，旋转手段 =
  刷新二维码（device 重注册，旧 sid 作废）——与官方 resetPairing 语义一致。
- **限速**：`device_register_init` 按 IP 限速（如 10 次/分钟）；单 device_mid 存活
  sid 上限（如 8 个，超出淘汰最旧）；WS 消息 1MiB 硬限。
- **私有部署加固（可选项）**：环境变量配置注册共享口令
  （`device_register_init` 需附 HMAC 证明），防公网注册滥用；默认关闭。
- **传输**：生产强制 WSS（反代终结 TLS）；服务端不落任何业务数据。

## 7. 手机页策略（分期）

- **R1 协议核（已实现，2026-09-28）**：`packages/relay-server`
  （protocol/deviceRegistry/sessionStore/relayServer + CLI main）。验收 = G1
  一致性测试（`packages/desktop/test/relayServerConformance.test.ts`）：真桌面
  客户端连自建服务端，注册→鉴权→waiting→QR→terminal 配对 matched→桌面 active→
  bootstrap 双向→page-request 路由→KICKED→自动重连恢复，全过。
  实现期定案：①会话拆挂按 **connectionId** 精确匹配——被 KICKED 旧连接的
  socket close 晚到时不得拆除新 terminal（集成测试实锤的竞态）；②DEVICE_OFFLINE
  只要 device 死亡且 terminal 在线就发（不以 statusChanged 为门——旧 terminal 先
  走时状态已是 waiting，按状态门控漏发）；③terminal 鉴权 challenge 丢失后重发
  auth_init = 重新挑战（宽松重试，非 WRONG_PARAM）。
- **能力缺口补齐（2026-09-28，对齐审计后）**：①**stale-waiting 恢复**——paired 后
  又回 waiting（手机离开）时，两分支都迁移 waiting*terminal（状态面回二维码），
  wasPaired 分支另挂 15s 恢复计时，超时仍未配对或反复抖动则重连设备 socket 重置
  会话（官方 applyPairStatus/scheduleStaleWaitingRecovery 同款）；②**任务清单
  isBridgeableRemoteTask 过滤**——远程工作区任务缺 identity+remoteSessionId 时从
  手机清单剔除（官方 HW 同款）；③**deviceInfo 存储入运行时**（stop/start 清理）；
  ④**用量遥测事件族**——pair_result（pair_kind=initial|reconnect）/bridge_result
  经 `reportUsageEvent` dep 上报（index.ts 接 reportRemoteUsageEventForRenderer，
  elementName=web_remote_control*\* 与官方构造族一致）。
- **R2 极简手机页（已实现，2026-09-28）**：`packages/relay-server/src/phonePage.ts`
  静态页（服务端 `/m` 与 `/m/index.html` 托管）：读 QR 的 sid/hash → terminal 鉴权
  （内嵌纯 JS HMAC-SHA256——纯 HTTP 部署无 crypto.subtle，实现经 RFC 4231 形状+
  node:crypto 交叉单测）→ matched 后以 `drora-page-request/response` 应用帧驱动
  任务列表/会话时间线/事件权限/输入发送/停止。桌面侧 `drora-page-request` 由
  `desktopMobilePageBridge.ts`（serveMobilePageAction，LAN 同款 v1 翻译单一实现）
  处理。**有意分歧**：自托管资产不做官方式 app_version 版本门控（页面与桌面同仓
  发布天然配套）；页面能力面=LAN v1 子集（列表/时间线/事件/发送/权限/停止），
  官方 rpc-frame 深接入留待 R3。**已知限制（R2）**：任务清单为活跃 timeline 子集，
  pinned/archived 专视图未做（官方 AMn 推送三类；R3 随完整前端一并补）。
  **失败面卡片（2026-09-28 对齐官方托管页）**：KICKED（设备接管）/AUTH_FAILED+
  WRONG_PARAM（手机连接已失效）/DEVICE_OFFLINE（桌面离线，可恢复自动重连）/
  bootstrap 20s 超时（响应超时卡）——标题/描述/下一步步骤/失败详情/重试按钮，
  文案与官方托管页逐字对齐；可恢复面（deviceOffline）保留 2s 自动重连循环，
  终态面停止重连仅留重试按钮。
- **R3（已立项，方案定稿）**：完整移动前端（与桌面同源组件的移动构建，官方形态）。
  实施方案与对齐清单见 `specs/mobile-relay-r3-frontend.md`（2026-09-29 立项：路线 A
  =packages/ui 移动壳 + relay-client + packages/web 远程第二入口，v4 数据零转换；
  目标替换官方资产代理为默认手机页）。
- **桌面发送侧流控/重放（2026-09-28，mobile-web-remote.md M4c 核心项）**：
  `desktopMobileRelayControl` 桥发送侧对齐官方 AcknowledgedRelayProtocol 子集——
  `createRelayReplayBuffer` 纯逻辑（desktopMobileRelayProtocol.ts，常量逐项对齐
  官方 chunk-C6VCYWB4.js @6729：高水位 1MiB / 低水位 256KiB / 重放缓冲 8MiB /
  grace 45s）：rpc-frame 发送后逐批 reserve（outerBytes=出站 data 信封字节数）；
  rpc-frame-ack releaseThrough 释放未确认字节；future-ack（ack>已发最高 seq）/
  缓冲超限 / grace 超时（按最旧未确认批次）→ 桥终态降级（对齐官方
  enterDegraded：后续 sendFrame 拒绝、入站帧丢弃、清缓冲与看门狗；不发
  app-error、不拆桥，页面上层靠超时失败面恢复）；`replayFrames()` 供重连后重发。
  **宿主背压 + onSendReady 已接线（2026-09-28 M4c 收尾）**：水位越限/回落沿经桥
  附着端口发 connection-flow-v1 控制对象（`messagePortFlowControl` 工厂，本仓判别键
  `__droraRpcControl`；官方为 `__droraRpcControl`——本地 sideband 不出机器，不与
  官方互操作）→ Host `onFlowState → setTransportFlowState` 暂停/恢复 CLI；matched
  非首次配对触发 onSendReady → 未确认帧全量重发（messageSeq/编码不变、不重记账）。
  取证偏移与线格式详见 mobile-web-remote.md「flow-state sideband 帧格式」小节与
  证据索引。

## 8. 客户端接线（桌面侧，最小改动）

- **已实现（2026-09-28，env 优先形态）**：环境变量 `DRORA_RELAY_SERVER_URL`
  （如 `http://relay.lan:4430`）→ `deriveSelfHostedRelayEndpoints` 推导
  relayWsUrl=`ws(s)://host/ws`、remotePageUrl=`{base}/remote/v4`（独立 mobile-web 包；
  缺失时服务端保留 `/m/index.html` 降级）；
  未设置走官方常量。`appSettings` 设置键（UI 可配）为后续增强。
- QR 的 `app_version`：官方地址维持固定 3.14.3；自建页忽略该参数（无资产门控）。

## 9. 模块与部署

- 新模块 `packages/relay-server`（lib：session store / registry / protocol handlers）
  - `apps/drora-relay-server`（CLI 入口：端口/db 路径/静态目录参数，SEA 可打包含）。
    实现时在 `architecture-policy.yaml` 登记模块（managed: false，依赖 shared）。
- 运行：`node dist/main.js --port 4430 --db ./relay.db --static ./public`；
  单进程；优雅停机（先广播 DEVICE_OFFLINE/INTERNAL 再关）。

## 10. 验收

1. 协议一致性：用真 `desktopMobileRelayControl`（注入 relayWsUrl 指向自建服务）
   跑通现有 12 项状态机测试全场景 + KICKED/DEVICE_OFFLINE/恢复。
2. 并发与竞态：双 terminal 互踢顺序、device 断开清理、鉴权竞态、1MiB 超限。
3. 持久化：服务重启后旧 device_sid 鉴权成功（凭据库生效）。
4. 真机：Drora 手机页（R2）扫码全流程，对齐 LAN 页能力面。

## 11. 双服务 E2E 黑盒对比（2026-09-28，官方 zcode.z.ai vs 自建 ：4430）

同一探测驱动（`.tmp-work/relay-service-compare3.mjs` + `device-death-probe.mjs`，
全新随机 mid 不触碰用户凭据）对两个服务跑同序列，逐帧归一化对比。**探测方法论
教训**：官方手机的 WS 连接也带 `?mid=<deviceMid>`（QR 携带 deviceMid，手机页
connect() @官方 bundle 6031676 把它拼进 URL）——不带 mid 的终端连接在官方侧
配对语义完全错乱（互相 KICK、永不 matched），此前 v1/v2 探测的"官方配对怪异"
结论全部作废；自建服务端则容忍无 mid 终端（更宽松，不构成分歧）。

### 对齐项（黑盒实测一致）

| 行为                             | 双方一致表现                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| 注册                             | `device_register_ack{device_sid, server_ts}` 同形                                        |
| 设备/终端鉴权流程                | challenge→proof→auth_ack；proof 同构造（HMAC base64url）                                 |
| 配对（带 mid 终端）              | 终端 auth_ack 即 matched + terminal_sid；设备收到 `pair_status_ack{matched}` 推送        |
| 设备角色 pair_status_query       | matched 态回 `pair_status_ack{matched}`（官方接受，57 轮 WRONG_PARAM 记录系无 mid 伪象） |
| data 双向转发                    | client_ts 保留 + server_ts 盖章，payload 原样                                            |
| 二终端互踢                       | 旧终端收 `error{code:"KICKED"}`，新终端 auth_ack matched                                 |
| 设备死亡（close/terminate 等价） | 终端收 `error{code:"DEVICE_OFFLINE"}` 后被断开                                           |
| 错误码族                         | KICKED/AUTH_FAILED/DEVICE_OFFLINE/WRONG_PARAM 五码全对上                                 |

### 分歧项（按客户端影响排序；#1-#4 已于 2026-09-28 修复）

| #   | 级别          | 分歧                       | 官方                                                                                                                                                       | 自建（修复前）                                                                                                                                                      | 客户端影响                                                                                                                                                                     | 状态                                                                                                           |
| --- | ------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | **P0**        | 终端角色 pair_status_query | 接受，回 `pair_status_ack{当前态}`（手机页唯一心跳方式）                                                                                                   | 拒绝 `WRONG_PARAM "pair_status_query is device-only"`                                                                                                               | **官方手机页连自建服务端：配对后 ~10s 页面 enterTerminalFailure(invalid-mobile-connection) 死亡**（phone handleRelayError 对 WRONG_PARAM 终态化）。R3 复用官方客户端语义前必修 | **已修复**：双角色受理，terminal 应答附 `terminal_sid:""`（官方观测形状）；paired 判定用 sessionStore 当前视图 |
| 2   | P2            | auth_ack 字段集            | 设备 ack 含 `device_sid+terminal_sid:""`；终端 ack 含 `device_sid+terminal_sid`                                                                            | 设备 ack 仅 pair_status；终端 ack 无 device_sid                                                                                                                     | 无害（客户端只读 pair_status），严格对齐可补                                                                                                                                   | **已修复**：device ack 补 `device_sid+terminal_sid(<sid\|"">)`；terminal ack 补 `device_sid`                   |
| 3   | P2            | DEVICE_OFFLINE 前置推送    | 先推 `pair_status_ack{waiting}` 再发 error 再断开                                                                                                          | 直接 error→断开                                                                                                                                                     | 无害；对齐=补一条状态推送                                                                                                                                                      | **已修复**：device 死亡序列 = pair_status_ack{waiting} → error{DEVICE_OFFLINE} → terminate                     |
| 4   | P3            | 断开 close 码              | 1006（不发 close 帧，直接断 TCP）                                                                                                                          | 1000 "device-offline"/"kicked"                                                                                                                                      | 无害（手机端进恢复状态机，不看 close 码）                                                                                                                                      | **已修复**：KICKED/DEVICE_OFFLINE 发帧后 `terminate()`（客户端见 1006），不再 close(1000)                      |
| 5   | ~~P3~~ 已对齐 | 未知 sid 鉴权              | 先发 challenge，proof 阶段才 AUTH_FAILED（防枚举）                                                                                                         | **同官方（2026-09-28 完成）**：challenge 照发，proof 阶段统一 AUTH_FAILED                                                                                           | 已消除                                                                                                                                                                         |
| 6   | ~~P3~~ 已对齐 | 未知帧型                   | `WRONG_PARAM`（message 空串）**+ 服务端立即断连**（发送方见 1006；device 死亡→终端收 waiting 推送+DEVICE_OFFLINE）；query payload sid 错误不报错按会话应答 | **同官方（2026-09-29 完成，干净实验推翻 85 轮 E5 的 pair_status_ack 误读——系队列残留）**：WRONG_PARAM 空串 + terminate(1006)；query 忽略 payload sid 按会话身份应答 | 已消除                                                                                                                                                                         |
| 7   | ~~P3~~ 已对齐 | error.message              | 恒空串                                                                                                                                                     | **同官方（2026-09-28 完成）**：线协议 message 恒空串，诊断细节降级为服务端日志；KICKED 卡自此与官方栈逐字节一致                                                     | 已消除                                                                                                                                                                         |
| 8   | 设计差        | 页面托管                   | 官方托管 React 应用（/remote/v4 版本库）                                                                                                                   | /m 极简页（R2）                                                                                                                                                     | R3 范围，非协议分歧                                                                                                                                                            | 维持（R3 范围）                                                                                                |

### 结论

设备角色（桌面客户端）面：**自建服务端与官方完全兼容**——官方桌面客户端、本仓
桌面客户端均可无差别工作（此前 G1 一致性测试 + 本轮矩阵双重实证）。终端角色面：
本仓手机页（R2 自绘）与自建服务端自洽；**#1-#4 已修复（2026-09-28）**，官方手机页
与自建服务端的心跳/鉴权字段/死亡序列/断开语义全部对齐，R3 路线 A（复用官方 rpc
客户端代码）已解锁；#5-#7 为有意分歧（自建语义更利于诊断），#8 属 R3 范围。

## 12. 内嵌 LAN 模式（desktop 内嵌宿主，2026-09-28）

桌面应用的「局域网连接」传输不再使用旧 LAN 直连配对服务
（`desktopMobilePairingServer`，HTTP+WS、协议 v1、一次性配对令牌），改为**进程内
嵌自建 relay-server**：手机侧与云中继统一走本 spec 的 relay 协议（§3），手机页
复用 R2 自建页（/m）。官方对齐代码零改动——内嵌宿主是纯自研装配层。

### 12.1 架构与生命周期

```
renderer 弹层(transport=lan)
  └─ startMobileRelayControl({transport:"lan"})          ── IPC ──► Main 装配（index.ts）
       1. prepareMobileRelayTransport("lan")：
          desktopMobileLanRelayHost.ensureStarted()       （幂等；已监听则复用）
            ├─ createDeviceRegistry(file storage:
            │    ~/.drora/v2/mobile-relay-lan/registry.json)   ← sid↔pass_hash 持久
            └─ createRelayServer({port:0, host:"0.0.0.0"}) → listen → actualPort
          pickLanAddress()（desktopMobileLanRelayHost，自旧 pairing core 迁入）选手机可达 IPv4
       2. resolveEndpoints 固定注入：
            relayWsUrl    = ws://127.0.0.1:<actualPort>/ws      （桌面客户端走环回）
            remotePageUrl = http://<lanIp>:<actualPort>/m/index.html（QR 指向手机可达地址）
       3. desktopMobileRelayControl.start(...)：注册→鉴权→waiting → QR（sid+hash 形态，
          与云中继同构造，仅 baseUrl 换成本机页）
  手机 ── ws://<lanIp>:<actualPort>/ws ──► 内嵌 relay ── 1:1 data ──► 桌面客户端(同一进程)
```

- **端口**：`port:0` 随机，杜绝与用户自部署 relay（如 dev CLI :4430）冲突；每次应用
  启动端口可能变化，QR/远端页地址随之失效重发——预期行为。
- **stop 语义**：`stopMobileRelayControl` 在 transport=lan 时同时停 relay 控制链
  （设备 WS、桥）与内嵌服务端；应用退出（will-quit）兜底清理。refresh（刷新二维
  码）= 轮换凭据重启，内嵌服务端保持监听（仅设备重注册）。
- **幂等**：ensureStarted/stop 均幂等；宿主不随弹层开关反复重建 registry。

### 12.2 凭据按端点 origin 隔离

云中继与 LAN 内嵌是**不同服务端**（sid 命名空间独立）：同一 device_sid+pass_hash
在另一服务端必然 AUTH_FAILED。装配处把单一凭据文件改为按 effective origin 路由：

- 路由键 = 云端取 `relayWsUrl` 的 origin（官方 `wss://zcode.z.ai` 与任意自建部署
  互不通用）；LAN 内嵌取固定逻辑 origin `ws://127.0.0.1`（端口随机且 registry.json
  才是身份域，端口不入键——凭据跨重启有效，避免每次开机重注册）。
- 文件：`~/.drora/v2/mobile-relay-device-<sha8(origin)前8位>.json`。旧单文件
  `mobile-relay-device.json` **不迁移不删除**：首次按新 origin 重新注册（二维码重
  出，官方语义 sid 本就随注册轮换），无害。

### 12.3 安全模型变化（有意分歧，对齐官方语义）

- QR 从「一次性配对令牌」（旧 LAN 直连）变为 **sid+hash 长期凭据**（relay 协议形
  态）：扫码即配对能力，泄露面与云中继一致；兜底 = 刷新二维码轮换凭据（设备重注
  册、旧 sid 作废、旧终端被 DEVICE_OFFLINE/KICKED 断开）。
- 服务端仅监听本机需求面：WS 入口绑 `0.0.0.0`（手机须经局域网访问），桌面客户端
  自身走 `127.0.0.1` 环回；注册限速/1MiB 上限/HMAC 挑战应答沿用 §6。

### 12.4 恢复语义与旧链路删除

- **恢复**：`startupRestoreStorage` 上下文扩展 `transport` 字段（<30 行改动，已实
  现）：应用重启后按记录的 transport 恢复对应链路（lan=先 ensureStarted 再注入内
  嵌端点；cloud=现链路）。
- **旧 LAN 直连已删除（2026-09-29，完成 §12 退役的最后一步）**：弹层 LAN 分支改调
  `startMobileRelayControl({transport:"lan"})`（前轮已落地），随后整体删除旧栈——
  - 文件：`desktopMobilePairingServer.ts`（HTTP+WS 宿主 + 内联手机页）、
    `desktopMobilePairingCore.ts`（一次性令牌状态机；`pickLanAddress` 迁入
    `desktopMobileLanRelayHost.ts` 继续服务内嵌出码）、`desktopMobilePairingRestore.ts`
    （LAN 恢复触发点此前已摘除）、`test/phonePageSyntaxCheck.mjs`（仅校验旧内联页）；
  - IPC 通道：`PlatformChannels.MobilePairingStart/Stop/State/Reset/StateChanged`；
  - IPlatformService 方法：`startMobilePairing/stopMobilePairing/refreshMobilePairing/
getMobilePairingState/onMobilePairingStateChanged`（preload、renderer 转发、main
    装配同步删除）；
  - 测试：`desktopMobilePairingServer/Core/Restore.test.ts`；
    `desktopRendererPlatformMobileFace.test.ts` 收敛为 relay 5 项 + 重连委托。
    **保留**：`MobilePairingRuntimeState`/`MobilePairingStatus`/`MobilePairingFailure`
    类型（relay 状态沿用同一形状）、`desktopMobilePageBridge`（relay 手机页桥共用）、
    `desktopMobileServiceAttach`（relay 共用）、`createWebRemoteControlAutoStartGate`
    （双传输共用）、`~/.drora` 运行时文件一律不清理。两传输共用同一 relay 控制链 →
    **同一时刻至多一条传输活跃**：弹层内切换 tab 会把运行中的链路切到目标传输（原双
    服务端可并存的行为不再存在，记录为有意收敛）。

### 12.5 静态资产托管（2026-09-28，官方前端本地托管）

`createRelayServer` 新增 `staticRoot` 选项（CLI `--static-dir`）：GET `/remote/**`
按路径树从该目录映射文件——官方 v4 前端资产是绝对路径
`/remote/v4/<version>/assets/*`，且页面会检查
`pathname === "/remote/v4"`（bundle dHn 段），故目录结构需镜像
`<staticRoot>/remote/v4/index.html` 与 `<staticRoot>/remote/v4/<version>/assets/*`。

- 用途：①双栈对比测试床——官方真实页面（z.ai 托管的同一构建）架到自建 relay 上，
  配 P0 修复（终端心跳受理）即可端到端验证协议对齐；②R3 路线 A 的第一块基石
  （relay 托管移动 React 入口）。
- 安全：resolve 后必须仍位于 staticRoot 内（防目录穿越）；仅 GET；按扩展名回
  Content-Type；未命中 404；不缓存（测试床语义）。/m 内置页不受影响。
- 与官方差异（有意）：官方为按版本的资产库 + 版本门控 404；自建直接映射本地目录，
  页面与桌面同仓演进、天然配套（§7 同语义）。

**托管改写（2026-09-28 实测定案）**：官方托管页的 relay origin 是**硬编码**——
bundle 内 `sHn(){return Aee({endpointOrigin:\`https://zcode.z.ai\`...})}`（与页面
自身 origin 无关），纯托管资产页面会拿自建 sid 去连生产 relay（表现为 AUTH_FAILED
失败卡，relay 侧零连接日志）。故 staticRoot 服务 .js 资产时对字面量
`` endpointOrigin:`https://zcode.z.ai` `` 出站改写为
`endpointOrigin:window.location.origin`——自建托管形态下页面 relay 指向同源，
属 R3 路线 A 的托管改造点（有意差异，记录于此）。index.html 无 SRI/integrity，
改写安全；其余 z.ai 端点（OAuth/营销等）不动。
**改写规则修正（2026-09-28 二次实测）**：仅改 `endpointOrigin` 参数无效——共享
chunk（src-dNkcRypW.js）的端点构造器 `Mh()` 实际忽略该参数：relay WS 恒取硬编码
常量 `` `wss://zcode.z.ai/ws` ``（唯一例外是 `endpointOrigin===https://drora.chatglm.site`
时走镜像）。故自建托管需同时改写出站 JS 中的 `` `wss://zcode.z.ai/ws` `` 字面量 →
`(window.location.protocol===`https:`?`wss:`:`ws:`)+`//`+window.location.host+`/ws``
（动态同源）。另：浏览器对托管 JS 的内存缓存无视 no-cache——改写后须破缓存
（换 URL 或重开浏览器会话）才能生效。

**托管对齐终验（2026-09-28）**：官方真实页面（z.ai 托管 v4 构建，资产本地镜像）
经自建 relay 全链跑通——配对/引导/工作区聚合/任务时间线（rpc 桥）/composer 全部
活数据渲染。**同视口（414×896）双栈截图 SHA-256 逐字节一致**
（cmp4-ours-official-home.png ≡ cmp4-zai-official-home.png），即官方前端在自建
relay 上的显示与官方 relay 完全对齐（同一前端、同一协议、数据同源）。
测试床资产=.tmp-work/official-page/（57+ 资产镜像 + index.html 注入 WS 探针与
入口 script 缓存破坏参数，仅测试床用，不入库）。

**交互级双栈对比（2026-09-28 第二轮，§12.5 终验的深化）**：同一驱动脚本对两栈
（官方页×自建 relay vs 官方页×官方 relay，同一桌面、同视口 414×896）重放六面：
①首页+7 工作区全展开（157 任务）②整理任务菜单 ③主题菜单 ④composer 真实发
消息（"1+1"→agent 流回"2"，sendPrompt 全链）⑤二终端 KICKED ⑥杀桌面→等待超时。
结果：**①⑥两组截图 SHA-256 逐字节一致**；②③④仅时间戳类化妆品差异（测试
消息刷新了 hi 任务 updatedAt + 日期边界舍入 + 截图时点消息数不同——同一任务
历史两栈共写互见）；⑤KICKED 卡结构/文案/按钮全同，唯一实质差异=「Relay 返回」
详情行：自建发描述性 message（taken over by another terminal），官方发空串回退
显示码（KICKED）——即 §11 分歧 #7，无功能影响，保持有意分歧（利于诊断）。
结论：官方前端在自建 relay 上的全部交互面与官方 relay 行为对齐；剩余显示差异
仅错误详情文案一处（有意）。

**内建资产代理（2026-09-29，LAN 内嵌/自建部署默认官方页）**：`createRelayServer`
新增 `remoteAssets: { cacheDir }` 选项与可注入 `fetchImpl`（缺省
`globalThis.fetch`，测试 mock 走依赖注入、不污染 global）。GET `/remote/**` 的
来源触发顺序：①`staticRoot` 文件映射（dev `--static-dir`，优先，测试床语义不变）
→ ②`cacheDir` 同 pathname 缓存 → ③fetch 官方源站
`https://zcode.z.ai<pathname>`（10s 超时，简单 UA）→ 200 则把**原始字节**写入
`cacheDir`（目录随 pathname 创建；无扩展名入口按 staticRoot 约定落
`<pathname>/index.html`——v4 既是入口路径又是 `/remote/v4/<ver>/assets/*` 的
目录，不能落同名文件）并出站改写后服务。缓存只存原始字节、改写只在
出站做——§12.5 托管改写规则演进时缓存仍有效；写缓存失败降级为直出不缓存。
防穿越约束同 staticRoot：越界 pathname 直接拒绝，连源站都不请求（无扩展名候选链
原样 → .html → index.html 亦同 staticRoot；Content-Type 按扩展名推导，无扩展名
入口按 HTML）。**离线降级**：fetch 失败/非 200 时——入口文档（`/remote/v4` 与
`/remote/v4/index.html`）302 重定向到 `/m/index.html`（**保留原查询串**，QR 的
sid/hash 透传，R2 极简页兜底）；其余资产（chunk/css）404（页面自身有失败面，
重定向无意义）。内嵌 LAN 宿主（desktopMobileLanRelayHost）默认启用
`remoteAssets`（cacheDir=`~/.drora/v2/mobile-relay-lan/remote-assets`，与
registry 同目录），LAN 二维码页地址由 `/m/index.html` 升级为 `/remote/v4`（官方
v4 页，§12.5-§12.8 双栈对齐结论的产品化）；R2 页由重定向兜底，离线首次打开即
回退。CLI（main.ts）未给 `--static-dir` 时默认启用代理（cacheDir 缺省
`./remote-asset-cache`，`--asset-cache-dir` 可覆盖）；`--static-dir` 仍优先。
云中继的自建端点推导已随 D7 独立页面包更新为 `<base>/remote/v4`；官方
`zcode.z.ai` 默认端点保持其 `/remote/v4`。

**Bundled 本地根优先级（D7 + R3 P2a 修订，2026-09-29）**：CLI 未显式给
`--mobile-dir` 时，bundled 本地根解析为
`packages/mobile-web/dist/`（**源码应用产物，`remote/v4/index.html` 存在才启用**；
R3 P2a 起 `pnpm --filter @drora/mobile-web build` = vite 源码构建）
→ `packages/mobile-web/src/recovered/`（官方 3.14.3 可读快照，D7 行为保底）。
两者都缺失才落回内建资产代理。桌面 LAN 宿主在 D6 冻结期内维持只读
`src/recovered`，其切换与 QR 端点翻转一并归 R3 P5（specs/mobile-relay-r3-frontend.md
§11/§13）。源码应用直连同源 `/ws`，出站 WS 改写对其为 no-op。

### 12.6 对齐完成（2026-09-28）

交互级六面对比（§12.5 第二轮）暴露的最后一处显示差异——KICKED 卡「Relay 返回」
详情行——已消除：错误帧 message 全线空串（sendError 线格式 + KICKED/DEVICE_OFFLINE
两条 sendThenTerminate 路径），未知 sid 改两跳防枚举。重拍 KICKED 卡与官方栈
SHA-256 逐字节一致（d7-ours ≡ d5-zai）。**剩余有意分歧仅 #6**（未知设备帧官方回
pair_status_ack 的兜底怪癖——零客户端可观察影响，不复制）；#8 页面托管差异已由
staticRoot 托管方案消化。诊断信息不丢：全部错误细节以 log.warn(error frame) 进
服务端日志；R2 自建页失败卡详情空串回退显示错误码（与官方页同语义）。

### 12.7 对齐收口（2026-09-29）

§11 最后保留项 #6 经干净实验（分角色×分鉴权态、清空在途队列后逐帧观测）重新定案
并完成对齐：官方对未知帧 = `WRONG_PARAM`（message 空串）+ **服务端立即 terminate**
（发送方见 1006；device 死亡走既有终端通知路径）；`pair_status_query` 的 payload
`device_sid` 不参与校验（错 sid 照常按会话应答）。85 轮 E5 的"未知帧回
pair_status_ack"结论系在途帧队列残留造成的误读，已在 spec 内更正。自建 relay
实测（verify-6.mjs）：错 sid query → `pair_status_ack{waiting}`；未知帧 →
`WRONG_PARAM{message:""}` + `closed 1006`——与官方逐项一致。
**§11 分歧矩阵至此全部清零（#1-#8 无残留），自建 relay 与官方可观察行为完全对齐。**

### 12.8 全页面双栈对比（2026-09-29 第三轮，宽视口全应用面）

发现：官方移动页在宽视口（≥~900px）渲染**完整应用壳**（侧栏：新建任务/搜索/
插件市场/项目树全量任务；主区：问候空态+composer+快捷操作+用户页脚）——移动/
桌面双布局同一构建。第三轮以 1280×720 对九个深服务面双栈重放：新建任务全壳、
模型选择器（BigModel 个人：GLM-5.3✓/GLM-5.3-Flash 视觉/管理模型——活数据）、
优先级菜单（低/高/最高✓）、变更前确认（两栈同为无菜单 no-op）、搜索命令面板
（全部/操作/任务/文件 tabs+最近任务+建议+面板快捷键+配置）、插件市场（**两栈
同样不切主视图**——行为一致非缺口）、Drora 富时间线（工具块 查阅/思考/终端、
后台任务 pill、通知横幅、完全访问 composer 全活渲染）、任务头「更多」（两栈同
帧无可见菜单）。

**结论：九面全部同构，零实质差异；唯一可见差异仍是相对时间戳（测试消息刷新
updatedAt 所致）。** 宽视口全壳在自建 relay 上经 rpc 桥驱动全部活数据（模型列表/
命令面板/富时间线），至此覆盖移动+宽视口两布局、静态+交互+深服务三层的对比
全部完成，无残留缺口。

### 12.10 非安全上下文 WebCrypto shim（2026-10-03，LAN 真机链路修复）

**问题（§33.5 路线 4 真机验收首轮实测）**：手机经 LAN 出码地址
（`http://<桌面局域网IP>:<端口>/remote/v4/?sid=…&hash=…`）打开官方 v4 页后，
四步卡恒停「正在认证设备…」无限循环（官方页鉴权监督到点静默重连，永不进
waiting/paired；配对窗/失败卡均不出现）。

**根因（官方 bundle 字节证据，index-NjWRUABD.js）**：官方页 proof 计算
`sVn` 直接 `await globalThis.crypto.subtle.importKey/sign`（HMAC-SHA256），
且整份 bundle 无 `isSecureContext` 回退（出现 0 次），`authProvider` 仅此一个
实现（`authProvider:cVn()`）。浏览器 Web Crypto（`crypto.subtle`）只在安全
上下文（HTTPS/localhost）暴露：LAN 纯 HTTP 属非安全上下文，`crypto.subtle`
为 `undefined` → proof 计算抛 TypeError → `auth_response` 发不出 → relay 的
`handleAuthResponse` 永远等不到（`auth_ack` 不返回）→ 客户端 authenticating 态
监督重连循环。官方线上此页恒走 HTTPS，上游无需处理该环境；自建 R2 页当年同因
内嵌纯 JS HMAC（`PHONE_PAGE_CRYPTO_JS`，RFC 4231 向量校验）。§32/§33 各轮
验证均经桌面/内置浏览器（localhost，安全上下文），故从未触发。同因的次要缺口：
附件校验和 `CUe` 用 `crypto.subtle.digest('SHA-256',…)`，非安全上下文下按
`fault.attachment.checksumUnavailable` 降级（不挂死但功能缺失）。

**行为（伺服层出站注入，上游字节零改动）**：`/remote/**` 的 200 HTML 响应
（staticRoot/mobileRoot/内建代理三来源统一，一处注入点）在 `<head>` 起始处
注入内联 shim `<script>`：仅当 `globalThis.crypto` 存在且 `crypto.subtle`
缺失（即非安全上下文）时，用纯 JS HMAC-SHA256 补一个 `crypto.subtle` 最小
子集——`importKey`（仅 raw + HMAC/SHA-256）、`sign`（HMAC-SHA-256，返回
ArrayBuffer 对齐 WebCrypto 形状；算法名接受字符串与 `{name}` 两种官方用法）、
`digest`（仅 SHA-256，救活附件校验和）；其余算法/格式拒绝（fail-loud，官方页
用法面仅此三处）。磁盘字节与 remoteAssets 缓存不写 shim——注入只在出站做
（§12.5 改写同语义，改写规则演进时缓存仍有效）。安全上下文（HTTPS/localhost）
下 shim 自门控直接返回，行为与官方字节一致。

**不变量**：①上游/冻结字节文件不改写（磁盘与缓存均原始字节，伺服层是唯一
改写面）；②`crypto.subtle` 已存在时零副作用（defineProperty 仅在缺失分支
执行）；③注入幂等（HTML 已含 shim 标记即跳过）；④仅 `/remote/**` HTML，
`/m` R2 页不受影响（自带纯 JS 实现）；⑤strict module 语义安全——浏览器中
`subtle` 是 `Crypto.prototype` 只读 getter，官方页为 strict module（直接赋值
抛 TypeError），必须 `Object.defineProperty` 建实例自有属性遮蔽。

**验收**：`test/insecureContextCryptoShim.test.ts`——vm 沙箱模拟非安全上下文
（crypto 无 subtle）：importKey+sign 对照 node:crypto（RFC 4231 用例 2/6 形状
与二进制 key 字节——strBytes 式 UTF-8 实现处理不了的形状）、hash 的字符串/
对象两种形状、digest 对照 createHash；有 subtle 沙箱零改动；注入幂等、
`<head>`/无 `<head>` 两形态；`routeStaticRequest` 端到端：staticRoot 与
remoteAssets 缓存（Buffer 体）两来源的入口文档响应均含 shim 标记。真机验收：
手机经 LAN 出码地址完成配对进首页（authenticating 不再滞留）。已知边界：浏览器
对 HTML 的内存缓存无视 no-cache（§12.5 同款）——已打开过的页面需重开会话。

**浏览器验收记录（2026-10-04）**：用桌面 Chrome 的真实局域网 HTTP 源
（`isSecureContext=false`）加载冻结的官方 3.14.3 页面，两条链均实测：
①隔离 relay + 测试 device：`auth_init → auth_challenge → auth_response → auth_ack`，
页面零未捕获异常；②当前 Drora Desktop 的局域网 QR + 真实 Host：同样完成鉴权，
随后 bootstrap 返回并显示工作区首页。HTTP 响应含 shim 标记，浏览器运行时
`crypto.subtle` 可用，页面不再停「正在认证设备…」。这证明桌面 Chrome 上的非安全
上下文路径；iOS/Android 实机浏览器仍须另行扫码验收，不能把模拟视口当作真机。

**官方版本核对（2026-10-04）**：线上 `/remote/v4?app_version=3.14.3` 的
HTML 与 `packages/mobile-web/upstream/remote/v4/index.html` 逐字相同；该 HTML
引用的 `index-NjWRUABD.js` 与冻结资产逐字相同。不带 `app_version` 的线上入口
已指向 `latest` 的另一份 bundle，因此本服务以桌面 3.14.3 对应的版本资源为
对齐对象。局域网 HTTP 响应额外注入本节 shim，是明确的环境适配差异。

### 12.11 局域网 HTTP 的随机 ID 与复制适配（2026-10-04）

**问题与证据**：真实 LAN HTTP 源的 Chrome 中 `isSecureContext=false`，
`crypto.subtle` 经 §12.10 注入后可用，但 `crypto.randomUUID` 与
`navigator.clipboard` 仍为 `undefined`。官方 3.14.3 主 bundle 有三处无回退的
`crypto.randomUUID()`（`index-NjWRUABD.js` 字节偏移 978600、5641518、
5644811）；源码页 `taskSession.ts` 的 `sendText`、`stop` 等命令及
`relay-client` 桥 ID 也直接调用它。官方页复制动作使用
`navigator.clipboard.writeText`，HTTP 下缺失。独立 Chrome 实测：同一非安全
上下文中 `document.queryCommandSupported('copy')` 与用户点击触发的
`document.execCommand('copy')` 均返回 `true`。

**所有者与接入**：relay-server 的 `/remote/**` HTML 出站适配层是唯一所有者；
冻结的上游字节、源码应用、磁盘缓存不改写。§12.10 的 crypto shim 在
`isSecureContext=false`、`randomUUID` 缺失且 `getRandomValues` 可用时增加
RFC 4122 v4 UUID 生成方法（16 字节安全随机数，version/variant 位固定）；
缺安全随机源时不使用 `Math.random` 伪造。独立 clipboard shim 只在
`isSecureContext=false` 且原生 `navigator.clipboard` 缺失时提供 Promise 形状的
`writeText`：调用时同步创建临时 textarea、选中文本、执行 `copy`，随后移除节点、
恢复焦点/选区；命令失败则 reject。原生对象存在时零改动，不提供无法可靠模拟的
`readText` 或富格式 `write`。两段内联脚本在入口 `<head>` 中先于官方 bundle
执行，重复托管注入幂等；此为 LAN 环境适配，非官方资产还原。

```text
GET /remote/v4 → relay HTML 出站层 → 注入 crypto/clipboard 兼容脚本 → 浏览器
                  ├─ 鉴权/命令：getRandomValues → UUID；Host 仍持有任务真相
用户点击复制 ────└─ writeText → 同步选区 + execCommand(copy) → Promise 结果
```

**验收**：单测验证 UUID 格式/位、随机源缺失、原生 API 零改动、HTML 注入幂等；
静态路由三来源继续只改出站 HTML。Chrome 在真实 LAN HTTP 源上验证
`randomUUID` 可用，并由用户点击调用 `writeText` 成功。iOS/Android 实机复制
与扫码仍需单独验收。Clipboard 读取和富格式写入不在本回退能力内；需要它们的
界面仍应提供失败反馈，不能把 `writeText` 成功当作整套 Clipboard API 可用。

**实现验收记录**：独立 relay-server 托管官方 3.14.3 原始资产，桌面 Chrome
分别访问 LAN IP 与 localhost。LAN 页实测 `isSecureContext=false`、
`crypto.subtle`/`randomUUID`/`navigator.clipboard.writeText` 可用，UUID 的 v4
格式与 variant 位正确，点击复制的 Promise 成功；localhost 页
`isSecureContext=true` 且 `crypto`/`navigator` 均无新增自有属性。relay-server
相关 14 项测试与 Desktop `build:no-runtime-assets` 通过，生成的 Main bundle
包含 clipboard shim 标记。该构建只验证主包编译，未替代安装包与手机实机验收。

## 13. R2 页时间线 schema 漂移与 list workspaces:0 回归（2026-09-29）

### 13.1 根因链：session/messages schema 漂移（响应形状 ≠ 声明契约，时间线整屏校验错误墙）

本节即 `server-operations.ts readMessages` 有意分歧注释所引的「session/messages
schema 漂移」小节：官方行为与本仓分歧定性见下方取证表与结论，修复方式见 §13.2。

链路：R2 页 page-request{open} → desktopMobilePageBridge → IDroraSessionService
.readSessionMessages → droraAgentService → RPC `session/messages` →
`droraSessionMessagesResultSchema`（drora-protocol/index.ts:1479，内嵌 legacy
`droraMessageWithPartsSchema`：info camelCase messageId + partBase
{partId,sessionId,messageId}，.strict()）校验失败 → ZodError 序列化成 error 字符串
→ R2 页整屏校验错误墙（真机实测单次响应 259132 字节的错误串，桌面日志 2026-09-29
09:01 三个 259132 字节 drora-page-response）。

**官方取证（3.14.3 runtime bundle `drora.cjs`，14.8MB 单行；片段为反汇编原文）：**

| 证据                         | 文件+字节偏移                     | 片段                                                                                                                                                                                                                                | 结论                                                                                    |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 官方 readMessages 实现       | drora.cjs@14490259                | `function WKo(e,t){...s.findIndex(u=>String(u.info.id)===n.afterMessageId)...return{messages:n.limit?l.slice(-n.limit):l}}`                                                                                                         | 官方 runtime 同样返回 session store 的 **v4 原始行**（`info.id`，非 messageId）         |
| 官方声明结果 schema          | drora.cjs@755909                  | `U5i=m.object({messages:m.array(WZe)}).strict()`                                                                                                                                                                                    | 与本仓 droraSessionMessagesResultSchema 同构                                            |
| 官方 MessageWithParts schema | drora.cjs@657821                  | `WZe=m.object({info:tor,parts:m.array(qZe)}).strict()`；tor@654424=`discriminatedUnion("role",[Qrr,eor])`，Qrr@653778/eor@654098 用 `messageId/sessionId/parentMessageId`；parts `LR`=`{partId,sessionId,messageId}`、tool `callId` | 官方声明契约 = **legacy 形状**，与本仓 schema 逐字段一致                                |
| 官方 snapshot 映射           | drora.cjs@14406172/@14407132      | `JPn`：`messageId:String(e.info.id)`、`parentMessageId:String(e.info.parentID)`；`FKa`：`{messageId:String(e.messageID),partId:String(e.id),sessionId:String(e.sessionID)}`                                                         | 官方在 **snapshot 路径**把 v4 行映射为声明契约形状（≈本仓 bootstrap message-mapper.ts） |
| 官方手机页                   | official-phone-bundle.js（6.1MB） | `session/messages`/`readSessionMessages` 0 命中；`subscribeConversationV4` 3 命中                                                                                                                                                   | 官方客户端不消费该 op——**上游死代码漂移**，上游不可见                                   |

结论：官方 drop 自身即存在"声明 schema（legacy）≠ runtime 实际返回（v4 原始行）"
的潜伏不一致；官方只在 snapshot 路径做 v4→legacy 映射，session/messages 直接返回
原始行且无任何官方消费方。本仓还原两侧都忠实（还原无错），R2 自建页作为该 op 的
首个真实消费方把漂移暴露出来。

### 13.2 修复决策（有意分歧，对照说明）

**选服务端投影**：bootstrap `server-operations.ts readMessages` 出站前经既有
`mapMessageWithParts`（官方 JPn/FKa 的还原实现，snapshot 路径已生产验证）把 v4 行
投影为声明契约形状。理由：

1. op 载荷从此满足官方声明契约（U5i/WZe）与本仓客户端 schema，`IDroraSessionService
.readSessionMessages(): Promise<DroraMessageWithParts[]>` 接口类型变真；
2. 复用既有 mapper——客户端侧适配需在 services 复制 ~250 行 v4 行 schema+mapper，
   且 shared 无 v4 store 行 zod schema（v4 conversationRowSchema 是 UI 投影非 store 行）；
3. 载荷剥离 mode/planEnabled/anchor 等内部字段（手机带宽友好，字段语义同官方 snapshot 面）。

**对上游同步的影响**：与官方 WKo 行为有意分歧（官方返回原始行）——记入本节，
同步上游 server-operations.ts 时 readMessages 函数区域按本节处理。afterMessageId
分页在映射前按原始 `info.id` 切片；投影 messageId=String(info.id) 同值，客户端回传
任一形态命中同一切分点。

**readSession 快照面查证（未受影响）**：`droraSessionStateSnapshotSchema`
（index.ts:1028）内嵌同一 legacy schema，但 session/read 出站经 session-mapper 的
`mapMessageWithParts` 映射（bootstrap 侧），桌面 app 消费正常——与官方 snapshot
路径同构，无漂移。桌面 app 无 readSessionMessages 消费方（grep 实证：唯一消费者
即 R2 页桥）。

### 13.3 配套修复：R2 页时间线渲染面对齐

R2 页 renderTimeline/extractText 原按已删除的 v1 配对页形状渲染
（`message.role`/`tool_call`/`thinking`/`preview`），schema 修复后收到的是
DroraMessageWithParts：页面渲染面对齐 info.role + text/reasoning/tool parts；
model-only 上下文（compact summary/goal 续跑/后台通知等）在桌面桥
（desktopMobilePageBridge，LAN/relay 单一实现）按 PC 同款判据
（getConversationMessageProjectionPolicy：仅保留 realUserInput/visibleAssistant，
附加 uiVisibility!=="debug"）过滤，页面不复制第二份过滤逻辑。

### 13.4 list 响应 workspaces:0 回归（同日修复）

**取证（桌面日志 + 实连捕获）**：同会话（pid 34892）02:48 bootstrap-response 携带
7 工作区、09:00 R2 list 响应 `workspaces: array(0)`（diag-list.mjs 实连复现）；期间
无 stop/start（仅 stale-waiting 重连）。此前"transport 维度过滤推送"的假设不成立：
syncWorkspaces IPC 无 transport 过滤，bootstrap 走同一 `currentWorkspaceSummaries()`。

**根因（两层）**：

1. `syncedWorkspaces` 被 renderer **空推送清空**：renderer 重载/标签恢复窗口推送
   空快照，运行中 relay 的清单随之抹掉（relay 附着在真实工作区上，"无工作区"不是
   有效状态）；
2. R2 list 响应取 `currentWorkspaceSummaries()` **裸清单**，缺 bootstrap/
   workspace-list 同款 `mergeRuntimeWorkspace`（fallback=启动工作区）兜底。

**修复**：list 动作响应 workspaces 与 bootstrap 同款 merge（desktopMobileRelayProtocol
.mergeRuntimeWorkspace 导出复用）；运行中忽略空工作区推送（warn 日志，非空推送保持
官方 replace 语义）；list 分支不再强制 `attacher.ensure()`（缓存可答时纯快照响应，
Host 附着窗口期手机清单不闪断；回落 listTasks 路径自带容错）。

### 13.5 验收锚

- `packages/desktop/test/desktopMobileRelayControl.test.ts`「R2 list 响应：workspaces
  聚合推送清单+运行时目标，空推送不清空」：list 响应 = 推送清单 + fallback merge；
  空推送后清单保持；非空推送 replace。
- `packages/desktop/test/mobilePageBridge.test.ts`「open/events」：timeline 投影保留
  真实用户输入与 assistant 回复、过滤 model-only 注入。
- `apps/drora-cli/packages/bootstrap/test/drora-protocol-read-messages.test.mjs`：
  v4 原始行被声明 schema 拒绝（漂移事实锚）；readMessages 出站通过声明 schema；
  afterMessageId 分页与 limit 尾窗在投影前生效。
- `packages/relay-server/test/phonePageSyntax.test.ts`：时间线渲染面形状探针
  （info.role + text/reasoning/tool；v1 旧词 tool_call/thinking 不得回流）。

### 13.6 v4 Worker 出站改写边界（2026-09-29）

恢复稿在独立 Electron + 414px 浏览器真配对后显示移动首页，但浏览器记录 4 次
`ReferenceError: window is not defined`，均指向 `diffs.worker-CAavpt0L.js` 末尾。
根因是 relay 静态资产层对**所有** JS 无条件追加
`window.__selfhostPatch="served"` 诊断语句；Worker 没有 `window` 全局对象。

产品规则：出站改写只替换官方 relay URL 和 endpointOrigin 两个已取证字面量；
不追加运行时诊断副作用。未含目标字面量的 JS（尤其 Worker）必须按恢复稿原字节
返回。鉴权、配对和业务帧顺序不变。验收包含主 chunk 同源 URL 改写、Worker
响应与源码字节相同、移动真配对首页无页面异常。
修复后独立 Electron + Edge 真配对复测：414×896 移动首页与 1280×896 PC 全壳
均可见，页面异常数均为 0；`remoteAssets.test.ts` 的 Worker 字节相等断言通过。
