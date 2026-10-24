# 我方（Drora）CLI 斜杠命令体系清单 — batch2 差分基线（我方侧）

> 调研范围：`apps/drora-cli`（约 30 个包）+ `packages/shared` + `packages/ui` 中斜杠命令的注册、发现、展开、执行与展示链路。只读调研，基于当前检出（含提交 f7c0e4c3）。所有行号以当前工作区为准。

---

## 1. 命令注册表定位

我方斜杠命令**没有单一集中注册器**，由四张表/四处装配点共同构成：

### 1.1 权威帮助表（唯一出处，决定保留字）

`packages/shared/src/drora-slash-command-help.ts:9` — `BUILTIN_DRORA_SLASH_COMMAND_HELP_ENTRIES`，共 **21 条内置命令**（name + summary + usage + details + 可选 aliases）。该表是"保留字 / TUI 候选 / App 目录"的唯一出处（specs/agents-team.md:498 C1 条目自述）。

完整清单（usage 摘自源码）：

| # | name | aliases | usage |
|---|------|---------|-------|
| 1 | help | — | `/help [command]` |
| 2 | login | — | `/login [zai-coding-plan\|bigmodel-coding-plan\|zai-coding-plan-api-key <api-key>\|bigmodel-coding-plan-api-key <api-key>]` |
| 3 | logout | — | `/logout` |
| 4 | compact | — | `/compact [instructions]` |
| 5 | init | — | `/init [notes]` |
| 6 | expert | — | `/expert [status\|resume\|stop\|<task>]` |
| 7 | effort | variant | `/effort [list\|<level>]` |
| 8 | dwf | — | `/dwf [list\|cancel [runId]\|resume <runId>]` |
| 9 | fork | — | `/fork [latest\|checkpointId]` |
| 10 | locale | language | `/locale [auto\|en-US\|zh-CN]` |
| 11 | mcp | — | `/mcp [list\|status\|connect <server>\|disconnect <server>]` |
| 12 | plugins | plugin | `/plugins [list\|enable <plugin>\|disable <plugin>]` |
| 13 | mode | — | `/mode [plan\|build\|edit\|yolo\|guarded]` |
| 14 | model | — | `/model [list\|provider/model]` |
| 15 | new | clear | `/new` |
| 16 | resume | continue | `/resume [sessionId]` |
| 17 | rewind | — | `/rewind [latest\|checkpointId]` |
| 18 | skill | — | `/skill [<skill-name> [task]]` |
| 19 | goal | target | `/goal [pause\|resume\|clear\|replace <objective>\|<objective>]` |
| 20 | workflow | — | `/workflow [task]` |
| 21 | team | — | `/team [goal]` |

### 1.2 App 斜杠面板白名单（bootstrap）

`apps/drora-cli/packages/bootstrap/src/slash-command-surface.ts`：
- :8-14 `APP_PROTOCOL_VISIBLE_BUILTIN_SLASH_COMMAND_NAMES = ["goal","workflow","team","compact","init"]` —— App `/` 面板与加号菜单内置段（顺序即展示顺序，UI 不再排序）。
- :17-24 `APP_PROTOCOL_APP_ONLY_BUILTIN_SLASH_COMMANDS`：`/plan [task]`（仅 App Composer，不进 CLI TUI/help 面）。
- :26 `EXTRA_RESERVED_SLASH_COMMAND_NAMES = ["compress","plan"]`；:28-33 保留字集合 = 帮助表全部 name+aliases + extra；:39-41 `isReservedDroraSlashCommandName`。

### 1.3 协议目录装配（Host 侧聚合）

`apps/drora-cli/packages/bootstrap/src/drora-protocol/slash-commands.ts:29-61` — `listProtocolSlashCommands(options)`：
1. 内置段 = 白名单 5 条（从帮助表取 summary/usage）+ App-only `plan`（:64-78）；
2. 灰度剔除：`dynamicWorkflowEnabled === false` 剔 `workflow`、`agentsTeamEnabled === false` 剔 `team`（:35-39，f7c0e4c3 加入 team 门）；
3. 追加自定义命令（`listDroraCustomCommands`），过滤 `disableNonInteractive` 与保留名（:49-60）。

