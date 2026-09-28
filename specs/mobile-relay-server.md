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

| 类型                                                           | 方向                                      | 语义                                                 |
| -------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- | -------- | -------------------------- |
| `device_register_init{device_mid, pass_hash, meta, client_ts}` | device→srv                                | 注册，生成 `device_sid`                              |
| `device_register_ack{device_sid, server_ts}`                   | srv→device                                | 注册应答                                             |
| `auth_init{role:"device"                                       | "terminal", device_sid, meta, client_ts}` | 双方→srv                                             | 发起挑战 |
| `auth_challenge{nonce, server_ts}`                             | srv→双方                                  | 挑战                                                 |
| `auth_response{device_sid, proof, client_ts}`                  | 双方→srv                                  | `proof=HMAC-SHA256(passHash, "<nonce>                | <role>   | <device_sid>", base64url)` |
| `auth_ack{pair_status, terminal_sid, server_ts}`               | srv→双方                                  | 鉴权应答（terminal 附带自身 sid）                    |
| `pair_status_query{device_sid, client_ts}`                     | device→srv                                | 心跳/状态查询                                        |
| `pair_status_ack{pair_status, server_ts}`                      | srv→device                                | 状态应答（**也作为配对变化时的主动推送**）           |
| `data{payload:{zcode_type...}, client_ts}`                     | 双方                                      | 应用帧（**matched 态才转发**，转发时补 `server_ts`） |
| `error{code, message?, server_ts}`                             | srv→双方                                  | 错误面（见 §5）                                      |

校验面（反推自官方行为，spec M4 段有实证记录）：

- `data` 信封必须有 `client_ts`（缺失静默丢弃——官方行为：接受但不转发）；
- `pair_status_query` 仅在 waiting 态合法，matched 后回 `error{code:"WRONG_PARAM"}`；
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
   `error{code:"KICKED"}` 并等其 socket 关闭（或直接销毁），**再**向新 terminal 发
   `auth_ack{pair_status:"matched"}`——避免旧 terminal 在 matched 后仍能抢发 data。
2. **配对通知**：terminal attach/detach 时向 device **主动推**
   `pair_status_ack`（附心跳应答兜底，设备 ≤10s 内必知状态）；两条路径幂等。
3. **转发窗口**：`data` 仅在 MATCHED 且双向 socket 均存活时转发；同一连接内严格
   FIFO，跨连接不保证全局有序（端到端靠 rpc-frame seq/ack 语义，spec M4c）。
4. **转发时盖章**：服务端解析 data 信封 → 置 `server_ts` → 重序列化转发（官方手机
   页 schema 含 server_ts 的来源）。
5. **device 死亡**：WS close/ping 超时 → 先向 terminal 发
   `error{code:"DEVICE_OFFLINE"}`，再断 terminal；会话销毁（device 重连重走鉴权，
   matched 关系不持久）。
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
- **R3（可选，远期）**：完整移动前端（与桌面同源组件的移动构建，官方形态）；
  依赖面大，独立立项。

## 8. 客户端接线（桌面侧，最小改动）

- **已实现（2026-09-28，env 优先形态）**：环境变量 `DRORA_RELAY_SERVER_URL`
  （如 `http://relay.lan:4430`）→ `deriveSelfHostedRelayEndpoints` 推导
  relayWsUrl=`ws(s)://host/ws`、remotePageUrl=`{base}/m/index.html`（自建手机页）；
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
