# 官方 ZCode bundle（zcode.cjs）实现调研与 Drora CLI 对齐差距报告

- 日期：2026-10-19
- 调研对象：`D:/software/zcode/resources/glm/zcode.cjs`（官方 GLM 安装目录发行 bundle）
- 对比对象：本仓 `D:/workspace/projects/Drora`（apps/drora-cli，基线 3.15.1，基线新鲜检查通过）
- 方法：11 个批次 × 2 个 subagent（共 22 个只读调研 agent），分域收集 → 逐域差分 → 独立证据复核；分报告 22 份见 `.upstream-parity/reports/`
- 判定口径：【gap】需对齐修复；【版本差】本仓 3.15.x 新增（官方样本为 3.14.3，不算问题）；【有意分歧】rename/自研扩展（须有 spec 依据）；【误报】调研过程中的错误结论，已验证推翻

---

## 0. TL;DR 总体结论

**本仓 CLI 对官方 zcode.cjs 的还原度非常高：最终确认真 gap 仅 2 条。**

- 官方 bundle 为 **3.14.3**（`resources/app/package.json` 的 `@zcode/desktop` 版本），**落后本仓对齐基线 3.15.1**；凡本仓多出的能力先按版本差/自研处理。
- 键族层面干净：`check-bundle-key-parity` 退出码 0，meta/env/permission/diag 四键族归一化后集合一致；`ZCODE_*→DRORA_*` 改名映射 **157/157 完整**，键族 gap=0。
- 文案/常量独立抽测 **86/86 命中**（27 条错误文案、33 条帮助/启动文案、15 个阈值常量、11 条 system prompt 片段），新发现 gap 0 条。
- 差分抽样反向验证 **8 抽 8 中**；调研过程中产生的 9 处误报已全部由批次 11 复核修正（见 §5）。

| 域 | gap | 有意分歧（有 spec） | 备注 |
| --- | --- | --- | --- |
| 键族/配置 | 0 | 改名映射（rename spec） | parity 脚本退出码 0 |
| 斜杠命令 | 1（/team 接线） | /team 自研、.drora 目录改名 | 命令语义/frontmatter/遮蔽序全对齐 |
| 内置工具 | 0 | VaultSearch、TeamTask*×6 | 官方 42 条目全对位 |
| 权限 | 0 | S03 写入保护加固 | 模式/规则匹配/持久化逐字对齐 |
| 存储/compact/运行时 | 0 | drora-artifact URI | 22 migrations/24 表全同 |
| 扩展（插件/skills/hooks/MCP） | 0 | marketplace id 桥接、skills_lock.json | 常量逐字对齐 |
| 协议/API | 1（V4 签名决策缺失） | Drora Protocol 改名 | 反向调用 18 方法全还原 |
| 表现层/可观测性 | 0 | 遥测 drora.* 超集 | task_output 截断等两侧一致 |

---

## 1. 最终差距清单（修复项）

### GAP-1：自研 `/team` 命令在 TUI 与 headless 两个面报 "Unknown command"（gap，高价值修复）

- **现象**：`/team` 仅在 App facade（斜杠面板）生效；TUI 与 headless `--prompt` 均报 `Unknown command: /team`。此前内部结论"headless 生效"为误报。
- **根因**（双侧证据链，batch11 复核维持）：
  - TUI：`apps/drora-cli/packages/cli/src/command-center/slash-commands.ts:40-250` 的 `parseSlashCommand` 无 team 分支 → `type:"unknown"` → `create.ts:64-77` 走文件命令适配器 → Unknown。
  - headless：`packages/cli/src/prompt-command.ts:479-517` 中 team 是保留名（`packages/shared/src/drora-slash-command-help.ts:202-206` 帮助表含 team），`isResolvableCustomCommand` 返 false → 落入 command-center → 同样 Unknown；永远到不了 facade 的 builtin resolver（`bootstrap/src/builtin-prompt-command.ts:72-82`）。
  - 官方侧：`/team` 在 zcode.cjs 中 0 命中（12 处 `"team"` 均为外部 CLI 补全表），属自研命令的接线问题，非官方能力缺失。
