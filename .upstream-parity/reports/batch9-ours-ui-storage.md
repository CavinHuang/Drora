# 批次 9：我方 CLI 表现层、会话存储、日志与遥测清单（对照官方批次 5/8）

- 仓库：`D:/workspace/projects/Drora`（分支 feat/g-backlog-e2e，与 drora/main 同步，ahead 896 / behind 0，`node scripts/check-workspace-freshness.mjs` 通过）
- 范围：`apps/drora-cli/packages/`（adapters、tui、cli、core、telemetry、i18n、contracts、bootstrap）、`packages/services`、`packages/shared`、`packages/ui`
- 调研方式：只读 grep/读源码；引用均为 `文件:行`
- 日期：2026-10-19

---

## 1. 会话存储：node:sqlite 单引擎，迁移与表结构与官方逐 id 对齐（还原资产）

### 1.1 引擎与位置

- 引擎：`node:sqlite` 的 `DatabaseSync`，与官方一致。`apps/drora-cli/packages/adapters/src/storage/session-store/sqlite-session-store.ts:8`（`import { DatabaseSync } from "node:sqlite"`）。
- 库路径：`~/.drora/cli/db/db.sqlite`（官方 `~/.zcode/cli/db/db.sqlite`，仅品牌目录改名）。`apps/drora-cli/packages/adapters/src/storage/session-store/paths.ts:6-8`。
- 故障注入探针 `maybeThrowStorageFsFault`（mkdir/appendFile），对应官方 `throwBeforeWrite` 家族。`paths.ts:22-28`、`logging/index.ts:130,244`。

### 1.2 Migrations：22 个，id 与官方完全一致

`apps/drora-cli/packages/adapters/src/storage/session-store/migrations.ts:9-930`（`SQLITE_MIGRATIONS`）：

`0001_base_session_store`、`0002_local_setting`、`0003_backfill_permission_local_setting`、`0004_session_target`、`0005_session_target_accounting`、`0006_input_history_attachments`、`0007_workflow_script_runtime`、`0008_workflow_definition_scope`、`0009_session_title_metadata`、`0010_usage_observability`、`0011_session_target_summary_title`、`0012_session_trace_id`、`0013_session_target_active_run_accounting`、`0014_message_part_sequence`、`0015_message_part_sequence_backfill_and_guard`、`0016_session_input_ledger`、`0017_session_input_start_now_delivery`、`0018_session_input_failed_status`、`0019_dwf_journal`、`0020_provider_model_selection`（独立文件 `migrations/0020-provider-model-selection.ts`）、`0021_official_glm_selection`、`0022_backfilled_session_reasoning`（`migrations/0021-…ts`、`migrations/0022-backfilled-session-reasoning.ts`）。

- 记账表 `schema_migration(id, checksum, app_version, time_applied)`，带 checksum 校验与 last-row baseline。`migration-runner.ts:161-165,291`。
- 同步迁移 `runSqliteSessionMigrations`（5s 锁等待）+ 异步迁移 `runSqliteSessionMigrationsAsync`（启动等待上限 60 分钟、busy_timeout=25ms、WAL 重试退避 10→200ms）。`migration-runner.ts:22,56-72,24`。
- 启动失败分类 `DatabaseStartupErrorCode`（见 §7）。

### 1.3 表结构（24 张，与官方同族）

`create table` 语句全集（`migrations.ts`，行号）：`session`(14)、`message`(41)、`part`(52)、`todo`(64)、`session_entry`(77)、`permission`(90)、`input_history`(97)、`local_setting`(116)、`session_target`(166)、`session_target_next`(180)、`workflow_definition`(234)、`workflow_run`(250)、`workflow_activity`(287)、`workflow_event`(325)、`session_task_link`(340)、`model_usage`(396)、`turn_usage`(448)、`tool_usage`(481)、`session_input`(691，0017/0018 重建于 720/763)、`dwf_run`(831)、`dwf_actor`(858)、`dwf_node`(874)、`dwf_event`(899) + `schema_migration`（runner 建）。合计 23 业务表 + 1 记账表 = 24。

