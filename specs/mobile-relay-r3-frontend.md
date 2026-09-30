# R3 路线 A：自建官方级移动前端（完整对齐方案）

状态：**P0/P1 部分已实施；本轮先交付独立、离线的 3.14.3 兼容资产包**。上游依据 = `specs/mobile-relay-server.md`（R1/R2/协议对齐/
资产托管，§11 分歧矩阵已清零）+ `specs/mobile-web-remote.md`（M4/M4c 桌面侧桥全貌与
原版证据索引）+ 2026-09-29 实机取证（内置浏览器 414×896 / 1280×720 双视口抓取官方
活页 DOM/截图，产物 `.tmp-work/official-live-*.html`）。

## 0. 为什么现在做、以什么为对齐基线

本轮之前，LAN/自建 relay 的手机页默认走**官方资产代理**（cache→fetch z.ai→R2 兜底，
`desktopMobileLanRelayHost.ts`）；D7 已将 LAN 与同仓 relay CLI 的默认入口改为本地快照。
旧形态三处硬伤：①依赖官方源站在线与资产布局稳定；
②`wss://zcode.z.ai/ws` 字面量改写脆弱（§12.5 二次实测教训，浏览器内存缓存还要求破
缓存）；③官方页含账号/营销/WAF 验证码面（`zcode-aliyun-captcha-container`），非我方可
控。§12.5–12.8 双栈对比已证明**官方页可完整跑在我们的栈上**（配对/引导/桥/九深服务面
逐字节同构）——即桌面侧与 relay 侧的 v4 服务面已经就绪；D7 提供可离线托管的冻结页，
后续 P2–P4 仍需替换成自有源码前端。
R3 路线 A 定案（82 轮）：复用 `@drora/ui` 组件树 + 既有 rpc 桥，v4 数据原生零转换。

对齐基线 = 官方 3.14.3 页行为快照（`packages/mobile-web/upstream/` 冻结资产 +
`official-live-*.html` 实机 DOM + 双栈对比方法论）。官方页后续演进不跟随，分歧记录于本 spec。

## 1. 目标与非目标

**目标**

- G1 **自有移动前端**：`@drora/ui` 共享组件树 + 移动壳，产物由 relay-server 托管于
  `/remote/v4`，同源直连自建 relay（零改写、离线可用），替换官方资产代理为默认。
- G2 **双布局同一构建**：窄视口（<900px）移动单列壳，宽视口（≥900px）完整应用壳——
  对齐官方同构建双布局（§12.8 实测）。
- G3 **v4 数据面原生**：手机侧直接说 rpc-frame（bootstrap/bridge-open/rpc-frame 全
  族），不经过 `drora-page-request` v1 翻译层；时间线/工具卡/composer 为真实组件流式
  渲染，非文本投影。
- G4 **状态面逐项对齐**：四步加载卡、11 张失败卡、重连/挂起/宽限期语义（§2 清单）。
- G5 **契约单一出处**：relay 线协议纯逻辑（HMAC proof、帧组装/checksum、水位常量）
  收敛到 shared，桌面/relay-server/手机端三方同源。

**非目标**

- 不复刻官方账号绑定、营销触点、插件资产 CDN（`cdn-zcode.z.ai`）与 WAF 验证码面。
- 不做 PWA/离线缓存/推送通知（后续可选立项）。
- 不改 relay 服务端职责边界（纯转发，业务真相源仍在桌面 Host——AGENTS.md 不变量）。
- 桌面 Electron 与 `packages/web` 主入口（HTTP+WS 连 server 的形态）本轮不改布局；
  移动壳按能力位（capability）门控，桌面主入口默认不启用（有意保守，见 D1）。

## 2. 对齐清单（实机取证定案，验收对照表）

**过渡状态机（手机侧，对齐官方 RelaySession）**

| 状态           | 进入                                                                | 退出                                  | 我方落点                     |
| -------------- | ------------------------------------------------------------------- | ------------------------------------- | ---------------------------- |
| idle           | 初始                                                                | connect()                             | relay-client                 |
| connecting     | connect()                                                           | ws open→authenticating                | relay-client                 |
| authenticating | ws open，发 auth_init{role:"terminal"}                              | challenge→proof→auth_ack              | relay-client                 |
| waiting        | 鉴权过、未配对                                                      | paired / 陈旧恢复 / kicked            | relay-client + 四步卡第 3 步 |
| paired         | auth_ack{matched}                                                   | 断线→reconnecting                     | relay-client                 |
| reconnecting   | socket 断/健康检查失败/手动（指数退避 500ms×2ⁿ 封顶 10s，4 触发点） | 重连成功/终态                         | relay-client                 |
| suspended      | 页面隐藏/失活（15s recoverConnection 窗）                           | 恢复/超时→connection-recovery-timeout | relay-client                 |
| kicked         | error{KICKED}                                                       | 终态                                  | 失败卡 session-conflict      |
| error          | 非接管类故障                                                        | 可重试                                | 失败卡按 code                |

**宽限期而非立即判死**：DEVICE_OFFLINE → `desktopOfflineFailureTimer` 宽限 → 超时才
终态卡 desktop-disconnected；bootstrap 无应答 → desktop-bootstrap-timeout（描述文案
"手机端已经连上 relay，但桌面端没有及时返回工作区数据。"）。

**四步加载卡**（官方实机确认存在，R2 已逐字对齐）：1 连接中转服务 / 2 设备鉴权 /
3 等待桌面端配对 / 4 同步工作区；标题态含「已配对，正在加载工作区…」。

**11 张失败卡**（badge/title/tone/nextSteps 对齐，R2 已验证文案可直接移植）：
session-not-found / session-expired / session-conflict（已被其他设备接管）/
workspace-closed / desktop-disconnected / invalid-mobile-connection /
desktop-bootstrap-timeout / connection-recovery-timeout / relay-unavailable /
unsupported-action / unexpected-error。

**移动首页**：连接徽章（已连接到当前桌面窗口/未连接）、说明段、主题按钮、命令面板
入口、「当前设备上的工作区和任务」标题 + N 工作区 · N 任务、收起全部/整理任务/刷新、
工作区分组折叠列表（名称/本地·远程标记/路径/更新于/任务数）、任务行（标题/相对时间/
状态 pill：运行中·已完成）。

**移动会话面**：返回首页、任务标题、更多菜单、状态侧板（后台任务 pill）、富时间线
（思考块含持续时长、工具卡可展开——查阅/终端/读取及参数摘要、markdown 含代码块与
表格、复制/分叉/撤销/赞踩、文件变更统计）、**完整 composer**（排队语义占位「继续输入
以排队后续修改」、添加上下文、切换模式、模型选择器、推理档、上下文用量表、停止生成）。

**宽视口全壳**（≥900px）：侧栏（新建任务/搜索/插件市场/项目树+任务数/用户页脚）+
主区问候空态/完整 composer/快捷操作——即桌面 `Root` 树原样可用。

**深服务九面**（§12.8 已双栈验证的清单作为回归集）：新建任务全壳、模型选择器（活
数据）、优先级菜单、变更前确认、搜索命令面板（tabs+最近+建议）、插件市场、富时间线、
任务头更多、KICKED 卡。

## 3. 总体架构

```
手机浏览器（自建移动前端，/remote/v4）
  React 19 + @drora/ui 共享树（移动壳 ⇄ 宽视口全壳，capability 门控）
  ├─ relay-client（新模块）：RelaySession(terminal) + RpcFrameBridge + 诊断事件
  │    WSS 同源 /ws?mid=…（零改写）
  ├─ RelayRemotePlatform：IPlatformService ←→ platform-request 应用帧（8 方法，M4a 已对齐）
  └─ v4 会话 RPC：rpc-frame 直驱（bootstrap → workspace-bridge-open → conversation 流）
        │
自建 relay（packages/relay-server，不改业务边界）
        │  device 侧既有链路
桌面 Main：desktopMobileRelayControl（M4c 流控/重放/背压已接线）
  └─ Host attachment（web-remote-replayable 语义）→ 桌面 Host（唯一业务真相源）
```

**所有者划分（不变量沿用）**：连接/配对状态=relay 服务端；设备凭据=relay 持久层；
业务数据=桌面 Host；手机侧 UI 局部状态（草稿/pending overlay）不得当作服务端事实；
busy/running 输入仍由 CLI/runtime CommandInbox 串行 admission（composer 排队语义的
数据来源）。

## 4. 模块决策（D1–D5）

