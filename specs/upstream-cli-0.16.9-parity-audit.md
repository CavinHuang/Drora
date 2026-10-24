# 上游 zcode.cjs（CLI 0.16.9）与 Drora CLI 对齐审查报告

- 日期：2026-10-20
- 上游目标：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 字节，CLI 版本 0.16.9，`apps/zcode-cli/packages/cli/dist/zcode.cjs` 产物；同目录 `packages/` 为未压缩内置插件源、`provider/zcode-builtin.json` 为内置供应商配置 revision 30）
- 本仓目标：`apps/drora-cli`（bin `drora` → `packages/cli/dist/drora.cjs`；桌面内置副本 `packages/desktop/bundled-agents/win32-x64/glm/drora.cjs` 15,283,657 字节）
- 方法：10 批次 × 2 subagent（上游侧/本仓侧成对取证，逐主题对比），主线程实跑 `node scripts/check-bundle-key-parity.mjs`；上游侧全部为只读内存分析（rg/node -e），证据为字节偏移锚点，本仓侧证据为 文件:行。

## 总体结论

Drora CLI 是上游 zcode.cjs 的**高保真改名复刻**：入口参数面、headless 输出协议、TUI/slash 命令族、agent 循环（压缩/流恢复/重试/输出续跑/steer/checkpoint）、工具集上限常量、权限判定链（17 分支 ruleId 逐字同构）、会话持久化 schema 与冷恢复、配置 schema 默认值、OAuth/凭据/遥测、扩展机制（插件/市场/skills/hooks/命令/subagent）全部同构。parity 脚本四字面量族（metaKeys/envKeys/permissionKeys/diagCodes）**sets identical，0 个待甄别字面量**；system-reminder 31 频道、权限 ruleId 族、拒绝文案族亦逐字对齐。

真实差距集中在：**headless slash 路由（G1）、`--target` 权限模式不对称（G2）、V4 客户端签名（G47，需甄别）、wire 事件族粒度（G61/G62）** 四项，其余为 P3 文案/小工具补齐。另有一组已定性为"有意分歧（安全加固/增强）"的偏差，无需修复但须保持 spec 记录。

## 一、差距清单（按优先级）

### P1（建议优先修复）

| # | 差距 | 上游证据 | 本仓现状 | 判定 |
|---|------|---------|---------|------|
| G1 | headless（`-p`）下 slash 命令族未路由进命令中心 | headless 命令中心把 `/compact`、`/init`、`/workflow`、`/rewind`、`/fork`、`/skill` 等以 `submitPrompt("/compact ...")` 方式下发应用层真正执行（锚点 qyc≈15057140、@15043000-15043400） | `cli/src/prompt-command.ts:483-485` 仅路由 `expert`/`goal` 进 command-center；`compact/init/effort/dwf/fork/rewind/mode/model/new/resume/locale/mcp/plugins` 在 headless 以字面文本提交给模型；仅 `/init`、`/workflow`、`/team` 被 builtin resolver 展开；`/compact` 无任何运行时解析 | 缺口。用户 `-p "/compact"` 会把 "/compact" 当 prompt 发给模型 |
| G2 | `--target` 路径权限模式不兜底 yolo | `run()` 派发统一 `mode??"yolo"`（@15114143），所有 headless 路径默认 yolo | `cli/src/run.ts:534`（--prompt）兜底 `"yolo"`，但 `run.ts:551`（--target）传 `undefined`，落 `runtimeConfig.mode ?? persistedMode ?? config.permission.mode`（默认 `build`）→ headless 下所有 ask 被 deny，工具基本不可用 | 缺口（不对称，疑似遗漏；两侧 config 默认均为 build，已核实） |
| G47 | coding-plan V4 客户端签名缺失（需甄别） | `POST /api/paas/c1f3a7e2/v2/client` action=get_sign_key 握手取私钥；签名串 `apiKeyId\nts\nclientVersion\nsessionId\nnonce`；请求头 `X-Client-Ts/Version/Sig/Session-Id/Nonce/App-Id:"zcode"/Client-Pow`（PoW 8bit）；401 reason `VERIFY_SIGNATURE_INVALID\|VERIFY_APIKEY_EXPIRED`；握手失败 fail-open（锚点 @3785256/@3789459/@1050184）；遥测属性 `model_attempt.client_signing*` | 仅有网关路径重写（`official-coding-plan-gateway.ts:8-11`：open.bigmodel.cn/api.z.ai anthropic 路径 → `/api/v1/ultra[-zai]/anthropic/v1/messages`）+ apiKeyId；无签名握手、无 client_signing 遥测 | 待甄别：上游 0.16.9 新增签名而本仓走异网关路径？若服务端开始强制签名则为功能性断裂。建议先抓本仓现行请求验证服务端是否接受无签名流量 |
| G61 | wire 事件族粒度：part.*/message.removed/userInput.* 缺失 | 上游 `mapSessionEventType`（emc@14708368）25 类 wire 事件含 `part.delta/part.started/part.upserted/part.removed`、`message.removed`、`userInput.requested/userInput.resolved` | `bootstrap/src/drora-protocol/session-mapper.ts` 无上述类型（grep 零命中）；流式增量经 `model.streaming`、part 生命周期经 `message.upserted`、无 userInput 交互事件 | 缺口（wire 面不同构；本仓桌面自洽，但跨上游 SDK/客户端兼容与事件粒度丢失） |

