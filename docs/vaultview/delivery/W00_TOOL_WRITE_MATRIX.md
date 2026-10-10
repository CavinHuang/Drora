# W00 工具写入边界矩阵（W00_TOOL_WRITE_MATRIX）

**工作单：** W00 执行项 3　**日期：** 2026-10-10　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`（分支 `feat/vaultview-impl`，只读审计 + 临时目录 Spike，仓库零改动）

> 审计人：W00 审计-工具写入矩阵；撰写人：W00 证据撰写员。
> **路径约定：** `path:line` 相对实施工作树根 `D:/workspace/projects/Drora-vaultview-handoff/`。实测编号 P\*/B\*/W\* 对应 spike 输出。
> **抽查声明：** 撰写员已复核本矩阵的下列关键行号并全部命中：`permission/service.ts:136-138/:292/:307-320/:415-422`、`path-policy.ts:36-39`、`memory-file-permission.ts:38-46/:74-86`、`permission-flow.ts:123-158`、`bash-command-rule-evaluator.ts:14`、`permission-suggestions.ts:24-36`、`mcp/index.ts:108-123`、`obsidian-plugin/src/hooks/permission-request.ts:5-42`；其余引自审计员素材。

## 1. 结论概述（S03 预判：GO，有条件、需收窄口径）

对 CLI runtime 建立了「模型可见写盘通道 + 运行时自动写盘通道」的完整边界矩阵：所有模型工具调用统一经过 `executeToolCall` 管线（PreToolUse hook → PermissionService → broker/PermissionRequest hook 竞速 → handler），但「用户可授权 / Hook 可判定 / 真正可阻断」三个维度在 **Bash、node_repl、MCP** 三条通道上存在**结构性盲区**——yolo/整工具 allow 规则完全绕过、规则 subject 只认 6 个输入键、plan 模式两处打洞、路径规则按原始字符串匹配不解析真实路径；另有 **8 类不经过 PermissionRequest 的内置自动写盘**。

仓库已有分层骨架（riskLevel/sideEffectScope/needsApproval/alwaysAsk/rulePolicy/PreToolUse/PermissionRequest/broker 全链在场），缺的是「分级一致性」而非「从零建门」→ **S03 GO（有条件）**：必须先修三个洞（§6.1）并按落盘目标可判定性分级收口（§6.2）；「全」字做不到的部分改为审计日志口径并在 spec 记录为有意分歧（§6.3）。

## 2. 执行管线：判定发生的位置（文本时序）

```
模型工具调用
  → executeToolCall
      registry 查找 → schema/语义校验 → resolveInput 归一化
      → PreToolUse hook          deny / preventContinuation 硬阻断（call-runner.ts:242-268）
                                 （改写输入后再校验 call-runner.ts:269-288）
      → resolveToolPermission    permission-flow.ts:41-431
            PermissionService 判定（mode/rule/memory 覆盖，见 §3）
            → PreToolUse allow/ask 叠加：hook allow 可抹 ask，抹不掉 alwaysAsk（hook-flow.ts:195-232）
            → memory 文件覆盖（memory-file-permission.ts）
            → prepareApproval 门
            → PermissionRequest hook 与 broker 竞速（permission-flow.ts:184-236，败者不阻塞确认窗）
            → deny / escalate / modify（modify 触发 recheck，240-267）
            → 项目/会话规则持久化（permission-flow.ts:359-404）
      → handler 执行 → PostToolUse

