# 08 · 对话式查询与管理（2026-11-06 设计批，未实施）

## 0. 背景与问题定义

用户问「xx 项目当前的进度怎样？」时，大副把它**当作任务原文路由出去**（attach/dispatch→worker 作答→汇报卡回流）——语义错位：进度事实全量在账（快照/工单/usage），却缺少"查询直答"的对话式出口。对照 DSH super-agent：其 Router 带 14 工具（含 bash），可查账后口头回答、对话即管理——大副在 P2 裁剪掉了工具面（spec §11「Router 无自定义工具面，白名单随 (b) 路线（若启用）一并交付」）。

本批兑现 (b) 路线，**混合两路径**：

- **路径 B（query_status 第五臂）**：Router 判定"查询类意图"→ 输出 `query_status` 臂 → **host 确定性应答器**直查账本、模板化组答案 → 状态答复卡直呈（不建票、不派 worker、不过 Mandate）。覆盖高频：进度/状态/成本/摘要。
- **路径 A（mate_* 只读工具白名单）**：Router 在**判定臂之前**可用 `mate_list_tickets`/`mate_get_ticket`/`mate_get_usage` 三件只读工具**感知账本**（比如判定"该 attach 谁/这句话是不是查询/那个失败的是什么"）。**工具只做判定辅助，出口统一走 query_status 确定性应答**——Router 工具查到的中间数据不直接出口（防幻觉账本：答案永远与账本一致，因为答案由 host 生成而非 LLM 转述）。

### 红线（不因本批松动）

- **写操作不走对话**：停止/派发/换代/切模式仍走决策卡/面板/托盘人工确认——Router 工具面**零写工具**，「把 xx 停了」类请求由约言引导至面板（query_status 答案尾部附指引）。
- **Router 永不执行**：五臂仍是纯决策 schema；工具是"看"不是"做"。
- **off 零执行包含读**：off 模式下 query 触发也只记 ignored（矩阵一致，无特例逃逸）。

## 1. S0 探查结论（2026-11-06 实证）

| 问题 | 结论 | 影响 |
|---|---|---|
| createSession config 支持 mcpServers？ | **不支持**（`create-session-config.ts` 字段集：modelSelection/provider/model/thought/followupMode/mode/planEnabled） | A 路径不能走 createSession 挂载 |
| CLI 的 MCP 装载机制？ | **插件系统**：`adapters/src/plugins/mcp.ts` 读插件 `manifest.mcpServers`（stdio/http/sse；stdio 需 command 在插件 root 内） | A 路径载体=**Mate 状态插件**（manifest.mcpServers 声明 stdio server）或 workspace 级 MCP 配置（若 CLI 另有非插件配置面——批 2 开工前补一次实读定夺） |
| 仓内 MCP server 实现先例 | services 层有 MCP 数据同步消费面（mcpDataSync.ts）；**host 侧自起 stdio MCP server 无先例** | 批 2 需新增 server 骨架（SDK `@modelcontextprotocol/sdk`，仓内已有依赖面待确认） |

## 2. 架构总览

```
「xx 进度怎样？」
   │ recordTrigger / Source ingest（既有链不变）
   ▼
 准入门（矩阵不变；off→ignored）
   ▼
 Router 候选卡循环
   │  ┌─ A：判定期可用 mate_* 只读工具感知（list/get_ticket/get_usage）
   ▼  ▼
 RouterDecision 五臂（zod 互斥）
   ├─ dispatch / attach / hold / reject（既有，不变）
   └─ query_status ──► host 确定性应答器（服务纯函数）
                          │ scope: status|ticket|usage|digest
                          ▼
                    读快照+账本 → 模板组答案（有界）
                          ▼
              ┌───────────┴───────────┐
        面板「状态答复卡」          Source 回复端口
        （决策卡区，只读）        （飞书/GitHub 问的→回原通道）
```

## 3. 路径 B 详细设计：query_status 臂 + 确定性应答器

### 3.1 契约扩展（只加不破）

- `routerDecisionSchema`：四臂 → **五臂**（互斥 refine 更新）。query_status 臂形状：
  ```ts
  {
    kind: "query_status",
    scope: {
      kind: "status" | "ticket" | "usage" | "digest",
      workspaceIdentity?: string,   // status/digest 域
      ticketId?: string,            // ticket/usage 域
    },
    reason: string  // ≤80 字（判给依据，同既有臂）
  }
  ```
- `ASSISTANT_OUTCOMES` 增 `statusReplied: "status_replied"`（查询直答的 decision 终态——不是决策卡、无人工动作、不进放行率/不进 decision 配额计数：用户主动问的直答不是打扰）。
- **迁移 v7**：`router_evaluation` 表加列 `answer_text`（nullable TEXT，query 臂专用；有界 replyTextMax=800）。四臂既有行为零改动。