装配调用点（三处）：
- `drora-protocol/session-mapper.ts:129`（session/read 快照携带 slashCommands）；
- `drora-protocol/v4-workspace-config.ts:52`（v4 workspace-config；team 门 = `getInstalledTeamHub(sessionId) !== undefined`）；
- `drora-protocol/workspace-model-runtime.ts:28`（`readWorkspacePresentation`，App workspace 目录水合 RPC；team 门同样按装配事实）。

### 1.4 TUI 侧解析/候选

`apps/drora-cli/packages/cli/src/command-center/slash-commands.ts`：
- :40-250 `parseSlashCommand(input)`：TUI/headless 已知命令硬编码分支（compact、expert、effort/variant、dwf、fork、help、init、workflow、login、logout、locale/language、resume/continue、new/clear、rewind、mode、mcp、plugins/plugin、model、goal/target、skill），其余返回 `type:"unknown"`。**注意：`team` 不在其中**（详见 §7 观察项）。
- :26-32 `visibleHelpEntries`：`--workflow-mode disabled` 时从候选中滤掉 workflow。
- :272-285 `listSlashCommandSuggestions(customCommands, {workflowMode})` = 帮助表（经 workflow 门）+ 文件自定义命令。
- 帮助表本体直接 re-export：`command-center/slash-command-help.ts:1-3`（`SLASH_COMMAND_HELP_ENTRIES = BUILTIN_DRORA_SLASH_COMMAND_HELP_ENTRIES`，无第二份拷贝）。

---

## 2. 命令来源分层与优先级/遮蔽规则

| 层 | 发现路径 | 来源标识 | 优先级 |
|----|---------|---------|--------|
| L1 内置（代码） | 帮助表 + `builtin-prompt-command.ts` / command-center 分支 | —（builtin） | 保留名，自定义/插件同名一律被拒 |
| L2 配置 extra roots | config `extraRoots`（`adapters/src/commands/roots.ts:34-43`） | source="drora" | 最先扫描 |
| L3 用户文件 | `~/.drora/commands` 与 `~/.agents/commands`（roots.ts:94-105，**同级双目录合并而非 fallback**，先扫 .drora） | source="drora"/"agents"，scope="user" | 次之 |
| L4 项目文件 | `<workdir>/.drora/commands` 与 `<workdir>/.agents/commands`，向上找到 git worktree 根的每一级都有（roots.ts:49-54, 61-83） | scope="project" | 再次 |
| L5 插件贡献 | `resolveDroraPlugins().commandRoots`（`bootstrap/src/custom-commands.ts:81-92` → `adapters/src/plugins/index.ts:109,178,195,323`） | source="plugin"，scope=system(official)/user | 最后 |

遮蔽规则（`adapters/src/commands/index.ts:61-83`）：roots 按 priority 升序扫描（每 root +10），**同名"先到先赢"**，后到者记 `custom_command_duplicate_name` warning —— 即 L2 > L3 > L4 > L5。另有 config `command.<path>.enable=false` 禁用名单（index.ts:36-38, 69；`bootstrap/src/skill-command-overrides.ts` 收集）。
保留名兜底：App 协议目录（slash-commands.ts:53）与 App facade 展开（custom-command-prompt.ts:33）都会拒绝保留名自定义命令，防止同名绕过内置语义/灰度门。
兼容路径：文件命令只认 `.drora/commands` 与 `.agents/commands`；**不读 `.claude/commands`**。`.claude-plugin/plugin.json`、`.zcode-plugin/plugin.json` 仅作为插件 manifest 兼容（`adapters/src/plugins/index.ts:71-72`、`adapters/src/skills/index.ts:31-32`）。

---

## 3. 文件定义命令：frontmatter 与模板变量

### 3.1 发现与解析（`adapters/src/commands/index.ts`）

- 只扫 `.md`（:21），递归深度 ≤12（:25），目录名折叠为命令名 `dir:sub:name`（:270-274），名字模式 `^[a-z0-9][a-z0-9_:-]{0,63}$`（:22）。
- frontmatter 白键：`allowed-tools / argument-hint / description / disable-noninteractive / model / skills`（:26-33）；未知键 → warning `custom_command_unknown_frontmatter`（:194-203）。
- 扁平 YAML 逐行解析（:303-332），支持引号标量、`[a, b]` 列表、true/yes 布尔；description 缺省时取正文首个非空行（:362-368）；正文与 frontmatter 剥离（:280-297）；上限 100KB 截断读（:23, 111-124）。

### 3.2 模板展开（两条路径）

