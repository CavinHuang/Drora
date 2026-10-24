# Batch 10 — 命令 / 工具 / 权限三域官方(3.14.3) vs 本仓 逐条差分判定

- 日期：2026-10-19
- 官方 bundle：`D:/software/zcode/resources/glm/zcode.cjs`（3.14.3，15,127,039 B）
- 本仓对齐基线：3.15.1（`specs/upstream-v3.15.1-migration.md`，固定基线 `aac4755…`）；凡 spec 记录为"已对齐/有意分歧"的以 spec 为准定性
- 输入：batch2（命令双侧）、batch3（工具双侧）、batch4-target-config、batch4-parity-keys
- 性质：只读差分判定；除本报告外无任何文件改动
- 判定四类：【gap】需对齐修复；【版本差】3.15 特性 vs 3.14.3，不算问题；【有意分歧】rename/品牌/自研扩展（引 spec）；【误报】前批报告写错，验证后推翻

---

## 0. 复核方法（本批新增双侧证据）

官方侧本批直接复核的 bundle 切片（可 `tail -c +OFFSET` 复现）：

| 偏移 | 内容 | 结论 |
| --- | --- | --- |
| @7718556 | Skill 工具 metadata | `readOnly:!0, destructive:!1, concurrentSafe:!0, sideEffectScope:"session", riskLevel:"low", needsApproval:!1, permission:"skill"` |
| @7722833 | TodoWrite 工具 metadata | `readOnly:!0, destructive:!1, concurrentSafe:!1`（batch3-target 表格该行误读为 0） |
| @15006373 | `Zdi`=expandCliCustomCommandPrompt | 含 `!` 语法即抛 `"uses unsupported shell expansion. Dynamic expansion is not available yet."` |
| @15008264 | `tpi`=buildCustomCommandPrompt | 仅 catch `/not found/i`；shell 展开错误 re-throw，TUI 无服务端 fallback |
| @13113600 | `$4a` 子代理权限模式归一 | `bypassPermissions/dontAsk→yolo; acceptEdits→edit; auto→auto; plan→plan; default→inherit` |
| @14721600 | `cmc` cron automation 模式归一 | `dontAsk/bypassPermissions→yolo; default/auto/acceptEdits/autoEdit→build` |
| @7433877 附近 | `qpr` 权限选项 wire schema | `kind: enum(["allowOnce","allowAlways","deny","custom"])` |
| @7718556 前 `rot` | SendMessage input schema | `to(1..200), summary(1..200), message(min1)` strict |

本仓侧逐点核对的文件见各表"本仓证据"列（均为绝对路径下的 `apps/drora-cli/packages/...`）。

---

## 1. 命令域差分表

