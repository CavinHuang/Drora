# Batch 10：会话运行时/存储、扩展体系、进程协议/API 客户端、表现层/可观测性 差分判定报告

- 官方样本：`D:/software/zcode/resources/glm/zcode.cjs`（3.14.3，15,127,039 字节）+ `provider/zcode-builtin.json`（revision 30）
- 本仓：`D:/workspace/projects/Drora`（feat/g-backlog-e2e，对齐基线 3.15.1，`config/provider/drora-builtin.json` revision 31）
- 方法：只读 grep/切片；官方证据为 bundle 字面量/偏移，本仓证据为 `文件:行`
- 判定四类：【gap】官方有而本仓缺/不一致；【版本差】本仓 3.15 新增；【有意分歧】rename/自研扩展（引 spec）；【误报】前批报告错误，已验证推翻
- 日期：2026-10-19

---

## 0. 结论速览

| 域 | gap | 误报修正 | 有意分歧（已记录） | 版本差 |
| --- | --- | --- | --- | --- |
| 存储域 | 0 | 0 | 1（drora-artifact URI） | 0 |
| compact | 0 | 0 | 0 | 0 |
| 运行时 | 0 | 1（mailbox 未被 team 替换） | 1（team 自研） | 0 |
| 扩展域 | 0 | 0 | 1（marketplace id 桥接） | 0 |
| 协议/API | 2（V4 签名、快照 20MB 预算） | 2（反向调用规模、thinking type） | 1（Drora Protocol 改名） | 1（reasoningLevel 取值集） |
| 表现层/可观测性 | 0 | 3（task_output 2000、诊断码覆盖、主题存储位置） | 1（遥测 drora.* 超集） | 0 |
| skills_lock | 0 | 0 | 1（自研资产，spec 待登记） | 0 |

合计 gap **2 条**；前批误报修正 **6 条**（含 skills_lock 定性确认）。总体判定：本仓在这四个域对官方 3.14.3 的还原度非常高，已知疑点绝大多数为对齐或误报。

---

## 1. 存储域

### 1.1 差分表

| 差异点 | 官方证据 | 本仓证据 | 判定 | 修复建议 |
| --- | --- | --- | --- | --- |
| 22 migrations / 24 表 | `grep -o '{appVersion:"[^"]*",id:"[^"]*"'` 22 项；`create table if not exists session (` @1515069 | `apps/drora-cli/packages/adapters/src/storage/session-store/migrations.ts:9-930` 22 项 id 全同；session 表 `share_url`(24)/`revert`(29)/`time_compacting`(33)/`time_archived`(34)/`summary_diffs`(28) 逐列一致 | 对齐（还原资产） | 无 |
| session_input 台账 DDL | @1536391：`delivery in('guide','queue')`、status 四态、`(session_id,admitted_sequence)` 索引 | migrations.ts 同构（0016 建、0017 startNow 重建、0018 failed_status） | 对齐 | 无 |
| rewind checkpoint 语义 | `workspace_file_before_change` 2 命中；checkpoint = artifact store 改动前内容 JSON（`{version:1,kind,toolCallId,files[{path,existedBefore,beforeContent,afterContent?,structuredPatch}]}`，`zcode-artifact://` URI） | `apps/drora-cli/packages/contracts/src/rewind/index.ts:95-121` `workspaceCheckpointArtifactSchema` 逐字段一致（strict）；写入侧 `core/src/runtime/internal-turn-methods.ts:238` `emitFileMutationCheckpoint`；URI 改名 `drora-artifact://`（attachment-path-reference.ts:75 等） | 对齐；URI 为【有意分歧】改名（`specs/drora-rename.md` 规则 8） | 无 |

判定说明：batch9 已确认 22/24 全同，本次抽查 session 与 session_input 两表 DDL 及 checkpoint schema 字段集，均逐字一致。checkpoint 的"fork bundle 语义"疑点不成立——本仓同样是 artifact store before-content JSON，fork（`commitForkBundle`/`createForkedSessionWithMetadata`）只是 rewind 策略之一（batch5 §2.4 同构）。

