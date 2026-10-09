# b16-hooks 静态对拍报告（H2 · hooks 域）

- 日期：2026-10-08；真值 = `D:\software\zcode\resources\glm\zcode.cjs`（0.16.9）；我方 = `feat/migrate-remote-and-pet`
- 我方入口：`apps/drora-cli/packages/core/src/hooks/`（19 文件）、`apps/drora-cli/packages/contracts/src/hooks/`、`packages/shared/src/workspace-hook-*.ts`、`packages/shared/src/hooks.ts`、`packages/adapters/src/storage/workspace-hook-trust-store.ts`、`apps/drora-cli/packages/adapters/src/config/schema.ts`
- 方法：全部结论基于 bundle 偏移重测 + 我方源码逐段比对；无 docs 依赖。

## §1 钩子事件全集

| 真值证据（偏移） | 真值内容 | 我方 | 结论 |
| --- | --- | --- | --- |
| 1309731（drs 枚举）/ 1311900（Tl 对象）/ 4099660（iHr 数组） | `SessionStart,UserPromptSubmit,PreToolUse,PermissionRequest,PostToolUse,PostToolUseFailure,Stop` 共 7 值 | `contracts/src/hooks/index.ts:7-15`、`shared/workspace-hook-config.ts:9-17`、`shared/workspace-hook-trust-store-file.ts:23-31` 同 7 值 | 一致 |
| `grep -c`：PreCompact=0 | 无 PreCompact 事件 | 我方亦无 | 一致 |
| SubagentStop 17 处（1237027 等）、SessionEnd 4 处 | 存在于 subagent/session 生命周期域，**不在任何 hooks 事件枚举中** | 我方无 | 非 hooks REAL-GAP（见 §6 OQ-3） |

事件 stdin 映射（`createClaudeCompatibleHookStdin`，真值 5050100-5050900）：`hook_event_name/agent_type/permission_mode/session_id/transcript_path(+transcriptPath)/tool_name/tool_input/tool_use_id/permission_suggestions/tool_response/error_details/error/is_interrupt/last_assistant_message/stop_hook_active`，campos 展开保留 camelCase；transcript 写 tmp 后随事件清理。与我方 `core/src/hooks/configured-runner-input.ts:14-68` 逐字段一致。

各事件专属输入字段（我方 `contracts/src/hooks/index.ts:78-139`）：SessionStart.source(startup/resume/clear/compact)、Stop.stopHookActive/toolCallCount、PermissionRequest.permissionSuggestions 等，与真值 stdin switch 及运行态用法一致。

## §2 trust 授权链

