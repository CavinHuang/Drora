# 09 · 全域工作台账与节奏层（P8 Inventory + P9 Rhythm，2026-11-06 设计 v2）

> **v2 修订（2026-11-06，设计完整性审查后）**：审查抓出 1 P0（auto 自批环路）+ 7 P1 + 5 P2 + 5 P3，全部闭合——见 §6 修订记录。核心变化：autonomy 卡**不进候选卡评估循环**（独立建卡事务）；inventory 接缝定为 provider 端口+常驻订阅+刷新环路；自主评估独立 schema 直调 router port（不写 router_evaluation、不计轮转）；off 模式自主循环整体停跳；suggest 建卡即写对象冷却；report 落地面收敛为 watchdog 同款通知区+气泡。

## 0. 北极星与问题定义

大副的定位是**常驻个人工作操作系统**——管理用户的全部工作，而非只管自己经手的工单。当前最大盲点：**大副只看得见工单账**——用户手开的会话、运行中的 teams、off-peak 任务、无工单的项目，大副全部不可见。统筹的前提是看见全部（Inventory），看见之后才谈得上节奏感（Rhythm——由大副**自主判断**，非规则引擎）。

- **P8 全域工作台账**：sessions-index + tasks-index + 工单账 → 跨项目工作台账（投影层不接管）。
- **P9 自主节奏层**：心跳唤醒 → 大副自主评估（quiet/report/suggest 三臂）→ 受控出口。

### 红线（不因本批松动）

- **投影不等于接管**：台账是只读投影；自发会话对大副的唯一出口是"建议接管"决策卡，**永不自动操作用户会话**。
- **自主≠自批**：大副自主创建的任何决策卡**永不进入自动放行路径**（含 auto 模式）——行动权永远在用户的 Y/N。
- **主动但不烦人**：一切主动触达过配额闸；suggest 建卡即写对象冷却（不依赖用户先忽略）。
- **off = 大副不下场**：mode=off 时自主循环**整体停跳**（含评估读——对齐 off 含读零执行）；observe/auto 下由 autonomy_enabled 单独控制。
- **零新轮询**：数据源全部复用既有事件面；心跳复用 watchdog cron tick（自主轮 fire-and-forget 不阻塞 tick）。

## 1. P8 · 全域工作台账

### 1.1 数据源（三源 + 现实约束）

| 源 | 形态 | 现实约束（v2 澄清） |
|---|---|---|
| 大副工单 | mate.sqlite 快照 | 无 |
| 会话/teams | sessions-index 内存投影（node.ts ensureAssistantSessionsIndexSub） | **惰性订阅**：按 (identity, hostPath) 建立且 watcher 清零即拆；**无全域订阅形态**——见 §1.3 bootstrap |
| off-peak | tasks-index（taskIndexRepo，host 层） | 服务层零引用——需 provider 注入（§1.2） |

### 1.2 组装接缝（v2 定案：provider 端口 + 刷新环路）

- **注入**：新端口 `setAssistantInventoryProvider(provider: () => MateWorkInventoryView | null)`（assistantPorts 同款 set* 模式）。装配层（node.ts）组装三源 → provider 闭包；服务 publish 时读 provider 挂进快照 `extras.inventory`（buildAssistantSnapshot 第三参扩可选字段）。**部分源缺席=inventory 整体缺席**（投影是全有或全无的诚实语义，不拼半张账）。
- **新鲜度环路（v2 补，P8 可达性核心）**：
  1. 装配层对 bootstrap 集合（§1.3）每 workspace **常驻** watchSessions（持有者=装配层注册的 disposer，不走引擎 watcher 清零语义——零 watcher 时不拆）；
  2. sessions-index delta / tasks-index 变化回调 → 调 host face 新入口 `refreshInventory()` → 服务重 publish；
  3. **节流**：refresh 最小间隔 30s（kv 可调）——高频会话帧不放大 publish。
