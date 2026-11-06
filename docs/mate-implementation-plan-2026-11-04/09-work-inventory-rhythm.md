# 09 · 全域工作台账与节奏层（P8 Inventory + P9 Rhythm，2026-11-06 设计）

## 0. 北极星与问题定义

大副的定位是**常驻个人工作操作系统**——管理用户的全部工作，而非只管自己经手的工单。当前最大盲点：**大副只看得见工单账**——用户手开的会话、运行中的 teams、off-peak 任务、无工单的项目，大副全部不可见。统筹的前提是看见全部（Inventory），看见之后才谈得上节奏感（Rhythm：晨报/巡检/主动汇报）。

两批一次设计、分批交付：

- **P8 全域工作台账**：sessions-index + tasks-index 全量投影 → 跨项目工作台账（大副工单 + 自发会话 + teams + off-peak），**投影层不接管**（所有权仍归 harness——零侵入纪律不变）。
- **P9 节奏层**：每日晨报（cron 产出全域战报 → 既有 digest 基建 → 推送面）+ 定期巡检（全域扫描 → 主动提醒，走配额闸）。

### 红线（不因本批松动）

- **投影不等于接管**：全域台账是 sessions-index/tasks-index 的只读投影索引；大副不写会话状态、不改 tasks-index、不建第二任务系统。自发会话在台账里**只读可见**，大副对它的动作仅限 query_status 直答与"建议接管"决策卡（见 §2.4），永不直接操作用户的会话。
- **主动但不烦人**：一切主动触达（晨报/巡检提醒）过配额中心既有闸（report/bubble 计数与抑制）；晨报算 1 次 report。
- **零新轮询原则**：数据源全部复用既有事件面（sessions-index 订阅/tasks-index 同步/watchdog cron tick）——不新增进程级轮询循环；git 信号（P8 可选件）复用 watchdog tick 节流。

## 1. P8 · 全域工作台账

### 1.1 数据源盘点（全部已存在，零新管道）

| 源 | 已有形态 | 台账消费 |
|---|---|---|
| 大副工单 | mate.sqlite（快照投影） | 工单行（既有） |
| 会话（用户手开 + 大副派发） | sessions-index 订阅（node.ts ensureAssistantSessionsIndexSub：快照+增量内存投影，listSessions/watchSessions/probeSession） | 工作行：会话 id/标题/phase/teamActivity/updatedAtMs/所属 workspace |
| teams | sessions-index 的 teamActivity 字段（会话摘要自带） | 工作行状态（running/completed） |
| off-peak 任务 | tasks-index（droraTaskIndexSyncer，既有同步链） | 工作行（off-peak 类） |
| 项目清单 | 台账自举：从上述源的出现过的 workspace 集合推导（**不建独立项目注册表**——见 §1.5） | 分组键 |

### 1.2 台账模型（内存投影，`workInventory.ts` 新文件）

```
WorkInventory = Map<workspaceKey, WorkspaceWorkRow[]>
WorkspaceWorkRow =
  | { kind: "ticket"; ... 工单行（ticketId/status/mode/generation/updatedAtMs） }
  | { kind: "session"; sessionId/title/phase/updatedAtMs/managed: boolean /* 大副派发 */
      /teamStatus?: "running"|"completed"|... }
  | { kind: "offpeak"; taskId/title/status/updatedAtMs }
```

- **组装点**：`sourceRegistry.handleSnapshot` 同款模式——服务 publish 时由 host 侧装配层组装（大副快照 × sessions-index 内存投影 × tasks-index 查询），产出 `MateWorkInventoryView` 挂进**大副快照的可选字段**（`inventory?`，快照只加不破；有界：每 workspace ≤20 行、总 ≤6 workspace，超界按最近活动截断）。
- **会话归属 workspace**：sessions-index 本身按 workspace 订阅（既有 key=identity||path）——组装时天然分组。
- **managed 标记**：sessionId 与某活动工单的 incarnation.sessionId 相等 → managed=true（UI 徽标"大副派发"）。
- **内存态纪律**：台账组装是纯函数（输入三方只读快照 → 输出视图），无第二写者、不落库（快照即事实源；重新组装幂等）。

### 1.3 contracts（只加不破）