| # | 差异点 | 官方证据（bundle） | 本仓证据（源码） | 判定 | 修复建议 |
|---|--------|-------------------|-----------------|------|---------|
| C1 | 内置命令数 20 vs 21（`/team`） | TF 帮助表 @915220 起 20 条，无 team | `packages/shared/src/drora-slash-command-help.ts:9` 21 条（第 21 条 team，usage `/team [goal]`） | 【有意分歧】自研扩展；`specs/agents-team.md:78`（照 `/workflow` 先例：代码定义 prompt 型内置命令、进帮助表保留字） | 无 |
| C2 | **TUI/headless `/team` 解析缺口** | 官方无此命令（不适用） | `packages/cli/src/command-center/slash-commands.ts:40-250` parseSlashCommand 无 team 分支（全文件 grep "team" 0 命中）→ type unknown → `create.ts:65-77` 走文件适配器 → 报 `Unknown command: /team`；headless `prompt-command.ts:297` 对保留名（team 在帮助表=保留字，`slash-command-surface.ts:28-33`）返回"不可解析"→ 同样落入 command-center 报 Unknown | **【gap】**（自研命令在 TUI 与 headless 两个面均未接通；batch2-ours §5"/team 实际生效面含 headless --prompt"为**误报**——保留名使它永远到不了 facade 的 builtin resolver；唯一生效面是 App facade） | 最小接缝修复：① `slash-commands.ts` parseSlashCommand 增加 `team` known 分支；② `create.ts` 照 init/workflow 模式（:208-234）把原文回交 `app.submitPrompt` 由 facade builtin resolver 展开；③ `prompt-command.ts` routesToPromptCommandCenter 对 known team 返回 false（走普通 prompt→facade 展开）。涉及文件：`cli/src/command-center/slash-commands.ts`、`cli/src/command-center/create.ts`、`cli/src/prompt-command.ts` |
| C3 | 文件命令发现根 `.zcode/commands+.agents/commands` vs `.drora/commands+.agents/commands` | 常量 `bKs=".zcode"`、`SKs=".agents"`（createNodeCustomCommandAdapter @4223958 附近） | `adapters/src/commands/roots.ts:100-105`：同级双根合并（.drora 先扫），extra→user→project 顺序 | 【有意分歧】改名规则 3（`specs/drora-rename.md`：`.zcode`→`.drora`）；`.zcode` **不属于**豁免区——豁免仅 `.zcode-plugin/`、`.zcode-plugin-seed.json` 与 CUA 目录（豁免区 1/2），`.zcode/commands` 是用户数据目录族，正确改名 | 无 |
| C4 | CLI 侧 `!`cmd`` shell 展开 | TUI 本地展开器 `Zdi` @15006373 同样抛 "uses unsupported shell expansion..."；服务端 `eoi`→`Zri` 有 executionPort（30s=3e4 超时、128KB 输出上限、CLAUDE_*/ZCODE_* 双写 env） | TUI 本地 `cli/src/custom-command-expand.ts:28` 同文案抛错；服务端 `bootstrap/src/custom-command-shell-expansion.ts`（30s/128KB，:166-213 注入 CLAUDE_*+DRORA_* 双写）；headless 可解析命令落 facade 展开（`prompt-command.ts:290-302` 注释与分流逻辑） | 【误报】疑点不成立：双侧 TUI 本地均不支持且报错文案逐字一致；双侧服务端/facade 均支持（超时/上限/env 键族对位，ZCODE_→DRORA_ 为规则 2 改名） | 无 |
| C5 | frontmatter 键白名单 | `AKs` 6 键：allowed-tools/argument-hint/description/disable-noninteractive/model/skills（未知键 warning `custom_command_unknown_frontmatter`） | `adapters/src/commands/index.ts:26-33` 同 6 键同语义（:194-203 未知键同名 warning） | 【误报】疑点不成立，逐键一致 | 无 |
| C6 | 命令遮蔽方向 | extraRoots→user→project→extraResolvedRoots，priority 升序先到先赢，重名 `custom_command_duplicate_name` 丢弃 | `roots.ts:34-55`（extra→user→project）+ plugin roots 最后（`adapters/src/plugins/index.ts`）+ 同名先赢同诊断码（`commands/index.ts:61-83`） | 【误报】方向与官方一致；batch2-ours §7.3"与官方 priority 语义待对"的担忧解除 | 无 |
| C7 | 保留名集合 | `rlc` = 20 内置名+全部别名+`compress`+`plan` | `slash-command-surface.ts:26-33` = 帮助表全部 name+aliases+`compress`/`plan`（多出 team=自研增量） | 对齐（+自研增量，归入 C1） | 无 |
| C8 | `/login` usage 四变体 | TF row2：`/login [zai-coding-plan\|bigmodel-coding-plan\|*-api-key <api-key>]` | `drora-slash-command-help.ts` 同四变体同文案 | 【误报】batch2-ours §7.5 担忧解除（TF usage 为权威面，逐字一致） | 无 |
| C9 | `/rewind` 隐藏子命令 | 服务端 `CDo`=parseRewindCommand 支持 `status/latest/checkpointId/cascade <conversation\|message\|code\|workspace> <messageId>`（TF usage 只写 `[latest\|checkpointId]`） | `core/src/runtime/helpers/commands.ts:34-48` 同样支持 status/cascade-message 全套 | 对齐（隐藏面也在） | 无 |
| C10 | `/workflow` 条件命令 | `R4n` 按 workflowMode 过滤；禁用提示 `Bke`（--workflow-mode 文案） | `cli/src/command-center/slash-commands.ts:26-32` visibleHelpEntries 同过滤；headless 禁门 `prompt-command.ts:108-116` 同句报错 | 对齐 | 无 |
| C11 | `/plan` App-only 建议 | `Qri`（source:"builtin"，不在 TF，仅 listAppSuggestions） | `slash-command-surface.ts:17-24` APP_PROTOCOL_APP_ONLY_BUILTIN plan（仅 App Composer） | 对齐 | 无 |
| C12 | 插件命令不加前缀 / manifest 对象物化 generated-commands / disable-noninteractive / `commands list\|inspect` 输出格式 | batch2-target §3.3、§4 | batch2-ours §2、§4 同构（`adapters/src/plugins/index.ts:644-700`、`cli/src/commands-command.ts:30-49`） | 对齐 | 无 |

