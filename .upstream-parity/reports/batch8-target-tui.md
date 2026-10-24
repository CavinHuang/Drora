# 官方 TUI 表现层调研：zcode.cjs 内的 TUI seam、i18n 文案与交互契约

- 调研日期：2026-10-19
- 目标文件：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 B，esbuild minified，版本字符串 `gq="0.16.9"`）
- 调研方式：只读 grep / node -e 切片；所有偏移为 UTF-8 字符偏移（非字节），锚点字符串可直接 `indexOf` 复核
- 结论先行：**TUI 渲染器本体不在本 bundle 内**。bundle 只包含 (a) TUI 加载器与 host seam，(b) en-US/zh-CN 双语文案目录（含 TUI 全部界面文案），(c) 斜杠命令注册表 TF，(d) 全部会话事件流/交互/权限/截断等 core 契约。TUI 渲染层是独立 npm 包 `@zcode/tui`（SEA 发行时作为带 sha256 校验的 asset 内嵌，运行时解包后 `import`）。

## 1. 渲染栈：TUI 是独立包 `@zcode/tui`，基于 OpenTUI

### 1.1 加载链（证据：偏移 15097197 `loadTuiRuntime`）

```js
hmi="zcode-tui-runtime/"
Evc="node_modules/@zcode/tui/dist/index.js"
_mi = r(async () => {
  let e = await import("node:sea");
  if (!e.isSea()) return await import("@zcode/tui");        // 普通安装：直接 import npm 包
  let t = await Avc(e);                                     // SEA：读 manifest 解包 assets
  return await import(pathToFileURL(join(t, Evc)).href);
}, "loadTuiRuntime")
```