### 3.2 应答器（服务纯函数 `queryReply.ts`，新文件）

输入 scope → 单事务读快照数据 → 模板组答案（**zh/en 按触发来源语言**：面板=host 缺省 zh 可配置；Source=事件原语言——scope 外部再传 locale）。四种 scope 的答案形状：

| scope | 数据源 | 答案模板（示意） |
|---|---|---|
| `status`（workspace） | 该 workspace 活动/排队/待决策/最新终态 | 「ws-a：进行中 2（修复登录 running·B·14:32；回归 queued），最近完成 1（成功：完成摘要），待决策 0」 |
| `status`（无域=全局） | 全量计数+最活动 3 行 | 「大副当前：进行中 2 / 排队 1 / 待决策 1；最活动：…」 |
| `ticket` | 单票详情：状态/代际数/锚/最新汇报/**fail_reason** | 「T-abc（修复登录）：第 2 代 running；上一代汇报：…；失败原因：…（若 failed）」 |
| `usage` | 单票按代 usage（复用 usageByGeneration 投影） | 「T-abc 累计：输入 12.3k/输出 4.5k/cache 读 8k 写 1k；第 1 代 …、第 2 代 …」 |
| `digest` | 近 7 日终态工单+usage 合计 | 「近 7 日：完成 5/失败 1；花费输入 88k/输出 30k；逐条：…」 |

边界：查无此票/空 workspace → 诚实空态文案（「该 workspace 当前没有大副工单」）；答案**零 LLM 加工**（host 生成，与账本恒一致）；全部有界（textMax 800）。

### 3.3 评估循环落点（routerEvaluation.ts 扩）

Router 评估完成、verdict 过 schema 后：

- `query_status` 臂 → 调应答器 → **同事务**落 `admission_decision.outcome=status_replied` + `router_evaluation.answer_text` → publish（**不进决策卡集、不排 worker、不建票**）。
- 其余四臂走既有链不变。auto 模式下 query 臂**同样直答**（读操作无执行语义——auto/observe 行为一致；这是 §6 矩阵的读特例注记，不是提权：query 不改变任何状态）。
- 路由约言更新：判给指引（进度/状态/花费/摘要类意图→query_status 对应 scope；带"去做/去修/去查一下"的执行意图→dispatch/attach；管理写意图（停止/切换）→ reject + reason 引导面板）。

### 3.4 快照投影与 UI

- 快照：`decisions[]` 投影在 `outcome=status_replied` 时带 `answer`（answer_text 有界截断）+ `routerSuggestion.kind="query_status"`（投影字段可选追加）。
- UI（`MateQueryReply.tsx` 新组件，决策卡区渲染）：只读卡——问题原文首行+答案+数据时刻；无任何动作按钮（不建票不可放行）；dismiss 出清（同观察行语义，outcome 改 ignored）。i18n 双语（标题/空态/dismiss）。
- 桌宠：**不出气泡**（非汇报，不打扰）；速览不加区（答复在面板，点卡直达详情链路不适用）。

### 3.5 Source 出口

飞书/GitHub 的 query 触发：应答器产出后经**既有 AssistantSourceReplyPort** 外发答案文本（端口语义从「终态回复」扩为「终态回复+查询答复」；幂等键=decisionId）。手机通道答复回流面板（无主动外发面——登记边界）。

## 4. 路径 A 详细设计：mate_* 只读工具（批 2，依赖载体定夺）

### 4.1 工具面（三件，全只读，仅 Router 会话挂载）

| 工具 | 入参 | 出参（有界） |
|---|---|---|
| `mate_list_tickets` | `{status?: 活动集|终态, workspaceIdentity?, limit≤20}` | 工单行数组（id/status/brief 首行/目标/updatedAtMs/代数） |
| `mate_get_ticket` | `{ticketId}` | 详情（+最新汇报/fail_reason/锚 commandId/dispatchMode） |
| `mate_get_usage` | `{ticketId}` | 累计四字段+按代分解 |

数据面全部**复用快照投影**（同一 SQL 口径，不建第二读路径——经服务内部入口读，不经 channel）。

### 4.2 载体（批 2 开工前定夺，二选一）

- **方案甲（插件式，倾向）**：Mate 状态插件（manifest.mcpServers 声明 stdio server，command=插件内 node 脚本）——走 CLI 插件装载正路（S0 已实证 stdio 支持）；server 进程读 mate.sqlite（**只读连接**，`mode=ro`——与 TicketService 唯一写者并行安全，WAL 下读写不互斥）。Router 会话如何只给自己挂：CLI 插件是 workspace 级——**mate-home 虚拟 workspace 的插件目录**放该插件（Router 会话 workspace=mate-home → 只它装载）。需 S1 探查：CLI 插件发现是否覆盖 mate-home 路径（bootstrap 插件 roots 实读）。
- **方案乙（进程内直连）**：若插件路径不通——Router 约言内嵌「状态摘要快照」（每次候选卡附带当前账本摘要，退化感知，无工具）——降级方案，能力弱于甲但零新进程。

### 4.3 约言与安全

- 候选卡路由约言追加工具使用指引：**判定需要账本事实时可调用 mate_\*（只读）；答案不引用工具中间输出——最终答复由系统按你的 query_status 判定生成**（防 Router 把工具数据当答案转述）。
- server 进程纪律：只读连接、无写接口、输出有界、退出随 Router 会话终态（进程生命周期绑定 CLI 插件宿主）。

## 5. 与既有机制的交互核对

| 机制 | 交互 | 结论 |
|---|---|---|
| 准入矩阵 | query 触发照常过门（off→ignored；observe/auto→决策/评估链） | 矩阵不变，query 是评估产物不是门特例 |
| 配额中心 | status_replied 不计 decision（非决策卡、用户主动问的直答）；Source 答复外发不计 report（同终态回复既有语义） | 不新增打扰面 |
| 信任门 | status_replied 不进放行率分母/分子 | 口径不被污染 |
| 代际/锚 | query 不触碰 incarnation（不建票不投递） | 零交互 |
| auto 模式 | query 臂直答（同 observe）——读操作 | spec §6 补读特例注记 |
| Router 轮转 | 轮转建新会话；批 2 甲方案下插件随 mate-home workspace 重新装载 | 无残留态 |
| 唯一写者 | 应答器只写 router_evaluation.answer_text（同一事务、同一模块） | 不破例 |

## 6. 实施分批

### 批 1（B 路径，独立可用，无外部依赖）——预计 1 个工作日

| 文件 | 动作 |
|---|---|
| `shared/contracts/assistant.ts` | OUTCOMES+statusReplied；REPLY_LIMITS（replyTextMax 800） |
| `shared/…/routerDecision.ts`（services 侧） | 五臂 schema+互斥 refine |
| `services/…/assistantDatabase.ts` | 迁移 v7（router_evaluation.answer_text） |
| `services/…/queryReply.ts` | **新**：应答器纯函数（四 scope×空态矩阵） |
| `services/…/routerEvaluation.ts` | query 臂落点（同事务 outcome+answer）+发布 |
| `services/…/routerShell.ts` | 约言更新（判给指引+写意图引导） |
| `services/…/assistantSnapshot.ts` | decisions 投影 answer（可选追加） |
| `ui/mate/MateQueryReply.tsx` + view-model + i18n | **新**：状态答复卡（只读+dismiss） |
| `ui/mate/MateSidePane.tsx` | 答复卡入决策卡区渲染 |
| `sources/sourceRegistry.ts` | 回复端口触发点扩 query 答复 |
| spec §6/§11/§14 + 08 文档定稿 + CONTRACT×2 + matrix | 登记 |

**测试计划**：queryReply 单测（四 scope×空态×有界×语言）；routerDecision 五臂互斥；routerEvaluation query 落点（不建票/不进决策卡集/不计数）；快照投影；MateQueryReply 渲染（fixture 扩+MSA14 资产：观察模式问进度→秒级答复卡出现、无工单产生）；Source 答复外发单测；五资产回归。

### 批 2（A 路径，S1 探查后启动）——预计 1-1.5 个工作日

S1 探查项：CLI 插件发现是否覆盖 mate-home；MCP SDK 依赖面。然后：Mate 状态插件（manifest+stdio server 三工具+只读连接）+ 约言工具指引 + server 单测（工具矩阵/有界/只读连接）+ 安全审查（无写面）。

### 批 3（登记不做/后置）

桌宠 query 快捷口（语音/气泡回复形态——等产品规则）；自由问答出口（Router 组织语言——**明确不做**，答案恒 host 确定性生成）；手机答复外发。

## 7. 验收（批 1 完成即达成主目标）

1. 观察模式面板问「xx 进度怎样」→ **秒级**状态答复卡（无 worker 派发、无工单、无决策卡）——MSA14 实跑锁定。
2. 答案与面板事实**恒一致**（同一快照读点）——应答器单测+「零 LLM 加工」设计保证。
3. 飞书问进度 → 答案回飞书（ReplyPort 单测）。
4. auto 模式行为一致；off 仍全静默。
5. 既有四臂/放行/信任门统计**零漂移**（全量回归）。
