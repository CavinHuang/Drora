# 批次 2 调研报告：官方 bundle 斜杠命令系统全量解剖

- 目标文件：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 字节，esbuild 长行 bundle）
- 调研日期：2026-10-19；只读调研，未改动任何仓库文件
- 本文所有字节偏移可直接用于 `tail -c +OFFSET ... | head -c N` 复核

---

## 1. 调研方法（关键 grep 命令）

```bash
# 字面量普查（结论："/xxx" 字面量大多是 URL，真正的注册表不用这种形态）
grep -o '"/[a-z][a-z0-9-]*"' zcode.cjs | sort | uniq -c | sort -rn | head -80

# 定位注册表：靠已知样例命令名反查
grep -ob 'name:"compact",summary' zcode.cjs        # => 916199
tail -c +914000 zcode.cjs | head -c 6000           # 内置命令注册表 TF 全文

# 保留名表
grep -ob 'nlc=' zcode.cjs                          # => 14316240

# 文件命令适配器与发现根
grep -ob 'function Ano' zcode.cjs                  # => 4223958 createNodeCustomCommandAdapter 工厂
grep -ob 'discoverCommands' zcode.cjs              # => 4226982 / 4227682 / 14310737 / 14310871

# CLI 子命令
grep -ob 'function Odi' zcode.cjs                  # => 14998823 runCommandsCommand
grep -ob 'Ddi="Usage: zcode commands' zcode.cjs    # => 15001845

# TUI 解析与分发
grep -ob 'type:"known"' zcode.cjs | head -1        # => 15033342 parseSlashCommand 内
grep -ob 'function spi' zcode.cjs                  # => 15009551 handleCustomCommand

# 服务端文本分类
grep -ob 'function IDo' zcode.cjs                  # => 12852620 parseCompactCommand
grep -ob 'function ioi' zcode.cjs                  # => 14318462 内置 /init /workflow prompt 展开
```

命名规律：`r(fn,"原名")` 保留原始函数名（本 bundle 中 `r(...,"name")` 形态计数为 0，但 `r(fn,"原始名")` 大量存在），**用疑似函数名直接 grep 是最快的定位手段**。

---

## 2. 内置 TUI 斜杠命令：全量清单（20 个）

注册表变量 `TF`（导出名 `BUILTIN_ZCODE_SLASH_COMMAND_HELP_ENTRIES`，模块闭包 `dyr`，字节偏移 915220 起）。**TF 只是"帮助元数据"（name/summary/usage/aliases/details），不含执行函数**；真正执行在 TUI commandCenter 与 runtime 中分路处理（见 §7）。

原文摘录（`tail -c +915220` 起，字段顺序 details → aliases? → name → summary → usage）：

| # | name | aliases | summary（英文原文） | usage |
|---|------|---------|---------------------|-------|
| 1 | help | — | Show this slash command help. | `/help [command]` |
| 2 | login | — | Set up a Coding Plan provider. | `/login [zai-coding-plan\|bigmodel-coding-plan\|zai-coding-plan-api-key <api-key>\|bigmodel-coding-plan-api-key <api-key>]` |
| 3 | logout | — | Remove the shared Z.ai login credentials. | `/logout` |
| 4 | compact | — | Compact the current conversation with optional instructions. | `/compact [instructions]` |
| 5 | init | — | Create or update workspace AGENTS.md instructions. | `/init [notes]` |
| 6 | expert | — | Run or manage the expert workflow. | `/expert [status\|resume\|stop\|<task>]` |
| 7 | effort | `variant` | Show or switch the current session reasoning effort. | `/effort [list\|<level>]` |
| 8 | dwf | — | List, cancel, or resume dynamic workflow runs. | `/dwf [list\|cancel [runId]\|resume <runId>]` |
| 9 | fork | — | Fork a new session from a workspace checkpoint. | `/fork [latest\|checkpointId]` |
| 10 | locale | `language` | Show or switch the UI locale. | `/locale [auto\|en-US\|zh-CN]` |
| 11 | mcp | — | Show or manage configured MCP servers. | `/mcp [list\|status\|connect <server>\|disconnect <server>]` |
| 12 | plugins | `plugin` | Open the plugin manager. | `/plugins [list\|enable <plugin>\|disable <plugin>]` |
| 13 | mode | — | Show or switch the current permission mode. | `/mode [plan\|build\|edit\|yolo\|guarded]` |
| 14 | model | — | Show or switch the current session model. | `/model [list\|provider/model]` |
| 15 | new | `clear` | Start a fresh session in the TUI. | `/new` |
| 16 | resume | `continue` | Resume a saved session. | `/resume [sessionId]` |
| 17 | rewind | — | Inspect or restore workspace checkpoints. | `/rewind [latest\|checkpointId]` |
| 18 | skill | — | List skills, or force the next prompt to load one. | `/skill [<skill-name> [task]]` |
| 19 | goal | `target` | Show or set the current session goal. | `/goal [pause\|resume\|clear\|replace <objective>\|<objective>]` |
| 20 | workflow | — | Design and launch a dynamic workflow for a task. | `/workflow [what the workflow should accomplish]` |