- **修复方案**（batch10 C2 最小接缝）：
  1. `slash-commands.ts` `parseSlashCommand` 增加 `team` → `known` 分支；
  2. `create.ts` 照 `/init`、`/workflow` 先例（:208-234）把原文回交 `app.submitPrompt`，由 facade builtin resolver 展开；
  3. `prompt-command.ts` `routesToPromptCommandCenter` 对 known team 返回 false（走普通 prompt → facade 展开）。
  - 涉及文件：`cli/src/command-center/slash-commands.ts`、`cli/src/command-center/create.ts`、`cli/src/prompt-command.ts`。
- **注意**：按 AGENTS.md，此为自研功能（`specs/agents-team.md`）的一致性修复，先补/改 spec 的验收场景再动代码，并加 TUI/headless 面 E2E。

### GAP-2：`get_sign_key` V4 请求签名未还原，且无正式决策记录（gap→spec 层收口，中危）

- **官方实现**（batch11 补全算法证据，@3784600-3789950）：完整 `ClientRequestSigningV4` 族——
  - 握手端点 `POST /api/paas/c1f3a7e2/v2/client`（10s 超时），appId `zcode`，PoW 8 bit，nonce 16B；
  - 签名串 `apiKeyId + ts + clientVersion + sessionId + nonce`；请求头 7 个：`X-Client-Ts`、`X-Client-Version`、`X-Client-Sig`、`X-Session-Id`（强制）、`X-Client-Nonce`、`X-App-Id`、`X-Client-Pow`；
  - `verify_rejected` 重签 1 次后进入 bypass fail-open。
- **本仓现状**：`apps/drora-cli/packages/adapters/src/model/request-security-edition/index.ts:6` 纯占位（`protectTransport` 原样返回），recovery 全 no-op；coding-plan 取钥走替代路径 `/api/biz/.../api_keys`（`packages/shared/src/project-access-token-client.ts:238,325`），不受影响。
- **缓解事实**：开源 3.15.1 源码同样无可用签名链（`docs/upstream/zcode-v3.15.1-analysis.md:113`）；受影响面仅 start-plan/off-peak 端点（叠加 `specs/start-plan-captcha-verification.md` 已知 captcha 缺口）。`packages/desktop/wdio.conf.ts:2193` 的 c1f3a7e2 命中是 E2E 防御 mock，非实现。
- **修复动作**：**不做伪还原**。在 `specs/upstream-v3.15.1-migration.md` 补正式决策记录：V4 签名为 bundle-only 能力、开源源无实现、重新评估条件=取得含签名链的官方实现；算法要素以上表为对照基线。

### 已推翻的候选 gap（不作修复）

- ~~快照单一 20MB 预算缺失~~：batch11 复核**推翻**。官方 `sfc=20*1024*1024`（@14709686）实为快照映射时**单分片 data-URL 内联上限**，非总预算；本仓 `bootstrap/src/drora-protocol/session-mapper.ts:58+169` 已有同值、同语义、同函数族（`hydrateSnapshotFilePartUrl` 等）护栏。若按原建议加"总预算常量"反而引入与官方的行为分歧。

---

## 2. zcode.cjs 实现速览（调研收集结论）

