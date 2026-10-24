# Batch 1：官方 bundle `D:/software/zcode/resources/glm/zcode.cjs` 宏观解剖

> 调研日期：2026-10-19。本报告为后续逐域批次（命令、工具、权限、会话、扩展、协议）提供地图，所有计数均为一次性测量，后续 agent 直接引用，不必重跑。
> 目标文件：`D:/software/zcode/resources/glm/zcode.cjs`（Git Bash 路径 `/d/software/zcode/resources/glm/zcode.cjs`，下文以 `$f` 指代）。
> 注意：本机 Git Bash 的默认 grep 是 ugrep，`.{700}` 以上大窗口正则可能报复杂度错误；大上下文请用 `grep -boF` 取字节偏移 + `tail -c +OFF | head -c N` 截取。

## 1. 基本统计

命令：
```bash
wc -lc "$f"
awk '{ if (length($0)>m) m=length($0); i++ } END { print "longest_line="m, "lines="i }' "$f"
```

结果：
- 字节数：**15,127,039**（15.1 MB）
- 行数：**15,647**
- 最长行：**1,914,226 字符**（esbuild 单行超长；grep 该文件必须 `-o` + head 限量）
- 文件头：`#!/usr/bin/env node` + `"use strict"`，esbuild CJS 打包产物

## 2. 模块结构

命令与结果：

| 模式 | 命令 | 计数 | 含义 |
| --- | --- | --- | --- |
| lazy 初始化器 | `grep -o '=J(()=>{' \| wc -l` | **2,056** | `KKe=J(()=>{...})` 惰性模块块，每个约对应一个源模块 |
| CJS 包装器定义 | `grep -o 'At=(e,t)=>' \| wc -l` | 1 | `At=(e,t)=>()=>(t\|\|e((t={exports:{}}).exports,t),t.exports)` |
| CJS 包装器使用 | `grep -o '=At((' \| wc -l` | **223** | `Rrr=At((Mbc,Xz)=>{...})` 形态的 CommonJS 依赖（node_modules 三方库，如 dotenvx） |
| 函数名保留标签 | `grep -oE '\br\([A-Za-z0-9_$]+,"' \| wc -l` | **21,154** | `r(fn,"name")` 调用，原函数名全部保留——**这是后续按名 grep 的最大资产** |

估算模块总数：自研/主代码模块约 **2,000+**（lazy init 块），另含 **223 个** esbuild CJS 包装的三方依赖模块。

基础设施（文件头 8000 字符内确认）：
- `J=(e,t)=>()=>(e&&(t=e(e=0)),t)` — lazy 初始化器
- `r=(e,t)=>pPe(e,"name",{value:t,configurable:!0})` — 函数命名
- `$0=(e,t)=>{...}` / `grr` / `vi` / `Jc` — ESM 互操作助手

## 3. 入口与 CLI 子命令

### 3.1 parseArgs 全量 flags（`parseGlobalArgs`，`strict:!0, allowPositionals:!0`）

从 `head -c 8000` 提取，`node:util.parseArgs` options：

| flag | 短参 | 类型 |
| --- | --- | --- |
| help | -h | boolean |
| json | | boolean |
| output-format | | string |
| no-color | | boolean |
| no-browser | | boolean |
| browser-use | | string |
| browser-executable | | string |
| prompt | -p | string |
| memory-bench | | boolean |
| attach | | string, multiple |
| cwd | | string |
| locale | | string |
| resume | | string |
| target | | string |
| target-replace | | boolean |
| continue | -c | boolean |
| force | -f | boolean |
| force-mcs | | boolean |
| mode | | string |
| verbose | | boolean |
| version | -v | boolean |
| prepare-storage | | boolean |
| stdio | | boolean |
| surface | | string |
| workflow-mode | | string |
| all | -a | boolean |
| available | | boolean |
| keep-data | | boolean |
| scope | -s | string |
| sparse | | string, multiple |

另有独立参数预处理：`--disallowedTools` / `--disallowed-tools`（支持 `=` 形式、空格分隔多值、`(...)` 分组、逗号/空格分隔的 tool rule；`web_search` 会归一化为 `WebSearch`）。

### 3.2 主分发 switch（字节偏移 15114859 附近提取）