---

## 2. compact 域

### 2.1 差分表

| 差异点 | 官方证据 | 本仓证据 | 判定 | 修复建议 |
| --- | --- | --- | --- | --- |
| 自动 compact 绝对阈值 | `cve=2e5`、`Epo=32e3`、`oda=21e3`、`Apo=13e3`、`Ppo=100`、熔断 `Rpo=3`（~5017735 同族）；公式 `contextWindow − min(maxOut,21k) − 13k` | `core/src/compact/policy.ts:6-14`：200_000/32_000/21_000/13_000/100/3 全同；`getAutoCompactOutputReserveTokens` = `min(maxOut ?? 32k, 21k)`（:75-82）与 `getAutoCompactThreshold`（:84-88）同公式 | 对齐 | 无 |
| microcompact 触发与参数 | `Lpo=.9`、`Fpo=2e3`、`ida=60`、`Mpo=5`、`Npo=256`（本次实取）；双触发 TimeBased/TokenPressure | `core/src/compact/microcompact.ts:14-18`：THRESHOLD_RATIO=0.9、BUFFER=2_000、IDLE=60min、KEEP_RECENT=5、MIN_TOKEN_SAVINGS=256 全同 | 对齐 | 无 |
| microcompact 工具清单 | `jpo=["Read","Bash","Grep","Glob","WebFetch","WebSearch","Edit","Write","ApplyPatch"]`（grep 实取） | microcompact.ts:19-29 九工具逐字相同（含 ApplyPatch） | 对齐 | 无 |
| reactiveCompactAfterContextExceeded | 官方保留名，prompt-too-long 后被动补偿 | `core/src/runtime/internal-turn-methods.ts:191` 同名方法 + `helpers/model-errors.ts` ContextExceeded 判定族 | 对齐 | 无 |

---

## 3. 运行时（Agent/协作/自动化/工作流沙箱）

### 3.1 差分表

| 差异点 | 官方证据 | 本仓证据 | 判定 | 修复建议 |
| --- | --- | --- | --- | --- |
| Agent 子 runtime maxTurns 默认 4 | `maxTurns: t.maxTurns ?? this.config.subagents?.maxTurns ?? 4`（createDefaultSubagentPort 内） | `core/src/runtime/methods/subagent.ts:284` 同表达式逐字一致 | 对齐 | 无 |
| 禁嵌套 subagents.enabled=false | 子 runtime 配置 `subagents:{enabled:!1}` | subagent.ts:305-307 `subagents:{..., enabled:false}` | 对齐 | 无 |
| Agent 输出预算 | `Oyt=12e4`（120KB, strategy artifact） | `core/src/tool/handlers/agent.ts:20` `MAX_AGENT_MODEL_BYTES=120_000`，resultBudget strategy:"artifact"（:247） | 对齐 | 无 |
| session mailbox | `NodeSessionMailboxAdapter`：envelope `{version:1,...}`、`unread/`→`read/` rename、limit 20、`^sess_[A-Za-z0-9._-]+$` | `adapters/src/mailbox/index.ts:13,18-43,70`（version!==1 拒绝、slice(0, limit ?? 20)、rename 原子消费）；hook 注册 `core/src/hooks/session-mailbox.ts:56` source "builtin.sessionMailbox.drain" | 对齐（还原完整） | 无 |
| TeamTask/TeamSendMessage 官方 0 命中 vs 本仓存在 | grep 计数 0 | `core/src/team/`（team-tools.ts/hub.ts/member-runtime.ts 等）；`specs/agents-team.md` 明确"官方上游穷尽 grep 无多代理协作协议面，纯 Drora 自研增量"+替换条件+接缝账 | 【误报修正】：官方 mailbox **未被替换**，两者并存（mailbox 还原 + team 叠加）；team 为【有意分歧】（spec 已记录） | 无（维持现接线） |
| Cron×4 / OffPeak×2 持久化 | CLI 侧仅协议端口 `createProtocolAutomationPort`（requestClient），落盘调度在宿主；第 4 工具为 CronUpdate | `bootstrap/src/drora-protocol/automation-port.ts:63-130`（requestClient + 防递归守卫同文案）、`offpeak-port.ts`；工具面 `core/src/tool/handlers/index.ts:263,270`（CronUpdate、OffPeakCreate/List） | 对齐 | 无 |
| 工作流沙箱 | TS typecheck→lowered JS→`{cwd}/.zcode/workflow-runs/{runId}.mjs`→node:vm `workflow-sandbox`，运行期禁 `Date.now`/`Math.random`（中文注释"belt；编译诊断是 suspenders"） | `dynamic-workflow-runtime/src/child-entry-file.ts:47`（`.drora/workflow-runs`，fallback tmpdir 同构）、`child-source.ts:97,279-298,327`（__WorkflowDate/Math.random 禁令、createContext name "workflow-sandbox"，注释逐字同源） | 对齐（目录名改名豁免） | 无 |

