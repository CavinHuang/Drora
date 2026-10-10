# W00 证据报告（W00_EVIDENCE_REPORT）

**工作单：** W00 — 真实仓库基线与安全阻断 Spike　**日期：** 2026-10-10　**实现分支：** `feat/vaultview-impl`　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`

> **撰写人：** W00 证据撰写员。本文整合四份专项审计结果：① admission 时序审计、② 工具写入矩阵审计、③ DB 双 Host spike 审计、④ 基线与身份映射审计。
> **路径约定：** `path:line` 相对实施工作树根 `D:/workspace/projects/Drora-vaultview-handoff/`；临时 Spike 资产在 `C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/`（仓库零改动）。
> **诚实声明：** 撰写员亲自执行的检查逐条标注「撰写员已复核」；其余证据引自审计员素材（审计员在基线 HEAD 上实际运行，命令与退出码见各节及三份专项文档）。typecheck / lint / architecture:check 的门禁数字来自交付素材，撰写员本会话未重跑，最终以脚本统一运行记录为准（见 §2）。

## 0. 一句话结论

基线与交接包代码事实完全一致（非 docs 差异为零），S02（admission 扩展边界）与 S03（全写入门控）均判**有条件 GO**：S02 的三层扩展点已实证存在但缺 Receipt 载体与三处复验接线；S03 的分层骨架完整但有三洞必须先修、且「全字面覆盖」做不到的部分须收窄为审计日志口径并记入 spec；若 VaultView 不接线执行前复验而直接开写路径，则两门均降为 NO-GO（只允许只读检索分支，见 `docs/vaultview-agent-handoff/03_WORK_ORDERS/W03_EVIDENCE_AND_REAL_AGENT.md:13` 阻断条款）。

## 1. 基线与环境事实

| 项 | 值 | 证据来源 |
| --- | --- | --- |
| HEAD | `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb` | 基线审计员 `git rev-parse HEAD`；**撰写员已复核**（本会话重跑，输出一致） |
| 分支 / 工作树 | `feat/vaultview-impl`，`git status --porcelain` 为空（干净） | 基线审计员；**撰写员已复核** |
| node / pnpm | node v24.1.0、pnpm 10.33.2（`mise.toml:2-3` 钉 node 24.14.0 / pnpm 10.33.2，本地 mise 未激活） | 基线审计员 `node --version` / `pnpm --version`；node 版本**撰写员已复核** |
| freshness | **exit 0**：`feat/vaultview-impl 没有远端跟踪分支，跳过 behind-remote 检查`、`基线新鲜：feat/vaultview-impl，相对 origin/main：ahead 330 / behind 0（阈值 50）` | **撰写员已复核**（本会话在 worktree 根实际运行 `node scripts/check-workspace-freshness.mjs`，EXIT=0） |
| 与交接基线的代码差异 | `c39ce371` = 交接基线 `c1870c9c` + 唯一 docs 提交；`git diff --name-only c1870c9c..HEAD` 非 `docs/vaultview-agent-handoff/` 文件计数 = **0**（38 files changed 全部为交接包文档） | 基线审计员 `git diff --name-only … \| grep -cv '^docs/vaultview-agent-handoff/'` → 0 |
| 仓库 SQLite 依赖 | 零（`grep -rn --include=package.json -iE "sqlite" packages apps` 退出码 1，无匹配）；Electron 41.0.3（`packages/desktop/package.json:79`） | DB spike 审计员 |

## 2. 提交前检查（gates）

| 命令/场景 | 环境 | exit code | 证据与说明 |
| --- | --- | ---: | --- |
| `pnpm typecheck` | Windows / node v24.1.0 / worktree 根 | **0** | 交付素材提供，撰写员本会话**未重跑** |
| `pnpm lint`（oxlint） | 同上 | **0** | 交付素材提供；输出摘要尾部 `Found 387 warnings and 0 errors. Finished in 160ms on 2970 files using 12 threads.`（摘要中含 `packages/ui/src/v4/SessionPane.tsx:80-81` `setProjectOpen` 未使用 setter 一类的 warning 样例）。撰写员本会话**未重跑** |
| `pnpm architecture:check --changed` | 同上 | **0** | 交付素材提供，撰写员本会话**未重跑** |
| `node scripts/check-workspace-freshness.mjs` | worktree 根 | **0** | **撰写员已复核**（输出见 §1） |
| 全量 `node --test` | worktree 根 | 未出结果 | 由脚本统一执行；撰写时结果尚未产生，最终以脚本运行记录为准，本报告不预先声明其结论 |
| 专项 Spike（admission / 写入矩阵 / DB） | 临时目录 | 全部 **0** | 见 `W00_ADMISSION_SEQUENCE.md` §8、`W00_TOOL_WRITE_MATRIX.md` §7、`W00_DB_HOST_SPIKE.md` §2 |
| `git apply --check`（候选 Hook Patch 原样） | worktree 根 | **128**（corrupt patch at line 23） | 基线审计员实测，见 §5 |
| `git apply --check`（LF 修复版补丁，干跑） | worktree 根 | **0** | 基线审计员实测（`patch-lf.patch`，仅证明内容匹配，**补丁未应用**） |

按分工，脚本将统一运行 `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` 与全量 `node --test`；测试基线既有失败文件为 `desktopRendererPlatformMobileFace.test.ts`、`computerUseSettingsNavigation.test.ts`、`nonCliAcpRetirement.test.ts`（不必修复、不得新增）。模板要求的 `git diff --check` 与 PR 附件不适用：本工作单只新增交付文档，提交由脚本统一执行。

## 3. 与交接包不符事实清单（偏差记录）

以下均为基线审计员在真实仓库核实的差异，处理原则是**按真实仓库执行并记录**：

1. **T0 Spike 源码 ZIP 未随交接包提交**：`docs/vaultview-agent-handoff/05_REFERENCE/T0_SPIKE_SOURCE_AND_TESTS.md:3-5` 自述 ZIP（SHA-256 `2adcc7de…`）「没有包含在本次仓库提交中」，`find docs/vaultview-agent-handoff -type f` 全列表无 `.zip` → 交接包「读取本包 T0 Spike 源码」类假设部分不成立；仅存 T0 报告。
2. **候选 Hook Patch 在 Windows 检出下损坏**：blob 缺尾换行 + `core.autocrlf=true` 检出 CRLF 化，原样 `git apply --check` 报 `error: corrupt patch at line 23`、退出码 128；LF 规范化并补尾换行后干跑退出码 0 → **补丁内容与 HEAD 的 `permission-request.ts` 完全匹配**，但落地前必须以 LF 重导出。T0 报告 `T0_VALIDATION_REPORT.md:54` 的「已过 git apply --check」在本环境不成立。
3. **候选 Patch 行为超前于现行 spec**：`.md-only` + 拒隐藏段收窄与 `specs/obsidian-plugin.md:130-134`（根内 Write/Edit 且 `allowAgentWrites=true` 一律 allow）不符 → 按 AGENTS.md「行为改动前先更新 spec」，应用前须先改 spec。
4. **T0 验证环境与本仓不同**：T0 在 Linux + Node v22.16.0 验证 node:sqlite/FTS5；本仓 Windows + node 24.1/24.14。Electron 宿主可用性已被本仓 DB spike 审计员实测补齐（Electron 41.0.3 main 进程可用，见 `W00_DB_HOST_SPIKE.md` §1），但 renderer/utilityProcess 仍未验证。
5. **REPO_FACTS_AND_GAPS.md 表中全部路径/事实经核属实**（hooks 三脚本、matcher `Write|Edit`、`# userselect` 仅 path+text、`channels.ts:168`、`droraSession.ts`、`host/index.ts` 等）；其中「现有证据格式只含路径+文本」一条撰写员已复核（`packages/ui/src/lib/conversationSelectionReference.ts:150-156`，注释「只保留路径，不发送内部身份字段」）。
6. **`.oxlintrc.json:78` 忽略整个 `apps/drora-cli`** → obsidian-plugin 不受根 lint 约束，质量靠包内 `node test/agent-access.test.mjs && node test/hooks-e2e.mjs`（`pnpm-workspace.yaml:12` 亦将其排除出 workspace）。
7. **`architecture-policy.yaml` 无 knowledge 模块**：未来 `packages/services/src/knowledge/**` 落入 services 模块（managed:false），受全局约束（400 行/文件、300 契约行、12 公有方法、禁环、禁深导入）；服务注册先例 `IObsidianVaultService`（`packages/services/src/node.ts:2716` + `packages/shared/src/channels.ts:168` + `packages/services/src/index.ts:68-71`）可循。
8. **运行时版本混用**：本地实跑 node 24.1.0（SQLite 3.49.1，node:sqlite 仍打 ExperimentalWarning）与 Electron 41 内嵌 Node 24.14.0（SQLite 3.51.2，无实验警告）并存；WAL 格式向前兼容，但属跨运行时版本混用，须记录（`W00_DB_HOST_SPIKE.md` §3）。
9. **候选 Patch 拼写缺陷**：patch 以原始 `access.rootPath` 为基做 `relative()`，而授权路径基于 `realpath(rootPath)`；根为软链/junction/subst 时 rel 带 `..` 段 → 全部拒绝，自动 allow 整体**静默退化**为逐次询问（fail-closed 安全无虞，但授权承诺失效）。建议让 `resolveAuthorizedVaultPath` 返回相对 realRoot 的路径供 patch 复用。