### P2

| # | 差距 | 说明 |
|---|------|------|
| G62 | `_meta.drora.apiRetry` 字段族与上游不同构 | 上游 `{attempt,maxAttempts,nextRetryAt,reasonCode}`（reasonCode 族 `fault.network.sseDisconnected` 等）；本仓 `{kind:"api_retry",attempt,maxRetries,retryDelayMs,errorStatus,error}`（`shared/src/drora-api-retry-status.ts`）。跨端消费（手机/桌面/上游 SDK）需对齐或记录 |
| G64 | start-plan busy 码 3008/3009/3010 处置差异 | 上游专用 admission 重试（延迟 [1000,2000]ms、耗尽文案 "Start Plan is busy and automatic model stream recovery reached the maximum retry count."，锚点 @~13047400）；本仓 failure-provider-business-codes.ts 将三码归入终态限额。start-plan 专项（captcha）在 specs/start-plan-captcha-verification.md，需核对是否有等价 admission 重试 |
| G27 | `GoalRead` 工具缺失 | 上游规范表 cbr@1001658 含 `GoalRead`；本仓未注册（仅有 `target.read` 权限名与 session_target 存储） |
| G20 | provider 可见保留名未实现 | 上游 provider 可见契约名集 HLa@12960280 含 `NotebookEdit/TaskCreate/Get/Update/ScheduleWakeup/EnterWorktree/ExitWorktree/LSP/Workflow`（bundle 无运行时定义的保留位）；本仓模型不可见这些名 |

### P3（文案与小项）

| # | 差距 | 说明 |
|---|------|------|
| G63 | 凭据解密失败文案语言 | 上游中文前缀 "凭据解密失败："（bundle \u51ED\u2026）；本仓英文 "Credential decrypt failed: "（credential-cipher.ts:35-55）。还原稿逐文案校验类差异 |
| G3 | text 模式 stderr hook 信任诊断 | 上游 text 输出前向 stderr 写 hook 诊断（Zyc@≈15064700）；本仓 `workspaceHookTrust` 仅在 json 字段 |
| G4 | 异常输出格式 | 上游统一 stderr `Error: <msg> (traceId: ...)`，`--verbose` 附 cause+stack；本仓格式未见对齐 |
| G8/G9 | 模式描述文案与 i18n 覆盖 | 上游 build="Ask before changes"、yolo="Full access" 等（选择器表 stn@988403）；本仓文案族不同；本仓 TUI 状态行/审批面板/命令响应大量硬编码英文（上游 en+zh 完整 locale 表） |
| G36 | workflowRefine ask 选项 | 上游 CreateWorkflow/AmendWorkflow ask 附 "Refine"（E2e@683760）；本仓无 |
| G41 | input_history 上限 | 上游固定 100 条（@1570600）；本仓未见上限 |
| G46 | share_url 分享链路 | 上游 `/cn/share/<code>` 校验；本仓 schema 有列、CLI 无消费 |
| G5 | （已核对一致）headless goal picker 报错文案逐字相同 | prompt-command.ts:66 |

## 二、有意分歧（保持 spec 记录，不修复）