- **形态**：15,127,039 B、15,647 行 esbuild CJS bundle；2,056 个 lazy 模块块（`=J(()=>`）+ 223 个三方 CJS 包装；21,154 处 `r(fn,"name")` 保留原始函数名（逆向 grep 的最大杠杆）。入口头部 `parseArgs` 定义 CLI：`tui`（默认）/`help`/`version`/`app-server`/`agent-server`/`doctor`/`login [zai|bigmodel]`/`logout`/`commands list|inspect`/`plugins …`/`skills …`。
- **存储**：纯 SQLite（`node:sqlite DatabaseSync`），`~/.zcode/cli/db/db.sqlite`，22 个 migration、24 张表（session/message/part/todo/session_entry/session_input/session_target(+next)/local_setting/input_history/model_usage/turn_usage/tool_usage/workflow_*×3/dwf_*×4 等）；`session_input` 即 CommandInbox 持久台账（delivery=startNow/guide/queue，admitted→promoted/cancelled/discarded）；权限模式持久化于 `local_setting`（scope=project, namespace=permission, key=mode）。rewind checkpoint = artifact store（`~/.zcode/cli/artifacts`）before-content JSON。
- **compact**：自动 compact（绝对阈值 `contextWindow − min(maxOut,21k) − 13k`，熔断 3 次）+ microcompact（0.9×window 或 60min 空闲；KEEP_RECENT=5、MIN_TOKEN_SAVINGS=256、清理 Read/Bash/Grep/Glob/WebFetch/WebSearch/Edit/Write/ApplyPatch 九工具结果）+ 被动 `reactiveCompactAfterContextExceeded`。
- **工具系统**：注册表 42 条目/41 名（Read/Write/Edit/Bash/Glob/Grep/WebFetch/WebSearch/**Agent**（Task 为 providerVisible:false 别名）/Skill/TodoRead/TodoWrite/Enter|ExitPlanMode/AskUserQuestion/SendMessage/RespondToCoordinator/submit_result/escalate/TaskOutput/TaskStop/ReadSessionContext/ReplyToChannel/Cron 四件套（Create/List/**Update**/Delete）/OffPeak×2/动态工作流 11 工具/js）；Agent 子 runtime 同进程（taskType subagent_child，maxTurns 默认 4，禁嵌套，输出预算 120KB）；执行管线 `executeToolCall` → schema 校验 → PreToolUse → `resolveToolPermission` → handler → resultBudget。
- **权限**：`PermissionService.checkPermission`；内部枚举 11 名（default/yolo/guarded/plan/edit/acceptEdits/auto/dontAsk/bypassPermissions/autoEdit/build），auto 与官方侧同为"保留未实现"；规则匹配三层（`:*` 前缀/含 `*` 正则/全等），Bash 复合命令 allow=every、deny/ask=some；判定序 hook→memory→deny/ask→yolo→auto→disallowed→project 规则→预批→plan→allow→edit→build。
- **命令体系**：TUI 内置斜杠命令 20 个（注册表 `TF`=BUILTIN_ZCODE_SLASH_COMMAND_HELP_ENTRIES）；文件命令 `NodeCustomCommandAdapter`（`.zcode/commands` + `.agents/commands`，worktree 链向上）；frontmatter 6 键（allowed-tools/argument-hint/description/disable-noninteractive/model/skills）；`$ARGUMENTS`/`$N` + `` !`cmd` `` shell 展开（30s/128KB，CLAUDE_*/ZCODE_* 双写 env）。
- **扩展**：插件 manifest（`.zcode-plugin/plugin.json`，16 包含 bundled-skills）；发现序 inline→官方缓存→installed_plugins.json；安装 `cache/<marketplace>/<name>/<version>`；id `<name>@<marketplace>`，MCP 键 `plugin:<plugin>:<server>`；marketplace 默认 CDN `cdn-zcode.z.ai/.../marketplace.json`。skills 发现 `{home,project链}/.zcode/skills + .agents/skills` + `skills.roots`（每根 +10），注入预算 20000 字符/单行 250。hooks 恰 7 事件（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop），默认 60s/32768B，Stop 续跑上限 3 轮，workspace-hook-trust-v1.json 信任存储。MCP stdio/http/sse、池化 30s idle、`_meta.timeoutMs` clamp 1s–30min、resources 含订阅、prompts 未接、无 LSP。
- **协议**：NDJSON 分帧，信封 `{id,method,params,trace}`，"ZCode Protocol" v1 + v4（wireVersion=3）；约 120 个 v1 方法 + 30 个 v4 方法 + 15 种 v4 命令 + 8 种通知 + 25 种 session/event；服务端反向 requestClient **18 个唯一方法**；单处理队列+取消旁路；无协议层心跳；stdio 无握手鉴权（模型请求前向客户端要 provider 头，180s 超时）；attach=`session/subscribe(afterSeq,includeSnapshot)`；lease 在宿主消息族（ownerHostId）。
- **API**：OAuth 设备码 `/api/v1/oauth/cli/init|poll/{flowId}`；凭据 `~/.zcode/v2/credentials.json`（AES-256-GCM `enc:v1:`，密钥 SHA256(ZCODE_CREDENTIAL_SECRET)）；business token 兑换（zai 走 `api.z.ai/api/auth/z/login`）+ V4 签名（见 GAP-2）；SSE 含 thinking/signature/compaction；GLM-5.3 恒发 `thinking{type:"enabled"}+output_config.effort`；重试 11 次 2s×2 封顶 60s 抖动、429 Retry-After、流空闲 600s；contextWindow 取 provider 规则（默认 200k）。
- **TUI**：渲染器不在 bundle 内，为独立包 `@zcode/tui`（"OpenTUI shell"）；语言仅 en-US/zh-CN+auto；theme auto/dark/light；权限弹窗 kind=allowOnce/allowAlways/deny/custom+fullAccess；AskUserQuestion 1-4 问×2-4 选项，autoResolution 60s 隐藏宽限+300s 倒计时；display 预计算（file_diff 8 hunk/160 行、bash 150KB、task_output 2000 字符、MCP 32KB）。
- **可观测性**：日志 `~/.zcode/cli/log/zcode-YYYY-MM-DD.jsonl` 按日轮转留 7 天，默认 Info，`DefaultLogRedactor` 脱敏；OTel 模型遥测默认关（OTLP gzip、13 个 `zcode.*` 指标、`ZCODE_MODEL_TELEMETRY_ENABLED` kill-switch）；doctor 仅打印环境信息（0 检查项）；CLI 无自更新；诊断码 `code:"..."` 约 94 个。

