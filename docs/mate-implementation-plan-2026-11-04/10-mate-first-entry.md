# 10 · 大副对话面与入口倒转（P10a/P10b，2026-11-07 设计 v1）

> **设计动因（用户裁定 2026-11-07）**：大副不应是 harness 的又一个功能点，而是**harness
> 之上的入口层**——用户与 agent 的交流倒转为用户与大副交流，大副代理管理既有的多项目/
> 多会话/多 agent/多任务。同日双路能力审查结论：管理面（台账/派发/看护/节奏）已建成，
> **入口倒转未实现**（主 composer 直连会话、大副无对话面、spec §2「五入口」的「桌面对话」
> 未兑现）。本批补入口层，不动核心链路。

## 0. 设计原则（承接既有红线，新增两条）

- **对话=台账的消息投影**（「所有面是 TicketService 快照的投影」的延伸）：对话流不是新
  状态所有者，是 trigger/decision/reply 的时间线投影；单一写者（mate.sqlite 事务）不变，
  对话组件零本地业务态（复用 mateStore 局部态纪律）。
- **双脑禁令**：对话中不存在「自由人格文本」与「结构化决策」两套真相——一切**写意图**过
  准入门（trigger→gate→五臂评估→卡/直派），一切**读意图**走确定性应答（四 scope）或标记
  聊天轮（§2.2）；assistant preset **永无工具**（含聊天轮），答案永远源于账本或标记轮，
  不存在 LLM 转述账本的可能。
- 倒转入口不动在途会话：Mate-first 只倒转**新任务的发起**（草稿态提交），在途会话消息
  仍直连（「投影不等于接管」红线原样保持——它保护的是"大副不动你正在用的会话"）。
- off=对话面只读（含读零执行不变）。

## 1. 现状与差距（为什么是这三件）

| 愿景要素 | 现状 | 缺口 |
| --- | --- | --- |
| 和大副交流 | 面板双按钮//mate 命令/Source——触发面碎片化、结构化卡片无对话流 | 对话面（本批 P10a） |
| 新任务默认经大副 | /mate 是显式 opt-in；草稿提交直建会话 | Mate-first 路由开关（本批 P10b） |
| 大副=一级入口 | 面板藏在 side pane launcher | 主区/全局入口（P10c 评估后置，§5） |

**已具备、本批零改动的地基**：recordTrigger→gate→scheduleRouterEvaluation 链
（triggerRecord.ts:212 落卡即调度评估）；五臂 verdict 落 router_evaluation
（query 臂 answer_text 通道现成，routerEvaluation.ts:137-171）；auto 模式
autoDispatch 直派+告知卡；P8 全域台账；P7 四 scope 确定性应答；配额三端同源。

## 2. P10a · 大副对话面

### 2.1 对话流形态（Surface A 兑现）

面板（MateSidePane）顶部新增「对话」区，消息流四类：

| 消息类型 | 数据源（快照/台账既有字段） | 渲染 |
| --- | --- | --- |
| 用户消息 | trigger（text verbatim、at_ms、sourceKind） | 右侧气泡 |
| 决策卡 | decision（outcome=decision_card 未决；routerSuggestion 建议区） | 内嵌卡（Y/N/E 按钮+证据）——Surface A 原设计语义 |
| 答复 | decision（outcome=status_replied，answer） | 左侧气泡（原 MateQueryReply 卡内容的对话化；卡区不再重复渲染 status_replied） |
| 工单摘要行 | ticket 终态/换代（status、fail_reason/output_summary 首行、generationCount） | 单行+进详情链接（汇报卡完整版留在工单区） |

- composer：单行输入（一期纯文本，**无附件**——附件/图片触发随二期）；发送=
  `recordTrigger(text, simulated="explicit", target=当前组键)`——与 /mate 命令拦截
  完全同链（能力审查修复批已验证的路径）。
- 既有「待决策」卡片区保留=**收件箱视角**（与对话流同源同卡不双写；对话流含全部，
  卡区仅未决）。
- 时间呈现照桌宠纪律：绝对时刻不做相对时长（纯 DOM 零定时器）。

### 2.2 意图分流（谁答消息——全部复用五臂，仅扩一个 scope kind）

```
用户消息 → recordTrigger(explicit) → gate →（observe）决策卡+调度评估
                                                    ↓（auto：autoDispatch 直派+告知卡）
        Router 五臂评估（既有）
        ├─ build/attach → 建议落卡（对话流内嵌卡，人工 Y/N）
        ├─ hold/reject → 卡（理由；写意图引导）
        ├─ query_status{status|ticket|usage|digest|work} → 确定性应答（零 LLM，账本直读）
        └─ query_status{kind:"chat"}（**本批新增**） → 聊天轮（下）
```

**chat scope kind（新增，唯一的新服务面语义）**：
- 判定：Router 评估判定「非四 scope 的读意图」（闲聊/咨询/泛问题）时输出
  `query_status{scope:{kind:"chat"}}`——判定权在 Router LLM（与四 scope 同一约言域）。
- 执行：评估循环不走 composeQueryReply，改调 **router port 新入口 `chat(text)`**——
  同一 Router 会话追加「聊天轮」：输入=用户问题+聊天轮约言（自由作答 ≤800 字、无工具、
  不承诺执行、涉及工单操作时引导走任务/面板），输出=自然语言（**非 zod 五臂解析**——
  本来就是自由文本，只做 800 截断，无失败态）；轮上带互扰标记（自主轮同款）+
  **不计轮转**（ticketsSinceRotation 只数候选卡轮不变）。
- 落账：answer 写 router_evaluation.answer_text（query 臂同列），decision outcome=
  status_replied（reason_code="chat_replied" 与确定性 query 区分）；对话流渲染为答复气泡。
