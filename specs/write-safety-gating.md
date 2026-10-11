# 写安全分级门禁（S03）——三洞修复与 P0 分级门控

**状态**：已实施并复验（2026-10-11，复验证据见 `docs/vaultview/delivery/S03_GATE_REVERIFICATION.md`，S03 裁定已翻 GO）。
**状态所有者**：`apps/drora-cli/packages/core/src/permission/service.ts`（判定唯一所有者）；Bash 内容规则求值唯一所有者为 `tool/handlers/bash-command-rule-evaluator.ts`（生产唯一入口 `resolveBashPermissionRulePolicy`，`bash.ts` 恒走 rulePolicy）；持久化建议唯一所有者为 `tool/executor/permission-suggestions.ts`。
**来源**：`docs/vaultview/delivery/W00_TOOL_WRITE_MATRIX.md` §6（S03 有条件 GO 的落地条件）与 `WRITE_SAFETY_NO_GO.md`（W06 裁定时三洞与 P0 门控未实施）。
**本 spec 是行为契约**：修复后的判定语义、有意分歧集合与 S03 复验标准以本文为准。

## 1. 背景

W00 审计实证权限判定存在三个洞，使「全写盘通道强制分级门控」（S03）只能裁有条件 GO；W06 据此裁定 NO-GO 并将 L2 审核写回 fail-closed（`writePathEnabled` 缺省 false）。本工作单（W08）修三洞并落地 P0 分级门控，随后按 §5 复验标准重走 S03 门禁。

## 2. 三洞修复契约

### 2.1 洞 1a：plan 模式 MCP 直通（原 `service.ts` `mode.plan.mcp` 分支）

- 修复前：plan 模式对未声明 `destructiveHint` 的 MCP 工具直接 allow——而 `destructive/readOnly` 全凭 server 自报 hint（`mcp/index.ts`），未声明即放行等于打洞。
- 修复后：**删除该分支**。plan 模式下 MCP 工具只有声明 `readOnly`（且非 destructive）才自动放行（走既有 `mode.plan.readOnly` 分支）；未声明 readOnly 的 MCP 一律 `mode.plan.nonReadOnly` deny。这是有意收紧：误伤面 = 未标注 readOnlyHint 的只读型 MCP 在 plan 模式需用户退出 plan 或逐次批准，属可恢复操作。

### 2.2 洞 1b：memory md 免确认区覆盖 plan deny（原 `memory-file-permission.ts`）

- 修复前：deny 仅在 `ruleId !== "mode.plan.nonReadOnly"` 时保留 → plan deny 被改写为 `allow memory.file.markdown`。
- 修复后：**deny 一律保留**（deny 是 deny）。memory 免确认区只允许把「缺省 ask」提升为 allow；显式 ask 规则（`rule.project.ask` / `hook.PreToolUse.ask`）与 `alwaysAsk` 的既有保留语义不变。

### 2.3 洞 2：内容规则粒度（`permission-suggestions.ts` + `service.ts` ruleSubjects）

- 修复前：`buildDefaultPermissionUpdates` 在输入中找不到可限定内容键（`command/url/file_path/path/pattern/patch_text`）时发出**无 ruleContent 的整工具 allow** 规则——用户点一次「总是允许」即持久化全权；且 `ruleSubjects` 键集无 `code`，node_repl 的内容规则永不命中。
- 修复后：
  1. 建议器找不到内容键时**返回空数组**（不持久化任何规则）；本次调用的批准仍然有效（走逐次批准路径），只是不再产生「一次点击=永久全权」。OfficialCua 能力组例外保留（宿主验证后的可信能力，见 `matchesRuleScope` 的 provenance 语义）。
  2. `PROJECT_RULE_INPUT_KEYS` 与 `PermissionService.ruleSubjects` 键集**补 `code`**：携带代码内容的工具（node_repl `js`）的内容规则可命中；语义为整段代码精确匹配（与 Bash exact command 同口径）。

### 2.4 洞 3：Bash 整工具 allow 短路（`bash-command-rule-evaluator.ts`）

- 修复前：`rules.some((rule) => !rule.ruleContent) → true`——整工具 allow 规则短路包括重定向在内的一切命令。
- 修复后：
  1. 整工具 allow 规则只豁免**安全命令**（`safe=true`：可解析、无重定向、无动态词）；不安全命令不再短路，回落内容规则匹配，仍无匹配则维持缺省 ask。
  2. allow 行为的逐主体匹配（`matchesInvocationRule`）**忽略空内容规则**（deny/ask 行为保留空内容=全量匹配，方向 fail-closed 不变）。
  3. Bash 的持久化建议本就内容限定（exact/前缀，`bash-command-permission-policy.ts`），不受影响。

## 3. P0 分级门控（判定侧统一语义）

