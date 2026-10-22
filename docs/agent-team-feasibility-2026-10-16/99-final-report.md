# Drora「Agents Team」可行性调研报告

- 日期：2026-10-16
- 性质：纯设计调研。材料一载明：本调研未做任何代码改动，未运行 typecheck/lint（无改动可验）。
- 证据来源约定：文中 `path:line`、grep 命令与输出均转引自本次调研的给定材料（材料一～五）。其中仓内分析所载 `pnpm architecture:check --changed`（输出 `architecture: OK / violations: 0 / baseline: 0 / new: 0`）与 `node scripts/check-workspace-freshness.mjs` 系分析会话执行的结果，非本报告撰写会话执行；本撰写会话仅按 AGENTS.md 开工纪律复跑了 freshness 检查，输出与材料三所载一致：`[freshness] 基线新鲜：main（与 origin/main 同步），相对 origin/main：ahead 431 / behind 0（阈值 50）`。
- 材料构成：材料一（定稿方案 v3 全文，本报告第 4、5 章主体）；材料二（外部调研，4 个对象组，第 2 章来源）；材料三（仓内分析，3 个分析域，第 3 章来源）；材料四（关键论断复核，5 条，第 6 章来源）；材料五（终审未复审的中高问题 2 条，第 7 章来源）。

## 目录

1. 背景与目标
2. 主流框架与产品的 team 设计点
3. Drora 仓库现状（三个分析域）
4. 可行性结论
5. 推荐方案（定稿 v3）
6. 关键论断复核结果
7. 终审与评审处理情况
8. 参考来源

---

## 1. 背景与目标

### 1.1 背景

- Drora 是官方 ZCode 的复原与改名版（AGENTS.md「上游对齐与模块化扩展」节），官方上游（zai-org/ZCode 与 3.14.x 发行 bundle）仍在演进。按仓库纪律，新增功能必须以「模块化、可跟踪」的方式叠加：自研内容放独立文件/模块、经 ports/服务注册/协议方法接入现有链路，并在 specs/ 留决策记录与接缝重放方式。
- 本次调研主题为「Agents Team」：在现有「单 lead 会话 + 一次性子代理（Agent 工具/Explore）」模型之上，引入命名、长寿命、可寻址的团队成员（teammate）、共享任务板与成员间消息的多代理协作能力。
- 上游核查结论（材料三分析域一、材料四复核 confirmed，见 §3.1.7 与 §6.1）：官方 ZCode 上游（3.14.3 发行 bundle + v3.15.1 对齐源码 + web snapshot）经穷尽 grep 实证**无任何 team/teammate/swarm/crew 多代理协作协议面**——agents team 是纯 Drora 自研增量，无上游实现可借，必须完整自研 spec 与模块化落地。

### 1.2 目标

1. 判定可行性：Drora 现有架构（单进程 in-process 子代理 + Host 单所有者 + renderer 多视图投影）能否承载 agents team。
2. 汇总主流框架与产品的 team 设计点，提炼可借鉴机制与应规避的反面证据。
3. 摸清仓库现状底座与缺口（Agent 运行时 / 协议与 UI 面 / 架构治理三个分析域）。
4. 产出落地方案：概念模型、拓扑选型、模块落点、上游对齐策略、UI 多端、权限安全、分阶段计划与风险清单。

### 1.3 调研方法与证据链

- 外部调研（材料二）：4 个对象组——Claude Code Agent Teams；OpenAI 系多代理编排（Agents SDK/Swarm/AgentKit/OpenHands/Cognition）；LangGraph/CrewAI/AutoGen(AG2)；跨框架编排与协调原语（Anthropic 多代理研究系统/MetaGPT/A2A+MCP/blackboard）。
- 仓内分析（材料三）：3 个分析域，全部带 `path:line` 证据与实际执行的 grep 命令。
- 方案定稿（材料一）：经 v1→v2→v3 三轮修订的定稿方案。
- 论断复核（材料四）：对 5 条关键论断的独立实证复核（confirmed / unverifiable / refuted）。
- 终审与处理（材料五 + 材料一修订说明）：终审两条中高问题及 v3 回应，终审未复审。

---

## 2. 主流框架与产品的 team 设计点

本章按调研对象分节，内容与来源均出自材料二。每条设计点含「机制」（外部产品的实际做法）与「对 Drora 的借鉴点」（材料二给出的结论）。

### 2.1 Claude Code Agent Teams（官方多代理团队与 Agent SDK subagents）

**总体判定（材料二）**：值得借鉴。官方用四件原语把单子代理模型升级成团队——命名可寻址成员（Agent tool 加 name + 成员注册表）、共享任务板（三态+依赖+原子认领）、邮箱消息（写成功即发送 + idle 通知 + 防重定向）、权限上浮与代理消息零授权；而其实验性缺口（resume 丢队友、命名即隐式成队、split-pane 不支持 Windows）恰是 Drora 以 Host 单所有者 + renderer 多视图的桌面架构能直接做得更好的落点。

#### 2.1.1 Lead/Teammate 拓扑：teammate = 命名子代理的长寿命化

