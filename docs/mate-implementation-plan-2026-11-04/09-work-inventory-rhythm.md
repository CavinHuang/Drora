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

## 2. P9 · 自主节奏层（Autonomy Loop）

> **设计修订（2026-11-06，用户裁定）**：不做固定晨报与硬判据表——规则引擎是闹钟不是助理。
> 大副**自己观察、自己判断**要不要汇报/要不要建任务；代码只提供心跳、全域速览与
> 受控出口，「要不要行动、行动是什么」由 Router 会话（LLM）评估决定。汇报与跟进
> 建议本身可以是**大副自主创建的任务**（决策卡），用户确认后走既有派发链。

### 2.1 自主评估循环

```
心跳（watchdog cron tick 节流，kv autonomy_interval_ms 缺省 30min，可关）
  → 组装全域速览（composeLedgerDigest 升级版：含 inventory）
  → 发给 Router 会话做「自主评估」轮
  → autonomyVerdict（zod 三臂）:
      quiet    —— 没什么值得说的（预期绝大多数心跳；零打扰零成本）
      report   —— 值得汇报 → 文本经 digest 闸推送（可抑制聚合）
      suggest  —— 值得跟进 → 大副自主创建决策卡（用户确认才行动）
```

- **心跳只是唤醒机制**，不是节奏本身——大副会话没有持续推理循环，tick 唤醒后
  做什么由 LLM 判断；没有"每天 09:00"概念（连续无变化的日子大副安静，事情多的
  日子它自己会多说）。
- **评估 schema**（`autonomyVerdictSchema`，routerDecision.ts 邻域）：
  `{ quiet: {} } | { report: { text ≤800, reason } } | { suggest: { brief, kind:
  "attach"|dispatch 建议参数, reason } }` 三臂恰现其一；解析失败=quiet（自主层
  失败永不打扰——fail-silent 对打扰语义是正确方向）。
- **Router 会话复用**：自主评估输入（速览+自主约言段）走既有 Router 会话追加轮
  （不建第二个 LLM 进程；轮转/换代语义照旧）。

### 2.2 三个受控出口（全部复用既有面，零新动作面）

| 臂 | 出口 | 打扰语义 |
|---|---|---|
| quiet | 无动作 | 零 |
| report | `admitAssistantDisturbance(kind=report)` 过闸 → 推送面（桌面通知/桌宠气泡/Source 晨报订阅——三通道独立降级）| 可抑制（超额聚合进 pendingDigest 次日补） |
| suggest | **大副自建决策卡**：落 admission_decision（outcome=decision_card, decided_by=gate, trigger 来源=`autonomy`）——用户 Y 放行走既有派发链（attach/dispatch），N 忽略 | decision 类必答但计数（永不被抑制） |

**「大副自己创建任务」的边界**：suggest 臂创建的是**待确认建议**（决策卡），不是
已派发任务——创建本身零执行，行动权永远在用户的 Y/N。这同时是 P10 记忆的观察
输入源（大副何时选择说话/建任务，沉淀为它的节奏感）。

### 2.3 防打扰四闸（自主层专用）

1. 配额闸（report 可抑制/suggest 计数）；
2. **去重记忆**：`autonomy_seen:<速览hash>` kv——同一速览指纹 24h 内不重复评估
   输出（quiet 不记忆，report/suggest 记忆）；
3. **否定记忆**：用户对某 suggest 忽略 → `autonomy_muted:<对象hash>` 48h 内对该
   对象不再 suggest；
4. 设置页总闸：自主观察开关（kv `autonomy_enabled` 缺省 true）+频率（30-1440min）。

### 2.4 contracts 与设置

- kv 新键：`autonomy_enabled`/`autonomy_interval_ms`/`autonomy_seen`*/`autonomy_muted`*；
- 设置页节奏区收敛为两项（开关+间隔）——无晨报时间（无固定晨报）；
- 快照投影 `rhythm?: { autonomyEnabled: boolean }`（可选）。

### 2.5 P9 验收

- 服务：autonomyVerdict 三臂 schema 单测（恰现其一/失败=quiet）；自主评估循环单测
  （心跳节流/速览组装喂入/quiet 零动作/report 过闸推送回执/suggest 落决策卡且
  decided_by=gate/去重与否定记忆矩阵）；Router 会话追加轮 mock 单测。
- UI：MSA16 资产（自主设置区+autonomy 来源决策卡呈现——sourceKind 扩 `autonomy`
  徽标）。
- 语义：自主层关闭时行为与 P8 完全一致（增量=纯可选）。

## 3. 分批与工作量

| 批 | 内容 | 预估 |
|---|---|---|
| P8a | contracts+workInventory 组装+快照投影+单测 | 0.5 天 |
| P8b | query work scope+台账速览升级+MateWorkOverview UI+MSA15 | 0.5 天 |
| P9 | 自主评估循环（心跳/三臂 schema/三出口/四闸/设置区）+MSA16 | 1 天 |

依赖：P8a→P8b→P9（自主层消费全域速览）。完成后：大副自己决定何时汇报、何时建
任务——"看见全部 + 自主节奏"闭环，且一切行动权在用户。

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| sessions-index 内存投影在多 workspace 下体积 | 台账组装即有界截断（6×20）；快照投影照界 |
| 自主层变话痨（LLM 倾向于"说点什么"） | 自主约言明确"默认 quiet，只有用户不回应就会损失什么时才开口"；report 可抑制聚合；去重+否定记忆；总闸一键关 |
| 推送通道在无桌面通知权限环境 | 通道独立降级（通知失败→气泡兜底→Source 兜底，全败则 pendingDigest 次日补） |
| 自主评估的 LLM 成本（每心跳一次调用） | 心跳缺省 30min+速览有界 400；quiet 预期占绝大多数；关闭即零成本 |
| "接管"被理解为接管会话控制权 | spec 措辞钉死"只读观察+人工确认"；MSA16 断言无任何自动 attach 路径 |

## 5. 登记与不做

- spec §12 新节（全域台账）+§13（节奏层）+§14 P8/P9 行；CONTRACT ×2；matrix MSA15/16。
- **不做**：固定晨报/日报模板与定时（用户裁定：节奏由大副自主判断）；项目注册表 UI（自举集合，排除清单留 P10）；日历/邮件 Source（P11 插件形态）；git 信号采集（P8 可选件独立小批，本轮不做避免摊宽）；手机推送（P11）。
