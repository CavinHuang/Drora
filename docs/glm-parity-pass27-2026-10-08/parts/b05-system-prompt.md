# b05 系统提示词（ContextBuilder 全段）对拍报告

- 日期：2026-10-08
- 真值：D:\software\zcode\resources\glm\zcode.cjs（0.16.9，14,820,819 字节，单行 CJS bundle）
- 我方：D:\workspace\projects\Drora（feat/migrate-remote-and-pet，freshness 基线通过）
- 域：系统提示词构造（ContextBuilder / SubagentContextBuilder 全部段落、组装顺序、注入分支、变体）
- 方法：grep -ob 定位 + node 按字节偏移截窗（≤4000B/次）+ 特征串 grep -c 双向验证。禁止整文件读取，全文未抄录。

结论速览：真值 0.16.9 的 ContextBuilder 与我方实现为同构迁移，段落集合、顺序、注入目标（system/meta_user）、cacheHint 分桶、三条身份路径（默认/自定义/工作流子代理）、meta_user 包裹文案、token 估算器全部一致。差异仅 1 处内容缺口（Memory 段尾部一句）、若干有意改名（ZCode→Drora、CLAUDE.md→AGENTS.md、zcode_desktop→drora_desktop）与死常量。

---

## §1 真值段落地图（偏移 + 特征词）

主模块：ContextBuilder `INe`（≈offset 4889600），`build()` ≈4890500–4891500，`createContextBuilder`(Ehn) ≈4890473，注册模块 `Odt` ≈4893300。历史基线所称「983 行 14 段（tone/code conventions 等）」结构在本 bundle 中**不存在**（grep `# Tone`/`# Code Conventions`/`# Task Management`/`# Doing tasks` 均为 0 命中），0.16.9 实际结构如下。

主链路段（按 build() 压入顺序；偏移为 builder 函数/特征串首字节）：