- SEA 路径：`zcode-tui-runtime/manifest.json`（version=1 + hash + files[]），每个文件 sha256 校验，解包到 OS 缓存目录：
  - macOS `~/Library/Caches/zcode/sea-assets/`；Windows `%LOCALAPPDATA%\zcode\Cache\sea-assets\`；Linux `$XDG_CACHE_HOME/zcode/sea-assets/`（`ensureSeaTuiRuntime`/`cacheBaseDirectory`）。
- TUI 入口签名（`runTuiCommand`，偏移 15102830）：`_({loadStartupOptions, locale, developerMode, version, workspaceDirectory, noColor, readClipboardImage, listModelOptions, listWorkspacePathSuggestions, listMcpServers, readSubagents, readSubagentTranscript, listWorkflowRuns, replayWorkflowRuns, getMainSessionId, writeClipboardText, stderr, stdin, stdout, recallPreviousInput, sendInput, setMode, submitPrompt, subscribeSessionEvents})`。
- 本机（desktop 发行包）内没有 `@zcode/tui`：`resources/app/node_modules`、`app.asar` 均无（grep 0 命中）。TUI 属于独立 CLI（npm/SEA）发行物。

### 1.2 渲染框架：OpenTUI（非 React ink）

- bundle 内无 `ink`/`useInput`/`yoga`（"ink" 唯一命中是 mime 表 inkml）；`createElement` 仅 19 处。
- en-US TUI 文案 `sidebar.shellSubtitle: "OpenTUI shell"`（偏移 13428117 起的文案树）——TUI 外壳自述为 **OpenTUI**（solid-js 风格终端 UI 框架；bundle 内有 createSignal/createMemo 痕迹但主体不在本 bundle）。
- 纯 ANSI 痕迹很少：全 bundle 仅 61 处 `\x1B[…]`，绝大多数属于内嵌 TypeScript 编译器诊断配色、debug 库、AI Gateway 错误文案；CLI 自身只有一组极简色 helper：`jPn={bold,cyan,dim,green,red}`（isTTY 才着色，偏移约 1342.4 万前）与 OSC52 剪贴板序列 `\x1B]52;c;<b64>\x07`（`writeOsc52`，偏移 15085029）。**终端屏绘由 @zcode/tui/OpenTUI 负责，core 不做全屏渲染。**

## 2. 主题

- 配置 schema（`HGs`，偏移 4176188）：`ui: { locale: enum["auto","en-US","zh-CN"], theme: enum["auto","dark","light"] }`。
- 存储：用户配置文件 `~/.zcode/cli/config.json`（`Bto="~/.zcode/cli"`, `jto="config.json"`，偏移 4184495；`resolvePath` 支持 `~/` 展开）。
- 读取：`getTheme(){return e.configResult.config.ui.theme,"getTheme"}`；TUI 启动默认 `theme: N.theme ?? "auto"`（runTuiCommand）。**未发现 TUI 端配色 token/色表定义**——具体 ANSI/256 色映射在 @zcode/tui 内，bundle 只有 auto/dark/light 三枚举。
- `/mode`、`/model` 等命令响应返回 `{locale, model, theme, thoughtLevel}` 让 TUI 同步显示（`withTuiMetadata`、`formatNewSessionResult`）。
- 对照（非 TUI）：desktop rewards 内嵌页用 `zai-light/zai-dark`（`qtn` schema，`zcodeBridge` getTheme/onThemeChange，偏移 625056 附近模块）；web remote control theme seed 校验 `light|dark|zai-light|zai-dark|system`（`isWebRemoteControlThemeSeed`）。TUI 本身不用这组值。

## 3. i18n

- 支持语言：`UPn=["en-US","zh-CN"]`，默认 `Ywt="en-US"`；`--locale`/`/locale [auto|en-US|zh-CN]`（`isUiLocale`）。**仅两种语言 + auto。**
- 文案位置：**全部内嵌在 bundle**，双目录对象 `t8a={"en-US":o8o,"zh-CN":s8o}`（en 目录偏移 13424456，zh 目录偏移 13436235，zh 用 `\uXXXX` 转义中文）。结构：`{locale, cli:{errors:{localeUnsupported}, help(v)}, tui:{...}}`。
- `/locale`（别名 `language`）实现：`setLocale` → 运行时 `setLocale` 更新会话并 `resolveUiLocale`；无会话时 `updateUiLocaleInFileConfig`（`vLe`）直接改写 `~/.zcode/cli/config.json` 的 `ui.locale` 并返回 `{configPath, locale, requestedLocale}`。
- auto 解析链（偏移 13453351 `detectLocale`）：CLI `--locale` > `config.ui.locale` > 环境变量 `["LC_ALL","LC_MESSAGES","LANG","LANGUAGE"]`（LANGUAGE 按 `:` 分隔多候选）> Intl locale；`c/posix` 忽略；`en*→en-US`、`zh*→zh-CN`，其余回落 en-US。
- TUI 文案树（en 与 zh 一一对应，偏移 13428117 起可整树读出）分组：`copy / effort / input / loginRequired / loginSetup / model / sidebar / status / terminal / transcript / selection / fileMention / slash`。细节见 §5、§6。

## 4. 交互与键盘

### 4.1 可确认的键位（来自内嵌文案字符串）

| 键 | 语义 | 证据 |
| --- | --- | --- |
| Enter | 提交输入/选择选中项 | `typePrompt: "Type a question and press Enter."`；`selection.defaultHelp: "Enter selects, Esc cancels"` |
| Esc | 中断当前流（运行中）；取消/返回（picker、登录、子代理只读视图） | `input.activeStatusHint: "esc to interrupt"`；`selection.defaultHelp`；`sidebar.subagents.readonly: "Read-only · Esc to return"`；`loginSetup.input.help: "Enter saves the key. Esc returns to setup choices."`；plugins 面板 `"Type to filter, Up/Down choose, Enter toggles, Esc closes"` |
| Up/Down | 选项/列表移动 | `loginSetup.help: "Use Up/Down to choose, Enter to select."` |
| Ctrl+C | 退出 CLI（启动横幅即提示） | `terminal.starting: "Starting ZCode... Ctrl+C to exit"` |
| Ctrl+R | 重试失败的压缩 | `transcript.compact.retry: "Ctrl-R to retry ${id}"` |
| `/` 触发斜杠面板、`@` 类文件提及 | filter 行实时过滤 | `slash.row: " /${name}  ${summary}"`、`selection.filterLine: "filter: ${filter} | …"`、`fileMention.title: "Files"` |
| 输入历史 | 上/下翻 recalled 输入 | host `recallPreviousInput()` + `recordInputHistory(text, attachments)`；提示文案 `restoredPreviousInput / noPreviousInput`；持久化表 `input_history`、`input_history_attachments`（含 `time_idx`、`project_time_idx`），函数族 `recallPreviousInputHistory/recordInputHistory/asInputHistoryStore/decodeInputHistoryRow` |

TUI 专属更多组合键（粘贴多行、折叠等）在 @zcode/tui 内，bundle 不可见。

### 4.2 输入提交与排队（core 侧事实）

- `createTuiSubmitPrompt`（偏移 15096805）暴露 `sendInput`/`setMode`/`submitPrompt`：
  - `sendInput` 先解析斜杠命令；`model`/`effort` 等 known 命令走命令路径；普通输入 → `app.sendInput`（busy 时进入 steer/队列），无 sendInput 时退回 `submitPrompt`；返回 `started_turn` 时用 `withTuiMetadata` 附加 `{locale, mode, model, theme, thoughtLevel}`。
  - 每次 submit 临时替换 `requestPermission` broker（`U=mt.requestPermission`，finally 还原）。
- 排队语义文案：busy 占位 `busyPlaceholder: "Type to queue input"`、队列标题 `Queue (N)`、`queuedMore: "+ N more queued"`、**`queuedSubmitHint: "Submitted after the next tool call."`**（排队输入在下次工具调用边界后提交）。运行时对应 `runtimeCommandQueue`（`oLo()`）+ `queueAutoDrain` + `TurnSteer*` 事件族（`turn_steer_queued/delivery/dispatch/drained/rejected/discarded/reordered`、`session_input_promoted`、`queue_auto_drain_changed`）。
- Esc 中断/恢复（事件级）：`Interrupt/Cancel` 事件 + StreamRecovery 事件族（`stream_recovery_anchor_created/started/anchor_selected/tail_discarded/retry_started/blocked`）；状态文案 `recoveringStream: "Recovering interrupted model stream..."`、`retryingStream: "Retrying model stream..."`、`interruptedStreamDiscarded: "Interrupted model stream discarded."`、`streamStalled: "Model stream stalled."`。模型请求重试文案 `retryScheduled: "Retrying model request ${attempt}/${max-1} in ${delay}: ${reason}"`。

### 4.3 对照：desktop 渲染层快捷键（同 bundle，`getDefaultShortcutBindings`，偏移 625056）

`openCommandCenter Ctrl+K / Ctrl+Shift+P`、`openSettings Ctrl+,`、`findInTask Ctrl+F`、`toggleSidebar Ctrl+B`、`switchTheme Ctrl+Shift+L`、`toggleTerminal Ctrl+J`、`toggleSidePane Ctrl+Alt+B`、`prev/nextConversation Ctrl+Shift+[ / ]`、`navigateBack/Forward Ctrl+[ / ]`、`openModelMenu Ctrl+M`、`cycleSessionMode Ctrl+Shift+M`、`cycleThoughtLevel Ctrl+T`、`newTask Ctrl+N`、`openWorkspace Ctrl+O`、`closeActiveContext Ctrl+W`、zoom `Ctrl+= / Ctrl+- / Ctrl+0`、`composerSend Enter`、`composerInsertNewline Shift+Enter`、`toggleInterfaceMode Ctrl+Shift+U`、`openOnboarding Ctrl+Shift+O`。

## 5. 消息渲染

### 5.1 数据流：TUI 渲染的是 core 事件流，不是自渲染 markdown

- `subscribeSessionEvents` 把 core 会话事件推给 TUI。事件枚举 `nt`（偏移 1295697）共 ~70 个：`session_*`、`turn_*`、`user_message/assistant_message/system_message`、`assistant_feedback_updated`、`highspeed_metrics_updated`、`model_request/model_selected/model_streaming/model_complete/model_error`、`streaming_tool_ledger_updated`、`stream_recovery_*`（6）、`model_network_status/model_anomaly_warning/network_request_status`、`tool_call_scheduled/started/progress/result/error`、`tool_batch_complete`、`background_task_*`、`dynamic_workflow_run_progress`、`permission_requested/resolved/denied`、`plugin_ui_*`（4）、`user_input_auto_resolution_updated`、`workspace_hook_review_*`（3）、`hook_run_*`（5）、`compact_*`（4）、`microcompact_boundary`、`rewind_triggered/checkpoint_created`、`target_changed/target_completion_verification`、`subagent_spawned/message/stopped`、`interrupt/cancel/resume/error`。
- **markdown → 终端的渲染在 @zcode/tui/OpenTUI 侧**。core 里的 `marked`（markedjs，21 命中）服务于 HTML 输出场景（如 MCP Apps/HTML 工件），不是 TUI 渲染器。

### 5.2 transcript 呈现契约（文案树 `transcript`）

- 角色标签 `roles: {agent:"Agent", system:"System", user:"User"}`；标题 `Transcript`。
- thinking：状态行 `status.thinking: "Thinking..."`；块标签 `transcript.thought: {thinking:"Thinking...", complete:"Thought"}`（完成后的 thinking 以 "Thought" 标签呈现；折叠/灰显样式在 @zcode/tui）。provider 侧 `thinking`/`redacted_thinking`（Anthropic）与 `reasoning_content`（OpenAI 系）在 bundle 各 10/7/5 处。
- 压缩：`compact.started/completed/failed/interrupted/skipped/retrying + Ctrl-R 重试`。
- workflow 卡片：`workflow.{collapsed, actors, actorRow, usage("usage: N tokens"), nodes("N/M steps settled"), result, log, expandHint:"+ to expand", collapseHint:"- to collapse", truncated:"(truncated - full history in the run journal)", interruptedNotice:"... /dwf resume ${id}", stopReason{user,model,provider,interrupted,superseded}}`。

### 5.3 工具调用卡片（core 预计算 display 对象）

- `createToolResultDisplay`（偏移 5152016）按工具产出类型化 display：
  - `bash_output`（`createBashResultDisplay`）：stdout+stderr 合并，**150KB 截断**、`truncated` 标记、`persistedOutputPath` 指向全量输出文件；backgrounded/图片结果不展示。
  - `file_diff`：`{filePath, additions, deletions, structuredPatch, truncated}`。
  - `cua`（computer use）、`node_repl_images`（≤4 张图、单图 256KB、总 512KB）、`local_agent_message`、`task_stop`、`task_output`（输出 8KB 上限 `Mot`）、`respond_to_coordinator`、MCP display（`createMcpToolDisplay/Ui`，文本 32KB）。
- 流式工具输入预览：`buildZCodeStreamingToolInputPreview`（偏移 1004882）从半截 JSON 里正则抠 `file_path/content/command/old_string/new_string/…` 常见字段，供 TUI 实时渲染工具参数；节流：Write/Edit 1000ms、其他输入每 750ms（≤8192 字符）或增长 ≥8192 字符即刷新。
- 命令展示脱敏：`sanitizeHookDisplayText` 将 token/authorization/密码类参数替换为 `••••`。

### 5.4 diff 渲染

- hunk 结构（`isDiffHunk`）：`{oldStart:number, oldLines:number, newStart:number, newLines:number, lines:string[]}`，行前缀 `+/-`。
- 生成：jsdiff（`Diff`/`LineDiff` 类）`structuredPatch`，5s 超时（`diffLineStat` 用它算增删行数；统计同时喂给 sidebar `modifiedFiles` 与 `turn_file_change` 汇总）。
- 上限（`boundDiffHunks`）：**最多 8 个 hunk、合计 160 行，超出 `truncated:true`**。TUI 对 `+/-` 行着色渲染（具体色值在 @zcode/tui）。

### 5.5 spinner / 状态行 / token 用量

- 状态行文案（`tui.status`）：`Ready.`、`Calling model...`、`Thinking...`、`Tool ${name} pending/running/completed/failed.`、`Compressing context...`、`Permission requested/resolved for ${tool}.`、`Session resumed.`、`Target ${goal}.`、`Turn failed.`。动画帧在 @zcode/tui（core 无 spinner 帧字符）。
- usage：`ModelComplete.usage` 聚合（`createModelUsageSummaryFromEvents`）；会话级 schema：`contextWindow {usedTokens, maxTokens, autoCompactThresholdTokens, cache, breakdown}` + `cumulative {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}`。sidebar 呈现：`context {Used, Window, Cache R/W, I/O, Reason}`、`cache {hit, last hit/miss, "N read / N write", total}`、`api {Requests, Model, Server, "+N more"}`、`run {Turn, Messages, Mode, Model, Provider, Thought, Trace, Workspace, Draft("N chars")}`；模型回复收尾状态 `responseReceivedWithTokens: "Model response received. N tokens."`。
- sidebar 区块（`sidebar.sections`）：`APIs / Context / MCP / Modified Files / Run / Status / Todos`；MCP 状态 `{connected/connecting/disabled/disconnected/failed/untrusted}`、`"N/M connected"`、`"N tools"`；subagents 面板（只读，`← Main conversation` 返回；状态 `running/waiting/blocked/completed/failed/cancelled/lost`）。

## 6. 确认对话框

### 6.1 待交互信封（`gYt` schema，偏移 744717）

```
{interactionId, kind: "permission"|"userInput"|"workspaceHookReview",
 anchorRowId: number|null,            // 对话框锚定在 transcript 行
 createdAt, autoResolution?, payload}
