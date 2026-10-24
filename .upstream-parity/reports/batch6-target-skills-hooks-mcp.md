# Batch 6 调研报告：Skills / Hooks / MCP 子系统（官方 bundle）

- 对象：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 字节，esbuild bundle）
- 方法：只读 grep/byte-offset 摘录；所有行号为字节偏移（`grep -bo`），摘录用 `tail -c +<offset>` 截取。
- 与既有结论的印证：hook 超时 60s / 输出上限 32768B、MCP `mcp__server__tool` 物化、needsApproval 恒真、Skill 工具描述均逐一确认。

---

## 1. Skills 系统

### 1.1 发现路径全表（`resolveDefaultSkillRoots`，offset 4215700 附近）

```js
async function cno(e,t={}){
  // extraRoots（config skills.roots，支持 ~/ 前缀、相对路径按项目根解析）→ {path, scope:"project", source:"zcode", priority:u()}
  // includeZcodeSkills（默认 true）→ sno(homedir, "user")
  // 项目目录链：从 cwd 向上走到 git worktree 根（findWorktreeRoot，以 .git 为标记），每一级目录都取 sno(dir,"project")
  // extraResolvedRoots（插件 skill roots 等）
}
function sno(e,t,n){
  return [ pgn(join(e,".zcode","skills"), t, "zcode", n()),
           pgn(join(e,".agents","skills"), t, "agents", n()) ]
}
```

- 目录常量：`ino="skills", KJs=".zcode", ZJs=".agents"`（offset 4215900 附近）。
- 即发现位置为：
  - `{home}/.zcode/skills`、`{home}/.agents/skills`（scope=user）
  - `{cwd}…{git root}` 每一级的 `.zcode/skills`、`.agents/skills`（scope=project）
  - `skills.roots` 配置的额外根（scope=project，source=zcode）
  - 插件 skills（scope=plugin，qualifiedName=`${pluginName}:${skill}`）
- 优先级：每根 +10（`JJs=10`），低值先扫描；同名先到先得（discoverSkills 按 priority 排序去重）。
- 技能文件固定为 `<skill 目录>/SKILL.md`（`mhe="SKILL.md"`）；`skillFilesUnderRoot` 允许 followSymbolicLinks。

### 1.2 内置 bundled skills（SEA/打包资产）

- `P8e="bundled-skills"`，探测路径 `packages/bundled-skills`、`../bundled-skills` 等（`Qoc`）。
- SEA 模式：资产键 `hQo="zcode-bundled-skills/"`、`eic="${hQo}manifest.json"`；manifest 校验 `{version:1, hash, files[]}`；落地目录种文件 `mMn=".zcode-bundled-skills-seed.json"` 记录 hash，`isSeedComplete` 校验后复用（sha256）。
- 动态工作流技能：`j_="dynamic-workflows"`；当 dynamicWorkflow 关闭时把 `skills/dynamic-workflows/SKILL.md` 加入 disabledPaths（`collectDynamicWorkflowDisabledSkillPaths`，offset 14109000 附近）。
- 官方插件市场：`https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`（id `zcode-plugins-official`）。

### 1.3 frontmatter 解析与校验（NodeSkillAdapter，offset 4215948 起）

- `extractFrontmatter`：首行 `---` 到下一行 `---` 之间的纯文本。
- `parseFlatYaml`：**仅扁平 key:value**；缩进行、注释跳过；支持块标量 `>`（folded）与 `|`（literal，含 `+`/`-` chomping 变体）；引号标量去引号（`parseScalar`）。
- 允许键集合：`nKs=new Set(["name","description","when_to_use","license","metadata"])`；`safeToAutoLoad = 所有键都属于该集合`。
- 校验错误码（diagnostics）：
  - `skill_read_failed`（warning）、`skill_invalid_frontmatter`（warning）
  - `skill_missing_name`（error；无 frontmatter 时回退目录名）
  - `skill_missing_description`（error，仅有 frontmatter 时强制）
  - `skill_description_too_long`（上限 1024 字符，`tKs=1024`）
