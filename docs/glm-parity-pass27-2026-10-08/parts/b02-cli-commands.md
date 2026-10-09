# B2 · CLI 命令面静态对拍（pass27 · 2026-10-08）

- 真值：`D:\software\zcode\resources\glm\zcode.cjs`（0.16.9，14,820,819 字节单行 CJS）
- 我方：`D:\workspace\projects\Drora`（feat/migrate-remote-and-pet，freshness 基线通过）
- 方法：grep 明文字面量 + 字节偏移窗口截取，双策略交叉；我方逐文件比对。

## §1 真值命令全集

### 1.1 CLI 顶层子命令（可见，switch 分发于 ~14806140）

| 子命令 | usage 证据（偏移） | 别名 |
| --- | --- | --- |
| help | `case"help"` | - |
| version | `case"version"` | - |
| app-server / agent-server | 14806190 区域 | - |
| doctor | `runDoctor` | - |
| login | `runLoginCommand`，无 provider 位置参数 | - |
| logout | `runLogoutCommand` | - |
| commands | `Usage: zcode commands [list\|inspect <name>]`（14698483） | - |
| plugins | `Usage: zcode plugins <command>`（14773987），11 子块 | plugin |
| skills | `Usage: zcode skills [list\|inspect <name>]`（14749126） | - |
| tui | `zTt=e[0]??"tui"`（默认值） | - |
| hooks trust | status/review/grant/revoke（$Xo usage，~14689700） | - |

无 positional 且无 -p 时：默认 tui；未知 positional 报 `Unknown command:` + help 退出 1。

### 1.2 隐藏命令（真值全集恰 3 个）

| 命令 | 证据偏移 | 用途 |
| --- | --- | --- |
| `__internal-search` | 13874306、14804987 | embedded find/grep 后端自 spawn |
| `__zcode-plugin-host` | 14035（常量 xde） | plugin MCP server 宿主 |
| `__zcode-dwf-child` | 14061（常量 jCe） | dwf 沙箱子进程，`<entry path>` |

排除项：`__zcode_default_reasoning__`（reasoning 块标记）、`__workflowScript__`（生成脚本函数名）非命令。

### 1.3 REPL slash 命令（parseSlashCommand 于 ~14727500，20 正名 + 8 别名）

help；login；logout；compact；init；expert；effort(variant)；dwf；fork；locale(language)；mcp；plugins(plugin)；mode；model；new(clear)；resume(continue)；rewind；skill；goal(target)；workflow。
help 表 20 条（~884800–891000），usage/summary 与名字面一致。

## §2 我方全集

- CLI 子命令：`run.ts:530-586` switch 与真值逐 case 同构（help/version/agent-server/app-server/doctor/login/logout/commands/plugin+plugins/skills/tui/default）。前置：`__internal-search`（run.ts:290）、plugin-host（299）、dwf-child（305）、hooks（309）。
- 隐藏命令：`__internal-search`（同名）；`__drora-plugin-host`、`__drora-dwf-child`（contracts/src/plugins/index.ts:14,25，zcode→drora 改名，链路内自洽）。
- slash 命令：`packages/shared/src/drora-slash-command-help.ts:9-200` 20 正名 + 同 8 别名，顺序与真值一致。
- 全局 flags：`arguments.ts:8-107` 30 项（真值 29 项 + enable-workflow）。

## §3 差集三分类

### REAL-GAP（真值有我方无）：0 条

未发现。20 slash 正名、10 CLI 子命令、3 隐藏命令、8 别名全覆盖。

### EXTRA（我方多出）

| # | 项 | 级别 | 我方证据 | 真值证据 |
| --- | --- | --- | --- | --- |
| E1 | 全局 flag `--enable-workflow` + scope 报错 + 两种语言 help 行 | **P2** | arguments.ts:37；run.ts:54-55,431-438；i18n en-US.ts:32、zh-CN.ts:32 | `enable-workflow` bundle 0 命中；真值走 `dynamicWorkflowEnabled` 偏好（14770000 区域） |
| E2 | en-US help Slash Commands 段多列 /resume /rewind /skill /goal 4 行 | P3 | i18n en-US.ts:67-70 | 真值 en 止于 /new（13222600 尾）；真值 zh 却含 15 条（13234260） |
| E3 | slash /plugins usage 多 `uninstall <plugin> --force>` 段 | P3 | handlers/plugins.ts:11 | 真值 usage 无 uninstall（889016），但 handler 实支持（Htc，14717800）——行为同、文案不同 |

### SHAPE-DIFF（同名不同形/文案）