命令域小结：gap **1**（C2）；有意分歧 2（C1/C3）；误报 4（C4/C5/C6/C8，另 batch2-ours §5 headless 生效说亦误报）；其余对齐。

---

## 2. 工具域差分表

| # | 差异点 | 官方证据（bundle） | 本仓证据（源码） | 判定 | 修复建议 |
|---|--------|-------------------|-----------------|------|---------|
| T1 | 官方 42 条目 vs 本仓 43+ | 注册表 `dCn` @12702767 共 42 项/41 名 | `core/src/tool/handlers/index.ts:79-148` builtInTools 含官方 42 项的逐一对位（Read…js）+ `vaultSearchToolEntry`（:99） | 官方侧 42/42 全对位无缺；VaultSearch 为【有意分歧】自研（`specs/obsidian-knowledge.md` §5f；迁移 spec"知识库/VaultView 保留独立扩展"行，端口注入门式） | 无 |
| T2 | Cron 四件套是否齐全 | @7726384/7730408/7731299/7733813：CronCreate/List/Update/Delete（includeAutomation 默认关） | `core/src/tool/handlers/cron.ts` 四个 entry（create/update needsApproval=true、list `automation.read`、delete destructive）+ `handlers/index.ts:91-94,261-264` 同门注册 | 【误报】疑点不成立：四件套**齐全**；"系统工具面板只见 CronCreate/CronList"是 UI 呈现面观察，非注册表缺口 | 如需 UI 面板收敛另立任务，不属 parity 缺口 |
| T3 | SendMessage/RespondToCoordinator/submit_result/escalate 官方对应 | 四工具均在注册表（@7760178/7762373/7764160/7768638），includeXxx 默认关；SendMessage schema `rot`=`{to,summary,message}` strict | `handlers/index.ts:103-110` 四工具同门（includeSendMessage/includeRespondToCoordinator/includeSubmitResult/includeEscalate）注册；`contracts/src/tools/send-message.ts:9-23` schema `to/summary/message` 与官方逐字同构 | 对齐；batch3-ours §2.2 写"schema to,summary,content"为笔误（实际源码是 `message`），不影响判定 | 无 |
| T4 | TeamTask* 6 工具 + TeamSendMessage | 官方 bundle **0 命中**（batch3 已穷尽 grep） | `core/src/team/team-tools.ts:134-307`（TeamTaskList/Get/Create/Claim/Update/SendMessage），成员 runtime 自建注册表注入（member-runtime.ts:205），不入 builtInTools | 【有意分歧】纯自研；`specs/agents-team.md:13-18`（官方 3.14.3/3.15.1 双基线上游判定+grep 实证）、:300-301（teammate 强制保留协作工具，对齐官方 disallowedTools 例外精神） | 无 |
| T5 | TodoWrite readOnly 标记 | @7722833 `readOnly:!0`（真值） | `core/src/tool/handlers/todo.ts:145` `readOnly: true` | 【误报】batch3-target 表格该行把 readOnly 误记为 0；双侧一致，疑点推翻 | 无 |
| T6 | Skill readOnly 标记 | @7718556 `readOnly:!0`、permission:"skill"、needsApproval:!1 | `core/src/tool/handlers/skill.ts` metadata 逐字段一致 | 【误报】双侧一致，疑点推翻（skill 实际执行外部内容的担忧不构成差分——官方同标记） | 无 |
| T7 | ApplyPatch / GoalRead 休眠资产 | 导出 `ZCODE_KNOWN_TOOL_NAMES`→`cbr` 含两者、族表 `Sds` @1001890 含 Write/Edit/ApplyPatch:file-write 与 GoalRead:goal，但 `dCn` 注册表无条目 | `handlers/apply-patch.ts` 定义被注释未注册（index.ts:83；compat.ts:9 hook 别名）、`handlers/target.ts:29` targetReadToolEntry 未入列 | 对齐（双侧同为"已知名单在、注册表面休眠"的兼容/保留资产） | 无 |
| T8 | js 工具与 node-repl 宿主 | `includeNodeRepl` 默认关，官方 browser-use 插件启用；MCP 物化 node_repl js risk=high/sideEffectScope=system | `handlers/index.ts:204-205` 同门同注释；`core/src/mcp/index.ts:132-133` 同物化 | 对齐 | 无 |
| T9 | 动态工作流 11 工具归属版本 | **3.14.3 bundle 已含全部 11 个**（batch3-target #31-41 带偏移：CreateWorkflow @12582562…ResolveWorkflowQuestion @7772189），动态族默认开 | `handlers/index.ts:119-146` 全套 + :158-170 显式 false 才下架（缺席=保留，fail-closed 在协议层） | 对齐；batch3-ours §7.1"3.14.3 bundle 无动态工作流工具"为**误报**（该结论仅适用于更早版本，3.14.3 已有）；不构成版本差 | 无 |
| T10 | Task 别名（CC 兼容） | `hxo` @7715900：Agent 的 providerVisible:!1 别名，描述给插件指令用 | `core/src/tool/compat.ts:1-14` + `agent.ts:280-292` 同构（主名 Agent、Task providerVisible:false、hook matcher 互为别名） | 对齐 | 无 |
| T11 | OffPeak / ReadSessionContext / ReplyToChannel / TaskOutput / TaskStop / EnterPlanMode / ExitPlanMode / AskUserQuestion / WebSearch provider-native | 官方全在（batch3-target #18-19、#27-30、#20-22、#8） | 本仓全部在列（index.ts:95-96、111-114、100-102；websearch.ts:157-172 内部 web_search 变体） | 对齐 | 无 |