- **D1 移动壳放 packages/ui，capability 门控**：新增 `packages/ui/src/mobile/`
  （MobileHomeShell / MobileTaskShell / 状态卡族 / mobileShell i18n 命名空间）。壳
  选择在 RootShell 层按「远程移动能力位 + 视口 <900px」分支；桌面与 web 主入口不设
  该能力位 → 行为零变化。新断点常量 `REMOTE_SHELL_VIEWPORT_QUERY`（width<900px），
  与既有 `MOBILE_VIEWPORT_QUERY`（767px+触屏，交互微调用）并存不合并；顺手收敛
  `v4/SessionPane.tsx:496` 的重复定义。
- **D2 线协议收敛 shared，三方同源**：纯逻辑（computeProof/信封校验/帧组装+checksum
  hex/ordinal/MTU 探测/水位与 grace 常量）提为 `packages/shared` 的 relay-wire 区
  （或独立小包 `relay-protocol`，P0 按架构检查建议定）。消费方：desktop（现
  desktopMobileRelayProtocol.ts 改引用）、relay-server（protocol.ts 对应面）、新
  relay-client。R2 页内嵌 HMAC 实现迁移后删除，RFC 4231+node:crypto 交叉单测随迁。
  线协议字面量（`zcode_type` 等）是官方兼容键，**保持原名不 Drora 化**（互操作必需，
  对照 mobile-web-remote.md 既有定案）。
- **D3 relay-client 新模块**（`packages/relay-client`，浏览器环境，注册
  architecture-policy.yaml，managed:false，依赖 shared）：RelaySession（terminal 角色
  全状态机+心跳 pair*status_query+重连退避+suspended 恢复+desktopOffline 宽限）、
  RpcFrameBridge（组装/ack/重放缓冲客户端侧，常量同源）、emitDiagnostic 7 类事件
  （state-transition/pair-status/recover-*/socket-\_）。
- **D4 远程入口 = 独立 mobile-web 包**：本轮按 D7 先在
  `packages/mobile-web/upstream` 封装 3.14.3 原版页面与动态资产；后续源码化时，
  在同包新增 React 入口，复用 `packages/ui` 的移动壳与 `relay-client`，不改
  `packages/web` 主入口。产物保持 `<out>/remote/v4/<version>/assets/*` 的官方路径形状，
  **不做版本门控**（同仓发布天然配套）。relay-server 的 `mobileRoot` 托管优先级为
  staticRoot 测试床 > 本地 mobile-web > cacheDir 官方代理 > R2 兜底 302。
  冻结快照仍需由 relay-server 出站改写 WebSocket 端点；未来源码入口直接使用同源 `/ws`。
- **D5 R2 页与 v1 桥保留为兜底层**：离线/资产缺失 302 → `/m/index.html` 链路不变；
  `drora-page-request` v1 桥（serveMobilePageAction）只为 R2 兜底页服务，R3 验收后
  不再演进（退役另立决策）。

## 5. 实施分期与验收

| 期  | 内容                                                                                                                                               | 验收                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P0  | 本 spec 评审定案；架构登记（relay-client/mobile 边界）；契约键与常量盘点（全链 grep 生产/消费）                                                    | architecture:check 过；无孤儿键                                                        |
| P1  | wire 层收敛 shared + relay-client TS 落地；单测（HMAC/组装/checksum/水位对齐官方常量；官方偏移证据随注）                                           | 对 embedded relay 的终端全状态 conformance（waiting/paired/踢/离线/宽限/重连）         |
| P2  | packages/ui 移动壳 MVP（首页+会话面+四步卡+失败卡族）+ remote 入口可构建可跑                                                                       | LAN 真机扫码全流程；与官方页双栈截图对比：首页+时间线两面 SHA 一致（时间戳类差异除外） |
| P3  | 富面：composer 全功能（排队/上下文/模式/模型/用量/停止）、工具卡/代码/表格流式渲染、命令面板、主题、整理任务                                       | §2 九深服务面逐面双栈对比同构；11 失败卡+KICKED 逐字节                                 |
| P4  | 健壮性：断网/杀桌面/二终端踢端到端（重放不丢不重）、mobile-diagnostic+遥测上报、构建性能（分包，避免官方 6.2MB 单文件教训）                        | E2E 全场景 + 真机弱网手测；首屏 <官方基线                                              |
| P5  | 切换：LAN QR 默认 → 自建页（`desktopMobileLanRelayHost` 端点翻转）；官方资产代理降级为测试床选项；spec/文档/技能引用清理；DESIGN.md 补移动壳规范段 | 离线装机冷启动可用（不触外网）；`pnpm verify:pre-push` 全绿                            |

每期收口必须：`pnpm typecheck` + `pnpm lint` 真实结果、架构检查、行为改动配测试、
交互改动配 E2E；双栈对比沿用 `.tmp-work` 既有方法论（同视口截图 SHA-256 + DOM 落盘）。

## 6. 风险与对策

- **ui 组件桌面假设**（窗口控制/多窗口/更新器等）：web 主入口已有 no-op platform
  先例，RelayRemotePlatform 按能力位降级；发现组件硬依赖桌面能力时在 hooks 层加能力
  分支，不在组件里散落 if。
- **v4 schema 漂移**（session/messages 教训）：协议边界 schema 校验为准，漂移修复先
  补 spec 再动代码；对齐基线冻结 3.14.3，新增官方能力不自动跟随。
- **宽视口全壳体积**：全树可用但按路由懒加载；官方单文件 6.2MB 是反面教材。
- **双传输互斥**：弹层切 tab 即切链路（§12.4 既有收敛），R3 不改变。
- **凭据安全**：QR 仍是 sid+hash 长期凭据，刷新即轮换；页面不缓存凭据到
  localStorage 之外的位置（官方 sessionStorage 快照仅主题/壳态，照做）。

## 7. 有意分歧记录（审查对照用）

| #   | 分歧                                               | 理由                                                                         |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | 无版本门控/版本资产库                              | 同仓发布，页面与桌面配套演进（§7 既有决策沿用）                              |
| 2   | 无账号/营销/验证码面                               | 私有部署不需要；WAF 面属官方基础设施                                         |
| 3   | 端点同源推导，无 z.ai 硬编码改写                   | 自建页天然同源；官方镜像测试床保留改写逻辑                                   |
| 4   | error.message 空串（对齐）但服务端日志保留诊断细节 | §12.6 既有定案                                                               |
| 5   | 桌面/web 主入口暂不启用移动壳                      | 保守切换，待 R3 稳定后另议（届时 packages/web 手机访问即可免费获得移动布局） |
| 6   | 鉴权 challenge/ack 监督 10s                        | 官方无此定时器，本仓自加强化，relay-server 容忍                              |
| 7   | suspended 恢复取 15s 平窗 + 3s 健康检查简化        | 官方 recoverConnection 同构语义                                              |
| 8   | INTERNAL 处理 = paired 回 waiting / 否则立即重连   | 对齐官方                                                                     |
| 9   | DEVICE_OFFLINE 保持原 socket + 宽限重挂            | vs 官方关 socket + 立即重连（终态等价）                                      |
| 10  | 配对心跳首条 query 立即发送                        | 官方先等一个 interval                                                        |
| 11  | auth_init 不带官方 meta{platform, version, name}   | 服务端不校验                                                                 |

## 8. 契约键与常量盘点（P0 产出，2026-09-29 全链 grep）

范围 = `packages/desktop`、`packages/relay-server`、`packages/shared` 非 test src。
行号基线 = 当日工作树。relay-server 对 data `payload` 纯转发不解析（`relayServer.ts:396`
仅 matched 双向转发 + 盖章），故其在表中只出现在信封/HMAC/错误码面；`zcode_type`
的生产/消费全部落在桌面两端与手机端。

### 8.1 `zcode_type` 线协议字面量（任务点名 12 值 + 同族补全）