- 其它常量：`rKs=1e5`、`oKs=5`（插件名向上探测层数）、插件 manifest 候选 `iKs=[".zcode-plugin/plugin.json",".claude-plugin/plugin.json",".codex-plugin/plugin.json",".cursor-plugin/plugin.json"]`。
- 插件技能：`resolvePluginSkillAlias` → `pluginName` + `qualifiedName="${pluginName}:${name}"`；匹配名可写裸名或 qualifiedName（`matchesSkillRequest`）。
- 每技能 `policy.allowImplicitInvocation=true`（可被模型自主调用）。

### 1.4 注入与触发

- 配置（默认值，`Fm`）：`skills:{enabled:true, includeInstructions:true, metadataBudget:2e4(=20000), roots:[]}`；开关 `features.skill`（默认 true，与 `skills.enabled` 同时要求）；Zod：`WGs=m.object({enabled,includeInstructions,metadataBudget,roots}).catchall({enable})`（允许 `skill.<name>.enable` 覆盖）+ `skillOverrides`。
- 注入块（`buildSkillsSection`/`Yla`，offset 4942737）：
  - 名称 `"Skills"`、`source:"skills"`、`injectionTarget:"meta_user"`、`cacheHint:"dynamic"`。
  - 头部 `The following skills are available for use with the Skill tool:`，按显示名排序。
  - 行格式：`- ${qualifiedName??name}: ${description} - ${whenToUse} (file: ${path})`；qualified 与裸名不同时追加 ` (also loadable as ${name})`。
  - 单行 description 截断 250 字符（`Zla=250`）；总量超 metadataBudget(20000) 时退化为 `- name (file: path)` 紧凑列表。
- Skill 工具（offset 7718400 附近）：
  - `name:"Skill"`，`readOnly:true, needsApproval:false, permission:"skill", riskLevel:"low", sideEffectScope:"session"`，timeout 30s（不可覆盖）。
  - 输入 schema 为联合：`{skill, args?}` 或旧版 `{name, args?}`。
  - handler `RIa`：`skillPort.loadSkill({name, workingDirectory, maxBytes})`；`maxBytes = skillMaxBytes(name)`：dynamic-workflows 2e5(200KB)，其它 1e5(100KB)；输出预算 `Myt=2e5+4096=208896`。
  - 输出：`<skill_content name="...">` + `# Skill: ...` + 内容 + `Base directory for this skill: ...`；`truncated` 时加 `[Skill content truncated]`。
  - 模板变量：`expandSkillContextVariables` 把 `${CLAUDE_SKILL_DIR}` 与 `${ZCODE_SKILL_DIR}`（双命名空间）替换为技能目录。
  - 内容为剥离 frontmatter 后的 SKILL.md 正文（`stripFrontmatter`）。
- TUI：`/skill [<skill-name> [task]]` — 列出 skills 或强制下一个 prompt 加载某技能；会话级 guidance：用户输入 `/<skill-name>` 时应经 Skill 工具调用，只可用 user-invocable 列表内技能。

### 1.5 CLI：`skills list|inspect`

- Usage：`pfi="Usage: zcode skills [list|inspect <name>]"`（`runSkillsCommand`，offset 15054700 附近）；CLI help 亦列 `skills  List local skills (skills list)`（中英双语）。
- `skills list` 人类输出：`Available skills (N)`，每项 `- ${qualifiedName??name} (${scope}/${source}; alias ${name})` + 描述（description+whenToUse）+ path；`--verbose` 附 `Diagnostics` 列表；`--json` 输出 `{cwd, diagnostics, skills:[{description,directory,name,path,...}]}`。
- `skills inspect <name>`：输出 Skill 名、scope/source、path、directory、description、pluginName、qualifiedName、whenToUse、`safeToAutoLoad: yes/no`、`size: bytesRead/sizeBytes bytes(truncated?)`、正文 Content；底层 `inspectZCodeSkill`。
- **官方无 skills_lock.json 机制**：`grep skills_lock/skills-lock/computedHash` 在 bundle 中为 0 命中；本仓根 `skills-lock.json`（`{version, skills:{name:{source, sourceType:github, computedHash}}}`）为 Drora 自研（skill 安装/来源锁定），上游不存在，需要在 spec 中标注差异。