- **状态机**：7 态 `not_applicable/pending_trust/trusted_persistent/blocked_untrusted/blocked_policy/revoked/stale_digest` + admission map（真值 1303600 `mXt/oyr`）= 我方 `contracts/src/hooks/workspace-hook-trust.ts:31-130` 逐字段一致（含 effectiveRunnable 校验文案）。
- **评估**：`evaluateWorkspaceHookEntry`（真值 5072200 `Yio`）：deny→blocked_policy；store corrupt→blocked_untrusted；allow_trusted_only→有记录 trusted_persistent/无 blocked_policy；revokedKeys→revoked；`hasStaleSlotRecord`（真值 `RQs`，需 sourceDiscoveryOrderAtGrant+matcherIndexAtGrant+hookIndexAtGrant 全存在）→stale_digest；否则 pending_trust。= 我方 `core/src/hooks/workspace-hook-trust-evaluation.ts:15-99` 逐行一致。
- **记录 schema（QV，1308700 补窗确认尾部）**：`workspaceIdentity, hookDeclarationDigest(sha256/64hex), digestAlgorithm:"sha256", decision:"trusted", grantedAt, lastUsedAt?, bundleDigestAtGrant?, eventAtGrant, displayCommandAtGrant, sourcePathAtGrant, sourceDiscoveryOrderAtGrant?, matcherAtGrant?, matcherIndexAtGrant?, hookIndexAtGrant?, appVersionAtGrant?` = 我方 `shared/workspace-hook-trust-store-file.ts:37-55` 全部 14 字段一致（含 appVersionAtGrant）。store 文件 `$Qe`（schemaVersion+records+unique key superRefine）一致。
- **store 文件与锁**：真值 `FileWorkspaceHookTrustStore`（1551900 `XQt`）：文件 `security/workspace-hook-trust-v1.json`、lockTimeout 5000、staleLock 30000、rename 重试 [50,100,200,400,800]、启动时间容差 2000、proc ticks 100、lock owner {pid,startTime,token}、corrupt→rename `.corrupt-<ts>` fail-closed、grant/revoke/touch/compact、revoke 空数组拒绝。= 我方 `adapters/src/storage/workspace-hook-trust-store.ts`（常量 16-24 行、方法 189-280 行）一致。路径解析：真值读 user config `storage.dir`（~/ 前缀/绝对/相对 home），默认根 `.zcode`；我方 `~/.drora/cli/config.json` + 默认 `.drora`（仅品牌）。
- **policy**：三态 deny/user_decides/allow_trusted_only + policyRevision（真值 1308850 `eH`）= 我方 `contracts/src/hooks/workspace-hook-trust-store.ts:24-46` 一致；默认 `user_decides + builtin:user-decides:v1`（真值 5071100 `PQs`）= 我方 `workspace-hook-policy.ts:4-7` 一致。
- **coordinator**：`WorkspaceHookTrustCoordinator`（真值 5072400 `Fpt`）：canMutatePersistentTrust/assertPersistentTrustMutationAllowed/replacePersistentTrustRecords/revoke/securityRevision(epoch+counter) = 我方 `workspace-hook-trust-coordinator.ts` 一致。
- **授权时机与未信任处理**：SessionStart 等 source 触发 `activate`→refreshEvaluation→上报 pendingCount（软门禁）；dispatch 边界 `evaluateDispatch` 每次重验 securityRevision 与 digest（真值 5080200 = 我方 `workspace-hook-runtime-admission.ts:116-191` 一致，授权决定不缓存）；runner 内每 hook dispatch 前再次解析 admission（真值 `g_e.run` = 我方 `runner.ts:82-111`）。pending→HookRunBlocked 事件（blockReason=reasonCode）；configured-disabled→skipLifecycle 不发事件不计 hookCount；activate 评估异常→bootstrapFailed→trust_store_corrupt fail-closed；admission gate 抛错→fail-closed blocked_untrusted。
- **review flow**：`hXt`（1308000：reviewFlowId/generation/interactionId/sessionId/workspaceIdentity/bundleDigest/state pending|resolved|superseded|cancelled|timed_out/deadlineAt>=createdAt/supersededByInteractionId 双向约束）= 我方 `contracts/src/hooks/workspace-hook-trust.ts:275-311` 一致；`createFlow/settle`（真值 5087300 `LQs`）：deadline timer unref、timed_out→no_change+interaction_timeout、superseded 须显式替换 = 我方 `workspace-hook-review-flow.ts` 一致；review 超时我方 10min（`workspace-hook-trust.ts:4`），真值常量值未直读（OQ-2）。
- **telemetry**：真值 10 事件名（review_request_created/review_timeout/stale_response/snapshot_mismatch/trust_selected/revoked/trust_store_failure/toggle_failure/config_rebuild_failure/review_superseded，13886500 `nkt`）+ feature_disabled/policy_blocked（5080200）= 我方 `workspace-hook-telemetry.ts:4-18` union 全覆盖；identity/derangement 脱敏（sha256 前 12）我方显式实现。

## §3 执行器