details 字段样例（原文）：

- compact：`["Runs the core manual compaction path and forwards optional summary instructions."]`
- expert：`["Starts a durable expert workflow in yolo mode when called with a task.","Use status, resume, or stop to manage the latest or a named workflow run."]`
- effort：`["In the TUI, type /effort or /variant to open composer suggestions.","Submitting the empty command or list shows the current and selectable efforts as text.","Use a listed level to switch the current session reasoning effort."]`
- mode：`["Shows the current permission mode when submitted without arguments.","Interactive TUI composer input opens a local picker before submit.","Switchable modes are plan, build, edit, yolo, and guarded.","Picker rows and explicit input submit /mode <mode> commands."]`
- workflow：`["Loads the dynamic-workflows skill, then writes a workflow script and submits it with CreateWorkflow.","Runs as a normal agent turn; the workflow starts only after you confirm the script.","In the desktop app the command is offered only while dynamic workflows are enabled for this client."]`
- init：`["Runs a normal agent turn that inspects the current workspace and creates or updates AGENTS.md.","Existing AGENTS.md files should be edited rather than overwritten.","This command targets the workspace root, not the user default ~/.zcode/AGENTS.md."]`
- skill：`["Without a name, lists discoverable skills for the current working directory.","With a name, rewrites the next prompt so the Skill tool must load that skill first."]`
- plugins：`["Opens a TUI plugin panel when called without arguments.","Rows show \u2713 for enabled plugins and \u25CB for disabled plugins.","Use enable or disable with a plugin id to persist the switch in user config.","Plugin capability changes apply to new sessions."]`

**workflow 命令是条件命令**：`R4n`（原名 `visibleHelpEntries`）在 `workflowMode` 为 `disabled` 时从 TF 中过滤掉 `name==="workflow"`（`syc="workflow"`；`vY` = `isWorkflowModeEnabled`，`e!=="disabled"`）。禁用时 TUI 提示：`"Dynamic workflows are disabled in this session. Restart with --workflow-mode onDemand or --workflow-mode alwaysOn to use them."`（原文，变量 `Bke`）。

### 2.1 保留名与隐藏命令

模块 `lCt`（偏移 14316240）：

```js
Xri=["goal","workflow","compact","init"],
Qri=[{description:"Switch to Plan mode and optionally send a task.",inputHint:"/plan [task]",name:"plan",source:"builtin"}],
nlc=["compress","plan"],
rlc=new Set(TF.flatMap(e=>[e.name,...e.aliases??[]]).concat([...nlc]));
r(olc,"normalizeZCodeSlashCommandName"); r(yke,"isReservedZCodeSlashCommandName")
```

