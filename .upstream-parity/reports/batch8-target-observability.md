# 批次 8：官方 bundle 可观测性与运维面调研

- 目标：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 字节，2026-10-13 构建，CLI 版本 `0.16.9`）
- 对照：`D:/software/zcode/resources/glm/debug/zcode-debug.cjs`（14,821,589 字节，2026-09-27 构建）
- 方法：只读 grep / node 字节偏移切片；函数名靠 esbuild 保留名注解 `r(fn,"name")`。
- 所有偏移为该文件内字节偏移（`node s.indexOf(...)` 所得），供二次校验。

---

## 1. 日志

### 1.1 文件位置与命名轮转

- 日志目录：`~/.zcode/cli/log`（`getDefaultLogDir` / `xGs`，offset 15107738 附近）：
  ```js
  function xGs(){return join(homedir(),".zcode","cli","log")}
  ```
- 可用 env `ZCODE_LOG_DIR` 覆盖目录（`createNodeLoggerFactory` 中 `e.logDir??e.env?.ZCODE_LOG_DIR??xGs()`）。
- 文件名按日轮转：`zcode-YYYY-MM-DD.jsonl`（`getLogFileName` / `EGs` + `formatLocalLogDate` / `hLe`，本地时区日期拼接）。
- 写入为同步 `appendFileSync`（`NodeFileLogger.log`，注意与 Drora "异步 IO" 规范不同，官方就是同步追加）。

### 1.2 日志级别

- 级别枚举：`{Debug:0,Info:1,Warn:2,Error:3}`，落盘字符串 `DEBUG/INFO/WARN/ERROR`。
- 默认级别：开发模式 Debug，否则 Info（`getDefaultMinLevel` / `TGs` + `isDevelopmentMode` / `IGs`）。"开发模式" 判定：`ZCODE_ENV`(常量 `Qz`) 规范化后为 `development`；或 argv[1] 以 `.ts` 结尾且路径含 `packages/cli/src`（源码态运行）。
- 级别切换只有工厂内 `setLevel()`，**没有** `ZCODE_LOG_LEVEL` 之类的 env 直接控级；可用 `ZCODE_ENV=development` 间接降级到 Debug。
- `ZCODE_LOG_CONSOLE="1"` 时额外把每条日志格式化输出到 stderr（`formatConsoleLine` / `Eto`）。

### 1.3 JSONL 行结构（`createEntry`）

`timestamp, level, levelName, event, module, message, traceId, sessionId, turnId, spanId, parentSpanId, toolCallId, durationMs, status, context, error`（error 经 `serializeLogError` / `qhn`，`includeErrorStack` 默认 false）。

### 1.4 敏感信息脱敏

- `DefaultLogRedactor`（`gLe`，offset 约 15106000）：正则 `/(?:api[-_]?key|authorization|cookie|credential|password|secret|token)/i` 命中的 context 键值替换为 `[Redacted]`；深度 >8 → `[Redacted:DepthLimit]`；循环引用 → `[Redacted:Circular]`。
- 另有遥测专用脱敏族：`redactTelemetryUrl`、`redactTelemetryText`、`redactTelemetryRouteSegment`、`redactFeedbackText`、`redactUrlCredentials`、`redactPluginSource`、`redactPluginDiagnosticText`、`sanitizeTelemetryModelValue`、`sanitizeTelemetryEventDetail`、`sanitizeTelemetryErrorMessage`、`sanitizeTelemetryError` 等（全文件 grep `redact*/sanitize*` 均有命中）。

### 1.5 保留策略（轮转清理）

- 默认保留 7 天（`bto=7`），`cleanupLogRetention` / `wto` 扫描目录内匹配 `/^zcode-(\d{4})-(\d{2})-(\d{2})\.jsonl$/` 的文件，早于截止日即 unlink；`scheduleLogRetentionCleanup` / `zhn` 默认延迟 60s（`Sto=6e4`）执行一次并 `unref()`。

### 1.6 CLI flag