| 字面量                       | 桌面生产                                  | 桌面消费                                                                       | 手机端                              | 单一出处判定                             | R3 收敛 shared 后消费方       |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------- | ----------------------------- |
| rpc-frame                    | `desktopMobileRelayProtocol.ts:397`       | 同文件 :312（类型）/:785（parse）、`desktopMobileRelayControl.ts:1440`（分派） | relay-client 生产（R3）；官方页生产 | 散点字面量、两端各一处（未收敛，非重复） | desktop、relay-client、移动壳 |
| rpc-frame-ack                | `desktopMobileRelayProtocol.ts:418`       | `desktopMobileRelayControl.ts:1443`                                            | relay-client 消费（ack 驱动流控）   | 同上                                     | 同上                          |
| bootstrap-request            | —                                         | `desktopMobileRelayControl.ts:1278`                                            | relay-client 生产                   | 同上                                     | 同上                          |
| bootstrap-response           | `desktopMobileRelayControl.ts:1282/:1291` | :566（重放入选/日志分支）                                                      | relay-client 消费                   | 同上                                     | 同上                          |
| workspace-bridge-open        | —                                         | `desktopMobileRelayControl.ts:1432`                                            | relay-client 生产                   | 同上                                     | 同上                          |
| workspace-list-request       | —                                         | `desktopMobileRelayControl.ts:1307`                                            | relay-client 生产                   | 同上                                     | 同上                          |
| workspace-list-response      | `desktopMobileRelayControl.ts:1311/:1320` | :567（日志分支）                                                               | relay-client 消费                   | 同上                                     | 同上                          |
| workspace-reconnect-request  | —                                         | `desktopMobileRelayControl.ts:1436`                                            | relay-client 生产                   | 同上                                     | 同上                          |
| workspace-reconnect-response | `desktopMobileRelayControl.ts:1144/:1151` | —                                                                              | relay-client 消费                   | 同上                                     | 同上                          |
| mobile-view-state-update     | —                                         | `desktopMobileRelayControl.ts:1418`（:256 注释）                               | 移动壳生产                          | 同上                                     | 同上                          |
| mobile-diagnostic            | —                                         | `desktopMobileRelayControl.ts:1462`；白名单 :1273                              | 移动壳/relay-client 生产            | 同上                                     | 同上                          |
| telemetry-report             | —                                         | `desktopMobileRelayControl.ts:1447`；白名单 :1273                              | 同上                                | 同上                                     | 同上                          |

同族补全（盘点发现，R3 契约一并登记）：`platform-request`（消费 :1476，RelayRemotePlatform
生产）、`platform-response`（生产 :1486/:1496）、`workspace-list-updated`（桌面主动推送，
生产 :658）、`workspace-bridge-ready`（生产 :1085）、`workspace-bridge-error`（生产 :901）。
v1 桥 `drora-page-request`/`drora-page-response` 属 R2 兜底面（D5 不演进）：`phonePage.ts:332/:354`、
`desktopMobileRelayControl.ts:1340/:1356/:1400/:1407`。

特例：`packages/shared/src/drora-protocol-v4/wire-codec.ts:60` 出现 `drora_type:"rpc-frame"`——
仅 `measureTopicNotificationEnvelopeBytes` 最坏情形字节计量（与 `zcode_type` 等长，测量等价），
**非线上生产/消费**；收敛时保留该口径注释，防止被误读为第二命名空间。

### 8.2 data 信封字段与字符集约束

| 字段                                    | 生产                                                                                               | 校验/消费                                                                                                                                  | 单一出处判定                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `client_ts`                             | `desktopMobileRelayControl.ts:549`（出站统一；另 :1541/:1684/:1736）、`phonePage.ts:302/:307/:353` | `relay-server/src/protocol.ts:74/:84`（isDataEnvelope，`typeof number`，无有限性检查）、转发透传 `relayServer.ts:409`                      | 校验单点（protocol.ts）；生产散点          |
| `server_ts`                             | `relay-server/src/wire.ts:8/:39`（出站统一盖）、`protocol.ts:89-93`（stampServerTs）               | 官方手机页 schema 消费；时钟不参与我方语义                                                                                                 | 单点                                       |
| `payload`                               | 各端应用帧                                                                                         | `protocol.ts:73`（`Record<string,unknown>`），转发不解析                                                                                   | 单点                                       |
| `bridgeSessionId`（rpc 帧内层传输标识） | `desktopMobileRelayProtocol.ts:348/:697`                                                           | 匹配校验 :434/:786（仅 `typeof string`）；字符集约束 = `relay-server/src/protocol.ts:14` `TRANSPORT_ID_PATTERN /^[A-Za-z0-9._~-]{1,64}$/u` | 格式定义单点，但**声明未强制**（见 8.6-5） |

信封语义注释（真机取证）：`desktopMobileRelayControl.ts:546-548`——缺 `client_ts` 裸帧被
WRONG_PARAM 拒收；有 `type` 缺 `client_ts` 被接受但静默不转发（2026-09-27 实锤）。
`TRANSPORT_ID_PATTERN` 当前仅定义 + 导出（`protocol.ts:14`、`index.ts:6`），relay-server src
内无任何消费方，桌面侧只查字符串类型——字符集约束实际未在链路上强制。
另注：shared v4 家族 `drora-protocol-v4/core.ts:71` `transportEnvelopeIdMaxChars: 256` 与 relay
家族 64 上限**同概念不同值**（wire-codec.ts:56 计量按 256 取最坏，保守成立）——两族各自成立，
收敛时不得互改。

### 8.3 流控常量（官方常量表 @6729 取证）

| 值             | 常量                                     | 定义处                              | 引用处                                                                               | 判定 |
| -------------- | ---------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ | ---- |
| 1MiB（水位）   | `RELAY_SATURATION_HIGH_WATER_MARK_BYTES` | `desktopMobileRelayProtocol.ts:491` | :564（ReplayBuffer 构造）                                                            | 单点 |
| 256KiB（水位） | `RELAY_SATURATION_LOW_WATER_MARK_BYTES`  | `desktopMobileRelayProtocol.ts:493` | :565                                                                                 | 单点 |
| 8MiB           | `RELAY_REPLAY_BUFFER_MAX_BYTES`          | `desktopMobileRelayProtocol.ts:495` | :566                                                                                 | 单点 |
| 45s            | `RELAY_REPLAY_BUFFER_GRACE_MS`           | `desktopMobileRelayProtocol.ts:497` | :567；间接 `desktopMobileRelayControl.ts:828`（degraded 延迟）、:1073-1076（注入口） | 单点 |

同值 1MiB 的**其他定义**（官方 `maxPhysicalFrameBytes` 源，语义不同、数值相同）：relay-server
`protocol.ts:7` `MAX_WS_PAYLOAD_BYTES`（入站 WS 硬上限，消费 `relayServer.ts:80`，超限 ws 库断开）；desktop
`desktopMobileRelayControl.ts:206` `MAX_APP_FRAME_BYTES`（出站应用帧 oversize 拒收，消费 :553）。
注释引用：`desktopMobileRelayProtocol.ts:298/:302`（消息 ≤16MiB、分片 ≤64、dataBase64 ≤1MiB、
单分片 640KiB 预算 :303）、`desktopMobileRelayControl.ts:189/:199/:204/:554`。shared v4 家族
`drora-protocol-v4/core.ts:65` `maxFrameBytes: 1024*1024` 同值不同源（另一协议），不并入收敛。
R3 消费方：relay-client（发送侧水位/重放/分片预算，常量同源）+ desktop/relay-server 改引用。

### 8.4 HMAC proof 构造格式串

`proof = HMAC-SHA256(passHash, "<nonce>|<role>|<deviceSid>", base64url)`——**三处定义（8.6-1）**：

1. `relay-server/src/protocol.ts:26-36` `computeProof`（canonical；:42-56 `verifyProof`
   timingSafeEqual + base64url/base64 双兼容）。
2. `desktop/src/main/desktopMobileRelayProtocol.ts:81-90` `calculateRelayProof`
   （`` `${nonce}|${role}|${sessionId}` ``）。
3. `relay-server/src/phonePage.ts:95-96`（R2 页内嵌纯 JS HMAC-SHA256
   `PHONE_PAGE_CRYPTO_JS` :8-96，role 硬编码 `"terminal"`；D2 定案迁移后删除）。

`derivePassHash`（sha256→base64）仅 `desktopMobileRelayProtocol.ts:77-79` 一处。
R3：收敛 shared（D2），relay-client 浏览器端用 WebCrypto；RFC 4231 + node:crypto 交叉单测随迁（§5 P1 验收）。

### 8.5 错误码族

定义单点：`relay-server/src/relayServer.ts:70-76` `ERROR_CODES`（authFailed/wrongParam/kicked/
deviceOffline/internal）→ 消费 :182/:187（deviceOffline 终端方向）、:220/:248/:251/:278/:295/:318/:381（wrongParam）、
:324（authFailed）、:352/:356（kicked）。
字面量在消费方重复硬编码（8.6-2）：desktop `desktopMobileRelayControl.ts:1610`（KICKED→kicked 重连）、
:1623（AUTH_FAILED persisted 重注册）、:1635（WRONG_PARAM paired/waiting 噪音容忍）、:1652（INTERNAL 可恢复重连）；
R2 页 `phonePage.ts:322-324`（KICKED/DEVICE_OFFLINE/AUTH_FAILED/WRONG_PARAM → 失败卡）。
R3 消费方：relay-client 错误分派状态机（§2 状态表）+ 移动壳失败卡映射（KICKED→session-conflict、
DEVICE_OFFLINE→desktop-disconnected 宽限、AUTH_FAILED/WRONG_PARAM→鉴权失败面）。

### 8.6 重复定义清单（P1 收敛工作清单）