- `rlc` = 20 个内置名 + 全部别名 + `compress` + `plan` = **保留名集合**（`isReservedZCodeSlashCommandName`）。文件命令/自定义解析不得占用这些名字。
- `compress` 是保留名但**不在 TF 中**——全 bundle 仅此一处出现，属隐藏保留名（占位，未实现独立命令；实际压缩走 `/compact`）。
- `plan`（source:"builtin"）只出现在 `ifc`（协议建议列表 `listAppSuggestions`）与 `Qri` 中，是 **Plan 模式引导建议**，不在 TUI 斜杠命令表里。
- `Xri=["goal","workflow","compact","init"]`：经 `ifc` 映射为协议层"应用建议"（description=inputHint 形态），供远程/桌面 UI 展示快捷入口。
- `Dke` = `listProtocolSlashCommands`：协议层命令描述符 schema `zcodeSlashCommandSchema`（偏移 811677）：
  ```js
  BXt=m.object({name:yn,description:m.string(),inputHint:m.string().optional(),
                source:m.enum(["builtin","custom"]).optional()}).strict()
  ```

CLI `--help` 末尾还有一段 "Slash Commands:" 静态文案（偏移 ~13425600，模块 `i8o`，locale 字符串 `o8o.cli.help`），列出 16 个命令的一行摘要（与 TF 一致，略）。

---

## 3. 命令分类：三类来源

### 3.1 内置 TUI 命令（builtin）

TF 中 20 个。分发位置有两层：
- **TUI 本地**（`$Ue` = `createCommandCenter`，模块 `Ypi`，偏移 ~15038500）：help/login/logout/effort/dwf/mode/locale/mcp/plugins/model/goal/new/resume 及 fork/rewind 的无参 picker 分支在客户端本地执行（读写 app 端口）。
- **Runtime 服务端**：compact、init、workflow、rewind/fork（带参）、expert、skill、custom 全部走 `app.submitPrompt(...)` 文本注入，由 runtime 的 `customCommandPromptResolver` 与专用解析器接住（见 §7）。

### 3.2 文件定义命令（custom / "自定义斜杠命令"）

适配器 `vgn`（`r(Ano,"createNodeCustomCommandAdapter")`，偏移 4223958）。

**发现根**（`wno` = `resolveDefaultCustomCommandRoots`，`vno` = `commandRootsForBase`；常量 `_no="commands"`、`bKs=".zcode"`、`SKs=".agents"`、优先级步长 `vKs=10`）：

```
优先级（数字小者优先，重复名先到先得）：
1. extraRoots（config 注入）                        scope:"project" source:"zcode"
2. 用户级：  <home>/.zcode/commands                 scope:"user"    source:"zcode"
            <home>/.agents/commands                scope:"user"    source:"agents"
3. 项目级：  从 cwd 向上走到含 .git 的 worktree 根（含两端），
            每一级的 .zcode/commands 与 .agents/commands   scope:"project"
4. extraResolvedRoots（config commandRoots）追加在最后
```

注意：**没有 `.claude/commands`、`COMMANDS.md`**——全 bundle grep 均为 0 命中；目录族是 `.zcode/commands` + `.agents/commands` 双轨。

**文件格式**：
- 递归扫描 `*.md`（大小写不敏感后缀），最大深度 `EKs=12`；单文件正文读取上限 `CKs=1e5`（100KB，超出截断 `truncated:true`）。
- 命令名 = 相对根的路径，目录分隔符归一为 `:`（`PKs` = `commandNameFromPath`）→ **天然支持子目录命名空间**（如 `git/commit.md` → `/git:commit`）。
- 名字合法性 `IKs=/^[a-z0-9][a-z0-9_:-]{0,63}$/`（小写化后，允许 `:` `_` `-`，最长 64）。
- frontmatter：仅支持**扁平 YAML**（每行 `key: value`，`#` 注释，无嵌套；`OKs` = `parseFlatYaml`）；BOM 自动剥离（`RKs` = `extractFrontmatter`）。

**frontmatter 键白名单**（`AKs`，未知键产生 warning 诊断 `custom_command_unknown_frontmatter`）：

```js
AKs=new Set(["allowed-tools","argument-hint","description","disable-noninteractive","model","skills"])
```