| # | 段名 / source | 偏移 | 注入 | cache | 条件 | 特征词 |
|---|---|---|---|---|---|---|
| 1 | CLI Prefix / cli_prefix | 4827570 | system | stable | 非 workflowActor | "You are ZCode, an interactive coding agent" |
| 2a | Agent Identity / identity | 4828484 | system | stable | 默认路径 | "interactive ZCode agent"、安全 IMPORTANT 行、"# Harness"（5 条） |
| 2b | Custom System Prompt / custom_system_prompt | 4831947 附近 | system | stable | 有自定义 prompt 时替换 2a | 内容前缀 `\n` |
| 2c | Workflow Actor Identity / workflow_actor_identity | 4830407/4831735 | system | stable | workflowActor 路径 | "# Working inside a workflow"、submit_result/escalate、"no tool that asks a person anything" |
| 3 | ZCode Desktop Context / desktop_context | 4881573 | system | stable | !workflowActor 且 surface=zcode_desktop | "### Files & URLs"、::code-comment{ |
| 4 | Dynamic Behavior / dynamic_behavior | 4884960 附近 | system | dynamic | !workflowActor | "# Communicating with the user"、"You are operating autonomously"、"hard to reverse or outward-facing" |
| 5 | Session-specific guidance / session_guidance | 4884887 附近 | system | dynamic | 空则不建 | "/<skill-name>"、user-invocable skills section |
| 6 | Memory / memory | 4879139 | system | dynamic | 有 memoryRoot | "# Memory"、persistent file-based memory、MEMORY.md pointer 段 |
| 7 | Environment Info / env_info | 4832281 | system | dynamic | 恒有 | "# Environment"、Primary working directory/Is a git repository/Platform/Shell/OS Version、可选 "You are powered by the model named provider/model." |
| 8 | Output Style / output_style | 4885050 附近 | system | dynamic | 有 outputStyle | "# Output Style: <name>" |
| 9 | Context Management / context_management | 4885083 附近 | system | dynamic | 恒有 | "# Context management"、re-litigate、wrap up early |
| 10 | System Context / system_context | 4832667 附近 | system | dynamic | isGitRepository | "gitStatus: This is the git status..."、Current branch/Main branch/Git user/Status/Recent commits |
| 11 | Skills / skills | 4833560 附近 | meta_user | dynamic | 有 skills 且 Skill 工具可用 | "The following skills are available for use with the Skill tool:"、预算 2e4、描述截 250 |
| 12 | Request User Context / request_user_context | 4875xxx | meta_user | dynamic | 有指令或 memory index | "# agentsMd"、"OVERRIDE any default behavior"、MEMORY.md 索引（200 行/25000 字符 + WARNING） |
| 13 | Current Date / current_date | 4878916 | meta_user | dynamic | 有日期 | "# currentDate\nToday's date is ..." |
| 14 | customSections（addSection） | 4890538 | 可选 | 可选 | 调用方 | — |

组装逻辑（与段落同权重对照）：
- `orderSectionsForInjection`(QKs)：system-stable → system-dynamic → meta_user-stable → meta_user-dynamic。
- `assembleSystemMessages`：3 条 system message——cli_prefix 单独一条、其余 stable 一条、dynamic 一条且内容前缀 `\n\n`；全部带 `{type:"ephemeral"}` cacheControl。
- `assembleMetaUserAttachments`：skills_listing（裸内容）+ context_prefix（"As you answer the user's questions, you can use the following context:" + 6 空格缩进 "IMPORTANT: this context may or may not be relevant..." 包裹）。
- token 估算 `wm`：中文字符×2、除数 Fee=3（offset 4809203 / 700917）。
- Memory 检索分支 `resolveProjectMemoryRetrievalBranch`(ZKs @4881434)：`ZKs(!1)` 硬编码 → 恒 "default-index"；"semantic-recall" 运行时代码存在（12965475 附近 prefetch）但开关恒 false，属死分支。Memory 段的 MEMORY.md pointer 段仅在 default-index 分支输出。
- Memory 段尾部（"Before saving..." 段）另含一句 `<system-reminder>` 召回记忆校验提醒（"verify it still exists before recommending it"）。

子代理构建器：SubagentContextBuilder `mwn`（≈12535900，extends INe）：段序 = CLI Prefix（恒有）→ Subagent Agent Prompt（空则跳过，内容前缀 `\n`）→ Subagent Notes（前缀 `\n\n`，pSo @12534439 "Notes:" 5 条）→ Subagent Environment（前缀 `\n\n`，fSo："Here is useful information about the environment you are running in:" + `<env>` 块 + 可选 model 行）→ Request User Context（仅 userInstructions，无 memoryRoot）→ Current Date → Skills（无 skillToolAvailable 门）。排序仅按 system→meta_user 两桶；system 各段各自一条 message。

---

## §2 我方段落地图

入口：`apps/drora-cli/packages/core/src/context/builder.ts`（ContextBuilder，373 行）+ `sections/`（cli-prefix / identity / env-info / desktop / current-date / memory / request-user-context / skills / workflow-actor）+ `dynamic-sections.ts`；子代理 `src/subagent/context-builder.ts` + `subagent/system-prompt.ts`；memory 索引格式化 `src/memory/index-content.ts`；运行时接线 `src/runtime/methods/context.ts`（createContextBuilderFromSnapshot：presentationSurface/model/customSystemPrompt/workflowActor/guidanceToolNames 全部透传）。

我方段落集合与真值一一对应：CLI Prefix("You are Drora...") → Agent Identity/Custom/WorkflowActor 三选一 → Drora Desktop Context(surface=drora_desktop) → Dynamic Behavior → Session-specific guidance → Memory → Environment Info → Output Style → Context Management → System Context → Skills(meta_user) → Request User Context(meta_user) → Current Date(meta_user) → customSections。组装：orderSectionsForInjection 四桶、assembleSystemMessages 三条（dynamic 前缀 `\n\n`）、metaUserAttachments skills_listing/context_prefix——与真值逐条同构。子代理构建器同构（含空 prompt 跳过、`\n`/`\n\n` 左边界、每段独立 system message）。token 估算 estimateTokens 与真值 wm 同式（中文×2 / 除数 3）。

---

## §3 逐段对照差（三分类 + 级别）

双向特征串验证：真值 21+14+14+20 条特征串全部命中；反向仅下述差异。

| 编号 | 分类 | 级别 | 段 | 差异 | 证据 |
|---|---|---|---|---|---|
| D1 | REAL-GAP | P3 | Memory | 我方缺尾部一句：召回记忆在 system-reminder 中属背景、命名文件/函数/flag 需先验证存在（"verify it still exists before recommending it"）。真值 "Before saving" 段比我方长一句 | grep 命中真值 1 次；我方 memory.ts 无此句 |
| D2 | SHAPE-DIFF | P3 | Memory | 真值 builder 带 retrieval-branch 参数（default-index/semantic-recall），硬编码 default-index；我方无参数、恒输出 default-index 内容。当前行为等价 | 真值 `ZKs(!1)`；我方 buildMemorySection 单参 |
| D3 | SHAPE-DIFF | P3 | Memory | 有意改名：真值 "CLAUDE.md" → 我方 "AGENTS.md"（"Don't save what the repo already records (...)" 句内） | 双方各 1 处 |
| D4 | SHAPE-DIFF | P3 | 全部 | 有意改名：ZCode→Drora（CLI prefix、identity 开场句、desktop 段标题、general-purpose/Explore prompt、presentationSurface 值 zcode_desktop→drora_desktop） | 逐段比对 |
| D5 | EXTRA | P3 | env-info | 我方死常量 GIT_LABEL="Git"、NOT_A_GIT_REPOSITORY="not a git repository"，真值无；两常量定义后未被引用 | grep 仅命中定义行 |
| D6 | EXTRA | P3(注) | session_guidance | 我方 buildSessionGuidanceSection 内有注释掉的 Agent/AskUserQuestion 指导块（真值 Fno 亦无此二者）；纯注释，无行为差 | dynamic-sections.ts 注释块 |
| D7 | SHAPE-DIFF | P3 | subagent env | 我方 buildSubagentEnvironmentContext 多收 agentPrompt 参数但不使用；真值 fSo 同样收而不解构。等价 | 双方签名对照 |

文案微差清单（≤20 字摘，除上述外逐段无）：无。Dynamic Behavior/Context Management/Identity/Harness/Desktop/Skills/Request User Context/Current Date/System Context/Subagent Notes 及 meta_user 包裹文案均逐字一致（转义形态 \u2014 vs 字面 — 不影响运行时字符串）。

统计：REAL-GAP 1（P3×1，P1×0，P2×0）；EXTRA 2（P3×2）；SHAPE-DIFF 4（P3×4，其中 D3/D4 为有意改名）。

---

## §4 变体分支（provider/model）对照

- 真值：ContextBuilder 内容**不按 provider/model 分变体**。build() 的分支仅 surface/customSystemPrompt/workflowActor/skills/guidanceToolNames/memoryRoot/outputStyle；model 唯一进入提示词的形态是 env_info（主链路）与 Subagent Environment 的 "- You are powered by the model named providerId/modelId." 行。bundle 内 GLM 模型名清单（offset 507350）为模型 ID 归一化/选择用，非提示词分支；providerId===/providerKind 命中均为模型规则注册表与错误分类，不改提示词。真值自身的 GLM 子代理走 workflowActor/subagent 通用路径。
- 我方：同样无 provider/model 提示词分支；model 经 createContextBuilderFromSnapshot 的 options.model 注入 env_info 行与子代理 env 行。已覆盖等价。

## §5 OPEN-QUESTION

1. D1（Memory 尾句缺失）为有意删减还是漏迁？该句依赖 `<system-reminder>` 召回语义；若我方召回链路（memory recall）尚未启用则暂无行为影响，建议迁移以对齐。
2. 真值历史基线（983 行/14 段 tone 类结构）在 0.16.9 已不存在；若 parity 总报告其他分域引用了旧基线段落清单，应以本报告 §1 为准。
3. 真值 "semantic-recall" 死分支对应的运行时 prefetch（12965475）未逐行核对；开关恒 false，若未来真值打开该开关，Memory 段与召回注入需另行对拍。