- 全局参数表（`parseGlobalArgs` / `fPe`，offset 1233 附近）：有 `--verbose`（boolean），**没有** `--debug` / `--debug-log`。`--verbose` 的效果：错误时向 stderr 追加 Error.stack（`runZCodeProtocolCommand`、doctor 输出 execPath/cwd）。
- 文件内 1214 处 `--verbose` / 628 处 `--debug` 字面量几乎全部来自内嵌的第三方 shell 补全表（pnpm/brew/gem/cargo/helm/k6 等），与 ZCode 自身 CLI 无关，注意不要误判。

---

## 2. 遥测

### 2.1 结论先行

官方 ZCode 有**两套遥测**，本 bundle（CLI 侧）只实现了第一套：

1. **模型/Agent OTel 遥测（本 bundle 完整实现）**：trace + metrics 经 OTLP HTTP(gzip) 导出到 `OTEL_EXPORTER_OTLP_*` 指定端点。**默认关闭**——未配置 OTLP endpoint 时整条管线不启动。
2. **桌面 RUM/行为遥测（本 bundle 只有契约常量与 IPC 通道名，实现在桌面 main 包，不在本文件）**：构建期注入 `__ZCODE_ARMS_RUM_ENDPOINT__`（阿里云 ARMS RUM）、`__ZCODE_TELEMETRY_REPORT_ENDPOINT__`、`__ZCODE_AUTO_UPDATE_ENABLED__`。**本检出 bundle 中三者分别为 `""`、`""`、`false`（dev 构建值）**（offset 626134：`Dur=...__ZCODE_ARMS_RUM_ENDPOINT__...:"",Our=...:"",Mur=...:!1`）。

### 2.2 OTel 模型遥测细节（`kYo` 模块，offset ~13979000-13999000）

