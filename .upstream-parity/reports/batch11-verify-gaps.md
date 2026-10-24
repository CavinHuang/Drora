# Batch 11 — 批次 10 gap 独立实证复核 + 差分报告抽样验证

- 日期：2026-10-19
- 性质：只读复核（防前批幻觉）；除本报告外无任何文件改动
- 官方 bundle：`D:/software/zcode/resources/glm/zcode.cjs`（3.14.3，15,127,039 B）
- 本仓：`D:/workspace/projects/Drora`（feat/g-backlog-e2e，基线新鲜检查通过：与 drora/main 同步，ahead 896 / behind 0）
- 输入：`batch10-diff-commands-tools-permission.md`（判 gap 1 条：C2）、`batch10-diff-runtime-ext-protocol.md`（判 gap 2 条：V4 签名、快照 20MB）
- 方法：对每条 gap 双侧重新 grep/切片取证；再从两份报告各抽 4 条"对齐/一致"结论反向验证。所有偏移可用 `tail -c +OFFSET` 复现。

---

## 1. 三条 gap 逐一实证

### 1.1 Gap C2：`/team` 在 TUI 与 headless 报 Unknown command —— **维持**

**官方侧**（确认官方无 `/team`，此 gap 为自研命令接线问题，非官方能力缺失）：

```
$ grep -c '/team' zcode.cjs        → 0
$ grep -ob '"team"' zcode.cjs      → 12 处：5546739 / 5547459 / 5560825 / 5563105 /
  5825484 / 6416132 / 6416335 / 6426033 / 6426562 / 6526269 / 6853282 / 7233849
```

逐处上下文甄别（`tail -c +off-80 | head -c 200`）：12 处全部是**外部 CLI 自动补全表**里的子命令名（npm/pip 风格 `team add/delete/list/update`、`softwareupdate … team create`、pip `t team credentials generate` 等），与 ZCode 斜杠命令无关。`/team` 斜杠命令官方 0 命中。

**本仓 TUI 侧**：

- `apps/drora-cli/packages/cli/src/command-center/slash-commands.ts:40-250` `parseSlashCommand`：已知分支仅 compact/expert/effort/dwf/fork/help/init/workflow/login/logout/locale/resume/new/rewind/mode/mcp/plugins/model/goal/skill，**无 team**；`grep -in team` 该文件 0 命中。team 落入 `:245-249` 返回 `type:"unknown"`。
- `apps/drora-cli/packages/cli/src/command-center/create.ts:64-75`：`command.type === "unknown"` → `handleCustomCommand`（文件适配器，team 是保留字不可能有同名文件命令）→ 未命中即返回 `Unknown command: /${rawName}…`（:73）。TUI 面确认报 Unknown。

**本仓 headless 侧**：

- `apps/drora-cli/packages/cli/src/prompt-command.ts:297`：`routesToPromptCommandCenter(slashCommand, deps)` 为真才进 command-center。
- `:479-487`：type==="known" 仅 expert/goal 返真；unknown 走 `isResolvableCustomCommand` → `:498` 先查保留名（注释自证"与 facade 那道 gate 的顺序逐字一致"）。
- `:513-517` `isReservedSlashCommandName` → bootstrap `isReservedDroraSlashCommandName`。
- `apps/drora-cli/packages/bootstrap/src/slash-command-surface.ts:28-33`：保留名 = `BUILTIN_DRORA_SLASH_COMMAND_HELP_ENTRIES` 全部 name+aliases + compress/plan；`packages/shared/src/drora-slash-command-help.ts:202-206` 帮助表确有 team 条目（`usage: "/team [goal]"`）→ **team 是保留名** → `isResolvableCustomCommand` 返 false → 进 command-center → 同样报 `Unknown command: /team`。headless 面确认报 Unknown。

**facade 生效面**（旁证"唯一生效面是 App facade"）：

- `apps/drora-cli/packages/bootstrap/src/builtin-team-command.ts:1-40`：`BUILTIN_TEAM_COMMAND_NAME="team"`，复用 contracts 展开（$ARGUMENTS + skills: 前言），缺帮助表条目时直接 throw。
- `apps/drora-cli/packages/bootstrap/src/builtin-prompt-command.ts:72-82`：facade builtin resolver 有 team 分支，受 `resolveAgentsTeamEnabled()` 灰度门控。

**复核结论：维持【gap】**。batch10 的证据链（parseSlashCommand 无 team 分支 + 保留名分流到不了 facade builtin resolver + 两面均报 Unknown + 仅 App facade 生效）逐环成立；batch2-ours §5"headless --prompt 生效"确系误报。