1. **HMAC proof 格式串 ×3**：8.4 全列——收敛 shared 后 desktop/phonePage 两处删除，relay-client 用 shared 形状。
2. **错误码字面量 ×3 处**：relay-server `ERROR_CODES` + desktop 4 字面量 + phonePage 4 字面量——收敛 shared 常量族。
3. **1MiB relay 家族 ×2 + 水位 1 处**：`MAX_WS_PAYLOAD_BYTES`（relay-server）与 `MAX_APP_FRAME_BYTES`（desktop）
   同源官方 `maxPhysicalFrameBytes`，收敛 shared 单常量；`RELAY_SATURATION_HIGH_WATER_MARK_BYTES` 官方独立常量
   （恰好同值），单独登记不合并。v4 家族 `maxFrameBytes` 不动。
4. **crc32→8 位小写 hex ×2 套实现**：desktop `desktopMobileRelayProtocol.ts:326-341`（CRC32_TABLE + crc32）、
   :363（crc32ToWire）与 shared `drora-protocol-v4/wire-binary.ts:10-17`（crc32WireBytes）——同 IEEE crc32 同
   hex 口径、两套实现；收敛 relay 家族那份到 shared（wire 纯逻辑区），v4 家族不动。
5. **`TRANSPORT_ID_PATTERN` 声明未强制**：`relay-server/src/protocol.ts:14` 定义、`index.ts:6` 导出、src 零消费；
   收敛 shared 后由 relay 入站校验、桌面出站构造、relay-client 生成三方共同消费补齐强制点。

非 `zcode_type` 的 relay 帧 `type` 字面量（auth_init/auth_challenge/auth_response/auth_ack/
pair_result/pair_status_query/data/error）同属线协议家族，P1 wire 区登记时一并收编；本节不展开。

## 9. 2026-09-29 本地 3.14.3 页面快照交付（D7）

本轮用户要求独立包、完整 PC/手机页面和局域网自建服务。当前检出中的
`relay-client` 只有 port/type/clock，`packages/ui/src/mobile` 只有展示壳，尚不能
原生驱动完整官方 v4 RPC 服务面。先把已经取证的官方 3.14.3 页面字节封装为
`packages/mobile-web/upstream/remote/v4`，独立构建到 `dist/remote/v4`，由自建
`relay-server` 同源托管。此快照是有来源标记的还原资产，不能混入自研源码；
`packages/web` 主入口保持独立。后续源码化替换仍按 D1–D5 分期。

**产品规则**：`/remote/v4` 与官方 QR 六参数形状一致；窄视口和宽视口都由同一
3.14.3 构建负责。LAN 内嵌 relay 优先读取打包在本地的 mobile-web 资产；自建云
relay 的 CLI 默认读取同包 `upstream/`，部署时可用 `--mobile-dir` 指向构建产物。
只在本地包不可用且启用兼容代理时向官方拉资产；本地
入口资产缺失时继续沿现有 `/m/index.html` 兜底，其他缺失资产 404；本地包存在
时不向官方拉取资源。页面 WS 端点由既有
`staticAssets.ts` 出站重写为当前 host 的 `/ws`，不得回连官方 relay。

**所有者与接口**：桌面 Host 仍拥有任务、会话和消息；relay-server 只拥有连接、
配对和静态资产路由；mobile-web 只拥有不可变页面资产。`mobileRoot` 是静态
根路径注入，不引入第二条业务写入路径。官方快照不做源码内修改；自建接入通过
现有 relay-server 的 JS 出站重写实现。

```text
desktop Host (业务状态) ← attachment → device WS ─┐
                                                  relay-server ── terminal WS → 页面
mobile-web/dist (不可变资产) ───── GET /remote/v4 ──┘
                                                /ws?mid → 挑战 → 配对 → bootstrap → rpc-frame
```

**验收**：①无外网时 `/remote/v4`、其版本资产都返回本地字节；②页面 JS 出站
不包含官方 relay 的硬编码 WS URL；③带 QR 参数入口正常加载 PC/手机布局；
④保留 `staticRoot` 测试床优先级、防穿越与 R2 兜底；⑤ LAN QR 指向自建 relay
本地页面；⑥ `pnpm typecheck`、`pnpm lint`、架构检查与 relay 集成测试均运行。

**迁移边界**：本交付实现离线可加载的官方 3.14.3 页面快照，保留该版 UI 与浏览器
运行时代码；真桌面配对与只读操作已验证，消息写入、弱网和失败恢复仍须 E2E 验收。它不是
独立编写的 React UI 源码。后续若需要脱离官方资产的可维护实现，按上文 P2–P4
将共享 UI 和 relay-client 逐面替换，不能把二进制快照视作已完成源码化。

**独立 Electron + CDP 实测（2026-09-29）**：使用独立应用身份及 Electron
userData/sessionData 运行本仓，与正在使用的 Drora Dev 窗口分离；默认工作区数据库
仍可见，因此仅对现有任务做只读验证。修复弹层 idle 自动开启后，二维码自动
生成；内置浏览器经该二维码完成鉴权、配对、bootstrap、工作区桥接，桌面弹层显示
“手机已连接”。414px 视口出现移动工作区首页，展开工作区并打开现有任务后，时间线
与完整 composer 均加载；1280px 视口出现 PC 侧栏与同一任务会话；刷新入口后恢复
到任务会话。此轮没有向现有任务发送新消息，也未覆盖弱网、踢端和全部失败卡。

### 2026-09-29 入口还原错误修正

本地隔离 Electron + CDP 配对后确认 PC 全壳、手机首页与任务会话均由真实 Host
响应。核对静态入口时发现，最初从 `.tmp-work/official-page/remote/v4/index.html`
复制的文件曾为诊断临时插入 `window.__wsLog` 和 `?v=selfhost2`。这不是原版行为，
只能作为还原错误修正：官方 `https://zcode.z.ai/remote/v4?app_version=3.14.3`
返回的入口 HTML 在字节偏移 **10646** 为
`<script type="module" crossorigin src="/remote/v4/3.14.3/assets/index-NjWRUABD.js">`；
本仓旧快照在字节偏移 **10655** 含 `window.__wsLog`，并把同一 `src` 改成
`index-NjWRUABD.js?v=selfhost2`。替换为原版入口字节后，端点改写仍只发生在
relay-server 的 JS 出站路径。资产检查应拒绝这两个诊断标记。

### 2026-09-29 发行资产源码恢复取证

官方公开仓库 `zai-org/ZCode` 的 `v3.14.3` tag 指向
`29628c9acdb81b703bbd4080c207a0e7ce5e276e`；GitHub 完整 tree（7458 项，
`truncated=false`）中没有 `remote/v4`、`mobile-web` 或 `relay-client` 源码。
本地 3.14.3 快照中的 2488 个 JS 文件均无 `sourceMappingURL`；源站主入口
`/remote/v4/3.14.3/assets/index-NjWRUABD.js.map` 返回 HTTP 404。因此不能声称从
发行文件精确恢复官方原始 TSX、模块边界或标识符。任何格式化的 bundle 都应标为
“由发行资产恢复的可读 JS”，保留 `upstream/` 原始字节作为对照；自研 React/TypeScript
实现则按 P2–P4 接入现有共享 UI 和 relay 协议，不与还原资产混放。

**本轮恢复规则**：`mobile-web/src/recovered/remote/v4` 保存从冻结快照格式化的可读
HTML/JS/CSS 和原样复制的字体、图片、WASM；文件名与相对引用保持 3.14.3 原样，
以免破坏动态 import、预加载图和 wasm 定位。构建只从该目录复制到 `dist`；开发态
LAN 与 relay CLI 直接读取该目录，桌面打包读取同目录。`upstream/` 保留为逐字节
证据，不再作运行时默认入口。relay-server 继续拥有鉴权、配对和静态路由；手机页只
拥有浏览器 UI 与局部状态；Host 继续拥有任务和会话。WS 出站同源改写仍由
relay-server 执行，恢复阶段不另建连接实现。

验收：①恢复目录资源图闭合，文件数与上游快照一致；②构建输出与恢复目录逐文件
相同；③ JS/CSS 可解析，页面在 LAN 真配对后能进入手机与 PC 布局；④
`upstream/` 哈希不变；⑤ `typecheck`、`lint`、架构检查和相关测试真实运行。
可读恢复稿仍含编译后的 React runtime 与短标识符，不等同于 P2–P4 的可维护
React/TypeScript 重写。