- **多窗口一致性（v2 登记）**：Local Host 是 window-scoped，各窗口各自装配——inventory 视图=**本窗口 host 可见域**（AGENTS 红线内的一致性口径），跨窗口不承诺同视图；mate.sqlite 事实（工单）天然共享。

### 1.3 workspace bootstrap（v2 补，破循环依赖）

订阅需要 workspace 集合，而集合一半要靠订阅后发现——破环顺序：

1. **初始集合** = mate.sqlite 近 14d 工单的 target workspace ∪ taskIndexRepo 可枚举的项目集（不依赖 sessions-index）；
2. 逐 workspace 常驻订阅（§1.2）；
3. **动态发现**：任一订阅的 delta 中出现新 workspace 引用（如 team 成员跨域）→ 加入集合+补订阅（有界：集合 ≤16 workspace，超界最久未活动者退订）。
4. 冷启动（订阅快照未 ready）→ UI 总览卡显示"投影就绪中"态（与"无工作"空态区分）。

### 1.4 台账模型与契约

```
MateWorkInventoryView = { workspaces: [{ key, rows: WorkRow[] }] }
WorkRow = { kind: "ticket"|"session"|"offpeak", ...每类有界字段, managed?: boolean }
```

- 契约：`mateWorkInventorySchema`（zod strict）；界 `ASSISTANT_SNAPSHOT_LIMITS` 扩 `inventoryWorkspaceMax=6 / inventoryRowMax=20 / inventoryWorkspaceSetMax=16`；快照 `inventory?`（可选追加）。
- managed 标记：sessionId ∈ 活动工单 incarnation.sessionId 集合。
- 组装纯函数 `workInventory.ts`（host 侧消费三源快照 → 视图；幂等；测试落点=host 侧测试，照 mateWatchdogCron.test 先例）。

### 1.5 项目清单：自举不注册（维持 v1）

集合=§1.3 bootstrap 结果；无独立注册表；排除清单留 P10。

### 1.6 query work scope + 台账速览升级

- `query_status` 新 kind `"work"`（±workspaceIdentity）：应答器读 inventory（缺席回落工单账并注明"仅工单视角"）。
- `composeLedgerDigest` 升级消费 inventory；**速览界新常量** `ledgerDigestInventoryMax=600`（进 SNAPSHOT_LIMITS，v1 写死的 400 是工单速览界——两界并存）。

### 1.7 UI（v2 微调）

- `MateWorkOverview.tsx` 总览卡（面板顶部）：每项目一行（kind 徽标计数/最近活动/停滞点/managed 标记），展开行列表；**就绪中/无工作/缺席（旧 Host）三态区分**；行点击：ticket→详情、session→onOpenMateSession 既有导航、offpeak→任务中心。
- 桌宠速览不加区（维持 v1：桌宠是大副的窗口，不是所有工作的窗口）。

### 1.8 P8 验收（v2 标注测试落点）

| 项 | 落点 |
|---|---|
| workInventory 组装纯函数（合并/managed/有界/动态发现） | host 侧测试 |
| bootstrap 集合推导（工单∪tasks-index/退订界） | host 侧测试 |
| 快照 inventory 投影/缺席语义 | 服务单测 |
| queryReply work scope（全域答案/回落） | 服务单测 |
| 总览卡三态/行点击 | MSA15 资产 |

## 2. P9 · 自主节奏层（Autonomy Loop）

### 2.1 自主评估循环（v2 定案执行归属）

```
心跳（watchdog cron tick 触发，自主轮 fire-and-forget 独立 face 入口——
      不进 watchdog await 链防串行阻塞；kv autonomy_interval_ms 缺省 30min 节流）
  → 组装全域速览（composeLedgerDigest 升级版）
  → 直调 router port（自主评估输入 = 速览 + 自主约言段，含显式标记
     "本输入为自主评估"防与候选卡轮约言互扰）
  → autonomyVerdictSchema.safeParse（独立 zod——非 routerDecisionSchema 第六臂，
     五臂恰现其一的 refine 与三臂解析互不掺和）
  → 三臂出口（见 §2.2）
```