- 入口 `prepareModelTelemetryEnv` / `vYo`：`if(!FOn(e)||erc(e.ZCODE_MODEL_TELEMETRY_ENABLED))return e;`——
  - `FOn`=`resolveOtlpTraceEndpoint`：取 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`，否则 `OTEL_EXPORTER_OTLP_ENDPOINT`+`/v1/traces`；`znc`=`resolveOtlpMetricEndpoint` 同理 `/v1/metrics`，兜底复用 trace 端点。
  - `erc`：值 `0/false/off/disabled`（不区分大小写）即禁用。即 **`ZCODE_MODEL_TELEMETRY_ENABLED` 是 kill-switch，缺省(未设)不禁用，但有 endpoint 才会开**。
- 运行时 `createOwnedAgentTelemetryRuntime` / `Nnc`：
  - `OTLPTraceExporter`(gzip) + `BatchSpanProcessor`（maxBatchSize 100，maxQueueSize 2000，scheduledDelay 5s）+ `BasicTracerProvider` + `ParentBasedSampler(TraceIdRatioBased(AGENT_TRACE_SAMPLE_RATIO=0.1))`。
  - `OTLPMetricExporter`(gzip, DELTA temporality) + `PeriodicExportingMetricReader`（`AGENT_METRIC_EXPORT_INTERVAL_MS=300000`，5 分钟）+ `MeterProvider`。
  - tracer/meter 名：`@zcode/cli-agent-telemetry` v6；`AsyncLocalStorageContextManager`。
- 指标视图（histogram 边界，`metricViews` / `cYo`）：
  `zcode.agent.turn.duration`、`zcode.model.*.duration`、`zcode.context.compaction.duration`、`zcode.detected.operation.duration`（原文 `zcode.detached.operation.duration`）、`zcode.agent.step.duration`、`zcode.tool.execution.duration`、`zcode.command.execution.duration`、`zcode.*.time_to_first_*`、`zcode.model.call.attempts`、`zcode.model.attempt.tokens`、`zcode.model.attempt.stream_stall.count`、`zcode.telemetry.creation_drop.count`、`zcode.telemetry.abandoned.count`；cardinality limit 250。
- 身份与设备号：
  - 设备 MID：`ZCODE_TELEMETRY_DEVICE_MID` env 优先，否则读/建 `~/.zcode/v2/telemetry-state.json`（UUID），带 `telemetry-state.lock` 文件锁 + tmp+rename 原子写（`Wnc`/`Vnc`/`Hnc`，offset 13993676）。
  - 其余身份 env：`ZCODE_TELEMETRY_USER_ID`、`ZCODE_TELEMETRY_USER_ID_HASH`、`ZCODE_TELEMETRY_USER_SUBJECT_ID`、`ZCODE_TELEMETRY_IDENTITY_STATE`、`ZCODE_TELEMETRY_RUNTIME_SURFACE`、`ZCODE_TELEMETRY_RUNTIME_DISTRIBUTION`；resource 属性支持 `OTEL_RESOURCE_ATTRIBUTES`、`OTEL_SERVICE_NAME`。
  - 身份校验正则：MID `^[A-Za-z0-9._:-]{1,128}$`，commit `^[0-9a-f]{7,64}$`，版本 `^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$`。
- 生命周期：`yYo`=`createModelTelemetry`（无 owner 时返回 enabled:false 的空实现）、`WIt`=`shutdownPreparedModelTelemetry`（flush 超时 1500ms）。
- **usage 上报与行为遥测的区分**：模型 usage（token 数）落本地 SQLite `model_usage` 表（`recordModelUsage` / `p2r`，offset 1596182，40+ 列含 trace_id/span_id/ttft/finish_reason/retry 等），不发远端；OTel 指标只聚合成时长/token 直方图。行为遥测（renderer 动作、ARMS 自定义事件）走桌面通道。
- OTLP proto（`opentelemetry.proto.collector.{trace,metrics,logs}.v1` protobuf 编解码）与两份 `@opentelemetry/api` 均内嵌。

### 2.3 桌面遥测通道契约（仅通道名，实现不在本 bundle）

offset 946202 附近的 IPC 通道表：
`zcode:sync-telemetry-context`、`zcode:report-telemetry-event`、`zcode:report-arms-custom-event`、`zcode:get-renderer-action-trace-config`、`zcode:renderer-action-trace-config-changed`、`zcode:report-renderer-action-trace-batch`、`zcode:report-renderer-heap-sample`、`zcode:report-local-ttft-batch`、以及 E2E 用 `zcode:e2e:read-final-arms-custom-events` 等。
v4 协议侧帧名（offset 1184993）：`v4/telemetry/event`（conversationTelemetryFact）、`v4/telemetry/local-ttft`、`v4/cua/permission-observation`。

### 2.4 关闭方式汇总

- OTel 模型遥测：不设 `OTEL_EXPORTER_OTLP_*`（默认即关）或设 `ZCODE_MODEL_TELEMETRY_ENABLED=0|false|off|disabled`。
- 无 `DO_NOT_TRACK`、无 `*_DISABLE_TELEMETRY` 键（grep 无命中）。
- 桌面 ARMS/上报端点由发行构建期注入，用户侧无 env 开关暴露在本 bundle。

---

## 3. 错误上报

- **无任何第三方错误聚合 SDK**：grep `sentry/Sentry/posthog/statsig/mixpanel/amplitude/bugsnag/crashlytics/applicationinsights` 全部 0 命中。
- CLI 进程级错误边界：`installCliProcessErrorBoundary` / `dcr`（offset 15120467）挂 `uncaughtExceptionMonitor`/`uncaughtException`/`unhandledRejection`，经 `writeProcessErrorDiagnostic` / `PVi` 向 stderr 写：
  - 前缀 `[zcode-process-exception] `（`PRe`），JSON 记录 `{version:1,errorId:uuid,kind,origin,name,message,stack,occurredAt}`，受 `ZCODE_PROCESS_DIAGNOSTIC_*` 常量约束（name≤128、message≤4000、stack≤16000、单行≤128*1024）。
  - 随后一行 `[zcode] process error kind=... origin=...` + 完整 stack。
  - schema（zod，offset 499593）与标记串 `[zcode-agent-lifecycle-reported]`（`EVi`）存在于协议层。
- 另有 `installProtocolStderrBoundary` / `pcr` 防止 stderr EPIPE 崩溃；`hcr` 信号处理表 `SIGINT:130, SIGTERM:143, SIGHUP:129`。
- 结论：崩溃只落 stderr/日志，不做远端崩溃上报（桌面层如有 crashReporter 也MainWindow不在本文件，bundle 内无 `crashReporter` 命中）。

---

## 4. doctor

- CLI 分发（offset 15107738 上方）：`case"doctor":return gbc(e,I,U)`。
- 实现 `gbc` = **`runDoctor`**，功能仅为环境信息打印，**没有网络/凭据/数据库 migration/插件完整性等检查项**：
  - 输出字段：`cli{name,processName,version}`、`runtime{arch,cwd,execPath,node,platform,processTitle,sea}`、`packaging{default:"node-bundle",sea:"optional"}`。
  - `--json` 输出 JSON；`--verbose` 追加 execPath、cwd；`--no-color` 关色（辅助函数 `FPn`）。
  - 固定文本：`zcode doctor` 标题 + `version:` / `process:` / `node:` / `platform:` / `sea: yes|no (optional)` / `default artifact: node-bundle`。
- 即 doctor 检查项数 = **0 项检查、6 类环境信息**。真正的"诊断"能力分散在：插件 `diagnostics` 数组（schema `kF = {code,message,severity?,pluginId?}`，offset 836662，用于插件市场/安装摘要）、资源管理器（存储清理 UI）与 stdio tap。

---

## 5. 更新检查

- **CLI 本体无自更新**：无 npm registry 查询、无 `latest.yml`/`app-update.yml`、无 electron-updater 痕迹。`__ZCODE_AUTO_UPDATE_ENABLED__` 只是构建期常量（本 bundle 为 `false`），经 env 常量表 `ZCODE_AUTO_UPDATE_ENABLED` 导出，无本文件内消费方。
- **桌面更新 IPC 契约**（offset 948160 通道表）：`zcode:get-update-state`、`zcode:download-update`、`zcode:cancel-update-download`、`zcode:open-update-status-window`、`zcode:update-ready`、`zcode:update-check-result`、`zcode:update-state-changed`、`zcode:get-auto-update-preferences`、`zcode:set-auto-download-and-install*`；菜单动作 `CheckForUpdates:"checkForUpdates"`、`RelaunchApp:"relaunchApp"`、`OpenChangelog:"openChangelog"`。i18n 文案含 "正在检查更新.../发现新版本 {version}/正在下载更新 {progress}/重启以更新"（offset 960669）。**比较与下载实现位于桌面 main bundle（不在本文件）。**
- **插件更新检查在本 bundle**（offset 4366002）：
  - `comparePluginVersions` / `hso`：semver（内嵌 semver 库）`gt(latest,installed)` → `update-available`，相等 → `none`，其余 → `version-changed`。
  - `comparePluginUpdate` / `$0n`：有 latestVersion 用 semver；否则比较 source sha（`installedSha===latestSha` → none，无本地 sha → version-changed）。
  - 摘要 schema 字段 `updateStatus: enum["none","update-available","version-changed"]`、`latestVersion`。
- **无强制更新门**：grep `force-update/minimumVersion/minVersion` 命中均为第三方补全/无关代码。相关 CDN 域名 `https://cdn-zcode.z.ai` 仅用于官方插件市场 `marketplace.json` 与图标资源（offset 514223、4333465）。