## 4. 身份映射与单一事实源核实

四类身份映射全部查明为单一路径（基线审计员证据，行号可直接引用）：

- **Vault 配置唯一事实源** = 插件数据目录下 `vault-config.json` 单文件：`packages/services/src/obsidian-vault/obsidianVaultService.ts:53-57`（`resolveObsidianPluginDataDir()`，公式 `<~/.drora>/cli/data/obsidian@drora-plugins-official`；`:44` 插件 id），services 门面与 hooks 每次只读重读（`:110/:172/:278/:302`）。**撰写员已复核**该文件 `:44` 与 `:53-57`。
- **DRORA_PLUGIN_DATA** 生产 3 处同一路径：`apps/drora-cli/packages/core/src/hooks/configured-runner-input.ts:96`（hook env overlay）与 `:121/:125`（变量展开）、`apps/drora-cli/packages/adapters/src/plugins/mcp.ts:212`（MCP env）、`apps/drora-cli/packages/bootstrap/src/custom-command-shell-expansion.ts:176`；目录公式 `apps/drora-cli/packages/adapters/src/plugins/marketplace.ts:2899-2902` + `apps/drora-cli/packages/bootstrap/src/app/paths.ts:5-7`；消费 `apps/drora-cli/packages/obsidian-plugin/src/hooks/support.ts:17-19`（`DRORA_PLUGIN_DATA ?? OBSIDIAN_PLUGIN_DATA`）。
- **焦点身份链全程可追溯**：`sess_<uuid>`（`apps/drora-cli/packages/contracts/src/interfaces/shared.ts:31-33`）→ UI `activeTaskId`（`packages/services/src/drora-agent/droraTaskServiceAdapter.ts:1284`）→ `WorkspaceShellLayout.tsx:1855` → `VaultView.tsx:1114-1125` setUserContext → `vault-focus.json` 单写者（`obsidianVaultService.ts:128-168`，7 天/50 会话修剪 `:67-68`）→ hook stdin `session_id`（`obsidian-plugin/src/hooks/user-prompt-submit.ts:14`；`configured-runner-input.ts:23-37` 双写 camel/snake 契约）。
- **workspaceIdentity** 统一公式 `workspaceIdentity?.trim() || workspacePath` 六处一致（`packages/shared/src/task-realtime-core.ts:82` 等），与 AGENTS.md 一致；持久化投影 win32 小写+sha256 前 16 位（`apps/drora-cli/packages/core/src/memory/project-root.ts:10-24`）。
- **Source Identity 尚无实现**：现状 `# userselect` 仅 `{path,text}`、无可信 receipt（`conversationSelectionReference.ts:150-156`）；`SourceRef(sourceId/sourceEpoch/vaultId)` 仅存在于交接包设计文档 → 与 W03.4（`W03_EVIDENCE_AND_REAL_AGENT.md:8`「`{text,path}` 不是 Receipt」）一致。**撰写员已复核**。