### 1.6 自定义命令（与 skills 同构的姐妹系统）

- `resolveDefaultCustomCommandRoots`：`{home}/.zcode/commands`、`{home}/.agents/commands` + 项目各级同名目录（常量 `_no="commands"`）；CLI `commands list`；`NodeCustomCommandAdapter`。`/init` 写 `~/.zcode/AGENTS.md` 或项目 `.zcode/AGENTS.md`。

---

## 2. Hooks 系统

### 2.1 事件全表（唯一权威枚举 `Tl`，offset 4173470 附近）

```js
Tl={SessionStart:"SessionStart", UserPromptSubmit:"UserPromptSubmit", PreToolUse:"PreToolUse",
    PermissionRequest:"PermissionRequest", PostToolUse:"PostToolUse",
    PostToolUseFailure:"PostToolUseFailure", Stop:"Stop"}
```

- 共 7 个事件。**没有** SubagentStop / SessionEnd / PreCompact / Notification 作为 hook 事件（bundle 中 `SubagentStopped` 是 trace 事件名、`SessionEnded` 是会话生命周期事件，与 hooks 无关；`PostCompact` 是 UI/压缩事件）。
- 插件 hook 事件校验 `XKs=new Set(Object.values(Tl))`，不支持的事件报 warning `plugin_hook_unsupported_event`。

### 2.2 配置文件位置与格式

两处同构 schema（同一 zod，两份定义）：
- CLI 用户配置：`~/.zcode/cli/config.json` 的 `hooks` 键（schema `YGs`，offset 4176576 起）。
- 项目工作区配置：`.zcode/config.json` 与 `zcode.json`（schema `zoe`，offset 4191976 起；`configFileKind` 判定 `zcode.json` / `.zcode/config.json`，仅项目根的 `.zcode/config.json` 可在 UI 编辑）；发现算法从 workingDirectory 向上到 git worktree 根逐级查找（`discoverWorkspaceHookConfigPaths`），支持 explicitProjectConfigPath。
- 插件：`<plugin>/hooks/hooks.json`（`YKs`）或 plugin.json 的 `hooks` 键（字符串路径/数组/对象均可）。

```js
hooks = {
  enabled?: boolean, timeoutMs?: number, maxOutputBytes?: number,
  events?: {
    SessionStart | UserPromptSubmit | PreToolUse | PermissionRequest |
    PostToolUse | PostToolUseFailure | Stop ?: Array<{
      matcher?: string(min1),
      hooks: Array[
        {type:"process", command, enabled?, args?: string[], timeoutMs?, statusMessage?}
        {type:"command", command, enabled?, async?, shell?: true|string, timeout?|timeoutMs?, statusMessage?}
      ]
    }>
  }
}
```

- 默认：`kJs=6e4`（超时 60000ms）、`xJs=32768`（maxOutputBytes），可在 hooks 层覆盖；单条 hook 的 `timeout`（秒）×1000 或 `timeoutMs` 可再覆盖（`resolveHookTimeoutMs`，最小 1ms 四舍五入）。
- 工作区 hooks 有信任机制：信任存储 `<storage|~/.zcode>/security/workspace-hook-trust-v1.json`（`FileWorkspaceHookTrustStore`）；未信任时 admission 拒绝（reasonCode `workspace_hooks_blocked_untrusted`，fail-closed）；有 review/审批流（WorkspaceHookReview* 类族）。
- 项目 hooks 按 `hookDeclarationDigest` 去重，插入顺序：工作区 hooks 插到第一个非 user 来源之前（`insertWorkspaceHooks`）。

### 2.3 matcher 语法（`matchesHookMatcher`，offset 5174084）

```js
function Cho(value, matcher){
  if(!matcher || matcher==="*") return true;
  if(!value) return false;
  if(/^[a-zA-Z0-9_|]+$/u.test(matcher)) return matcher.split("|").includes(value);
  try { return new RegExp(matcher).test(value); } catch { return false; }
}
```

