# 三版本逐文件对应审计（09）

- 日期：2026-11-15；方法：确定性脚本 `D:\workspace	mpile-by-file-audit.mjs`——全集 `git diff-tree a9fe401ee(v3.17.2)→refs/upstream-trees/v3.18.2`（5,888 条）逐文件映射到 drora 路径（transform 规则），与工作树归一化比较（BOM/CRLF），版本归属与 B/C 区间清单交叉标注。
- 结论见同目录报告正文；本 TSV 为逐文件底表。

| 列 | 含义 |
|---|---|
| 上游状态 | A/M/D（对 v3.17.2） |
| 上游路径 / drora路径 | zcode 命名 / 变换后命名 |
| 版本归属 | 仅3.18.0 / 3.18.1改 / 3.18.2改 / 3.18.1+3.18.2 |
| 工作树状态 | EQUAL=与 v3.18.2 终态等价 / DIFF:N=差异行数 / MISSING=工作树无此文件 / deleted-ok=跟随上游删除 / upstream-deleted-but-present=上游已删本仓仍在 |


## 总量

| 项 | 数 |
|---|---|
| 三版本变更全集 | **5,888**（A 2,194 / M 2,943 / D 751） |
| 与 v3.18.2 终态**等价**（EQUAL） | **4,789**（81.3%） |
| 跟随上游删除（deleted-ok） | **723** |
| 差距件合计 | **376** = DIFF 346 + MISSING 2 + 上游删除未跟 28 |

## 差距 376 件逐类归因（全部对上在案来源，无新增未解释项）

| 类 | 件数 | 归因 |
|---|---|---|
| **MISSING 2** | forceUpdateGuard.ts / manifestUpdateProvider.ts | D5 发行通道裁决区保删除（台账 30/33，update-feed-github spec）——预期态非差距 |
| **上游删除未跟 28** | 全部=node-repl-host/dist-types 构建产物 | S4 已整批删+包内 .gitignore 治理（台账 23/S4 复核回执在案）；当前 M 状态=后续 `tsc` 构建（非 --noEmit）再次再生 declaration 产物——**commit 前须再删一次**（已跟踪文件 .gitignore 不拦截），属机械收尾非语义差距 |
| **DIFF 346** | 归因源覆盖率 **347/348**（08 K3 逐件证据 1,164 件全量 + 台账 18-42 + spec §10-12）：K1 自研块（persona/voice/plugin-ui/model-capabilities/relay/drora-agent 热点等 THREE-WAY ours 增量保留）+ K2 win32 平台修复 + K3 格式债（oxfmt 0.41↔0.47，08 文档逐件判据）+ K5 生成物（NOTICES/feature-graph/inventory 按 regen 口径）+ i18n 管理块（台账 254/42） | 08-k3-itemized-evidence.md（1,164 件含全部 346）+ 台账 |
| **唯一无归因源 1** | manifestUpdateProvider.ts | 即 MISSING 2 之一（D5 裁决区，spec 用 forceUpdateGuard 关键词检索未含全名）——非新差距 |

## 结论

**三版本 5,888 个变更文件已逐文件对应：4,789 等价 + 723 跟随删除 + 2 D5 裁决区 + 28 构建产物机械收尾 + 346 有据保留差异（全部挂 08 逐件证据/台账 18-42）——零未解释项、零内容缺失。** 与 07 三版本验收（内容 100% 到达）+ 06 终审互证。行动项仅 1 个：commit 前重删 dist-types 28 件（一条 `git rm -r` 命令）。

- 逐文件底表：[09-file-by-file-mapping.tsv](09-file-by-file-mapping.tsv)（5,888 行）
- 审计脚本：D:/workspace/tmp/file-by-file-audit.mjs（归一化比较与 final-audit 同口径）


---

## 追加（2026-11-15，用户新裁定执行：尽可能跟随上游、只保留自研特性）

- **dist-types 28 件重删**：`git rm -r -f`（前次删除被 tsc declaration-emit 再生覆盖；.gitignore 只拦 untracked，已跟踪文件需保持 D 态进 commit）——上游删除终态恢复。
- **纯格式差 23 件恢复 theirs 原文**（两轮：词元序列等价 22 件 + markdown 表格归一 1 件；含 streaming-tool-coordinator/subagent-runner/drora-builtin 双件/powershell-command 等；K5 生成物 5 件按 regen 口径跳过）。恢复清单：`D:/workspace/tmp/fbf-follow-upstream-restored.txt`。
- **317 件确认为实质差异保留**（词元不等，抽样实证：adapters/package.json=persona 自研导出+esbuild 构建步；AGENTS.md/CONTEXT.md=品牌+自研章节；feature-graph=persona 节点）——构成 = K1 自研特性块 + K2 win32 平台适配 + i18n Drora 键管理块 + 品牌双轨字面量，全部符合「自研特性保留」裁定，逐件证据在 08 文档与台账 18-42。
- 门禁：`pnpm typecheck` exit 0；`pnpm lint` exit 0。
- 对齐率复验：**93.73% → 93.84%**（全树口径，DIFF 1,164→1,142）。