## 5. 候选 Hook Patch 评审（未应用）

对象：`docs/vaultview-agent-handoff/05_REFERENCE/CANDIDATE_PERMISSION_PATCH_DO_NOT_BLINDLY_APPLY.patch`。结论：**内容与 HEAD 匹配、方向正确（收窄 auto-allow），但不满足落地条件，保持未应用**。

- 匹配性：LF 修复后 `git apply --check` 退出码 0（基线审计员实测）；原样 apply 退出码 128 的根因是 CRLF+缺尾换行（§3.2）。
- 语义：在现有 containment 判定后纯收紧（拒绝空 rel/隐藏段/含 `..` 段、仅放行末段 `.md`），消除「hook 对 `.obsidian` 与非 .md 自动 allow 而面板门面拒绝」的不对称；containment 本身由 `apps/drora-cli/packages/obsidian-plugin/src/lib/agent-access.ts:42-63`（realpath 根包含 + 逐段 lstat 拒软链）与 `lib/paths.ts:64-85` 保证。**撰写员已复核** `permission-request.ts:5-42` 的自动 allow 与 fail-closed 结构。
- 两项缺陷须处理（§3.3 spec 超前、§3.9 realRoot 拼写错位）后才能落地。
- 覆盖边界（已由源码证实）：matcher 仅 `Write|Edit`（`plugin.json:24`）；runtime 已 allow、工具自报 proceed、deny 三条路径都在 hook 之前提前返回（`apps/drora-cli/packages/core/src/tool/executor/permission-flow.ts:123-158`，**撰写员已复核**）→ **hook 只覆盖基础判定为 ask 的集合，Bash/MCP/脚本写盘完全不经 hook**，不能作为 S03 全写门控证据。