**执行归属（v2 钉死）**：自主轮**不写 router_evaluation 表**（该表以 decision_id 为主键，自主轮无 decision——不挂账）；解析失败=quiet + warn 日志（不落 failed、不进 Tier3 语义）；**不计入 Router 轮转计数**（ticketsSinceRotation 只数候选卡轮——自主轮是观察不是工作）；评估输入走当前活跃 Router 会话追加轮（轮转/换代语义照旧）。

### 2.2 三臂与三个受控出口（v2 修订 suggest 建卡）

| 臂 | 出口 | 打扰语义 |
|---|---|---|
| quiet | 无动作 | 零 |
| report | 产出文本 → admitDisturbance(kind=report) 过闸 → **watchdog 同款快照通知区**（既有 watchdogNotices 面+MateDigestCard 呈现）+ 桌宠气泡（差分源扩 report 帧） | 可抑制（超额聚合 pendingDigest） |
| suggest | **独立建卡事务**（见 §2.2.1） | decision 计数必答 |

**v2 落地面收敛（原"三通道"两半不存在）**：report 落地=watchdog 通知区（零新面）+气泡（差分源小改）；桌面系统通知与 Source 晨报订阅**移 P11**（主动推送通道批——spec §2.3 既有登记）；pendingDigest 是超额聚合非投递兜底（v1 风险表措辞错误已正）。

#### 2.2.1 suggest 独立建卡事务（v2 全新，P0/P1 闭合核心）

```
db.transaction:
  INSERT trigger(id, source_kind='autonomy', simulated_strength='autonomous',
                 identity=localIdentity, text=suggest.brief, at_ms=now)
  INSERT admission_decision(trigger_id, strength='autonomous', mode=当前模式,
                 outcome=decision_card, decided_by=gate)
  admitAssistantDisturbanceTx(kind=decision)   // 同事务计数（recordTrigger 同款）
kv: autonomy_muted:<对象hash> = now + 24h       // 建卡即写冷却（不依赖用户忽略）
```

- **不调 scheduleRouterEvaluation**——autonomy 卡**不进候选卡评估循环**（P0-1 闭合：auto 模式下无任何 autoDispatch 消费路径；卡上 routerState 天然缺席=无建议区，人工终审照常）。
- `ASSISTANT_SOURCE_KINDS` 扩 `autonomy`（contracts 单出处；列值枚举非 schema 约束，无迁移）；strength 字面量 `autonomous` 如实标注（不伪称 explicit）；快照/决策卡 UI sourceKind 徽标消费方同步。
- **验收补强**：auto 模式下 autonomy 来源 decision 无任何自动建票路径（对 autoDispatch 全臂断言）；建卡不触发 Router 评估（scheduleRouterEvaluation 零调用断言）。

### 2.3 防打扰五闸（v2：四闸→五闸）

1. 配额闸（report 可抑制/suggest 计数）；
2. 速览指纹去重 24h——**hash 输入域（v2 钉死）**：对象集合（workspace/工单 id/会话 id 的排序序列）+ 状态摘要，**排除一切时刻类字段**（否则任何活动都破坏去重）；
3. **建卡即写对象冷却**（§2.2.1，24h——闭合"用户不在场 suggest 连发"）；
4. 否定记忆（用户忽略 → 48h 不再对该对象 suggest）；
5. 总闸：autonomy_enabled（缺省 true——用户裁定"大副自己决定"即期望开启；**首启告知**：首次心跳产一张一次性告知卡"自主观察已开启，可随时在设置关闭"）。

### 2.4 mode 联动（v2 补，P1-4 闭合）

| mode | 自主循环 |
|---|---|
| off | **整体停跳**（含评估读——off=大副不下场，含读零执行） |
| observe | autonomy_enabled 控制 |
| auto | autonomy_enabled 控制（suggest 卡不进 auto 放行链——§2.2.1） |

### 2.5 P9 验收（v2 标注落点）