W00 §6.2 分级：P0 任意路径写（Bash/js/未声明 destructive 的 MCP）→ 强制逐次确认 + 禁整工具持久 allow；P1 授权根内写（Write/Edit）→ 维持现骨架；P2 免确认区（memory md / workflow 草稿）→ 保留但强制审计事件。

落地形态（判定唯一所有者 `PermissionService`）：

1. **禁整工具持久 allow（判定侧）**：`matchesRule` 对空内容 allow 规则只在「能力声明 readOnly」或「可信能力组（OfficialCua）」时匹配；非 readOnly 普通工具的整工具 allow 规则一律不匹配（降级回缺省 ask）。deny/ask 方向的空内容规则不变（全量匹配）。Bash 走 rulePolicy，等价语义由 §2.4 承载。
2. **强制逐次确认**：P0 类工具（Bash/js/MCP）的缺省判定本就是 ask（`needsApproval` / riskLevel）；修复后不存在可绕过 ask 的整工具持久通道；plan 模式由 §2.1 收口。yolo 直通见 §4 有意分歧。
3. **审计事件**：统一收口挂点 `resolveToolCallCapabilityFlags`（`permission-capability.ts`）随 `ToolCallStarted` 广播每次调用的 `readOnly/sideEffectScope`（既有机制，dynamic-workflow driver 为消费方）；权限判定已有 `tool.permission.evaluated` debug 事件与 renderer 权限卡广播；exec 自动写盘已有 `<storage>/cli/exec` 落盘日志。P2 免确认区的审计由上述既有机制承载，不新建第二套管道。

## 4. 有意分歧（按 AGENTS.md 记录，区分「缺口」与「有意分歧」）

以下三项**不做逐路径门控**，以审计+凭证口径补偿（W00 §6.3 收窄口径）：

| 分歧 | 理由 | 补偿控制 |
| --- | --- | --- |
| MCP server 进程内落盘 | 宿主只见工具调用不见 server 内部落盘，结构上不可逐路径判定 | 工具调用级权限判定全覆盖（模型可见面）；调用审计走 `ToolCallStarted` 能力广播 |
| 宿主自动写盘（exec 日志、workflow 草稿等 8 类） | 非模型发起，无交互面 | 落盘日志（`<storage>/cli/exec` 等）+ plan 模式仍拦（`checkPlanMode` 先于免确认分支） |
| yolo 直通 | 显式模式选择，等价用户对全部工具的持久授权 | `alwaysAsk`/`requiresUserInteraction` 工具仍逐次问（`service.ts` 判定顺序）；full-access 需显式 receipt（`runtime/permission-full-access.ts`） |

## 5. S03 复验标准（验收场景）

修复合入后，以下场景全部为**可执行测试**，全部通过方可把 S03 裁定从 NO-GO 翻为 GO（复验文档见 `docs/vaultview/delivery/S03_GATE_REVERIFICATION.md`）：

| ID | 场景 | 期望 |
| --- | --- | --- |
| WSG-1 | plan 模式调用未声明 readOnlyHint 的 MCP 工具 | `mode.plan.nonReadOnly` deny，不再出现 `mode.plan.mcp` allow |
| WSG-2 | plan 模式调用声明 readOnlyHint=true 的 MCP 工具 | 仍 `mode.plan.readOnly` allow（不误伤） |
| WSG-3 | plan deny 后写 memory md | 决策保持 deny，不被 `memory.file.markdown` 覆盖 |
| WSG-4 | 非 plan 缺省 ask 下写 memory md | 仍自动 allow（免确认区不回归） |
| WSG-5 | 无内容键输入（MCP arguments/js code 之外形态）点「总是允许」 | 建议为空数组，不持久化整工具 allow |
| WSG-6 | js（code 键）点「总是允许」 | 建议整段代码 exact 规则（内容限定） |
| WSG-7 | 整工具 Bash allow 规则 + 带重定向不安全命令 | 不 allow（回落 ask）；同规则 + 安全命令仍 allow |
| WSG-8 | 整工具 Bash deny 规则 | 仍全量 deny（fail-closed 方向不回归） |
| WSG-9 | 非 readOnly 普通工具 + 项目整工具 allow 规则 | 不匹配（缺省 ask）；OfficialCua 组不受影响 |
| WSG-10 | 既有合法路径不回归：根内 .md Write/Edit 既有判定、WebFetch 预批、workflow 草稿免确认、memory 缺省 ask 放行 | 全部维持原判定 |

## 6. 与 L2 开关的关系

S03 门禁翻 GO 后，W06 建成的 L2 审核写回机制**允许**被配置开启（`writePathEnabled`），但**缺省仍为关闭**，由用户显式开启；UI 消费与开启入口属后续工作单（composer evidenceRefs / 审核视图接线）。本工作单不改变 `writePathEnabled` 缺省值。
