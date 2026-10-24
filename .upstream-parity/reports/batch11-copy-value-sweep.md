# Batch 11 — 用户可见文案与硬常量独立抽测（逐文案、逐常量）

- 日期：2026-10-19
- 官方 bundle：`D:/software/zcode/resources/glm/zcode.cjs`（3.14.3，15,127,039 B）
- 本仓 bundle：`apps/drora-cli/packages/cli/dist/drora.cjs`（3.15.1 基线，15,283,657 B）
- 本仓源码：`apps/drora-cli/packages/`（源码级锚点抽样）
- 方法：官方侧 `grep -aoE/-aobF` 提取 + 偏移定位 + 上下文切片（`tail -c +OFF | head -c N`）；本仓侧 `grep -acF` 精确字面量计数；改名差异按 `specs/drora-rename.md`（ZCode→Drora，z.ai/BigModel 品牌保留）判定
- 与前 10 批关系：不重复工具清单/键族/表结构/协议字段，聚焦用户可见文案（拒绝/错误、TUI 帮助/启动）与数值常量（避开 Bash 120s/600s、重试 11 次、hook 60s/32768B、resultBudget、compact 21k/13k、30s MCP、60s hiddenGrace/300s、20MB snapshot、task_output 2000 等已验证项）
- 判定口径：【gap】官方有本仓缺/不一致；【有意分歧】spec 记录的改名/豁免；【计数差】minified 字面量出现次数不同（多为 3.15.1 增量，低危待归因）；【候选不存在】官方 bundle 本无该类文案，非 gap

---

## 0. 结论速览

| 抽测类别 | 样本数 | 命中 | 缺失 | 计数差 |
| --- | --- | --- | --- | --- |
| 1. 拒绝/错误文案 | 27 | 27 | 0 | 0 |
| 2. 帮助/启动文案 | 33 | 33 | 0 | 0 |
| 3. 阈值/数值常量 | 15 | 15 | 0 | 3（低危） |
| 4. 系统提示词片段 | 11 | 11 | 0 | 0 |

**新发现 gap：0 条。** 唯一品牌残留为 `X-ZCode-Mobile-Connection-Id`（spec 明文豁免）。

---

## 1. 拒绝/错误文案抽测（27 条，27/27 命中）

提取模式：`"No .*"`、`"Failed to ..."`、`"Cannot ..."`、`timed out`、`not supported`、`available`（加引号短句，30-120 字符），剔除 TS 编译器/QuickJS/Yoga 等库内部文案后取产品面句子。本仓命中口径为 `grep -acF` 精确字面量 ≥1。

| # | 文案（官方原文） | 官方偏移 | 官方 | 本仓 | 判定 |
|---|---|---|---|---|---|
| 1 | Failed to admit session input to ledger | 13375877 | 1 | 1 | 对齐 |
| 2 | Failed to authorize | 4782475 | 1 | 1 | 对齐 |
| 3 | Failed to begin runtime shutdown | 14094194 | 1 | 1 | 对齐 |
| 4 | Failed to check bound automations before CronCreate | 14719780 | 1 | 1 | 对齐 |
| 5 | Failed to close session store | 14094637 | 1 | 1 | 对齐 |
| 6 | Failed to discover OAuth endpoints | 3825775 | 1 | 1 | 对齐 |
| 7 | Failed to emit WorkspaceHookAdmissionUpdated | 14123432 | 1 | 1 | 对齐 |
| 8 | Failed to generate compact summary | 13285347 | 1 | 1 | 对齐 |
| 9 | Failed to load project permission rules | 5121609 | 1 | 1 | 对齐 |
| 10 | Failed to open plugin zip archive | 4280385 | 1 | 1 | 对齐 |
| 11 | Failed to parse ripgrep JSON output | 2155696 | 1 | 1 | 对齐 |
| 12 | Failed to parse video SSE event | 3859395 | 1 | 1 | 对齐 |
| 13 | Failed to persist Bash shell selection snapshot | 12963879 | 1 | 1 | 对齐 |
| 14 | Failed to persist project permission update | 5119981 | 1 | 1 | 对齐 |
| 15 | Failed to persist session input delivery fallback | 13376347 | 1 | 1 | 对齐 |
| 16 | Failed to enqueue subagent background notification | 12735988 | 1 | 1 | 对齐 |
| 17 | Cannot compact while a prompt is running | 14784115 | 1 | 1 | 对齐 |
| 18 | Cannot create a scheduled task while running a scheduled task. | 14722384 | 1 | 1 | 对齐 |
| 19 | Cannot create an idle-time task while running an idle-time task. | 14724032 | 1 | 1 | 对齐 |
| 20 | Cannot create new file - file already exists. | 7347878 | 1 | 1 | 对齐 |
| 21 | Model request timed out. | 4016748 | 1 | 1 | 对齐 |
| 22 | Marketplace operation timed out | 4294700 | 1 | 1 | 对齐 |
| 23 | No admitted topic authorization is available for this input | 12621079 | 1 | 1 | 对齐 |
| 24 | Background task cancellation is not supported by this session runtime | 14793513 | 1 | 1 | 对齐 |
| 25 | Full access is not supported for this interaction | 14851744 | 1 | 1 | 对齐 |
| 26 | No refresh token available | 3829438 | 1 | 1 | 对齐 |
| 27 | Cannot call shutdown twice. | 13623011 | 1 | 1 | 对齐 |