## 6. 真实/假设划分

**已确认（confirmed，关键项）**：§1 全部基线事实；§3 全部偏差；§4 全部映射；§5 patch 状态；S02 相关——CommandInbox 双层 admission（`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/command-inbox.ts:117/141/162-164`、`decide` 的 revision `:352`/logEpoch `:340`/rowTarget `:366`/guard `:394`，**撰写员已复核**）、真执行点 `executeTurnCommand`（`apps/drora-cli/packages/core/src/runtime/methods/runtime-command-queue.ts:205`，**撰写员已复核**）、UserPromptSubmit hook 可阻断（`core/src/runtime/methods/turn.ts:363-370` 与 `:372-419`，**撰写员已复核**）、auto-drain 合成 envelope 绕过 inbox（`apps/drora-cli/packages/bootstrap/src/drora-protocol/v4-bridge.ts:645-657`，clientId=`v4-auto-drain`，**撰写员已复核**；入口 `:1080-1083`）、sendQueuedNow 唯一漏斗（`…/commands/handlers/queue.ts:165-291`，**撰写员已复核**）、guide 通道零闸门（`core/src/runtime/methods/turn-guide-drain.ts:13-66` 无 hook 调用，**撰写员已复核**）、协议无 Receipt 载体（`apps/drora-cli/packages/contracts/src/interfaces/session.port.ts:281-316`，**撰写员已复核**）、busy 三分 admission（`core/src/runtime/methods/prompt-admission.ts:20-126`，**撰写员已复核**）；S03 相关——plan 模式 MCP 直通（`apps/drora-cli/packages/core/src/permission/service.ts:415-422`，**撰写员已复核**）、yolo 直通（`service.ts:136-138`，**撰写员已复核**）、规则 subjects 仅 6 键（`service.ts:292`，**撰写员已复核**）、Bash 整工具 allow 短路（`core/src/tool/handlers/bash-command-rule-evaluator.ts:14`，**撰写员已复核**）、path-policy 无 workspaceRoot 硬边界（`core/src/tool/path-policy.ts:36-39`，**撰写员已复核**）、memory md 免确认且覆盖 plan deny（`core/src/tool/executor/memory-file-permission.ts:38-46/:74-86`，**撰写员已复核**）、「总是允许」默认整工具 allow 建议（`core/src/tool/executor/permission-suggestions.ts:24-36`，**撰写员已复核**）、MCP capability 全凭 server 自报 hint（`core/src/mcp/index.ts:108-123`，**撰写员已复核**）；DB 相关——node:sqlite 在 node 24.1.0 与 Electron 41.0.3 main 均可用、WAL/互斥/lease-fencing/崩溃恢复四项 spike 全部真实跑通（`W00_DB_HOST_SPIKE.md` §1-§2）。