- 与 Claude Code 一致：`*` 全匹配；纯 `[A-Za-z0-9_|]` 按竖线分割做精确集合匹配；否则当正则（非法正则视为不匹配）。
- 事件注册时记录 `matchValue`（如 SessionStart 的 source、工具事件的 tool name，含别名 matchValues），`matchesAnyHookMatcher` 对 matchValues 任一命中即运行。

### 2.4 命令执行环境（`createConfiguredHookCallback`，offset 5182199）

- `type:"command"` → executionPort `mode:"shell"`，`shell` 为 true（默认 shell）或指定 shell 字符串；`async:true` 的 command 归类为 background（`executionMode:"background"`）。
- `type:"process"` → `mode:"argv"`（file+args，逐个做变量展开）。
- cwd：事件携带 cwd 或会话 workingDirectory。
- 环境变量注入（`createPluginEnvOverlay`，offset 5169000 附近）——**Claude 兼容双命名空间**：
  - 基础：`CLAUDE_CODE_SESSION_ID`、`CLAUDE_PROJECT_DIR`、`CLAUDE_SESSION_ID`、`ZCODE_PROJECT_DIR`、`ZCODE_SESSION_ID`
  - 插件 hook 额外：`CLAUDE_PLUGIN_DATA`、`CLAUDE_PLUGIN_ROOT`、`ZCODE_PLUGIN_DATA`、`ZCODE_PLUGIN_ID`、`ZCODE_PLUGIN_NAME`、`ZCODE_PLUGIN_ROOT`
- 命令串模板变量（`expandPluginVariables`）：`${CLAUDE_CODE_SESSION_ID|CLAUDE_PLUGIN_DATA|CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR|CLAUDE_SESSION_ID|CLAUDE_SKILL_DIR|ZCODE_PLUGIN_DATA|ZCODE_PLUGIN_ROOT|ZCODE_PROJECT_DIR|ZCODE_SESSION_ID|ZCODE_SKILL_DIR}`；`*_SKILL_DIR` 在非技能上下文抛 ConfigurationError（仅技能相关 hook 可用）。
- stdin（`createCompatibleHookStdin`，offset 5167300）——兼容 Claude Code JSON：
  - 公共：`hook_event_name`、`session_id`、`permission_mode`、`agent_type`、`transcript_path`（临时目录 `zcode-hook-*/transcript.jsonl`，用后删除）
  - 工具事件：`tool_name`、`tool_input`、`tool_use_id`
  - PermissionRequest：`permission_suggestions`；PostToolUse：`tool_response`
  - PostToolUseFailure：`error_details`、`error`（message）、`is_interrupt`
  - Stop：`last_assistant_message`、`stop_hook_active`；SessionStart/UserPromptSubmit：仅公共字段（prompt 不入 stdin，但 transcript 含 user 行）
  - transcript JSONL 行格式：`{"message":{"content":[{"text":...,"type":"text"}],"role":"user"|"assistant"}}`（Stop 写 assistant 最后消息；UserPromptSubmit 写 user prompt）
- 运行时装配（`createRuntimeHookRunner`，offset 13409841）：`hooks.enabled || workspaceHookSnapshot` 时用 `createConfiguredHookRunner`（executionPort + emitEvent appendEvent）；另有 Session mailbox drain 作为内置 hook 挂在 **UserPromptSubmit/PostToolUse/Stop** 三个事件上（`Pgt`，drainUnread 后：PostToolUse 逐条 `steerTurn(delivery:"guide")` 入队，UserPromptSubmit/Stop 以 `hookSpecificOutput.additionalContext` 注入，Stop 事件附 `continue:true`）。

### 2.5 超时 / 并行 / 输出语义