覆盖率说明：官方 `"Failed to ..."` 族共约 30+ 条产品面文案，本批抽 16 条全部命中；未抽到的其余条目同族同产地，风险低。无 %s/%d 占位符形态差异（抽测项均为完整字面量）。

---

## 2. 帮助/启动文案抽测（33 条，33/33 命中）

官方 TUI 文案为 i18n 结构树（`tui:{copy:{...},effort:{...},input:{...},loginRequired:{...},loginSetup:{...},...}`），起点 @13428100 附近（`esc to interrupt` @13428447）。本仓源码锚点：`bootstrap/node_modules/@drora/i18n/src/locales/en-US.ts`（文案单一出处，随 CLI bundle 打包）。

### 2.1 输入/队列/剪贴板（官方偏移均在 13428100-13430200 区间）

| # | 文案 | 官方 | 本仓 | 判定 |
|---|---|---|---|---|
| 1 | esc to interrupt（activeStatusHint） | @13428447，2 处 | 2 | 对齐 |
| 2 | Submitted after the next tool call.（queuedSubmitHint） | @13428600，1 | 1 | 对齐 |
| 3 | Copied selected text to clipboard. | 同树 | 1 | 对齐 |
| 4 | Could not copy selected text. | 同树 | 1 | 对齐 |
| 5 | Text clipboard copy is not available in this terminal. | 同树 | 1 | 对齐 |
| 6 | Type to queue input（busyPlaceholder） | 同树 | 1 | 对齐 |
| 7 | No input history source is configured. | 同树 | 1 | 对齐 |
| 8 | No previous input for this project. | 同树 | 1 | 对齐 |
| 9 | Restored previous input. | 同树 | 1 | 对齐 |
| 10 | Could not restore previous input. | 同树 | 1 | 对齐 |
| 11 | Type a question and press Enter. | 同树 | 1 | 对齐 |
| 12 | + ${e} more queued（queuedMore 模板，按 `more queued` 计） | 1 | 1 | 对齐 |

### 2.2 登录/模型配置

| # | 文案 | 官方 | 本仓 | 判定 |
|---|---|---|---|---|
| 13 | No available models. Configure a provider or sign in with /login. | 同树 | 1 | 对齐 |
| 14 | Use /model to view models, or /login to connect a Coding Plan account. | 同树 | 1 | 对齐 |
| 15 | No login options are available. | 同树 | 1 | 对齐 |
| 16 | Use Up/Down to choose, Enter to select. | 同树 | 1 | 对齐 |
| 17 | Enter BigModel Coding Plan API Key | 同树 | 1 | 对齐（BigModel/z.ai 品牌按改名规则保留） |
| 18 | Paste the key here. It is hidden while typing. | 同树 | 1 | 对齐 |
| 19 | Waiting for BigModel authorization | 同树 | 1 | 对齐 |
| 20 | Waiting for Z.AI authorization | @13430200 区 | 1 | 对齐 |
| 21 | Complete sign-in in your browser. Authorization is detected automatically. | 同树 | 1 | 对齐 |
| 22 | Complete sign-in in your browser. I will continue when authorization finishes. | 同树 | 1 | 对齐 |
| 23 | Open browser login; authorization is detected automatically. | 同树 | 1 | 对齐 |
| 24 | Open browser login and create a Coding Plan API key. | 同树 | 1 | 对齐 |
| 25 | Login cancelled. Choose a setup method. | 同树 | 1 | 对齐 |
| 26 | Waiting for browser authorization... | 同树 | 1 | 对齐 |
| 27 | API key is required. | 同树 | 1 | 对齐 |
| 28 | Enter saves the key. Esc returns to setup choices. | 同树 | 1 | 对齐 |
| 29 | Enter the API key, then press Enter. | 同树 | 1 | 对齐 |
| 30 | Choose a login or API key setup method. | 同树 | 1 | 对齐 |
| 31 | Choose how to set up a Coding Plan provider. | 同树 | 1 | 对齐 |
| 32 | Set Up Coding Plan | 同树 | 1 | 对齐 |