```js
switch(xAt(n.positionals)){        // xAt = e[0] ?? "tui"
  case"help":    kAt(e.stdout,I.locale,I.detectedLocale),0
  case"version": 输出版本号
  case"agent-server":
  case"app-server": _bc(..., n.values["prepare-storage"]===!0)
  case"doctor":  gbc(e,I,U)
  case"login":   tAt(..., n.values["no-browser"]===!0, positionals.slice(1))
  case"logout":  nAt(e,I,j)
  case"commands":Odi(e,I,j,positionals.slice(1))
  case"plugin": case"plugins": Ofi(..., positionals.slice(1), sbc(n.values))
  case"skills":  _At(..., positionals.slice(1))
  case"tui":     Cmi(...)
  default:       "Unknown command" + help, exit 1
}
```

- **默认子命令是 `tui`**（`(t.positionals[0]??"tui")==="tui"`，`isTuiInvocation`）。
- `-p prompt` / `-t target` / `--resume` 存在时绕过 switch 直接进入单次 prompt 执行 `V4n`（`isPresentationSurfaceSupportedInvocation`）。
- `process.argv` 含 `app-server`/`agent-server` 时 `Clc()` 返回 surface `"electron"`，否则 `"cli"`。

### 3.3 全部 CLI 子命令清单（含二级）

一级：`tui`（默认）、`help`、`version`、`app-server`、`agent-server`、`doctor`、`login`、`logout`、`commands`、`plugin`/`plugins`、`skills`。

二级：
- `zcode login [zai|bigmodel] [--no-browser]`（默认 provider `zai`；其余报 `Usage: zcode login [zai|bigmodel]`）
- `zcode commands [list|inspect <name>]`（默认 `list`）
- `zcode plugins list|install|uninstall|enable|disable|update|validate|marketplace`
  - `plugins marketplace add|list|remove|update`（add 支持 `--sparse`）
- `zcode skills [list|inspect <name>]`

依赖注入 RPC 方法名线索（`resolveDep(n,"Xxx")`）：`listPlugins`、`addMarketplace`、`removeMarketplace`、`updateMarketplace`、`getPluginsOverview`、`updateZCodePluginMarketplace`、`updateZCodeMarketplacePlugin`、`validateZCodePluginPath`、`loginZCodeCli`。

### 3.4 进程形态线索

- bundled runtime 二进制描述符（head 8000 后段）：`{ binaryEnvVar:"GLM_BINARY_PATH", bundledResourceDir:"glm", version:"0.13.3", spawnArgs:["app-server","--stdio"], nativeConfigDir:".zcode/cli", nativeConfigFileName:"config.json" }`
- 其他 bundled 资源目录：`bundledResourceDir:"bfs"`、`"ripgrep"`、`"ugrep"`；对应 env：`ZCODE_BFS_BINARY`、`ZCODE_RG_BINARY`、`ZCODE_UGREP_BINARY`
- 协议名：`zet="ZCode Protocol"`；`ZCODE_PROTOCOL_V4_WIRE_VERSION` 存在（值为间接引用）
- appVersion 值散布："0.11.0"、"0.13.0"、"0.14.0"、"0.15.0"、"0.15.2"（各依赖/服务各自声明）

## 4. 关键域字符串计数

### 4.1 内置工具名（`grep -o "\"<Name>\"" | wc -l`，精确引号匹配）

| 工具名 | 计数 | 工具名 | 计数 |
| --- | --- | --- | --- |
| "Bash" | 38 | "TodoWrite" | 12 |
| "Read" | 32 | "WebSearch" | 16 |
| "Edit" | 20 | "Skill" | 16 |
| "Write" | 19 | "Grep" | 15 |
| "Agent" | 21 | "Glob" | 14 |
| "WebFetch" | 12 | "Task" | 6 |
| "AskUserQuestion" | 6 | "EnterPlanMode" | 3 |
| "ExitPlanMode" | 4 | "NotebookEdit" | 1 |
| "BashOutput" | 1 | "KillShell" | 1 |
| "MultiEdit" | **0** | "SlashCommand" | **0** |

要点：官方以 **"Agent"** 为主（21 次），"Task" 仅 6 次；`web_search` 归一化为 `WebSearch`（CLI 入口可见）。无 MultiEdit/SlashCommand。

### 4.2 斜杠命令

`grep -o '"/[a-z][a-z0-9-]*"'` 命中的多为 URL 路径（/compact 10 次等是 API 路径混淆源，勿直接当命令表）。**真正的内置命令表**用 `name+summary` 形态存储：

命令：`grep -oE 'name:"[a-z][a-z0-9-]*",summary:"' | sort | uniq -c`