与官方批次 5 结论（22 migrations、24 表，含 session/message/part/todo/session_entry/session_input/session_target/local_setting/input_history/model_usage/turn_usage/tool_usage/workflow_*/dwf_*）逐项对照：**表族一致**。字段级差异：

- `session` 表：我方 `share_url`（migrations.ts:24）、`workspace_id`(17)、`revert`(29)、`time_compacting`(33)、`time_archived`(34) 与官方 batch5 描述一致。
- `local_setting` 主键 `(scope,scope_id,namespace,key)` + `schema_version`（116-126），同官方。
- `session_input` 台账（0016 建，0017 `start_now_delivery` 重建、0018 `failed_status`），delivery/status 状态机同官方 CommandInbox 持久台账。

### 1.4 resume / rewind / snapshot / fork / todo 能力

- **resume**：CLI `resume.ts:12-13` 把 `resumeSessionId` 映射为 App `sessionId`；session 表 `time_archived`/`parent_id` 支撑列表与 fork 子会话。
- **rewind**：`session.revert` 列存 rewind 状态（`SessionRevert`，`sqlite-session-store.ts:904`）；entry 类型 `runtime/workspace_file_rewind`（`contracts/src/interfaces/session-store.port.ts:812`）与 `runtime/workspace_checkpoint`（:823）；conversation rewind 带 cut 游标与代际隔离（`session-store.port.ts:282-294`）。core 侧实现 `apps/drora-cli/packages/core/src/runtime/methods/file-rewind.ts`、`core/src/runtime/helpers/rewind.ts`。
- **snapshot**：`SessionEntryType` 含 `runtime/workspace_checkpoint`（`session-store.port.ts:817-826` 全族：target_completion_verification、bash_shell_selection、model_selection、execution_state、user_input_auto_resolution、workspace_checkpoint、workspace_file_rewind、dynamic_workflow_activation）；goalBoundary `kind:"snapshot"`（`sqlite-session-store.ts:151`）。
- **fork**：`createForkedSessionWithMetadata`（legacy）+ `commitForkBundle`（`session-store.port.ts:1096-1100`、`sqlite-session-store.ts:105,115`）。
- **todo 持久化**：`todo` 表（session_id, content, status, priority, position，主键 (session_id, position)，migrations.ts:64-75）+ 仓储 `repositories/todos.ts`，同官方 TodoWrite/TodoRead 直落库。
- **权限持久化**：`local_setting` 现承载 permission ruleset/mode（`repositories/local-settings.ts:12-50`），旧 `permission` 表保留 backfill 兼容；full access 走 `repositories/permission-full-access.ts` + entry `runtime/permission_full_access`（`contracts/src/interfaces/permission-full-access.ts:3`）。

**结论**：存储层为官方 SQLite 实现的逐常量还原（migration id 完全一致），无文件型会话存储，与官方 24 表结构无实质差异；差异仅在品牌路径 `.drora` 与 `@drora/*` 包名。

---

## 2. TUI/App 表现层

### 2.1 渲染栈

- 包名 `@drora/tui`（私有包，`apps/drora-cli/packages/tui/package.json:2`），底层渲染器为 **OpenTUI 家族的 @mbears 分叉**：`@mbears/opentui-core` + `@mbears/opentui-react` 0.2.15（package.json:24-25）；入口 `createCliRenderer`/`createRoot`（`tui/src/tui.tsx:1-3`）。官方为 `@zcode/tui`（"OpenTUI shell"）——同源不同发布 scope，`exitOnCtrlC: false`、鼠标移动启用（tui.tsx:16-25）。src 内无 `还原自发行 bundle` 文件头标注，属自研装配层 + 第三方渲染器依赖。

### 2.2 语言与主题