首次恢复工具验证发现 9 个高度压缩 chunk 在 `oxfmt` 第一遍展开后还需第二遍才能
稳定（包括主入口 JS 与主 CSS）；恢复脚本固定执行两遍，并以 `oxfmt --check` 验证。
独立 Electron + CDP 真配对回归：414×896 视口进入移动工作区首页，1280×896
视口进入 PC 全壳；两次页面运行的 uncaught `pageerror` 均为 0。此验证覆盖入口、
配对、bootstrap 与双布局，没有重新测试消息发送和弱网恢复。

## 10. 2026-09-29 官方源码可得性终版调查（源码化前置确认）

对本轮"把 mobile-web 从静态发行资产推进为可维护源码包"的前置问题——官方是否公开
3.14.3 远控页源码或 sourcemap——做了终版取证（GitHub API + CDN 实测 + 本地克隆
`.tmp-work/zai-upstream` 比对）：

| #   | 证据                                                                                                                                                                  | 结论                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | `zai-org/ZCode` 公开仓（Apache-2.0）`v3.14.3` tag → `29628c9`，完整 tree 7458 项无 `remote/v4`/`mobile-web`/`relay-client` 源码；GitHub 代码搜索 `"remote/v4"` 0 命中 | 远控页部署变体源码不在公开仓                         |
| 2   | 公开版 `packages/web/src/main.tsx` `connectRemote()` 直接抛 `"Remote connect is not supported in Web mode yet"`                                                       | Web 端远控连接实现在公开入口被显式禁用，未随源码发布 |
| 3   | 官方 `packages/web/vite.config.ts` 生产构建 `sourcemap: "hidden"`，注释明言"生产不在浏览器产物暴露 sourceMappingURL，避免客户端侧还原业务源码"                        | 官方有意不发布 sourcemap                             |
| 4   | CDN 实测 `zcode.z.ai/remote/v4/3.14.3/assets/` 下 6/6 个 `.js.map`/`.css.map` 全部 404（对照同源真实资产 200）；全部发行 JS 尾部无 `sourceMappingURL` 注释            | sourcemap 不可得，非探测方式问题                     |
| 5   | 部署入口 HTML 与 `BASE_URL=/remote/v4/3.14.3/` 构建配置不在公开仓；公开 `packages/web`+`packages/ui` 与部署页**同族但非同构**                                         | 公开源码骨架可作语义参照，不可作字节来源             |

**结论：源码化唯一可行路径 = 自研实现。** `upstream/` 冻结快照保留为对照证据；
任何"从官方源码/sourcemap 恢复"的路线不可行，后续不再复查此前提（除非官方
release 显式变更源码披露范围）。

## 11. D6（补录 103–109 轮用户裁定）：ui+desktop 冻结、移动 UI 自包含

此前 103–109 轮的实现未及落入本 spec 即因未提交丢失（见 §12 背景），现按工作树
证据与用户裁定补录：

- **`packages/ui` 与 `packages/desktop` 冻结**：R3 期间不为移动页改动这两包；
  `packages/ui/src/mobile/` 的展示壳（MobileHomeShell/MobileTaskShell/StatusCards，
  D1 产物）就地冻结，仅作自包含化的移植参照。
- **移动 UI 全自包含**：手机页 UI 组件与文案全部落在 `@drora/mobile-web`
  （`src/ui/`、`src/intl/`），不 import `@drora/ui`；i18n 在包内本地化
  （zh-CN/en-US 字典同构校验）。
- 桌面 LAN host 的本地快照默认（`desktopMobileLanRelayHost.ts` 读
  `src/recovered`）在冻结期内不动；桌面侧切换源码入口归 P5 端点翻转一并处理。

## 12. D8（本轮决策）：数据层复用 rpc/client/services 公开入口，UI 自包含不变

**背景**：103–109 轮曾按"全自研 19 帧链 + 全量页面复刻"路线实现（relay-client
21 模块 + `mobile-web/src/ui` 全量页面），未提交即丢失——现树仅存
`relay-client/dist` 编译残留（sourcemap 无 `sourcesContent`，原始 TS 不可还原）与
空的 `src/ui`/`src/intl` 目录。重写评估：v4 服务面（`drora-protocol-v4` 全族 zod
schema + 服务描述符 + 会话/工作流订阅语义）自研复刻成本不可控，且与 renderer
服务面漂移风险高；官方页 bundle 6.2MB 单文件正是把整棵服务/组件树编译进页面的
结果，逐字节复刻它不符合"可维护"目标。

**决策**：

- **数据层复用公开入口**（方向 `mobile-web → relay-client → shared`；
  `mobile-web → rpc/client/services`）：桥端口即 Host 服务面（与 renderer 同源，
  `RemoteServiceAccess` 的服务描述符族），移动端不重写 v4 协议栈。
- **桥内载荷复用 MessagePort 语义**：rpc-frame 重组后的消息字节 = ChannelClient
  序列化字节（裸 `Uint8Array`，无附加分帧——`MessagePortProtocol` 同构，桌面 main
  `bridge.port.postMessage(Buffer)` 直传）。移动端以自定义 `IMessagePassingProtocol`
  适配 relay-client 的 rpc-frame 通道，经 `@drora/client` 的
  `connectViaProtocol` 获得 `IServiceAccessor`。
- **UI 全自包含不变（D6）**：`src/ui` + `src/intl` 自持；ui 展示壳仅作参照。
- **首页数据面不走服务**：bootstrap/workspace-list 走 relay 应用帧
  （`zcode_type` 族，桌面 `handleAppFrame` 已实现），任务面走桥内服务（实现事实：
  任务面读路径 = 桥内 droraAgentService.hello/initialize 握手 +
  conversationRowsRangeV4 尾窗行分页；写路径 = sendConversationCommandV4(sendText)；
  P3 流式订阅面仍归后续期）——两面的所有者边界与官方一致（relay 应用帧=连接/投影层，
  服务面=业务层）。
- **桌面冻结不变（D6）**：desktop LAN host 与打包在冻结期内继续用
  `src/recovered` 快照；独立 relay CLI `--mobile-dir` 语义不变。

## 13. P2a（本轮实施）：能从源码构建的入口

**范围**：

1. **shared relay-wire 收敛 relay 家族 rpc-frame 纯逻辑**（§8.6-3/8.6-4 落地）：
   常量（16MiB/64 分片/640KiB 分片预算）、crc32→8 位 hex、checksum 线格式兼容、
   帧类型守卫与组装器/编码器（浏览器安全 Uint8Array + 纯 base64）；desktop
   `desktopMobileRelayProtocol.ts` 改引用 shared 出处并 re-export。
2. **relay-client 会话核心重建**（消费 `types.ts`/`ports.ts` 既有设计）：九态
   状态机、auth 三步握手（proof 走 shared relay-wire：computeProof 纯 JS 单一实现
   （shared），经 codec port 可注入替身）、pair_status_query 心跳、指数退避重连、
   suspended 恢复窗、
   DEVICE_OFFLINE 宽限、错误码→失败卡映射；data 应用帧通道（requestId 关联、
   oversize 拒收）；rpc-frame 通道（发送侧 messageSeq/水位/重放缓冲，接收侧
   组装 + 逐消息 ack）。
3. **mobile-web 源码应用**：vite + react + tailwind 自包含构建
   （`build` = `vite build`），产物保持官方路径形状
   `dist/remote/v4/`（entry）+ `dist/remote/v4/3.14.3/assets/*`；四步加载卡、
   失败卡族、首页（bootstrap/workspace-list 真实数据渲染）、任务面基础版
   （bridge-open；任务面读路径 = 桥内 droraAgentService.hello/initialize 握手 +
   conversationRowsRangeV4 尾窗行分页；写路径 = sendConversationCommandV4(sendText)
   经 composer 提交；P3 流式订阅面仍归后续期）；`src/intl` zh-CN/en-US 同构。
4. **relay-server bundled 根优先级**：`dist/`（源码应用，entry 存在才启用）>
   `src/recovered/`（快照回退，D7 行为保底）> 内建资产代理 > R2 兜底；
   `--mobile-dir` 显式注入仍最高。WS 出站改写对源码应用为 no-op（应用内无官方
   URL 字面量，直连同源 `/ws`）。本节 dist 语义取代 §9『本轮恢复规则』中『构建
   只从该目录复制到 dist』的表述（快照构建改经 build:snapshot --out 输出独立页面
   包，不再写 dist）。

**验收**：

- `pnpm --filter @drora/mobile-web build` 从 `src/` 产出官方路径形状入口与资产；
  产物无 `zcode.z.ai` 字面量、无 `sourceMappingURL`。
- relay-server 默认（无 `--mobile-dir`）托管 dist 入口；dist 缺失时回退
  recovered 快照（D7 回归不变）；`upstream/` 哈希不动。
- shared relay-wire 单测覆盖 RFC 4231 交叉向量（packages/shared/test/）；
  relay-client 单测消费 shared computeProof：握手/proof、状态机迁移表、
  rpc-frame 组装/ack/水位/重放、错误码映射。