| 项 | 本仓立场 | 依据 |
|----|---------|------|
| MCP annotations 不信任 | 全部 MCP 工具=P0 逐次确认、无 always 通道、持久化消毒、plan 模式不放行（无 mode.plan.mcp ruleId）；上游信任 readOnlyHint/destructiveHint（plan 放行非破坏 MCP、allowAlways session 级） | specs/agent-write-safety.md §5（决策记录在案） |
| P0 写向量 | {Bash, js, mcp__*}；allowedTools 不放行 P0、强制 user-once；上游 allowedTools 可放行任意工具 | S03 不变量（service.ts 注释 e70019d1/d70baea5） |
| Full access 已实现 | 上游 CLI 占位（点击即 deny "requires V4 approval"）；本仓 grantPermissionFullAccess→yolo+事务 receipt | 桌面配套（interaction-broker.ts:150-175） |
| `/team` 与 agents-team | 上游零命中（bundle 3 处 "team" 均为捆绑第三方 CLI 补全数据）；本仓自研灰度命令 | 灰度门 agentsTeam.enabled |
| 自定义命令 `!`cmd`` 动态展开 | 上游显式不支持（报错）；本仓有 executionPort 时支持 | 增强 |
| TUI 主题/shiki、输入历史、fork 事务包（commitForkBundle）、事件流 turn-window 保留、dwf SQLite journal 表 | 上游无对应或更简 | 增强 |

## 三、对齐确认摘要（抽样核心项）

- **入口/参数**：29 项 parseArgs 同表（两侧同有未消费的 `--stdio` 预留）；子命令族一致；退出码 0/1 + 信号 129/130/143；启动序逐步同构；`__drora-plugin-hook` 为本仓多出的 hook 入口（上游经 hooks 子命令/插件宿主）。
- **headless 协议**：json 摘要字段、stream-json 信封与 result 终行、事件 type 族、payload 重塑点、`workflow.run.progress` 专行、无 `--include-partial-messages`、`modelStreaming:"on"` 固定、headless broker 仅放行 CreateWorkflow/AmendWorkflow——全同。
- **agent 循环**：主循环顺序、ToolScheduler（并发 10、readOnly 九工具集、destructive 串行、stopTurnAfterResult）、streamRecovery（10 次、同四事件、同锚点）、重试（maxAttempts 11/base 2s/factor 2/cap 60s/jitter/Retry-After 优先）、auto-compact（window−min(32k,21k)−13k、provider usage 优先、chars/3 估算、3 次熔断、rapid-refill 熔断）、microcompact（保留 5 组）、输出续跑（MAX=3 同名 appendOutputTokenContinuation）、checkpoint（按文件 artifact、非 git）、TurnComplete/TurnError、waitPhase——全同。ReasoningSignatureRepair 同有（reasoning-history-normalization.ts:83-90）。
- **权限**：17 分支判定链 ruleId 逐字同构；规则匹配三语法（prefix:*/\*/精确）；safety.bash.* 危险命令族同；hooks 权限面同；事件 payload 同族；两侧均无 OS 级沙箱实现；`zcode|drora:permission-capability:official_cua` 同构。
- **会话**：同一 migration 血缘、同表结构、同 entry/task_type 全集、同 revert 游标与 branchGeneration、同标题三态 CAS、projectID=`proj_+slug(dir)[:80]`、AGENTS.md 加载（100KB、git root 向上、.agents/ 候选、不加载 CLAUDE.md）、/init 规则、artifact 布局、均无 GC——全同。
- **配置/供应商**：schema 键值默认值逐项同（permission.mode 默认 build、network 180000、hooks 默认关 32KB/60s 等）；六层合并含 session 层；OAuth 服务端轮询（同端点 zcode.z.ai/api/v1）、凭据 AES-256-GCM、PAT 兑换、selectionFallback→TurnExecutionModelFallback、遥测指标族（139↔145，差值主要为 client_signing* 与上游独有属性）、请求头族（保留 X-Zcode-* 字面）——同。
- **扩展机制**：插件 manifest 四路径、市场六来源、seed 重写+宿主门禁（fail-close CUA）、hooks 7 事件/exit 2 阻断/stdin JSON/7 态信任评审、自定义命令 frontmatter 六键同名正则、subagent frontmatter 字段集、restore-legacy-sessions 插件、dwf-child+journal——全同。
- **字面量族**：parity 四族 sets identical；Symbol.for 键（17↔18，本仓多自研 drora.mcp.oauth.* 两个）；内部事件枚举 85↔87（本仓多 team_state_changed/highspeed_metrics_updated/resume）；wire 25↔本仓子集（见 G61）；业务码表同族（本仓扩展更多终态码，见 G64）。