### 1.2 Gap：get_sign_key V4 请求签名未还原 —— **维持**（并补全算法证据）

**官方侧**（`get_sign_key`/`c1f3a7e2` 各 1 处，@3785263/@3785292 相邻）：

- `tail -c +3784600`：常量块 `yUs="get_sign_key"`、`vUs="/api/paas/c1f3a7e2/v2/client"`、`gJr="zcode"`、`bUs=1e4`（10s）、`_Jr=16`（nonce 16B）、`SUs=8`（PoW 8 bit）；错误类 `ClientRequestSigningV4Error`（kind/failOpenEligible/httpStatus/businessCode），辅助函数 `hasLeadingZeroBits/deriveBytes/encodeUtf8/bytesToBase64/bytesToHex/base64ToBytes`。
- `tail -c +3787200`：`ClientRequestSigningV4Manager`（按 providerId scope、keyCache、createFetch/dispose）、`ClientRequestSigningV4Signer`（握手 URL 强制 HTTPS、origin 不符→unsigned、`bypassSigning`、verify_rejected 重签 1 次后进入 bypass fail-open）；签名要素：PoW `pJr({apiKeyId, appId:"zcode", powBits:SUs=8, sessionId, ts})`，签名串 `dJr(body, `${apiKeyId}${ts}${clientVersion}${sessionId}${nonce}`)`（nonce=`ylt(_Jr=16)`）。
- `tail -c +3789950`：请求头族 7 个：`X-Client-Ts`、`X-Client-Version`、`X-Client-Sig`、`X-Session-Id`（强制要求）、`X-Client-Nonce`、`X-App-Id`、`X-Client-Pow`。

**本仓侧**：

- 源码 `get_sign_key`/`c1f3a7e2` 0 命中（唯一 c1f3a7e2 命中在 `packages/desktop/wdio.conf.ts:2193` 的 E2E 网络 mock，见下）；`X-Client-Sig/X-Client-Pow/X-Client-Nonce/X-Client-Ts/ClientRequestSigning` 全仓 0 命中。
- `apps/drora-cli/packages/adapters/src/model/request-security-edition/index.ts:6`：`protectTransport: ({ transport }) => transport` 原样返回（纯占位）；同目录 `recovery.ts` 全 no-op（`RequestVerificationRetry` 恒 false、`isRequestVerificationRejection` 恒 false）。
- 装配点：`apps/drora-cli/packages/adapters/src/model/model-execution.ts:184` 以 `createModelRequestSecurityState()` 为默认。
- coding-plan 取钥替代路径确认：`packages/shared/src/project-access-token-client.ts:238`（`/api/biz/customer/getCustomerInfo`）、`:325`（`/api/biz/v1/organization/…/projects/…/api_keys`）。
- `docs/upstream/zcode-v3.15.1-analysis.md` §3.6（约 :113）：开源上游 `request-security-edition/verification-policy.ts` 同为占位，"不代表开源版新增了可用的官方签名/验证链"。

**关于 wdio.conf.ts:2190-2196 的注释"签名默认开启后，Account 用例的测试凭据也会发起握手"**：这是 E2E 代理对 `POST open.bigmodel.cn/api/paas/c1f3a7e2/v2/client` 的防御性 mock（返回 500）。源码层无任何签名实现会发出该请求（E2E 启动的是本仓构建的 `apps/drora-cli/packages/cli/dist/drora.cjs`，见 wdio.conf.ts:189），mock 属防御面，不构成"本仓已有签名"的证据。**batch10"本仓 0 命中"的口径应为"源码 0 命中（另有 1 处 E2E 防御 mock）"**。

**决策记录检查**：`specs/start-plan-captcha-verification.md` 只记录 TLS 握手层被切（L1）与 captcha 链，**无 V4 签名决策记录**；`specs/upstream-v3.15.1-migration.md` 亦无。batch10 建议的"补正式决策记录"仍未落地。

**复核结论：维持【gap】**。官方为完整 V4 签名链（PoW 握手 + 7 头 + fail-open），本仓为显式占位 + 替代取钥路径；缓解事实与 batch10 记述一致。

### 1.3 Gap（低危）：快照单一 20MB 预算缺失 —— **推翻（误报）**

**官方侧重验**：`20*1024*1024` 共 7 处（batch10 称 7 处，计数属实），但语义分布：