- contracts 通用展开 `expandCustomCommandPrompt`（`contracts/src/commands/index.ts:118-136`）：`$ARGUMENTS` 整体替换（:114,145）、`$1..$n` 位置参数（:113,146-150，带引号/转义的 split :191-232）、无占位符时尾部追加 `User arguments:` 块（:152-154）、正文前置 `Run custom command /x.` + `Required skills:` 前言（:163-189）。**`!`command`` 内联与 ```! 围栏 shell 语法默认抛错"not available yet"**（:234-239）。
- App facade 路径支持 shell 展开：`bootstrap/src/custom-command-prompt.ts:42-69` 在 template 与 format 之间插入 `expandCustomCommandShellSyntax`（`bootstrap/src/custom-command-shell-expansion.ts:16-40`，30s 超时/128KB 输出上限，上下文变量兼容 `CLAUDE_*` 与 `DRORA_*`/`ZCODE_*` 两套键，:15-17）。
- CLI（TUI/headless command-center）路径**不支持** shell 展开（`cli/src/custom-command-expand.ts:26-30` 重复实现同一展开、遇 `!` 语法抛错）。

---

## 4. CLI 子命令树（dist/drora.cjs 源码 = packages/cli）

入口 `packages/cli/src/main.ts:17` → `run.ts:301 run()`。`bin: drora → dist/drora.cjs`（package.json:7-9）。

- 预 parseArgs 特殊调用（run.ts:302-329）：`__internal-search`、plugin-host、plugin-hook、dwf 子进程 re-exec、`hooks`。
- 主 switch（run.ts:560-617）：`help`、`version`、`agent-server`、`app-server`、`doctor`、`login`、`logout`、`commands`、`plugin`/`plugins`、`skills`、`tui`（无 positional 时默认 tui，run.ts:71）；default 报 Unknown command。
- 非 positional 路径：`--prompt`/`--target`（headless 单轮，run.ts:526-558）。
- `commands` 子命令：`commands list` / `commands inspect <name>`（`cli/src/commands-command.ts:30-49`，走 bootstrap `listDroraCustomCommands`，仅文件命令，不含内置）。
- 官方对照：官方树 `tui/help/version/app-server/agent-server/doctor/login/logout/commands/plugins/skills` 我方**全部在列**；我方多出 `hooks`、`__internal-search` 及内部前缀调用（plugin-host/plugin-hook/dwf-child）。
- CLI 顶层帮助文案（含 Slash Commands 段）在 `i18n/src/locales/en-US.ts:10-71`、`zh-CN.ts` 同构。

---

## 5. /team 白名单 + 装配事实门（f7c0e4c3）

提交 f7c0e4c3（2026-10-18，5 文件 +26/-3）。机制三层：

1. **白名单层**：`slash-command-surface.ts:8-14` 白名单加入 `team`（紧随 workflow）。根因：App `/` 面板只消费该白名单，此前 C1 只加了 shared 帮助表（保留字/分发生效）而没进白名单 → App 实例看不到 /team。
2. **目录门**：`drora-protocol/slash-commands.ts:21-26,38` 新增 `agentsTeamEnabled?: boolean` 选项，**只有显式 false 才剔除** `team`（与 dynamicWorkflow 同语义；缺席即保留，TUI/未参与灰度的调用方不受影响）。
3. **装配事实门**（三装配点一致）：
   - `v4-workspace-config.ts:55-57`、`workspace-model-runtime.ts:31-38`、`session-mapper.ts`（f7c0e4c3 在此引入 import）：门 = `getInstalledTeamHub(leadSessionId) !== undefined` —— hub 注册表即有效门，settings/env 裁决收敛在 create-app 装配门单一出处（`app/create-app.ts:184-186` 读 `config.agentsTeam?.enabled`，:798-804 经 `resolveAgentsTeamEnabled` 决定是否创建 registry，:896-906 `installDroraAgentsTeam` 装配并登记 hub）。
   - 展开门：`bootstrap/src/builtin-prompt-command.ts:72-83` `/team` 命中时再经 `resolveAgentsTeamEnabled()`（`app/drora-team/install.ts:47`，显式 settings 值优先于 env `DRORA_AGENTS_TEAM=1`）。
4. **命令本体**：`bootstrap/src/builtin-team-command.ts` —— 代码定义的 prompt 型内置命令（照 `/workflow` 体例，`builtin-workflow-command.ts` 同构）：名字进 shared 帮助表保留字，正文复用 contracts 展开（`$ARGUMENTS` + `skills:` 前言，指向 `agents-team` 技能，`packages/bundled-skills/skills/agents-team/SKILL.md`）；不挂插件（2026-09-19 插件卸载连带命令消失的事故教训）。
5. **UI 双入口**：`packages/ui/src/prompt-editor/ChatPromptActionMenu.tsx:30-34` 加号菜单 team 图标，:227-246 出现条件 = CLI catalog（slashCommands 数组）里存在 team；`SlashCommandPlugin.tsx` `/` 面板同吃 catalog。

---

## 6. 命令执行链路

### 6.1 TUI（进程内直连，无 RPC）

```
用户输入 /xxx
→ tui app-input → submitPrompt = createTuiSubmitPrompt (cli/src/tui-prompt-handler.ts:312)
→ commandCenter (cli/src/command-center/create.ts:39)
  ├─ 非 slash → app.submitPrompt（login-required 门 :48-57）
  ├─ known 命令 → 本地处理：help/login/logout/locale/resume/new/mode/model/effort/
  │   mcp/plugins/skill/goal/expert/dwf/fork/rewind 直接产出 selection/response；
  │   compact/init/workflow 原文回交 app.submitPrompt（create.ts:208-234），
  │   由 bootstrap 的 builtin resolver 展开
  └─ unknown → handleCustomCommand（handlers/custom.ts:8-19）
      → buildCustomCommandPrompt（command-center-custom.ts:60-83）
      → deps.loadCustomCommand = inspectDroraCustomCommand（文件适配器，tui-prompt-handler.ts:277）
      → 找不到 → "Unknown command: /x. Available commands: …"（create.ts:64-77）