- `description`：缺省时回退为正文第一个 `#`/`-`/`*` 行（`NKs` = `extractDescription`），截断 `Eno=1024`；两者都无 → error 诊断 `custom_command_invalid_frontmatter`。
- `allowed-tools`、`skills`：`[a, b]` 列表或逗号串（`Tno` = `parseList`）。
- `disable-noninteractive`：`true`/`yes`（`MKs` = `parseBoolean`）→ CLI 输出标注 `(interactive only)`。
- `argument-hint`：纯展示用途，拼进 usage 文本。
- `model`：字符串，CLI inspect 输出，无更多运行时证据。

解析产物 metadata（`parseCommand` 返回）：`{allowedTools, argumentHint, description, disableNonInteractive, frontmatterKeys, model, name, path, plugin, rootPath, scope, skills, source}`。

**诊断码**（`severity` warning/error，CLI `--verbose` 时输出）：`custom_command_scan_failed`、`custom_command_read_failed`、`custom_command_invalid_name`、`custom_command_invalid_frontmatter`、`custom_command_unknown_frontmatter`、`custom_command_duplicate_name`。

**模板变量**（`Krn` = `expandCustomCommandTemplate`，偏移 1375691）：
- `$ARGUMENTS`（`o1r`）：整段参数替换。
- `$1`、`$2`…（`I0s=/\$(\d+)/g`）：按位置取参；参数分割 `P0s` = `splitCustomCommandArguments`（shell 风格：单双引号、反斜杠转义、空白切分）。
- 参数非空但模板未用任何占位符 → 自动追加 `\n\nUser arguments:\n<args>`。
- **shell 展开**（动态执行）：`!`cmd`` 内联（`bNn=/!`([^`]*)`/gu`）与 ``` ```! fenced ```（`SNn=/```!\s*\r?\n?([\s\S]*?)```/gu`）。仅当调用方提供 `executionPort` 时执行（`Zri` = `expandCustomCommandShellSyntax`，偏移 ~14310240）；执行环境注入（`Xcc` = `createShellExpansionEnv`）：
  `CLAUDE_PROJECT_DIR`/`ZCODE_PROJECT_DIR`、`CLAUDE_CODE_SESSION_ID`/`CLAUDE_SESSION_ID`/`ZCODE_SESSION_ID`、`CLAUDE_PLUGIN_DATA`/`ZCODE_PLUGIN_DATA`、`CLAUDE_PLUGIN_ROOT`/`ZCODE_PLUGIN_ROOT`、`ZCODE_PLUGIN_ID`、`ZCODE_PLUGIN_NAME`；`${...}` 形式引用由 `Jri` 校验，`*_SKILL_DIR` 无 skill 上下文即抛错。超时 `Gcc=3e4`（30s），输出上限 `Gri=128*1024`。无 executionPort 的路径遇到该语法直接抛 `uses unsupported shell expansion. Dynamic expansion is not available yet.`。

**prompt 包装**（`Zrn` = `formatCustomCommandPrompt`，原文模板）：

```
Run custom command /<name>.
Command source: <scope>/<source>.
[Required skills: `a`, `b`.
Before following the command body, call the Skill tool for `a`, `b`.]

<正文（替换后）>
```

### 3.3 插件贡献命令（source:"plugin"）

- 插件装配（`Hea`，偏移 ~4367100）为每个插件产出 `{commandRoots: Yea(...), skillRoots, mcpServers, hooks}`。
- `Yea`（偏移 4368325）：两路 root——
  1. `vso("commands", ...)`：manifest `commands` 字段声明的相对路径（或插件根下约定目录 `commands/` 自动收纳），root 元组 `{path, plugin:{id,name,rootPath,dataPath}, priority, scope: official?"system":"user", source:"plugin"}`。
  2. `ota`（偏移 ~4371650）：manifest `commands` 为对象时，逐条 `{description?, argumentHint?, model?, allowedTools?, source|content}` 校验（source 与 content 二选一，`ita` 名字校验同 `IKs`），物化成 `<pluginDataPath>/generated-commands/<name>.md`（`ata` 合成 frontmatter 后写入），作为额外 root 注册。
- 插件命令名**不自动加插件前缀**；命名空间仅来自子目录路径 `:` 归一。插件上下文推断 `elc` = `inferPluginContext`：`metadata.source==="plugin" && basename(rootPath)==="commands"` 时，取 `dirname(rootPath)` 为插件目录。
- 命令 frontmatter 的 `skills` 键与 Skill 系统联动（见 §7.4）；插件 skills 另有 `qualifiedName: "<pluginName>:<skillName>` 别名（`resolvePluginSkillAlias`），那是 Skill 侧机制，命令名本身无此别名。

### 3.4 命名冲突与禁用

- 重名：先发现者胜（按优先级升序遍历），后者记 `custom_command_duplicate_name` 丢弃。
- `disabledPaths`（`gU(config.commandOverrides)` → `vNn` = `createCustomCommandDiscovery` 的 `disabledPaths`）可按绝对路径禁用单个命令文件。
- 保留名（§2.1）在服务端解析入口 `eoi` 处被 `yke` 拦截——保留名永不进 custom 解析。

---

## 4. CLI 子命令 `zcode commands [list|inspect <name>]`

用法常量 `Ddi`（偏移 15001845）：`"Usage: zcode commands [list|inspect <name>]"`。

入口 `Odi` = `runCommandsCommand`（14998823）：

```js
async function Odi(e,t,n,o){let i=o[0]??"list";
  return i==="list"?o.length>1?Rdi(e):await u_c(e,t,n)
       : i==="inspect"?o.length!==2||o[1]?.trim().length===0?Rdi(e):await d_c(e,t,n,o[1])
       : (e.stderr.write(`Unknown commands command: ${i}\n${Ddi}\n`),1)}
```

- 底层委托 bootstrap 模块导出 `listZCodeCustomCommands`（`sCt`）/ `inspectZCodeCustomCommand`（`Vri`）；inspect 对未知名抛 `Custom command not found: <name>`（错误消息匹配 `/not found/i` 时调用方静默吞掉）。
- **`list` 人类可读格式**（`m_c` = `formatHumanCommandList`）：

```
Custom commands (N)
- /<name>[ <argumentHint>]
  <description>[ (interactive only)]
  <scope>/<source>: <path>
[--verbose 时追加：
Diagnostics (M)
- [<severity>] <code>: <message> (<path>)]
```

  无命令时输出 `No custom commands found.`。
- **`inspect` 人类可读格式**（`h_c` = `formatHumanCommandInspection`）：

```
Command: /<name>
scope/source: <scope>/<source>
path: <path>
description: <description>
argumentHint: <argumentHint>        （有则输出）
allowedTools: a, b                  （非空才输出）
skills: a, b                        （非空才输出）
model: <model>                      （有则输出）
size: <bytesRead>/<sizeBytes> bytes[ (truncated)]
[--verbose 追加：空行 + "Content" + 正文（空为 "(empty)"）+ Diagnostics]
```

- **`--json` 格式**：`__c` = `formatCommandJson` → `{commands:[Ldi(metadata)...], cwd, diagnostics:[Fdi...], totalDiscovered}`；`y_c` = `formatCommandInspectionJson` → `{command:{bytesRead, content, metadata, sizeBytes, truncated}, cwd, diagnostics}`。metadata JSON 字段（`Ldi`）：`allowedTools, description, disableNonInteractive, frontmatterKeys, name, path, rootPath, scope, skills, source[, argumentHint][, model]`；diagnostic JSON（`Fdi`）：`{code, message, commandName?, path?, severity}`。
- 错误处理 `Mdi`：stderr `Error: <msg>`，`--verbose` 附 stack，退出码 1。
- CLI 顶层 `--help` 中该命令的描述：`commands   List custom slash commands (\`commands list\`)`。

---

## 5. 命令执行链路

### 5.1 TUI 侧（客户端先行）

`Zae` = `parseSlashCommand`（偏移 ~15032950）：`/name args` → `{args, name, rawName, type:"known"|"unknown"}`；别名在此归一（variant→effort、language→locale、continue→resume、clear→new、plugin→plugins、target→goal）。`/skill` 额外拆 `skillName`/`task`。

`$Ue` = `createCommandCenter`（模块 `Ypi`）按 name 分派：

| 分派目标 | 处理函数 | 机制 |
|---|---|---|
| help | `zUe` = `formatSlashCommandHelp` | 本地拼帮助（内置 + custom，`O4n` = `listSlashCommandSuggestions` 合并两源） |
| login/logout | 内联 | 客户端端口（OAuth/ApiKey picker `Wpi`） |
| compact / init / workflow / rewind(带参) / fork(带参) | 重新 `app.submitPrompt("/cmd args")` | **文本注入回服务端**，服务端解析 |
| expert | `_pi` | app.expertWorkflowStatus/stop 端口 + 任务注入 |
| effort | `hpi` | 本地 composer 建议/文本 |
| dwf | `dpi` | app.listDynamicWorkflowRuns/cancelBackgroundTask/resumeWorkflowRun |
| mode / locale / model / plugins / mcp | `Cpi`/`bpi`/`Api`/`Rpi`/`wpi` | 本地 picker 或状态文本 |
| goal | `Bpi` | app.readTarget/setTarget/updateTargetStatus/clearTarget |
| new / resume | `newApp`/`resumeApp` + picker `Lpi` | 本地会话管理 |
| skill | `Opi`（列表）或 `UUe` = `buildManualSkillPrompt` + submitPrompt | 见 §7.4 |
| unknown | `spi` = `handleCustomCommand`（偏移 15009551） | 尝试 custom 解析；失败则 `Unknown command: /x. Available commands: ...` |

`spi` 使用 `tpi` = `buildCustomCommandPrompt` → CLI 版展开器 `Zdi` = `expandCliCustomCommandPrompt`（**不支持 shell 展开**，直接抛错），展开后 `submitPrompt(prompt)` 作为普通 prompt 提交。输入历史以 `"slash_command"` 类型记录（`P4n` = `recordSlashCommandInHistory`；含 API key 的 login 参数不入历史：`oyc` 正则）。

### 5.2 Runtime 服务端（权威路径）

文本注入后（或 app-server 协议直连），turn 准备函数 `Q6o`（偏移 ~13266000）做文本分类：

```js
let c=IDo(e), u=CDo(e), ...
if(c!==null){...return this.executeManualCompact(e,c,...)}      // /compact [instructions]
if(u!==null)return this.executeRewindCommand(e,u,...)           // /fork、/rewind
// 否则普通 agent turn：
// context init → SessionStart hooks → 持久化 → prompt hooks →
// customCommandPromptResolver → admission(CommandInbox) → model request
```

- `IDo` = `parseCompactCommand`：`"/compact"` 或 `"/compact <instructions>"`。
- `CDo` = `parseRewindCommand`：`/fork [latest|checkpointId]`、`/rewind [status|latest|checkpointId|cascade <conversation|message|code|workspace> <messageId>]`（子解析 `xDo`/`VMa`/`TDo`）。
- `/goal` 不走文本：TUI `Bpi` 直接调 `setTarget` 等端口；协议层有独立方法 `session/goal`（方法表含 `sessionCompact:"session/compact", sessionGoal:"session/goal"`）。v4 命令总表 `OLn = {...Fsi,...Gsi,...Ksi,...Ysi,...Dii,...Hsi,...Msi,...Bsi,...Usi,...Qsi,...tai}`（偏移 ~14680109），其中 `Dii={compact:Vuc,pauseGoal:Juc,resumeGoal:Kuc,sendGoalCommand:Guc}`；执行器 `fEt` = `V4CommandExecutor`（`supports: t in OLn`），queue promote 路径 `Wpc` 中 `w.kind==="compact"` → `sLn` = `startManualCompact`，`w.kind==="sendGoalCommand"` → `uUe` = `applyGoalCommand`，objective 解析 `Pii` = `parseGoalObjectiveFromCommandText`（正则 `/^\/(?:goal|target)(?:\s+([\s\S]*))?$/i`，剥 `replace ` 前缀）。
- **custom 命令服务端解析**（挂接点在 session 装配处，偏移 ~14344xxx）：

```js
customCommandPromptResolver: r(async(On,Qr)=>{
  let qe=ioi(On,{dynamicWorkflowEnabled:ut.dynamicWorkflowEnabled,workingDirectory:a});
  return qe!==void 0
    ? (qe.name===PN && await Rt?.activateDynamicWorkflowTools({source:"command",...}), qe.prompt)
    : await eoi(On,{env,executionPort:we,logger,sessionId,signal,...})   // 含 shell 展开能力
},"customCommandPromptResolver")
```

  - `ioi`（偏移 14318462）：拦内置 `/init`、`/workflow`：`/init` 就地合成大段 prompt（含 AGENTS.md 目标路径、`.zcode/AGENTS.md` 与 `.agents/AGENTS.md` 候选检查等步骤指引，原文见偏移 14318600 之后）；`/workflow` 用 `roi` = `expandBuiltinWorkflowCommandPrompt`（模块 `dCt`）——把 TF 里 workflow 条目转成一个**合成的 custom 命令对象**：

    ```js
    wNn=[`Use the \`${j_}\` skill to design and launch a dynamic workflow for this request:`,"","$ARGUMENTS",...].join("\n")
    ulc={bytesRead,content:wNn,metadata:{allowedTools:[],argumentHint:llc,description:clc,
         disableNonInteractive:!1,frontmatterKeys:["description","argument-hint","skills"],
         name:PN,path:"builtin:workflow",rootPath:"builtin:",scope:"system",skills:[j_],source:"zcode"},...}
    ```

    即 `/workflow` 在实现层就是一个内置的"类文件命令"，`$ARGUMENTS` 复用同一套模板替换；dynamicWorkflowEnabled===false 时返回 undefined（回落到 TUI 的禁用提示路径）。
  - `eoi` = `resolveZCodeCustomCommandPrompt`（模块 `toi`）：`alc` 解析 → `yke` 保留名拦截 → `aCt` = `loadZCodeCustomCommand` → 有 executionPort 则 `Zri` shell 展开（`Krn` 先做 $ARGUMENTS/$N 替换），否则 `Ert` = `expandCustomCommandPrompt`（遇 `!`...`` 语法抛错）→ 返回最终 prompt 注入 turn。

### 5.3 时序图（所有者与事件顺序）

```
TUI Renderer            Runtime/session                     文件系统
    | /git:commit fix       |                                   |
    | submitPrompt(text)    |                                   |
    |---------------------->| Q6o: IDo/CDo 文本分类（compact/fork/rewind）
    |                       |   ↓ 非内置
    |                       | customCommandPromptResolver
    |                       |   ioi(/init,/workflow) → 合成 prompt
    |                       |   eoi(custom): yke 保留名? → aCt loadCommand ──读──> .zcode|.agents/commands/**.md
    |                       |   Krn($ARGUMENTS/$N) → Zri(executionPort shell, 30s/128KB) → prompt
    |                       |   ↓
    |                       | CommandInbox admission → activeTurn → model request
    |<-- 事件流(assistant_message/tool...) --|                    |
```

### 5.4 与 Skill 系统的关系（结论：两条独立链路 + 一处强制耦合）

1. **命令≠Skill**：custom 命令由 `NodeCustomCommandAdapter`（`commands/` 目录、`.md`+frontmatter）独立发现与加载；Skill 由 `createNodeSkillAdapter`（skills 目录、`allowImplicitInvocation`、plugin skill 别名 `plugin:skill`）负责。二者数据结构同形（frontmatter 平铺解析器在两边各有一份：命令侧 `OKs`/`ILe`/`Tno`，skill 侧 `cKs`/`hgn`），但注册表互不相通。
2. **执行期耦合**：命令 prompt 包装固定注入 `Required skills: ...` + `Before following the command body, call the Skill tool for ...`（`A0s` = `formatCommandSkillInstructions`）——即命令的 `skills` frontmatter 是**提示级**约束（靠模型自觉调 Skill 工具），非硬门禁；`/skill <name>` 则直接把 prompt 改写为强制首调 Skill 工具（`UUe` 原文：`Use the skill named \`X\` for this turn.` / `First call the \`Skill\` tool with name \`X\` before doing the task.`）。
3. **内置命令借用命令机制**：`/workflow` 被实现为合成 custom 命令（`scope:"system"`、`source:"zcode"`、frontmatterKeys 含 skills），复用 `$ARGUMENTS` 模板与 `skills` 指令注入（`dynamic-workflows` skill）。
4. `/help` 文案明示 Skill 与命令是两个清单：`zUe` 输出 "Slash commands:" 段 + "Custom commands:" 段；CLI 另有独立 `skills list` 子命令。

---

## 6. 权限与确认

- 命令本身**无确认门**；TUI `createCommandCenter` 各本地 handler 直接执行。唯一权限语义：
  - `disable-noninteractive: true` 的 custom 命令在 CLI/headless 不可用（标注 interactive only）；
  - `/mode` 切换权限模式（plan/build/edit/yolo/guarded）；
  - login 凭据参数不入输入历史；
  - shell 展开子命令通过 executionPort 的权限/执行边界（与 Bash 工具同一 port），HEADLESS CLI 无交互 gate 时自动 approve（`createHeadlessPermissionBroker` 原文：`Headless CLI auto-approves ${t.toolName}: no interactive gate exists in -p mode.`）。

---

## 7. 差分对照要点（供与 Drora 实现对比）

1. 官方命令名集合 = §2 的 20 个 + 隐藏保留名 `compress`/`plan`；别名对：variant=effort、language=locale、continue=resume、clear=new、plugin=plugins、target=goal。
2. 官方**没有** `.claude/commands` 或 `COMMANDS.md` 兼容层；目录为 `<home|worktree 链>/.zcode/commands` 与 `/.agents/commands`。
3. frontmatter 仅 6 键且扁平 YAML；`allowed-tools`/`argument-hint`/`description`/`disable-noninteractive`/`model`/`skills`；未知键 warning 不拒绝。
4. 命名空间 = 子目录 `:` 归一；插件命令不加前缀；重名静默丢弃（诊断可见）。
5. 模板变量 `$ARGUMENTS`/`$N` + `!`cmd``/``` ```! ``` shell 展开（30s、128KB、env 注入 CLAUDE_*/ZCODE_* 双套键）。
6. `commands list|inspect` 输出格式见 §4（可作 CLI 输出快照测试基线）。
7. 执行链路关键函数名清单：`parseSlashCommand`、`createCommandCenter`、`handleCustomCommand`、`listSlashCommandSuggestions`、`formatSlashCommandHelp`、`buildManualSkillPrompt`、`listProtocolSlashCommands`、`visibleHelpEntries`、`resolveZCodeCustomCommandPrompt`、`parsePromptCustomCommandInvocation`、`loadZCodeCustomCommand`、`listZCodeCustomCommands`、`inspectZCodeCustomCommand`、`createNodeCustomCommandAdapter`、`discoverCommands`、`resolveDefaultCustomCommandRoots`、`expandCustomCommandPrompt`、`expandCustomCommandTemplate`、`expandCustomCommandShellSyntax`、`expandCliCustomCommandPrompt`、`expandBuiltinWorkflowCommandPrompt`、`parseCompactCommand`、`parseRewindCommand`、`parseGoalObjectiveFromCommandText`、`runCommandsCommand`、`runCommandsListCommand`、`runCommandsInspectCommand`、`formatHumanCommandList`、`formatHumanCommandInspection`、`isReservedZCodeSlashCommandName`。