- **Runner**：真值 `InMemoryHookRunner`（5057300 `g_e`）= 我方 `runner.ts`：admission 预扫描剔除 skipLifecycle→hookCount 修正、循环内 admission 重解析、async command→background（独立生命周期，输出不回流）、AbortController+`Symbol("hook-timeout")`、HookRunStarted/Completed/Failed/Blocked 生命周期事件、diagnostics 截断 4000、blockReason 进终态事件。逐行一致。
- **spawn**：command→shell 模式（shell:true|string 可选），process→argv 模式；经 executionPort（真值 `Wio` 5056800 = 我方 `configured-runner-callback.ts`）。env overlay：真值 5 基础键（CLAUDE_CODE_SESSION_ID/CLAUDE_PROJECT_DIR/CLAUDE_SESSION_ID/ZCODE_PROJECT_DIR/ZCODE_SESSION_ID）+plugin 6 键（CLAUDE_PLUGIN_DATA/ROOT + ZCODE_PLUGIN_DATA/ID/NAME/ROOT，真值 5050450 `I0n`）；我方同构但 ZCODE_*→DRORA_*（`configured-runner-input.ts:74-98`）→ SHAPE-DIFF-1。
- **变量展开 `${…}`**：两侧各 11 键，品牌不同（真值含 ZCODE_SKILL_DIR；我方含 DRORA_SKILL_DIR）；skill 上下文缺失时两侧均抛 ConfigurationError(recoverable)。
- **超时**：`resolveHookTimeoutMs`（真值 `Mio→wOe`，4099500）：`timeoutMs ?? (command.timeout*1000) ?? default`，`max(1,round)`；默认 60000ms、maxOutputBytes 32768（真值常量 `Mjs/Njs`）= 我方 `shared/workspace-hook-config.ts:7-8,113-127`、`contracts:425-430` 一致。
- **stdout 解析**：`parseHookStdout`（真值 `wQs`）：非 `{` 开头/非 JSON→视为诊断文本忽略；schema 校验失败抛 ToolExecutionFailed。exit code 2→`createExitCodeBlockOutput`（真值 `kQs`）：PreToolUse→deny、PermissionRequest→decision.deny、Stop→decision:"block"、其余 continue:false；stderr 优先作 reason；exit 0 才解析 stdout；非 0 非 2→ToolExecutionFailed(recoverable)。与我方 `configured-runner-callback.ts:118-238` 逐行一致。`HookJSONOutputSchema`（真值 1311500 `uyr`：decision approve|block、hookSpecificOutput 7 分支、additional_context、continue、suppressOutput、systemMessage、stopReason、reason）= 我方 `contracts/src/hooks/index.ts:196-292` 逐字一致。
- **输出语义**：`processHookOutput`（真值 5052900 `Lio`）：continue:false→blockRequested(+preventContinuation 于 PreToolUse/PermissionRequest/UserPromptSubmit)；Stop+continue:true→stopShouldContinue；decision:approve→allow（限 permission 事件）；decision:block→block+Stop 时 systemMessage/reason 入 context；hookSpecificOutput 事件名错配抛错；mergePermissionBehavior deny>ask>allow。= 我方 `output.ts:11-160` 逐行一致。
- **matcher**：`matchesHookMatcher`（真值 5056100 `jio`）：空|`*`→true；`^[a-zA-Z0-9_|]+$`→按 `|` 精确枚举；否则 RegExp(test)。= 我方 `output.ts:98-112` 一致。
- **descriptor 脱敏**：`createHookExecutionDescriptor`（真值 5052300 `E0n`：clientVisible=非 internal、executionMode=command&&async→background）与 `sanitizeHookDisplayText`（`ZG`：URL 凭据/authorization 头/query/cookie 类键名→`••••`）、`quoteCommandPart` 安全字符白名单 = 我方 `display-metadata.ts` 同构（真值 secret 键名正则 `access[_-]?token|api[_-]?key|credential|password|private[_-]?key|secret|token`）。

## §4 配置面

- **配置文件**：项目级 `zcode.json` / `.zcode/config.json` / explicit（真值 configFileKind 枚举 1306900 + discovery `Sat` 模块 4099300）= 我方 `drora.json` / `.drora/config.json` / explicit（`shared/workspace-hook-config.ts:174-248`）；发现顺序（自 cwd 上溯至 `.git` 根反转 + explicit 去重保留首现）一致。brand 不同→SHAPE-DIFF-2。
- **hooks 键结构**：`{enabled?,timeoutMs?,maxOutputBytes?,events?{7事件:[{matcher?,hooks:[…≥1]}]}}`（真值 4099500 `pre`）= 我方同构；hook 两型：process{command,args?,enabled?,timeoutMs?,statusMessage?} / command{command,async?,shell(true|string)?,enabled?,timeout(秒)?,timeoutMs?,statusMessage?}；配置层 passthrough、snapshot 层 strict 一致。config 层 matcher `min(1)`（真值 `dre`）两侧一致；contracts 运行态 patch 层 matcher 无 min(1)（真值 `qz`）两侧亦一致。
- **顶层归属**：真值 config 顶层键含 `hooks`（4085600，与 modelStream/permission/plugins/… 并列）= 我方 `adapters/src/config/schema.ts:266-306` DroraConfigFileSchema.hooks。作用域：sourceKind user/plugin/project/internal；workspace hooks 插入首个非 user 之前（真值 `EQs` = 我方 `configured-runner.ts:174-191`）。
- **runtime root 合并**：enabled 需显式 true 才开启（默认 false→runtimeHooksEnabled=false→全部 skipLifecycle）；`resolveWorkspaceHookRuntimeRoot`/`resolveWorkspaceHookConfiguredGates` 真值（4099500 `vat/sHr`）= 我方 `workspace-hook-config.ts:130-167` 一致。
- **digest**：declaration digest 输入 11 元组（含 shell 的 unset/true/string 三态编码、canonicalOptional ["unset"]/["set",v]）、bundle digest 输入（真值 `G0e/fun/Hjs/pun` 4100500）= 我方 `shared/workspace-hook-digest.ts` 逐行一致；reviewItemId 格式 `workspace-hook-{srcIdx}-{event}-{matcherIdx}-{hookIdx}` 一致。