- 语言：仅 `en-US`、`zh-CN` + `auto`。`apps/drora-cli/packages/i18n/src/locale.ts:3-4`（`SUPPORTED_LOCALES`），auto 按 `LC_ALL/LC_MESSAGES/LANG/LANGUAGE` 探测（:5-79）。与官方 en-US/zh-CN+auto 一致。
- 主题：`UiThemeMode = "dark" | "light"`，偏好 `UiThemePreference = dark|light|"auto"`（`contracts/src/config/index.ts:286-288`）；内建 DARK/LIGHT token 表（`tui/src/theme/defaults.ts:4,64,122`）；auto 由终端色推断（`theme/terminal.ts` 的 `inferThemeModeFromTerminalColors`）。
- 持久化：`ui.locale`/`ui.theme` 存**用户配置文件** `~/.drora/cli/config.json`（`adapters/src/config/file-config.adapter.ts:61-62`），键为 `ConfigKey.UiLocale/UiTheme`（`adapters/src/config/index.ts:210-213,333-334`），TUI 启动时 CLI 边界自行解析（`cli/src/tui-startup-locale.ts:37-40`、`cli/src/tui-command.ts:80-81`）。**与官方差异**：官方存 SQLite `local_setting`（`ui.{locale,theme}`）；我方 `local_setting` 表只承载 permission/permission_full_access 等 runtime 状态，不走 UI 偏好。

### 2.3 快捷键

| 键 | 行为 | 位置 |
| --- | --- | --- |
| Enter / linefeed | 提交；Shift+Enter 换行 | `tui/src/app-input-pane.tsx:33-38` |
| Esc | 依次关 model/effort/mode/slash 建议 → busy 时中断（"Pausing current output..."） | `tui/src/app-keyboard.ts:281-309` |
| Ctrl+C | 第一次清草稿或提示，两连击才退出（双击守卫 `resolveCtrlCExitIntent`） | `app-keyboard.ts:201-224`（含 216-217 注释） |
| Ctrl+R | 重试最近可重试压缩命令（`latestRetryableCompactCommand`） | `app-keyboard.ts:235-246` |
| Ctrl+Y / Ctrl+C（只读视图） | 复制选区 | `app-keyboard.ts:158-160,229-233` |

与官方四键（Enter 提交、Esc 中断、Ctrl+C 退出、Ctrl+R 重试压缩）语义一致；我方额外实现双击退出守卫与选区复制。

### 2.4 权限弹窗

- 决策集：`["allow_once", "allow_project", "deny"]`（`tui/src/app-model.ts:246`）；`approvalMode === "user-once"` 时收缩为 `[allow_once, deny]`（`app-approval.ts:15`）；Esc = deny（:53-54）。
- fullAccess：协议层支持 `fullAccessSupported`（`contracts/src/events/session.events.ts:1030`）、`commitPermissionFullAccess` 仓储与 `runtime/permission_full_access` entry；AskUserQuestion 的 auto-resolution 资格与 fullAccess 绑定（`bootstrap/src/drora-protocol-v4/interaction-registry.ts:82-84`）。
- **与官方差异**：官方 allowOnce/allowAlways/deny/custom+fullAccess；我方第二档是 `allow_project`（项目级规则集），无逐项 custom 分支弹窗。

### 2.5 AskUserQuestion autoResolution：已实现，参数与官方一致

- `ASK_USER_QUESTION_HIDDEN_GRACE_MS = 60_000`、`ASK_USER_QUESTION_AUTO_RESOLUTION_MS = 300_000`（`bootstrap/src/drora-protocol-v4/interaction-registry.ts:30-31`）；状态机 hiddenGrace → visibleCountdown → (snoozed)（:54-65、270-325），E2E 时钟缩放 env 仅测试生效（:38-52）。
- 状态以 durable 事件 `user_input_auto_resolution_updated` 落库（`contracts/src/events/session.events.ts:158,1078-1095`；`core/src/runtime/methods/interaction-auto-resolution.ts:12-29`），desktop continuous 与 web replayable 恢复同一组绝对时间。
- 注意区分：工具本身模型侧 `timeoutMs: 30000`（`core/src/tool/handlers/ask-user-question.ts:82,113-117`）是等待应答上限，与 60s/300s UI 自动收口是两套时钟。