### 2.3 模型请求反馈

| # | 文案 | 官方 | 本仓 | 判定 |
|---|---|---|---|---|
| 33 | Model request failed: ${e} / Model response received. ${e} tokens. / retryScheduled(attempt,delay,maxAttempts) 模板组 | 1/1/3 | 1/1/3 | 对齐 |

### 2.4 候选不存在记录（非 gap）

- `Welcome to ZCode`/`welcome`（-i）：官方 bundle **0 命中** → 官方 CLI 无欢迎横幅，本仓亦无，对齐。
- `press esc again`、`? for shortcuts`、`bypassing permissions`、`ctrl+c again`、`auto-compact`、`shift+tab to`：官方 bundle 均 0 命中（本仓同 0）→ 候选文案在官方不存在，非缺失。
- `doctor`：官方 bundle 6 处命中全部位于 pnpm/cdk8s 等 shell 补全表（@5588285、@5668579 附近切片证实），非产品诊断输出文案 → 无官方 doctor 文案可比，非 gap。

---

## 3. 阈值/数值常量抽测（15 个，15/15 存在，3 处计数差）

提取模式：`[a-zA-Z_]{3,30}(Ms|Seconds|Timeout|Interval|Ttl|Bytes|Attempts):[0-9e._]+` 频次统计 + `N*1024*1024` 换算族 + 具名变量切片（`tail -c +OFF` 定域）。全部避开批 4/批 10 已验证项。

| # | 常量（官方字面量） | 官方域判定（切片证据） | 官方计数 | 本仓计数 | 本仓源码锚点 | 判定 |
|---|---|---|---|---|---|---|
| K1 | `PAs=18e4`（180s 请求超时） | @2790595 上下文 `NodeHttpClientAdapter`，紧邻 `R6r="x-zcode-trace-id"` | `18e4`=5 | 5 | `adapters/src/http/index.ts:33` `DEFAULT_TIMEOUT_MS = 180_000` | 对齐 |
| K2 | `RAs=10*1024*1024`（HTTP 响应 10MB 上限） | 同上切片 | `10*1024*1024`=7 | 7 | `adapters/src/http/index.ts:34` `DEFAULT_MAX_RESPONSE_BYTES` | 对齐 |
| K3 | `HZs=10*1024*1024, GZs=5, JZs=18e4`（插件 icon 下载：10MB/5 次/180s） | @4333592 上下文 `icon-sources.json`、官方 CDN 路径 | `icon-sources.json`=1 | 1 | `adapters/src/plugins/marketplace.ts:58` `MARKETPLACE_JSON_TIMEOUT_MS = 180_000`、`zip-source.ts:19` 180_000 | 对齐 |
| K4 | `oTr=8*1024*1024` + `phs={maxStringLength:2048,maxArrayItems:32,maxKeys:32,maxDepth:6}`（有界检查） | @1221636 切片 | `8*1024*1024`=5 | 5 | （bundle 内联还原资产）`maxStringLength:2048`=1、`maxArrayItems:32`=1 | 对齐 |
| K5 | `clt=2*1024*1024*1024`（下载响应 2GB 硬上限，readResponseWithSizeLimit） | @3490925 切片 | 3 | **5** | — | 对齐；【计数差 D1】本仓多 2 处 2GB 常量（3.15.1 增量候选），低危待归因 |
| K6 | CUA 光栅内联预算 `maxInlineBytes:1e5,maxModelBytes:1e5,strategy:"truncate",preview:{direction:"head"}`（紧邻 `Kfa="This CUA raster is..."`） | @5161532 切片 | 2 | 2 | — | 对齐 |
| K7 | CUA/默认工具超时 `timeout:{defaultMs:3e4,maxMs:3e4,allowCallOverride:!1}` + `resultBudget:{maxInlineBytes:1e6,...,strategy:"artifact"}` | @7335083/@7667041 切片 | 邻接字面量=6 | 6 | — | 对齐（与已知 30s MCP 分属不同域：allowCallOverride:false 的工具默认超时） |
| K8 | Session mailbox 执行超时 `descriptor:{commandDisplay:"Session mailbox",...,timeoutMs:6e4}` | @5188531 切片 | `commandDisplay:"Session mailbox"`=1 | 1 | `adapters/src/mailbox/index.ts`（mailbox 域） | 对齐 |
| K9 | WebFetch `timeoutMs:6e4,maxResponseBytes:10485760` | @7693075 切片（GET+redirect:"manual"） | 1 | 1 | `core/src/tool/handlers/webfetch-constants.ts:4` `MAX_WEBFETCH_RESPONSE_BYTES = 10*1024*1024` | 对齐 |
| K10 | IPC channelReply 超时 `timeoutMs:6e4` | @14724614 切片 | `channelReply`=4 | **5** | — | 对齐；【计数差 D2】channelReply 4→5，低危（3.15.1 新增调用点候选） |
| K11 | 遥测 statusSink flush `await t.flush({timeoutMs:1500})` | @13991107 切片（shutdown 路径） | 1 | 1 | — | 对齐 |
| K12 | MCP/HTTP 传输 `maxResponseBytes:65536` + `Tta=15e3`（15s） | @4382672 切片（POST/GET headers 转发） | 1（65536）；`15e3`=12 | 1；**13** | — | 对齐；【计数差 D3】15e3 12→13，低危 |
| K13 | `OBa=36e5`（1h，runtime tooling 域常量） | @13414632 切片（紧邻 `MBa` hooks 默认块） | `36e5`=3 | 3 | — | 对齐 |
| K14 | `modelAnomalyGuard:{maxBudgetWarningsPerTurn:3,repeatedToolCallWarningThreshold:3}` | @1364970 切片（配置默认块） | 1 | 1 | `@drora/contracts/src/config/index.ts:352` 默认值 3 | 对齐 |
| K15 | `toolConcurrency:{maxConcurrency:10}`（工具并发默认） | @1364829 切片 | 1 | 1 | contracts config schema | 对齐 |