---

## 4. 扩展域（插件/marketplace/skills/hooks/MCP）

### 4.1 差分表

| 差异点 | 官方证据 | 本仓证据 | 判定 | 修复建议 |
| --- | --- | --- | --- | --- |
| manifest 不支持组件警告 | `nYs=["channels","lspServers","outputStyles","settings"]` → `plugin_unsupported_component`（diagnostic-only） | `adapters/src/plugins/index.ts:78` UNSUPPORTED_COMPONENT_KEYS 同四键；:344-356 warning 同文案结构 | 对齐 | 无 |
| userConfig required 无 default | `plugin_variable_missing` warning（woo） | `adapters/src/plugins/mcp.ts:54`、`marketplace.ts:2502` | 对齐 | 无 |
| ui.surfaces | `{id≤128,title,icon?,server,resourceUri≤2048,availability:"session"}` strict schema | `contracts/src/plugins/index.ts:174,181-184`（`ui?: unknown` 注释"ui.surfaces[] 面板入口声明"；PluginUiSurfaceAvailability="session"） | 对齐 | 无 |
| marketplace 默认官方市场 URL | `https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`，id `zcode-plugins-official`（规则 0 豁免外部设施） | `packages/shared/src/plugin-marketplaces.ts:48` 同 URL；canonical id `drora-plugins-official` + `OFFICIAL_MARKETPLACE_UPSTREAM_ALIAS`（contracts/src/plugins/index.ts:7-9）+ `adapters/src/plugins/marketplace.ts` 桥接 | 【有意分歧】（`specs/drora-rename.md` 改名桥接节已记录） | 无 |
| skills 发现路径与优先级 | `{home,project链}/.zcode/skills + .agents/skills` + `skills.roots`；每根 +10（JJs=10） | `adapters/src/skills/roots.ts:8-11`（PRIORITY_STEP=10、DRORA_DIR=".drora"、AGENTS_DIR=".agents"），`.drora` 优先同级合并（:99-100） | 对齐（.zcode→.drora 改名豁免） | 无 |
| skills 注入预算 | `Kla=2e4`（20000）、单行 `Zla=250` | `core/src/context/sections/skills.ts:9-10`（DEFAULT_SKILL_METADATA_BUDGET=20_000、MAX_DESCRIPTION_CHARS=250） | 对齐 | 无 |
| hooks 7 事件 | `Tl={SessionStart,UserPromptSubmit,PreToolUse,PermissionRequest,PostToolUse,PostToolUseFailure,Stop}` | `contracts/src/hooks/index.ts:7-15` 七事件逐字一致 | 对齐 | 无 |
| workspace-hook-trust-v1.json | `<storage>/security/workspace-hook-trust-v1.json`，fail-closed | `adapters/src/storage/workspace-hook-trust-store.ts:21` 同文件名；`packages/shared/src/workspace-hook-trust-store-file.ts` | 对齐 | 无 |
| Stop 续跑上限 | `qja=3` | `core/src/runtime/methods/hooks.ts:10` `MAX_STOP_HOOK_CONTINUATIONS = 3` | 对齐 | 无 |
| hooks 默认超时/输出 | `kJs=6e4`、`xJs=32768` | `contracts/src/hooks/index.ts:434-439`（timeoutMs 60000、maxOutputBytes 32768） | 对齐 | 无 |
| MCP 池 30s idle | `Daa=3e4` | `adapters/src/mcp/pool.ts:18` DEFAULT_IDLE_GRACE_MS=30_000 | 对齐 | 无 |
| `_meta.timeoutMs` clamp | [1e3, 1.8e6]（1s–30min） | `contracts/src/interfaces/mcp.port.ts:357-358`（1_000 / 30*60*1_000）；`adapters/src/mcp/descriptor.ts:39-46` clamp | 对齐 | 无 |
| resources 订阅 | readResource/listResources/listResourceTemplates/subscribe/unsubscribe | `adapters/src/mcp/index.ts:559-623` + `resource-subscriptions.ts` | 对齐 | 无 |
| prompts 未接入 | NodeMcpAdapter 无 prompts 调用 | 本仓 adapters/src/mcp 同样 0 处 listPrompts/getPrompt | 对齐（均未接） | 无 |

