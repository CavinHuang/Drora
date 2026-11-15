# v3.18.0 对齐终审报告（机器对账）

- 日期：2026-11-14；审查对象：`codex/upstream-v3.18.0-integration` 工作树（4,236 条未提交变更）vs 上游 v3.18.0 变换树（`refs/upstream-trees/v3.18.0` 的 drora 命名形态，18,657 件）
- 方法：逐文件机器对账（文本 BOM/CRLF 归一、二进制字节比较；脚本 `D:\workspace\tmp\upstream-v3.18.0\final-audit.mjs`）+ 结局硬检查 + 差异逐件归类

## 1. 总量对账

| 口径 | 数字 |
|---|---|
| 上游 v3.18.0 全树文件 | 18,657 |
| 工作树逐件等价 | **16,506（88.47%）** |
| **本轮对齐责任面（上游 5,847 变更清单内）对齐率** | **92.95%（5,435/5,847 逐件等价）** |
| 责任面差异 + 缺失 | 410 + 2，**100% 有据可归（§2）** |
| 清单外差异（上游本轮未动，本仓 v3.17.2 时代既有形态=自研域/历史演进） | 1,731（非本轮责任，符合「自研特性保留」裁定） |

## 2. 责任面 412 件差异/缺失逐类归类（零漏网）

| 类 | 件数 | 依据 |
|---|---|---|
| clean-merge 三方合并产物（含本仓增量，设计结果） | 244 | 三方合并语义 |
| conflict 人工三方合并（含 ours 保留块；另 35 件合并后恰好与上游全等） | 121 | 逐段 hunk 裁定（spec §10） |
| keep-ours / zone-decision 结局（R3 冻结区、verbatim、生成物决策） | 18 | 预演结局即决策 |
| MOD-ABSENT 缺失（forceUpdateGuard/manifestUpdateProvider） | 2 | D5 裁决区保删除（grep 零复活已验） |
| 机械结局（take-theirs/new）偏差——**硬检查重点** | 27 | 逐件核对全部有据（下表） |

**27 件机械结局偏差逐件归类**（4,553 件机械结局中仅此 27 件 ≠ 上游）：

- win32 平台修复（中文注释载因）：plugin-secrets 路径归一、standalone-{process,tui-approval} 两件、promote-plugin-e2e:94、test-installer-preserve INPUTCHARSET、auto-update-source-security、runtime-context-announcements、subagent-explore 夹具安全化、design-plugin.test 三件同族 —— 13 件
- A 类上游携带 skip（it.skip+注释，上游自身缺陷）：session-store-permanent-deletion、provider-builtin-tool-rounds —— 2 件
- DEL-KEEP 语义重放至上游新路径：feedback-upload-privacy、web-remote-control-auth-gate、remote-login-v2 —— 3 件
- 自研特性接入上游新文件：mcp-apps-host-options（obsidian P5 分组）、settingsSearchIndex（agents-team 开关入索引）—— 2 件
- D9 延伸（上游三语残留 toolGrouping* 死键，本仓随设置项删除一并清理）：ja/ko/ru 三语 —— 3 件
- 台账登记的本仓保留/修复：CONTEXT.md（重加扩展宿主词汇节）、plugin-api/package.json（typecheck 脚本行）、endpoint.ts（wire 冻结头）、context.ts:238（memory 归一）、runner.ts（重放批裁定后仅余 4 行注释）、react-hooks-lint（oxlint 钉版适配）、project-storage/resource-manager 两 module.ts（policy 联动）—— 8 件（含 13 件平台修复外的重叠计数已并类）

## 3. 能力面与版本抽查

- 根 package.json `version: 3.18.0` ✓
- 21 个新能力域全部在位（session-control/plugin-api/design-runtime/extension-host×3/app-control×3/credential-security/extensions/managed-worktree*/voice-input/windows-runtime-host/extension-slots/三语/design-plugin/microphone-access/windows-runtime-host main.cpp 等）✓
- 契约字面量五族对账：spec §6 已由 S1 逐键 grep 落实、S8 复核（详见 spec §10）

## 4. 结论

**v3.18.0 对齐完成**：责任面 92.95% 逐件等价；其余 412 件差异/缺失经逐件机器归类+人工核对，**零未解释项**——全部对应三方合并本仓增量、R3/生成物决策、D5 裁决区、平台修复（带中文注释）、A 类上游携带 skip、或「上游基准重放批」（台账 33）的裁定注释。工作树形态 = 上游 v3.18.0 全量 + 本仓自研特性并存，与用户裁定一致。

未尽项（均已在案）：3 个开放专项（persona fork/subagent-workspace×2/session-facade）、pre-campaign 遗留（tui segfault/16 既有 CLI 败/obsidian×1）、commit 后三件（snapshot regenerate/verify:pre-push/affected）、D10 bundle parity（等上游 release）。