| 项 | 落点 |
|---|---|
| autonomyVerdict 三臂 schema/失败=quiet | 服务单测 |
| 心跳节流/mode 联动（off 停跳） | host 侧测试 |
| report 过闸落通知区+气泡差分 | 服务单测+seam |
| suggest 建卡事务（source_kind/decision 计数/冷却即写/不进评估循环/auto 无消费） | 服务单测（§2.2.1 补强断言） |
| 设置区+autonomy 徽标+首启告知卡 | MSA16 资产 |

## 3. 分批与工作量（v2 重估）

| 批 | 内容 | 预估 |
|---|---|---|
| P8a | 契约+provider 端口+常驻订阅+bootstrap+刷新环路+组装纯函数+host 测试 | 1 天 |
| P8b | query work scope+速览升级+MateWorkOverview UI+MSA15 | 0.5 天 |
| P9 | 自主循环（独立 schema/建卡事务/五闸/通知区+气泡/设置区）+MSA16 | 1.5-2 天 |

依赖：P8a→P8b→P9。工作量较 v1 上调（审查 P2-5：v1 漏常驻订阅管理/建卡事务/评估归属等必做件）。

## 4. 风险与对策（v2 补三行）

| 风险 | 对策 |
|---|---|
| 自主层变话痨 | 自主约言"默认 quiet，只有用户不回应就会损失什么时才开口"；五闸；总闸一键关 |
| **冷启动投影未就绪与无工作混淆** | 总览卡三态区分（§1.7） |
| **多窗口 inventory 一致性** | 视图=本窗口 host 可见域（§1.2 口径登记） |
| 自主评估 LLM 成本 | 30min 心跳+速览有界+quiet 预期占绝大多数+关即零成本 |
| **快照高频序列化 inventory** | 装配层缓存+变更指纹跳过（组装输出 hash 未变则复用引用） |
| tick 串行阻塞 | 自主轮独立 face 入口 fire-and-forget（§2.1） |
| "接管"措辞误解 | spec 钉死"只读观察+人工确认"；MSA16 断言无自动路径 |

## 5. 登记与不做

spec §12（全域台账）+§13（自主节奏，修订版）+§14 P8/P9 行；CONTRACT ×2；matrix MSA15/16。不做：固定晨报（用户裁定）；项目注册表；日历/邮件/桌面通知/Source 晨报订阅（P11）；git 信号（独立小批）；手机推送（P11）。

## 6. v2 修订记录（审查 findings → 处置）

| finding | 处置 |
|---|---|
| P0-1 auto 自批环路 | §2.2.1：autonomy 卡不进候选卡评估循环+验收补强断言 |
| P1-1 inventory 接缝 | §1.2：provider 端口+extras 注入+缺席=全有或全无 |
| P1-2 新鲜度环路 | §1.2：常驻订阅+delta/tasks 回调→refreshInventory+节流 |
| P1-3 bootstrap 循环依赖 | §1.3：工单∪tasks-index 初始集+动态发现+退订界 |
| P1-4 off 行为 | §2.4：off 整体停跳矩阵 |
| P1-5 建卡路径 | §2.2.1：独立事务+枚举扩展+strength=autonomous+同事务计数 |
| P1-6 评估归属 | §2.1：不写 router_evaluation/不计轮转/独立 schema/防约言互扰标记 |
| P1-7 suggest 连发 | §2.3 闸 3：建卡即写冷却+hash 输入域钉死 |
| P2-1 推送面虚指 | §2.2：收敛通知区+气泡；桌面/Source→P11；pendingDigest 措辞正 |
| P2-2 tick 阻塞 | §2.1：独立 face fire-and-forget |
| P2-3 冷启动/多窗口 | §1.7 三态+§1.2 口径+§4 两行 |
| P2-4 验收错位 | §1.8/§2.5 落点标注 |
| P2-5 工作量 | §3 重估（P8a 1 天/P9 1.5-2 天） |
| P3-1/2/3/4/5 | 速览界新常量（§1.6）/评估标记（§2.1）/序列化缓存（§4）/首启告知（§2.3 闸 5）/编号无冲突（核实） |