## §5 差集三分类

| # | 分类 | 级别 | 内容 | 真值证据 | 我方证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | SHAPE-DIFF | P2 | hook 进程 env 与 `${…}` 变量品牌键：真值 `ZCODE_PROJECT_DIR/ZCODE_SESSION_ID/ZCODE_PLUGIN_DATA/ID/NAME/ROOT/ZCODE_SKILL_DIR`，我方以 `DRORA_*` 等价替换（CLAUDE_* 兼容层两侧均保留、键数 5+6/11 对等）。第三方为 zcode 编写的 hook 显式引用 ZCODE_* 时在我方静默取空 | 5050275-5050500 `I0n/h_e` | `configured-runner-input.ts:79-97,106-121` |
| 2 | SHAPE-DIFF | P3 | configFileKind 枚举值 `zcode.json/.zcode/config.json` vs `drora.json/.drora/config.json`；该字符串进入 bundle digest 输入，两侧 trust 记录/bundle 互不认领（品牌隔离的预期后果：迁移场景需重新授权） | 1306937 | `workspace-hook-config.ts:20,237-241` |
| 3 | SHAPE-DIFF | P3 | trust store 路径解析：真值 `~/.zcode/cli/config.json` storage.dir→默认根 `.zcode`；我方 `~/.drora/cli/config.json`→默认根 `.drora`；文件名/锁/corrupt 恢复行为一致 | 1550700 `yas/kas` | `workspace-hook-trust-store.ts:130-142` |
| 4 | SHAPE-DIFF | P3 | stdin transcript 临时目录前缀 `zcode-claude-hook-` vs `drora-hook-`（无行为影响，清理语义一致） | 5050150 | `configured-runner-input.ts:25` |
| 5 | EXTRA | P3 | `ToolCallHookMeta."drora/isSkill"/"drora/skillName"`（hook 元数据展示扩展）：真值 `isSkill` 仅出现于 plugin 能力域（4086208/12596342），hook meta 域未见该键。UI 域所有权属批 6/F1 | 4086208 | `packages/shared/src/hooks.ts:84-85` |

REAL-GAP：0 项。历史基线复核：hooks-trust「settings.json 永无法授权」断裂在当前真值已不可复现（store load/grant/review/policy 门全链路完整，5c58bf1 修复已在真值 0.16.9 中）；我方同链路完整。批 2 的 DRORA_* 结论复测属实；批 6 hookDetail 13 字段（KVt，686600）与 `HookExecutionDescriptor`（Lgc）schema 两侧一致。

## §6 OPEN-QUESTION

1. OQ-1（已解决记录）：真值 QV 记录 schema 尾部经 1308700 补窗确认含 `matcherIndexAtGrant/hookIndexAtGrant/appVersionAtGrant`，我方字段全集一致，非 EXTRA。
2. OQ-2：真值 review flow 超时常量值未直接取证（我方 10min，机制一致）；建议后续在 bundle 内定位 review-request 构造点确认数值。
3. OQ-3：真值 `SubagentStop`(17)/`SessionEnd`(4) 属 subagent/session 生命周期域、不在 hooks 事件枚举中，故不计 hooks REAL-GAP；CLI 是否需在其他域对齐归口对应调查员。
4. OQ-4：`ToolCallHookMeta` 真值对应键名（isSkill/skillName 在 hook meta 上下文的品牌前缀形态）未定位到，EXTRA-5 定级可能随批 6 结论修正。
