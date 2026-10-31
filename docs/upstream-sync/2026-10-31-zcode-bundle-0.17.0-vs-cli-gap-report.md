# 官方 zcode.cjs（0.17.0 发行 bundle）vs Drora CLI 差距收集与修复对齐报告

日期：2026-10-31。对比对象：`D:\software\zcode\resources\glm\zcode.cjs`（15,242,397 字节 / 15,678 行，`apps/zcode-cli/packages/cli/dist/zcode.cjs`，版本 0.17.0；同目录 debug bundle 为 0.16.9）与本仓 `apps/drora-cli`（源码树同步基线 v3.16.1，见 `specs/upstream-v3.16.1-migration.md`）。

方法：12 个批次、每批 2 个只读 subagent（共 24 个），分域收集两侧实现事实（入口/主循环/工具框架/文件工具/权限/持久化/子 agent/MCP/插件技能命令 Hooks/配置遥测/TUI/其余内置工具），关键不确定项由主流程用 grep 差分复核。字面量族差分用 `node scripts/check-bundle-key-parity.mjs <zcode.cjs> <drora.cjs>`，退出码 0。

## 总体结论

CLI 与官方 bundle 高度同源：24 项 sqlite migration 同名同序、工具注册/调度/权限判定/规则匹配逐常量一致、bundle 字面量族差分为 0（metaKeys/permissionKeys/diagCodes 完全一致；env 键唯一差异经归一化确认是自研 `DRORA_AGENTS_TEAM`，非残留）。确认缺口集中在 **0.17.0 相对 v3.16.1 源码基线的新增面**（native MCP 直传、MCP prompts/sampling、anthropic context_management），另有少量逐常量待甄别项。

## 一、确认缺口（P1，建议下轮 upstream 源码同步吸收，不从 bundle 反推）

| # | 缺口 | 官方证据（bundle 偏移） | 我方现状 | 修复方向 |
|---|---|---|---|---|
| 1 | anthropic 请求 `mcp_servers` 直传 + beta 头 `mcp-client-2025-04-04` | @3587025 schema（`{type:"url",name,url,authorizationToken,toolConfiguration}`）；@3604051 序列化；@3606533 beta 头 | 全仓无 `mcp-client-2025-04-04`；`mcp_servers` 仅出现在 plugin-reference 提醒文案（`core/src/plugin-reference/reminder.ts:163`）与 frontmatter 字段 | 按「官方实现优先」在下轮源码同步吸收请求构造/序列化；本地配置的 MCP 仍走桥接（官方 bundle 内也无本地自动转 native 的构造方） |
| 2 | MCP prompts 能力（`prompts/list`、`prompts/get`） | @4918484 区 callTool 同层 prompts API | `adapters/src/mcp` 与 `contracts/src/interfaces/mcp.port.ts` 均无 prompts 面 | 同上；先甄别 3.16.1 源码是否已有，区分「未吸收」与「0.17.0 新增」 |
| 3 | MCP sampling 能力 schema | @809737 区 sampling schema（messages/systemPrompt/maxTokens/modelPreferences） | 我方 client capabilities 仅声明 MCP Apps UI + `elicitation:{form:{}}`（`adapters/src/mcp/index.ts:1538-1544`），无 sampling | 同上 |
| 4 | anthropic 响应 `context_management.applied_edits`（`clear_tool_uses_20250919`/`clear_thinking_20251015`/`compact_20260112`）解析 | @2086 usage 块解析 | `adapters/src/model` 无 contextManagement 解析（我方的 `context_management` 是动态提示 section id，另一概念） | 同上；影响 usage 口径（服务端清理后 input tokens 的解释） |

## 二、待甄别项（P2，下轮同步前逐条对拍上游源码，再判缺口/有意分歧并登记台账）