工具域小结：gap **0**；有意分歧 2（T1 VaultSearch、T4 TeamTask*）；误报 3（T2/T5/T6，另 batch3-ours §7.1 版本差表述、§2.2 content 笔误不另计 gap）。

---

## 3. 权限域差分表

| # | 差异点 | 官方证据（bundle） | 本仓证据（源码） | 判定 | 修复建议 |
|---|--------|-------------------|-----------------|------|---------|
| P1 | 模式集合与别名 | 内部枚举 11 名 @748321（default/yolo/guarded/plan/edit/acceptEdits/auto/dontAsk/bypassPermissions/autoEdit/build）；会话模式映射 `$4a` @13113600：bypassPermissions/dontAsk→yolo、acceptEdits→edit、auto→auto、plan→plan、default→inherit | 内部 `CollaborationMode` 6 模式（`contracts/src/interfaces/session.port.ts:36`）；协议入口归一：子代理 `core/src/runtime/methods/subagent.ts:540-557` 与 `$4a` **逐字对位**（含 default→builtInExplore?yolo:parent） | 对齐（内部枚举为官方子集，官方风格名全部在入口归一，行为面无分歧；内部枚举多出的 acceptEdits 等名字不承载独立行为，仅为别名面） | 无 |
| P2 | `auto` 模式是否实现 | checkPermission 步骤 6：deny `"mode.auto.unimplemented"` / "Auto mode is reserved but not implemented yet" | `core/src/permission/service.ts:158-163` 同 ruleId 同文案同行为（:413 第二分支同） | 【误报】疑点不成立：本仓 auto 同样**保留未实现**，与官方一致——既非版本差也非有意分歧，是逐字还原 | 无 |
| P3 | cron 自动化的官方风格名映射 | `cmc` @14721600：dontAsk/bypassPermissions→yolo；default/auto/acceptEdits/autoEdit→build；plan/edit/guarded/yolo/build 透传 | `bootstrap/src/drora-protocol/automation-port.ts:233-253` normalizeCronAutomationMode 逐 case 一致 | 对齐（此前只对照了 `$4a` 的 acceptEdits→edit，实为两条路径各归各位，本仓双双对位） | 无 |
| P4 | 弹窗选项 allowOnce/allowAlways vs 本仓 allow_once/allow_project | wire 权限选项 schema `qpr`：`{optionId, label, kind: enum(["allowOnce","allowAlways","deny","custom"]), response}`；always-allow 经 `wmo` 持久化 permissionUpdates（user-once/always-allow）；askOptions.allowAlways→"session-always-allow" | wire `packages/shared/src/drora-protocol-v4/snapshot.ts:235` 同一闭集 enum；内部 optionId `allow_once/allow_project/allowSession`（`bootstrap/src/permission-options.ts:47-105`）为私有标识，v4 投影映到 wire kind（`interaction-broker.ts:188-189` 注释：合成 allowAlways 语义等价 allow_project）；`allow_project` 携带 permissionUpdates 落项目规则（=官方 always allow 持久化）；`allowSession` 纯内存（对应官方 session-always-allow）；user-once 裁剪选项同官方 approvalMode；`contracts/tools/contract.ts:114` askOptions `{allowAlways: false\|"session"}` 同官方 | 【误报】wire 词表逐字一致；optionId 差异是私有命名非契约；"always=永久 vs project=项目级"的语义担忧不成立——官方 always allow 本就持久化到 project ruleset，两者语义同位 | 无 |
| P5 | 权限规则匹配（prefix:*/正则/全等、Bash 复合 every/some） | `LSo` matchesInvocationRule @7434175：`:*` 后缀→前缀匹配（`e===n \|\| startsWith(n+" ") \|\| startsWith(n+"\t")`）；其他 `*`→glob 编译；否则全等。`FSo` evaluateBashRules @7433761：allow 要求**每个** subject 组匹配（every），deny/ask 任一匹配即可（some） | `core/src/tool/handlers/bash-command-rule-evaluator.ts:44-53` matchesInvocationRule 三层语法**逐字一致**；:17-42 allow=every / deny-ask=some 同向；wildcard 编译 `core/src/permission/rule-matching.ts:1-7` | 对齐 + 【有意分歧】本仓 S03 加固（:9-13 整工具 allow 不再短路非 safe 命令，非 safe 落逐次确认）——`specs/upstream-v3.15.1-migration.md` "S03 Plan/P0 写入保护 保留已记录的策略差异" 行 + `specs/agent-write-safety.md` §2 | 无（保留差异已记录，重评条件随官方权限演进） |
| P6 | 模式持久化 | SQLite `local_setting` 表：`insert into local_setting (scope, scope_id, namespace, key, value, schema_version, …)`，记录 scope="project", namespace="permission", key="mode", value=JSON `{mode}`, schemaVersion=1（`TRr`/`IRr` @1573483）；session 内授权 scope:"session" 不落项目 | `apps/drora-cli/packages/adapters/src/storage/session-store/repositories/local-settings.ts:68-138`：同表、同四元组、同 JSON 形状、同 schemaVersion；会话 scope 不落盘（`bootstrap/src/app/session-facade.ts:597-604`）；规则集同表 key="ruleset"（:27-50）；读取方 `:52-66` | 对齐（batch4-target §6.3"Drora 若用文件需记录分歧"的前提不成立——本仓就是 local_setting 同构实现） | 无 |
| P7 | 判定序（hook→memory→deny/ask→yolo→auto→disallowed→project 规则→预批→plan→allow→edit→build） | batch3-target §3.2 checkPermission 决策序 1-16（ruleId 族） | `core/src/permission/service.ts:96-267` 同序同 ruleId（batch3-ours §4 已列；本批复核 auto 分支 :158、disallowed :166、project deny/ask :176/:185、ReplyToChannel 预批、plan、allow、edit/build 兜底均同位） | 对齐 | 无 |