→ app.submitPrompt（bootstrap/app/create-app.ts:918-953 的 inputFacade）
  → customCommandPromptResolver（input-facade.ts:114,152 在 submitPrompt/sendInput 两个入口调用）
     ① resolveDroraBuiltinPromptCommandInvocation：init/workflow/team（builtin-prompt-command.ts:41-97；
        workflow 关门返回 undefined；workflow 命中时顺带 activateDynamicWorkflowTools，create-app.ts:930-938）
     ② resolveDroraCustomCommandPrompt：保留名直接拒绝（custom-command-prompt.ts:31-35），
        loadDroraCustomCommand → contracts 展开 →（有 executionPort 时）shell 展开
→ AgentRuntime.executeTurn（权限经 options.requestPermission / permissionBroker，模型收到的即展开后 prompt）
```

TUI 启动时候选注入：`tui-command.ts:70-85` `runTui({ slashCommands: listSlashCommandSuggestions(customCommands, {workflowMode}) })` —— 进程内直调，不经过 RPC。

### 6.2 headless（--prompt）

`cli/src/prompt-command.ts:87-127`：help/workflow(禁门)/skill(无参→skills list)/login/logout 本地拦截；其余建 app 后提交原文，`routesToPromptCommandCenter`（:488-500）决定 expert/goal 与可解析自定义命令走 command-center、其余走普通 prompt（facade 展开）。保留名判据与 facade 逐字一致（:506-521，防 `/compress` 之类被静默当普通文本发给模型）。

### 6.3 App（desktop/web，经 Drora Protocol RPC）

- **目录**：UI `useSlashCommands`（packages/ui/src/hooks/useSlashCommands.ts:8-12）读 workspace store；写入方为 `useDraftConfigControl.ts:366-392` / `useWorkspaceSessionReload.ts:118-127` / `remotePluginSyncRefresh.ts:61`，数据来自 `IDroraSessionService.readWorkspacePresentation` RPC（hooks/workspacePrepareRpc.ts:19-76）→ Host `workspace-model-runtime.ts:28 readWorkspacePresentation` → `listProtocolSlashCommands`；session 快照（session/read → session-mapper.ts:129）同样携带。**UI 不本地发现命令，一律以 Host catalog 为权威。**
- **执行**：UI 把 `/team …` 等作为普通用户消息经协议发送 → Host app facade（同 6.1 的 inputFacade resolver）在会话所在进程展开。权限经既有 requestPermission/permissionBroker 链，命令本身无独立权限模型（仅 `allowed-tools` 元数据随 metadata 传递）。

### 6.4 插件贡献命令

插件 manifest `commands` 字段两种形态（adapters/src/plugins/index.ts:644-700, 323）：目录路径列表（含默认 `<pluginRoot>/commands` 自动发现）或对象映射（inline content 物化到 `<dataPath>/generated-commands` 再作为 root），root 标 source="plugin"；禁用插件经 `resolveDroraPlugins` 不产出 roots。

---

## 7. 与官方可能的结构性差异（仅观察）

1. **/team 在 TUI 的解析缺口**：shared 帮助表（=TUI 候选唯一出处）含 `team`，TUI 斜杠面板会建议 /team；但 `cli/src/command-center/slash-commands.ts` 的 `parseSlashCommand` 无 team 分支，`packages/cli/src` 全目录 grep 无 "team" 字面量 → TUI 提交 /team 走 unknown → 文件适配器找不到 → 本地报 "Unknown command"。/team 目前实际生效面是 App facade（builtin-prompt-command）与 headless --prompt 路径。App-only 的 `/plan` 与 extra 保留字 `compress` 在官方命令面中的对位待差分确认。
2. **双层实现**：contracts 通用展开与 `cli/src/custom-command-expand.ts` 是两份近似重复实现（后者不支持 shell 展开、无 skills 之外差异），TUI 本地展开与 facade 展开结果在 shell 语法场景会分叉。
3. **命令名遮蔽方向**：我方 roots 顺序为 extra roots > user > project > plugin（先到先赢），与常见"项目覆盖用户"的约定方向相反，差分时注意官方 priority 语义。
4. **保留字表**：我方保留字 = 21 条帮助表 name+aliases + `compress`/`plan`；官方保留字集合与拒绝文案（"uses unsupported shell expansion" 等）需逐字对照。
5. **`/login` 参数族**：我方 usage 为 `zai-coding-plan|bigmodel-coding-plan|*-api-key` 四变体（帮助表 :26-29），与官方 `/login [zai|bigmodel]` 描述（i18n 顶层帮助 :21）存在两套表述。
6. **帮助表条目数**：我方 21 条内置 + App-only `plan`；官方 3.15.x 的 slash 命令集合（如 `/output-style`、`/add-dir`、`/agents` 等是否在列）待 batch1 官方清单到位后差分。
7. **文件根目录**：我方读 `.drora/commands` + `.agents/commands` 双根；未观察到 `.claude/commands`/`.zcode/commands` 兼容（仅插件 manifest 兼容 `.claude-plugin`/`.zcode-plugin`）。

---

## 附：关键文件索引

- 帮助表/保留字唯一出处：`packages/shared/src/drora-slash-command-help.ts:9`
- App 白名单/App-only/保留字：`apps/drora-cli/packages/bootstrap/src/slash-command-surface.ts:8,17,26`
- 协议目录聚合：`apps/drora-cli/packages/bootstrap/src/drora-protocol/slash-commands.ts:29`
- 三装配点：`.../drora-protocol/session-mapper.ts:129`、`v4-workspace-config.ts:52`、`workspace-model-runtime.ts:28`
- 内置 prompt 命令：`.../bootstrap/src/builtin-prompt-command.ts:34`、`builtin-workflow-command.ts`、`builtin-team-command.ts`
- 自定义命令发现/解析：`apps/drora-cli/packages/adapters/src/commands/index.ts:41`、`roots.ts:20`
- 展开：`apps/drora-cli/packages/contracts/src/commands/index.ts:118`；shell：`.../bootstrap/src/custom-command-shell-expansion.ts:16`
- facade 接线：`.../bootstrap/src/app/create-app.ts:918-953`、`app/input-facade.ts:114,152`
- TUI 解析/分发：`apps/drora-cli/packages/cli/src/command-center/slash-commands.ts:40`、`command-center/create.ts:39`
- headless 路由：`apps/drora-cli/packages/cli/src/prompt-command.ts:87,488`
- CLI 子命令：`apps/drora-cli/packages/cli/src/run.ts:560-617`、入口 `main.ts:17`
- team 门：`.../bootstrap/src/app/drora-team/install.ts:47,68`、`app/create-app.ts:798-806`
- UI 消费：`packages/ui/src/hooks/useSlashCommands.ts:8`、`hooks/workspacePrepareRpc.ts:19`、`prompt-editor/ChatPromptActionMenu.tsx:30-34,227-246`
- 插件命令根：`apps/drora-cli/packages/adapters/src/plugins/index.ts:644-700`