---

## 6. debug 模式

- `ZCODE_DEBUG`：主 bundle 只读一次 `process.env.ZCODE_DEBUG` 存入常量 `RUNTIME_ZCODE_DEBUG`（offset 626134 + 1057518），本文件内无功能消费方（为桌面/发行侧预留）。
- `debug/zcode-debug.cjs`（2026-09-27，早主 bundle 约 16 天）：
  - 同构另一构建：`runDoctor`、`installCliProcessErrorBoundary`、OTel 模型遥测（`createOwnedAgentTelemetryRuntime`/`ZCODE_MODEL_TELEMETRY_ENABLED`/`getDefaultLogDir` 各 3 处命中）均在。
  - 差异：**没有** `__ZCODE_TELEMETRY_REPORT_ENDPOINT__` 与 `__ZCODE_AUTO_UPDATE_ENABLED__` define（说明这两个注入点是在 debug 构建之后加入主构建的）；`__ZCODE_ENV__:void 0`、版本同为 `0.0.0-dev`。
- 主 bundle 内的调试面（桌面菜单/窗口动作名）：`ToggleDevTools`、`OpenResourceManager`（资源管理器：存储占用/分类清理 UI，renderer testid `resource-manager-*`，offset 931955）、`ToggleZCodeStdioTapDevProxy`（"抓取 Agent stdio 流量"）、`helpZCodeEndpoint`（endpoint 切换 `.zcodeEndpoint.{test,reset,production,custom}`）。TUI 无 `/debug` 斜杠命令（grep 无命中）。