### 2.6 工具结果 display 预计算（core 预计算，TUI 只消费）

`apps/drora-cli/packages/core/src/tool/executor/result-display.ts`：

| 维度 | 我方值 | 官方值 | 差异 |
| --- | --- | --- | --- |
| file_diff | `MAX_DISPLAY_DIFF_HUNKS = 8`、`MAX_DISPLAY_DIFF_LINES = 160`（:44-45） | 8 hunk / 160 行 | 一致 |
| bash | 150_000 字节截断（`bash-result-display.ts:16-18`） | 150KB | 一致 |
| task_output | `TASK_OUTPUT_DISPLAY_MAX_OUTPUT_CHARS = 2_000` 字符、status 64 字符（`contracts/src/tools/tool-result-metadata.ts:27-28`） | 8KB | **不一致：字符数 2000 vs 8KB** |
| MCP | `MCP_APPS_CONTENT_MAX_BYTES = 32 * 1024`（`packages/shared/src/mcp-apps/contract.ts:130`）；name 256 字符、description 4KB（`tool-result-metadata.ts:29-30`） | 32KB | 主体一致（我方 32KB 用于 mcp-apps content/display 字段） |
| 其他 | send_message 字段 4KB、task_stop 16KB（result-display.ts:46-47）、node_repl 图片 200KB×2（:48-49）、CUA 字段 32KB（:309） | — | 我方额外族 |

thinking 文案：提交即 `"Thinking..."`（`tui/src/app-submit.ts:231`；i18n `en-US.ts:281,312`），完成后 `"Thought"`（`en-US.ts:246,311`）——与官方 "Thinking...→Thought" 一致。

---

## 3. StreamRecovery / 队列提示

- **六事件恢复链与官方同构**：`stream_recovery_anchor_created / started / anchor_selected / tail_discarded / retry_started / blocked`（`contracts/src/events/session.events.ts:124-129`）；投影处理在 `bootstrap/src/drora-protocol-v4/product-projection.ts:1408-1413,2531`，hydration/协议映射在 `bootstrap/src/drora-protocol/session-mapper.ts`、`drora-protocol-v4/transcript-hydration.ts`。
- **队列提示逐字对齐官方**：`queuedSubmitHint: "Submitted after the next tool call."`（`i18n/src/locales/en-US.ts:88`），队列面板 `Queue (n)`（:89；`tui/src/app-queued-inputs.tsx:40,53,63`）。队列持久语义由 `session_input` 台账（admitted/promoted/cancelled/discarded，`session-store.port.ts:852,1187` 附近注释）承载，Esc 中断后 busy 提交进入队列由 `app-submit.ts` 的 turn AbortController（:225-278）+ CommandInbox admission 链路接管。

---

## 4. 日志

### 4.1 CLI 侧文件日志（与官方同构）

- 实现 `NodeFileLogger`：JSONL 逐行 `appendFileSync`（`adapters/src/logging/index.ts:130-134`）。
- 文件名 `drora-YYYY-MM-DD.jsonl` 按日轮转（`index.ts:247-249`），目录 `~/.drora/cli/log`（:222-224），可被 `DRORA_LOG_DIR` 覆盖、`DRORA_LOG_CONSOLE=1` 加开 stderr 镜像（:173-179）。
- 默认级别 **Info**（开发模式 Debug，`index.ts:226-228`）；保留 **7 天**（`adapters/src/logging/retention.ts:6` `LOG_RETENTION_DAYS = 7`，启动延迟清理 :139-140）。
- 脱敏 `DefaultLogRedactor`：`(api[-_]?key|authorization|cookie|credential|password|secret|token)` 键名命中即 `[Redacted]`，深度 8/循环引用防护（`adapters/src/logging/serialize.ts:15-45`）。
- **对照官方**：`~/.zcode/cli/log/zcode-YYYY-MM-DD.jsonl` + 7 天 + Info + DefaultLogRedactor —— 四要素全部等价，仅品牌前缀不同。

### 4.2 其他日志面