权限域小结：gap **0**；有意分歧 1（P5 S03 加固，有 spec）；误报 2（P2 auto、P4 弹窗选项；P1/P6 的疑点前提亦不成立）。

---

## 4. 键族抽查（batch4-parity-keys gap=0 的真实性验证）

脚本四键族归一化后集合一致（batch4 实测退出码 0）。本批人工抽查 3 个改写键，双侧落点：

| 键 | 官方侧证据 | 本仓侧证据 | 结论 |
| --- | --- | --- | --- |
| `ZCODE_CREDENTIAL_SECRET` → `DRORA_CREDENTIAL_SECRET` | bundle 1 处（aes-256-gcm 凭据密钥来源，@4390112 附近常量块 `Lta`） | 本仓 bundle 1 处（`ZCODE_CREDENTIAL_SECRET` 0 处）；源码常量 `packages/services/src/credential/providers/credentialCipherProvider.ts:9`、`apps/drora-cli/packages/adapters/src/auth/credential-cipher.ts:8` | 映射真实 |
| `ZCODE_DYNAMIC_WORKFLOW_MODE` → `DRORA_DYNAMIC_WORKFLOW_MODE` | bundle 2 处（@764146 常量块 `Bfr`，合法值 disabled/onDemand/alwaysOn） | 本仓 bundle 2 处；源码常量 `packages/shared/src/dynamic-workflow-feature.ts:20`（`DRORA_DYNAMIC_WORKFLOW_MODE_ENV`），默认值 disabled 亦一致（:23） | 映射真实 |
| `zcode.cua/target-app-display-v1` → `drora.cua/target-app-display-v1` | bundle 原名（metaKeys 族 4 键之一） | 本仓 bundle @1502975 改名态（batch4-parity-keys §3.4 记录；脚本归一化后判 identical） | 映射真实（品牌层，`drora/browser responseMeta` 同族改名规则） |