---

## 3. 低危装饰性差异（本仓多出，方向符合 3.15.1 基线，暂不处理）

| 差异 | 官方 | 本仓 | 处置 |
| --- | --- | --- | --- |
| 大下载上限计数 | 3 | 5 | 并入迁移差分清单归因 |
| channelReply 重试 | 4 | 5 | 同上 |
| 15e3 定时器族 | 12 处 | 13 处 | 同上 |
| GLM-5.3 reasoningLevel 取值集 | low\|medium\|high | low\|high\|max | 【版本差】revision 31 > 30；待取得 3.15.x bundle 二次确认，记入上游同步 checklist |

---

## 4. 有意分歧登记（维持现状；3 项建议补 spec）

| # | 分歧 | 依据 spec | 备注 |
| --- | --- | --- | --- |
| 1 | `/team` 命令 + TeamTask*/TeamSendMessage 6 工具 + `core/src/team/` | `specs/agents-team.md` | 官方 0 命中，纯自研；mailbox 官方实现已被完整还原、两者并存 |
| 2 | `.drora` 目录族（commands/skills/agents/workflow-runs）替代 `.zcode` | `specs/drora-rename.md` | `.zcode-plugin/`、CUA 目录、`x-zcode-*` wire header、`zcode.cua/*` 键等为豁免区，保持原名 |
| 3 | VaultSearch 工具 + obsidian 插件 | `specs/obsidian-knowledge.md` | 端口注入门式自研 |
| 4 | S03 写入保护加固（整工具 allow 不短路非 safe 命令） | `specs/upstream-v3.15.1-migration.md` + `specs/agent-write-safety.md` | 已记录的策略差异 |
| 5 | `Drora Protocol` 改名 + `drora-artifact://` URI | `specs/drora-rename.md` | wire 层豁免头已归因 |
| 6 | marketplace canonical id `drora-plugins-official` + 上游别名桥接 | `specs/drora-rename.md` 改名桥接节 | URL 不变 |
| 7 | 遥测命名空间 `drora.*`（18 指标 = 官方 13 全对应 + 5 超集） | 改名豁免 | **建议**：migration spec 补一行"遥测指标超集清单" |
| 8 | `skills_lock.json` 仓根资产 | 无 | 官方 0 命中，纯自研；**建议**：补 spec 登记 provenance 与生成/消费方 |
| 9 | V4 签名不还原（bundle-only） | **待补**：`specs/upstream-v3.15.1-migration.md` 决策记录 | 见 GAP-2 |