1. **项目级 MCP 信任**：官方项目 MCP 默认进入 `untrustedProjectMcpServers`、需显式 connect（@14161607）；我方未见该流程，且有「user 影子覆盖 project」的 MCP 合并规则（`adapters/src/config/config-factory.ts:383-394`）。
2. **WebFetch 输出 schema**：官方含 `finalUrl/redirects[]/cacheHit/artifactUri/truncated`（@1444690）、跨域重定向文案 "To complete your request, I need to fetch content from the redirected URL..."（@7761600）、HTTP 错误附 Retry-After 提示；我方为 "REDIRECT DETECTED..." 文案、无 redirects[] 字段。
3. **WebSearch 结果字段**：官方 results 含 `encryptedContent/type:"web_search_result"`，provider 层支持 `userLocation`（@3591350）；我方无。
4. **Read 二进制/设备黑名单**：官方 schema 级拒绝 `.7z/.exe/.zip/...` 与 `/dev/*` 设备（@1428076）；我方无扩展名/NUL 拒绝，改为编码探测（utf8/utf16le/gb2312/gbk/gb18030，后者为自研增强）。
5. **Edit 匹配策略链**：官方 9 策略链 `exact→quote_normalized→line_number_prefix_stripped→escape_normalized→unicode_escape_normalized→line_trimmed→indentation_flexible→block_anchor`（@7398268）；我方 `core/src/tool/edit-matchers.ts` 命名不同，需逐策略对拍等价性。
6. **结果预算/超时常量**：官方 Write `maxOutputBytes:1e6`、Read `timeout{defaultMs:3e4,maxMs:15e4,allowCallOverride:false}`；我方 Write maxModelBytes 100_000、Read 30s 固定。
7. **PDF 页数阈值**：官方 >20 页必须给 `pages` 且开区间计数为 21 即拒；我方 `READ_PDF_NATIVE_MAX_PAGES=10`（>10 页须 pages）、20 页/请求。
8. **TodoWrite「至多一个 in_progress」**：官方描述明示该约束；我方旧 superRefine 被注释禁用（`contracts/src/tools/todo.ts:60-70`）。需裁定恢复或登记台账。
9. **todo_reminder 注入节奏**：官方 reminder 类别 `("current_turn","per_current_turn")`（@4957094）；我方 `TURNS_SINCE_WRITE=10/TURNS_BETWEEN_REMINDERS=10`（`core/src/runtime/helpers/runtime-reminders.ts:81-84`）。需对拍官方实际注入时机。
10. **workspace hook 信任状态**：官方 7 态（`not_applicable/pending_trust/trusted_persistent/blocked_untrusted/blocked_policy/revoked/stale_digest`，@744336）；我方 2 态 + store 损坏 fail-closed。
11. **MCP OAuth 多进程协作**：官方 lead/follow 事务（follow 500ms 轮询）、refresh 锁文件 45s、InvalidGrant/InvalidClient 分支；我方 `oauth-refresh.ts/oauth-lease.ts` 未逐行核对。
12. **AskUserQuestion wire 差异**：我方把 `multiSelect` 强制加入 provider schema required；官方为 optional 默认 false。
13. **TUI 细节**：Shift+Tab 模式轮换集合（官方 0.16.9 TUI 帮助为 build/edit/plan/yolo；我方 `tui/src/app-mode.ts:5` 为 plan/build/guarded/yolo）；Ctrl+C 提示文案（"Press Ctrl-C twice to exit" vs "Press Ctrl-C again to exit."）。
14. **凭据加密**：官方 `~/.zcode/v2/credentials.json` aes-256-gcm `enc:v1:` + `ZCODE_CREDENTIAL_SECRET` 回退串；我方 SharedDroraCredentialStore 的加密方案未核对。
15. **baseURL 自动补 `/v1`**：官方 `C5s`（行 2132）；我方是否等价未核实。
16. **streamingToolExecution 默认值装配**：我方已实现（`core/src/runtime/types.ts:137`、`streaming-tool-coordinator.ts`），但默认 "readOnly" 的装配点未逐行核对（官方默认 `cBa="readOnly"`）。