抽查结论：batch4"gap=0、改名映射 100%"可信。

---

## 5. 总结论

| 域 | gap | 版本差 | 有意分歧 | 误报 |
| --- | --- | --- | --- | --- |
| 命令 | **1**（C2 /team TUI+headless 接线） | 0 | 2（C1 /team、C3 目录改名） | 5（C4、C5、C6、C8 + batch2-ours §5 headless 生效说） |
| 工具 | **0** | 0（T9 动态工作流工具 3.14.3 已有，不构成版本差） | 2（T1 VaultSearch、T4 TeamTask*） | 5（T2、T5、T6、T9、batch3-ours content 笔误） |
| 权限 | **0** | 0 | 1（P5 S03 加固，spec 已记录） | 4（P2、P4 + P1/P6 疑点前提不成立） |
| 键族 | 0（抽查通过） | — | — | — |

三域合计唯一需要对齐修复的 gap：**C2 —— 自研 `/team` 命令在 TUI 与 headless 面未接通**（`parseSlashCommand` 无 team 分支 + 保留名分流使其永远到不了 facade 的 builtin resolver，两处均报 "Unknown command: /team"；实际生效面只剩 App facade）。修复为最小接缝：三个 CLI 文件各加一处 team 识别/放行，展开仍走 facade 单一所有者。
