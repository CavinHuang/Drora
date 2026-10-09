# B4 工具执行面语义对拍报告（pass27，2026-10-08）

- 真值：`D:\software\zcode\resources\glm\zcode.cjs`（0.16.9 单行 bundle，下记 offset 为字节偏移）
- 我方：`D:\workspace\projects\Drora`（feat/migrate-remote-and-pet，基线新鲜）
- 方法：bundle 全程 `grep -ob` + `dd` 取 ≤1KB 片段，与我方源码逐常量/逐分支比对。证据格式：`bundle@offset 摘录(≤20字)` ↔ `我方 file:line`。
- 结论速览：执行面为高保真移植。绝大多数常量、分支、文案、状态机逐字节一致；仅 1 个功能性 REAL-GAP（NotebookEdit 死胡同）、若干品牌重塑类 SHAPE-DIFF。

## §1 Bash/Shell 面

| 语义点 | 真值证据 | 我方证据 | 判定 |
| --- | --- | --- | --- |
| 超时策略 default 120s / max 600s，`min(timeout\|\|default,max)`，env 解析（非法/≤0 忽略） | `@7303843` `BASH_DEFAULT_TIMEOUT_MS??12e4`；`Emt`=`Math.min(e\|\|t.defaultTimeoutMs,...)` | bash-timeout-policy.ts:6-34（120_000/600_000，同公式同守卫） | 一致 |
| 输出上限 `BASH_MAX_OUTPUT_LENGTH` 默认 30k、封顶 150k，空串→30k | `@2131972` `o<=0?3e4:Math.min(o,15e4)` | bash-output-policy.ts:1-23（30_000/150_000 同分支） | 一致 |
| Shell 解析器（unbash AST）：命令>10k 直接判 parse error；容器节点仅 AndOr/Pipeline/Statement；background 记 unsupported；动态词（命令替换/进程替换/参数展开）判 hasDynamicWords | `@5295891` `e.length>aia` parse error；`@5298439` `new Set(["AndOr","Pipeline","Statement"])`；`aia=1e4` | bash-command-parser.ts:48-49（MAX_BASH_PARSE_LENGTH=10_000、同容器集合）、:115-118、:216-242 | 一致（V5-P2 解析器仍在位） |
| 权限前缀归一（env/sudo/nohup/time 白名单、npm run/pnpm run 等 depth、路径/URL 词剔除、static assignment 正则） | `@7303624` `staticAssignmentTokens`；`@7303718` `looksLikePathOrUrl`；`_ca` unwrapCommand、`Rpo` depthOverride | bash-readonly-policy-argv*.ts / bash-readonly-policy-multiword-*.ts（同名函数族） | 一致 |
| Shell 提供方方言 git-bash / cmd / posix / legacy-shell；Git Bash 由 git.exe 反推 `..\bin\bash.exe` 两级；cmd 裸名 `cmd.exe` fallback；user-config 优先 | `@2101402` `Git Bash`；`@2102379` `bash.exe`；`e1r`=``{dialect:"cmd",file:e,shell:e}``；`QTr` legacy-fallback | bash-shell-provider.ts:93/105/243/260/268-287（inferWindowsGitBashPathsFromGitExe、isWindowsCmdFallback 同判） | 一致 |
| spawn：`detached: platform!=="win32"`、`windowsHide:true`、bash 走输出文件 fd、非 bash 走 collector | `@2156400` `detached:this.platform!=="win32"`；stdio `[ignore/pipe,w.fd,w.fd]` | node-execution-adapter-process.ts:127/135；node-execution-adapter-run.ts（同结构） | 一致 |
| Bash 输出文件：win32 用 `"w"`、POSIX `O_WRONLY\|O_CREAT\|O_APPEND\|O_NOFOLLOW` mode 0600；watch 轮询 5s；进度 tail 4096；discard 仅删自建文件 | `@2114285` watchTimer/progressDelay；`dus=5e3,pus=384,fus=4096`；`@2115108` win32 `"w"` 分支 | bash-file-output.ts:9-11（5_000/0o600/4_096）、:42-49（同 flags 分支）、:76-97 watchLimit 同款 in-flight 守卫 | 一致 |
| 取消传播：`signal?.aborted` 预检 → `createStoppedResult(o,"cancelled","Execution cancelled before spawn")`；关闭中 → "Execution adapter is shutting down" | `@2155922` 双文案（同串） | node-execution-adapter-run.ts:44/48/122-123 | 一致 |
| 杀进程树：win32 `taskkill /pid /T /F`（spawn 失败→SIGKILL）；POSIX 组杀 SIGTERM→**1500ms**→组 SIGKILL（`EIr=1500`）；generic 路径 750ms/ps 查树 500ms（`uds=750,dds=500`） | `@2153274` taskkill 分支；`@2151418` `EIr=1500` | node-execution-adapter-process.ts:148-193；process-tree.ts:3-5（1_500/750/500） | 一致 |
| 退出码语义：bash 走文件时终态 `code: timedOut?143:137`；强杀后 5s 报 SIGKILL（`Q1r=5e3`）；默认 timeout 兜底 `Cme=3e5` | `@2155028` `U?143:137`；`Q1r=5e3,Cme=3e5` | node-execution-adapter-run.ts:140/146；execution-utils.ts:5/13（300_000/5_000） | 一致 |
| 执行常量组：inline 10MB / 持久 50MB / 运行时 5GB / drain 1s / 进度 2s/1s/4096 | `@2130343` `Y1r=10*1024*1024,X1r=50*1024*1024,Ztt=5*1024*1024*1024,Stn=1e3,eIr=2e3,Ytt=1e3,tIr=4*1024` | execution-utils.ts:9-16（同 10 组常量） | 一致 |
| statusFromExit：error→spawn_error、timedOut→timed_out、cancelled→cancelled、code0→completed 否则 failed；后台 5GB 截断→`status:"cancelled",exitCode:137,error.type:"output_limit"` | `@2148700` `spawn_error...timed_out..."Background command killed: output file exceeded 5GB"` | node-execution-adapter-results.ts:181-189/176（同映射同文案） | 一致 |
| cwd 捕获：`captureCwdAfterSuccess` 时 tmp 目录写 `<前缀>-<uuid>-cwd`，cmd/posix 双方言包装，git-bash 路径转换 | `@2116050` `zcode-${crypto.randomUUID()}-cwd` | cwd-capture.ts:27-54（`drora-${uuid}-cwd`，同分支；仅前缀品牌差） | 一致（SHAPE-DIFF：文件名前缀） |
| 输出丢失诊断：statfs 预判 `<10MB` full / `<1000` inodes | `@2113400` `o<10n...ffree<1000n` | bash-file-output.ts:185-202（同阈值） | 阈值一致；提示文案见 §6 |
| env 注入链：base 继承→剥离运行时变量→UTF-8 locale 补丁（LANG/LC_CTYPE/LC_ALL 缺失或 C/POSIX 时补；darwin `en_US.UTF-8` 否则 `C.UTF-8`；PYTHONIOENCODING/PYTHONUTF8）→网络 overlay→envOverlay 合并→shellInitSnapshot 前置 source + 关 login | `@2106210` LC_CTYPE；`@2108761` PYTHONIOENCODING；`@2106274` `en_US.UTF-8`/`C.UTF-8`；`@2152300` envOverlay 合并与 snapshot | outputEncoding.ts:47-105（同规则）；execution-command.ts:28-58；node-execution-adapter-process.ts:70-115（`useLoginShell = snapshot?false:true` 对应 `atn(o,!u)`） | 一致 |
| hook/插件 env：`CLAUDE_CODE_SESSION_ID/CLAUDE_PROJECT_DIR/CLAUDE_SESSION_ID`(+品牌键) 注入与 `${...}` 展开 | `@5051100` `CLAUDE_CODE_SESSION_ID...ZCODE_PROJECT_DIR...` | core/hooks/configured-runner-input.ts:76-125（同 CLAUDE_* 全集 + DRORA_* 替代 ZCODE_*，另多 DRORA_PLUGIN_ID/NAME） | 一致（EXTRA：DRORA_PLUGIN_ID/NAME） |
| Bash 模型可见文案：`<error>Command was aborted before completion</error>`；assistant 15s 阻断预算自动后台；手动后台；后台 ID 提示与 "Output is being written to:" 路径 | `@7283390` `aborted before completion`；`@7283652` `blocking budget`；`haa=15e3,gaa="Read"` | bash-model-content.ts:109/11/119-143（逐字节同文） | 一致 |
| Bash 读文件态回填/失效提示：写命令正则（--write/--fix/black/rustfmt/phpcbf…共 19 项）、10MB stat 上限、展示 5 路径、`[This command modified N ... Call Read before editing.]` | `@7297306` auto-correct；`hpo=10*1024*1024,gpo=5`；`@7296900` 提示文案 | bash-read-file-state.ts:13-35/55+（同正则同上限） | 一致 |
| 后台资格：`run_in_background!==true && 非空 && 首词!=="sleep"` | `@7297300+` `isBashAutoBackgroundEligible` | bash-background-policy.ts（同判） | 一致 |