- `mateWorkInventorySchema`（shared/contracts/assistant.ts 邻域新段）：`{ workspaces: [{ key, rows: [...] }] }` 有界（界常量进 `ASSISTANT_SNAPSHOT_LIMITS`：inventoryWorkspaceMax=6 / inventoryRowMax=20）。
- 快照 `AssistantSnapshot.inventory?: MateWorkInventoryView`（可选追加）。

### 1.4 query_status 升级：全域 scope

- scope 新 kind `"work"`（全局）与 `"work"` + workspaceIdentity（单项目）：应答器读 inventory（缺席时回落工单账并注明"仅工单视角"——旧 Host 降级）。
- 答案形状（示意）：`「你有 3 个项目在动：ws-a——大副工单 1（修复登录 running）+ 你自己的 2 个会话（最近 14:32）；ws-b——team 1 个 running；ws-c——无活动，上次工作是昨天」`。
- Router 约言台账速览段同步升级（composeLedgerDigest 消费 inventory——attach 判定从此看全域会话而非仅工单）。

### 1.5 项目清单：自举不注册（有意决策）

不建"项目注册表"（避免第二份需要维护/同步的事实源）——台账的 workspace 集合 = 近 N 天（14d）出现过任何工作行的 workspace ∪ 有活动工单的 workspace。冷启动空集是诚实空态。设置页后续若需"隐藏某项目"，以排除清单 kv 扩展（P10 域）。

### 1.6 UI

- **总览卡**（`MateWorkOverview.tsx` 新组件，面板顶部、状态条下）：每项目一行（项目名/活动行数按 kind 徽标/最近活动时刻/停滞警示点），点击展开行列表（四类行：工单复用既有行组件形态、session 行=标题+phase+managed 徽标、offpeak 行）。快照 inventory 缺席（旧 Host）→ 卡不渲染。
- 桌宠速览：**不加区**（速览保持大副工单三区；全域视图在面板——桌宠是"大副的窗口"不是"所有工作的窗口"）。
- i18n 双语；行点击：ticket→详情、session→`onOpenMateSession` 同款跨域导航（会话在任务列表的既有通道，零新导航面）。

### 1.7 P8 验收

- 服务：workInventory 组装纯函数单测（三源合并/managed 标记/有界截断/自举集合）；queryReply work scope 单测（全域答案/缺席回落）；快照 inventory 投影单测。
- UI：MSA15 资产（fixture 注入 inventory → 总览卡渲染/分组/停滞点/managed 徽标/行点击导航）。
- 语义回归：既有 query scope/台账速览断言不红（work 缺席时行为不变）。

## 2. P9 · 节奏层

### 2.1 每日晨报（Morning Digest）

- **产出**（`morningDigest.ts` 新纯函数）：输入=快照（含 inventory）→ 输出结构化晨报文本（有界 1200）：
  ```
  【大副晨报 · 11-07 周五】
  昨日完成：2（修复登录✅/回归跑批✅）；失败：1（部署脚本❌ assistant_row_failed）
  当前在动：ws-a 工单 1 + 会话 2；ws-b team 1
  待决策：1（面板放行）；停滞预警：ws-c 会话 3h 无输出
  花费：输入 88k / 输出 30k tokens
  ```
- **触发**：复用 watchdog cron tick（host 已有 60s tick）——tick 时读 kv `morning_digest_time`（"HH:mm"缺省 09:00，设置页可调）判定跨日触发点，触发即：产出 → `admitAssistantDisturbance(kind=report)` 过闸（**晨报=1 次 report**；超额 → 进 pendingDigest 明日补投，既有语义）→ 推送面。
- **推送面**（多通道并行，各通道独立 try/catch）：桌面系统通知（Electron Notification，host 侧）+ 桌宠气泡（bubble 帧既有链）+ Source 回复（对配置了"晨报订阅"的通道——kv source_config 扩可选 `morningDigest: true`）。投递成功任一通道 → `markDailyDigestDelivered()`（既有方法，回执防重投）。
- **幂等**：kv `morning_digest_last_date`（yyyy-mm-dd）当日已投不重投。

### 2.2 定期巡检（Patrol）