---

## 5. 调研误报修正记录（防止后续误导，均已由批次 11 验证）

| 前批结论（错误） | 复核事实 |
| --- | --- |
| batch2-ours："/team 在 headless --prompt 生效" | 误报。保留名分流使其到不了 facade resolver，TUI/headless 均报 Unknown（GAP-1） |
| batch3-ours："动态工作流 11 工具属 3.15 版本差" | 误报。3.14.3 bundle 已含全部 11 个（CreateWorkflow @12582562 等），两侧对齐 |
| batch3 表格：TodoWrite/Skill readOnly 误读为不一致 | 双侧一致：`readOnly:!0`（@7722833/@7718556） |
| batch4-target："auto 模式本仓可能已实现" | 双侧同为"保留未实现"同文案（"Auto mode is reserved but not implemented yet"） |
| batch8/9："task_output 截断 8KB vs 2000 不一致" | 双侧同为 2000 字符（官方 `Mot=2e3`） |
| batch9："反向调用本仓 7 vs 官方 ~20，缺 13" | 官方 18 个唯一方法本仓注册表全还原（`drora-protocol/index.ts:4153-4280`）+ 1 个自研 |
| batch9："GLM-5.3 thinking 本仓 adaptive vs 官方 enabled" | 双侧 GLM-5.3 规则均 `enabled`；adaptive 仅通用 anthropic 兜底，亦与官方一致 |
| batch9："主题存储位置分歧（config.json vs local_setting）" | 官方语言/主题亦存 `~/.zcode/cli/config.json` 的 `ui.{locale,theme}` |
| batch10："快照单一 20MB 总预算缺失" | 误报。`sfc` 为单分片 data-URL 内联上限；本仓 `session-mapper.ts:58+169` 同值同语义 |

---

## 6. 版本与环境注意事项

- 本机官方安装为 **3.14.3**，本仓对齐基线为 **3.15.1**：本仓多出能力（遥测 5 个超集指标、reasoningLevel `max`、3 处计数放大等）按版本差处理，不构成"官方有本仓无"的证据链缺口。
- `debug/zcode-debug.cjs` 为早一个月的旧同构构建（缺 TELEMETRY_REPORT_ENDPOINT/AUTO_UPDATE_ENABLED 两个 define），调研时已排除。
- 官方 `provider/` 为 revision 30（20 模板+8 账号计划+478 模型规则），本仓 `config/provider/drora-builtin.json` 为 revision 31。

## 7. 批次报告索引（22 份，均在 `.upstream-parity/reports/`）