- 服务日志 `createServiceLogger(scope)`（`packages/services/src/logger/serviceLogger.ts:21-53`）：console 分级（debug 仅开发构建），无文件 sink；用于 session/runtime 服务（AGENTS.md 规定）。
- 渲染层 `packages/ui/src/logger.ts:3-40`：debug/info/warn/error，生产禁 debug，经 `window.drora.log` 桥接 Desktop 归集。
- 三者分工与官方 core/TUI 分层等价；无重复写同一文件的第二条路径。

---

## 5. 遥测

- 包 `@drora/telemetry`（`apps/drora-cli/packages/telemetry/`），OTel SDK **动态加载**：无 OTLP endpoint 或 kill-switch 打开时不 import SDK/Exporter（`telemetry/src/bootstrap.ts:113-124` 注释与守卫）。
- **默认关闭**：必须显式配置 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`（或 `OTEL_EXPORTER_OTLP_ENDPOINT`/`..._METRICS_ENDPOINT`，:76-90）才启用 —— 与官方"模型遥测默认关闭"一致。
- **kill-switch 键**：`DRORA_MODEL_TELEMETRY_ENABLED`，值 `0/false/off/disabled` 即禁用（`bootstrap.ts:124,414-416`）。
- 导出：OTLP **gzip**（`telemetry/src/otlp-exporter.ts:58,78` `CompressionAlgorithm.GZIP`）。
- 身份：`DRORA_TELEMETRY_DEVICE_MID` 状态文件 `~/.drora/v2/telemetry-state.json`（带 lock 文件；`bootstrap.ts:227-228,268`）——目录布局同官方 `~/.zcode/v2/telemetry-state.json`。辅助 env：`DRORA_TELEMETRY_USER_SUBJECT_ID`、`DRORA_TELEMETRY_IDENTITY_STATE`、`DRORA_TELEMETRY_RUNTIME_DISTRIBUTION/SURFACE`（:165-200）。
- **指标族：18 个 instrument（官方 13）**，全在 `telemetry/src/agent-metrics.ts:56-95`：
  - 8 个时长直方图：`drora.agent.turn/step.duration`、`drora.tool.execution.duration`、`drora.command.execution.duration`、`drora.context.compaction.duration`、`drora.detached.operation.duration`、`drora.model.call/attempt.duration`；
  - `drora.model.call.attempts`（直方图）、`drora.model.attempt.tokens`（counter，按 token_type）、`drora.model.attempt.time_to_first_provider_event/content/text`（3 个）、`drora.model.attempt.stream_stall.count`、`drora.model.attempt.stream_max_idle`、`drora.command.execution.time_to_first_output`；
  - 自保指标：`drora.telemetry.creation_drop.count`、`drora.telemetry.abandoned.count`。
  - 命名空间 `drora.*`（官方应为 `zcode.*` 族），数量 18 vs 13，属"同维度超集"，指标名不逐字对齐。
- 接线：CLI 异步入口 `prepareDroraTelemetryEnv`（`bootstrap/src/telemetry-bootstrap.ts:12-25`）→ App 工厂 `createModelTelemetry`（`bootstrap/src/app/create-app.ts:215`）；OTLP header 等私密配置留在进程内捕获区，不进子进程 env（telemetry-bootstrap.ts:8-11）。

---

## 6. doctor / 更新

- **doctor**：`cli/src/run.ts:576`（`case "doctor"`）→ 仅打印环境：version / process / node / platform+arch / sea（SEA 打包形态）/ default artifact，`--verbose` 加 execPath、cwd，`--json` 输出结构化（run.ts:215-241）。**0 项检查，与官方一致**。
- **更新**：CLI **无自更新**——子命令全集为 help/version/agent-server/app-server/doctor/login/logout/commands/plugin/plugins/skills/tui（run.ts:561-601），无 update/upgrade。更新检查在 **Desktop 侧**：electron-updater + GitHub provider（`{provider:"github", owner, repo}` 生成 app-update.yml），通道清单 latest*.yml 双架构合并；强制升级门控已移除。依据 `specs/update-feed-github.md`（决策节）与 `specs/force-update-gate-removal.md`。

---

## 7. 诊断码

均定义在 `apps/drora-cli/packages/contracts/src/`（字符串字面量联合类型），共 **60 个**命名码，分四族：

| 族 | 数量 | 位置 | 样例 |
| --- | --- | --- | --- |
| 自定义命令 | 9 | `contracts/src/commands/index.ts:14-24` | `custom_command_duplicate_name`、`invalid_frontmatter`、`too_large`、`unsupported_dynamic_syntax` |
| 插件 | 26 | `contracts/src/plugins/index.ts:47-73` | `plugin_manifest_invalid`、`plugin_dependency_cycle`、`plugin_marketplace_source_unsupported`、`plugin_ambiguous_name` |
| 技能 | 13 | `contracts/src/skills/index.ts:13-26` | `skill_missing_description`、`skill_duplicate_name`、`skill_description_too_long` |
| 数据库启动 | 12 | `packages/shared/src/database-startup.ts:3-16` | `storage_full`、`permission_denied`、`io_error`、`out_of_memory`、`corrupt`、`open_failed`、`lock_timeout`、`checksum_mismatch`、`sql_failed`、`startup_status_timeout`、`transport_closed`、`unsupported_runtime` |

**与官方对照**：官方约 94 个诊断码；我方 60 个且命名族不同（我方按 commands/plugins/skills/database-startup 分域，官方为统一诊断码族）。语义覆盖面不等价，属"有意分歧 + 缺口"并存，需在 spec 记录（目前 `specs/upstream-v3.15.1-migration.md` 未列诊断码对照表）。

---

## 8. 总结对照表（我方 vs 官方）

| 维度 | 官方 | 我方 | 判定 |
| --- | --- | --- | --- |
| 存储引擎 | node:sqlite DatabaseSync | 同（sqlite-session-store.ts:8） | 一致 |
| 库路径 | ~/.zcode/cli/db/db.sqlite | ~/.drora/cli/db/db.sqlite | 品牌差异 |
| migrations/表 | 22 / 24 | 22（id 全同）/ 24（同族） | 一致（还原） |
| resume/rewind/snapshot/todo | revert 列 + entry + checkpoint + todo 表 | 同构（含 fork bundle） | 一致 |
| TUI 渲染 | @zcode/tui（OpenTUI shell） | @mbears/opentui-* 0.2.15 + 自研装配 | 同源异 scope |
| 语言/主题 | en-US/zh-CN+auto；ui.{locale,theme} | 同清单；存 ~/.drora/cli/config.json | 主题持久化位置分歧 |
| 快捷键 | Enter/Esc/Ctrl+C/Ctrl+R | 同 + 双击守卫 + 复制键 | 超集 |
| 权限弹窗 | allowOnce/allowAlways/deny/custom+fullAccess | allow_once/allow_project/deny + fullAccess | 档位分歧 |
| AskUserQuestion autoResolution | 60s+300s | 60s+300s + durable 事件落库 | 一致 |
| display 截断 | 8hunk/160行、150KB、8KB、32KB | 8/160、150KB、**2000 字符**、32KB | task_output 不一致 |
| StreamRecovery | 六事件 | 同六事件（contracts:124-129） | 一致 |
| 队列提示 | "Submitted after the next tool call." | 逐字相同（en-US.ts:88） | 一致 |
| 日志 | jsonl 按日、7 天、Info、Redactor | drora-*.jsonl、7 天、Info、DefaultLogRedactor | 一致 |
| 遥测 | OTel 默认关、OTLP gzip、13 指标、kill-switch | 默认关、gzip、**18 指标**（drora.*）、DRORA_MODEL_TELEMETRY_ENABLED | 维度同、数量/命名不同 |
| doctor | 仅打印环境 0 检查 | 同（run.ts:215-241） | 一致 |
| 自更新 | 无（CLI） | 无（更新在 Desktop GitHub provider） | 一致 |
| 诊断码 | ~94 | 60（4 族，命名域不同） | 有意分歧/缺口 |