---

## 5. 协议 / API 客户端

### 5.1 反向调用（agent→host requestClient）

官方实取 26 个调用点、**18 个唯一方法**（`ii.*`）：

`interaction/requestPermission`、`interaction/requestUserInput`(×3)、`interaction/requestProviderRuntimeHeaders`、`interaction/requestOfficialMcpAuthHeaders`、`interaction/browserList`、`interaction/browserExecute`(×4)、`automation/create|update|delete|list`(×2)|`checkTaskBinding`、`offPeak/create|list`(×2)、`session/requestRuntimePreferences`、`subagents/readRuntimeConfig`、`topic/resource/read|cancel`、`bot/channel/reply`。

| 差异点 | 官方证据 | 本仓证据 | 判定 | 修复建议 |
| --- | --- | --- | --- | --- |
| 反向调用名单 | 上列 18 个 | `packages/shared/src/drora-protocol/index.ts:4153-4280` 注册表**全覆盖 18 个** + `knowledge/search`（:4280，自研）；消费侧 automation-port/offpeak-port/topic-resource-port/server-operations.ts:3218,3442 实调 | 【误报修正】：batch9"7 vs ~20 缺 13"不成立——7 只是 interaction 族；官方 18 个全部已还原，多出 1 个自研 | 无；建议 batch9 结论作废 |

### 5.2 其余判定