```

- permission payload（`lZi`）：`{toolCallId, toolName, summary, detail, freeText?, origin?, display?, fullAccessOption?, options[]}`。
- 选项 schema（`qpr`，偏移 743322）：`{optionId, label, kind: "allowOnce"|"allowAlways"|"deny"|"custom", response?}`；另有 `fullAccessOption`（optionId 固定 `fullAccess`）。策略提示 `askOptions.allowAlways: "session"|false`（只允许会话级记住 / 不允许记住）；`denyPriority:"beforeAsk"`、`alwaysAsk`。
- AskUserQuestion payload（`pZi`）：`{prompt, freeText, options[{optionId,label}]?, sensitive?, toolName?, toolCallId?, questions?: Question[], currentQuestionIndex?, answerDrafts?: Record<question, string[]>}`。
- Question schema（`dZi`）：`{question, header(≤12字符 chip), options: {value,label,description?,preview?}[] (2-4), multiSelect?}`——与工具 schema（`DF="AskUserQuestion"`，偏移 1431672）一致：label 1-5 词、header 是短标签、禁止自带 "Other"、标注 `{preview, notes}` 回传；preview 走 `validateAskUserQuestionPreview`（要求含 HTML 标签）。
- **AskUserQuestion 自动裁决**（`V4InteractionRegistry`，偏移 14848357）：`hiddenGraceMs=60_000`（先隐藏宽限）、`autoResolutionMs=300_000`（总 5 分钟倒计时）；状态机 `hiddenGrace → visibleCountdown(visibleAt, deadlineAt) / snoozed(snoozedAt)`；workspaceHookReview 明确禁止 auto-resolution。测试加速用 env 注入（`ZCODE_ENV=test`）。

### 6.2 UI 形态（由文案树推知）

- 权限弹窗是挂在 `anchorRowId` 的 transcript 内联卡：标题=工具名 summary，选项列表=各 option 的 label（如允许一次/总是（session）/拒绝），支持 `freeText` 附言；`selection.defaultHelp: "Enter selects, Esc cancels"`，filter 行支持输入过滤；状态行播报 `Permission requested for ${tool}.` / resolved。
- 选择器家族共用一套渲染：`row: "> item"` 选中标记（`row: ({selected}) => selected?">":" "+…`）、filter、Up/Down/Enter/Esc。登录设置、plugins 开关（`Type to filter, Up/Down choose, Enter toggles, Esc closes`）、/resume 会话选择、/fork /rewind checkpoint 选择、/mode 权限模式选择（"Picker rows and explicit input submit /mode <mode> commands"）、/effort composer 建议列表均复用。

## 7. 其他表现层相关事实

- 剪贴板写文本：OSC52（`\x1B]52;c;…`）+ 平台原生（macOS pbcopy；Linux wl-copy/xclip/xsel；Windows `powershell Set-Clipboard`），上限 1MB（`writeClipboardText`）。选中复制提示 `copy.copied/failed/unavailable`。
- 剪贴板读图片（`readClipboardImage`）：mac osascript / Linux wl-paste,xclip / Windows PowerShell `Get-Clipboard -Format Image` 存临时 PNG；上限 20MB，返回 `data:` URL。
- 无 TTY 直接退出：`terminal.requiresInteractive: "TUI requires an interactive terminal."`。
- stderr 拦截：`interceptTuiStderr` 缓冲 TUI 启动期 stderr 防止打断屏绘。
- `--no-color`、`developerMode`、`noColor` 传入 TUI；headless（`--prompt`）输出格式 `text|json|stream-json`（`--surface terminal|desktop`）。
- 输入附件：`normalizeTuiPromptInput`（string→{text}）、`projectInputHistoryAttachments`（恢复历史时同时还原附件）。
- TUI 命令注册表 `TF`（偏移 915178）共 20 条：help、login、logout、compact、init、expert(别名无)、effort(aliases variant)、dwf、fork、locale(aliases language)、mcp、plugins(aliases plugin)、mode、model、new(aliases clear)、resume(aliases continue)、rewind、skill、goal(aliases target)、workflow——与批次已记录一致。

## 8. 与 Drora 的对齐提示

1. **架构**：官方把"终端 UI"做成独立可分发包（SEA 资产 + manifest + sha256 校验 + 缓存解包），core 只暴露 host seam。Drora 桌面/web 的 TUI 复刻如需落地，建议同样以"文案目录 + 事件流 + display 预计算"三件套为接缝，渲染自研。
2. **文案目录**：可直接按 `tui.*` 键树补齐 Drora 的 en-US/zh-CN 文案（包括 zh 文案逐字对齐）。
3. **事件流**：`nt` 事件枚举是 UI 投影的完整输入清单；Drora `web-remote-replayable` 链路对齐时应逐事件核对（尤其 steer 队列族与 stream recovery 族）。
4. **display 预计算**：diff（8 hunk/160 行）、bash（150KB）、task_output（8KB）、MCP（32KB）、图片（4 张/256KB/512KB）的截断预算是 UI 端一致性契约，Drora 端建议数值对齐。
5. **AskUserQuestion**：option{label,description,preview} + header≤12 + autoResolution(60s/300s, hiddenGrace/visibleCountdown/snoozed) 是官方契约，Drora 的实现已高度一致（本次可确认 wire 层字段名一致）。