- **挂点**：watchdog cron 同 tick（不建新定时器）；节流 kv `patrol_interval_ms` 缺省 60min。
- **判据**（全域，数据=快照含 inventory）：
  | 判据 | 数据源 | 动作 |
  |---|---|---|
  | 大副工单停滞 | 既有 watchdog 三判据（不动） | 既有 stale 标记+通知 |
  | **自发会话长时间无输出** | inventory session 行（phase=running 且 updatedAtMs 距今 >120min） | 巡检提醒（决策卡形态："ws-a 的会话『修复部署』2 小时无输出——要大副接管跟进吗？"→ attach 决策卡；**不做任何自动动作**） |
  | **项目有活动无工单** | workspace 有 session 行但 0 工单行且持续 >1 天 | 巡检提醒（"ws-b 你自己在干活，没有大副工单——需要大副帮忙盯着吗？"） |
- **打扰边界**：巡检提醒=decision 类（永不被抑制但计数）？**否**——巡检是建议不是必答，归 **report 类**（过闸可被抑制聚合进 digest）；每判据×每对象 24h 内至多一次（`patrol_seen:<hash>` kv 去重）。
- **决策卡出口**："接管跟进"→ 走 attach 建议臂的既有决策卡链（人工确认后才动会话——红线守住）；"不用"→ 忽略并 48h 内不再就该对象提醒（kv 记忆）。

### 2.3 contracts 与设置

- kv 新键（ASSISTANT_KV_KEYS 扩）：`morningDigestTime`（"HH:mm"）、`patrolEnabled`（bool 缺省 true）、`patrolIntervalMinutes`。
- 设置页（MateConfigSection 节奏区）：晨报时间输入+开关、巡检开关；bounds（时间格式校验/间隔 30-1440 分）。
- 快照投影：`rhythm?: { morningDigestTime: string; patrolEnabled: boolean }`（可选）。

### 2.4 "接管"语义（本批唯一的跨所有权动作，严格限定）

巡检/总览卡的"接管跟进"永远只是**建议**：产出一张 attach 决策卡（既有链），用户确认后大副才对该会话建立工单关联（watchTicket 订阅归账——只读观察，不改会话内容）。**永不**自动 attach、永不向用户会话发消息（除非用户此后在该工单上明确下指令）。

### 2.5 P9 验收

- 服务：morningDigest 产出单测（空日/有完成/停滞段/有界）；cron 触发判定单测（跨日/幂等/缺省时间）；巡检判据单测（两新判据矩阵/去重/48h 记忆）；推送面 fake port 单测（三通道独立失败不互相阻断+回执）。
- UI：MSA16 资产（节奏设置区写入+回显；巡检决策卡呈现——fixture 注入）。
- 桌宠：气泡链复用（MRP 既有断言覆盖形态）。

## 3. 分批与工作量

| 批 | 内容 | 预估 |
|---|---|---|
| P8a | contracts+workInventory 组装+快照投影+单测 | 0.5 天 |
| P8b | query work scope+台账速览升级+MateWorkOverview UI+MSA15 | 0.5 天 |
| P9a | morningDigest 产出+cron 触发+推送面+设置区 | 0.5 天 |
| P9b | 巡检两判据+决策卡出口+去重记忆+MSA16 | 0.5 天 |

依赖：P8a→P8b→（P9a ∥ P9b 可并行）。全部完成后：晨报打开电脑即见全域战况、巡检让大副主动盯着你自己都没盯的事——"看见全部 + 主动节奏"闭环。

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| sessions-index 内存投影在多 workspace 下体积 | 台账组装即有界截断（6×20）；快照投影照界 |
| 晨报推送在无桌面通知权限环境 | 通道独立降级（通知失败→气泡兜底→Source 兜底，全败则 pendingDigest 次日补） |
| 巡检判据误报（用户午休=会话 2h 无输出） | 判据阈值 kv 可调+24h 去重+report 类可抑制+决策卡出口永不自动——四重泄压 |
| "接管"被理解为接管会话控制权 | spec 措辞钉死"只读观察+人工确认"；MSA16 断言无任何自动 attach 路径 |

## 5. 登记与不做

- spec §12 新节（全域台账）+§13（节奏层）+§14 P8/P9 行；CONTRACT ×2；matrix MSA15/16。
- **不做**：项目注册表 UI（自举集合，排除清单留 P10）；日历/邮件 Source（P11 插件形态）；git 信号采集（P8 可选件独立小批，本轮不做避免摊宽）；手机推送（P11）。