**内置 TUI 斜杠命令全表（20 个，各恰好 1 次，`usage:"/xxx"` 一一对应）**：
`workflow, skill, rewind, resume, plugins, new, model, mode, mcp, logout, login, locale, init, help, goal, fork, expert, effort, dwf, compact`

补充：
- `parseSlashCommand` 对 `compact`、`expert` 有 special-case（type:"known"）。
- `/login zai-coding-plan` 作为建议项硬编码（`items:[{command:"/login zai-coding-plan",id:"zai-coding-plan",...}]`）。
- skills 以 `/skillName` 动态注册（`buildManualSkillPrompt`、`parseSkillCommandArgs`）。
- 帮助聚合 env：`ZCODE_SLASH_COMMAND_HELP_ENTRIES`。
- 命令解析类型：`SlashCommandName`、`SlashCommandHelpEntry`、`SlashCommandSchema`、`listAvailableCommandNames`、`listSlashCommandSuggestions`。

### 4.3 env 键族

**`ZCODE_` 前缀共 162 个 distinct 键**（`grep -oE 'ZCODE_[A-Z_0-9]+' | sort -u`）。重要提醒：BRE 下 `+` 必须写 `\+`，否则误报 0。DRORA_ 前缀出现 **0 次**（符合预期：Drora 改名层不在官方 bundle）。