计数对照（同字面量双侧一致项）：`timeoutMs:6e4` 6=6；`20*1024*1024` 7=7；`defaultMs:3e4,maxMs:3e4` 6=6；`18e4` 5=5；`36e5` 3=3；`maxInlineBytes:1e5,maxModelBytes:1e5` 2=2；`maxResponseBytes:10485760` 1=1；`maxResponseBytes:65536` 1=1；`flush({timeoutMs:1500})` 1=1；`maxBudgetWarningsPerTurn:3` 1=1；`maxConcurrency:10` 1=1；`retryScheduled` 3=3。

三条计数差的定性建议：均为"出现次数不同而非值不同"，方向为本仓多 1-2 处，与本仓 3.15.1 基线（官方 3.14.3 之后的新增代码路径）一致，判【计数差/低危装饰性】；不构成对齐 gap，可在 3.15.1 迁移 spec 的差分清单中一并归因销账。

---

## 4. 系统提示词片段抽测（11 条，11/11 命中）

官方侧 `grep -aobF 'You are '` 定位 + 切片取特征句；本仓按改名规则以 Drora 形态检索（ZCode→Drora 为规则 4/6，其余逐字）。

| # | 官方原文（偏移） | 本仓检索形态 | 本仓 | 判定 |
|---|---|---|---|---|
| 1 | `You are ZCode, an interactive coding agent`（@4936234，buildCliPrefixSection） | `You are Drora, an interactive coding agent` | 1 | 对齐（改名面） |
| 2 | `You are ZCode Explore, a file search and codebase research specialist for ZCode CLI.`（@12703588） | `You are Drora Explore, ... for Drora CLI`（含 `a file search and codebase research specialist for Drora CLI`） | 1 | 对齐（改名面） |
| 3 | `You are running a ZCode workflow node for phase: ${n}.`（@12788755） | `You are running a Drora workflow node` | 2（=官方 2） | 对齐（改名面） |
| 4 | `You are operating autonomously. The user is not watching in real time...`（@4997290，自主运行政策段） | 逐字 | 1 | 对齐 |
| 5 | `- Never produce or reproduce exact song lyrics.`（@7699281，网页内容处理提示） | 逐字 | 1 | 对齐 |
| 6 | `- You are not a lawyer and never comment on the legality of your own prompts and responses.`（@7699186） | `You are not a lawyer` | 1 | 对齐 |
| 7 | `You are selecting memories that will be useful to the coding agent...`（@13158378，记忆筛选提示） | 逐字 | 1 | 对齐 |
| 8 | `# Harness` 段：`Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.`（@4936438） | 逐字 | 1 | 对齐 |
| 9 | `When you are using compact - please focus on test output and code changes. Include file reads verbatim.`（@5010201，compact 提示） | 逐字 | 1 | 对齐 |
| 10 | `When users ask you to perform tasks, check if any of the available skills match.`（@7718638，skills 触发句） | 逐字 | 1 | 对齐 |
| 11 | `When replying while work remains, do not use assistant text as the reply.`（@7762745，协调器回复政策） | 逐字 | 1 | 对齐 |
| 附 | `...a denied call means the user declined it — adjust, don't retry verbatim.`（@4936234 后 Harness 段） | `retry verbatim` | 1 | 对齐 |