| 偏移 | 语义 |
| --- | --- |
| @656478 | attachmentMaxBytes（附件上限） |
| @1399363 | Nrt（文件族常量） |
| @7424559 | JSa（Bash 图片输出） |
| @11733430 | yGe（后台项目） |
| @12916042 | ASt（内联 PDF data URL） |
| **@14709686** | **`sfc=20*1024*1024`，与 `r(BLn,"buildSessionSnapshot")` 同模块** |
| @15085215 | cvc（剪贴板图片） |

**关键语义甄别**：`sfc` 在 bundle 内仅 3 处引用（14692860/14709620/14709682）。消费点 `cfc`（注册名 `hydrateSnapshotFilePartUrl`）：

```
let o=await e.readToolResultArtifact(n), i=ufc(o.content,o.contentType,t.mime);
return !i || Buffer.byteLength(i,"utf8")>sfc ? t : {...t,url:i}
```

即：快照消息映射时把 `zcode-artifact://` 图片分片回填为 data URL，**单个分片**超过 20MB 则放弃内联。`buildSessionSnapshot`（`BLn` @14691377，函数体已完整取读）本身**没有任何总字节预算**——它只组装 messages/projection/protocol/runtime/session/settings/slashCommands/goalStats/todos。batch10 把 `sfc` 表述为"单一 buildSessionSnapshot 预算"是**语义误读**。

**本仓对位实现**（batch10 漏检）：

- `apps/drora-cli/packages/bootstrap/src/drora-protocol/session-mapper.ts:58`：`const SNAPSHOT_INLINE_IMAGE_DATA_URL_MAX_BYTES = 20 * 1024 * 1024;`
- `:159-175` `hydrateSnapshotFilePartUrl`：file 分片 + isImageMime + 非可用 data URL + `drora-artifact://` URI → 读 artifact → `dataUrlFromSnapshotArtifact` → `Buffer.byteLength(dataUrl,"utf8") > SNAPSHOT_INLINE_IMAGE_DATA_URL_MAX_BYTES` 则放弃内联。
- 函数族与官方**逐字同构**：`hydrateSnapshotFilePartUrl`/`snapshotFilePartArtifactUri`/`dataUrlFromSnapshotArtifact` 正是官方注册名 `cfc`/`lfc`/`ufc`。
- 消费路径：`session-mapper.ts` 的 `buildSessionSnapshot` 被 `server-operations.ts:91,3659`（legacy includeSnapshot 路径）与 `mapper.ts:4` 共用。

**复核结论：推翻**。官方不存在"快照总预算"常量，只有单分片 data-URL 内联 20MB 上限；本仓 `session-mapper.ts:58+169` 已有同值、同语义、同函数族的对位护栏。batch10 的"legacy 路径缺总预算护栏"gap 前提（官方有总预算）与事实（本仓无等价常量）**双双不成立**，应改判【误报】。batch10 修复建议（"加 20MB 预算常量或 spec 记录"）作废——若真加总预算反而引入与官方的行为分歧。

---

## 2. 抽样验证：两份报告各 4 条"对齐/一致"结论反向验证（8/8 命中）