- 串行：与评估共用既有串行化队列（node.ts Router port 串行不变，聊天轮不与评估重叠）。

### 2.3 mode 矩阵（对话面下）

| mode | 读意图（四 scope） | chat 轮 | 写意图 |
| --- | --- | --- | --- |
| off | composer 禁用+提示（含读零执行） | 同左 | 同左 |
| observe | 确定性直答（P7 读特例延续） | 聊天轮直答 | 决策卡（Y/N 内嵌对话流） |
| auto | 确定性直答 | 聊天轮直答 | autoDispatch 直派+auto_notice 告知卡内嵌 |

摩擦复核结论：observe 档读/chat 零摩擦、写一卡——**不新增档位、不调信任门阈值**；
对话流把卡的 Y/N 内嵌到交流现场即为本批的全部摩擦优化（跨卡 Y/N/E 全局键盘流维持
P3 遗留登记，本批不做）。

### 2.4 数据与分页

- 新服务只读方法 `readMateThread({workspaceKey?, limit=50, beforeMs?})`：SQL 合并
  trigger+decision+ticket 终态行 按时间倒序取、正序返回；快照 triggersMax=50/decisions
  截断版仍作首屏，上滑加载走本方法。**只读**（单写者纪律；照 getConfig 先例开在
  channel 面）。
- 诚实裁剪：换代事件不逐条入流（快照无逐代时刻列）——工单行携带 generationCount，
  摘要行如实标注「第 N 代」，不伪造逐事件时间线。

### 2.5 不做（登记）

附件/图片触发（二期——CommandInbox 附件面另议）、语音（随 voice-agent spec）、
聊天轮工具（assistant preset 永无工具，红线）、主区 workspace 入口（§5 P10c）。

## 3. P10b · Mate-first 路由（新任务默认经大副）

- 配置：kv `mate_first_routing`（bool，缺省 **false**）；设置区新开关「新任务经大副」
  （MateConfigSection 模式行邻位；bounds 无数值界）。
- 语义：开启后，**工作区 composer 草稿态**（无在途会话的新对话）提交 →
  `recordTrigger(explicit, target=该 workspaceKey)` + 打开大副面板——完全复用
  /mate 命令拦截链（SessionPane 提交路径、mateSlashCommandAvailable 同族门控+配置读）。
- **恒直连（不拦截）**：在途会话消息；slash 命令（CLI catalog 与 App 命令优先——
  /team//side//mate 照旧）；带附件提交（一期纯文本门，照 /side 附件让位规则）；
  readOnly 与服务位缺席（Web/手机壳诚实降级为直连）。
- 关闭即时生效（kv publish 链既有）。
- 红线复验：不拦截既有会话（投影不接管保持）；拦截产物是 trigger（进准入门），
  不是绕过 gate 的任何路径。

## 4. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 双脑（人格文本 vs 结构化真相） | §0 双脑禁令：写意图唯一出口=准入门；聊天轮无工具无承诺话术（约言钉死）；确定性应答优先 |
| 聊天轮答案漂移（承诺执行/编造工单） | 聊天轮约言明令「不承诺执行、涉及工单只引导」；answer 800 截断；reason_code 区分可审计 |
| 对话流刷屏/打扰 | 对话流是拉取视图非推送——与配额闸无交集；气泡/通知照旧过闸 |
| Router 会话上下文被聊天轮污染 | 互扰标记（自主轮同款先例）+不计轮转；轮转簿记照旧按候选卡轮数 |
| 评估时延体感（chat 需 LLM 轮） | 四 scope 确定性直答零 LLM（绝大多数问询）；chat 轮时延=一次 Router 追加轮（与评估同级）；对话流发出口即时出「已记录」用户气泡（本地乐观投影=trigger 落库确认，非伪造回复） |
| mate.sqlite 聊天轮增长 | 与工单账同策略（现状均无清理窗口）；retention 统一随 P11 议，本批不单独发明 |
| /mate 命令与 Mate-first 双入口语义重叠 | 无冲突：/mate=按次显式；Mate-first=默认态；两者同链同语义（都进准入门） |

## 5. P10c · 主区一级入口（登记后置，不随本批）

愿景终态=workspace 栏首项「大副」常驻（对话为主区视图）。主区 pane 现皆为会话视图，
非会话主视图=壳层手术（WorkbenchPane binding 家族）；一期以 side pane 对话+
双入口（/mate 命令、launcher）逼近，P10c 随真机手感单列评估——**触发条件登记**：
对话面日均使用 ≥ 其他 workspace（遥测/本地计数另议）或用户明确要求。

## 6. 分批与工作量

| 批 | 内容 | 预估 |
| --- | --- | --- |
| P10a-1 服务面 | chat scope kind+router port chat 轮+readMateThread+快照卡区过滤 status_replied 调整+单测（chat 判定/截断/不计轮转/mode 矩阵/分页） | 1 天 |
| P10a-2 UI 面 | 对话流组件（四类消息+composer）+卡内嵌+MSA18 资产+i18n | 1-1.5 天 |
| P10b | mate_first_routing+SessionPane 复用拦截+设置开关+单测 | 0.5 天 |

依赖：P10a-1→P10a-2→P10b（P10b 独立于 a-2 可并行）。

## 7. 登记与不做

- spec：§2「五入口」桌面对话兑现注记（P10a）+§14 P10 行；CONTRACT ui-mate/services
  增量；matrix MSA18（对话流四类消息/Mode 矩阵/Mate-first 拦截）。
- 不做汇总：附件触发（二期）、主区入口（P10c 条件触发）、语音（voice-agent）、
  跨卡键盘流（P3 遗留维持）、聊天轮工具（永不做，红线）、retention（P11 统一）。