## 三、收集期误报澄清（subagent 漏报，实际对齐，勿再列为缺口）

- `streamingToolExecution`/during_stream 流式期间只读工具提前执行：我方有。
- `shell-snapshots`（posix/git-bash rc 快照）：我方有（`adapters/src/exec/shell-init-snapshot.ts:65`）。
- 子 agent maxTurns 强制执行：我方有（`error_max_turns` 见 `core/src/agent/turn-state.ts:155`、`contracts/src/events/session.events.ts:657`）。
- Stop hook 续跑上限：双方均为 3（我方 `core/src/runtime/methods/hooks.ts:10` `MAX_STOP_HOOK_CONTINUATIONS=3`）。
- 插件 manifest 探测 `.cursor-plugin/plugin.json`：我方有（`adapters/src/skills/index.ts:34`）。

## 四、有意分歧确认（已对齐台账/新建议登记）

台账内（`specs/drora-divergence-ledger.md`）：CLI 版本恒 0.0.1（台账 1）、auto→build 任务模式投影（台账 2）等。本报告确认的其余有意分歧/自研扩展，建议按台账四要素补登记：

- provider 配置 revision 33 领先官方 revision 30：多出 `highspeed-card`（hidden）与 `xiaomi-mimo-token-plan`（`config/provider/drora-builtin.json`）。
- MCP 合并「user 影子覆盖 project」规则（`config-factory.ts:383-394`）。
- 自研工具/命令面：VaultSearch、ReplyToChannel、team 模块、动态工作流 11 件套、`/init /workflow /team /effort /locale` 斜杠命令；官方 Task 工具别名双方一致。
- env 超集：`BASH_DEFAULT_TIMEOUT_MS/BASH_MAX_TIMEOUT_MS/TASK_MAX_OUTPUT_LENGTH/DRORA_AUTO_UPDATE_ENABLED/DRORA_AGENTS_TEAM`；`CLAUDE_*` 兼容键保留面（符合 `specs/drora-rename.md`）。
- Windows SEA 下 TUI 以 node 别名子进程运行（`cli/src/tui-runtime-loader.ts:58-95`，opentui N-API 绑定问题修复，官方未见对应机制）。
- WebFetch egress guard（私网字面量 IP 阻断）与 preapproved 主机跳过小模型（`webfetch-preapproved.ts`）。
- Read 编码探测 gb2312/gbk/gb18030。
- 子 agent frontmatter `permissionMode` project 来源强制忽略（`packages/shared/src/subagent-profile-parser.ts`，防越权）。
- `skills-lock.json`（`apps/drora-cli/` 根存在但源码无消费者，来源待查，非官方机制）。

## 五、字面量族差分（parity 脚本）

`node scripts/check-bundle-key-parity.mjs`（脚本内部 `"DRORA_` 归一为 `"ZCODE_` 后比较）：

- metaKeys / permissionKeys / diagCodes：两侧集合完全一致。
- envKeys：仅本仓有 `ZCODE_AGENTS_TEAM` ×1（即源码 `DRORA_AGENTS_TEAM`，agentsTeam 自研功能键，归一化后浮现）——属有意扩展，非改名残留；仅原版有 0 个。

## 六、修复对齐策略

1. P1 四项全部走「官方实现优先 + 下轮源码同步」路径（bundle 仅作验收真值），不从 bundle 反汇编就地补写（AGENTS.md 还原证据规则）。
2. P2 各项在下轮同步甄别时逐条给出「缺口吸收 / 登记台账」结论；其中 #8（TodoWrite in_progress 约束）与 #13（TUI 模式轮换）需产品裁定后登记。
3. 本报告不直接修改任何行为代码；新增分歧登记动作归 `specs/drora-divergence-ledger.md` 维护流程。

证据明细：24 个 subagent 的分域事实报告（含逐条 file:line / bundle 偏移）见会话记录；本文件保留结论与索引。