- relay-server 集成测试覆盖新优先级链；`pnpm typecheck`、`pnpm lint`、架构检查
  真实运行。

**与 P2/P3 的差距（后续期，不构成本轮验收）**：富时间线（工具卡展开、markdown/
代码高亮、文件变更统计、复制/分叉/撤销）、composer 全功能（排队/上下文/模式/
模型选择/用量/停止）、命令面板、整理任务、宽视口全壳（≥900px 桌面布局）、
mobile-diagnostic/telemetry 全量上报、分包与体积优化（避免单文件大 bundle）、
真机弱网/踢端 E2E。

## 14. P3a（本轮实施）：任务面流式 + 富时间线第一档 + composer 状态驱动

对齐基线 = 官方 3.14.3 手机页（recovered bundle 即桌面 transport/投影栈的压缩副本，
取证：subscribe 消费/帧挂流/resync 与桌面 `packages/ui/src/v4/agentConversationTransport.ts`
同构）。取证结论（2026-09-30）：`subscribeConversationV4` 仅回 ACK（`transport.ts:440-442`
注释），初始快照与增量经 workspace 级事件 `onDynamicConversationFrame` 到达，帧为
wire 候选（complete|fragment），topic=`conversation/<sessionId>`。

**范围**：

1. **任务面流式**（mobile-web src/app）：订阅生命周期 = 握手（既有）→
   `subscribeConversationV4({workspacePath…, sessionId, visibility:"foreground"})`
   拿 ack.subscriptionId → 挂 `onDynamicConversationFrame(workspace)` → shared
   `TopicWireFrameAssembler`（conversationTopicFrameSchema）解码 → 过滤
   `frame.subscriptionId === ack.subscriptionId` 且 topic 匹配 → 最简 store：
   snapshot 帧整包替换并记 seq；delta 帧守卫（`toSeq <= seq` 丢弃迟到、
   `fromSeq !== seq` 断档 → `resyncConversationV4({subscriptionId, base})` 不猜）；
   行应用复用 shared `applyConversationDeltas`（不复制 reducer）；离开任务面
   `unsubscribeConversationV4`。历史回补沿用 `conversationRowsRangeV4`（校验
   atLogEpoch 与 ack.logEpoch 一致）。
2. **富时间线第一档**（src/ui/TaskTimeline.tsx，自包含移植）：turnHeader 轮次分桶
   （桶算法自包含移植 ui `src/lib/taskTimelineGroups.ts` 八桶 + `taskTimeline.*`
   官方文案键，本地时区/localte 语义随 ui）；toolCall 卡（status pill + inputText
   摘要 + 可展开 output.text 预览）；reasoning 折叠；streaming 行实时追加
   （row.delta path 白名单 text/inputText/output.text/summaryText）。
3. **composer 状态驱动第一档**：`control.canStop/stopState/activeWorks` 驱动停止
   按钮（v4 `stop` 命令，payload `{expectedForegroundExecutionId?}`，来源
   control.activeWorks）；`control.phase` 运行中或 `queue.items` 非空时占位文案切
   官方键 `chat.placeholder.followUpQueue`（「继续输入以排队后续修改」）。

**决策（D8 延伸）**：帧通道 = accessor 服务事件（与桌面 renderer 同一 API 面）；
row 应用/wire 解码一律复用 shared 纯函数；分桶与文案自包含移植（D6）。
**有意分歧（本轮记录）**：`workflowRun.*` 两 op 与 dwf 面不实现（整类忽略，
state.patch 的 workflowRuns 键仍整键替换或剥除）；不用 coalesce 合并优化；
ACK 前到达的帧不做 barrier 暂存，仅按 subscriptionId 过滤并依赖 initial snapshot
收敛（官方有 ackActivationBarrier，手机端最小化）；`state.updated` 只整键浅替换，
深合并禁止（协议外状态）。

**验收**：store 纯逻辑单测覆盖七 op 应用/水位守卫/断档 resync/分片重组；
`pnpm --filter @drora/mobile-web build`+`test` 全绿；流式与 composer 状态的
真机验收仍归 P4。spec §13 差距清单中"composer 全功能/工具卡流式渲染"自本节起
部分收窄（排队/停止/流式首档完成；上下文/模式/模型选择/用量/文件变更统计/
markdown 高亮仍归 P3 后续）。

## 15. P3b（本轮实施）：交互应答 + markdown 渲染 + 文件变更统计 + 队列状态第一档

对齐基线 = shared schema（snapshot.ts pendingInteractions/queueState、command.ts
resolveInteraction、transport.ts v4ConversationFileChangesResult）与官方文案键。

**范围**：

1. **阻塞交互应答**（权限/问答）：快照 `state.pendingInteractions` 驱动——permission
   卡（toolName/summary/options 按 kind 配色，allowOnce/allowAlways/deny/custom +
   fullAccessOption 尾随；payload.freeText 时附反馈输入，上限
   MAX_PERMISSION_FEEDBACK_CHARS=4096）；userInput 卡（prompt/questions/options +
   freeText 输入，sensitive 按密码态处理不入草稿）。应答走 v4 `resolveInteraction`
   命令 `{interactionId, answer:{optionId?|freeText?}}`。无待答交互不渲染。
2. **markdown 渲染**（assistantText 第一档）：marked + DOMPurify 净化渲染（自包含，
   安全面：净化后注入，链接 target=_blank rel=noopener；代码块 mono 样式，语法
   高亮归 P3 后续）；userInput 保持纯文本。
3. **文件变更统计**：`conversationFileChangesV4`（打开任务面拉取一次 + 发送后刷新），
   渲染 `chat.changeSummary.filesChanged` 官方键（{count} 个文件已更改）+ 增删行数。
4. **队列状态第一档**：queue.items 计数 + autoDrain/pauseReason 状态显示（管理命令
   deleteQueueItem/reorder 等归 P3 后续）。

**决策**：markdown 渲染依赖 = marked + dompurify（自包含新增运行时依赖，经 pnpm
入库）；交互卡为受控纯组件（store 派生 pendingInteractions 注入）；fileChanges 为
只读查询（沿 rows/range 同族语义，atLogEpoch 不校验拼接——单次拉取即弃）。
**有意分歧**：elicitation 多题（questions 数组）第一档只支持顺序作答当前题；
workspaceHookReview 类交互本轮不渲染（private 面未开放）；队列管理命令归后续。

**验收**：交互应答/store 选择器单测；build+test 全绿；真机权限应答 E2E 归 P4。

## 16. P3c（本轮实施）：整理任务 + 模型选择器第一档 + 上下文用量

取证（2026-09-30）：官方整理菜单持久化键
`zcode-web-remote-control-mobile-task-home-preferences`（默认
`{organizeBy:"workspace", sortBy:"updated"}`，读取闭集校验非法回默认；与桌面侧栏
键/值域是两套独立偏好）；官方手机首页数据源是 relay `listWorkspaces` 而非
sessions-index（bundle 内含该栈是整包桌面栈所致）；模型清单 =
`accessor.modelSelectionService.getView/onDidChange`（ModelSelectionView:
providers[].models[].config.optionSpecs.reasoningLevel.values）；`switchModelConfig`
为 CAS 命令（baseRevision=snapshot.revision，stale 用 ACK.revisionAtDecision 收敛；
跨模型切换丢弃源 thought 用目标模型默认档）；用量 =
snapshot.usage.contextWindow（null 时整表隐藏）。

**范围**：

1. **整理任务**：首页 organize 菜单（organizeBy: workspace|timeline 两选、sortBy:
   created|updated 两选，持久化 localStorage 键按改名规则 Drora 化为
   `drora-web-remote-control-mobile-task-home-preferences`）；organizeBy=workspace
   沿工作区分组（现投影），=timeline 全任务平铺按任务时间分桶（timeBuckets 算法
   换任务粒度输入）；projectTask 补投影 createdAtMs（relay tasks 有 createdAt）；
   pinned/archived/unreadAt 官方可选键缺席 = 无置顶/归档组（第一档降级，键位
   透传预留）。
2. **上下文用量**：composer 状态区显示 used/max（官方 `chat.contextUsage` 文案 +
   百分比；contextWindow 为 null 或 0 不渲染）；数据零新增订阅（store 已整包持有
   snapshot）。
3. **模型选择器第一档**：composer 模型按钮 → 菜单列 providers×models（getView +
   onDidChange 订阅，revision 乱序丢弃）；当前选中读 snapshot.config.modelSelection
   （回落 provider/model 投影）；thought 档用当前模型 optionSpecs.reasoningLevel
   （snapshot.config.thoughtLevels 回落）；切换走 `switchModelConfig`（CAS，
   stale→revisionAtDecision 单次收敛重试；跨模型切档丢弃源 thought）；禁用态读
   availability.switchModelConfig；加载/等待态用官方键（loadFailedRetry/remote-
   Waiting/targetMissing）。