- 超时：默认 60s（可配置）；`createHookTimeoutError` → ToolTimeout "Hook timed out after Nms"（recoverable）；取消 → ToolCancelled。
- 输出上限：maxOutputBytes 默认 32768B（stdout/stderr buffer 双限）。
- exit code 语义（`processHookExecutionResult`）：
  - `0` → stdout trim 后若以 `{` 开头则按 `HookJSONOutput` schema 解析（校验失败抛 "Hook stdout failed HookJSONOutput schema validation"）；非 JSON 输出忽略
  - `2` → 阻断（`createExitCodeBlockOutput`）：PreToolUse → `permissionDecision:"deny"`；PermissionRequest → `decision:{behavior:"deny", message}`；Stop → `decision:"block"`；其它事件 → `continue:false`；理由取 stderr（缺则 stdout，缺则 "Hook blocked execution"）
  - 其它 → 抛 "Hook process failed"（recoverable），带 exitCode/stderrPreview/stdoutPreview（预览各 4KB）
- JSON 输出语义（`processHookOutput`，offset 5172364）：
  - `continue:false` → blockRequested；对 PreToolUse/PermissionRequest/UserPromptSubmit 附加 preventContinuation；对权限事件 → deny
  - Stop 事件 `continue:true` → `stopShouldContinue`（配合 `shouldContinueAfterStopHooks`：最多连续 3 轮 stop-hook 续跑，`qja=3`；lifecycle additionalContext 截断 24000 字符）
  - `decision:"approve"`（权限事件）→ allow；`decision:"block"` → deny + block
  - `additionalContext` / `additional_context`（两种拼写都收）
  - `hookSpecificOutput:{hookEventName, permissionDecision, permissionDecisionReason, updatedInput, decision}` —— hookEventName 与当前事件不符抛错；PreToolUse 支持 `updatedInput` 改写工具入参（有 `recheckPermissionHookModifiedInput` 复核）
  - 多 hook 合并：permissionBehavior 取最强（deny > ask，`mergePermissionBehavior`）
- 每事件调用点：
  - SessionStart：会话启动/恢复时 `runSessionStartHooks(source)`，source∈startup/resume（matcher 匹配 source），上下文注入 message history（`injectHookAdditionalContextIntoMessageHistory`）
  - UserPromptSubmit：`runUserPromptSubmitHooks(prompt, attachmentsSummary)`，可阻断
  - PreToolUse：工具准入前（matchValue=tool name+别名），可 allow/deny/ask、改参、注入 context
  - PermissionRequest：权限询问时 `Qfo`（requestId/riskLevel/sideEffectScope/suggestions），decision 决定 allow/deny
  - PostToolUse / PostToolUseFailure：工具完成后/失败后，仅 additionalContext + 诊断
  - Stop：`runStopHooks(modelResponse, toolCallCount, stopHookActive)`，可 block（feedback reason）或 continue 续跑
- 遥测事件：`hook.admission.failed_closed`、workspace hook review 流；descriptor 有 clientVisible/statusMessage/commandDisplay（URL 凭据打码）。

---

## 3. MCP 系统

### 3.1 传输支持（schema offset 4174050 附近）

```js
stdio: {type:"stdio", command, args?, cwd?, env?}
http:  {type:"http", url, headers?, oauth?, ...Ghn}     // "remote" 会被规范化为 "http"
sse:   {type:"sse", url, headers?, oauth?, ...Ghn}
Ghn = {protocolVersion?: "auto"|"legacy"|"2026-07-28", enabled?, timeoutMs?}
```

- `normalizeMcpServerConfigInput`（offset 4168990）兼容别名：`environment→env`、`enable/enabled` 合并、`type:"remote"→"http"`、无 type 时按 command/url 推断 stdio/http、`http_headers→headers`；`timeout`、`startup_timeout_sec` 被接受后丢弃。
- 底层为 MCP SDK `StdioClientTransport`（cross-spawn，spawn env 白名单：win32 APPDATA/HOMEDRIVE/HOMEPATH/LOCALAPPDATA/PATH/PROCESSOR_ARCHITECTURE/SYSTEMDRIVE/SYSTEMROOT/TEMP/USERNAME/USERPROFILE/PROGRAMFILES；unix HOME/LOGNAME/PATH/SHELL/TERM/USER）+ 自定义 `ProcessTreeStdioClientTransport`：
  - Windows：koffi 加载 kernel32 建 Job Object 绑定子进程树，退出时 TerminateJobObject
  - POSIX：pgrep/ps 收集进程树，SIGINT→SIGTERM→SIGKILL 分级终止
  - 每请求 `_meta` 合并 `com.zcode/request-context`（trace_id/span_id/session_id/turn_id/workspace_path/workspace_identity/remote_session_id 等）