---

## 7. 诊断码族

- 结构化诊断 schema：`kF={code,message,severity?:warning|error,pluginId?}`。
- `code:"..."` 字面量去重后约 **94 个不同取值**（含 zod 自带 `invalid_type/too_big/...` 与 i18n 噪音如 `valutakode`）。主要族：
  - `plugin_*`：`plugin_marketplace_invalid`(12)、`plugin_manifest_invalid`(8)、`plugin_marketplace_source_unsupported`(5)、`plugin_hook_invalid`(5)、`plugin_component_path_invalid`(5)、`plugin_not_found`(5)、`plugin_manifest_not_found`(4)、`plugin_unsupported_component`、`plugin_skill_root_empty`、`plugin_root_not_found`、`plugin_hook_unsupported_event`、`plugin_hook_read_failed`、`plugin_dependency_missing/cycle/cross_marketplace`、`plugin_mcp_invalid`、`marketplace_source_unsupported`(5)、`marketplace_refresh_failed`(3)、`marketplace_declaration_reserved`。
  - `skill_*` / `custom_command_*`：`skill_scan_failed`、`skill_read_failed`、`skill_missing_name/description`、`skill_invalid_frontmatter`、`skill_description_too_long`、`custom_command_scan_failed`、`custom_command_invalid_frontmatter`。
  - 通用错误码（多来自 Result/错误对象）：`*_failed` 族全文件约 **180+ 处命中**（`request_failed` 39、`read_failed` 27、`compile_failed` 13、`start_failed` 9、`persist_failed` 8、`rebuild_failed` 7、`connection_failed` 7 等）；另有 `io_error/not_file/is_directory/permission_denied/egress_blocked/capability_unsupported/backend_unavailable/write_file_stale/stale_write` 等。
- 协议诊断常量：`ZCODE_PROCESS_DIAGNOSTIC_*`（第 3 节）与 v4 协议错误帧。

---

## 8. 其他运维面（顺带）

- 菜单含 `helpExportLogs`（"导出日志"，通道 `zcode:export-logs`）与 `helpClearAllData`（"清除所有数据"）——实现均在桌面侧。
- 每窗口协议通道 `zcode:capture-window-screenshot`、`zcode:task-notification-*`。
- env 常量单一出处表（offset 1057518）覆盖 `ZCODE_*`/`OTEL_*` 全部键，与 AGENTS.md 的"契约键单一出处"原则同构。

## 9. 对 Drora 的 parity 提示（要点）

1. 官方 CLI 日志 = `~/.zcode/cli/log/zcode-YYYY-MM-DD.jsonl` + 7 天保留 + 默认脱敏正则；我们 `packages/ui/src/logger.ts`/`serviceLogger` 语义不同，需在 parity spec 里记录差异。
2. 官方模型遥测默认关闭、OTLP 标准协议、身份键在 `~/.zcode/v2/telemetry-state.json`；Drora 如需对齐，应以 OTEL env 为准而非自造开关名。
3. doctor 在官方只是环境信息打印，不要在 Drora 中臆造"网络/凭据检查"作为上游能力。
4. 桌面更新/ARMS 遥测的实现在桌面 main bundle，本 CLI bundle 只有通道契约——后续若对比桌面包需另立批次。