- 机制：开关是 env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`（默认关闭、实验性，仅交互会话，`-p`/SDK 不成队）；lead（主会话）在 Agent tool 调用（v2.1.63 由 Task tool 更名而来）中带 `name` 参数即生成 teammate，fork 与带 `isolation` 的调用除外，且无需用户确认。teammate 是独立上下文的完整实例：in-process 模式跑在主终端内，split-pane 模式经 tmux/iTerm2 起独立进程；团队状态写 `~/.claude/teams/{session-前8字符}/config.json`（members 数组含 name+agent ID，lead 固定 team-lead 类型），会话结束自动删除。约束：一 session 一 team、无嵌套 team、lead 不可转移、teammate 不能再生成 teammate、in-process teammate 的子代理只能前台（其后台工作不能超出 lead 进程存活期）。
- 借鉴点：Drora 无需新进程模型——给现有 subagent runtime 加「命名实例注册表 + 成员会话持久化」即可成队；官方「命名即隐式成队」副作用大，Drora 应做成显式 opt-in。对单子代理模型的扩展点即：给一次性委托的 Agent tool 加 name（命名即可寻址、可复活），配 SendMessage/ListAgents 与 Task 四工具，升级为长寿命可对话成员。

#### 2.1.2 共享任务板：Task 四工具 + 三态 + 依赖 + 文件锁抢占

- 机制：原语是 TaskCreate/TaskGet/TaskList/TaskUpdate 四个工具；任务仅 pending/in progress/completed 三态并可声明依赖，依赖未完成的任务不可被认领；认领用文件锁防竞态，某任务完成后 runtime 自动解锁依赖它的任务。任务列表持久化于 `~/.claude/tasks/{team-name}/`（不上传、resume 后保留、按 cleanupPeriodDays 清理）；teammate 即使源自受限 subagent definition，runtime 也强制补发 SendMessage 与 Task 工具（disallowedTools 列了也保留）。lead 可显式指派，成员也可自领未分配未阻塞任务；无 Task 工具的成员只能靠消息协调。
- 借鉴点：任务板保持极简（三态+依赖+原子认领）且是唯一事实源；Drora 应放 Host/服务层做单所有者 + 原子 claim，而非学官方靠文件锁。

#### 2.1.3 成员间消息：JSON 邮箱文件 + 自动投递 + idle 通知

- 机制：每成员邮箱是 `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`，SendMessage 写入收件人文件才算发送成功（写失败即报错且未发送），读取时逐条校验并剔除非法条目。消息自动投递无需轮询；成员完成或因 API 错误停止时自动向 lead 发 idle notification（附最终答案/错误文本），给等待重试的成员发消息可立即唤醒重试；结构化协议消息（shutdown_request、plan_approval_response）同通道传输。spawn 时 runtime 注入 sibling roster（main + 全部命名成员，构成 SendMessage 合法地址快照）；SendMessage 校验名字是否仍指向原代理，被新代理占用则拒绝并提示改用 agent ID。
- 借鉴点：「写成功=发送成功」、名字重定向防护、idle 通知携带结果三条语义值得照搬；Drora 有 Host/relay 中心，可用持久化邮箱 + 内存投递替代文件方案。

#### 2.1.4 权限与审批：继承 lead 模式、提示上浮、代理消息零授权

- 机制：teammate 继承 lead 的权限模式（dontAsk 除外；`--dangerously-skip-permissions` 传导全员），spawn 时不能按成员设权限模式、spawn 后可单独改；teammate 的权限提示统一上浮到 lead 会话由用户批准，唯一例外是计划审批——lead 收到 teammate 的 plan approval 请求后不经用户直接批准（后续编辑/命令仍走权限提示）。安全边界：任何代理消息都不能充当待决权限提示的批准或用户同意，被拒操作不能经转发绕过；auto 模式下分类器在投递前审查每条代理间消息（含结构化消息），并把转述的批准声明当不可信输入。子代理最终报告另经输出扫描（反斜杠插销/marker 行）并附「无用户授权」头部。
- 借鉴点：权限上浮到单一审批面 + 「代理消息永不构成用户授权」是硬边界；Drora 手机远控与多代理并存时必须实现等价规则（审批声明不可转述、代理间消息投递前审查）。

#### 2.1.5 生命周期：协商式关停、消息复活、resume 缺口

- 机制：创建即 Agent tool 带 name；关停是协商式——teammate 可批准优雅退出或附理由拒绝；给已停止的 in-process teammate 发消息会在同一 session 内复活它、恢复已保存对话并把消息作为下一条 prompt（复活重放 subagent definition，但项目目录定义要求 folder 信任，否则成员裸启）。官方自认缺口：/resume、/rewind 不恢复 in-process teammates（split-pane 因独立进程不受限），lead 可能给已不存在成员发消息；config 随会话删除而任务板保留；transcript 存 `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl` 可跨重启 resume（Explore/Plan 一次性、无 agentId 不可 resume；maxTurns 截断标记 partial）。质量门用 hooks：TeammateIdle（exit 2=反馈并让成员继续）、TaskCreated/TaskCompleted（exit 2=阻止并反馈）。
- 借鉴点：协商关停与消息驱动复活值得借鉴；Drora 应把 team config + 任务板 + 邮箱整体做成可恢复事实，从根上修掉官方 resume 丢队友的缺口。

#### 2.1.6 编排与 UI：自动成队、同面板混排、双显示模式与成本护栏

- 机制：自动编排——Claude 依任务自行决定成员数与角色，也可在 prompt 点名数量与模型（解析顺序：spawn prompt > subagent definition model > CLAUDE_CODE_SUBAGENT_MODEL > lead 模型，受 availableModels 白名单替换，CLAUDE_CODE_SUBAGENT_MODEL_FORCE 可强制统一；effort 默认继承 lead，成员模型/fast 模式 spawn 后固定）；subagent definition 可复用为 teammate 角色，tools/model/effort/autoCompactWindow 按模式差异化生效，skills 不生效、mcpServers 仅 split-pane 生效。UI 双模式：in-process 在 prompt 下 agent panel（↑↓ 选择、Enter 进 transcript 直接对话、Esc 中断、x 停止、Ctrl+T 开任务板；全 idle 30s 后隐藏空闲行、>3 个 idle 折叠为「N idle agents」），split-pane 需 tmux/iTerm2（teammateMode 设置 in-process/auto/tmux/iterm2 + --teammate-mode 旗标；VS Code 终端/Windows Terminal/Ghostty 不支持）；subagents 与 teammates 混排同一面板。护栏：深度 CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH（默认 3 层）、并发 CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS（默认 20，超限报 'Concurrent subagent limit reached'）、SDK 侧 spend cap（maxBudgetUsd→error_max_budget_usd）；成本上 in-process teammate 请求落在主对话缓存 TTL 桶外（默认 5 分钟，subagentPromptCacheTtl 可调 1h），官方建议 3-5 人团队。
- 借鉴点：Drora 桌面端可用 tab/分栏原生实现两种模式并覆盖 Windows（官方 split-pane 在 Windows Terminal 不可用）；深度/并发/花费三层护栏与缓存 TTL 差异值得照搬。

**来源（材料二）**：

- https://code.claude.com/docs/en/agent-teams（完整抓取，.md 原文）
- https://code.claude.com/docs/en/sub-agents（完整抓取，.md 原文）
- https://code.claude.com/docs/en/tools-reference（完整抓取，.md 原文）
- https://code.claude.com/docs/en/agent-sdk/subagents（完整抓取）
- https://code.claude.com/docs/en/agents（仅搜索摘要确认：多代理方式对比页）

### 2.2 OpenAI 系多代理编排（Agents SDK / Swarm / AgentKit / OpenHands / Devin-Cognition）

**总体判定（材料二）**：值得有条件借鉴。以 agents-as-tools + 顺序调度为主形态（复用现有 subagent/owner-lease/会话恢复链路，不建独立编排运行时），把「共享任务板」落成事件溯源的类型化契约实体，并把 Cognition 的全量 trace 注入与只读并行作为默认协作纪律；Swarm 的归档与 Agent Builder 的弃用共同警示不要自建编排框架层。

#### 2.2.1 Handoffs 与 Agents-as-tools 双模式（OpenAI Agents SDK / Responses API 编排指南）

- 机制：官方编排指南明确区分两种多代理形态：handoffs 是所有权转移——triage agent 把子代理注册在 handoffs 列表，路由后 specialist 成为「本轮剩余时间的 active agent」，原代理退出；agents-as-tools 是管理者模式——manager 通过 Agent.as_tool() 把 specialist 当有界能力调用（传入 prompt、返回 string），manager 保留对话控制权和最终答复权，可在统一位置执行 guardrail。官方建议：单代理起步、只在不同分支确实需要不同 instructions/tools/policy 时才拆分，两种模式可组合（先 handoff 再 as_tool）。
- 借鉴点：Drora 的 team 应以 agents-as-tools 为主形态（lead 保留最终答复所有权，teammate 是有界调用），与现有 subagent/Explore 机制同构、改动最小；handoff 仅用于「整个任务由某 teammate 接管」的显式场景，且需复用现有 owner/lease 路由而非新建通道。

#### 2.2.2 LLM 驱动 vs 代码驱动编排分层（Agents SDK multi_agent 指南）

- 机制：指南把编排切成两层：LLM 驱动（模型用 tools+handoffs 自主规划步骤）与代码驱动（应用代码确定性控制流程），推荐混用。代码驱动给出四个模式：结构化输出分支、chaining（research→outline→draft→critique 流水线传参）、generator/critic 循环（evaluator 说通过才停）、asyncio.gather 并行跑独立子任务。LLM 驱动的战术是强 prompt、监控迭代、自我批评循环、偏好多专用小代理、投评测。
- 借鉴点：Drora 的任务板调度应是确定性代码外壳（Host/服务层负责任派、顺序、超时、取消）+ LLM 只决定「拆什么、派给谁」；teammate 间的依赖顺序由任务板 DAG 表达，而不是指望 lead 的涌现行为。

#### 2.2.3 Swarm：两原语极简内核及其归档教训

- 机制：Swarm（openai/swarm，2024-10 发布，现已归档）只用两个原语：Agent（instructions + tools + handoffs 列表）和 handoff 函数（返回目标 agent 完成控制转移），配 context variables 做跨代理共享可变状态，理念是「轻量、可扩展、高度可定制」的教学探索。它没有持久化、权限、审批、恢复等生产设施，OpenAI 官方宣布弃用并引导迁移到 Agents SDK。
- 借鉴点：证明「多代理=会话+handoff+共享变量」的最小内核在概念上足够，但生产护城河在工程化（状态落盘、权限门控、取消恢复）——Drora 应复用现有 CLI/runtime 会话链路与权限体系承载 team，而非新造编排运行时。

#### 2.2.4 AgentKit/Agent Builder：类型化边与版本化工作流，且产品本身将弃用

- 机制：AgentKit（2025-10 DevDay 发布）含 Agent Builder（可视化画布）、ChatKit、Connector Registry 等。Agent Builder 用拖拽节点+「typed edges（类型化边）」组装多步工作流：每条连线是显式数据契约，点节点可查看上下游输入输出契约；发布即创建快照版本、API 可钉旧版；支持 Preview 逐节点观察执行和 trace 评测；可经 ChatKit 以 workflow ID 嵌入或导出代码用 Agents SDK 自托管。重要事实：官方文档已宣布 Agent Builder 将于 2026-11-30 关停（本次直接读取 developers.openai.com/api/docs/guides/agent-builder 确认）。
- 借鉴点：「任务板条目即类型化数据契约」值得借鉴——Drora 的 team 任务项应定义严格 schema（输入/输出/状态）放进 shared/contracts 单一定义；但可视化编排画布已被 OpenAI 自己证伪为非刚需，Drora 不应投入 UI 编排器。

#### 2.2.5 OpenHands TaskToolSet：同步阻塞委托 + 事件溯源 + task_id 恢复

- 机制：OpenHands（docs.openhands.dev/sdk/guides/task-tool-set，本次直接读取）的委托机制：父代理调用 task 工具（参数 prompt/subagent_type/description/resume），TaskManager 创建或恢复一个独立子代理会话，子代理自治跑完，结果以 TaskObservation（task_id、subagent、status=completed|error、text）返回父代理；子会话落盘持久化，父代理之后可用 resume=task_00000001 带全量上下文续跑同一子任务。文档明确警告该工具面向「顺序阻塞任务」而非并行。自定义子代理类型用 register_agent(name, factory_func, description) 注册，子代理各有独立上下文、工具集和系统提示。整体架构是无状态、事件溯源（arXiv:2511.03690）——子任务事件与顶层动作走同一条事件流。
- 借鉴点：teammate 的生命周期应是「可恢复的独立会话」（Drora 已有会话运行时与 snapshot 能力可直接承载），任务板状态由事件流推导而非独立数据库；resume 语义与 Drora 现有恢复链路天然对齐。

#### 2.2.6 Cognition/Devin「Don't Build Multi-Agents」：并行多代理的两大致命伤

- 机制：Devin 母公司 Cognition 的工程博客（cognition.com/blog/dont-build-multi-agents，2025-06，本次直接读取）指出并行多代理两个结构性问题：一是上下文碎片化（子代理看不到彼此工作，做出风格/假设不一致的产出，Flappy Bird 变超级马里奥背景的例子）；二是行为携带隐式决策、冲突决策产出坏结果。由此提出两原则：共享完整 agent trace 而非摘要；每个行动须基于系统内已做出的全部相关决策。推荐的替代方案：默认单线程线性代理；长任务用专门的压缩模型把行动历史蒸馏成关键事实/事件/决策以延长有效上下文；唯一可接受的子代理用法是 Claude Code 式「只委托只读调查类子任务、绝不与主代理并行写代码」。
- 借鉴点：这是对 Drora「互发消息协同」目标最有价值的反面证据：teammate 默认应顺序调度（后派者能读到先完成者的完整 trace），并行仅限只读无副作用任务；「摘要传递」应改为「全量 trace 注入 + 压缩」两档策略，避免消息摘要丢上下文。

**来源（材料二）**：

- https://openai.github.io/openai-agents-python/multi_agent/
- https://openai.github.io/openai-agents-python/handoffs/
- https://developers.openai.com/api/docs/guides/agents/orchestration
- https://developers.openai.com/api/docs/guides/agent-builder
- https://openai.com/index/introducing-agentkit（直接访问 403，内容经 WebSearch 结果摘要交叉确认）
- https://github.com/openai/swarm
- https://docs.openhands.dev/sdk/guides/task-tool-set
- https://arxiv.org/html/2511.03690v2（OpenHands SDK 论文，经 WebSearch 摘要，未直接读取全文）
- https://github.com/OpenHands/OpenHands/issues/13030（经 WebSearch 摘要，未直接读取）
- https://cognition.com/blog/dont-build-multi-agents

### 2.3 LangGraph / CrewAI / AutoGen(AG2) 三框架的多代理协作设计

**总体判定（材料二）**：值得借鉴但不必引入任何框架本身。LangGraph 提供「路由即工具调用 + thread 快照 + 确定性恢复」的执行内核（与 Drora 的 owner/lease、权限门控、snapshot 双链路同构），CrewAI 提供「声明式 teammate 身份 + 分层编排与 resume/fork」的产品形态，AutoGen 提供「广播频道 + FSM 发言权约束 + nested chat 摘要回传」的团队交互语义——三者合成 Drora agents team 的落地骨架。

#### 2.3.1 LangGraph supervisor：worker 即 handoff 工具，LLM 节点集中路由

- 机制：create*supervisor(agents, model, ...) 把每个 worker agent 包装成 supervisor 可调用的 handoff 工具，命名规则为 transfer_to*\<agent_name\>（或 handoff_tool_prefix + agent_name），supervisor 本身就是一个 LLM 节点，通过调用这些工具把控制权转给对应 worker。output_mode 控制回写量：last_message（默认）只把 worker 最后一条消息写回共享历史，full_history 写回全部中间轨迹。add_handoff_messages=True 在交接时补一对 (AIMessage, ToolMessage) 保持历史自洽；parallel_tool_calls 可一次委派多个 worker（仅 OpenAI/Anthropic 支持）。官方多代理总览还给了量化依据：handoff/skills 类有状态模式在重复请求上省 40-50% 调用，subagents/router 可并行但单请求多一次回传。
- 借鉴点：Drora 的 lead 不必自创编排 DSL：把 teammate 注册为命名工具，lead 用普通工具调用路由，并默认只回传 teammate 的最终消息以控制 lead 上下文膨胀。

#### 2.3.2 LangGraph swarm：单一 active_agent 状态 + 对等 handoff，无中心调度

- 机制：SwarmState 是共享状态 schema，含 messages 与 active_agent 两个核心键；每个 agent 持有指向其他 agent 的 create_handoff_tool(agent_name, description)，调用该工具即把 state 的 active_agent 改为目标 agent，add_active_agent_router 按 active_agent 决定下一跳，default_active_agent 兜底。自定义 state_schema 可在 SwarmState 之上扩展跨 agent 共享键（这正是「共享任务板」的载体），任何 Pregel 对象（编译后的子图、functional workflow）都能作为成员；组装后仍需 .compile(checkpointer=...) 并用同一 thread_id 串起多轮对话。
- 借鉴点：teammate 间点对点协作只需一个「当前活跃者」字段加 handoff 工具改写它——与 Drora 已有 owner/lease 路由同构，把 owner 从「哪个窗口/Host」扩展为「哪个 teammate 持有发言权」即可，无需中心调度器。

#### 2.3.3 LangGraph checkpointer + interrupt()：thread 级快照与确定性恢复语义

- 机制：checkpointer 在每个执行步把图的 state 存为 checkpoint，thread_id 即「持久游标」，复用同一 thread_id 可恢复到同一检查点（InMemory/Sqlite/Postgres 三级实现；子图有独立 checkpoint 命名空间，跨图共享要走 Store）。interrupt() 可放在节点内任意位置（含 @tool 函数内部），暂停时 payload 经 result['__interrupt__'] 返回，图无限期等待；用相同 thread_id 传 Command(resume=...) 恢复，恢复值即 interrupt() 的返回值。关键纪律：恢复时节点从头重跑，interrupt 之前的副作用必须幂等、副作用应放在 interrupt 之后；调用匹配是严格按索引的，不能条件性跳过；工具审批场景把 interrupt 放进工具函数，LLM 正常发起调用、执行前暂停，恢复值甚至可改写工具参数（审批/编辑/取消三态）。
- 借鉴点：暂停-恢复的三件套（快照、thread 游标、重放幂等）正是 Drora 双链路（desktop-continuous / web-remote-replayable）已有的语义；agents team 的中断恢复应复用现有 snapshot 基建，权限拦截沿用 Drora 工具执行前的门控位置，副作用一律放在审批之后。

#### 2.3.4 CrewAI：role/goal/backstory 身份三要素 + manager_llm 层级委派

- 机制：Agent 由 role（职能）、goal（个人目标）、backstory（性格与背景）三要素构成，作为 {role}/{goal}/{backstory} 模板变量自动填充进 system prompt（use_system_prompt 可关）；llm 参数直接收 LiteLLM 风格的 provider/model 字符串（如 'openai/gpt-4o'），function_calling_llm 可单独指定便宜模型做工具调用。层级流程 process=Process.hierarchical 下由 manager_llm（推荐，文档称 'crucial'）或自定义 manager_agent 统一调度：经理按成员角色与可用工具分配任务并 validates outcomes 验收；关键默认值是 delegation 已改为默认关闭，需在 Agent 上显式 allow_delegation=True；内置代码执行已弃用，转向 E2B/Modal 外部沙箱。
- 借鉴点：teammate 身份用三要素声明式定义并模板化注入 prompt；互发消息/委派能力默认最小化（默认关闭、按 teammate 显式开启），与 Drora 权限门控的默认收紧姿态一致。

#### 2.3.5 CrewAI Flows：围绕 Crew 的确定性事件状态机 + UUID 持久化

- 机制：Flow 是事件驱动编排层：@start 标记入口（多个起点常并行、可条件门控），@listen 监听方法输出，@router 按返回标签分支（建议 Literal 注解以便绘图），or*/and* 组合器做任一/全部触发。状态有两档：self.state 动态字典（原型）或 Flow[PydanticModel]（结构化），每个 Flow 自动获得唯一 UUID；@persist 默认落 SQLiteFlowPersistence，kickoff(inputs={'id': uuid}) 恢复同一流程，kickoff(restore_from_state_id=uuid) 分叉出新的 state.id 且源历史不变。Crew 在 Flow 中只是被 @listen 方法调用的一步（crew().kickoff(inputs=...)）；另有 @human_feedback 装饰器暂停收集人工反馈、usage_metrics 聚合全流程 token。
- 借鉴点：确定性编排（任务板状态机）与 LLM 自由协作（teammate 执行）应分层：Drora 的共享任务板对应 Flows 的结构化 state + 事件驱动流转，teammate 执行是其中一个可恢复的步骤；resume/fork 双语义可直接映射 Drora 的会话恢复与分叉需求。

#### 2.3.6 AutoGen/AG2 GroupChat：广播频道 + 受 FSM 约束的发言权选择 + nested chat 摘要回传

- 机制：GroupChat 中每条消息发给 chat_manager 并广播给全组，groupchat.messages 是全员共享的历史；下一个发言者由 speaker_selection_method 决定：auto（LLM 选）/round_robin/random/manual，或传 Callable(last_speaker, groupchat) 返回 Agent、回退策略字符串或 None（终止）。转移可再用图约束成 FSM：allowed_or_disallowed_speaker_transitions + speaker_transitions_type='allowed' 传入 {agent: [可转移目标]}，LLM 每轮只看到合法候选。nested chat 让某 agent 收到特定 trigger（agent 或条件函数）后、回复之前先内部跑完一个 chat_queue（每项含 sender/recipient/message 回调/max_turns/summary_method），结束后按 summary_method 生成摘要作为回复回传外层对话。UserProxyAgent 充当 human proxy：human_input_mode 三态（ALWAYS 每轮必问 / TERMINATE 仅终止时问 / NEVER 从不问），默认 llm_config=False、代码执行默认走 Docker（官方强烈建议）。
- 借鉴点：共享任务板应等于「全员广播的消息流 + 受限转移图」：广播保证全员可见与可审计（消息历史即任务板事件流），transition 约束限制谁能对谁下指令以防失控；子团队「内聊完只回摘要」与 Drora 现有 subagent 摘要回传模式天然契合。

**来源（材料二）**：

- https://docs.langchain.com/oss/python/langchain/multi-agent
- https://reference.langchain.com/python/langgraph-supervisor
- https://reference.langchain.com/python/langgraph-supervisor/supervisor/create_supervisor
- https://reference.langchain.com/python/langgraph-swarm
- https://reference.langchain.com/python/langgraph-swarm/swarm/create_swarm
- https://docs.langchain.com/oss/python/langgraph/persistence
- https://docs.langchain.com/oss/python/langgraph/interrupts
- https://docs.crewai.com/edge/en/learn/hierarchical-process
- https://docs.crewai.com/edge/en/concepts/agents
- https://docs.crewai.com/edge/en/concepts/flows
- https://microsoft.github.io/autogen/0.2/docs/notebooks/agentchat_groupchat_customized
- https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/user_proxy_agent
- https://microsoft.github.io/autogen/0.2/docs/notebooks/agentchat_nestedchat
- http://classic.docs.ag2.ai/latest/docs/user-guide/advanced-concepts/groupchat/custom-group-chat

### 2.4 跨框架编排与协调原语（Anthropic 多代理研究系统 / MetaGPT / A2A+MCP / blackboard）

**总体判定（材料二）**：值得借鉴但不整体移植框架。以现有 subagent + owner/lease 为底座，新增「单所有者任务板（blackboard 语义）+ A2A 式任务状态机与幂等取消 + MetaGPT 式结构化交接产物」作为最小原语集，lead 按 Anthropic 经验做扩缩与 checkpoint 恢复，功能定位避开紧耦合编码场景。

#### 2.4.1 Orchestrator-worker：lead 显式委派 + 按复杂度扩缩（Anthropic 实证）

- 机制：Lead agent 分析查询后把计划写入持久 Memory（因超 200K token 上下文会被截断），再并行 spawn 3-5 个 subagent（复杂查询 10+，简单查询仅 1 个）；委派 prompt 必须含四要素——子任务目标、输出格式、工具指引、任务边界。双层并行：lead 同时起多个 subagent + subagent 并发调 3+ 工具，复杂查询耗时降 90%。工具描述质量直接影响下游效率（修好工具描述使后续 agent 任务完成时间降 40%）。
- 借鉴点：Drora 的 team lead 应基于现有 subagent 机制实现，lead 的计划/任务板必须落盘持久化（而非只在上下文里），委派消息用强 schema 结构化生成，并按任务复杂度决定 teammate 数量上限。

#### 2.4.2 上下文隔离 + 文件系统引用回传（token 放大约 15 倍）

- 机制：每个 subagent 拥有独立上下文窗口、独立工具集与轨迹，互相不可见，减少路径依赖；subagent 只把浓缩后的关键 token 回传 lead，更优做法是把完整输出写入文件系统、仅回传轻量引用，避免「传话游戏」。代价是 token 放大：multi-agent 约为单聊天 15 倍，token 用量解释 BrowseComp 上 80% 的方差。官方明确边界：该模式适合可并行、超出单上下文的高价值任务（如 breadth-first 调研），不适合编码等紧耦合领域。
- 借鉴点：Drora teammates 之间不得共享会话历史，交接产物落盘 + 引用回传；team 功能应定位在大范围探索/批量验证/多模块调研类可并行任务，避免定位成通用并行编码（Anthropic 实证该场景收益为负），token 预算需在任务板层面显式管控。

#### 2.4.3 SOP 角色流水线 + 结构化交接产物（MetaGPT）

- 机制：SOP 编码进提示词序列：每个角色有固定职责与中间产物标准（PM 产 PRD、Architect 产系统设计/接口定义、ProjectManager 产任务分解、Engineer 产代码、QA 产测试），结构化消息发布到共享消息池，角色按兴趣订阅（watch）过滤、收齐全部前置依赖产物后才激活行动，形成装配线；对比自由聊天（ChatDev 2.1 / AutoGPT 1.0），结构化交接使 SoftwareDev 可执行性达 3.9，显著抑制级联幻觉。另有可执行反馈：跑代码+单测、最多重试 3 次，MBPP Pass@1 +5.4%。
- 借鉴点：Drora 任务板条目应是强 schema 的结构化产物（任务卡含目标/验收/依赖/产出格式），teammate 按角色订阅感兴趣的产物类别、依赖齐备才领取任务，禁止把任务板退化成自由聊天流。

#### 2.4.4 共享任务板 = blackboard + 单一状态所有者

- 机制：Blackboard 传统（Hearsay-II，训练知识）：所有知识源读写共享工作区、控制单元按黑板当前内容调度下一个知识源，agent 间不直接通信而读写共享状态，天然松耦合；A2A 1.0.0 则规定 task 对象由单一方（远程代理/server）生成 ID 并唯一持有状态，客户端只能通过定义好的操作读取/驱动，另设 contextId 把相关任务与消息分组以保持会话连续性。
- 借鉴点：Drora team 任务板应放在 Host 侧由单一 owner 持有（复用现有 owner/lease 路由，遵守 AGENTS.md「避免重复状态和多条写入路径」纪律），teammate 只能通过协议方法读写任务板，不得各自本地缓存板状态作为事实源。

#### 2.4.5 任务生命周期状态机 + 三通道更新 + 幂等取消（A2A 1.0.0）

- 机制：A2A 1.0.0 定义 task 状态机 SUBMITTED→WORKING→(INPUT_REQUIRED|AUTH_REQUIRED)→COMPLETED|FAILED|CANCELED|REJECTED；更新推送三通道并存——轮询 GetTask、SSE 有序事件流（规范要求事件按序送达、流的生命周期独立于 task 生命周期）、webhook push（at-least-once 投递，客户端须幂等）；CancelTask 幂等且终态任务抛 TaskNotCancelableError；Message（通信往返）与 Artifact（任务产出）显式分离为两类对象。
- 借鉴点：Drora team task 直接采用 A2A 的状态集合、Message/Artifact 二分与幂等取消语义（终态不可再取消），任务更新在 desktop-continuous 实时链路与 web-remote-replayable 恢复链路下都要可重放，契约字段收敛到 shared/contracts 常量区单点定义。

#### 2.4.6 checkpoint 恢复 + 小样本真实查询评测（失败模式实证）

- 机制：Anthropic 用 durable execution + resume-from-checkpoint 取代整队重启，失败时重试或直接告知 agent 工具故障让其自适应绕行，渐进发布（Rainbow deployment）不打断在跑 agent；早期失败集中在编排失控（简单查询 spawn 50 个 subagent、重复劳动、无限搜索不存在的信息），靠提示词中的扩缩规则收敛；评测上约 20 条真实查询即可暴露显著问题，单次 LLM-judge + rubric 评最终状态（而非逐步过程）最稳定。
- 借鉴点：Drora team 的恢复单位应是任务板上的任务条目（崩溃后 lead 重读任务板、对未完成任务重新委派），并在 lead 提示词中写死 teammate 数量扩缩规则与去重规则；验收用小规模真实任务集 + 评最终产物状态的 judge，且对 teammate 权限沿用现有权限门控。

#### 2.4.7 MCP（agent-to-tools）与 A2A（agent-to-agent）的分工

- 机制：A2A 附录 B 明确互补关系：MCP 连接 agent 与工具/上下文（agent-to-tools），A2A 连接跨供应商的 opaque agents（agent-to-agent，不共享内部 thoughts/plans/tools）；A2A 用 Agent Card（/.well-known/agent-card.json）声明 capabilities/skills/securitySchemes（OAuth2/OIDC/API key/mTLS），支持 in-task 授权（AUTH_REQUIRED 状态 + 委派链）。
- 借鉴点：Drora 的 agents team 在同一 CLI runtime 内协作，无需引入 A2A wire 协议（避免与上游同步冲突），但应借用两个形态：teammate 档案做成 Agent Card 式的能力/工具/权限声明（挂到现有技能/权限体系），MCP 继续作为工具接入层不动；仅当未来需要跨机器/跨供应商组队时再评估 A2A 作为外部 seam。

**来源（材料二）**：

- https://www.anthropic.com/engineering/multi-agent-research-system（已全文抓取）
- https://arxiv.org/html/2308.00352v7（MetaGPT ICLR 2024 论文，已抓取）
- https://a2a-protocol.org/latest/specification/（A2A 1.0.0 官方规范，已全文抓取，含附录 B MCP 关系）
- https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/（已抓取）
- https://github.com/a2aproject/a2a（仅搜索结果，GitHub 页面抓取失败）
- https://www.themoonlight.io/en/review/exploring-advanced-llm-multi-agent-systems-based-on-blackboard-architecture（仅搜索摘要）
- https://www.ibm.com/think/topics/agent2agent-protocol（仅搜索摘要）
- Hearsay-II blackboard 历史模型：训练知识（可能有时滞）
- Drora 现有能力（subagent/Explore、MCP、权限门控、owner/lease 路由）：来自本 ask 的背景材料，本次未读仓库实现代码

---

## 3. Drora 仓库现状（三个分析域）

本章为材料三（仓内分析）的整理，全部 `path:line` 与命令输出系该分析所载。

### 3.1 分析域一：Agent 运行时与子代理现状（apps/drora-cli + packages/client）及上游 team 协议面核查

#### 3.1.1 子代理创建/调度/回收全链路

1. 入口工具：`Agent` 工具 handler 在 `apps/drora-cli/packages/core/src/tool/handlers/agent.ts:167-215`——解析 AgentInputSchema、缺省 subagent_type=general-purpose（内置 profile 见 `core/src/subagent/profile.ts:72-87`，general-purpose tools=["\*"]；Explore 内置 profile `profile.ts:23-37`，只读工具面 `core/src/subagent/explore-tools.ts:4-17`），构造含 sessionId/turnId/parentToolCallId/workingDirectory/workspaceRoot/trace 的 request 后调 `context.subagentPort.launch({...,runInBackground})`。`Task` 是 providerVisible:false 的 Claude Code 兼容别名（agent.ts:280-293；TASK_TOOL_NAME="Task" 定义于 `core/src/tool/compat.ts:2`）。
2. 端口契约：SubagentPort 定义于 `apps/drora-cli/packages/contracts/src/interfaces/subagent.port.ts:113-134`（launch/run/start?/backgroundTask?/getTask?/waitForTask?/stopTask?/sendMessage?）。默认实现装配在 `core/src/runtime/agent-runtime.ts:328`（`deps.subagentPort ?? runtime.createDefaultSubagentPort(deps)`），createDefaultSubagentPort 在 `core/src/runtime/methods/subagent.ts:65`（config.subagents.enabled===false 时返回 undefined），内部包 createExploreSubagentPort（`core/src/subagent/runner.ts:133`）。
3. 调度与生命周期（`core/src/subagent/runner.ts`，2145 行，文件头注明集中维护前台/后台生命周期）：前台 run() 注册 InMemoryRuntimeTaskRegistry（runner.ts:184-192）、metadata 写失败回滚 registry（194-200）、per-agentId AbortController 级联父 signal（622-654）、activity watchdog（211-218）、Promise.race(completion/后台请求/autoBackgroundTimer)（312-319）；转后台时 detachParent 并异步 finalize（321-333）。后台 start() 在 runner.ts:442-529 返回 AgentBackgroundedOutput（agentId+outputFile）。autoBackground 定时器 runner.ts:663-702。
4. 子 runtime 是完整 AgentRuntime：`core/src/runtime/methods/subagent.ts:254` `new AgentRuntime(...)`，关键配置：taskType:"subagent_child"（:286）、parentSessionId（:286 附近）、toolset explore|main（:300）、`subagents:{enabled:false}` 禁止孙代（:305-308）、permissionService：内置 Explore 用独立只读实例、general-purpose/自定义继承父服务（:340-343）、对外交互（permission broker/provider headers）经 deriveChildClientPorts（:214）路由回父 session、child 事件经 mirrorSubagentToolEvent 镜像父 timeline（:346-375）、coordinatorResponsePort 注入（:330-337）。子 runtime 以 executeTurn(prompt,{inputSource:"subagent",inputPresentation:"coordinator_input"}) 执行（:455-461）。
5. 结果回收：前台结果直接作为 tool result 返回（formatAgentOutputForModel 拼 agentId+usage，agent.ts:123-165，提示可用 SendMessage 续跑）；后台完成走 finalizeBackgroundCompletion（runner.ts:1500-1580）：写 outputFile、更新 registry、enqueueParentTaskNotification 同步写入父 command queue（类型签名强制同步，runner.ts:116-118）、发 BackgroundTaskCompleted 与 SubagentStopped 事件。

#### 3.1.2 会话生命周期与 turn 管理

TurnMachine 在 `core/src/agent/turn-machine.ts:38-63`；phase 状态机 `core/src/agent/turn-state.ts:25-37`（Idle→ProcessingInput→AwaitingModelResponse→Streaming→SchedulingTools→ExecutingTools→AggregatingResults→AwaitingPermission→Completing→Idle，合法迁移表 turn-state.ts:231-260）。Runtime 级命令队列 `core/src/runtime/command-queue.ts:11-17`：RuntimeCommandMode = prompt|target-continuation|target-continuation-loop|task-notification|subagent-message|control-only-turn，优先级 now/next/later——子代理回话/后台通知都经此队列串行 admission。子代理消息入队为 `subagent-message` 命令（XML \<subagent-message\> 格式 + branchGeneration stale fencing）：`core/src/runtime/methods/subagent-messages.ts:25-80`。中途消息注入语义表（user_steer/coordinator_steer/coordinator_input/subagent_reply(\_steer)/task_notification(\_steer)）在 `core/src/system-reminder/incoming-message.ts:19-39`，其中 peer 消息带 permission-laundering 禁令文案（:6-8）。

#### 3.1.3 工具注册与权限门控层次

- 注册层：ToolRegistry 接口 `core/src/tool/registry.ts:19-27`（register/unregister/alias 冲突拒绝 :46-64）；runtime 装配在 `core/src/runtime/helpers/runtime-tools.ts:39-75` registerRuntimeBuiltInTools——「端口在场即注册」gate：includeAgent=Boolean(subagentPort)（:53）、includeSendMessage=subagentPort?.sendMessage!==undefined（:54）、includeRespondToCoordinator=taskType==="subagent_child"&&coordinatorResponsePort（:55-56）、includeSubmitResult/includeEscalate/includeWorkflow 等同理（:57-72）。
- 执行/权限层：`core/src/tool/executor/permission-flow.ts:56-96` resolveToolPermission→permissionService.checkPermission+permissionBroker 异步审批；PermissionService 在 `core/src/permission/service.ts:76-110`（session rules/project rules/mode/plan 组合判定）；子代理权限模式继承 resolveSubagentPermissionMode（methods/subagent.ts:527-549）；子代统一强制剔除 plan 工具（`core/src/subagent/tool-policy.ts:16-32`）。
- 工具并发调度：`core/src/tool/scheduler.ts:38-69` 拓扑排序+并行组（maxConcurrency 默认 10）。

#### 3.1.4 任务板/agent 间消息现状

RuntimeTaskRegistry（`core/src/runtime-task/registry.ts:54-87`）：all/get/drainMessages/queueMessage/register/remove/requestBackground/update/waitForBackgroundRequest/waitForTerminal；task 类型 local_agent|local_bash|local_workflow|local_dynamic_workflow|monitor_mcp（registry.ts:6-12）——这是任务板雏形，但为 per-runtime 内存态。消息通道：SendMessage（父→运行中 child：messageSink→steerTurn，`core/src/subagent/message-steering.ts:23-49`；→terminal child：resumeTerminalAgentInBackground 后台续跑，runner.ts:903-1010）；子→父仅 RespondToCoordinator（`core/src/subagent/coordinator-response.ts:19-52`，同步 enqueue 入父队列）。UI 消费：SubagentSpawned/SubagentMessage/SubagentStopped 事件枚举在 `apps/drora-cli/packages/contracts/src/events/session.events.ts:178-180`；`packages/ui/src/v4/conversationAssistantWorkItems.ts:69,203-228` 按 parentToolCallId 配对 Agent 工具行与 subagent 行。

#### 3.1.5 packages/client 定位

`packages/client/src/index.ts:1-17` 只导出 RemoteServiceAccess、websocket/messageport 连接与 webRemoteControlRelay 协议——是 RPC 连接/远控 SDK，不含任何 agent 创建调度逻辑；agent 管理仅经 subagentsService RPC proxy（`packages/client/src/remoteServiceAccess.ts:107,253`），服务面 ISubagentsService 在 `packages/services/src/subagents/subagents.ts:15-41`（list/createAgent/updateAgent/deleteAgent/setEnabled/模型 override，读写 `.drora/agents/*.md` profile）。

#### 3.1.6 第二种现有多 agent 编排：dynamic workflow

workflow actor 会话同样是 new AgentRuntime（`apps/drora-cli/packages/bootstrap/src/app/workflow-facade.ts:283-292` taskType:"workflow_child"；script-workflow-child-runtime.ts:133-147）；run 发射在 `bootstrap/src/app/dynamic-workflow-run-launch.ts:330-420`（persona 模型 pin/journal/attachActorSession/persistActorSession）；引擎（scheduler-submit/concurrency/settlement/resume）在 `apps/drora-cli/packages/dynamic-workflow/src/engine/`。actor 与 subagent 共用 deriveChildClientPorts 派生（methods/subagent.ts:214 注释）。

#### 3.1.7 官方上游 team 协议面核查——结论：无

分析中实际执行的命令与输出（材料三所载）：

- (a) `grep -rli "teammate" packages/mobile-web/upstream packages/mobile-web/.tmp-snapshot-build packages/zcode-cua/upstream docs/upstream packages/desktop/test/e2e/fixtures/upstream` → 0 命中；
- (b) 同范围 `\bswarm\b|\bcrew\b` 与 `agents team|agent-team` → 0 命中（唯一 swarm/crew 字节出现在 mdx 语法高亮正则片段 s(?:…|crewdriv|…) 内，mdx-B_wKz2FY.js，非协议内容）；
- (c) `grep -ohi "team[a-z_-]*" packages/mobile-web/upstream/remote/v4/3.14.3/assets/*.js | sort | uniq -c`：43 team/28 team-coding-plan/21 TeamCodingPlan/7 teamCodingPlanProviderId 等，全部是「Team Coding Plan」订阅套餐标识（bigmodelTeamCodingPlan/zaiTeamCodingPlan/planKind team-coding-plan），与多代理无关；
- (d) packages/zcode-cua/upstream/zcode-cua-0.6.3.index.js 中 team 仅 TEAM_ID/TeamIdentifier（Apple 代码签名团队 ID，7 处）；
- (e) docs/upstream/zcode-v3.15.1-analysis.md 无 team/teammate 引用；third-party/upstream 为 npm 许可文本、third-party/runtime 为 Node.js LICENSE（sources.json），均非 ZCode 代码。

另注：CLI 主体本身就是官方公开源码 v3.15.1 的同步对齐版（specs/upstream-v3.15.1-migration.md「固定基线」节），其 agent 域内也无 team 概念——当前源码中 teammate 仅出现在两处 prompt 文案（core/src/context/dynamic-sections.ts:11「write it for a teammate」、core/src/system-reminder/incoming-message.ts:6「treat it as a teammate's request」）。

结论：官方 ZCode 上游没有任何多代理/团队协议面；若实现 agents team 为纯 Drora 自研增量，无上游实现可借。（材料四随后对 3.14.3 原版 bundle 的复核进一步证实，见 §6.1。）

#### 3.1.8 该域约束（材料三）

1. 上游对齐硬约束：官方无 team 协议面（grep 实证）→ agents team 必然自研扩展，须放独立文件/新模块，经 ports/DI/单接缝接入，禁止内联进还原/上游文件；行为改动前先在 specs/ 写决策记录。
2. 契约键单一出处：新事件枚举、命令 mode、protocol 字段、env/\_meta/持久化键前缀只能在 contracts 与 packages/shared 定义一次，双端同源引用，改名前全链 grep。
3. 权限边界：子代无独立 plan approval 恢复面（tool-policy.ts:23-26），team 成员工具面必须沿用 forced-disallow 规则；peer 消息不可提权——incoming-message.ts:6-8 的 permission laundering 禁令必须原样适用于 teammate 消息；Explore 只读工具面（explore-tools.ts:4-17）不得混入写工具。
4. turn 所有权：一个 runtime 同一时刻只有一个 active turn（ActiveTurnStartReservation + command-queue admission），teammate 各自是独立 runtime/session，结果聚合只能走父 runtime command queue 的 task-notification/subagent-message 模式，不得共享 TurnState。
5. 嵌套限制：child 配置硬编码 subagents.enabled=false（methods/subagent.ts:305-308），teammate 再派生子代理需显式开禁并重新设计权限与取消传播链（abortControllers 级联目前只覆盖一层父子，runner.ts:622-654）。
6. branch/replay 双语义：subagent 消息带 branchGeneration stale 丢弃（subagent-messages.ts:26-42）；team 的任务板与消息流必须同时验证 desktop-continuous 与 web-remote-replayable 两条链路。
7. 状态所有者边界：Main/外部 Relay 只做鉴权转发不持业务状态；team 任务板若持久化只能由 Agent/runtime 或 session store 侧持有（specs/upstream-v3.15.1-migration.md 状态所有者表）；UI 局部状态不得冒充服务端事实。
8. 后台模型限制：单次执行模型/动态鉴权禁止进后台（runner.ts:153-167 BACKGROUND_UNAVAILABLE）——teammate 的后台生命周期只能依赖持久化 profile selection。
9. 还原文件修改禁令：直接修改还原文件仅限修复还原错误且须附原版 bundle 证据（文件+字节偏移+片段）；新逻辑一律新文件，还原文件不得 import 自研实现。

#### 3.1.9 该域缺口（材料三）

1. 无共享任务板：RuntimeTaskRegistry 是 per-runtime 内存态，无跨会话/跨 agent 读写 API、无持久化、无任务认领与状态机；TodoWrite 工具是单 agent 私有视角，不能当团队板用。
2. 无 teammate 间横向消息：SendMessage 只能父→子，子→父仅 RespondToCoordinator 且只在 subagent_child 注册（runtime-tools.ts:55-56）；子↔子无直接通道；SessionMailboxPort 只有 drainUnread 只读契约（session-mailbox.port.ts:13-17），仓库内未发现其投递/写入实现。
3. 无 lead/orchestrator 编组语义：现有「团队」只是父 turn 临时派生的 Agent 工具调用集合，无 team 实体、成员生命周期清单、共享上下文/产物区、成员角色与分工协议。
4. UI 与协议层无团队视图：桌面只有 Agent 工具行+subagent 行配对，无成员面板/任务板组件；drora-protocol 无 team 相关事件与命令；server/web 端同样无投影。
5. 并发治理缺失：多 teammate 并行时的 token/速率预算聚合、多个 child 同时触发权限 ask 时父会话单审批队列的语义、团队级取消传播（abort 级联仅一层父子）均未定义。
6. 团队级恢复语义缺失：单个后台 child 可 resume，但整 team 的崩溃恢复/快照/replay 不存在；web-remote-replayable 链路对 team 状态无投影。
7. 上游无先例（grep 实证）：需完整自研 spec + 模块化新文件落地，并在 specs/ 登记与上游的对照差异。
8. 测试面缺口（分析域二所载，与域一相关）：团队实体需同批设计测试面。

#### 3.1.10 该域扩展点（材料三）

1. SubagentPort 契约与注入缝：subagent.port.ts:113-134 + agent-runtime.ts:328——team 层可实现/装饰该端口，或按同模式新增平行 TeamPort（端口在场即注册，runtime-tools.ts:53-75 已有先例，新工具只需注入新 port 即注册，无需改上游文件主体）。
2. 子 runtime 构造模板：methods/subagent.ts:254-461（taskType/parentSessionId/toolset/deriveChildClientPorts/事件 mirror/executeTurn）——teammate 会话可整体复用这套三件套；SESSION_TASK_TYPES（apps/drora-cli/packages/contracts/src/interfaces/session-store.port.ts:33-42）已有 nested_workflow_child 这类扩展先例，可加 team_member 型 taskType（【编者注：此为仓内分析所列扩展可能，定稿方案 v3 已否决 taskType 加值路线，见 §5.3.5 与 §7.3】）。
3. 任务板基座：runtime-task/registry.ts:54-87 RuntimeTaskRegistry——共享任务板可在此所有权模型上扩展跨 agent 读写面；RuntimeCommandQueue 的 mode 枚举（command-queue.ts:11-17）可加 team-message/team-board 类命令。
4. agent 间消息通道：SendMessage 工具（core/src/tool/handlers/send-message.ts:53-83）+ \<subagent-message\> XML 入队格式（subagent-messages.ts:13-22）+ RespondToCoordinator（coordinator-response.ts:19-52）+ presentation 语义表（incoming-message.ts:19-39）。
5. 角色定义复用 agent profile：`.drora/agents/*.md` frontmatter（profile.ts:46-70 normalizeAgentProfiles）+ ISubagentsService 管理面（subagents.ts:15-41，经 remoteServiceAccess.ts:107,253 RPC proxy 供桌面/web UI）。
6. dynamic-workflow 编排引擎参照/复用：dynamic-workflow/src/engine/ + dynamic-workflow-run-launch.ts:330-420 的 actor 会话发射——lead 编排可复用其 actor 会话/journal/结算模型，或作为任务板并发设计的对照实现。
7. UI/协议事件面：SubagentSpawned/SubagentMessage/SubagentStopped 事件（session.events.ts:178-180）+ conversationAssistantWorkItems.ts:203-228 的 parentToolCallId 配对；profile 携带 color 字段（profile.ts:30,80）可做成员视觉标识。
8. SessionMailboxPort 既有契约：session-mailbox.port.ts:13-17（drainUnread 只读）——跨 session 投递若需持久化信箱可在此端口上补 write 面（扩展点而非现成能力）。

### 3.2 分析域二：协议与 UI 面（shared 协议 / services host / desktop main-host / ui store-hooks / 两条链路与手机远控）

基线：开工前运行 `node scripts/check-workspace-freshness.mjs`，输出 `[freshness] 基线新鲜：main（与 origin/main 同步），相对 origin/main：ahead 431 / behind 0（阈值 50）`——通过。（本报告撰写会话于 2026-10-16 复跑该命令，输出一致。）

#### 3.2.1 协议层（packages/shared）现状

1. 双协议并存：legacy 主协议方法表 droraProtocolMethods 在 `packages/shared/src/drora-protocol/index.ts:4146-4281`（含 session/subagents:4152、interaction/requestPermission:4271、session/create:4149 等），文件头注释（index.ts:22-33）声明它是待删旧面；V4 是当前主链，方法表 V4_METHODS 在 `packages/shared/src/drora-protocol-v4/transport.ts:332-384`（v4/conversation/subscribe、rowsRange、command、attachment 事务、workflowRun 产物族等），下行通知 V4_NOTIFICATIONS 在 transport.ts:407-415（v4/conversation/frame 等）。
2. 命令面：commandPayloadSchemas 全集在 `packages/shared/src/drora-protocol-v4/command.ts:44-297`（createSession/sendText/stop/queue 操作/resolveInteraction:226-238/workflowRun 恢复:271-296 等）；信封（commandId/clientId/sessionId/baseRevision/baseLogEpoch）在 command.ts:347-361；CAS 命令必须带 baseRevision 的集合 COMMANDS_REQUIRING_BASE_REVISION 在 command.ts:319-335；ACK/commands-query 在 command.ts:394-506。
3. 流式快照：conversationSnapshotSchema 在 `packages/shared/src/drora-protocol-v4/snapshot.ts:471-511`——A 区 control/availability/inputRouting/meta/config/usage/queue/pendingInteractions:493/pendingCommands/backgroundWorks:495/subagents:497（optional additive）/workflowRuns:500（optional additive，注释明确「冷快照必须携带，漏带会静默消失」）/goal/plan + B 区 rows 尾窗口；键级增量 conversationDeltaSchema 在 delta.ts:104-189（含 workflowRun.updated/removed）。
4. 两种交付语义：DELIVERY_PROFILES continuous/replayable 在 core.ts:34-59（continuous=30ms flush、inputText/output.text/summaryText 全流式、desktopOnlyRows；replayable=150ms flush、仅 text 流式、toolProgress）；订阅参数 clientMode 枚举 desktop-continuous|web-remote-replayable + workspace + legacyTaskIds + workflowRunDeltas 能力位在 transport.ts:422-437（注释明确：clientMode/workflowRunDeltas 是可信 host 注入的连接事实，UI 不能自选）。限额 PROTOCOL_V4_LIMITS 在 core.ts:64-100（eventRetentionPerSession=2000、subscriberBufferMaxOps=500 等）。
5. 契约常量区：AGENTS.md:56 要求跨进程契约字面量单一出处；物理落点为 ServiceChannels（packages/shared/src/channels.ts:104-179，含 DroraAgent:127、Subagents:168）、HostMessageTypes.AttachServicePort（channels.ts:657）、windowHostAttachmentScopeSchema local|remote（validation.ts:549-560）。会话种类闭集 droraSessionKindSchema（drora-protocol-legacy-types.ts:85-93：interactive/fork/selection_side_chat/workflow_parent/workflow_child/subagent_child/nested_workflow_child）。
6. 任务列表 topic：sessions-index topic 构造/解析成对在 sessions-index.ts:76-85，sessionSummary/snapshot/delta 在 sessions-index.ts:29-73；跨窗口 controller topic（controller/workspaces、controller/tasks-index）在 controller.ts:8-9。

#### 3.2.2 services 层（host）现状

1. IDroraAgentService 接口在 `packages/services/src/drora-agent/droraAgent.ts:613-1004`：v4 三 topic 订阅面（conversation/sessions-index/workspace-config，:872-986）、workspace 级下行帧 onDynamicConversationFrame:951-953、runtime 生命周期 onAgentRuntimeRestarted:992/onAgentRuntimeLifecycle:997、legacy session 面（createSession/resumeSession 等 :636-649）。
2. 连接 facade：createDroraAgentConnectionScope 在 `packages/services/src/drora-agent/droraAgentConnectionScope.ts:237-1069`——每个 RPC attachment 一个 scope，三类 SubscriptionKind（:134）；trusted carrier \_\_droraTrustedV4Connection（:40-41,91-109）清掉调用方可伪造的 clientMode/connectionId/deliveryProfile 后注入 host 真值；hello capabilities（:205-227，nativeDialogs/localTerminal 仅 continuous）；订阅 ownership + ACK 窗口暂存 + runtime 换代失效（:415-645）；CUA 权限观察/telemetry 仅 desktop-continuous 可订阅（:857-897）。
3. 命令转发：sendConversationCommandV4 在 droraAgentService.ts:6011-6084——读取 trusted clientMode（:6027-6030，缺省 desktop-continuous），replayable 自动注入 inputOrigin=mobile（:6050-6059），非本地 continuous 剥离 ttft（:6042-6049）。
4. 任务索引：droraTaskIndexSyncer.ts:1680 将 sessionKind==="subagent_child" 排除出任务列表 meta；replayable 手机恢复仍经 droraTaskServiceAdapter（droraTaskServiceAdapter.ts:449,476,1186,1436）。
5. CLI 侧 v4 网关：ConversationV4Gateway 在 `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/v4-gateway.ts`（类定义 :584，handleCommand :2416）；统一命令 admission 的 CommandInbox 在同目录 command-inbox.ts:1-30；原生 handler 注册表在 commands/handlers/index.ts:16-28（新命令=加 schema+handler 文件+一行 spread）。
6. 权限解析：CLI interaction-broker（apps/drora-cli/packages/bootstrap/src/drora-protocol/interaction-broker.ts:70-143）把 requestPermission 映射为 v4 pendingInteraction，应答 v4AnswerToPermissionResponse 在 :187-233；子代理权限来源 subagent origin（apps/drora-cli/packages/core/src/subagent/interaction-origin.ts:17-37，携带 parent/child sessionId）。

#### 3.2.3 desktop 现状

1. window-scoped Local Host：host utility process 的 attachment registry 在 `packages/desktop/src/host/index.ts:2244-2268`（resolveScope：local→activeServices，remote→windowRemoteConnectionRegistry.resolveScopedServices 按 remoteSessionId+generation）；AttachServicePort 控制消息处理在 host/index.ts:2906-2943；attachment 建立时以 connectionScope 包装服务并 exposeOnChannelServer（host/index.ts:2181-2200，web-remote-replayable 附着同时注册 zcode-\* 官方别名 :2198）。
2. 手机远控复用 Host attachment：createWebRemoteControlSharedHostAttachments 在 `packages/desktop/src/main/webRemoteControlSharedHostAttachments.ts:41-189`——本地 workspace 走 attachLocalHost（:76-105，向窗口 host 进程发 AttachServicePort，clientMode="web-remote-replayable"、scope={kind:"local"}）；远程 workspace 走 attachWorkspaceHost→attachRemoteWorkspaceSessionHost（:107-149，缺 workspaceIdentity 即抛 REMOTE_WORKSPACE_IDENTITY_MISSING :120-126）；在 main/index.ts:1003 注入 webRemoteControlManager。
3. 手机 bridge：webRemoteControlManager.ts:900-1007 createWorkspaceBridge——attachWorkspaceHost 后建 MessagePortProtocol ↔ acknowledged relay protocol 双向桥，SAT/DRN 背压透传（:984-991），raw 故障降级（:981-983）。外部 relay 只做鉴权/配对/心跳/转发（webRemoteControlManager.ts 注释对齐官方 attachWorkspaceHost 语义）。

#### 3.2.4 UI 现状

1. renderer v4 数据层：SessionDataLayer.acquire 引用计数租约（packages/ui/src/v4/sessionDataLayer.ts:52-100）；transport 桥 IDroraAgentService 在 agentConversationTransport.ts:90-160（hello/initialize 握手、帧解码、ttft 校准）；帧→投影 reducer 在 conversationProjectionStore.ts（1443 行）。
2. 权限 UI：V4InteractionDialogs.tsx:199-237 发 resolveInteraction 命令；v4 payload→旧 PermissionDialog 适配在 pendingInteractionAdapter.ts:58-94（含 subagent origin 透传注释 :84-85）。
3. 多会话下钻先例：WorkflowActorSessionSidePane.tsx:56-108——父会话 workflowRuns 投影做门 + 嵌套只读 SessionPane（租约复用，不额外建连）；SubagentSessionSidePane 同构。
4. store：droraSessionStore.ts:16-23（workspace 分桶 + navigation/workspace/task slices）；subagentsStore.ts、taskQueryCacheStore.ts、tabStore.ts；任务列表 useGlobalTaskList.ts（sessions-index join + controllerRevision）。
5. 手机 UI：WebRemoteControlMobileTaskHome.tsx:201 经 switcher.listWorkspaces 取数（注释 :219 曾因 3 秒轮询产生 relay 压力）；MobileHomeShell/MobileTaskShell 在 packages/ui/src/mobile。

#### 3.2.5 CLI runtime（团队执行面现状）

1. Agent 工具（spawn 子代理，foreground/background）契约 `apps/drora-cli/packages/contracts/src/tools/agent.ts:14-70`；SendMessage 工具（to=agent\_\<uuid\>，delivery=queued/steered/resumed_background）契约 contracts/src/tools/send-message.ts:4-44，handler 在 core/src/tool/handlers/send-message.ts:36 起；消息互发实现为 steerTurn（delivery=guide、inputPresentation=coordinator_steer、no_active_turn 重试）core/src/subagent/message-steering.ts:23-49。
2. TodoWrite/TodoRead 是 session 私有 checklist（contracts/src/tools/todo.ts:1-50），无跨成员共享任务板。
3. 最接近「团队」的既有实体是 workflow run：actors（每个 actor 持有真实 sessionId 可 transcript 下钻）在 `packages/shared/src/drora-protocol-v4/workflow-runs.ts:200-228`，nodes/phases/concurrency/artifacts/journal 恢复全套齐备，UI 侧有 WorkflowRunSidePane/WorkflowActorSessionSidePane。

#### 3.2.6 该域约束（材料三）

1. 上游对齐纪律：agents team 官方上游不存在，整个功能是自研叠加——必须独立文件/模块、经 ports/seam 接入、在 specs/ 留决策记录与对照说明，接缝位置与重放方式写进 spec；禁止写进还原文件。
2. 契约键单一出处（AGENTS.md:56）：新 topic 名、命令名、\_meta 键、持久化键前缀只能在 shared 常量区定义一次，生产消费同源。
3. 协议冻结面按黄金测试背书演进（command.ts:263 注释）；additive 字段必须 optional/default（snapshot.ts:483-485 的 meta 教训：漏 default 曾让 round-trip 测试长期红）；闭集加值有偏斜代价——旧端收到未知枚举值整帧解析失败且 resync 同样失败（snapshot.ts:365-368 注释），droraSessionKindSchema 加 team\_\* 值需 CLI 与桌面同批发布或改走 additive 字段。
4. 两条链路必须同时验证：desktop-continuous 实时链路与 web-remote-replayable 恢复链路——团队状态必须持久化进投影（snapshot 必带，照 workflowRuns 冷快照教训 snapshot.ts:498-500），不能依赖 live 内存；replayable 不产生 telemetry/CUA observation（droraAgentConnectionScope.ts:857-897 facade 拒绝）。
5. Main 与外部 relay 不保存业务状态：团队任务板/消息队列的所有者在 CLI runtime（与 conversation 投影同源），relay 只转发（webRemoteControlManager.ts）。
6. 每窗口一个 window-scoped Local Host；远程 workspace 由窗口内连接注册表管理；手机复用已有 Host attachment，不为手机另起 Agent/Local Host/远程会话。
7. workspaceIdentity 身份隔离：workspaceKey = workspaceIdentity?.trim() || workspacePath（droraAgentConnectionScope.ts:123-125）；远程 attach 缺 identity 直接拒绝（webRemoteControlSharedHostAttachments.ts:120-126）；远程链路贯穿 workspaceIdentity 与 remoteSessionId。
8. clientMode 是可信 host 注入的连接事实，UI/手机不可伪造（droraAgentConnectionScope.ts:91-109；droraAgentService.ts:6025-6030）；replayable 命令自动 inputOrigin=mobile（droraAgentService.ts:6050-6059）。
9. 已接受输入由 CLI CommandInbox 串行 admission；Renderer 只留草稿与 pending optimistic overlay——团队多成员并发输入沿用此边界，不新增 renderer 侧排队真相。
10. owner/lease、跨 Host 路由、stale run 防护不能仅按单一路径删除；团队命令的 CAS 归类照 COMMANDS_REQUIRING_BASE_REVISION（command.ts:319-335）。
11. 修改前先跑架构检查并读受控上下文；UI 改动前读 DESIGN.md/CONTEXT.md；必须 pnpm typecheck + pnpm lint（该分析为只读，未运行）。

#### 3.2.7 该域缺口（材料三）

1. 无共享任务板实体：TodoWrite/TodoRead 是 session 私有 checklist，跨成员共享板需要新的持久化投影、行级所有权裁决（谁可改哪行、CAS 边界）与协议键——完全缺失。
2. 协议面无团队键：V4_METHODS、commandPayloadSchemas、conversationSnapshotSchema、conversationDeltaSchema 均无 team 相关字段；需决定「conversation 内嵌投影 vs 独立 team topic」（前者改动小但跨会话团队列表要靠 sessions-index 聚合；后者要动 connection scope/facade/V4_METHODS 全链）。
3. 团队会话在任务列表/索引中的呈现未定义：droraTaskIndexSyncer.ts:1680 目前只排除 subagent*child；sessionKind 闭集（legacy-types.ts:85-93）加 team*\* 的偏斜代价需同批发布策略。
4. 成员生命周期管理缺失：现有 Agent 工具 spawn 的子代理面向单次任务；「常驻 teammate + lead 编排」的成员注册表、空闲回收、跨 turn 存活策略不存在。
5. 权限与身份边界未定义：多成员并发申请权限时 pendingInteractions 的展示聚合、成员间信任边界需要设计——现有 origin 机制只做来源展示（interaction-origin.ts:17-37）。
6. replayable 侧团队消息的尺寸/背压策略未定义：relay envelope 有尺寸上限（webRemoteControlManager.ts:966-969 oversize 即抛错降级）、订阅缓冲有双限额（core.ts:72-73）、事件保留 2000/会话（core.ts:74）——高频成员消息需键级增量模式（照 workflowRunDeltas 能力位 transport.ts:431-436）与投影裁剪。
7. 上游对齐决策记录缺失：specs/ 无 agents-team 相关文档；需先写 specs/agents-team.md 再实现。
8. 测试面缺口：drora-protocol-v4 冻结面黄金测试、E2E（两条链路各自的验收场景）都需要随团队实体同批设计——该分析未运行任何测试（只读分析，无代码改动）。

#### 3.2.8 该域扩展点（材料三）

1. shared 新增团队 schema 文件族：照 drora-protocol-v4/workflow-runs\*.ts 模式新建 team\*.ts（成员目录/共享任务板/消息摘要 + 限额），纯 schema+纯函数（core.ts:1-2 纪律）。
2. conversationSnapshotSchema additive optional 字段 + delta 键级增量：snapshot.ts:497-500 先例；delta.ts:104-189 加 team.\* op（照 workflowRun.updated）。
3. 命令面扩展：command.ts:44-297 加团队命令，按 :319-335 归类 CAS；CLI 侧 commands/handlers/index.ts:16-28 注册表加一行 spread。
4. 独立 topic 模式（若团队板不内嵌 conversation）：sessions-index.ts:76-85 topic 先例 + transport.ts:332-384 V4_METHODS 新增 v4/team/\* 方法 + droraAgentConnectionScope.ts:134 SubscriptionKind 加 "team" 并按 :812-1018 模式加 override（trusted clientMode 语义自动覆盖新面）。
5. host 服务描述符：ServiceChannels（channels.ts:104-179）加团队服务频道（若需要 workspace 级管理面 ITeamsService），host/index.ts:2197 自动暴露（replayable 附着记得官方别名行为 :2198-2200）。
6. UI 多会话下钻：WorkflowActorSessionSidePane.tsx:56-108 模式直接可复制为 TeamMemberSidePane；store 照 subagentsStore.ts 新建 teamStore。
7. CLI runtime 团队模块：apps/drora-cli/packages/core/src/ 新 team/ 目录（照 subagent/ 目录），状态所有者与 conversation 投影同源；成员互发消息复用 message-steering.ts:23-49 steerTurn + send-message.ts 契约（agent\_\<uuid\> 寻址已存在）。
8. 权限门控复用：pendingInteraction（snapshot.ts:311-351）+ resolveInteraction 命令（command.ts:226-238）+ subagent origin（interaction-origin.ts:17-37）。
9. 手机远控接入零新语义：webRemoteControlSharedHostAttachments.ts:41-189 已注入 clientMode=web-remote-replayable，团队帧/命令沿既有 relay 桥（webRemoteControlManager.ts:900-1007）转发；手机 UI 在 WebRemoteControlMobileTaskHome/MobileTaskShell 加团队视图即可。
10. web/server 侧：packages/server/src/http.ts:337-363 /ws（web-remote-replayable terminal）与 /ws/host（capability 保护的 desktop-continuous trusted host）两类连接对新帧类型透明。

### 3.3 分析域三：架构治理与上游对齐约束（agents team 合规落地分析）

#### 3.3.1 治理现状

- 治理工具链真实可用：分析运行 `pnpm architecture:check --changed` 输出 `architecture: OK / violations: 0 / baseline: 0 / new: 0`。架构策略 architecture-policy.yaml 已登记 4 个自研接缝托管模块（desktop/ui/services/web 的 drora-extensions，:79-130）和 gen-ui 跨层三模块样板（:131-165）。
- 新托管模块五件套要求见 .agents/skills/architecture-governance/SKILL.md:45（module.ts/contract.ts/contract.example.ts/contract.test.ts/CONTRACT.md），golden-module fixture 即此五件套（.agents/skills/architecture-governance/references/golden-module/ 实测含此 5 文件）。
- 还原区登记 .oxlintrc.json:72-96（ignorePatterns 含 apps/drora-cli 整体、packages/zcode-cua\*、packages/mobile-web/upstream|recovered 等）；带 `还原自发行 bundle` 头的文件 grep 统计仅 packages/zcode-cua 7 个（旧服务端复刻已于 2026-10-22 删除）。
- 多代理基座已存在：SubagentPort（apps/drora-cli/packages/contracts/src/interfaces/subagent.port.ts:113-134）已含 sendMessage（:58-85、:130-133，投递语义 queued|steered|resumed_background 见 :74）与后台 start/waitForTask/stopTask（:116-129）；实现位于 apps/drora-cli/packages/core/src/runtime/methods/subagent.ts 与 core/src/subagent/runner.ts；动态工作流已有 lead+子代理花名册（apps/drora-cli/packages/bootstrap/src/app/dynamic-workflow-run-roster-subagents.ts，contracts 侧有 dynamic-workflow-run-roster.port.ts）。
- 契约键单一出处规则（AGENTS.md:56）的物理落点是 `@drora/contracts` 包（apps/drora-cli/packages/contracts）与 packages/shared 常量文件——分析 ls 验证 packages/shared/src 下无 contracts/ 子目录，AGENTS.md 所称 'shared/contracts' 无同名物理目录；实例：DRORA_OFFICIAL_PLUGIN_MARKETPLACE 定义于 apps/drora-cli/packages/contracts/src/plugins/index.ts:7，生产/消费方 apps/drora-cli/packages/adapters/src/plugins/marketplace.ts:9、445-449 引用同一常量（改名桥接决策记录 specs/drora-rename.md:20-28）。
- 协议改动规定同步点为 packages/shared/src/drora-protocol/index.ts（AGENTS.md:72；该文件头无还原 bundle 标记）。
- 本仓无任何 team 痕迹：grep teammate|agents-team|agentteam 于 packages/shared/src、contracts/src、packages/services/src 零命中。

#### 3.3.2 该域扩展点（材料三）

1. packages/services/src/drora-extensions/（services-drora-extensions 托管模块，architecture-policy.yaml:107-121）：自研服务装配 seam 先例——assembleDroraKnowledgeHost（knowledgeHost.ts）经公开入口 packages/services/src/node.ts:1 导出，Desktop Host 消费于 packages/desktop/src/host/index.ts:1、3003；CONTRACT.md:6 明令「禁止加入第二份任务队列/会话状态」。agents team 的服务装配可照此模式。
2. packages/desktop/src/drora-extensions/desktopPet.ts:6（desktop-drora-extensions，policy:79-90）：DI 组装先例 createDroraDesktopPetExtension(dependencies)，装配点 packages/desktop/src/main/index.ts:714；对应决策记录 specs/desktop-pet.md。
3. gen-ui 三模块托管样板（architecture-policy.yaml:131-165）：协议在 packages/shared/src/gen-ui、服务在 packages/services/src/gen-ui、UI 在 packages/ui/src/gen-ui——agents team 这种跨协议/服务/UI 的全栈功能最贴近的模块化模板。
4. apps/drora-cli/packages/contracts/src/interfaces/subagent.port.ts:113-134：子代理执行边界 port；teammate 生命周期与互发消息可直接扩展此 port 或旁挂新 port（interfaces/ 目录即 ports 集中区，含 session.port.ts、permission.port.ts、dynamic-workflow-run-roster.port.ts 等）。
5. packages/ui/src/drora-extensions/（ui-drora-extensions，policy:92-105，含 contract.ts/CONTRACT.md/module.ts/contract.test.ts）：UI 侧接缝；packages/shared/src/drora-protocol/index.ts：跨进程协议改动的规定登记点（AGENTS.md:72）。

#### 3.3.3 该域约束（材料三）

1. 官方实现优先（AGENTS.md:51-53）：动手前必须判定上游是否已有同等 team 能力，覆盖判断含持久化、权限、取消/恢复、身份隔离与平台能力，不能只比功能名或 UI；已覆盖则迁官方契约并删除重复实现，未覆盖才保留独立扩展并记录差异与替换条件。本仓源码无 team 痕迹（grep 零命中），上游是否有同等能力为待验证项（该分析时点；后由材料四实证为无，见 §6.1）。
2. 物理隔离（AGENTS.md:54-55）：新功能一律放新文件/新模块，经 ports、服务注册或协议方法接入；禁止把新逻辑写进还原文件、禁止还原文件 import 自研实现；确需落入还原/上游文件只允许最小接缝，接缝位置与上游同步时的重放方式必须记入 spec。注意 .oxlintrc.json:79 将 apps/drora-cli 整体列入 ignorePatterns，但 architecture-policy.yaml 的 drora-cli/mcp-ui 模块仍受架构门禁管理——lint 豁免不等于治理豁免。
3. 状态唯一所有者（specs/upstream-v3.15.1-migration.md:53-63 状态表）：task/session、被接受输入归 Agent/runtime 与 CommandInbox；Main 只管窗口/进程/转发不承载业务状态（AGENTS.md:73）；外部 relay 不存任务队列/快照（AGENTS.md:77）；不得另建第二份任务队列（packages/services/src/drora-extensions/CONTRACT.md:6）；保留 owner/lease 与 stale run 防护（AGENTS.md:79）。team 板/消息必须指定唯一 owner，禁止双写。
4. 契约键单一出处（AGENTS.md:56）：team 功能新增的 env 键、\_meta 键、Symbol.for 注册表键、wire 协议字段、持久化键前缀只能在契约常量区定义一次。
5. 改名与外部 wire 契约豁免（specs/drora-rename.md）：外部服务 URL/OAuth 回调/归因 header（x-zcode-trace-id 等，:116-131）与豁免区逐字不动；team 若引入新对外字面量须按替换规则表（:8-18）处理并记录。
6. workspaceIdentity 贯穿（AGENTS.md:83-86）：team 板/消息的绑定、去重、队列、持久化统一用 `workspaceIdentity?.trim() || workspacePath`，远程链路传 identity 与 remoteSessionId，不得仅按路径匹配；不得为手机/Web 另起 Agent 或 Host（AGENTS.md:74-76）。
7. 验证要求（AGENTS.md:45、specs/upstream-v3.15.1-migration.md:115）：pnpm typecheck、pnpm lint、架构门禁必须实际运行并如实报告；行为改动先补测试、交互改动补 E2E；状态/时序方案须画 owner 与事件顺序图（AGENTS.md:44）；上游同步时 scripts/check-bundle-key-parity.mjs 会做 env/\_meta/权限/诊断码差分（AGENTS.md:58），team 新增键族须可甄别（在 spec 中登记）。
8. 新行为先写 spec（AGENTS.md:3、SKILL.md:14）：实现前需 specs/agents-team.md（产品规则、状态所有者、接口、验收场景）+ 与官方的有意分歧决策记录（AGENTS.md:60）+ 接缝重放方式记录（AGENTS.md:55）；新托管模块需在 architecture-policy.yaml 登记并提供五件套（SKILL.md:45）。

#### 3.3.4 该域缺口与结论性落地方案（材料三）

- 上游对拍未执行（该分析时点无法在本仓确认 zai-org/ZCode 3.15.1+ 是否已提供 agents-team 能力）——【编者注：该 gap 已由材料四的复核补齐：上游无 team 协议面，见 §6.1】。
- specs/agents-team.md 及决策记录尚不存在（该分析载 specs/ 目录 22 个文件中无 team 相关；材料四 ls 实证为 21 个文件，两材料计数略有出入，均无 team 相关文件）。
- 双链路投递语义未定义；权限与安全接入点未评估（属后续分析域）。
- 结论性落地方案（该分析给出，供汇总）：代码位置——跨进程类型/协议放 packages/shared 新文件并在 drora-protocol/index.ts 登记；运行时编排放 apps/drora-cli 新模块经 contracts port 接入（或扩展 SubagentPort）；服务装配放 packages/services 新托管模块或 drora-extensions；UI 放 packages/ui 新托管模块或 ui/drora-extensions；架构策略按需登记新托管模块；全部先以上游覆盖判定与 spec 决策记录为前置。

---

## 4. 可行性结论

（本章为材料一定稿方案 v3 的 §0 结论，交叉引用已按本报告章节号重排。）

**可行，且 Drora 的架构（单进程 in-process 子代理 + Host 单所有者 + renderer 多视图投影）恰好能把官方 Claude Code Agent Teams 的三个实验性缺口（resume 丢队友、命名即隐式成队、split-pane 不支持 Windows）直接做对。**

推荐形态：**lead 编排（agents-as-tools）+ 单所有者黑板任务板 + 受限成员消息**；不做 handoff 所有权转移、不做 GroupChat 广播发言权、不自建编排框架层（Swarm 归档与 Agent Builder 弃用两个反面证据，见 §2.2.3、§2.2.4）。

**实现基线（v3 定死）：teammate 在 wire 与内部一律复用 `subagent_child`，团队性由请求级 additive 字段承载——行为门零改动是机制结果而非裁决假设。**

结论的支撑（汇总自各材料）：

- 上游无先例：官方 ZCode 上游经穷尽 grep 实证无任何 team 协议面（§3.1.7，材料四复核 confirmed，§6.1）——纯自研增量，按仓库纪律模块化落地。
- 底座已备（§3.1）：子代理构造三件套（child runtime + deriveChildClientPorts 交互路由 + 事件镜像）、终态结算与消息复活链路（finalizeBackgroundCompletion / resumeTerminalAgentInBackground）、权限继承与审批上浮、工具注册门「端口在场即注册」、agent profile 角色定义、UI 配对与下钻先例、dynamic-workflow journal 全套对照实现。
- 协议面 additive 先例齐备（§3.2）：snapshot optional additive 字段（subagents/workflowRuns）、delta 键级增量（workflowRun.\*）、命令 CAS 归类、双链路交付语义与限额、手机远控零新语义接入。
- 治理通道可用（§3.3）：托管模块样板（gen-ui 三模块）、契约键物理落点（@drora/contracts 与 packages/shared 常量区）、还原区隔离与最小接缝纪律均可承载 team 的模块化落地。
- 需要新增的核心面（缺口汇总，§3.1.9/§3.2.7）：共享任务板实体、成员间横向消息、team 实体与花名册、团队视图投影、并发治理（预算/取消传播）、团队级恢复——即第 5 章方案的全部新增内容。

---

## 5. 推荐方案（定稿 v3）

本章为材料一定稿方案 v3 的正文（第 4、5 章主体），章节结构按调研报告需要重排；原方案内部交叉引用（§1→§8）已映射为本章 §5.1～§5.8。v1→v3 修订史与终审回应见第 7 章。

### 5.1 概念模型与术语

#### 5.1.1 术语定义

| 术语                        | 定义                               | 关键语义                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Team（团队）**            | 绑定到一个 lead 会话的显式命名实体 | 一会话至多一 team；**显式 opt-in 创建**（用户命令/UI 入口），不采用官方「Agent 工具带 name 即隐式成队」（外部调研结论：副作用大）；无嵌套 team                                                                                                                                                                                |
| **Lead（领队）**            | 用户的主交互会话 runtime           | 保留最终答复所有权与 guardrail 集中执行点；不新起进程，就是现有 interactive runtime                                                                                                                                                                                                                                           |
| **Teammate（队员）**        | 命名、长寿命、可寻址的子代理成员   | 复用 subagent child runtime 构造（见 §5.3.1），**wire sessionKind 与内部 taskType 均保持 `subagent_child`**（见 §5.3.5）；生命周期 = 现有「终态结算 + 消息复活」链路（见 §5.1.4）；**不允许再派生子代理或 teammate**（现有 child 硬编码 `subagents:{enabled:false}`，core/src/runtime/methods/subagent.ts:305-308，保持不动） |
| **TeamBoard（共享任务板）** | 团队唯一事实源的结构化任务列表     | 三态 + 依赖 + 原子认领；任务卡是强 schema 的结构化交接产物（MetaGPT 实证：抑制级联幻觉）                                                                                                                                                                                                                                      |
| **TeamMailbox（成员邮箱）** | 成员间消息的投递队列               | **写成功 = 发送成功**（持久化后才 ack，照官方语义）；idle 通知携带最终结果                                                                                                                                                                                                                                                    |

#### 5.1.2 状态所有者表（谁写、谁读）

| 状态                                                                | 唯一所有者（写）                                                                                                  | 读取方                                                                 | 持久化位置                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------- |
| 成员花名册（name→agentId/childSessionId/profile/状态机）            | lead runtime 内 **TeamHub**（建议命名，新模块）                                                                   | lead 模型（经工具）、teammate（经 TeamPort 只读快照）、UI 投影（只读） | team journal（session store 侧） |
| 共享任务板                                                          | TeamHub（**所有 board 写操作经 TeamPort 收敛到 hub 串行裁决**，进程内原子，无需官方的文件锁）                     | 同上                                                                   | 同上                             |
| 成员邮箱                                                            | TeamHub 写入；投递给目标成员（运行中 steer / 已终态则触发复活续跑）                                               | 目标成员                                                               | 写入持久化后才返回发送成功       |
| teammate 会话 transcript                                            | 各 child runtime 自己（现状不变）                                                                                 | 下钻 UI 只读订阅 child topic                                           | 现有 session store               |
| UI teamStore（建议命名，放 packages/ui/src/store/，见 §5.3.3 裁决） | renderer 派生缓存，**不得冒充服务端事实**（AGENTS.md 纪律）                                                       | —                                                                      | 内存                             |
| Main / 外部 relay / Host facade                                     | **零团队业务状态**（AGENTS.md：Main 只管窗口/进程/转发；relay 只做鉴权转发，webRemoteControlManager.ts 语义不变） | —                                                                      | —                                |

所有者判据：与 conversation 投影同源、与 RuntimeTaskRegistry 的单 runtime 所有权模型（core/src/runtime-task/registry.ts:70-94）同构，只是把「per-runtime 内存态」升格为「per-lead-session、跨成员、可持久化」。

#### 5.1.3 任务板语义

- 任务卡（建议 schema 落 `packages/shared/src/drora-protocol-v4/team.ts`，纯 schema+纯函数纪律）：`{ taskId, title, spec: { 目标, 验收标准, 产出格式 }, status: pending|in_progress|completed|failed, assignee?, dependsOn: taskId[], artifactRefs[], createdAt/updatedAt }`。三态 + failed（吸收 A2A 1.0.0 终态思想但刻意简化，不引入 INPUT_REQUIRED 等中间态——那些由权限链路自然表达）。
- **原子认领**：`claim(taskId)` 由 TeamHub 单线程裁决（teammate 全部 in-process 同一 CLI 进程内，天然原子——这是与官方文件锁方案的实质差异与优势）；依赖未完成的任务不可认领；任务进入终态时 hub 自动解锁依赖它的任务并向相关成员推送 board 更新。
- **交接纪律**（Cognition + MetaGPT 实证）：任务产出默认**落盘 + 引用回传**（artifactRefs 指向文件），消息只传轻量引用与结论；禁止把任务板退化成自由聊天流。

#### 5.1.4 成员生命周期状态机（已定死：终态 + 复活路线）

```
spawned(TeamSpawn/用户指派) → working(独立 turn)
     → stopped/终态(现有 finalize 链路结算：产物落盘 + idle 通知附最终结果)
     → 消息复活(给终态成员发消息 = resumeTerminalAgentInBackground 同族：恢复历史，消息作为下一条 prompt)
     → working … 循环
stopped → removed(用户移除/lead 会话结束；花名册条目与终态 registry 条目此时才清)
```

- **idle 通知走现有钩子，不新造**：成员 turn 终态结算复用 finalizeBackgroundCompletion（core/src/subagent/runner.ts:1497-1574，实读证实其产出 enqueueBackgroundNotification + BackgroundTaskCompleted + SubagentStopped 三件，通知文本携带最终结果/错误）。
- **消息复活走现有钩子**：给终态成员投递消息复用 resumeTerminalAgentInBackground 的机制（runner.ts:958-1036，实读证实 registry 重注册新生命 + resumeFromStore:true + prompt=消息正文 + resumedFromMessageId 元数据全套现成）；「给等待重试的成员发消息可立即唤醒」的官方语义因此天然获得。
- **TeamHub 观察成员转 idle 不需要新端口方法**：hub 经 RuntimeTaskRegistry.waitForTerminal（registry.ts:197-204）/既有终态通知感知，花名册状态机随终态与复活事件推进。
- **长寿命策略经请求显式传递，不经 taskType**：成员的 maxTurns 由 team 配置（memberMaxTurns，建议默认 40，spec 定值）随 spawn 请求显式传入——methods/subagent.ts:284 的 `request.maxTurns ?? this.config.subagents?.maxTurns ?? 4` 优先级先例（实读+grep 定位证实全文件唯一 maxTurns 消费点）支持请求级覆盖，无需任何 taskType 分叉。
- **名字重定向防护**：花名册记录 name→agentId 绑定；名字被移除后重新使用必须绑定新 agentId；`TeamSendMessage` 校验名字当前仍指向原成员，否则拒绝（照官方语义，防消息发给「顶替了名字的新代理」）。

#### 5.1.5 关键事件顺序图

**spawn → 委派 → 认领 → 协作 → 终态通知 → 复活：**

```
用户/lead模型        TeamHub(lead runtime)        teammate runtime A        teammate runtime B
   │ TeamSpawn(name) ──→ 校验花名册/上限 ─┐          │                        │
   │                     │ 构造 child runtime(复用 methods/subagent.ts:254-392，
   │                     │   taskType 保持 subagent_child，S2 分支仅注入 teamPort
   │                     │   + memberMaxTurns 显式传入)                  │      │
   │                     ├────────── spawn prompt(executeTurn) ──────→│      │
   │                     │                                          │ A: TeamTaskList/Claim
   │                     │←── claim(taskId) 原子裁决(串行) ─────────┤      │
   │                     │  board 更新 → v4 team.* delta 投影        │      │ B: 只读 board 更新
   │                     │←──── TeamSendMessage(A→B) ────────────────┼──────┤
   │                     │ 邮箱持久化→ack；B 运行中→steer(subagent_reply_steer)
   │                     │           / B 终态→复活续跑(消息体自嵌禁令)  │      │
   │                     │←──── 终态结算(idle 通知附最终结果) ─────────┤      │
   │                     │           [现有 finalizeBackgroundCompletion 链路] │
   │   TeamSendMessage(A) → resumeTerminalAgentInBackground 同族复活，     │
   │                        恢复历史，消息为下一条 prompt                    │
```

**权限审批上浮（零授权边界）：**

```
teammate 工具调用 → permissionService.checkPermission(继承 lead 模式)
   → ask 经 deriveChildClientPorts 路由回 lead session(methods/subagent.ts:324-328)
   → v4 pendingInteraction(snapshot.ts:311-351, subagent origin 携带 parent/child sessionId)
   → 用户在桌面/手机同链路 resolveInteraction(command.ts:226-238) 裁决
   ⟂ teammate 间消息 ≠ 任何批准——硬边界由工具执行前门控结构保证(permission-flow.ts:56-96)；
      提示层禁令文本的承载见 §5.6（steer=subagent_reply_steer 渲染自带；复活=消息体自嵌同一常量）
```

### 5.2 拓扑选型

#### 5.2.1 候选模式对比（依外部调研）

| 模式                                          | 代表                                             | 对 Drora 的适配判断                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orchestrator-worker（agents-as-tools）**    | Anthropic 多代理研究系统、Claude Code Agent tool | **主形态**。lead 有界委派、guardrail 与最终答复权集中；与现有 Agent 工具（core/src/tool/handlers/agent.ts:167-215）同构，改动最小                                 |
| **Supervisor（worker 即 handoff 工具）**      | LangGraph create_supervisor                      | 与 orchestrator-worker 同构，**采纳其 `output_mode=last_message` 思想**：只回传成员最终消息，控制 lead 上下文膨胀                                                 |
| **Handoff（所有权转移）**                     | OpenAI Agents SDK / LangGraph swarm              | **不采用**。lead 丢最终答复权；与「一个 runtime 同一时刻只有一个 active turn」的 TurnState 所有权（ActiveTurnStartReservation + command-queue admission）直接冲突 |
| **GroupChat（广播 + 发言权 FSM）**            | AutoGen/AG2                                      | **不采用为中心机制**。全局发言权调度器要与 per-runtime turn 模型抢调度权；广播消息流导致 lead 上下文膨胀。**借鉴一点**：任务板事件流即「全员可见可审计的广播流」  |
| **Blackboard（单一状态所有者 + 读写共享区）** | Hearsay-II、A2A task 单方持有                    | **任务板采纳**。正好对上 AGENTS.md「避免重复状态和多条写入路径」与仓库单所有者纪律                                                                                |
| **SOP 角色流水线**                            | MetaGPT                                          | 采纳为**协作纪律**（任务卡强 schema 交接产物），不做成硬编码流水线                                                                                                |
| **顺序优先 + 只读并行**                       | Cognition「Don't Build Multi-Agents」            | **采纳为默认调度纪律**：后派者能读到先完成者产物；并行仅限只读无副作用任务                                                                                        |
| 反面证据                                      | Swarm 归档、Agent Builder 2026-11-30 停服        | **不自建编排框架层、不做可视化编排器**；team 只是一组工具 + 一块板 + 一个邮箱                                                                                     |

#### 5.2.2 推荐拓扑与理由

**显式 lead 编排 + 单所有者黑板 + 受限成员消息**：

1. **与 turn 所有权模型相容**：teammate 各自是独立 runtime/session，各自持有自己的 TurnMachine 与命令队列（core/src/runtime/command-queue.ts:11-17 串行 admission 不变）；「谁该干活」由任务板（确定性代码外壳）表达，而不是由全局发言权调度器涌现——LLM 只决定「拆什么、派给谁」（OpenAI 编排指南的代码/LLM 分层结论）。
2. **guardrail 集中**：权限审批、产出扫描、最终答复都收在 lead 一侧，权限上浮链路（§5.6）完全复用现状。
3. **上下文碎片化的结构性缓解**：成员不互相读完整 trace，共享的是任务板 + 落盘产物引用（Anthropic 15 倍 token 放大与 Cognition 上下文碎片化两个实证约束的共同解法）。
4. **成员消息是增强而非依赖**：无消息能力时（受限角色）成员仍可凭任务板自领/交付（官方外部调研同款兜底语义）。

### 5.3 模块落点：与现有链路的接法

#### 5.3.1 复用清单（不改）

| 能力                                                                                  | 位置                                                                                                                                                                                                                                                                                                           | 复用方式                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| teammate 会话构造三件套（child runtime + deriveChildClientPorts 交互路由 + 事件镜像） | core/src/runtime/methods/subagent.ts:254-392                                                                                                                                                                                                                                                                   | TeamHub 的 spawn 直接走同一条构造路径（parentSessionId/taskType=subagent_child/权限继承/childClientPorts 全部照旧，仅按接缝 S2 加 team 分支注入 teamPort 与 memberMaxTurns）                                                                                                                                                                                  |
| 后台生命周期、终态结算、abort 级联、复活                                              | core/src/subagent/runner.ts:184-218、622-654、903-1036、1497-1574                                                                                                                                                                                                                                              | **teammate = 走现有终态结算的后台式 child**：turn 完成即 finalize（idle 通知/产物落盘全现成），TeamHub 保留花名册与 registry 条目不清理；给终态成员发消息 = resumeTerminalAgentInBackground 同族复活                                                                                                                                                          |
| **subagent_child 行为门（v3：整族自动继承）**                                         | runtime-tools.ts:55-56/67/72/213-216/228、tool-allowlist.ts:114、subagent-session-query.ts:395、server-operations.ts:1738、v4-bridge.ts:1764-1771、model-request-session-type.ts、turn-model-step-usage.ts、runtime-telemetry.ts、background-notifications.ts、subagent-observation.ts:51/95 等（§5.4.3 清单） | taskType 保持 subagent_child ⇒ **全部门按现状命中，零改动**：runtimeScope=subagent、automation/offPeak 不注册、后台 bash 上限适用、RespondToCoordinator 经 allowlist 补回、下钻/查询链路包含 teammate、v4-bridge 只读守卫覆盖 teammate（用户对成员说话必须走 lead 侧邮箱）                                                                                    |
| **成员侧消息投递（v3 重设计：team 模块自有代码，不复用 message-steering.ts）**        | 注入渲染：incoming-message.ts:23-24（subagent_reply_steer → "Another Drora session sent a message…" + PEER_PERMISSION_GUIDANCE + 回复指引，实读证实）；复活路径现状：methods/subagent.ts:458-459（硬编码 coordinator_input=裸 body，实读证实）                                                                 | **不复用** message-steering.ts:32,44（其硬编码 coordinator_steer、无禁令）。新文件 `core/src/team/member-delivery.ts`：运行中成员 → steerTurn 且 inputPresentation 用现有枚举值 `subagent_reply_steer`（渲染自带禁令与回复指引，方向语义吻合）；终态成员 → 复活投递，消息体由 message-format.ts 自嵌团队头+禁令（常量自 incoming-message.ts:5 导出，接缝 S5） |
| lead 接收成员回复                                                                     | subagent-messages.ts:77-99（persistSubagentMessageCommand 产生 subagent_reply(\_steer)，实读证实）                                                                                                                                                                                                             | 方向本来正确（成员→lead），现状复用；teammate 也可用 TeamSendMessage(to: lead) 走邮箱                                                                                                                                                                                                                                                                         |
| 工具注册门「端口在场即注册」                                                          | core/src/runtime/helpers/runtime-tools.ts:50-87（includeAgent/includeRespondToCoordinator 等先例，实读确认）                                                                                                                                                                                                   | 新团队工具走同一门模式：includeTeam = Boolean(deps.teamPort)；executor 侧透传见接缝 S4                                                                                                                                                                                                                                                                        |
| 权限链路                                                                              | permission-flow.ts:56-96 门控位置、resolveSubagentPermissionMode（methods/subagent.ts:527-549）、subagent origin（interaction-origin.ts:17-37）、v4 pendingInteraction/resolveInteraction                                                                                                                      | 全部原样；见 §5.6                                                                                                                                                                                                                                                                                                                                             |
| 成员角色定义                                                                          | `.drora/agents/*.md` profile（core/src/subagent/profile.ts:46-70 normalize；color 字段 profile.ts:30,80 可做成员视觉标识）+ ISubagentsService 管理面（packages/services/src/subagents/subagents.ts:15-41）                                                                                                     | teammate 角色即 agent profile；tools/model/permissionMode 沿 profile 治理                                                                                                                                                                                                                                                                                     |
| v4 投影链                                                                             | conversationSnapshotSchema additive optional 先例（subagents/workflowRuns，snapshot.ts:497-500，实读确认）、delta 键级增量（delta.ts:104-189）                                                                                                                                                                 | team 状态作为 snapshot 第三个 additive 实体，**不新增 RPC topic、host/services/desktop-main 零改动**                                                                                                                                                                                                                                                          |
| UI 多会话下钻                                                                         | WorkflowActorSessionSidePane.tsx:56-108「父投影门 + 只读 SessionPane 租约复用」                                                                                                                                                                                                                                | 直接复制为 TeamMemberSidePane                                                                                                                                                                                                                                                                                                                                 |
| 手机远控                                                                              | webRemoteControlSharedHostAttachments.ts:41-189（attachLocalHost 已注入 clientMode=web-remote-replayable）                                                                                                                                                                                                     | team 帧沿既有 relay 桥透传，零新语义                                                                                                                                                                                                                                                                                                                          |
| 编排对照实现                                                                          | dynamic-workflow 引擎（journal/resume/concurrency）                                                                                                                                                                                                                                                            | 不复用其引擎，但 team 持久化/resume 设计以其 journal 模式为对照                                                                                                                                                                                                                                                                                               |

**刻意不复用/不动**：`Task` 兼容别名（core/src/tool/compat.ts:2）与 Agent 工具 schema（contracts/src/tools/agent.ts:18-33，实读确认现状无 name 参数）一概不动——上游对齐文件，见 §5.4.2 接缝策略。

#### 5.3.2 新增模块与放置

| 层       | 新增                                                                                                                                          | 放置                                                                                                                                            | 说明                                                                                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 契约 | `TeamPort` 接口 + 请求/结果类型                                                                                                               | `apps/drora-cli/packages/contracts/src/interfaces/team.port.ts`（建议命名，照 subagent.port.ts 体例）                                           | 唯一新增端口                                                                                                                                                                                                                                         |
| CLI 契约 | 团队事件枚举值（TeamMemberSpawned/TeamBoardUpdated/TeamMessageDelivered 等，additive）                                                        | contracts/src/events/session.events.ts（现有 SubagentSpawned/Message/Stopped 在 :178-180，实读确认）                                            | UI 消费走 v4 投影，事件主要用于 CLI 内部与测试观测                                                                                                                                                                                                   |
| CLI 核心 | `TeamHub / TeamBoard / TeamMailbox / teammate 生命周期 / 工具注册 / 消息格式化 / 成员投递 / v4 投影产出`                                      | `apps/drora-cli/packages/core/src/team/`（建议命名，新目录，照 subagent/ 目录体例；含 member-delivery.ts 与 message-format.ts）                 | 自研主体，全部新文件                                                                                                                                                                                                                                 |
| CLI 核心 | 工具 handler：TeamSpawn、TeamTaskCreate/Get/List/Update、TeamSendMessage、TeamList（建议命名）                                                | `core/src/team/team-tools.ts` + `core/src/tool/handlers/team-*.ts`（新文件）                                                                    | 经注册门注入，不改现有工具                                                                                                                                                                                                                           |
| shared   | team 投影 schema、delta ops、限额常量、持久化键前缀                                                                                           | `packages/shared/src/drora-protocol-v4/team.ts`（建议命名，照 workflow-runs\*.ts 模式：纯 schema+纯函数）                                       | v4 是自研演进面（transport.ts:330-331 注释明确旧面删除后 v4 是唯一协议面），无上游对齐负担                                                                                                                                                           |
| shared   | snapshot `team: teamProjectionStateSchema.optional()`；delta `team.*` ops；用户面命令 payload（stopTeamMember/sendTeamMessage 等）及 CAS 归类 | snapshot.ts / delta.ts / command.ts（additive）                                                                                                 | CAS 归类照 COMMANDS_REQUIRING_BASE_REVISION（command.ts:319-335）逐条判定                                                                                                                                                                            |
| UI store | **teamStore.ts（v2 裁决：归属全局 store 目录）**                                                                                              | `packages/ui/src/store/teamStore.ts`                                                                                                            | 裁决依据：AGENTS.md「Zustand 状态位于 packages/ui/src/store/」为明文纪律，且该目录实测已是全仓 store 唯一落点（subagentsStore.ts、droraSessionStore.ts 等约 40 个文件）；**托管模块自治不适用于全局单例状态**——spec 显式登记此裁决，避免架构检查反复 |
| UI 组件  | TeamPanel + TeamBoardView + TeamMemberSidePane + hooks                                                                                        | `packages/ui/src/team/`（建议新托管模块 `ui-team`，照 gen-ui 三模块样板 architecture-policy.yaml:130-163，实读确认 gen-ui-protocol 自 :130 起） | 只消费 v4 投影；依赖方向 ui-team → ui(store)，符合托管模块 requires 语义                                                                                                                                                                             |
| UI 手机  | MobileTeamPanel（任务板只读 + 成员状态 + 发消息走既有命令链路）                                                                               | packages/ui/src/mobile（现有 MobileTaskShell 旁）                                                                                               | replayable 语义见 §5.5                                                                                                                                                                                                                               |
| spec     | `specs/agents-team.md`                                                                                                                        | specs/                                                                                                                                          | 决策记录（见 §5.4.4）                                                                                                                                                                                                                                |

#### 5.3.3 TeamPort 接口建议（只列方法签名语义，不写实现）

```
TeamPort（建议命名）——由 lead runtime 的 TeamHub 实现，注入 teammate child runtime deps
  roster(): TeamRosterSnapshot                       // 只读花名册（spawn 时注入 sibling 快照，运行中实时读）
  boardRead(): TeamBoardSnapshot                     // 只读板
  taskCreate / taskUpdate(input): TeamTaskMutationResult   // 写收敛到 hub 串行裁决
  taskClaim(taskId): TeamTaskClaimResult              // 原子认领（成功/已被占/依赖未就绪三态结果）
  send(request: { to: memberName|agentId, message, summary }): TeamSendResult
                                                     // 写邮箱持久化成功才算发送成功；投递结果 queued|steered|resumed
                                                     // （复用 SubagentSendMessageDelivery 语义，subagent.port.ts:74；
                                                     //  steered=运行中成员以 subagent_reply_steer 注入；
                                                     //  resumed=终态成员复活续跑，消息体自嵌禁令——§5.6）
```

工具面映射：lead 注册全部工具；teammate 按 profile 的 tools 面裁剪（但 runtime 强制保留 TeamSendMessage 与 TeamTask\*——对齐官方「即使 disallowedTools 也保留协作工具」的强制补发语义）；受限只读角色（Explore 型）不注入 TeamPort 即不注册团队工具。

#### 5.3.4 会话种类与 taskType 决策（v3 定死：全线复用 subagent_child，不新增内部 taskType）

- **wire sessionKind = `subagent_child`**（droraSessionKindSchema 闭集不加值——旧端收到未知枚举整帧解析失败的偏斜代价，snapshot.ts:365-368 注释教训）：旧桌面/手机把 teammate 当普通子代理显示，天然优雅降级；任务索引排除（droraTaskIndexSyncer.ts:1680）自动沿用。
- **内部 taskType 亦保持 `subagent_child`**（v3 裁决）：**方向 A（新增 `team_member`）已评估并否决**——否决理由：全仓行为门为严格相等判定，新值不命中即落入非子代理分支，待遇翻转（runtimeScope="main"、automation/offPeak 注册、后台 bash 上限失效、subagent-session-query.ts:395/server-operations.ts:1738 跳过导致下钻漏出、tool-allowlist.ts:114 不补回 RespondToCoordinator），逐点改判定≈10+ 处新接缝，违背最小接缝纪律且上游同步成本高。**采纳方向 B**：团队性由 SubagentLaunchRequest 的 additive 字段 `teamMember`（含 memberMaxTurns）承载（接缝 S1），构造分支仅做注入（接缝 S2）；长寿命策略经 request.maxTurns 显式传递（methods/subagent.ts:284 优先级先例）。**推论：原 v2 接缝 S5（session-mapper 映射分支）撤销**——taskType 无新值，session-mapper.ts:310 的 as 强转自然产出 subagent_child；SESSION_TASK_TYPES 不动（原 S6 撤销）。
- teammate 与一次性 subagent 的区分不在会话种类层，而在 TeamHub 花名册与 team 投影（UI 团队面板按 roster 识别成员）；会话层 teammate 就是子代理——这正是全族行为门自动正确的原因。

### 5.4 上游对齐策略

#### 5.4.1 上游现状判定（已实证）

仓内分析对官方上游做了穷尽 grep：3.14.3 发行 bundle 资产、zcode-cua 0.6.3、docs/upstream 分析文中 `teammate`/`swarm`/`crew`/`agents team` 零命中；`team*` 字面量全部是「Team Coding Plan」订阅套餐标识；CLI 主体（v3.15.1 公开源码对齐版）agent 域无 team 概念。**结论：agents team 无上游实现可借，是纯 Drora 自研增量**；按 AGENTS.md「上游对齐与模块化扩展」节，全部新逻辑放新文件/新模块，经 ports 接入，spec 留决策记录与替换条件。（材料四随后对 3.14.3 原版 bundle 的独立复核进一步证实，见 §6.1。）

#### 5.4.2 接缝清单与重放方式（spec 必须逐条登记；v3 重新总账）

| #   | 接缝位置                                                                                             | 改动性质                                                                                                                                                                                                                           | 上游同步时的重放方式            |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| S1  | contracts/src/interfaces/subagent.port.ts                                                            | SubagentLaunchRequest 加 optional `teamMember?: { teamId, memberName, memberMaxTurns? }`（additive 字段）                                                                                                                          | 加回一个 optional 字段          |
| S2  | core/src/runtime/methods/subagent.ts                                                                 | 构造处**单处分支**：teamMember 在场 → child deps 注入 teamPort、maxTurns 取 `teamMember.memberMaxTurns ?? request.maxTurns ?? 现状默认`（:284 优先级先例）；**taskType 保持 subagent_child 不变**                                  | 加回单处分支                    |
| S3  | core/src/runtime/types.ts                                                                            | AgentRuntimeDeps 加 `teamPort?: TeamPort` 字段（subagentPort/coordinatorResponsePort/workflowEscalatePort 同族先例在 :357-371，实读确认）                                                                                          | 加回一个字段                    |
| S4  | core/src/runtime/helpers/runtime-tools.ts                                                            | **同文件两行**：注册门 `includeTeam: Boolean(deps.teamPort)`（:50-87 区）+ createRuntimeToolExecutor 把 teamPort 传入 createToolExecutor deps（:150-235 区，实读确认该函数现状透传 subagentPort/coordinatorResponsePort 等全端口） | 加回两行                        |
| S5  | core/src/system-reminder/incoming-message.ts:5                                                       | PEER_PERMISSION_GUIDANCE 常量加 `export`（**一词接缝**，供 team/message-format.ts 组装复活消息体，保禁令文本单一出处；v3 新增）                                                                                                    | 加回一个 export 关键字          |
| S6  | contracts/src/events/session.events.ts                                                               | 事件枚举加值（additive）                                                                                                                                                                                                           | 加回枚举项                      |
| S7  | packages/shared drora-protocol-v4（snapshot/delta/command/team.ts）                                  | additive optional 字段 + 新 ops + 新命令                                                                                                                                                                                           | v4 为自研协议面，无上游对齐负担 |
| S8  | packages/ui（store 目录新文件 + ui-team 新模块 + mobile）与 architecture-policy.yaml（ui-team 登记） | 全新文件/模块                                                                                                                                                                                                                      | 无上游冲突                      |

**注 1（v3 总账）**：接缝分两档——**A 档·上游对齐文件内的最小接缝 6 处（S1-S6，共 8 个触点：一字段/一分支/一字段/两行/一词/一枚举项）**；**B 档·自研协议与界面的全新文件（S7/S8，无上游冲突）**。v2 的 C 档「行为门裁决清单」在 v3 裁决（taskType 复用）后**降级为验证清单（零改动）**，不再是接缝负担（§5.4.3）。历史修正记录：v1 总账漏报 S3/S4 executor 半边；v2 曾含 session-mapper 映射（S5）与 SESSION_TASK_TYPES（S6）两处，v3 随 taskType 裁决撤销。

**注 2（RuntimeInputPresentation 偏斜面，v3 维持澄清）**：该枚举（runtime-input-presentation.ts:4-12）**不在 v4 wire 面**（grep packages/shared/src/drora-protocol-v4/ 零引用，引用点仅 session.events.ts:523 持久化事件载荷与 session.port.ts:154/268/432，读取侧 safeParse 防御 :15-20）。本方案**零加值**：成员侧投递由 team 模块自有代码选用现有值 subagent_reply_steer（注入运行中成员，渲染自带禁令）；lead 侧接收沿用 subagent_reply(\_steer) 现状产生点（subagent-messages.ts:84）。复活路径 presentation 硬编码 coordinator_input（methods/subagent.ts:458-459）不动，禁令由消息体自嵌（S5 导出常量）。若未来确需区分 teammate 消息的注入文案而加值，真实代价是旧 CLI 读新持久化事件时单字段 safeParse 降级（非整帧失败）——届时按 spec 决策流程评估。

**Agent 工具与 Task 别名零改动**的承诺不变——官方 Claude Code 用「Agent 工具加 name 参数」成队，若未来 ZCode 上游同样引入 name 参数，按「官方实现优先」纪律把 TeamSpawn 迁到官方契约并删除重复面（替换条件写入 spec）。

#### 5.4.3 subagent_child 行为门验证清单（v3：零改动验证，非裁决）

本会话实测（材料一所载）：`grep -rln 'taskType === "subagent_child"' apps/drora-cli/packages/{core,bootstrap}/src packages/services/src` 命中 **8 个文件**（bootstrap/src/drora-protocol/server-operations.ts、bootstrap/src/drora-protocol/v4-bridge.ts、core/src/runtime/helpers/runtime-tools.ts、core/src/runtime/helpers/tool-allowlist.ts、core/src/runtime/methods/background-notifications.ts、core/src/runtime/methods/model-request-session-type.ts、core/src/runtime/methods/turn-model-step-usage.ts、core/src/telemetry/runtime-telemetry.ts）；`!==` 形式命中 bootstrap/src/app/subagent-observation.ts:51、:95 与 subagent-session-query.ts:395、server-operations.ts:1738（后两处本人实读证实为「非 subagent_child 即跳过」的子会话筛选）；文件级命中 subagent-session-query.ts、drora-protocol-v4/product-projection.ts、drora-protocol-v4/v4-gateway.ts；services 侧按 sessionKind 判定的 droraTaskIndexSyncer.ts:1680 与评审点名的 droraTaskServiceAdapter.ts、repairSubagentTaskIndex.ts（后三处判定形式本人未逐一复核，以 M0 全量 grep 清单为准）。合计约 12-15 个点位。

> 【复核勘误（材料四，见 §6.2）】行为门行号属实但计数有偏差：runtime-tools.ts 实为 **6 处**（56/67/72/214/228/269，方案 v3 原文计「五处」）；server-operations.ts 另有未点名的 **:1957**；全仓非测试源码 ===/!== 行为门实数 **22 处**（core/bootstrap 19 + services sessionKind 3），非「约 12-15 处」。计数修正不改变「taskType 保持 subagent_child ⇒ 全部门按现状命中」的判定结构，但 M0 的验证清单应按 22 处口径登记。

**v3 结论：因 taskType 保持 `subagent_child`，上述全部点位按现状命中，teammate 与一次性 subagent 同待遇——零判定改动，无需任何「例外裁决」**。具体继承效果（既有机制自动获得）：runtimeScope="subagent"（runtime-tools.ts:228）、automation/offPeak 工具不注册（:67/:72）、后台 bash 上限适用（:213-216）、RespondToCoordinator 经 allowlist 补回（tool-allowlist.ts:114，实读证实）、下钻/查询链路包含 teammate（subagent-session-query.ts:395、server-operations.ts:1738）、**v4-bridge 只读守卫自动覆盖 teammate**（:1764-1771，实读证实 guard.subagentReadOnly——用户对成员说话必须经 lead 侧团队命令走邮箱，保持单审批面与 CommandInbox admission 边界；v2 曾列为「需扩判的例外」，v3 后自动成立）、模型请求归类/用量/telemetry/通知封印按子会话现状。**M0 spec 登记的是验证记录（每点一行「命中确认+预期行为」），M1 验收为回归测试**（§5.7）；**继承原则入 spec**：上游后续新增任何 subagent_child 门，teammate 自动继承其行为——默认正确，因为 teammate 本质就是子代理；若某新门语义确需区分，按 spec 决策流程逐点评估（这是未来的事，不是本方案的前提）。

#### 5.4.4 契约键、spec 与治理登记

- **契约键单一出处**（AGENTS.md:56）：team 的 wire 命令名、delta op 名、事件名、持久化键前缀、灰度 env/settings 键，只在 `packages/shared/src/drora-protocol-v4/team.ts` 常量区与 `@drora/contracts` 定义一次，CLI 与双端同源引用；上游同步时 `scripts/check-bundle-key-parity.mjs` 的键族差分须能甄别 team 新增键（spec 登记）。
- **specs/agents-team.md** 内容：产品规则（显式成队、一会话一队、无嵌套、成员上限默认 5）、状态所有者表（§5.1.2）、接口（§5.3.3）、验收场景（§5.7 各里程碑）、与官方差异（对 Claude Code 的四点分歧：显式成队/单所有者内存板替代文件锁/全 in-process 无 tmux 依赖天然覆盖 Windows/team 可恢复）及替换条件、**接缝表（§5.4.2 两档总账）与逐条重放方式、行为门验证清单与继承原则（§5.4.3）、taskType 复用裁决与方向 A 否决理由（§5.3.4）、RuntimeInputPresentation 零加值决策与偏斜面澄清（§5.4.2 注 2）、成员消息禁令承载机制（§5.6）、teamStore 归属裁决（§5.3.2）**。
- **架构治理**：新托管模块 `ui-team` 在 architecture-policy.yaml 登记并提供五件套（module.ts/contract.ts/contract.example.ts/contract.test.ts/CONTRACT.md，SKILL.md:45 要求；gen-ui 三模块样板在 :130-163，实读确认）；CLI 侧 core/src/team/ 属 drora-cli 模块（managed: false，:73-75）但仍受架构检查覆盖；`pnpm architecture:check --changed` 每阶段必跑。
- **灰度**：team 默认关闭，经 settings/config 显式开启（键定义在契约常量区），与仓库现有灰度门（offPeak/dynamicWorkflow 的端口/配置双门先例，runtime-tools.ts:67-76）同风格。

### 5.5 UI 与多端面

#### 5.5.1 桌面（desktop-continuous 实时链路）

- **TeamPanel**（建议命名，挂 WorkflowRunSidePane 同级的会话侧栏区）：成员卡（名称/角色 profile/color——profile color 字段可做视觉标识）、任务板三列视图（pending / in progress / completed，依赖以连线或缩进表达）、成员消息流摘要（尾窗）。UX 借鉴官方：全 idle 30s 折叠空闲行、>3 idle 折叠为「N idle agents」；subagent 与 teammate 混排同面板。
- **TeamMemberSidePane**：复制 WorkflowActorSessionSidePane.tsx:56-108 的「父投影门 + 只读 SessionPane 租约」模式，可下钻成员 transcript 并向成员发消息（走 v4 命令）。
- 数据全部来自 conversationProjectionStore 的 team 投影（snapshot A 区 additive 字段 + team.\* delta），**不走第二条真相通道**；派生视图状态入 teamStore（packages/ui/src/store/）。

#### 5.5.2 Web / 手机远控（web-remote-replayable 恢复链路）

- **冷快照必须携带 team 字段**（optional 只服务旧快照 wire 兼容，新 CLI 初始态与每次投影都携带——逐字照 workflowRuns 的冷快照教训，snapshot.ts:498-500）：刷新/重连/手机恢复后 team 面板不丢成员。
- 手机 MobileTeamPanel：任务板只读 + 成员状态 + 给成员发消息/停止成员走既有命令链路（replayable 自动 inputOrigin=mobile 的现有语义，droraAgentService.ts:6050-6059）；不为手机另起 Agent/Host（AGENTS.md，webRemoteControlSharedHostAttachments.ts:41-189 现状直接覆盖）。
- **背压与限额**：team 消息流投影只保留尾窗（完整消息落 session store/journal），事件保留 2000/会话与 subscriberBufferMaxOps 双限额（core.ts:64-100）约束下，增量走键级 delta 并在 PROTOCOL_V4_LIMITS 加 team 键（如 teamMessagesRetentionPerMember）；relay envelope 尺寸上限（webRemoteControlManager.ts:966-969 oversize 即降级）要求 team 帧有界；可选能力位 `teamDeltas` 照 workflowRunDeltas 的「可信 host 注入的连接事实」模式（transport.ts:431-436）。
- replayable 不产生 telemetry/CUA observation 的 facade 现状（droraAgentConnectionScope.ts:857-897）对 team 无例外。

#### 5.5.3 恢复语义（对官方缺口的超越点）

lead 会话 resume 时 TeamHub 从 team journal 恢复花名册/任务板/邮箱未读；成员 transcript 本就以 childSessionId 落 session store（methods/subagent.ts:394-419 已有 resumeFromStore 路径），终态成员按 §5.1.4 复活链路唤醒。官方 Claude Code 自认的 resume/rewind 丢队友缺口，Drora 用「team 状态整体作为可恢复事实」从根上修掉；branchGeneration stale fencing（subagent-messages.ts:26-42）对迟到的成员消息照常生效。

### 5.6 权限与安全

1. **模式继承与工具面**：teammate 继承 lead 权限模式（resolveSubagentPermissionMode 先例，methods/subagent.ts:527-549）；Explore 型角色用独立只读 PermissionService（:340-343 先例）；`--dangerously-skip-permissions` 类传导沿用现有子代理继承语义，不新增通道。plan 工具（EnterPlanMode/ExitPlanMode）由 SUBAGENT_CHILD_FORCED_DISALLOWED_TOOLS（tool-policy.ts:7-10，:25-26 注释明确所有子代理统一剔除，实读确认）**结构性排除**——teammate 不可能发起 plan approval，因此**本方案不设任何计划审批例外条款**（v2 删除原「lead 代拒」条款：该情形已被结构性排除，代拒反而引入 lead 代理裁决的灰色面）。
2. **审批上浮与单审批面**：teammate 的权限 ask 经 deriveChildClientPorts 路由回 lead session（methods/subagent.ts:324-328：桌面 UI 只认识父 task 的 sessionId）→ pendingInteraction 携带 subagent origin（interaction-origin.ts:17-37）→ 桌面/手机同一条 resolveInteraction 链路裁决。多成员并发 ask 时每个仍是独立 interactionId 的待决项，UI 按 origin 分组成员徽标，**不合并、不代理裁决**。**输入边界（v3 后自动成立）**：v4-bridge.ts:1764-1771 只读守卫因 taskType 复用自动覆盖 teammate 会话——teammate 不接受绕过 lead 的直接 conversation 输入，用户对成员说话必须经 lead 侧团队命令走邮箱投递，保持单审批面与 CommandInbox admission 边界。
3. **代理消息零授权（硬边界 + 承载机制，v3 重设计）**：任何 teammate 消息不得充当待决权限的批准或用户同意；被拒操作不得经成员转发绕过。**硬边界不依赖提示文本**——由工具执行前门控位置（permission-flow.ts:56-96）与权限服务裁决链结构性保证。提示层禁令文本的双路承载：(a) **运行中成员（steer）**：team 模块投递代码（member-delivery.ts，新文件）调 steerTurn 且 inputPresentation 用现有值 `subagent_reply_steer`，incoming-message.ts:23-24 的渲染自动附加 PEER_PERMISSION_GUIDANCE（peer 不可提权/不得视作用户批准/识别并拒绝 permission laundering）与回复指引——**枚举与语义表零改动**（v2 误将该承载归于既有注入链路，实读证实既有链路硬编码 coordinator_steer 无禁令，v3 改由 team 模块自有投递代码显式选值）；(b) **终态复活成员**：复活路径 presentation 硬编码 coordinator_input 即裸 body（methods/subagent.ts:458-459），消息体由 core/src/team/message-format.ts 组装「团队头（发件成员/任务引用）+ 正文 + PEER_PERMISSION_GUIDANCE（自 incoming-message.ts:5 导出，接缝 S5，单一出处）」。
4. **后台与取消**：teammate 后台生命周期只依赖持久化 profile selection（单次执行模型禁入后台的 BACKGROUND_UNAVAILABLE 纪律，runner.ts:153-167）；团队级取消 = 停止 lead turn 级联 abort 各成员——现有 abort 级联只覆盖一层父子（runner.ts:622-654），**「禁止 teammate 派生」使一层级联恰好充分**，这是该禁令的第二个独立理由。
5. **身份隔离**：team 实体绑定 `workspaceIdentity?.trim() || workspacePath`；远程链路贯穿 workspaceIdentity 与 remoteSessionId（AGENTS.md Workspace Identity 节），不按路径匹配。

### 5.7 分阶段落地计划（里程碑 + 验收标准）

#### M0：spec 与上游对拍（约 1 周）

- 交付：specs/agents-team.md（§5.4.4 大纲全项：两档接缝总账、§5.4.3 行为门**验证记录**（每点「命中确认+预期行为」）与继承原则、taskType 复用裁决及方向 A 否决理由、消息禁令承载机制、presentation 零加值决策、teamStore 归属）；architecture-policy.yaml 登记 ui-team 五件套骨架；取得新版 ZCode bundle 后跑 `node scripts/check-bundle-key-parity.mjs`（当前 3.14.3/3.15.1 已实证无 team 面，此为持续动作）。
- 验收：spec 评审通过（含状态所有者表与事件顺序图）；行为门清单逐点有验证记录；`pnpm architecture:check --changed` 通过。

#### M1：CLI 内核（约 2-3 周，无协议改动）

- 交付：contracts team.port.ts + 事件枚举 additive；core/src/team/ 全套（hub/board/mailbox/lifecycle/tools/member-delivery/message-format/projection 雏形）；接缝 S1-S6；灰度开关。
- 验收：① 单测——板原子认领并发（两成员同时 claim 仅一成功）、依赖阻塞与终态解锁、写成功即发送（邮箱持久化前不 ack）、名字重定向拒绝、**复活消息体含导出的禁令文本（S5 单一出处断言）**；② 会话级 e2e——lead spawn 2 命名成员→委派→终态结算产生 idle 通知（现有 finalize 链路）→消息复活（恢复历史、消息为下一条 prompt）；③ **行为门零改动回归（§5.4.3 验证清单的自动化化）**——teammate 会话 runtimeScope=subagent、automation/offPeak 未注册、下钻查询（subagent-session-query/server-operations 路径）包含 teammate、直接对 teammate 会话发 conversation 输入被 v4-bridge 只读守卫拒绝（guard.subagentReadOnly）、memberMaxTurns 显式传递生效（不落 `?? 4` 截断）；④ 权限——成员写操作触发 ask 且以 subagent origin 出现在 lead 会话待决面、拒绝后成员经 TeamSendMessage 转述批准无效；⑤ `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 全绿并如实报告。

#### M2：协议与桌面 UI（约 2 周）

- 交付：shared team.ts + snapshot additive 字段 + team.\* delta + 用户面命令（CAS 归类）；UI teamStore（packages/ui/src/store/）/TeamPanel/TeamBoardView/TeamMemberSidePane（ui-team 模块）。
- 验收：① v4 冻结面黄金测试（additive optional 全带 default——meta 字段教训 snapshot.ts:482-485）；② 旧快照（无 team 字段）旧端解析不破坏；③ 桌面 E2E（desktop-continuous）：实时帧、断线 resync 后 team 面板状态一致；④ 冷快照必带 team 字段的 round-trip 测试。

#### M3：持久化与 replayable（约 2 周）

- 交付：team journal 持久化 + lead 会话 resume 恢复 team（终态成员可消息复活）；MobileTeamPanel；背压限额与（如需）teamDeltas 能力位。
- 验收：① 刷新/重连/手机冷恢复后成员与任务板不丢（对照 workflowRuns 冷快照教训）；② web-remote-replayable E2E：gap 重放、消息尾窗裁剪、envelope 有界；③ 迟到成员消息的 branchGeneration 丢弃验证。

#### M4：治理与打磨（约 1-2 周）

- 交付：团队级预算（token/成员数/并发上限，usage 聚合进 A 区 usage 投影）、空闲回收策略、质量门 hooks 评估（TeammateIdle/TaskCompleted，评估挂现有 workspace hooks 机制承载）。
- 验收：预算超限拒绝新 spawn 且文案明确；团队取消传播（停 lead 全员级联终止）测试；两链路回归全绿。

### 5.8 风险与开放问题

#### 5.8.1 风险

1. **token 放大**（Anthropic 实证约 15 倍）：产物落盘+引用回传、last_message 回传模式、板级预算三重抑制；功能定位收窄在可并行的大范围调研/批量验证/多模块任务，避开紧耦合编码场景（Anthropic 实证收益为负）。
2. **编排失控**（官方早期失败：简单查询 spawn 50 个 subagent）：显式成队 + 成员数默认上限 5 + 扩缩规则写入 lead 系统提示 + 灰度默认关。
3. **上下文碎片化**（Cognition 两致命伤）：默认顺序调度、只读任务才并行、任务卡强 schema 交接。
4. **上游同步漂移**（v3 修正）：上游对齐文件内接缝 6 处（S1-S6，8 触点）均单行/单词级且 spec 记录重放；**行为门继承是双刃但默认正确**——上游若新增/修改 subagent_child 门，teammate 自动继承（teammate 本质是子代理），spec 已登记该继承原则；仅当某新门语义确需区分时才逐点评估。methods/subagent.ts 构造路径重构时 S2 需人工重放，靠 check-bundle-key-parity 键族差分预警。
5. **冻结面偏斜**：**wire 闭集（droraSessionKindSchema 等 v4 面）不加值**——teammate 线上与内部均为 subagent_child，session-mapper.ts:310 直转自然合法；RuntimeInputPresentation **不在 v4 wire 面**（实测 v4 零引用，仅 CLI 本地持久化与接口），本方案零加值，成员侧投递选用现有值 subagent_reply_steer，复活路径禁令走消息体自嵌；所有 v4 additive 字段必须 optional/default（meta 字段教训 snapshot.ts:482-485）。
6. **多成员并发权限的风暴 UX**：逐条裁决不改语义，UI 分组降噪；极端时序（两成员同时写同一文件）靠任务板依赖 + 文件系统现状语义，不在 v1 解决写写冲突仲裁。
7. **单进程资源压力**：全 in-process（无 tmux/split-pane）天然覆盖 Windows（官方缺口），但 5+ 成员并发的 CPU/内存/句柄需在 M4 实测。
8. **（v3 新增）语义复用的可读性债**：subagent_reply(\_steer) 枚举名与「teammate 收 peer 消息」用途存在名称与用途的错位（值语义按渲染文本是「另一会话发来的消息」，名称是历史遗留）——spec 登记该复用决策与理由；若后续审计需要按 presentation 区分 teammate 消息，加值的偏斜面已澄清（§5.4.2 注 2），迁移成本可控。

#### 5.8.2 开放问题

1. ZCode 上游未来版本是否引入团队机制（触发「官方实现优先」替换条件）——每次上游同步对拍确认。
2. teammate 是否放开派生一次性只读 Explore 子代理：当前禁止（保一层 abort 级联与权限简单性）；放开需重设计两级级联与权限传导。
3. 跨会话/跨窗口共享同一 team：当前 team 绑定 lead session，其他窗口只能经 conversation 订阅只读；workspace 级 team 管理面（独立 topic / sessions-index 聚合）留待有真实需求再评估。
4. 成员产物文件区约定（如 `.drora/team-artifacts/{teamId}/`）与清理策略（对照官方 cleanupPeriodDays）。
5. 团队级 compact 策略（lead 上下文压缩时任务板引用如何防失真）。
6. legacy 主协议（待删旧面，drora-protocol/index.ts:22-33）不做 team 投影——v4-only，需在 spec 明示以避免双写。
7. （v3 新增）若未来确需在会话层区分 teammate 与一次性 subagent（如独立统计/独立 UI 徽标），当前「花名册+team 投影」识别是否足够——预留为观察项；届时再评估最小代价的区分面（不在 taskType 层）。

---

## 6. 关键论断复核结果

本章为材料四（论断复核）的整理。复核对 5 条关键论断做了独立实证核验，裁断为 confirmed（2 条）、unverifiable（1 条）、refuted（2 条）。需注意：第 2～4 条论断是**方案中的设计承诺（拟建架构）**，复核按「仓库现状是否存在对应实现」口径裁断——材料四原文即以「主体无对应实现」「是对不存在变更的效果声明，源码无法判定」「架构未实现」表述；方案所引用的机制锚点（path:line）大多被证实真实。

### 6.1 总览表

| #   | 论断（摘要）                                                                                     | 裁断                                        | 关键证据（材料四）                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 官方 ZCode 上游无任何 team 协议面，agents team 是纯自研增量                                      | **confirmed**                               | 3.14.3 原版 bundle / v3.15.1 对齐源码 / web snapshot 穷尽 grep，字面命中全部为订阅套餐、第三方补全/高亮数据与提示词文案                                                     |
| 2   | teammate 复用 subagent child 构造、taskType 保持 subagent_child、行为门零改动无待遇翻转          | **unverifiable**（主体无对应实现）          | 锚点属实（subagent.ts:254/:284/:286、session-store.port.ts:34-42 等）；行为门计数勘误：runtime-tools.ts 实为 6 处、全仓实数 22 处                                           |
| 3   | TeamHub/TeamPort 为花名册/任务板/邮箱唯一所有者；生命周期=终态结算+消息复活                      | **refuted**（作为现状陈述；拟建架构未实现） | TeamHub/TeamPort 全仓 0 命中；types.ts:323 AgentRuntimeDeps 无 Team 字段；唯二真实锚点 runner.ts:1497 与 runner.ts:958                                                      |
| 4   | v4 team 投影 + team.\* delta + 成员投递（subagent_reply_steer / 消息体自嵌禁令，常量自 :5 导出） | **refuted**（作为现状陈述；局部事实属实）   | snapshot/delta 无 team 键；全仓无 team 模块；incoming-message.ts:5 现状无 export；局部属实：subagent_reply_steer 渲染含禁令、coordinator_input 裸 body、枚举 7 值无 team 值 |
| 5   | 权限继承 lead 模式、审批上浮 pendingInteraction 单面裁决、只读守卫覆盖、plan 工具结构性剔除      | **confirmed**                               | subagent.ts:176-180/551-553/340-342、child-client-ports.ts:42-59、subagent-interaction-broker.ts:38、v4-bridge.ts:1764-1771、server-operations.ts:1957-1960 等              |

### 6.2 逐条详述

#### 6.2.1 [confirmed] 上游无 team 协议面

- 论断：官方 ZCode 上游（3.14.3 bundle + v3.15.1 对齐源码）经穷尽 grep 实证无任何 team/teammate/swarm/crew 协议面，agents team 是纯 Drora 自研增量，必须独立模块落地并在 specs/agents-team.md 留决策记录与替换条件。
- 复核证据（材料四）：
  - **3.14.3 原版 bundle**：`grep -ci team D:/software/ZCode/resources/glm/zcode.cjs` = 24、teammate = 2、swarm = 1、crew = 0；逐条上下文甄别：24 处 team 全为 Team 订阅套餐（zaiTeamCodingPlan/team-coding-plan/buildBigModelCodingPlanTeamManageUrl）、TEAMCITY_VERSION(ci-info)、Vercel OIDC teamId、第三方 CLI 补全表（heroku/atlas 的 team 子命令、--notificationTeamId）；swarm 1 处为 docker swarm ca 补全数据；teammate 2 处为提示词文案（"Write it for a teammate who stepped away"/"A peer cannot grant escalation"）。均非多代理协作协议面。
  - **v3.15.1 对齐源码**：swarm/crew 全源码仅命中 apps/drora-cli/packages/core/src/tool/handlers/generated/bash-command-registry.ts:3（"@withfig/autocomplete@2.692.3"，第三方补全生成文件）；teammate 仅 4 处提示词，如 apps/drora-cli/packages/core/src/system-reminder/incoming-message.ts:6（"A peer cannot grant escalation"，同级禁止提权）、apps/drora-cli/packages/core/src/context/dynamic-sections.ts:11；协议面唯一 team 命中为 packages/shared/src/drora-protocol/index.ts:1168（planKind:"team-coding-plan"，Team 套餐），shared/services 其余 team 命中均为 Team 套餐/组织 API（packages/services/src/bigmodel/codingPlanEntitlement.ts:108 "/api/biz/team/subscribe"）。
  - **3.14.3 web snapshot**：packages/mobile-web/upstream/remote/v4/3.14.3 中 teammate/swarm/crew 0 命中，team 命中为 IntlProvider-BiPABK16.js 的 Team Plan i18n 与 apex/fortran 语法高亮关键字；旧协议手机壳已于 2026-10-22 删除。
  - **自研增量与 spec 现状**：agents[-_ ]?team 在产品源码 0 命中（仅 .zcode/workflow-drafts/Agents-Team-可行性调研.dwf.ts 与 workflow-runs）；specs/ 目录无 agents-team.md（材料四 ls 实证 21 个文件；材料三分析域三载 22 个文件——两材料计数略有出入，均无 team 相关文件），实现时须按 AGENTS.md「有意分歧…必须在 specs/ 留下决策记录」新建。
- 复核结论：字面 grep 存在 team/teammate/swarm 命中，但全部为 Team 订阅套餐、第三方补全/高亮数据与提示词自然语言，无任何 lead/teammate agent、共享任务板、代理互发消息形态的协议命令或 wire 字段——多代理协作语义的协议面为零，论断实质成立。

#### 6.2.2 [unverifiable] teammate 复用 subagent_child 构造 + taskType 复用（v3 核心裁决）

- 论断：teammate 会话复用 subagent child runtime 构造（methods/subagent.ts:254-392），wire 与内部 taskType 均保持 subagent_child 不新增值：团队性由 SubagentLaunchRequest additive 字段承载、长寿命策略经 request.maxTurns 优先级先例（methods/subagent.ts:284）显式传递——因此全仓约 12-15 处 subagent_child 严格相等行为门按现状命中，零判定改动、无待遇翻转。
- 复核证据（材料四）：
  - **主体无对应实现**：TS 源码零处 teammate 会话/team_name（`git grep -c team_name -- *.ts` 无命中）；teammate 仅见 dynamic-sections.ts:11 与 incoming-message.ts:6 两处英文提示词文案；specs/ 目录无相关决策记录。SubagentLaunchRequest 无团队字段：subagent.port.ts:36-38「extends SubagentRunRequest { runInBackground?: boolean }」仅此一个扩展。
  - **已证实的锚点**：subagent.ts:254「new AgentRuntime(」至 :392 构造区间属实、:286「taskType: "subagent_child"」、:284「request.maxTurns ?? ...maxTurns ?? 4」优先级先例属实（runner.ts:78 maxTurns?: number、runner.ts:1149「maxTurns: lifecycle.profile.maxTurns」显式传递）；taskType 枚举无新值：session-store.port.ts:34-42 七值含 subagent_child。
  - **行为门行号属实但计数有偏差**：runtime-tools.ts 实为 6 处（56/67/72/214/228/269）而非方案所计五处；tool-allowlist.ts:114、subagent-session-query.ts:395、server-operations.ts:1738（另有未点名的 :1957）、v4-bridge.ts:1764-1771「Subagent sessions are read-only」只读守卫均确认；全仓非测试源码 ===/!== 行为门实数 22 处（core/bootstrap 19 + services sessionKind 3），非「约 12-15 处」。
  - **「零判定改动、无待遇翻转」是对不存在变更的效果声明，源码无法判定。**
- 说明：该论断属设计承诺，其成立性以 §5.7 M1 的「行为门零改动回归」验收为准（材料一所列）；M0 验证清单应按复核勘误的 22 处口径登记。

#### 6.2.3 [refuted] TeamHub/TeamPort 唯一所有者（作为现状陈述不成立）

- 论断：共享任务板/花名册/邮箱唯一所有者为 lead runtime 内新 TeamHub，经新 TeamPort 注入（types.ts AgentRuntimeDeps + 注册门 + executor 透传）；teammate 生命周期定死为「现有终态结算（runner.ts:1497-1574）+ 消息复活（runner.ts:958-1036）」，不新造 idle 钩子。
- 复核证据（材料四）：TeamHub/TeamPort/lead runtime 全仓 0 命中（`rg -in`，排除 node_modules）；core/src/runtime/types.ts:323 "interface AgentRuntimeDeps" 无任何 Team 字段；agent-runtime.ts:328 仅有 subagentPort 装配。唯二真实锚点：subagent/runner.ts:1497 "finalizeBackgroundCompletion"（终态结算）与 runner.ts:958 "resumeTerminalAgentInBackground"（:924 终态 SendMessage 触发复活），且无 teammate idle 钩子——但该机制服务 local_agent 后台任务，TeamHub/TeamPort 架构未实现。
- 定位说明（据材料一）：TeamHub/TeamPort 在方案中是**拟新增**模块（§5.1.2「建议命名，新模块」、§5.3.2 新增表），非仓库现状；复核确认现状不存在，并确认方案所依赖的两个机制锚点真实。

#### 6.2.4 [refuted] 协议投影与成员投递机制（作为现状陈述不成立；局部事实属实）

- 论断：协议投影走 v4 snapshot additive optional team 字段 + team.\* 键级 delta，不新增 RPC topic、host/services 零改动；成员间消息注入由 team 模块自有投递代码完成——运行中成员用现有 subagent_reply_steer 枚举值（incoming-message.ts:23-24 渲染自带零授权禁令），终态复活路径因 coordinator_input 裸 body 由消息体自嵌禁令文本（常量自 incoming-message.ts:5 导出保单一出处），RuntimeInputPresentation 枚举零加值。
- 复核证据（材料四）：
  - **主体不成立（作为现状）**：packages/shared/src/drora-protocol-v4/snapshot.ts:471-511 conversationSnapshotSchema 全字段无 team（additive 可选仅 sharedContextImport:487/subagents:497/workflowRuns:500/workspaceHookAdmission:506）；delta.ts:40-62 statePatchSchema 键集封闭无 team 键，delta.ts:6-9 明言唯一键级增量例外是 workflowRun.\* 非 team.\*；全仓无 team 模块/成员投递代码（services 中 team 仅 teamPlanApiKey.ts 订阅，无关）。incoming-message.ts:5 'const PEER_PERMISSION_GUIDANCE =' 无 export 关键字，仅本文件 24/26 行引用，「自 :5 导出」作为现状不成立。
  - **局部属实**：incoming-message.ts:23-24 subagent_reply_steer 渲染含 PEER_PERMISSION_GUIDANCE 零授权禁令；:21-22 coordinator_input 确为裸 body；runtime-input-presentation.ts:4-12 枚举 7 值无 team 值；现有投递路径在 subagent-messages.ts:84 用 subagent_reply_steer/subagent_reply。
- 定位说明（据材料一）：协议投影与成员投递同为拟建项（接缝 S7/B 档全新文件 + member-delivery.ts 新文件）；「常量自 :5 导出」在方案中是接缝 S5（给该常量加 `export` 一词）落地后的目标状态，现状确未导出——两材料对照一致，S5 落地前该表述不成立、落地后成立。

#### 6.2.5 [confirmed] 权限继承与审批上浮

- 论断：teammate 权限继承 lead 模式、审批经 deriveChildClientPorts 上浮为 pendingInteraction 单面裁决（v4-bridge 只读守卫因 taskType 复用自动覆盖 teammate，用户对成员说话必须走 lead 侧邮箱）；零授权硬边界由工具执行前门控结构保证、不依赖提示文本；plan 工具由 SUBAGENT_CHILD_FORCED_DISALLOWED_TOOLS（tool-policy.ts:7-10）结构性剔除。
- 复核证据（材料四，各机制均有确切源码）：
  - **权限继承**：subagent.ts:176-180+551-553「inheritPermissionMode(parentMode」默认继承父(lead)模式，340-342 继承父 permissionService；workflow-actor-permission.ts:6-8「子代理跑在发起会话的权限模式」。
  - **审批上浮**：child-client-ports.ts:42-59 派生、subagent-interaction-broker.ts:38「sessionId: context.parentSessionId」；subagent.ts:214-232/324-328、config.ts:230-243（createChildClientPorts 唯一出口）；tool-event-mirror.ts:115-116「V4 只从父 task…投影生成」=单面；product-projection.ts:3306-3333「pendingInteractions」。
  - **只读守卫**：v4-bridge.ts:1764-1771「Subagent sessions are read-only」+ server-operations.ts:1957-1960；subagent.ts:286「taskType: "subagent_child"」，SESSION_TASK_TYPES（session-store.port.ts:34-42）无 teammate 独立类型即（材料四原文在此截断）。

---

## 7. 终审与评审处理情况

### 7.1 修订史（v1→v2→v3）

方案经三轮修订（材料一修订说明）：

- **v2 摘要（保留供追溯）**：撤销 presentation 加值接缝并修正其偏斜面事实错误；接缝总账补 types.ts/executor 透传/session-mapper 三处漏报；生命周期定死「终态+复活」并删 reportIdle；删计划审批例外（tool-policy.ts:7-10 结构性剔除）；teamStore 归属 packages/ui/src/store/。
- **v3**：逐条回应终审两条问题（见 §7.3），并重新总账接缝（A 档 6 处 / B 档全新文件）。

### 7.2 终审提出且未复审的中高问题（材料五，如实列入）

> 材料五明确：以下两条为**终审未复审**的问题（v3 修订回应后，终审未再复审确认）。

**问题一（severity: high）**：「CLI 内部 taskType=team_member + 行为门默认零改动即同待遇」的裁决在机制上不成立：所有门是 `=== "subagent_child"` 严格相等，team_member 不命中即走非子代理分支（待遇翻转），M1 照单落地会产生成批行为偏斜与返工；两个可行方向（逐点改判定≈10+ 处新接缝，或保持 taskType=subagent_child + S1 字段 + request.maxTurns 显式传递——方案自引的 methods/subagent.ts:284 先例恰好支持后者）方案均未裁决，且 §4.2 A 档 7 处接缝总账因此低估。

- 位置（材料五）：方案 v2 §3.4/§4.2.1/§7-M1；仓库证据：apps/drora-cli/packages/core/src/runtime/helpers/runtime-tools.ts:56,67,72,214-216,228（runtimeScope/includeAutomation/includeOffPeak/subagentBackgroundBashMaxMs 均严格判 subagent_child，team_member 时 runtimeScope="main"、automation/offPeak 照注册、后台 bash 上限失效）、runtime/helpers/tool-allowlist.ts:114、bootstrap/src/drora-protocol/subagent-session-query.ts:395 与 server-operations.ts:1738（子会话查询 `!== "subagent_child"` 即跳过，teammate 会话从下钻/查询链路漏出）、终审 grep 实测 8 文件清单与方案一致。

**问题二（severity: medium）**：「teammate 互发消息复用 subagent_reply(\_steer)，PEER_PERMISSION_GUIDANCE 自动附加于每条注入消息、零语义表改动」方向搞反：subagent_reply(\_steer) 是父(lead)会话接收子回复时的 presentation（成员→lead 方向成立）；注入成员的现有链路不带该禁令，且 guidance 常量未导出，复用需新接缝或文本复制，§6.3 的承载机制需重新设计（权限层硬边界不受影响）。

- 位置（材料五）：方案 v2 §3.1 复用清单「peer 消息 presentation」行与 §6.3 第 3 条；仓库证据：core/src/runtime/methods/subagent-messages.ts:84（subagent_reply 仅在 persistSubagentMessageCommand 即父会话接收方产生）、core/src/subagent/message-steering.ts:32,44（注入运行中子代理硬编码 coordinator_steer，guidance 无禁令文本）、core/src/runtime/methods/subagent.ts:458-459 + core/src/system-reminder/incoming-message.ts:21-22（复活路径 coordinator_input 为裸 body）、incoming-message.ts:5（PEER_PERMISSION_GUIDANCE 为模块私有 const，未导出）。

### 7.3 v3 对终审问题的回应（材料一修订说明）

**①（high）taskType 裁决机制性修正——放弃内部新增 `team_member`，全线保持 `subagent_child`**。终审实证成立：全仓行为门均为 `=== "subagent_child"` 严格相等（方案作者实读复核：runtime-tools.ts:55-56（includeRespondToCoordinator）、:67（includeAutomation 排除）、:72（includeOffPeak 排除）、:213-216（subagentBackgroundBashMaxMs）、:228（runtimeScope）五处；tool-allowlist.ts:114（RespondToCoordinator 补回）；subagent-session-query.ts:395 与 server-operations.ts:1738 均 `!== "subagent_child"` 即跳过——teammate 若用新 taskType 会从下钻/查询链路漏出；v4-bridge.ts:1764-1771 只读守卫同样不命中）。新 taskType 意味着「非子代理分支」待遇翻转（runtimeScope="main"、automation/offPeak 照注册、后台 bash 上限失效、下钻漏出），逐点改判定≈10+ 处新接缝。两个可行方向中裁决采纳**方向 B：taskType 保持 subagent_child + S1 additive 字段承载团队性 + maxTurns 显式传递**——methods/subagent.ts:284 `maxTurns: request.maxTurns ?? this.config.subagents?.maxTurns ?? 4` 即显式传递先例。连带效应：原接缝 S5（session-mapper 映射分支）与 S6（SESSION_TASK_TYPES 加值）撤销（taskType 无新值则 :310 的 as 强转自然产出 subagent_child，无需分支），v4-bridge 只读守卫等全部「例外裁决」消失（自动覆盖），行为门清单从「裁决清单」降级为「零改动验证清单」。新增内部 taskType 的方向 A 记为**已评估并否决**的备选，否决理由入 spec。

**②（medium）成员间消息禁令承载机制重设计——v2 的「复用 subagent_reply(\_steer) 自动附加」方向不成立**。终审实证成立（方案作者实读复核）：subagent_reply(\_steer) 仅产生于父会话接收侧 persistSubagentMessageCommand（subagent-messages.ts:84：`midTurn ? "subagent_reply_steer" : "subagent_reply"`）；注入运行中子代理的现有链路硬编码 coordinator_steer（message-steering.ts:32,44），该渲染无禁令文本（incoming-message.ts:19-20）；复活路径硬编码 coordinator_input 即裸 body（methods/subagent.ts:458-459 + incoming-message.ts:21-22）；且 PEER_PERMISSION_GUIDANCE 为模块私有常量未导出（incoming-message.ts:5）。v3 重设计：成员侧投递由 **team 模块自有投递代码（新文件）**完成，不复用 message-steering.ts——运行中成员注入选用现有枚举值 `subagent_reply_steer`（incoming-message.ts:23-24 渲染 = "Another Drora session sent a message…" + PEER_PERMISSION_GUIDANCE + 回复指引，方向语义吻合、禁令自动附加）；终态复活路径因 presentation 硬编码裸 body，由消息体自嵌禁令与团队头，常量自 incoming-message.ts:5 **导出**（一词接缝 S5）保单一出处。RuntimeInputPresentation 枚举仍零加值。

### 7.4 回应后的独立复核与勘误

- 材料四对 v3 相关论断的独立复核裁断：confirmed 2 条（上游无协议面、权限继承与审批上浮）、unverifiable 1 条（taskType 复用方案——主体无实现）、refuted 2 条（TeamHub/TeamPort、协议投影与成员投递——作为现状陈述不成立，机制锚点局部属实），详见 §6。
- 复核勘误（已同步标注于 §5.4.3）：
  1. 行为门计数：runtime-tools.ts 实为 **6 处**（56/67/72/214/228/269）而非方案 v3 所计「五处」；server-operations.ts 另有未点名的 **:1957**；全仓非测试源码 ===/!== 行为门实数 **22 处**（core/bootstrap 19 + services sessionKind 3），非「约 12-15 处」。计数修正不改变 v3 裁决的结构（taskType 复用 ⇒ 全部门按现状命中），但 M0 验证清单应按 22 处口径登记。
  2. 「常量自 incoming-message.ts:5 导出」作为现状不成立（该常量现为模块私有 const，仅本文件 24/26 行引用）——方案中它是接缝 S5（加 `export` 一词）落地后的目标状态，落地前该表述应理解为「拟导出」。
  3. specs/ 目录文件计数：材料三载 22 个文件、材料四 ls 实证 21 个文件，两材料略有出入，均无 team 相关文件。

### 7.5 状态声明（证据与验证的如实交代）

- **终审未复审**：按材料五，终审两条中高问题在 v3 修订回应后未经终审复审确认；本章 §7.3 所述回应来自材料一 v3 修订说明（方案作者自述并附实读证据），不构成终审认可。
- **材料四复核非复审**：论断复核是对论断的实证核验（按仓库现状口径），不是对「v3 回应是否解决终审问题」的复审；其中 unverifiable/refuted 裁断均因「尚无实现」，设计承诺的成立性留待 M1 验收（§5.7）。
- **本调研为纯设计**：未做任何代码改动，未运行 typecheck/lint（无改动可验）。材料一所载证据基础：三轮共实读核实 21 个文件（subagent.port.ts、runtime-tools.ts 全文、runtime-task/registry.ts、message-steering.ts、snapshot.ts、methods/subagent.ts:240-470、transport.ts:320-444、architecture-policy.yaml:70-169、session-store.port.ts、session.events.ts:165-194、tools/agent.ts 全文、runtime-input-presentation.ts 全文、incoming-message.ts:1-60、tool-policy.ts 全文、types.ts:345-384、session-mapper.ts:295-324、v4-bridge.ts:1755-1774、runner.ts:955-1039 与 1497-1574、tool-allowlist.ts:105-125、subagent-session-query.ts:388-400、server-operations.ts:1730-1745、subagent-messages.ts:65-99）与 4 次 grep/RuntimeInputPresentation 全仓引用清点/taskType 行为门清单/maxTurns 链路定位。
- **非本人执行的检查**：仓内分析的 `pnpm architecture:check --changed`（输出 `architecture: OK / violations: 0 / baseline: 0 / new: 0`）与 freshness 检查系材料（ask 材料）所载、非报告撰写会话执行；撰写会话仅复跑 freshness 检查（输出一致）。外部机制描述引自外部调研材料（材料二）。
- 后续验证义务在 M0-M4 各里程碑（spec 评审、单测/e2e/回归、typecheck/lint/架构检查、双链路 E2E），见 §5.7。

---

## 8. 参考来源

### 8.1 外部来源（材料二，按调研对象分组）

**Claude Code Agent Teams 与 Agent SDK subagents**：

- https://code.claude.com/docs/en/agent-teams（完整抓取，.md 原文）
- https://code.claude.com/docs/en/sub-agents（完整抓取，.md 原文）
- https://code.claude.com/docs/en/tools-reference（完整抓取，.md 原文）
- https://code.claude.com/docs/en/agent-sdk/subagents（完整抓取）
- https://code.claude.com/docs/en/agents（仅搜索摘要确认：多代理方式对比页）

**OpenAI 系（Agents SDK / Swarm / AgentKit / OpenHands / Cognition）**：

- https://openai.github.io/openai-agents-python/multi_agent/
- https://openai.github.io/openai-agents-python/handoffs/
- https://developers.openai.com/api/docs/guides/agents/orchestration
- https://developers.openai.com/api/docs/guides/agent-builder
- https://openai.com/index/introducing-agentkit（直接访问 403，内容经 WebSearch 结果摘要交叉确认）
- https://github.com/openai/swarm
- https://docs.openhands.dev/sdk/guides/task-tool-set
- https://arxiv.org/html/2511.03690v2（OpenHands SDK 论文，经 WebSearch 摘要，未直接读取全文）
- https://github.com/OpenHands/OpenHands/issues/13030（经 WebSearch 摘要，未直接读取）
- https://cognition.com/blog/dont-build-multi-agents

**LangGraph / CrewAI / AutoGen(AG2)**：

- https://docs.langchain.com/oss/python/langchain/multi-agent
- https://reference.langchain.com/python/langgraph-supervisor
- https://reference.langchain.com/python/langgraph-supervisor/supervisor/create_supervisor
- https://reference.langchain.com/python/langgraph-swarm
- https://reference.langchain.com/python/langgraph-swarm/swarm/create_swarm
- https://docs.langchain.com/oss/python/langgraph/persistence
- https://docs.langchain.com/oss/python/langgraph/interrupts
- https://docs.crewai.com/edge/en/learn/hierarchical-process
- https://docs.crewai.com/edge/en/concepts/agents
- https://docs.crewai.com/edge/en/concepts/flows
- https://microsoft.github.io/autogen/0.2/docs/notebooks/agentchat_groupchat_customized
- https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/user_proxy_agent
- https://microsoft.github.io/autogen/0.2/docs/notebooks/agentchat_nestedchat
- http://classic.docs.ag2.ai/latest/docs/user-guide/advanced-concepts/groupchat/custom-group-chat

**跨框架编排与协调原语（Anthropic / MetaGPT / A2A+MCP / blackboard）**：

- https://www.anthropic.com/engineering/multi-agent-research-system（已全文抓取）
- https://arxiv.org/html/2308.00352v7（MetaGPT ICLR 2024 论文，已抓取）
- https://a2a-protocol.org/latest/specification/（A2A 1.0.0 官方规范，已全文抓取，含附录 B MCP 关系）
- https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/（已抓取）
- https://github.com/a2aproject/a2a（仅搜索结果，GitHub 页面抓取失败）
- https://www.themoonlight.io/en/review/exploring-advanced-llm-multi-agent-systems-based-on-blackboard-architecture（仅搜索摘要）
- https://www.ibm.com/think/topics/agent2agent-protocol（仅搜索摘要）
- Hearsay-II blackboard 历史模型：训练知识（可能有时滞）

### 8.2 仓内来源与命令证据

**仓库文档与治理文件**（材料一/三所载行号）：

- AGENTS.md（工作区指令：上游对齐与模块化扩展 :51-60、契约键单一出处 :56、协议登记点 :72、Main/relay 状态边界 :73/:77、owner/lease :79、Workspace Identity :83-86、日志等节）
- specs/upstream-v3.15.1-migration.md（固定基线节、状态所有者表 :53-63、验证要求 :115）
- specs/drora-rename.md（替换规则表 :8-18、:20-28、豁免区 :116-131）
- specs/desktop-pet.md（DI 组装先例的决策记录）
- .agents/skills/architecture-governance/SKILL.md（:14、:45 五件套）
- architecture-policy.yaml（:70-169：drora-extensions 四模块 :79-130、gen-ui 三模块 :130-165、drora-cli managed:false :73-75）
- .oxlintrc.json（:72-96 ignorePatterns；:79 apps/drora-cli 整体）

**仓内代码证据**：正文各 `path:line`（材料一/三/四所载），集中在 apps/drora-cli/packages/{core,contracts,bootstrap}、packages/{shared,services,desktop,ui,client}。

**上游对拍命令证据（材料四）**：

- `grep -ci team/teammate/swarm/crew D:/software/ZCode/resources/glm/zcode.cjs` → 24/2/1/0（逐条上下文甄别见 §6.2.1）
- `git grep -c team_name -- *.ts` → 无命中
- `rg -in "TeamHub|TeamPort"`（排除 node_modules）→ 0 命中
- `ls specs/` → 无 agents-team.md（材料四计 21 文件；材料三计 22 文件）

**仓内分析命令证据（材料三）**：

- `node scripts/check-workspace-freshness.mjs` → `[freshness] 基线新鲜：main（与 origin/main 同步），相对 origin/main：ahead 431 / behind 0（阈值 50）`（本报告撰写会话于 2026-10-16 复跑，输出一致）
- `pnpm architecture:check --changed` → `architecture: OK / violations: 0 / baseline: 0 / new: 0`（分析会话执行，非本撰写会话）
- 上游 grep (a)-(e) 见 §3.1.7

---

_本报告为材料一～五的忠实整理，未新增材料之外的论断；编者注仅做材料间交叉引用与复核勘误的标注。_