| # | 来源报告 | 抽样结论 | 官方侧重验 | 本仓侧重验 | 结果 |
| --- | --- | --- | --- | --- | --- |
| S1 | commands T5 | TodoWrite `readOnly:true` | @7722833：`TodoWrite…readOnly:!0,destructive:!1,concurrentSafe:!1,timeoutMs:3e4,…riskLevel:"low",needsApproval:!1` | `core/src/tool/handlers/todo.ts:140` `readOnly: true`、:142 `concurrentSafe: false` | **命中** |
| S2 | commands P4 | wire 权限选项 kind 枚举一致 | @743387（batch10 写 @7433877 为偏移笔误）：`qpr=m.object({optionId,label,kind:m.enum(["allowOnce","allowAlways","deny","custom"]),response})` + `fullAccessOption=qpr.extend({optionId:m.literal("fullAccess"),kind:m.literal("custom")})` | `packages/shared/src/drora-protocol-v4/snapshot.ts:233-238` 同枚举 + `PERMISSION_FULL_ACCESS_OPTION_ID="fullAccess"` 同扩展 | **命中**（batch10 偏移值有笔误，结论不受影响） |
| S3 | commands T9 | 动态工作流工具 3.14.3 已有 | `grep -oc`：CreateWorkflow 40、ListSavedWorkflows 9、ResolveWorkflowQuestion 6、FillWorkflowHole 16、AmendWorkflow 52、EvalWorkflowSnippet 9、ResumeWorkflowRun 22、GetWorkflowRun 30 —— 全部在 bundle | `core/src/tool/handlers/index.ts:119-146` 全套注册 | **命中** |
| S4 | commands P2 | auto 模式两侧同为"保留未实现" | @5210748/@5213370：`"Auto mode is reserved but not implemented yet"` ×2 | `core/src/permission/service.ts:163,418` 同文案同双分支 | **命中** |
| S5 | runtime §2 | microcompact 常量与 9 工具清单 | @5017669：`jpo=["Read","Bash","Grep","Glob","WebFetch","WebSearch","Edit","Write","ApplyPatch"]`；`Mpo=5,ida=60,Npo=256,Lpo=.9,Fpo=2e3`、`Ebn="[Old tool result content cleared]"` | `core/src/compact/microcompact.ts:14-29`：KEEP_RECENT=5/IDLE=60/MIN_TOKEN_SAVINGS=256/RATIO=0.9/BUFFER=2_000/九工具逐字同序 | **命中** |
| S6 | runtime §4 | Stop 续跑上限 3 | @13187397：`qja=3`（hooks 模块，紧邻 runSessionStartHooks/runUserPromptSubmitHooks） | `core/src/runtime/methods/hooks.ts:10` `MAX_STOP_HOOK_CONTINUATIONS = 3`（:127 消费） | **命中** |
| S7 | runtime §3 | Agent 输出预算 120KB | @7713548：`Oyt=12e4`（与 Task 别名 `hxo` 同模块，附带再证 T10） | `core/src/tool/handlers/agent.ts:20` `MAX_AGENT_MODEL_BYTES = 120_000`（:225,248,249 消费） | **命中** |
| S8 | runtime §4 | hooks 默认超时/输出 60s/32KB | @4191808：`kJs=6e4,xJs=32768`，紧邻 7 事件表 `qto=["SessionStart","UserPromptSubmit","PreToolUse","PermissionRequest","PostToolUse","PostToolUseFailure","Stop"]`（附带再证 7 事件对齐） | `apps/drora-cli/packages/contracts/src/hooks/index.ts:434-439` `DefaultHooksRuntimeConfig{maxOutputBytes:32768,timeoutMs:60000}` | **命中** |

抽样结论：**8 抽 8 中，0 推翻**。两份 batch10 报告中已判"对齐/一致"的关键结论可靠性高；唯一瑕疵是 S2 的官方偏移笔误（@7433877 应为 @743387），不影响判定。

---

## 3. 复核结论总表

| 条目 | batch10 判定 | batch11 复核 | 关键证据 |
| --- | --- | --- | --- |
| C2 `/team` TUI+headless Unknown | 【gap】 | **维持** | 本仓 parseSlashCommand 无 team 分支（slash-commands.ts:40-250）+ 保留名表含 team（slash-command-surface.ts:28-33 + drora-slash-command-help.ts:202-206）→ 两面必报 Unknown；facade 有展开（builtin-team-command.ts + builtin-prompt-command.ts:72-82）；官方 `/team` 0 命中 |
| V4 get_sign_key 签名 | 【gap】 | **维持** | 官方 @3785263-3789950 完整 ClientRequestSigningV4 族（PoW 8bit、签名串 apiKeyId+ts+version+sessionId+nonce、7 个 X-Client-* 头、fail-open）；本仓源码 0 实现，request-security-edition/index.ts:6 纯占位；spec 无正式决策记录（建议维持） |
| 快照 20MB 总预算 | 【gap】低危 | **推翻（误报）** | 官方 `sfc` 实为单分片 data-URL 内联上限（@14709686 定义、@14692860 消费），buildSessionSnapshot 无总预算；本仓 session-mapper.ts:58+169 有同值同语义同函数族护栏，两条快照路径共用 |

## 4. 对 batch10 报告的修订建议

1. runtime-ext-protocol §5.2"快照字节上限"行改判【误报】：语义误读（sfc 非总预算）+ 漏检本仓 `session-mapper.ts:58`；结论速览表"协议/API gap 2 条"应改为 1 条。
2. 同报告 §5.2"本仓 0 命中"补注：`packages/desktop/wdio.conf.ts:2193` 有 1 处 E2E 防御 mock（非实现）。
3. commands §1 C2 行官方证据列"qpr @7433877"更正为"@743387"。
4. V4 签名的正式决策记录（specs 层）仍未落，batch10 的修复建议继续有效；可一并补充本报告 §1.2 摘出的算法要素（PoW 8bit、7 头、fail-open、握手 URL）作为重评时的对照基线。