全表（按字母序，162 个）：
```
ZCODE_ACTIVE_STREAMING_TOOL_INPUT_EAGER_DELTA_COUNT
ZCODE_ACTIVE_STREAMING_TOOL_INPUT_PREVIEW_MIN_INTERVAL_MS
ZCODE_ACTIVE_STREAMING_TOOL_INPUT_PREVIEW_MIN_RAW_GROWTH
ZCODE_ACTIVE_STREAMING_TOOL_INPUT_TIME_BUDGET_MAX_RAW_INPUT
ZCODE_AGENT_CA_CERT / _ENV_KEY
ZCODE_AGENT_LIFECYCLE_LOG_MARKER
ZCODE_AGENT_PROVIDER / _LABEL / _NOT_READY(+_CODE/_REASON) / ZCODE_AGENT_RUNTIME / ZCODE_AGENT_WORKDIR
ZCODE_APP_VERSION(+_ENV)
ZCODE_ARMS_RUM_ENDPOINT(+__)
ZCODE_AUTO_UPDATE_ENABLED(+__)
ZCODE_BASE_URL / _PRODUCTION_BASE_URL / _TEST_BASE_URL
ZCODE_BETA
ZCODE_BFS_BINARY
ZCODE_BUILD_COMMIT_ID(+_ENV) / ZCODE_BUILD_TIME(+) / ZCODE_COMMIT(+)
ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE / _CONFIG_ASSET_KEY / _CONFIG_FILE
ZCODE_CLI_RESOURCE_SAMPLE_INTERVAL_MS
ZCODE_COMMAND_AGENT_SOURCE / _SOURCES
ZCODE_CREDENTIAL_DECRYPT_FAILED / ZCODE_CREDENTIAL_SECRET
ZCODE_CUA_BROKER_SOCKET_ENV_KEY / ZCODE_CUA_DEV_MODE(+_ENV_KEY)
ZCODE_CUA_NODE_REPL_HOST(+_ENV_KEY) / ZCODE_CUA_OFFICIAL_MCP_NAMESPACE_NAME / ZCODE_CUA_OFFICIAL_PLUGIN_ID
ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER / _SOCKET / _TOKEN
ZCODE_CUA_PLUGIN_AUTHORITY(+_ENV_KEY) / ZCODE_CUA_PLUGIN_ROOT / ZCODE_CUA_PRODUCT_HELPER(+_ENV_KEY)
ZCODE_DATA_BASE_DIR / ZCODE_DEBUG
ZCODE_DEPS_BASE_URL
ZCODE_DESKTOP_CONTEXT_PROMPT_ENABLED(+_ENV)
ZCODE_DYNAMIC_WORKFLOW_MODE(+_ENV)
ZCODE_E2E_ASK_USER_QUESTION_CLOCK_SCALE / _COVERAGE / _FS_FAULTS(+_ALLOW) / _RUN_ID / _STORE_BRIDGE
ZCODE_EMBEDDED_SEARCH_COMMAND
ZCODE_ENABLED_AGENT_PROVIDERS
ZCODE_ENDPOINT_ORIGIN / ZCODE_ENV(+)
ZCODE_FILE_LOCK_TIMEOUT(+_ERROR_CODE)
ZCODE_FILE_STREAMING_TOOL_INPUT_PREVIEW_MIN_INTERVAL_MS
ZCODE_GEN_UI_OUTPUT_ROOT
ZCODE_GIT_BINARY
ZCODE_HOME / ZCODE_HTTP_PROXY(+_ENV_KEY) / ZCODE_NO_PROXY(+_ENV_KEY)
ZCODE_JWT_INVALID_BROADCAST_CHANNEL
ZCODE_KNOWN_TOOL_NAMES
ZCODE_LOG_CONSOLE / ZCODE_LOG_DIR
ZCODE_MAILBOX_ROOT
ZCODE_MCP_RESOURCE_SAMPLE_INTERVAL_MS
ZCODE_MESSAGE_ENABLED
ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY / _REASONING_SEPARATOR / _RETRY_BACKOFF_FACTOR / _RETRY_BASE_DELAY_MS / _RETRY_MAX_DELAY_MS / _RETRY_MAX_RETRIES / _TELEMETRY_ENABLED
ZCODE_NODE_REPL_BROWSER_BROKER_SOCKET / _TOKEN
ZCODE_OFFICIAL_MCP_AUTH_PROVIDER_JWT_TOKEN / _AUTH_TYPE / _DEV_TRUSTED_ORIGINS
ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID
ZCODE_PERSONAL_PROVIDER_CONFIG_FILE
ZCODE_PLUGIN_DATA / _ID(+_ENV_KEY) / _NAME / _ROOT / _SEED_INCOMPLETE / _SEED_LOCK_TIMEOUT
ZCODE_PROCESS_DIAGNOSTIC_{MAX_LINE_CHARS,MESSAGE_MAX_CHARS,NAME_MAX_CHARS,PREFIX,STACK_MAX_CHARS}
ZCODE_PRODUCT_FLAVOR(+)
ZCODE_PROJECT_DIR
ZCODE_PROTOCOL_NAME / _PROTOCOL_V4_WIRE_VERSION / _PROTOCOL_VERSION
ZCODE_PROVIDER_OPTIONS
ZCODE_REMOTE_{HTTP_PROXY,NO_PROXY}(_ENV_KEY) / ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY(+_ENV_KEY)
ZCODE_RG_BINARY / ZCODE_UGREP_BINARY
ZCODE_RPC_CLIENT_MODE_HEADER / _RPC_HOST_CAPABILITY_HEADER
ZCODE_RUNTIME_ENV(+_KEY)
ZCODE_SERVICE_AUTHORITY_MODE
ZCODE_SESSION_ID
ZCODE_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS
ZCODE_SHELL_INIT_SNAPSHOT
ZCODE_SKILL_DIR
ZCODE_SLASH_COMMAND_HELP_ENTRIES
ZCODE_SOURCE_HEADERS
ZCODE_STORAGE_DIR
ZCODE_TELEMETRY_ (前缀拼接形态) / _DEVICE_MID / _IDENTITY_STATE / _REPORT_ENDPOINT(+) / _RUNTIME_DISTRIBUTION / _RUNTIME_SURFACE / _USER_ID / _USER_ID_HASH / _USER_SUBJECT_ID
ZCODE_TOOL_ENV_PASSTHROUGH_ENV_KEY / _JSON
ZCODE_UNSUPPORTED_HTTP_STATUS
ZCODE_VERSION(+)
ZCODE_WINDOWS_OUTPUT_ENCODING
ZCODE_WORKFLOWS_FOR_RUN_MAX_CANDIDATES / ZCODE_WORKFLOWS_RUNS_MAX_LIMIT
ZCODE_WORKSPACE_IDENTITY(+_ENV)
```

其他前缀 distinct 清单：
- `CLAUDE_`（7 个）：CLAUDE_CODE_SESSION_ID、CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID、CLAUDE_PLUGIN_DATA、CLAUDE_PLUGIN_ROOT、CLAUDE_PROJECT_DIR、CLAUDE_SESSION_ID、CLAUDE_SKILL_DIR（兼容别名层）
- `ZAI_`（11 个）：ZAI_BUSINESS_BASE_URL、ZAI_OAUTH_APP_ID、ZAI_OAUTH_CLIENT_ID、ZAI_OAUTH_ORIGIN、ZAI_PRODUCTION_*、ZAI_TEST_*、ZAI_PROVIDER_ID
- 其他：GLM_BINARY_PATH、ANTHROPIC_*（3）、MCP_*（22 处）、DOTENV_*（dotenvx 库）

### 4.4 _meta 键族