## 四、修复对齐建议

| 项 | 修复方案 | 接入点 | 成本 |
|----|---------|--------|------|
| G2 | `run.ts:551` --target 路径补 `mode ?? "yolo"`，与上游 run() 派发对齐；补 E2E（--target 无 --mode 时工具可自动放行） | cli 层最小接缝 | S |
| G1 | 将 command-center 路由下沉：headless 提交前对 known 命令折算为 runtime 调用（compact→独立 compact turn、fork/rewind→rewind 方法、new→createSession、resume→resolveResumeSession、model/mode/effort/locale→selection 写入、mcp/plugins→只读子命令输出），对齐上游"命令中心内部 submitPrompt"语义 | bootstrap/core 提交口 + cli/prompt-command | M-L |
| G47 | 先验证服务端是否强制签名（抓包/401 观察）；若强制：adapters/model 层实现 get_sign_key 握手+PoW+X-Client-* 头+client_signing 遥测，签名失败 fail-open；若不强制：在 specs/upstream-v3.15.1-migration.md 记录有意分歧与升级条件 | adapters/src/model（新文件，不落还原文件） | 先 S 甄别，后 M-L |
| G61 | session-mapper 补 part.started/upserted/delta/removed、message.removed、userInput.requested/resolved 映射（内部事件枚举已有对应成员：model_streaming/assistant_message/user_input_* 等）；桌面消费方按需订阅 | shared 协议 + bootstrap mapper | M |
| G62 | shared 常量区统一 apiRetry 字段族为上游形态（attempt/maxAttempts/nextRetryAt/reasonCode + fault.* reasonCode 枚举），drora-api-retry-status.ts 与消费方同步 | packages/shared | S-M |
| G64 | 3008/3009/3010 增加与上游一致的 admission 重试（[1000,2000]ms）与耗尽文案（先核对 services/highspeed 现状避免双写） | adapters/src/model + services | S-M |
| G27 | 补 GoalRead 工具（读 session_target），permission 沿用 target.read | core handlers + contracts | S-M |
| G63 | 凭据解密失败文案改中文前缀（或按上游逐字 "凭据解密失败："），同步错误码常量旁注 | adapters/src/auth | S |
| G3/G4 | headless text 模式 stderr hook 诊断；错误输出 `Error: <msg> (traceId: ...)` 格式 | cli/prompt-command | S |
| G36/G41/G20/G46/G8/G9 | 小项：Refine 选项、input_history 100 条、provider 可见保留名、分享链路、文案族与 i18n 补全 | 各对应模块 | S×n |
| 桌面 IPC（范围外记录） | 上游 `zcode:*` 桌面 IPC 161 频道未在本次 CLI 范围内对照；后续如做桌面侧 parity，用同一方法跑 `packages/desktop` | — | 后续 |

## 五、方法学与证据可复现性

- 上游侧全部结论带字节偏移锚点（如 checkPermission=iN@5209600、auto-compact=Mht@~5014440、凭据@4396125、签名@3785256），可用 `rg -o -b '<片段>' zcode.cjs` 复现；四字面量族由 `node scripts/check-bundle-key-parity.mjs "D:/software/zcode/resources/glm/zcode.cjs" packages/desktop/bundled-agents/win32-x64/glm/drora.cjs` 实跑（2026-10-20 结果：sets identical ×4，0 待甄别）。
- 本仓侧全部结论带 文件:行（当前检出 fix/d-g20-1-and-cleanups，基线与 main 同步）。
- 过程中被证据推翻的初始假设（避免后续重复怀疑）：plan 文件落盘（两侧同有）、MCP reminder 频道缺失（31↔31 全对齐）、输出续跑缺失（同有）、模型降级缺失（同有）、配置六层缺 session 层（同有）、MCP "mcp" 权限名缺失（同有）、用户拒绝文案差异（逐字相同）、headless goal picker 文案差异（相同）。