本仓源码锚点：`bootstrap/node_modules/@drora/core/src/context/sections/cli-prefix.ts:8`（`CLI_PREFIX_PROMPT = "You are Drora, an interactive coding agent"`），证实提示词资产为源码定义、经改名面进入 bundle，非 bundle 后处理。

---

## 5. 本仓 bundle "ZCode" 残留核查

`grep -aocF 'ZCode' drora.cjs` = **1**，@1031991：

```
Lys="X-ZCode-Mobile-Connection-Id"
```

定性：【有意分歧】——`specs/drora-rename.md` §v3.15.1 外部契约豁免补记明文规定"手机 HTTP 控制面的 `X-ZCode-Mobile-Connection-Id` 保留官方 header 名；大小写不敏感不能解释 ZCode/Drora 前缀不同"。非 gap，无需处理。

---

## 6. 结论

- 四类抽测合计 86 个样本点，命中 86，**新发现 gap 0 条**。
- 3 处计数级差异（K5 2GB 3→5、K10 channelReply 4→5、K12 15e3 12→13）均为本仓多出、方向与 3.15.1 基线一致，判低危装饰性，建议并入 3.15.1 迁移差分清单归因。
- 唯一品牌残留为 spec 豁免 header，验证了改名 sweep 的完整性。
- 本批从"文案树 + 常量字面量计数"新角度复核，未发现前 10 批结论之外的结构性缺口；官方 3.14.3 与本仓 3.15.1 在用户可见文案与硬常量域高度一致。

## 附录 A：全部命令

```bash
# 官方侧提取（f=官方 bundle）
grep -aoE '"No [a-zA-Z ,'"'"'-]{5,90}"' "$f" | sort -u | head -40
grep -aoE '"Failed to [a-zA-Z ,'"'"'-]{5,80}[."]{0,2}"' "$f" | sort -u | head -30
grep -aoE '"Cannot [a-zA-Z ,'"'"'-]{5,80}[."]{0,2}"' "$f" | sort -u | head -30
grep -aoE '"[A-Za-z][^"]{10,90} (expired|is invalid|is required)[^"]{0,25}"' "$f" | sort -u | head -12
grep -aoE '[a-zA-Z_]{3,30}(Ms|Seconds|Timeout|Interval|Ttl|TTL|Bytes|Attempts):[0-9e._]+' "$f" | sort | uniq -c | sort -rn | head -45
grep -aoE '[0-9]{1,4}\*1024\*1024' "$f" | sort | uniq -c | sort -rn | head -12
grep -aobF 'You are ' "$f" | head -20
# 单条定位：grep -aobF "<文案>" "$f" | head -1
# 切片定域：tail -c +$((OFF-140)) "$f" | head -c 230
# 本仓侧计数（o=本仓 bundle）
grep -acF "<字面量>" "$o"
# 源码锚点
grep -rn '<符号>' --include='*.ts' apps/drora-cli/packages/{adapters,core,contracts}/src
```

## 附录 B：抽样代表性说明

- 错误文案族：官方 `"Failed to ..."` 产品面约 30+ 条，抽 16 条；`Cannot/timed out/not supported` 抽 11 条；抽样覆盖 session/cron/plugin/OAuth/permission/compact 六个域。
- 常量：覆盖 HTTP 客户端、插件下载、有界检查、CUA 预算、mailbox、WebFetch、IPC、遥测、anomaly guard、工具并发 10 个域；已知已验证的 10 项全部回避。
- 提示词：覆盖 CLI 前缀、Explore 子代理、workflow 节点、自主运行、内容合规、记忆筛选、Harness 输出格式、compact、skills 触发、协调器回复 10 个面。