**决策**：整理菜单文案自建键（`webRemoteControl.mobileHome.*` 为官方手机页自有
i18n、ui locales 不携带——后续可从冻结 bundle 逐字提取替换）；模型/用量用官方键；
首页 sessions-index 实时化**不做**（超出官方对齐基线，官方首页即 relay 面；
列为 backlog 待产品裁定）。

**验收**：分桶/排序纯函数单测；build+test 全绿；模型切换 CAS 收敛与真机验收归 P4。

## 17. P4a（本轮实施）：无头端到端冒烟（真链路首批运行时验证）

背景：113–115 轮的流式/交互/模型/整理只有单测，从未经真链路运行。本轮以
conformance 测试床（真 relay-server × 真 desktopMobileRelayControl × ws 库）+
relay 托管自建 dist 页面 + 无头浏览器（agent-browser/CDP）做首批运行时验证。

**场景清单**：

1. 入口加载：无头浏览器打开 `http://<loopback>:<port>/remote/v4?sid=&hash=&t=`
   （QR 参数族，buildRelayQrUrl 形状）——页面资源全部本地 dist 供给，无外网。
2. 四步卡推进 → 首页：relay-client 真握手/配对 → bootstrap 真数据 →
   「当前设备上的工作区和任务」首页渲染（fallback 工作区 C:/g1）。
3. 整理菜单：organize 菜单开合、workspace/timeline 切换渲染。
4. 单会话接管：第二标签页同 QR 进入 → 第一页收 KICKED → session-conflict
   失败卡（badge/title 渲染非裸键名，P3b i18n 修复的运行时证据）。

**验收**：页面 uncaught pageerror = 0；上述断言截图/文本证据落
`.tmp-work/e2e-smoke/`；发现的问题当轮修复。**任务面桥内服务
（流式时间线/composer/交互应答/模型切换）需真 Host attachment（electron），
仍归 P4 真机验收——本场景清单刻意不含。**

### P4a 执行结果（2026-09-30，本轮）

**E2E 抓到并修复两个单测不可见的真 bug**：

1. **入口相对引用丢 v4 段**：build-app.mjs 曾把 vite 绝对引用改写为相对
   `3.14.3/assets/...`——入口在 `/remote/v4`（无尾斜杠）下服务时浏览器解析到
   `/remote/3.14.3/assets/` → 模块全部加载失败 → **整页空白**（无 window error，
   仅 console）。修复：保留绝对官方形状引用 + build/test 双断言（abs 形状 +
   引用闭合）。
2. **Tailwind v4 源扫描漏 src/ui**：`@tailwindcss/vite` 自动检测以 vite root
   （src/app）为界，src/ui 壳类（flex-col/bg-header/h-dvh/animate-spin…）未生成
   → 整页横排、文字竖排。修复：styles.css 显式 `@source "../ui"; @source "./";`。

**场景结果（414×896 无头，agent-browser/CDP）**：

| 场景 | 结果 |
| --- | --- |
| 入口加载（QR 参数族，本地 dist，无外网） | ✅ |
| relay-client 真握手/配对/心跳（四步卡 → 「已连接到当前桌面窗口」） | ✅ |
| 首页真实数据（fallback 工作区 g1/本地/C:/g1 渲染） | ✅ |
| 整理菜单开合 + timeline 切换 | ✅ |
| 单会话接管：第二浏览器同 QR → 第一页 KICKED → session-conflict 失败卡（真实文案非裸键名，P3b i18n 修复的运行时证据） | ✅ |
| uncaught pageerror | 0 |

证据：`.tmp-work/e2e-smoke/`（10 张截图 + 文本导出）。工具坑备案：agent-browser
把 argv/stdin 中的 `&` 当命令链分隔符——QR URL 导航用单行
`String.fromCharCode(38)` 拼接；其 stdin eval 在本版本为 no-op。

**仍归 P4 真机**：任务面桥内服务（流式/交互应答/模型切换——需 electron Host
attachment）、弱网/恢复路径。

### P4b（本轮实施）：桥内服务无头验收（任务面流式/交互/模型的首批运行时验证）

背景：§17 P4a 验证到首页为止；任务面（桥内 v4 服务面）因 electron Host 缺席仍是
零运行时验证。本轮给 E2E harness 加**真 Host 服务面**：control 的
`attachBridgePort` 注入内存端口对（desktop 测试的 createFakeBridgePort 模式），
对端以真 `@drora/rpc` MessagePortProtocol + ChannelServer 挂**最小
IDroraAgentService/IModelSelectionService**（脚本化 v4 store：快照/增量帧/
rowsRange/命令 ACK/fileChanges/模型视图——形状全部由 shared schema 构造）。

**两步验收**：

1. **node 协议级**：ChannelClient + RemoteServiceAccess（与移动页同一消费面）
   覆盖内存端口对——hello/initialize → subscribe（ACK+initial 快照帧到达）→
   rowsRange → sendText（ACK + userInput 增量帧回灌）→ resolveInteraction →
   switchModel（stale→revisionAtDecision 收敛）→ modelSelectionView →
   fileChanges 全链断言。
2. **浏览器级**：同一 harness 换 agent-browser 驱动真页面——打开任务 →
   流式时间线（快照行渲染）→ composer 发送（增量回显）→ 交互卡应答 →
   模型菜单切换 → 截图/文本证据。

**Host 侧脚本面=测试桩非产品实现**（服务注册/协议为真，业务数据脚本化）；
提升为常驻测试基建另议。真 CLI runtime 的验收仍归真机。

### P4b 执行结果（2026-09-30，本轮）

**Host 桩服务面 + node 协议级验证**：内存端口对（真 MessagePortMain 排队语义：
host→control 在 control 挂监听前排队、注册即冲刷）+ 真 MessagePortProtocol +
ChannelServer（deferInit）+ ProxyChannel 注册 drora-agent/zcode-agent 与
model-selection 通道（含官方别名）。node 侧 ChannelClient + RemoteServiceAccess
（移动页同款消费面）12 步断言全绿：hello/initialize/subscribe(ACK+initial 帧)/
rowsRange/sendText(ACK+增量帧)/stop/resolveInteraction(清交互帧)/switchModel
(stale→revisionAtDecision 收敛)/fileChanges/getView/resync/unsubscribe。

**浏览器级任务面验收（414×896，全 ✅）**：任务打开（bridge-open→附着→ready）→
快照行渲染（今天分桶/运行中轮 pill/双气泡/排队回显）→ FileChangesBar（+12 -3）→
队列横幅（待发送消息（1））→ 模型按钮（stub-model）+ 用量徽标（5120/12.8万 4%）→
停止按钮（stoppable）→ 排队占位文案 → composer 发送（sendText→ACK→row.appended
增量回灌）→ 模型菜单（provider/model/推理档树）。

**E2E 再抓三个集成 bug（当轮修复）**：

1. **页面任务归组丢任务**：projectHomeData 分组读**投影后**任务对象（已剥
   workspacePath/workspaceIdentity）→ key 为空、任务全部被丢。修复：归组读原始
   记录；node 重放 + homeProject.test.ts 3 条回归（含 identity 归一/孤儿/mobileViewState
   回退）。此 bug 自 P2a 起潜伏——此前 E2E 从未有过带任务的种子。
2. **Host Initialize 死锁**：桥桩等「页面第一个字节」才发 Initialize，而
   ChannelClient 协议是 **Host 先发 Initialize**、页面只应答——双方互等。
   修复：内存管道对齐真 MessagePortMain 排队语义（control 挂监听前排队、注册即
   冲刷），触发改为桥附着即发。
3. **桌面 control 空桥丢弃窗口**：control 在 port.on 注册时 bridge 引用尚为 null
   （disposeBridge 后未重建），过Early到达的 host 字节被 forwardHostBytesToPhone
   的空桥守卫丢弃。真 host CLI 异步附着天然晚于 control 同步接线，不触发；桩改
   120ms 延迟对齐时序。

**遗留（如实）**：交互应答卡未在浏览器渲染（stub 快照 pendingInteractions 已含
1 条 permission，页面卡未出现——归属下轮排查）；停止按钮点击验收未完成（环境
收口）；真 CLI runtime 验收仍归真机。工具坑补充：agent-browser 的 stdin eval 在
本版本为完全 no-op（2+2 也不执行），复杂表达式用 eval -b base64。

### P4b 遗留收口（同日续）