| # | 项 | 级别 | 我方证据 | 真值证据 |
| --- | --- | --- | --- | --- |
| S1 | /model 缺 `main`/`lite` 别名 | **P2** | handlers/model.ts:110 footer 仅 provider/model；usage `[list\|provider/model]`（shared/drora-slash-command-help.ts:141）；解析仅 provider/model（model.ts:62-91），app 层仅识别 "main"（bootstrap/app/provider-registry-selection.ts:79），无 "lite" | usage `[list\|main\|lite\|provider/model]`+详情"Use main, lite"（888818）；footer `/model main, or /model lite`（14717100）；setModel 收原始串 |
| S2 | CLI login 多 provider 位置参数 | **P2** | login-command.ts:15-17 `login [zai\|bigmodel]`；en-US.ts:21、zh-CN.ts:21 | `vTt(e,t,n,noBrowser)` 无 args（14700500），仅 Z.AI 流程，json 固定 `provider:"zai"`；help 行无参数（13219981 区域） |
| S3 | /model 切换响应与列表行格式 | P3 | model.ts:46,99-104 `Model switched to ${model} (${level}).${warning}`；行 `id (label; provider)` | 真值 `Model switched to ${a.model}.`；行 `- ${alias}: ${id} (${name})`（qtc，14717100） |
| S4 | /login help 详情第 2 行 | P3 | shared/drora-slash-command-help.ts:23 "browser login poll…refresh available models" | "Coding Plan login write the final API key to config.json"（8848800 区域） |
| S5 | 品牌串（预期改名，链路内自洽） | INFO | logout 详情 Drora、init 详情 ~/.drora（drora-slash-command-help.ts:32,47）；DRORA_EMBEDDED_SEARCH_COMMAND（bootstrap/app/embedded-search-backend.ts:4） | "shared ZCode credential store"、~/.zcode、ZCODE_EMBEDDED_SEARCH_COMMAND（13874290） |

## §4 flags 逐命令对照差

- **parseGlobalArgs**：真值 29 项（偏移 497600–498150）与我方逐项同名同型同 short 同序（strict、allowPositionals 均同）；唯一差 = 我方多 `enable-workflow`（E1）。
- **错误常量**：8 条逐一相符（偏移 ~14801100–14802500 vs run.ts:41-55）：target-replace/target 空/force-mcs/browser-use/surface/memory-bench/browser-executable/target-prompt 冲突，文本一致。
- **extractDisallowedToolsArgs**：两侧同构（含 web_search→WebSearch 归一）。
- **hooks trust**：usage 5 行逐字对应（我方 hooks-trust-command.ts:13-18）。
- **plugins CLI**：usage 逐字对应（plugins-command.ts:41-58）；`plugin` 别名同。
- **commands/skills CLI**：usage 与 JSON 字段（含 disableNonInteractive/frontmatterKeys）一致（commands-command.ts:193-232 vs nQo 偏移 14698000）。
- **plugin-host/dwf-child**：usage、`Plugin host failed:`、`Workflow child failed:`、`exports no start()` 逐条一致，仅常量名改名（S5）。
- **doctor**：输出行集合一致（run.ts:191-234 vs 14802500）；json 模式一致。
- **各 slash 命令 usage**：help 表 20 条中 19 条 usage 全等，仅 model 差（S1）；/plugins usage 差（E3）。

## §5 命令补全/提示字典

- 真值：内嵌 @withfig/autocomplete 数据表（起始 `smt={"-"...` 偏移 ~5298872，chezmoi@5552637），顶层键 707（`,"KEY":[[["` 模式计数）。
- 我方：`apps/drora-cli/packages/core/src/tool/handlers/generated/bash-command-registry.ts`（fig-2.692.3，hash 1b0d34b4…），顶层键 707。
- 抽样 `-`、`@commercelayer/cli`、`git`、`chezmoi`、`kubectl` 条目字节级一致 → **同源同版本，无差**。
- TUI slash 提示：两侧同源于各自 help 表 + 自定义命令，规模一致。

## §6 OPEN-QUESTION

1. 真值 `setModel` 收原始字符串，main/lite 之外的裸 id 别名解析在 app 层深处，未全量追踪；我方若补 S1 需先确认真值别名全集与优先级。
2. 真值 en-US help Slash Commands 止于 /new（11 条）而 zh-CN 含 15 条——真值自身 en/zh 不一致，属真值缺陷还是刻意截断待定；影响 E2 的对齐方向。
3. 真值 v4 workspace 配置里 slashCommands 映射含 `inputHint`/`source` 字段（偏移 14615130）；我方 TUI 建议结构为 aliases/summary/usage——疑协议层差异，归协议对拍员核。