- 协议版本协商：auto（探测，超时为 timeoutMs/2 下限 5000）/ legacy（sse 或显式）/ pin "2026-07-28"。
- 认证：http/sse 支持 OAuth（默认 authorization_code，headers 已含 authorization 则跳过；client_credentials 可选）；官方服务器 `auth:{type:"zcode_official", provider:"jwt_token"}` + `official` 标志（OfficialMcpAuthError、x-request-id/x-trace-id 头、响应分类 classifyOfficialMcpResponse、64KB 响应文本上限）。

### 3.2 服务器配置来源与合并优先级

`resolveEffectiveMcpServers`（offset 4201889）——后者覆盖前者：
1. `system`（内置默认 `Fm`）
2. `project`（项目 config）
3. `user`（`~/.zcode/cli/config.json` 的 `mcp.servers`，`mcp:{servers:Record<name,server>}`）
4. `env`（envConfig）
5. `cli`（CLI 覆盖）

插件来源（`resolvePluginMcpServers`，offset 4232403）：
- 插件根 `.mcp.json` 文件，或 plugin.json `mcpServers` 键（字符串路径/数组/对象），命名空间化为 `plugin:${manifest.name}:${server}`（`$Ks`）。
- 插件内变量展开：`${CLAUDE_PROJECT_DIR|ZCODE_PROJECT_DIR}`→workingDirectory、`${CLAUDE_PLUGIN_DATA|ZCODE_PLUGIN_DATA}`→dataPath、`${CLAUDE_PLUGIN_ROOT|ZCODE_PLUGIN_ROOT}`→rootPath、外加 manifest `userConfig` 默认值/插件 options（allowSensitive 通道）；env 额外注入 `ZCODE_PLUGIN_ID`。
- 诊断码：`plugin_mcp_read_failed`、`plugin_mcp_invalid`、`plugin_variable_missing`、`plugin_mcp_server_disabled`、`config_mcp_server_invalid`（"MCP server config skipped"）。
- 官方 image-search 插件即远程 HTTP MCP：插件 seed `requiredSeedPaths:[".mcp.json"]`；`ZCODE_BASE_URL`（或 `ZCODE_ENDPOINT_ORIGIN`/`ZCODE_TEST_BASE_URL`/`ZCODE_PRODUCTION_BASE_URL`）是全局 endpoint 环境变量，插件 `.mcp.json` 内引用其 origin（`${ZCODE_BASE_URL}/api/v1/mcp/server/image_search` 形态由 seed 提供，bundle 本体只含 env 解析）。
- Agent/会话级：agent frontmatter `mcpServers:` 列表（父服务器名子集，`agent_invalid_mcp_servers`）；desktop 协议消息可按 workspace 传 `mcpServers` 列表（mode connect|status）。
- 内置 MCP 服务器：`node_repl`（source "builtin"，`mcp__node_repl__js` 工具）、官方 computer-use（`plugin:computer-use:computer-use`，别名 `mcp__computer-use__<tool>`/`mcp__computer_use__<tool>`）。

### 3.3 连接生命周期（`createMcpConnectionPool` + `NodeMcpAdapter`，offset 4836641/4863953）