**假设/待验证（hypothesis，不得当作已确认）**：Electron renderer/utilityProcess 内 node:sqlite 可用性；真实 Electron 双窗口并发写同库；断电级 WAL 中间态帧恢复；DB 连接所有者进程粒度决定 spike 语义与 window-scoped Host 的等价性；S01 多 Host、S04 Vault identity、S05 中文词法（W0 专项未覆盖）；全量 `node --test` 结果（撰写时未出）。其余逐项标注见三份专项文档的「未执行/未验证」节。

## 7. S02 / S03 GO/NO-GO 汇总结论（基于审计员预判汇总；最终判定归工作单 owner）

| 专项审计 | S02（admission 前重验 Source/Receipt） | S03（全写盘通道强制分级门控） |
| --- | --- | --- |
| ④ 基线与身份映射 | hypothesis、暂不足以 GO（当时 admission 时点未深查） | 倾向 NO-GO（「hook 即完整防线」不成立） |
| ① admission 时序 | **有条件 GO** | 未覆盖，不给判定；确认 guard/admitCommandInput/UserPromptSubmit 可作门控接入候选 |
| ② 工具写入矩阵 | 不适用（adjacent：`permission-flow.ts:179-236` hook 与 broker 竞速时序曾有问题并修复） | **GO（有条件，需收窄口径）** |
| ③ DB 双 Host spike | DB 层有条件 GO（不构成阻断） | DB 层 GO（前提按纪律实现） |
| **汇总** | **有条件 GO** | **有条件 GO（收窄口径）；hook-only 路线 = NO-GO** |

**S02 有条件 GO**——④号审计员的保留（admission 时点未验证）已被①号专项审计解决：可靠扩展边界存在，无需修改 Runtime 队列语义（符合 W03:13「禁止修改 Runtime 队列语义来掩盖问题」）。GO 前提是完成最小接线：

- (a) shared contracts 增加 Receipt 引用字段（契约键单一出处），随 sendText payload / `TurnInputIntentMetadata`（`session.port.ts:281-316`）与 QueueItem 持久化；
- (b) 在 `sendQueuedNow` 漏斗（`queue.ts:165`，手动提升与 auto-drain 合成命令都汇于此）与空闲直发闸前（`admitCommandInput` 或 `startPromptTurn` 闸前）调用 VaultView 服务复验 授权 + fileSha + sourceEpoch，失败按 guard 拒绝并落账本终态；
- (c) guide 通道要么在 `drainPendingInput`（`core/src/runtime/methods/steering.ts:1140`）加等价复验 port，要么约定 VaultView 输入禁用 guide 投递；
- 复验失败语义：拒绝该项提升（queue 保留/取消），**不得静默降级为 current**（满足 W03:3）；
- **反面判定**：若 VaultView 不接线复验而直接开写路径 → NO-GO，只能保留只读检索分支。

**S03 有条件 GO（收窄口径）**——②号审计员判定骨架完整、缺的是「分级一致性」而非「从零建门」；④号审计员的 NO-GO 倾向针对「仅靠 PermissionRequest hook」路线，双方证据一致：hook 只覆盖 ask 集合且 matcher 仅 `Write|Edit`。GO 前提：