## §2 文件工具面

| 语义点 | 真值证据 | 我方证据 | 判定 |
| --- | --- | --- | --- |
| Read 行号格式 `N\t行`；空文件 reminder 包装 `<system-reminder>` | `@2065517` `File content (`；`Zto` addReadLineNumbers | read-text.ts:85-99 | 一致 |
| 文件过大错误：`File content (X) exceeds maximum allowed size (Y). Use offset and limit...`，code `too_large`；快路径阈值 10MB | `@2065542` 同文案；`ocs=10*1024*1024` | text-range-reader.ts:19/40-42 | 一致 |
| Token 预算截断：`READ_MAX_OUTPUT_TOKENS=25k`、默认行数 2k、85% 预算二分找前缀、partialViewNotice 三段文案（含 "Showing a partial view of lines ... Use Read with offset ..."）、单行超预算退字符前缀、`read_output_too_many_tokens` | `@4810800-4812600` `Kto=Math.floor(QO*.85)`、`QO=25e3,nH=2e3`、`read_output_too_many_tokens` | read-text.ts:18/123-252（同 85%、同三段文案、同错误码）、contracts/src/tools/read.ts:15-17（256KB/25k/2k） | 一致 |
| 编码：BOM 探测 UTF-8/UTF-16LE、iconv-lite 解码、行尾 CRLF/LF 检测与回写 | `@1576683` iconv utf-16 内嵌；`SRe/Att` normalize/applyLineEndings | text-metadata.ts:8-42（iconv + gb2312/gbk/gb18030 额外支持）、text-range-reader.ts:97-125 | 一致（我方多中文 legacy 编码，EXTRA） |
| Read 结果形状 `{path,content,encoding,lineEndings,bytesRead,sizeBytes,truncated,startLine,lineCount,totalLines,revision{id,mtimeMs,sizeBytes}}` | `@2065500` acs 返回体 | text-range-reader.ts:63+/read.ts:132-142 | 一致 |
| Write：先读旧文件保 encoding/lineEndings/revision，`createParents+atomic` 写回，expectedRevision 校验（stale→`File has been modified since read...`），未读→`File has not been read yet...`；结果 type create/update + structuredPatch；成功文案含 "(file state is current in your context — no need to Read it back)" 与 userModified 附注；元数据 timeout 30s/maxOutputBytes 1e6/needsApproval | `@7209172` writeHandler；`@7208900` `File has not been read yet`/`modified since read`；`@7206824` `File created successfully at`；`@7210400` `timeoutMs:3e4,maxOutputBytes:1e6` | write.ts:42-60/94-176/213-223（同串同值） | 一致 |
| Edit：错误码枚举 `{NO_CHANGE:1,FILE_EXISTS_NO_OLD_STRING:3,FILE_NOT_EXIST:4,NOTEBOOK_FILE:5,FILE_NOT_READ:6,STALE_FILE:7,OLD_STRING_NOT_FOUND:8,AMBIGUOUS_REPLACE:9,FILE_TOO_LARGE:10,INVALID_PATH:13}`；`String to replace not found in file.\nString: X`；歧义消息带候选数 | `@1343949` eM 枚举；`@7224572` not found 文案 | contracts/src/tools/edit.ts:179-190；edit.ts:212-219 | 一致 |
| Edit 匹配阶梯：exact→quote_normalized→line_number_prefix_stripped→escape_normalized→unicode_escape_normalized→line_trimmed→indentation_flexible→block_anchor；replaceAll 跳过宽匹配；多唯一值→ambiguous；block_anchor 锚行 trim 相等 + 中段平均相似度 ≥0.8 | `@7211700` 阶梯数组与 Oia 分派；`@7213567` Uia（`Via<Dia`，`Dia=.8`） | core/src/tool/edit-matchers.ts:19-56/210-218（同阶梯同 0.8） | 一致 |
| patch：`structuredPatch(file,file,old,new,undefined,undefined,{context:3,timeout:5000}).hunks`；additions/deletions 计数 | `@5023101` `_Xs=3,yXs=5e3` | core/src/tool/diff.ts:7-27 | 一致 |
| 路径校验：`resolveWorkspacePath` 只归一化不硬拦 workspace 外（workdir/workspaceRoot 必须绝对）；空路径报 "Tool path must not be empty" | `@4998853` `function MC(` 同逻辑同文案 | path-policy.ts:15-59（含同款注释决策） | 一致 |
| Glob：100 条上限、100k 模型字节、mtime 排序描述、"No files found"、"(Results are truncated. Consider using a more specific path or pattern.)" | `@7531600` `Uua=100,Tht=1e5`；`@7531781` No files found | glob.ts:20-23/149/153 | 一致 |
| Grep：ripgrep 后端、默认 files_with_matches、exit2 专项错误、`ripgrep exited with code N`、模型字节 20k、超时 30s、同款描述 | `@2068900` outputMode 默认/exit code 分支；`@7535270` `Iht=2e4,xvn=3e4` + 描述 | grep.ts:23-25/184-185（同值同描述） | 一致 |
| .ipynb 拒绝：`File is a Jupyter Notebook. Use the NotebookEdit to edit this file.`（code NOTEBOOK_FILE） | `@7224366` 同文案 | edit.ts:193-196 | 文案一致；但见 §6 REAL-GAP-1 |