| 差异点 | 官方证据 | 本仓证据 | 判定 | 修复建议 |
| --- | --- | --- | --- | --- |
| V4 请求签名 `get_sign_key` | `grep -c get_sign_key` = 1、`c1f3a7e2` = 1（`ClientRequestSigningV4Manager`，`/api/paas/c1f3a7e2/v2/client`） | 本仓 0 命中；`adapters/src/model/request-security-edition/index.ts` 为显式占位（protectTransport 原样返回）；coding-plan 取钥走 `/api/biz/.../api_keys`（`packages/shared/src/project-access-token-client.ts:238,325`） | 【gap】未还原缺口。缓解事实：开源 3.15.1 源码同样无可用签名链（`docs/upstream/zcode-v3.15.1-analysis.md:113`），且 coding-plan 主路径（本仓运行环境）走 api_keys 不依赖签名；受影响面为 start-plan/off-peak 端点（叠加 `specs/start-plan-captcha-verification.md` 已知 captcha 缺口） | 在 specs/（如 upstream-v3.15.1-migration.md）补一条正式决策记录：V4 签名为 bundle-only 能力、开源源无实现、重新评估条件=取得含签名链的官方实现；不必伪还原 |
| GLM-5.3 thinking type | 官方 glm-5.3 anthropic 规则 `thinking{type:"enabled"}+output_config{effort}`（batch7 §3.3）；通用 anthropic 兜底为 `adaptive` | 本仓 GLM-5.3 规则同为 `"type": "enabled"` + effort（`config/provider/drora-builtin.json` modelApiRules `.*glm-5\.3(?:-flash)?...`）；`adaptive` 仅出现在通用 anthropic 兜底（:2547 等），与官方兜底一致 | 【误报修正】：batch9"adaptive vs enabled"不成立，两侧 GLM-5.3 均为 enabled | 无 |
| GLM-5.3 reasoningLevel 取值集 | batch7：`low|medium|high`（无 disabled） | 本仓 `["low","high","max"]`（modelRules） | 【版本差】：本仓 revision 31 > 官方样本 revision 30，属 3.15.x 值面演进；待取得 3.15.x bundle 后二次确认 | 记入上游同步 checklist |
| 快照字节上限 | `sfc=20*1024*1024` 单一 buildSessionSnapshot 预算（bundle 7 处 `20*1024*1024`） | 本仓无单一快照预算常量；护栏分散在 V4 帧（1MiB 物理/16MiB 组装）、附件 20MiB（`drora-protocol-v4/core.ts:65-104`）、relay 8MiB | 【gap】（低危）：legacy `session/subscribe includeSnapshot` 与 `session/read` 路径缺总预算护栏 | 在 snapshot 发送边界加 20MB 预算常量（或 spec 记录"以帧限额替代"的决策） |
| session/read index 模式 | `contentProfile:"index"`、messageLimit | `drora-protocol/index.ts:2008-2012`、`server-operations.ts:1858` `elideSessionSnapshotForIndex` | 对齐 | 无 |
| 协议名 | `zet="ZCode Protocol"` v1 | `DRORA_PROTOCOL_NAME="Drora Protocol"`（`drora-protocol/index.ts:118`） | 【有意分歧】改名（规则 4 品牌词 + 目录改名记录于 `specs/drora-rename.md`；wire header `x-zcode-trace-id`/`x-zcode-session-type` 已列归因豁免） | 无 |

---

## 6. 表现层 / 可观测性