- `grep -o '"_meta[A-Za-z0-9_.-]*"'`：仅 `"_meta"` 1 次、`"_metadata"` 1 次。
- `_meta.prop` 访问形态：0 次。
- `"_meta"` 上下文是 zod issue path join 的 fallback 字符串，非 wire 协议 `_meta` 键族。**结论：官方 bundle 内没有 Drora 式 `_meta.xxx` 契约键族**；后续协议批次应从 `packages/shared/src/drora-protocol` 的自研键出发做差分，而不是在 bundle 里找同形键。

### 4.5 权限模式（精确引号计数）

| 字符串 | 计数 |
| --- | --- |
| "default" | 274（含大量非权限语境，需按域甄别） |
| "plan" | 58（同样混入普通词） |
| "acceptEdits" | 6 |
| "bypassPermissions" | 6 |
| "dontAsk" | 6 |
| "dangerouslySkipPermissions" | **0**（该词只在 CLI flag 层，bundle 内为 0，注意别在 bundle 里找） |

相关高密度标识：`permission` 626 次、`permissionMode` 16、`permissionDecision` 12、`allowedTools` 100、`disallowedTools` 37。

## 5. 顶层模块命名线索（Drora 概念在官方 bundle 的对应）

| 关键词（大小写不敏感计数） | 计数 | 判断 |
| --- | --- | --- |
| workspaceIdentity | 296 | **官方已有同名概念**（ZCODE_WORKSPACE_IDENTITY env + 大量引用） |
| CommandInbox | 6 | **官方已有同名概念** |
| lease | 668 / owner | 234 | 高密度，owner/lease 机制为官方原生 |
| admission | 224 / replay | 107 / snapshot | 1253 | 高密度 |
| relay | 35 / hostAttachment | 1 | relay 中密度；hostAttachment 几乎不存在（疑似 Drora 自研概念） |
| busy | 43 / running | 441 | 需按域甄别 |

`process.env.X` 直接属性访问 top：LOCALAPPDATA(4)、DEBUG(4)、NODE_ENV(3)、DOTENV_KEY(3)、ZCODE_E2E_COVERAGE(2)、ZCODE_GIT_BINARY、ZCODE_DEBUG 等。

## 6. 其他版本指纹

- bundled glm runtime：version **"0.13.3"**，`spawnArgs:["app-server","--stdio"]`
- CLI 进程 title：`xrr="zcode"`、`v$t="zcode-cli"`（`setCliProcessTitle`）
- `VERSION="2.6.1"` 出现 2 次（疑似某内嵌依赖版本）；`version:"4.0.1"` 1 次
- 文件含 dotenvx（加密 .env）、 embedded search（ripgrep/ugrep/bfs 打包）、SEA asset 支持（`e.sea?.isSea()`）

## 7. 对后续批次的建议

1. **函数名是最大杠杆**：21,154 个 `r(fn,"name")` 保留原名，任何域调研先 `grep -oE 'r\([A-Za-z0-9_$]+,"<Domain>"'` 或直接按业务名 grep（如 `runSkillsCommand`、`parseSlashCommand`、`isTuiInvocation` 这类完整驼峰名都能命中）。
2. **高密度域（优先批）**：permission（626）、snapshot（1253）、lease（668）、workspaceIdentity（296）、admission（224）、allowedTools（100）。建议 grep 模式：`[a-zA-Z]*[Pp]ermission[A-Za-z]*`、`workspaceIdentity` 上下文窗口。
3. **命令批次**：以 §3.2 dispatch switch 与 §4.3 ZCODE_ 全表为底册；二级子命令处理函数名（`Ofi`/`_At`/`Odi`/`Rfi`/`tAt`）可作为窗口锚点（用 `grep -boF 'async function Ofi'` 定位再截窗口）。
4. **协议批次**：`"ZCode Protocol"`、`ZCODE_PROTOCOL_V4_WIRE_VERSION`、`ZCODE_RPC_CLIENT_MODE_HEADER`、`ZCODE_RPC_HOST_CAPABILITY_HEADER`、`spawnArgs:["app-server","--stdio"]` 是入口锚；官方无 `_meta.*` 键族，Drora 的 `_meta` 契约属自研层。
5. **陷阱**：① BRE `+` 要写 `\+` 或用 `-E`；② ugrep 大窗口 `.{N>600}` 会报复杂度错误，改字节偏移法；③ `"/xxx"` 形态多为 URL 路径，斜杠命令表看 `name:"x",summary:"` 形态；④ `"default"`/`"plan"` 是高频普通词，权限批次必须带上下文甄别。