- **交互应答卡浏览器验收补全 ✅**：卡渲染（badge=官方「等待确认」、工具名/摘要、
  反馈输入、允许一次/拒绝按钮）→ 点拒绝 → resolveInteraction → state.updated 帧
  → 卡消失。两处卡文案曾回退裸键名（组件指向的 notification.permissionRequired /
  chat.permission.awaitingApproval 未入字典）——已补官方键（ui locales 逐字）。
- **停止按钮**：stoppable 态渲染确认；点击验收随环境收口中止，归真机。

### P4b 补充：停止按钮点击验收（同日）

浏览器点击停止 → sendStop（v4 stop 命令）发出无错误；按钮态不变属 **harness 桩局限**
（stub 收到 stop 仅 ACK，不脚本化 control.phase/stopState 的 state.updated 回写——
真 CLI 会）。命令 ACK 路径已在 node 级 12 步断言覆盖（stop ok: accepted）。

## 18. P3d（本轮实施）：命令面板第一档——首页任务搜索

取证（2026-09-30）：桌面 CommandCenter=cmdk+scope tabs(all/commands/conversations/files，
前缀 > # @)+最近变更/最近任务+搜索历史（localStorage）；命令清单=壳层闭包
（QuickPickCommand.run 走桌面宿主能力，不可移植）；任务搜索=host 侧
`windowControllerService.listTaskList(DroraTaskListQuery)`（返回 searchSnippet）。
官方手机页含同源面板栈（cmdk/9 类 category/slash v4-pane 通道）。

**范围（第一档 = 会话搜索半面板）**：首页「搜索」入口 → 面板（单 tab）：无 query
列最近任务（listTaskList{kind:"active",sortBy:"updated",limit}），有 query 走
host 侧 search（searchSnippet 展示）；选中 → 打开任务面（复用既有链路）；搜索
历史 localStorage（Drora 化键，纯函数移植+闭集防御）。

**有意分歧**：desktop QuickPick 壳命令组/文件搜索/slash 目录（需 workspace-config
topic 订阅）不做——桌面 run() 闭包依赖手机端不存在的宿主能力；官方 9 类 category
裁为单 tab。面板懒加载（dynamic import），不进首屏 chunk（spec §6 教训）。

**验收**：listTaskList 契约 node 单测（脚本化 accessor）；build+test 全绿；真机
归 P4。

### P3d 执行结果（2026-09-30，本轮）

命令面板第一档落地：TaskSearchPanel（懒加载独立 chunk 5KB）+ searchHistory
（Drora 化键 drora-mobile-search-history，纯函数 8 测）+ searchTasks
（windowControllerService.listTaskList{kind:active,sortBy:updated,limit:20}，
accessor 显式注入作测试缝；scopes 数组贯穿 workspaceIdentity；缺省回落本地过滤）。
首页搜索 FAB 入口（React.lazy 真分包）。76 测全绿（新增 17）。
遗留裁定：host 全文搜索+snippet 接线归 P4 真机档（App 一行接 onSearchTasks）；
slash 目录（workspace-config topic）与桌面 QuickPick 壳命令组不做（有意分歧，
spec §18）。临时调试桩 __step 已清除。

## 19. 宽视口全壳裁定（2026-09-30）：走复刻路线

用户在还原完成声明后继续指令「继续完成还原」= 裁定 **复刻官方宽视口行为**
（≥767px 官方断点渲染完整桌面壳，spec §2/§106 轮取证：单 Root 树 + 侧栏 + 主区，
官方 bundle 6.2MB 量级）。接受 bundle 增长与多轮工作量；分包纪律（spec §6）继续生效。
P3d 检索面板等已交付面不受影响。

**分期**：P5a 架构取证与方案（本轮启动）→ P5b 侧栏+主区骨架 → P5c 深面对齐 →
P5d 分包与体积验收（对照官方 6.2MB 基线）。

### P5a 架构取证结果（2026-09-30）

断点=官方字面 `(max-width: 767px)`；侧栏宽 264（可持久化调整）；单 Root 挂载
props 四件套（restoreSession:!1/allowOpenWorkspace:!1/switcher 七方法/ PairedCard
fallback）；服务注册表 oHn()=35+ 服务 pre-bridge stub → 桥附着按通道升级
（skills/commands 官方桩即 desktop_only 降级先例）。**服务端零改动**：Host 对
web-remote-replayable 附着注册全量 drora-*/zcode-* 服务——缺口全在手机侧
accessor 组装层（stub→桥升级）与 UI。

**三期切分**：P5b 侧栏+主区骨架（布局+新建/搜索/项目树/用户页脚+问候空态；
<767px 零回归）→ P5c 深面对齐（宽版 composer 工具条/sessions-index 实时任务数/
文件树/用量页脚/accessor 组装层）→ P5d 分包与体积验收（index≤500KB/全站
≤1.5MB，对照官方 6.2MB；双视口 E2E）。宽壳组件全部落 `src/ui/wide/`（D6 线）。

### P5b 执行结果（2026-09-30，本轮）

宽壳骨架落地并浏览器验收（1280×800 截图）：侧栏 264px（品牌/折叠开关[持久化
drora-mobile-sidebar-collapsed]/新建/搜索[TaskSearchPanel 懒加载复用]/插件市场
占位 disabled/项目树[g1 组+任务行]/用户页脚+连接状态+主题+语言）+ 主区问候空态
（时段问候「上午好呀」+ 工作区名 + 新建任务主按钮）；<767px 零回归（窄壳单列
路径逐字未动）。纯模型拆分（wideShellModel.ts 12 测：断点/折叠持久化/项目树/
问候桶）。有意偏差记录：问候五桶归并（官方六档）、新建任务禁用（relay 面无
createTask 命令，draft 链归 P5c）、插件市场占位。**门禁**：typecheck 0/lint
0 error/mw 8+80 测/build 绿。

### P5c 范围细化（2026-09-30）

1. **sessions-index 实时任务活性**：首页/侧栏打开期间按工作区开桥
   （workspace-bridge-open，任务面已开桥时复用）→ subscribeSessionsIndexV4
   （runtimePolicy:"existing-only"，subscriberScope:"mobile-home"——防拉起
   runtime/防与桌面订阅互替，droraAgent.ts:514-533 取证）→
   TopicWireFrameAssembler(sessionsIndexTopicFrameSchema) → 水位守卫
   （fromSeq!==seq → resync，不猜）→ SessionSummary.phase 映射任务行活性
   （running/prewarming→running、completed*→completed、error→error、draft→隐藏）。
2. **用量页脚数据**：usageStatsService（accessor 可达）——页脚显示当日 token 用量
   第一档；codingPlan 等归后续。
3. **accessor 组装层**：任务面桥生命周期外的服务调用（搜索/树/用量）统一经
   taskSession 打开的工作桥 accessor（首页搜索沿用 spec §18 缺省回落）；
   oHn 式全服务 stub 注册表**不做**（调用面按需开桥已覆盖，YAGNI）。
4. **不做**：fileService 文件树、插件市场面板（P5d 后另立）；slash 目录（§18）。

### P5c 执行结果（2026-09-30，本轮）

sessions-index 实时任务活性落地：sessionsIndexStore（纯逻辑 9 测：snapshot 整包/
delta 衔接/断档闩锁 resync/相位映射/订阅过滤）+ taskSession 专用首页桥
（existing-only + scope mobile-home + visibility foreground；与任务桥并存/复用）+
HomeScreen 装配缝接线（App 绑定 client）。**门禁**：typecheck 0/lint 0 error
（365 基线 warnings）/mw 8+89 测绿。App 层一行接线完成（openSessionsIndexBridge
装配缝）。**已知 UI 边界**：活性三值保真（含 error），ui status 闭集两值边界收口
error→completed（error 独立呈现归 P5d 评估）。

### P5d 执行结果（2026-09-30，本轮）

**体积验收达标**：index 334KB（≤500KB ✓）/ 全站 793KB（≤1.5MB ✓）/ 官方基线
6.2MB——8 倍小。双视口 E2E 终验：414×896（配对→首页任务行→任务打开→交互卡）✅；
**发现并修复 P5c 集成 bug**：harness 桩 droraAgentService 未实现
onDynamicSessionsIndexFrame 事件 → ProxyChannel 抛 "Event not found" → **harness
进程崩溃**（HomeScreen 实时化调用触发）。修复：桩补 sessions-index 事件面
（scripted running 快照帧）；管道 deliver 包 try/catch 防进程级崩溃。
**P5c 活性合并渲染待一轮排查**：首页任务行仍显示投影态「已完成」而非
sessions-index 活性「运行中」（合并链路 store→HomeScreen→HomeShell 某环节未生效，
步进日志定位归下轮；store 纯逻辑 9 测全绿）。