- 连接池：idleGraceMs=30000（`Daa=3e4`），引用计数归零后延迟关闭；连接键 `[serverName, workspaceKey|leaseId, stableStringify(config)]`（isolation 默认 "workspace"，workspaceKey=`workspaceIdentity?.trim()||workingDirectory?.trim()`，与会话 isolation="session" 二选一）。
- 复用与重验：取池内连接时 `revalidateEntry` —— status 仍 connecting/disabled/untrusted 则跳过；connected 则 `pingServer` 心跳，失败视为 stale 重连（`connectServer`）。
- `connectServer`：per-server generation 计数、AbortController；`enabled:false` → status "disabled"；状态机 connecting→connected/failed；`connectConfiguredServers` 并发连接并输出 `{statuses, tools}`（遥测 session_startup: configured/connected/failed/processCount）。
- 工具列表：`listTools()` 汇总所有池内连接；`notifications/tools/list_changed` → `toolListRevision` 递增（触发上层刷新）。
- stdio 进程遥测：CPU/RSS 采样（`createMcpResourceTelemetry`，含孤儿进程检测 orphanSuspected/unownedSeconds）、进程崩溃/启动事件、mcpId = `builtin:`/`plugin:`/`custom:HMAC12`。

### 3.4 工具物化与权限（`UCn`，offset 12744500 附近）

- 名称：`mcp__${sanitize(server)}__${sanitize(tool)}`，sanitize = 非 `[a-zA-Z0-9_-]`→`_`（`toModelVisibleMcpNamePart`）；工具可带 `name` 覆盖。
- **`needsApproval` 恒为 `true`（`w=!0` 字面量）**，permission 元数据：`permission:"mcp"`、`reason:"MCP tool ${server}/${tool} executes through an external server"`、`patternSources:["toolName","input","network"]`、`denyPriority:"beforeAsk"`；official CUA 工具另加 `permissionCapabilityGroup` + `modelContentProtection`。
- 风险/副作用：`sideEffectScope` 默认 "network"；node_repl 的 js 工具为 "system"+riskLevel high+专属 `permission:"node_repl"`；readOnly/destructive/idempotent/openWorld hint 来自 annotations（readOnly→low risk、concurrentSafe）。
- 超时：`timeoutMs = tool._meta.timeoutMs（clamp [1000, 1800*1000=30min]）?? server.timeoutMs ?? 3e4(30s)`（`readToolMetaTimeoutMs`，`Qye=3e4`）；timeout.defaultMs 可被 call 覆盖。
- 结果预算：普通 `maxInlineBytes 1e5 / maxModelBytes 5e4 / truncate head`；node_repl js：1MB inline/64KB model/artifact tail 64KB；official CUA：256KB。
- providerVisible：命中 disallowedTools/模型隐藏（如仅 UI 工具）时置 `providerVisible:false`。
- elicitation：支持（mode `form`/`openai/form`，`requestMcpElicitation`）；`notifications/message` 进度等通知有 channel。
- MCP Apps（UI 扩展）：`_meta.ui.resourceUri`、`ui/resourceUri`、`openai/outputTemplate`（`AAr` 解析，elicitation schema 白名单 `["form","openai/form","openaiForm"]`）；`McpUiAppToolRegistry`、资源订阅（resources/updated、resources/list_changed、subscribeResource/unsubscribe，registry by server）。

### 3.5 resources / prompts 支持情况

- **resources：支持**——adapter 有 `readResource/listResources/listResourceTemplates/subscribeResource/unsubscribeResource`，池 API 同步暴露；不支持时抛 "MCP adapter does not support resources"。
- **prompts：未接入**——bundle 内 `listPrompts/prompts/*` 均为 MCP SDK Client 自带 schema；NodeMcpAdapter 与工具注册层无 prompts 调用（无 prompts 面板/工具）。
- TUI `/mcp` 命令（`handleMcpCommand`，offset 15019826）：`/mcp [list|status|connect <server>|disconnect <server>]`；状态行格式 `${name}: ${status} via ${transport}; ${N} tools(${error})`；无服务器时 "No MCP servers configured."。桌面端另有 mcp-sync/MCP 面板协议消息（`workspace mcpServers mode:connect|status`）。

---

## 4. LSP 与其它扩展点