- 先修三洞：(1) plan 模式两处打洞——无 `destructiveHint` 的 MCP 直通（`service.ts:415-422`）+ memory md 覆盖 plan deny（`memory-file-permission.ts:38-46`）；(2) node_repl/MCP 无内容规则粒度 → 一次「总是允许」= 持久化整工具 allow（`permission-suggestions.ts:24-36` + `service.ts:292`）；(3) Bash 整工具 allow 规则短路含重定向在内的一切命令（`bash-command-rule-evaluator.ts:14`）；
- 门控面按「落盘目标可判定性」分三级：P0 任意路径写（Bash/js/未声明 destructive 的 MCP）强制逐次确认 + 禁整工具持久 allow；P1 授权根内写（Write/Edit，含 obsidian vault hook 路径）维持现骨架；P2 免确认区（memory md/workflow 草稿/artifacts/执行日志）保留但强制审计事件；
- 收口点已存在：`resolveToolCallCapabilityFlags`（`permission-capability.ts:28-39`）随 `ToolCallStarted` 广播，可作为统一分级判定挂点；
- 「全」字做不到的部分（MCP server 进程内写盘、宿主自动写盘、yolo 直通）改为「模型可见工具全覆盖 + 自动写盘审计日志 + yolo 需显式 receipt」，并在 `specs/` 记录为有意分歧；
- 门禁实现必须在 permission service/runtime 层程序化完成，不依赖插件 hook（④号审计员同结论）。

**DB 层输入（③号）**：跨进程 `BEGIN IMMEDIATE` 互斥与 busy_timeout 等待已实证，可为持久化队列提供串行化基础，但 DB 锁只保证串行化、不保证 admission 顺序与过期来源拒绝——顺序仍归 CommandInbox/Host owner；DB 层不构成 S02/S03 阻断项，风险面（全新 SQLite 依赖、node 24.1 实验警告、非 main 进程未验证）须在门禁记录。

## 8. 评估和安全（模板第 3 节）

- **Source 权限与数据出站检查**：现状 `# userselect` 仅 `{path,text}` 出站（`conversationSelectionReference.ts:150-156`），无可信 receipt；Receipt 载体与执行前复验为 S02 GO 前提（§7）。
- **跨 Host / Runtime admission / 队列**：两层 admission、三条重放路径与扩展点盘点见 `W00_ADMISSION_SEQUENCE.md`；队列事实源唯一（TurnSteerQueued 事件 → v4 投影 `queue.items`）。
- **Jev 真联调与数据集结果**：本工作单未涉及，未执行。
- **已使用的模拟/Fixture 及未验证部分**：全部专项测试使用合成临时 Vault/库（`C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/`），未触碰用户真实 Vault；未验证项见 §6 假设清单与各专项文档「未执行」节。

## 9. 结果与门槛（模板第 4 节）

- **通过的验收 ID**：W00 执行项 1（基线核对，含 freshness）、2（发送/排队/admission 时序）、3（写入边界矩阵）、4（DB spike，范围=node 双进程+Electron main probe）、5（身份映射 + patch 评审）；完成门槛中的 typecheck/lint/architecture 基线记录为素材提供的 exit 0（撰写员未重跑）。
- **有条件通过**：S02（三处接线为前提）、S03（三洞先修+分级收窄为前提）、DB Host（连接所有者进程粒度确认 + 真实双窗口复测为前提）。
- **GO/NO-GO**：S02 有条件 GO；S03 有条件 GO（hook-only = NO-GO）。不接线复验而开写路径 = 双 NO-GO（只读分支）。
- **回滚步骤**：本工作树仅新增 `docs/vaultview/delivery/` 四份文档，删除该目录即完全回滚；无代码改动。
- **下一阶段建议**：W02 之前先落 S02 的 (a) 契约字段（shared contracts 单一出处）与 S03 的三洞修复 spec；候选 Hook Patch 落地顺序固定为「先改 spec → LF 重导出 → realRoot 拼写修正 → 再应用」。

## 10. 证据索引

- 专项文档：`docs/vaultview/delivery/W00_ADMISSION_SEQUENCE.md`、`W00_TOOL_WRITE_MATRIX.md`、`W00_DB_HOST_SPIKE.md`。
- Spike 资产（临时目录，可复跑）：`C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/`（admission-seq-spike.test.ts、matrix-probe.ts、bash-policy-probe.ts、spike1-4 脚本、electron_probe_main.js、patch-lf.patch、W00_DB_HOST_SPIKE.md 素材）。
- 撰写员抽查声明：本报告标注「撰写员已复核」的条目为本会话实际读取/运行；未标注者引自审计员素材，其中行号抽查命中率 100%（抽查约 29 处高负载引用，全部与源码一致；抽查范围记录于撰写会话）。