默认 broker = DenyPermissionBroker（permission/broker.ts:147-154），fail-closed；
子代理 runtime 共享父级 permissionService + broker（runtime/helpers/runtime-tools.ts:155-160）；
project-memory-agent 用 DenyBroker + 独立 PermissionService（project-memory-agent.ts:117-118）。
```

## 3. 写盘边界矩阵（主表）

列：通道 | 写盘事实 | 用户可授权 | Hook 可判定 | 真正可阻断 | matcher/规则盲区

### 3.1 Write / Edit

- 写盘事实：`fileSystemPort.writeTextFile`，atomic + createParents（`core/src/tool/handlers/write.ts:125-137`；Edit 同 `edit.ts:274-283`，Edit 规则同时管 Write：`permission/service.ts:264-267`）。
- 边界：`core/src/tool/path-policy.ts:36-39` 注释明确「当前版本不硬阻 workspaceRoot 之外路径」→ **全盘可写**（逐次 ask 或规则放行）。
- 授权：默认 ask（medium/workspace/needsApproval，`write.ts:211-240`）；yolo 直通（`service.ts:136-138`）；full-access receipt 翻 yolo（`runtime/permission-full-access.ts:48-60`）。
- 阻断：PreToolUse deny / 项目 deny / disallowedTools / plan deny。
- 盲区：规则按原始 `file_path` 字符串匹配，不解析真实路径（相对路径拼写绕过 deny 规则，W3）；内置免确认区 memoryRoot `*.md`（且覆盖 plan deny，P7）与 `.drora/workflow-drafts/**`（plan 不免）。
- Spike：P1 build 模式 Write 到 `C:/Users/A/Desktop/evil.txt` => ask（有弹窗）；P2 yolo => allow `ruleId=mode.yolo`。

### 3.2 Bash

- 写盘事实：子进程任意写。
- 授权：默认 ask（high/system，`bash.ts:448-476`）；运行时只读降级 `isRuntimeReadOnlyBashCommand` 通过 → readOnly / needsApproval=false 直接 allow（`bash.ts:77-95`；策略 `bash-semantics.ts:39-66` fail-closed：含重定向/未识别命令一律非只读，B5-B8）。
- 前缀规则 `cmd:*` 经 `resolvePermissionRulePolicy`（`bash.ts:465`）只对无重定向/无管道/静态赋值命令生效（`bash-command-permission-policy.ts:169-181`）；B1 命中、B2/B3 重定向与串接回落 ask。
- **盲区：无 ruleContent 的整工具 allow 规则短路一切（含重定向命令）**——`bash-command-rule-evaluator.ts:14` `if (input.rules.some((rule) => !rule.ruleContent)) return true;`（B4）。yolo 下只读解析无关紧要全放行。
- Spike：B5 `echo hi > evil.txt` => 非只读；B6 `cat` => 只读；B7/B8 脚本 => 非只读；P8 `echo` 在 build 模式 => allow `mode.build.readOnly`；B4 整工具 allow 下重定向变体 => allow。

### 3.3 js / node_repl

- 写盘事实：宿主内完整 Node 特权（`node-repl.ts:366-413`，risk high/system/needsApproval；声明 `alwaysAllowPatternSources: []` 无济于事）。**盲区最大**：
  - 规则 subjects 键集 `["command","url","file_path","path","pattern","patch_text"]` 不含 `code`（`permission/service.ts:292`）→ 内容规则永不命中（P5：node_repl content-rule => ask）；
  - `permission-suggestions.ts:24-36` 在取不到内容键时建议**整工具 allow**，一次「总是允许」被持久化为项目规则 = 任意代码执行永久化（P6：整工具 allow 规则下任意 code => allow `rule.project.allow`；落盘 `permission-flow.ts:359-388`）。
- 默认仅官方 browser-use 插件启用（`tool/handlers/index.ts:184-185,262-264`）。

### 3.4 MCP / 插件工具

- `core/src/mcp/index.ts:102-258`：readOnly/destructive 取 **server 自报** `annotations.hint`（`mcp/index.ts:108-109`，**撰写员已复核**）；needsApproval 恒 true（`:123`）；scope 默认 network、宿主 node_repl 为 system（`:115-122`）；handler 直透 `mcpPort.callTool`（`:214-244`）。
- **plan 模式打洞**：未声明 `destructiveHint` 的 MCP 在 plan 模式直接 allow（`permission/service.ts:415-422`，readOnlyHint=false 也不看）→ **写盘型 MCP 免疫 plan**（P3 实测：allow `mode.plan.mcp`）；`destructiveHint=true` 才 deny（P4：deny `mode.plan.nonReadOnly`）。
- 官方 CUA 有不可伪造 authority 门与专属 capability group（`mcp/index.ts:158-166`、`runtime/methods/mcp.ts:17-38`），其余 server 无特权。
- 盲区：写盘行为在 server 进程内，宿主只见调用不见落盘；subjects 键集同样限制内容规则；matcher 只有 toolName 粒度。

## 4. PermissionRequest matcher 覆盖不到的通道（盲区汇总）

1. yolo / full-access 下全部通道（ask 分支前置短路，`service.ts:136-138`、`service.ts:333-392`——仅 alwaysAsk 与 requiresUserInteraction 工具幸免）；
2. Bash/js/MCP 的整工具 allow 规则与会话 allow（`service.ts:365-372`）；
3. subjects 键集外输入的内容规则（node_repl `code`、任意 MCP 参数名）；
4. §5 全部内置自动写盘；
5. MCP server 进程内部写盘；
6. 相对路径 / `/c/` 别名 / 符号链接拼写绕过路径型规则（`normalizeToolPathForComparison` 仅用于 read-file-state 与 bash-cwd-policy：`tool/path-normalization.ts:15-22`，不入权限判定）；
7. plan 模式被无 destructiveHint 的 MCP 与 memory md 两处打洞；
8. 路径策略无 workspaceRoot 硬边界（`path-policy.ts:36-39`）。

## 5. 内置自动写盘清单（PermissionRequest 天然覆盖不到，8 类）

| # | 通道 | 位置证据 |
| --- | --- | --- |
| 1 | memory markdown 免确认写（且覆盖 plan deny） | `core/src/tool/executor/memory-file-permission.ts:38-46,:74-86`（plan deny `mode.plan.nonReadOnly` 被特意排除在保留名单外；P7 实测 plan deny 被覆盖为 allow `memory.file.markdown`） |
| 2 | workflow 草稿免确认（plan 仍拦） | `permission/workflow-draft-path.ts:60-90`（纯字符串判定不碰 fs）+ `permission/service.ts:202-215` |
| 3 | 工具结果工件 `<DRORA_STORAGE_DIR\|~/.drora>/cli/artifacts/<sessionId>/` | `adapters/src/storage/index.ts:41-76` + `bootstrap/src/app/create-app.ts:351-354` |
| 4 | Bash 输出持久化 `<storage>/cli/exec/<sessionId>/<toolCallId>-stdout.log` | `adapters/src/exec/execution-utils.ts:18-21` + `node-execution-adapter-base.ts:91-97` |
| 5 | 权限规则持久化 | `tool/executor/permission-rules-persistence.ts:54-57`（sessionStore.saveProjectPermission） |
| 6 | hook trust store `workspace-hook-trust-v1.json` | `packages/shared/src/workspace-hook-trust-store-file.ts:4` |
| 7 | 保存工作流 `<cwd>/.drora/workflows` + home | `tool/handlers/saved-workflows/store.ts:56-61`（契约 `contracts/src/tools/saved-workflow.ts:19,25`） |
| 8 | Todo / session store | `tool/handlers/todo.ts:65`（sessionStore.updateTodos） |

（WebFetch 缓存为纯内存 `tool/handlers/webfetch-cache.ts:8`，不落盘，不计入。）

## 6. S03 有条件 GO 的落地条件

### 6.1 三个必须先修的洞（全部有实测证据）

1. plan 模式两处打洞：MCP 无 `destructiveHint` 即直通（P3，`service.ts:415-422`）+ memory md 覆盖 plan deny（P7，`memory-file-permission.ts:38-46`）；
2. node_repl/MCP 无内容规则粒度：默认建议即整工具 allow，一次「总是允许」= 持久化全权（P5/P6）；
3. Bash 整工具 allow 规则短路含重定向在内的一切命令（B4，`bash-command-rule-evaluator.ts:14`）。

### 6.2 按落盘目标可判定性分级门控

- **P0 任意路径写**（Bash / js / 未声明 destructive 的 MCP）：强制逐次确认 + 禁整工具持久 allow；
- **P1 授权根内写**（Write/Edit，含 obsidian vault hook 路径）：维持现骨架；
- **P2 免确认区**（memory md / workflow 草稿 / artifacts / 执行日志）：保留但强制审计事件。
- 统一收口挂点：`resolveToolCallCapabilityFlags`（`permission-capability.ts:28-39`）随 `ToolCallStarted` 广播每次调用的 readOnly/sideEffectScope，dynamic-workflow driver 已是消费方。

### 6.3 「全」字做不到的部分 → 有意分歧记录

MCP server 内部行为、宿主自动写、yolo 直通无法被逐路径门控；改为「模型可见工具全覆盖 + 自动写盘审计日志 + yolo 需显式 receipt」并按 AGENTS.md 在 `specs/` 记录为有意分歧（区分「缺口」与「有意分歧」）。

## 7. Spike 证据（可复跑，全部退出码 0）

命令模板：`cd D:/workspace/projects/Drora-vaultview-handoff && node ./node_modules/tsx/dist/cli.mjs --tsconfig C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/tsconfig.json <script>`（tsconfig 用 paths 把 `@drora/contracts`、`@drora/shared` 映射到 TS 源，避免要求 dist 构建）。

- `matrix-probe.ts`：P1-P10（Write 任意路径、yolo、plan-MCP 打洞、内容规则键集、整工具 allow、只读降级、memory 覆盖 plan deny 等），exit 0。
- `bash-policy-probe.ts`：B1-B8（前缀规则命中/回落、重定向 fail-closed、只读降级）+ W1-W3（路径 deny 规则命中别名、相对路径绕过 deny），exit 0。
- 脚本与产物均在 `C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/`（合成输入，未触碰真实文件；P1 的 `evil.txt` 落在用户桌面属 spike 故意验证 ask 弹窗行为，未自动放行）。

**诚实注记（勿误读）**：P10 显示 service 层朴素匹配会放行重定向变体，但生产 Bash 恒走 rulePolicy（`bash.ts:465`），实测回落 ask——朴素层行为不代表生产行为。

## 8. Hook 通道能力与极限（补充）

- matcher 三态：`*` 全部、纯字母数字|管道=白名单、其余 regex（`core/src/hooks/output.ts:98-112`）；别名 ApplyPatch→Write/Edit、Agent↔Task（`tool/compat.ts:6-23`）；hook 收到归一化后 executionInput（`call-runner.ts:204-231` 注释：策略/确认窗/执行同字节）。
- PreToolUse：deny 硬阻断（`call-runner.ts:242-268`）；allow 抹 ask 但抹不掉 alwaysAsk（`hook-flow.ts:200-218`）；deny 不可被 PreToolUse hook 翻案。
- PermissionRequest：可 allow/deny/modify（modify 重校验），与 broker 竞速（`permission-flow.ts:179-236`）。
- 插件实例（obsidian）：matcher=Write|Edit，vault 内 `allowAgentWrites=true` 自动 allow（`obsidian-plugin/src/hooks/permission-request.ts:11-48`，**撰写员已复核**）；防逃逸 = realpath 根包含 + 逐段 lstat 拒符号链接（`lib/agent-access.ts:42-63`）；候选补丁收紧到非隐藏 `.md`，其注释自认「不能拦截 Bash/MCP 写盘」——**这是单工具 matcher 的结构极限，不是实现缺陷**。

## 9. 验证记录与未执行项

- 已运行：§7 两个 probe 脚本（exit 0）；其余为只读源码审计（读取即证据）。本专项无仓库代码改动，typecheck/lint/architecture:check 按分工由脚本统一跑（结果记录见 `W00_EVIDENCE_REPORT.md` §2）。
- 未执行：S03 门禁的修复实现与回归（属后续工作单）；Electron/renderer 进程内工具行为；未逐行复核 `runtime-tools.ts:155-160`、`project-memory-agent.ts:117-118`、`broker.ts:147-154`、`node-repl.ts:366-413`、`bash.ts`、`bash-semantics.ts`、`bash-command-permission-policy.ts` 等未抽查引用（引自审计员素材）。