| 差异点 | 官方证据 | 本仓证据 | 判定 | 修复建议 |
| --- | --- | --- | --- | --- |
| task_output 截断 | **`Mot=2e3`**（2000 字符；常量簇 `mOe=1,cin=64,Mot=2e3,bre=256,lin=4*1024` 紧邻 `task_output` display schema） | `contracts/src/tools/tool-result-metadata.ts:28` = 2_000 | 【误报修正】：batch8"8KB"与 batch9"2000 vs 8KB 不一致"均错；两侧同为 2000 字符 | 修正 batch8/9 记录 |
| 遥测指标 18 vs 13 | `zcode.*` 13 instrument（turn/step/tool/command/compaction/detached duration、model.*.duration、3×time_to_first、call.attempts、attempt.tokens、stream_stall、creation_drop、abandoned） | `telemetry/src/agent-metrics.ts:58-93` 18 个 `drora.*`：官方 13 全对应 + 新增 stream_max_idle、command.execution.time_to_first_output 等 | 【有意分歧】命名空间属改名豁免（规则 8；OTLP 端点为用户自配，非 z.ai wire 契约）；超集部分为【版本差/自研增量】 | 在 migration spec 补一行"遥测指标超集清单" |
| 诊断码 60 vs 94 | 官方 ~94 取值（含 zod/i18n 噪音），族：plugin_*(12+)、skill_*、custom_command_*、通用 `*_failed`/io_error 等 | batch9 只数了 contracts 4 族（60）。本次抽查 14 个官方码：`config_mcp_server_invalid`、`workspace_hooks_blocked_untrusted`、`agent_missing_required_frontmatter`、`agent_ambiguous_name`、`marketplace_refresh_failed`、`plugin_dependency_cross_marketplace`、`plugin_hook_read_failed`、`egress_blocked`、`capability_unsupported`、`backend_unavailable`、`write_file_stale`、`stale_write`、`prompt_too_long`、`UNKNOWN_AGENT_TYPE` —— **全部在本仓命中**（adapters/core/bootstrap/shared 各处）；`skill_duplicate_name`/`plugin_ambiguous_name` 为本仓新增 | 【误报修正】（部分）：官方主要诊断码族在本仓分布实现、覆盖良好；"语义覆盖面不等价"结论过严。官方独有且本仓缺失的主要为 zod 内建码与 i18n 噪音，无 protocol/session/mcp 独立诊断码族缺失证据 | 把"诊断码按域分布"记入 migration spec 备注，避免后续以单一目录计数误判 |
| 主题/语言存储 | `getTheme(){return configResult.config.ui.theme}`、`updateUiLocaleInFileConfig` 写 `~/.zcode/cli/config.json`；设置键 `hs.UiLocale="ui.locale"/UiTheme="ui.theme"` 映射**文件配置**（非 local_setting 表） | `adapters/src/config/file-config.adapter.ts:61-62` 存 `~/.drora/cli/config.json` ui.locale/ui.theme | 【误报修正】：batch9"官方存 SQLite local_setting"不成立；两侧同为用户配置文件 | 修正 batch9 §8 表 |
| doctor 0 检查 | runDoctor 仅环境信息 | `cli/src/run.ts:215-241,576` 同 | 对齐 | 无 |
| 日志四要素 | `~/.zcode/cli/log/zcode-YYYY-MM-DD.jsonl`、7 天、Info、DefaultLogRedactor | `adapters/src/logging/index.ts`、`retention.ts:6`、`serialize.ts:15-45` 同构（drora-*） | 对齐 | 无 |

---

## 7. skills_lock.json 自研定性

| 差异点 | 官方证据 | 本仓证据 | 判定 | 修复建议 |
| --- | --- | --- | --- | --- |
| skills_lock.json | `grep -c 'skills_lock\|skills-lock'` = **0** | 仓根 `skills-lock.json`（`{version:1,skills:{<name>:{source,sourceType:"github",computedHash}}}`）；仓内 runtime 代码/package.json/scripts 均无消费引用 | 【有意分歧】自研/仓库工程资产（记录 `.agents/skills` 安装来源与哈希），非官方能力 | 在 specs/（或仓库 README 工程节）补一段 provenance 说明，防止后续被当作上游对齐目标 |

---

## 8. 遗留验证限制

- 官方样本为 3.14.3 bundle（构建 2025-10-13），本仓基线 3.15.1：reasoningLevel 取值集、遥测超集等"版本差"条目需在取得 3.15.x bundle 后跑 `node scripts/check-bundle-key-parity.mjs` 二次确认。
- V4 签名、桌面侧 captcha 注入链（`specs/start-plan-captcha-verification.md`）均属"官方二进制有、开源源无"的能力族，本仓当前以占位/替代路径运行，恢复条件依赖官方实现可见性。

## 9. 前批误报修正清单（供修订 batch8/9）

1. batch7-target-protocol.md/batch9："反向调用 ~20 vs 7" → 实为官方 18 vs 本仓 18+1，全对齐。
2. batch9："GLM-5.3 thinking type adaptive vs 官方 enabled" → 两侧均 enabled。
3. batch8："task_output 上限 8KB" → 官方 `Mot=2e3`（2000 字符），与 batch9 本仓值一致。
4. batch9："诊断码 60 vs 94 语义覆盖不等价" → 抽查官方主要族全部命中，口径错误。
5. batch9："官方主题存 SQLite local_setting" → 官方存 config.json，本仓一致。
6. batch5-target-agents.md §6.1"本仓若走独立进程派发"疑虑 → 本仓 subagent 为同进程子 runtime（`subagent.ts:284`），与官方同构。