- **LSP：无运行时实现**。`"LSP"` 字符串全 bundle 仅 1 次，出现在官方工具名词表 `HLa=new Set(["Agent","AskUserQuestion","Bash","CronCreate",...,"LSP","NotebookEdit",...,"Workflow","Write"])`（offset 12960653）——仅用于 allowed-tools/disallowed-tools 等名称识别；无 `name:"LSP"` 工具定义、无 textDocument/* LSP 客户端代码。结论：官方 CLI 在该版本未实现 LSP（词表为官方全量工具名，或保留名）。
- 插件组件能力分级（plugin validate 输出，offset 4232000 附近）：
  - `runnable`: skills / commands / hooks / mcpServers / userConfig
  - `diagnosticOnly`（识别但不运行）: agents / **lspServers** / outputStyles / channels / settings
  - `unsupported`: mcpb / dxt / npm / hostPattern / pathPattern
- 插件 manifest 探测路径：`.zcode-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、`.cursor-plugin/plugin.json`；市场源类型 url/github/git/npm/file/directory；`extraKnownMarketplaces` 可扩展。
- 其它扩展点：custom slash commands（`.zcode/commands`、`.agents/commands`）、agents 组件（子代理）、`channels`（识别不运行）、`outputStyles`（识别不运行）、hooks/hooks.json、userConfig（插件级用户配置默认值，进入 MCP 变量展开）。

---

## 5. 与 Drora 侧的对照要点（供 parity 甄别）

| 项 | 官方 | Drora | 判定 |
| --- | --- | --- | --- |
| `skills-lock.json` | 无（0 命中） | 仓根存在 `{version, skills:{source, sourceType, computedHash}}` | 自研扩展，需 spec 记录 |
| skills 路径 | `.zcode/skills` + `.agents/skills`（home/project 逐级 + skills.roots + 插件） | 同结构 | 对齐 |
| frontmatter | 扁平 YAML，键 name/description/when_to_use/license/metadata，description≤1024 | 待核对 | — |
| hooks 事件 | 恰 7 个：SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop | 已知 4+mailbox 3 | 对齐 |
| hooks 默认 | 60s / 32768B / exit 2=block / JSON schema 输出 | 已知 | 对齐 |
| MCP 传输 | stdio/http/sse（remote→http 别名） | 待核对 | — |
| MCP prompts | SDK 有、app 未接 | 待核对 | — |
| LSP | 无实现（仅工具名词表保留名） | 无 | 对齐（均无） |

### 主要证据偏移表

- skills roots：offset ~4215700（`cno/sno/pgn/eKs`）
- frontmatter：offset 4215948（`sKs/cKs/hgn`），允许键 `nKs`、上限 `tKs=1024`
- bundled skills：offset ~14103200（`S1t/hQo/eic/mMn`）
- Skills 注入：offset 4942737（`Yla/Xla`，`Kla=2e4/Zla=250`）
- Skill 工具：offset 7717270–7718566（`DIa/RIa/vxo`）
- CLI skills：offset 15053119–15054700（`Ayc/Ryc/Dyc/_At`）
- hooks schema：offset 4176576（CLI）与 4191976（workspace `zoe`）
- 事件枚举 `Tl`：offset ~4173470；默认 6e4/32768：offset ~1627000（`kJs/xJs`）
- matcher：offset 5174084（`Cho`）；输出语义：offset 5172364（`Tho`）、5182199（`Oho/Rho/kma/xma`）
- stdin/env：offset 5167300（`bSn/SSn/Rve`）
- mailbox drain：offset 13409841（`LBa/Pgt`）
- Stop 续跑上限 3：offset 13186880（`qja=3`）
- MCP schema/normalizer：offset 4168990–4174503（`XGs/Ghn/Mto/jGs`）
- 合并：offset 4201889（`zJs`）；插件 MCP：offset 4232403（`vdt/VKs/$Ks`）
- 池/适配器：offset 4836641（pool）、4863953（NodeMcpAdapter）
- 工具物化：offset 12744500（`UCn`，`w=!0`）、命名 12741951（`aD/N8`）、meta 超时 4806608（`Usa`，1e3..1.8e6）
- /mcp 命令：offset 15019826（`wpi/z_c/k4n`）
- LSP 词表：offset 12960653（`HLa`）；插件组件分级 offset ~4232000（compatibility）