## §3 Web 工具面

| 语义点 | 真值证据 | 我方证据 | 判定 |
| --- | --- | --- | --- |
| URL 校验：≤2000 字符、`Invalid URL: X`、仅 http/https、拒绝凭据、http→https 升级、空 host/localhost/.localhost/**.local**→"WebFetch requires a public hostname"、非公网 IPv4/IPv6 拦截、单标签 host → "Invalid URL" | `@7554400+` Omo/Lmo 阶梯全量 | webfetch-url.ts:8-52/103-134（同阶梯同文案同 2000） | 一致 |
| egress 逐跳守卫：每次真实 GET 前 `assertWebFetchLiteralEgress`；localhost/.localhost→"cannot access private or local hostnames"；IP 字面量→公网校验，否则 "cannot access private or local IP addresses"；无 DNS preflight | `@7552865` Imo/ida + `ada`（仅 localhost/.localhost） | webfetch-egress-guard.ts:20-52（同分同文案）；webfetch-network.ts:51-53（每跳调用） | 一致 |
| 重定向：manual、上限 10、Location 非法→`UnsafeRedirect`"Redirect Location is not a valid URL"、超限→TooManyRedirects"exceeded the safe redirect limit"、同源策略（拒凭据/跨协议/跨 host，www 归一） | `@7555340` UnsafeRedirect；`@7539786` 附近 Nmo/Mmo | webfetch-url.ts:54-88/99-101；webfetch-network.ts:51/152-153 | 一致 |
| 请求：60s 超时、10MB 响应上限、UA `...-WebFetch/0.1 (+https://...; coding-agent-cli)`、`Accept: text/markdown, text/html, */*` | `@7539786` `WebFetch/0.1 (+https://zcode.ai; coding-agent-cli)` | webfetch-constants.ts:6-13（60_000/10MB/10 重定向）；webfetch-network.ts:274-277 | 值一致；UA 域名为品牌重塑（SHAPE-DIFF） |
| 缓存：TTL 900s（9e5）、容量 52428800（50MB）、LRU 淘汰 | `@7539800` `expiresAt:Date.now()+9e5`、`52428800` | webfetch-constants.ts:10-11（15min/50MB）+ webfetch-cache.ts | 一致 |
| 错误码：webfetch_invalid_url/unsupported_protocol/credentials_in_url/missing_redirect_location/unsafe_redirect/egress_blocked/too_many_redirects/response_too_large/fetch_failed/processing_failed；仅 FetchFailed/ProcessingFailed retryable | `@7539900` Xua 枚举 + retryable 规则 | webfetch-errors.ts:12-40（同 10 码同 retryable） | 一致 |
| 模型加工：auxiliary 模型 `maxOutputTokens=min(4096,max)`；prompt 模板（"Web page content:\n---"）、preapproved+markdown+<100k 直通；125 字引文限制/not a lawyer/歌词禁令；无文本→"WebFetch completed, but the extraction model returned no text."；失败→ProcessingFailed | `@7562300` qmo/Ada/Pda 全量 | webfetch-processing.ts:26-127（逐字节同模板同 4096 同 1e5） | 一致 |
| WebSearch：provider-native `web_search`、maxUses 默认/上限 8、system+user 触发 prompt、`maxOutputTokens=min(4096)`、流式收集、`supportsNativeWebSearch` 缺失→ConfigurationError、元数据 readOnly/concurrentSafe/60s/maxOutputBytes 2e4、结果 budget（inline 1e4/model 2e4/preview 30 行 head）、取消文案 "WebSearch was cancelled" | `@1380762` 描述符 Ibr/Tbr；`@7572800` handler Qda/nho；`Kda=6e4` | websearch.ts:29-32/55-237；contracts/src/tools/websearch.ts:15-60（同 refine 同 8） | 一致 |
| WebSearch 结果解析：递归扁平化 tool_result（type web_search_result/url、content/sources 数组）、model content `Links:`/`- [title](url)`/REMINDER、链接截 20 | `@7575100` Jmo/Rht/Kmo、`Uda=20` | websearch-results.ts:14/50/63/68/83-96（同 20 同文案） | 一致 |

## §4 工具结果形状与中断终态

- BashOutput shape：`{stdout,stderr,interrupted=timedOut||cancelled,isImage,noOutputExpected,status,exitCode,signal,timedOut,cancelled,stdoutTruncated,stderrTruncated,stdoutBytes,stderrBytes,rawOutputPath,dangerouslyDisableSandbox,returnCodeInterpretation,persistedOutputPath,stdoutPersistedOutputPath,stderrPersistedOutputPath,persistedOutputSize,stdout/errPersistedOutputSize,staleReadFileStateHint,ghRateLimitHint,perf}`：`@7289500` ↔ contracts/src/tools/bash.ts:159-253。一致。
- `interrupted` 合并式 `timedOut || cancelled`：`@7289500` ↔ bash-output.ts:77。一致。
- isError 判定：`!success→true`；`output.isError??output.is_error`；Bash 且有 interrupted → provider-error 或 interrupted：`@12721748` `function l_t` ↔ core/src/runtime/helpers/tool-result.ts:68-84。逐字节一致（历史 output 键修复仍在位，含周边 toRecordInput/stringifyToolResultOutput/parseMcpToolName/findParallelGroupIndex 同名同体）。
- 权限拒绝文案：`The user doesn't want to proceed...STOP what you are doing...`：`@14196465` ↔ packages/bootstrap/src/permission-options.ts:9。逐字节一致。
- 执行状态枚举 `running/completed/failed/timed_out/cancelled/spawn_error`：`@645488` ↔ contracts/src/interfaces/execution.port.ts:157。一致。
- 展示截断：UTF-8 安全前缀 + 后缀 `\n...[truncated]`：`@2156900 附近 var Qoo` ↔ executor/display-text.ts:7-22。一致。
- 持久化 envelope（persistedPath+预览 2000 字符、字节格式 0-dec KB/MB/GB `toFixed(1).replace(/\.0$/,"")`）：`@5035500 formatPersistedOutputEnvelope`、`@2130250 _tn` ↔ bash-model-content.ts:163-189/result-persistence-format.ts。一致。
- TaskOutput 别名族 `["AgentOutputTool","BashOutputTool","AgentOutput","BashOutput"]` + DEPRECATED 描述：`@1374387` ↔ contracts/src/tools/task-output.ts:6-12。一致。
- 模型消息序列化 `tool_result` 块 `is_error`（error-text/error-json→true）、`execution-denied` 缺省 "Tool execution denied."：真值 `@3438500`。我方 provider 层未见同名 content-part 类型（我方经 modelContent/isErrorForToolResult 归一为文本+isError 布尔）→ **SHAPE-DIFF（序列化分层不同，模型可见语义等价）**，详见 §7 OQ-2。

## §5 并行/调度

- 调度器：`parallelGroups` 拓扑分组、`DEFAULT_MAX_CONCURRENCY=10`、readOnly 集合注入：scheduler.ts:36 ↔ 真值 `@4909941/4980345`（同字段族）。执行器默认 `maxConcurrency ?? 10`：executor/impl.ts:83 ↔ 真值 `maxConcurrency??10`。一致。
- 批执行：`<=max` 直接 `Promise.all`，否则按 max 切片顺序批；只透传 automationTurn/offPeakTurn/signal/traceContext/subagentModelOverride/model/maxConcurrency：batch-runner.ts:24-54 ↔ 真值 `function ioo`（`@4979819`）。逐字节同构。一致。
- 组间顺序执行；`stopTurnAfterResult` → 余组全部取消为 ToolCancelled "Tool cancelled because a previous tool result requested a turn stop."（recoverable，warn 事件 `tool.call.cancelled_after_turn_stop`）：batch-runner.ts:92-127 ↔ 真值 `@4981487` GYs 同串同事件。一致。
- 旧"前序失败跳过后续组"策略：真值 0 命中、我方为注释掉的死代码（batch-runner.ts:130-156）→ 我方与真值行为一致（均不跳过）。
- 超时闸门 ToolDeadline（可暂停：model_request_queued→pause、admitted→resume、queuedMs 计量、`Tool execution timed out after ${ms}ms`、abort→"Tool execution cancelled"/entry.cancellation.userVisibleMessage、cleanupGraceMs、resolveTimeoutMs 的 timeout_ms/timeout 覆盖与 maxMs 截断）：executor/timeout.ts 全文件 ↔ 真值 `@4993400-4995100` woo/koo/vpt。逐字节同构。一致。
- Bash 后台生命周期：`auto_on_timeout` 且 timeout<=0→前台；commitBackground/armForegroundDeadline/externalAbort/5GB 后台限值链：node-execution-adapter-lifecycle.ts:102-317 ↔ 真值 `@2161400-2162400`。一致。

## §6 差集三分类表

| # | 分类 | 级别 | 语义点 | 真值证据 | 我方证据 | 影响 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | REAL-GAP | P2 | NotebookEdit 工具缺失：Edit 拒绝 .ipynb 后指引模型调用 NotebookEdit，但我方未注册该 handler，形成指令死胡同 | `@7224366` 拒绝文案；`@12767900` 工具名单含 NotebookEdit | edit.ts:193-196 同文案；provider-visible-order.ts:17 仅列名；handlers/index.ts 无注册 | 模型编辑 .ipynb 必失败且被引向不存在的工具（注册 schema 归 B1，此为执行面可观察缺口） |
| 2 | REAL-GAP | P3 | Bash 输出丢失恢复提示缺 TMPDIR 指引：真值提示 "Free up space or set CLAUDE_CODE_TMPDIR to a directory on a filesystem with room."，我方为 "Free up space on this filesystem." 且全仓无 TMPDIR 覆盖 env（真值该 env 亦仅出现在提示文案，1 处） | `@2113478` set CLAUDE_CODE_TMPDIR | bash-file-output.ts:190,193,196 | 提示可操作性弱化；statfs 阈值（<10MB/<1000 inodes）双方一致，无行为差 |
| 3 | SHAPE-DIFF | P3 | WebFetch UA 与 cwd 临时文件前缀品牌重塑：`WebFetch/0.1 (+https://zcode.ai...)` → `Drora-WebFetch/0.1 (+https://drora.ai...)`；`zcode-<uuid>-cwd` → `drora-<uuid>-cwd`；存储根 `ZCODE_STORAGE_DIR\|\|~/.zcode/cli/exec` → `DRORA_STORAGE_DIR\|\|~/.drora` | `@7539786`；`@2116050`；`@2129487` | webfetch-constants.ts:13；cwd-capture.ts:28；execution-utils.ts:18-20 | 对模型/用户可见的标识符差异，行为等价；属既定品牌策略 |
| 4 | SHAPE-DIFF | P3 | hook/plugin env 品牌键：真值多 `ZCODE_PROJECT_DIR/ZCODE_SESSION_ID`，我方以 `DRORA_PROJECT_DIR/DRORA_SESSION_ID` 等替代且 CLAUDE_* 全集保留；我方额外注入 DRORA_PLUGIN_ID/DRORA_PLUGIN_NAME | `@5051100` env map | configured-runner-input.ts:76-98 | 依赖 ZCODE_* 的旧插件会取不到值；CLAUDE_* 兼容层仍在 |
| 5 | SHAPE-DIFF | P3 | 输出目录 fs 溢出文案细节（同 #2 的文案部分）：我方按 ENOSPC 诊断路径输出 "(NMB free)"，格式与真值一致但提示句不同 | `@2113400` | bash-file-output.ts:193 | 低 |
| 6 | EXTRA | P3 | 我方独有：fs 支持 gb2312/gbk/gb18030 legacy 编码探测与解码；hook env 多 DRORA_PLUGIN_ID/NAME | 真值无对应 | text-metadata.ts:12-42；configured-runner-input.ts:88-89 | 超集能力，无回归风险 |
| 7 | SHAPE-DIFF | P3 | provider 请求序列化：真值有 `execution-denied/error-text/error-json` 中间 content-part 类型再转 `tool_result.is_error`；我方直接以 modelContent+isErrorForToolResult 归一 | `@3438500` | core/src/runtime/helpers/tool-result.ts:53-84 | 最终 wire 形状等价（is_error 布尔），中间层不同 |

REAL-GAP 合计：2（P2×1、P3×1）；SHAPE-DIFF：5；EXTRA：1。

## §7 OPEN-QUESTION

1. OQ-1（apply_patch）：真值 workflow 导出路径存在 `apply_patch_call/apply_patch` 工具名（`@3530324/@3534232`），但未找到主循环注册 `apply_patch` 工具的 schema/entry；我方 handlers/index.ts:80 亦为注释态。真值是否在特定 provider（OpenAI 系）下注册 apply_patch 待验证；若注册，我方缺执行面。
2. OQ-2（tool_result 中间层）：真值 `execution-denied` content-part 在我方缺失是否影响 denied 场景的模型可见文案（真值缺省 "Tool execution denied."）——我方拒绝路径文案由 permission-options 提供，疑似等价，需一次 denied 场景 wire 抓包确认。
3. OQ-3（CLAUDE_CODE_TMPDIR）：真值该 env 仅命中 1 处提示文案，未见消费点；不排除被重命名链（ZCODE_*）间接消费。若未来对齐 TMPDIR 重定向能力，需连同提示文案一起改。
4. OQ-4（NotebookEdit 归属界线）：工具注册/schema 归 B1，但 .ipynb 拒绝→死胡同是执行面可观察行为；两报告需交叉引用同一修复项。