批次 1：`batch1-target-overview.md`、`batch1-zcode-cjs-anatomy.md`；批次 2：`batch2-target-commands.md`、`batch2-ours-commands.md`；批次 3：`batch3-target-tools.md`、`batch3-ours-tools.md`；批次 4：`batch4-target-config.md`、`batch4-parity-keys.md`；批次 5：`batch5-target-session.md`、`batch5-target-agents.md`；批次 6：`batch6-target-plugins.md`、`batch6-target-skills-hooks-mcp.md`；批次 7：`batch7-target-protocol.md`、`batch7-target-api.md`；批次 8：`batch8-target-tui.md`、`batch8-target-observability.md`；批次 9：`batch9-ours-ui-storage.md`、`batch9-ours-protocol-api.md`；批次 10：`batch10-diff-commands-tools-permission.md`、`batch10-diff-runtime-ext-protocol.md`；批次 11：`batch11-verify-gaps.md`、`batch11-copy-value-sweep.md`。

## 8. 后续建议（按优先级）

1. **修复 GAP-1**（/team TUI+headless 接线）：先按 AGENTS.md 更新 `specs/agents-team.md` 验收场景，再按 §1 三步最小接缝实施，补 TUI/headless E2E。
2. **补 GAP-2 决策记录**：`specs/upstream-v3.15.1-migration.md` 增加 V4 签名条目（含 batch11 §1.2 算法要素对照基线），同页补遥测超集清单行。
3. **补 skills_lock.json 的 spec 登记**（provenance、生成与消费方）。
4. **上游同步 checklist**：取得官方 3.15.x bundle 后复跑 `check-bundle-key-parity` 并二次确认 reasoningLevel 取值集等版本差项。

---

## 9. 复核附录（2026-10-20，当前分支 442f1a17 状态）

独立复核方法：`capability-sweep.mjs`（本目录）对两 bundle 做 12 能力族同构抽取 + rename 归一化集合差分，另设 10 个关键证据点成员检测；并逐项核对 §1 两个 gap 在当前代码的状态。

**复核结论：原报告的域级结论全部维持；gap 现状如下。**

- 能力族 identical（归一化后）：斜杠命令 20、官方工具 41 名全对位、hook 事件 7、权限模式 11、协议方法、SQLite 表 24、CLI 子命令 6、诊断码 94、env 键 67、meta 键 4、权限键。
- ours-only（自研，均有 spec）：`/team`、TeamTask*×6 + VaultSearch、`evidence_receipts` 表。
- **GAP-1 仍未修复**：`cli/src/command-center/slash-commands.ts` `parseSlashCommand` 无 team 分支；`create.ts` 走 Unknown 路径；`prompt-command.ts:479-489` 保留名分流进 command-center；帮助表 `drora-slash-command-help.ts:204` 仍在宣传 `/team`。TUI 与 headless `--prompt` 均报 Unknown（App 斜杠面板由 f7c0e4c3 修复，不受影响）。
- **GAP-2 仍未收口**：V4 签名族（`X-Client-Sig`/`X-Client-Pow`/`c1f3a7e2` 端点 + 3 个 `client_signing` 遥测属性）官方独有；`specs/upstream-v3.15.1-migration.md` 仍无决策记录；同页遥测超集清单与 `skills_lock.json` spec 登记也未补。
- **新发现（原报告未定级）**：官方 bundle 含备用生产源 `https://zcode.chatglm.site`——出现在 coding-plan webview 信任名单（与 `zcode.z.ai` 并列）及远控 relay 解析分支（`endpointOrigin===chatglm.site → wss://zcode.chatglm.site/ws`，bundle @约 768988 区域，同 `ZCODE_ENDPOINT_ORIGIN`）。本仓 `packages/shared/src/droraEndpoint.ts` 的 `resolveWebRemoteControlRelayWsUrl`/`isTrustedCodingPlanWebviewOrigin` 只认 `zcode.z.ai`，全 bundle 0 命中 chatglm.site。开源 3.15.1 源码同样不含 → 归类 **bundle-only 能力差异**（与 V4 签名同族），建议与 GAP-2 同一决策记录收口：低影响（仅后端启用该备用源时才有行为差），不做伪还原。
- 官方样本版本复核：`resources/app/package.json` `@zcode/desktop` = **3.14.3**；本仓 CLI 源码基线 3.15.1 维持。
