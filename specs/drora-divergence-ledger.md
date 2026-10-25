# Drora 有意分歧台账

状态：**持续维护**（2026-10-21 依 v3.16.1 合并完整性审计 `docs/upstream-sync/2026-10-21-v3.16.1-merge-audit.md` 补建首批条目）。

本台账集中登记 Drora 与官方上游之间**常设性（跨版本）的有意分歧**，是 AGENTS.md「与官方行为有意分歧的能力必须在 specs/ 留下决策记录与对照说明」的落地载体。合并期一次性裁决（ours删/theirs改 之类）仍留在各轮迁移 spec（如 `specs/upstream-v3.16.1-migration.md` §合并引擎·决策表）；本台账记的是**下次上游同步还会再遇到、动手前必须先查这里**的分歧，用于区分「缺口」与「有意分歧」。

每条四要素：**上游行为 / 本仓行为 / 依据（文件:行）/ 下次同步注意**。编号一经分配不复用；条目回退对齐上游时保留编号并标注，不删除。

编号对照：审计报告的 F 编号与修复工单的 F 编号是两套体系（如工单 F2=审计 F7、工单 F12=审计 F1），代码注释引用的「分派单 Fx」均指工单侧编号。本台账各条同时标注两套：

| 工单侧 | 审计侧 | 条目                           |
| ------ | ------ | ------------------------------ |
| F12    | F1     | 台账 1 CLI 版本策略            |
| F13    | F5     | 台账 2 任务模式投影            |
| F14    | F6     | 台账 3 pnpm-lock 插件 importer |
| F15    | F14    | 台账 4 oxlint 覆盖面           |
| F2     | F7     | 台账 5 vault 侧栏入口回植      |
| F1     | F3     | 台账 6 appId 豁免转换形态      |
| —      | F16    | 台账 7 oxfmt markdown 篡改缺陷 |
| —      | —      | 台账 8 affected 首推基线回退   |

## 台账 1：CLI 版本策略——drora-cli 恒保 0.0.1 独立发版（工单 F12 / 审计 F1）

- **上游行为**：`apps/zcode-cli/package.json` 随上游版本线演进（v3.16.1 区间内 0.16.9→0.17.0），版本号是上游发行面的一部分。
- **本仓行为**：`apps/drora-cli/package.json:3` 恒保 `"version": "0.0.1"`（`private: true`），不跟随上游 0.x 版本线——drora-cli 独立发版，版本号语义归本仓发行链，不随上游源码同步推进。上游 package.json 的功能性改动（scripts、devDependencies 等）照常吸收（v3.16.1 的 lint/pretest 改动均已落地）。
- **依据**：`docs/upstream/zcode-v3.16.1-segment-plan.md:46`（S2 执行补记「package.json 版本保 0.0.1」，31 冲突逐案解决的既定取舍）；`specs/force-update-gate-removal.md:7-9`（Drora 版本线自 0.0.1 起与上游 minimalVersion 独立，同源逻辑）。
- **下次同步注意**：合并 `apps/drora-cli/package.json` 时 version 字段一律保 ours（0.0.1）；上游 version bump 本身不构成需要跟随的改动，冲突按本条仲裁，不按「对齐上游」处理。

## 台账 2：任务模式投影——toDroraMode 把 auto 折叠为 build（工单 F13 / 审计 F5）

- **上游行为**：上游现行树的任务模式投影函数（v3.15.1 `aac4755` 与 v3.16.1 `0a1fc56d` 两端逐字一致）对 `auto` 投影为会话模式 `auto`（auto→auto 透传）。
- **本仓行为**：`packages/services/src/drora-agent/droraTaskServiceAdapter.ts:3307` `toDroraMode` 把 `auto` 与 default/acceptEdits/build/autoEdit 同落 `return "build"`（:3327），注释（:3326）「会话级 auto（全 deny 保留模式）不进任务 wire 面，按原版投影为 build」。
- **依据**：原版桌面投影语义——`docs/glm-parity-pass28-2026-10-09/parts/p28-b7-k1.md:110`（解析后归一 `uYa` @14453420：default/auto/acceptEdits/autoEdit→build）；`packages/shared/src/drora-task-types-core.ts:170-171`（`normalizeDroraTaskMode` 注释同引 uYa 投影语义）。该折叠早于 v3.16.1 合并（ac72baf59^ 已如此），本条为既有分歧补登记，非 v3.16.1 delta。
- **下次同步注意**：上游投影函数若仍是 auto→auto，不采纳、视为已知分歧（diff 中 `case "auto"` 的语义差异不按合并缺口处理）；只有当上游归一函数本身改为向 build 折叠（与 uYa 语义对齐）时才重新评估跟随。

## 台账 3：pnpm-lock——四插件 importer 不采纳上游非空条目（工单 F14 / 审计 F6）

- **上游行为**：v3.16.1 区间上游把 `apps/zcode-cli/packages/{documents,pdf,presentations,spreadsheets}-plugin` 四个 importer 从空对象 `{}` 填为非空（各含一个 `@zcode/office-runtime` workspace link devDependency，无外部包解析）。
- **本仓行为**：这四个插件不进 workspace 安装面，根 lock 无对应 importer，按 workspace seed 分发策略整体排除；其实质依赖已由本仓 `apps/drora-cli/packages/office-runtime` importer 承载（`pnpm-lock.yaml:666` 起，与上游端 21 个 devDependencies 逐一对应）。
- **依据**：`pnpm-workspace.yaml:8-19`（注释「内容型/冻结插件仍作为 seed 分发」+ 10 条 `!apps/drora-cli/packages/*-plugin` 负向排除）；引入提交 `69c1c3121`（2026-09-22「chore: workspace config for restored CUA packages + restoration manifest」，先于 v3.16.1 合并）；`docs/cua-restoration-manifest.md`（辅助记录）。
- **下次同步注意**：lock 重生成（`specs/upstream-v3.16.1-migration.md` §工具链约束：不手工合并、pinned pnpm `pnpm install` 生成）后，这四条 importer 缺失是**预期终态**，不是重装事故；不得为对齐上游把排除清单里的插件重新纳入 install。上游对这四个 seed 插件内部依赖的变更走 seed/producer 更新流程甄别，不进根 lock。

## 台账 4：oxlint 覆盖面——zcode-cua 还原区保留精细豁免（工单 F15 / 审计 F14）

- **上游行为**：上游把整目录 `packages/zcode-cua` 加入 `.oxlintrc.json` 的 ignorePatterns（上游终态 `0a1fc56d:.oxlintrc.json:95`），该目录 lint 全静默。
- **本仓行为**：不采纳整目录 ignore。保留子目录级 ignore（broker/frame-contract/mcp/upstream 等），并对 `packages/zcode-cua/src/**` 与 `packages/zcode-cua-helper/src/**` 仅关 `max-lines`（`.oxlintrc.json:47-54`），其余规则照常生效（审计实跑 oxlint：该 src 受 94 条规则约束、252 warning/0 error）。
- **依据**：`.oxlintrc.json:47-54`（override 内注释即动机：「发行 bundle 的还原稿……行数超限是还原粒度所致；语义化拆分前先豁免行数上限，其余规则照常生效」）；`docs/upstream/zcode-v3.16.1-segment-plan.md:28`（S6→S1 提前落地记录「还原区精细豁免保留、上游整目录 packages/zcode-cua 豁免不采纳」）。
- **下次同步注意**：合并 `.oxlintrc.json` 时，上游若带整目录 `packages/zcode-cua` ignore 条目，维持不采纳；本仓「子目录 ignore + src 关 max-lines」为 ours 基线。上游对还原区新增子目录的豁免诉求，按同等精细粒度裁量，不整目录放大豁免面。

## 台账 5：vault 侧栏入口回植——上游 project-sidebar 重写的 B 类共享触点分歧（工单 F2 / 审计 F7）

- **上游行为**：上游 `0a1fc56d` 重写 project-sidebar（约 90 文件），新 `ProjectSidebarProps` 无 vault 槽位（上游 `packages/ui/src/project-sidebar/contract.ts` 整文件 "vault" 零出现）——vault 侧栏入口在 upstream 是不存在的概念。
- **本仓行为**：在该 B 类共享触点做**加法扩展**回植入口，未接线时 DOM 与上游零差异：
  1. 扩展点：`ProjectSidebarProps`（`packages/ui/src/project-sidebar/contract.ts:81`）在 `pluginStoreActive` 之后、`onFileTreeOpenChange` 之前新增可选字段 `onOpenVault?: () => void`、`vaultActive?: boolean`（`contract.ts:146-150`，注释自标「Drora 扩展槽位……按可选扩展点回植——仅 Shell 接线 onOpenVault 时渲染按钮，路由仍由 Shell 唯一持有」）。
  2. 渲染：`packages/ui/src/project-sidebar/ProjectSidebarNavigation.tsx` 以 Pick 挑选两字段（:21-22）并条件渲染（:65-77）：BookMarked 图标按钮（:74）、testid `vault-sidebar-open`（:71）、`bg-selected` 选中态（:69）、i18n 键 `workspace.openVault`（:75）。
  3. 接线：`packages/ui/src/app-shell/WorkspaceShellLayout.tsx` 本地 `handleOpenVault`（:1727-1730）→ `onWorkspaceMainViewChange("vault")`，`vaultActive = isDroraWorkspaceMainView(workspaceMainView)`（:2064-2065；与合并前 4b8298e0^1（=7f187c1e）的 L2275-2276 语义逐字一致）。
- **依据**：i18n 键 `workspace.openVault` 合并前已存在、两 locale 均保留未新增（`packages/ui/src/i18n/locales/zh-CN.ts:7812`、`en-US.ts:8238`，键名可 grep 检索，行号随并发插行漂移）；三处代码注释均引用审计 `docs/upstream-sync/2026-10-21-v3.16.1-merge-audit.md` F7（该 vault 入口问题在审计报告中编号 F7，工单侧编号 F2）；B 类共享触点框架见 `specs/upstream-v3.16.1-migration.md` §自研保护区。
- **下次同步注意**：上游再动 project-sidebar 时，三处加法（contract.ts 槽位两字段、Navigation 条件渲染按钮、WorkspaceShellLayout 接线）必须保留或等价回植；保真标准是「未接线时与上游 DOM 零差异」，不得把 vault 改挂上游没有的常驻结构。

## 台账 6：appId 豁免在改名转换器中的覆盖形态（随工单 F1 修复登记 / 审计 F3「appId 契约漂移」）

主修正已落 `specs/upstream-v3.16.1-migration.md` §合并引擎（转换脚本豁免清单声明，原 ：36 行）；本条登记形态边界、残留缺口与取舍。

- **上游行为**：bigmodel `appId: "zcode"` 是服务端注册值（`specs/drora-rename.md` 规则 0 豁免），在上游树同时以对象形态（`appId: "zcode"`）与 URL 查询形态（`appId=zcode`）出现，改名转换必须对两种形态整体占位保护。
- **本仓行为**：转换脚本 `APPID_RE` 现为 `/(?<![A-Za-z])appId\s*([:=])\s*(["']?)zcode\2/g`（`scripts/upstream/transform-upstream-tree.mjs:91`，负向后行断言排除 `myappId` 等普通词误护），两种形态整体保护；旧实现（`/appId:\s*(["'])zcode\1/`）只机械保护对象形态，URL 查询形态落入规则 8 被 sweep 成 drora，酿成审计「appId 契约漂移」5 处漂移（wdio mock、adapters 常量、单测、文档）。2026-10-21 修复（node 直调 transformContent 六样例验证通过，含 `myappId=zcode` 精确化对照），受影响链路已回改 zcode（`apps/drora-cli/packages/adapters/src/auth/bigmodel-oauth.ts:9`；web 链路 `packages/web/src/auth/webZaiOAuthConfig.ts:63`——`VITE_BIGMODEL_OAUTH_APP_ID` 无任何 env 配置覆盖，默认值即生效值，经 `zaiWebOAuthProvider.ts:178` 拼进授权 URL 查询参数，配套契约断言 `packages/web/test/webZaiOAuthConfig.test.ts`）。
- **依据**：`scripts/upstream/transform-upstream-tree.mjs:82-91`（注释引 specs/drora-rename.md 规则 0 与审计）；`apps/drora-cli/packages/adapters/src/auth/bigmodel-oauth.ts:7-9`；上游原文 `0a1fc56d279f:packages/web/src/auth/webZaiOAuthConfig.ts`（默认 `|| "zcode"`）。
- **下次同步注意（残留缺口，未修，超出两形态修复范围）**：常量赋值形态 `const BIGMODEL_APP_ID = "zcode"`（变量名非 appId 开头）仍会被规则 8 sweep 成 drora。下次上游同步该行时 base/theirs 均被转换成 drora、ours 为 zcode，会以**合并冲突浮出而非静默**——golden-check 对照与冲突解决时需人工甄别按 ours 保 `zcode`。如需彻底防护，可在转换器 PLACEHOLDERS 登记该上游常量行字面量；当前取舍是不加（避免为单行常量扩大占位面），依赖「冲突浮现 + 本条提示」兜底。

## 台账 7：oxfmt markdown 强调规范化篡改还原文档（随审计 F16 修复发现，工具缺陷非有意分歧）

- **上游行为**：无对应行为——这是本仓格式化工具链的缺陷记录，防下轮同步误判为内容改动。
- **缺陷形态**：oxfmt（package.json spec `^0.41.0`，根 workspace lock 解析 0.41.0——`pnpm exec oxfmt --version` 实测 0.41.0，缺陷即在此版本复现；`apps/drora-cli` importer 另有 `^0.47.0`→0.47.0，格式化范围不含根 fmt/docs/cua）对含 `_`/`*` 字面量的 markdown 做强调定界符规范化时**确定性改写代码 span 内的标识符**：副本实测把 `app_ref` 改写为 `app*ref`、`` `test_score_notes_noncommittal_*` `` 改写为 `` `test_score_notes_noncommittal*\*` ``、并把列表续行的 2 空格缩进剥到列 0（改写后的篡改形态恰能通过 `oxfmt --check`，即 S7 全仓 fmt sweep 以此形态落进 `docs/cua/producer/cua-act-verify-scenarios.md:422-429`）。fix 对部分文件非幂等（需两遍收敛），两遍间还会在等价定界符间振荡。
- **本仓处置**：2026-10-21 将该文件 ：422-429 恢复为上游 `0a1fc56d279f` 原文（`app_ref`、`test_score_notes_noncommittal_*`、2 空格续行缩进），并把 `docs/cua/producer/cua-act-verify-scenarios.md` 加入 `.oxfmtrc.json` ignorePatterns——不豁免则任何全仓 `pnpm fmt` 都会再次篡改，豁免是当前唯一兜底。
- **同日扩大处置（fmt 门禁收敛波及面）**：2026-10-21 借 fmt:check 收敛既有欠账时，缺陷在另外 11 个含 `_`/`*` 字面量的 markdown 上复现（工作树 vs HEAD 缺陷签名计数实测新增）：`specs/agents-team.md`（`async_launched`→`async*launched`、`pending_`/`member_spawn_failed` 同族改写、剥列表续行缩进——specs 语义损坏，最重）、`docs/upstream/zcode-v3.16.1-segment-plan.md`（`__DRORA_MIN_COMPATIBLE_VERSION__`→`**DRORA_MIN_COMPATIBLE_VERSION**`）、`docs/agent-team-implementation-2026-10-16/00-master-design.md`、`docs/glm-parity-pass27-2026-10-08/`（99-final-report、b04、b16、b18）与 `docs/glm-parity-pass28-2026-10-09/`（00-briefing、p28-b5-k1（`user_config.*`→`user*config.*`）、p28-b5-k2、p28-b9-k2）（档案转义搅动，其中 pass27/28 部分 `-` 侧旧伤即 S7 sweep 所留）。11 文件全部 `git checkout` 恢复 HEAD 原文并逐一加入 `.oxfmtrc.json` ignorePatterns；审计/修复报告目录 `docs/upstream-sync/**` 因正文含缺陷敏感字面量一并豁免。恢复后 `pnpm fmt:check` 全仓绿。
- **下次同步注意**：升级 oxfmt 后先在副本复测该文件是否仍被改写，缺陷修复则移除豁免让 gate 重新接管；新增还原文档/审计文档若含 `_`/`*` 字面量标识符，先副本实测 oxfmt 再决定是否豁免，不得直接对其实跑 `pnpm fmt`。

## 台账 8：affected 首推基线 staging→origin/main 回退（提交 337b00b5）

- **上游行为**：官方 ZCode 仓库存在 staging 集成分支，affected 单测的首次推送基线取 `origin/staging` 与 HEAD 的 merge-base；基线缺失即严格报错。
- **本仓行为**：本仓无 staging 集成分支（PR 直合 main），`firstPushBase` 在 `origin/staging` 为祖先时用之、否则回退 `origin/main`（`scripts/affected-unit-tests/scope.mjs:31-40`），不猜测其他分支、保持「无基线严格报错」语义。
- **依据**：提交 `337b00b5`（「fix(upstream): affected 首推基线回退 origin/main——本仓无 staging 集成分支」）；`scripts/affected-unit-tests/scope.mjs:33-35` 注释；`docs/testing/pre-push-hook.md`（受影响单测范围与输出合同）。
- **下次同步注意**：基线分支与本仓分支模型绑定，属环境适配而非行为分歧；若本仓日后引入 staging 类集成分支，需同步修订 `firstPushBase` 回退顺序与 `docs/testing/pre-push-hook.md`，不跟随上游新增的分支假设。

## 待甄别（非既定分歧，下轮同步前需核实）

- **clientType 与 api-key 名漂移嫌疑**（随工单 F1 观察到，未改）：同一上游文档 `apps/zcode-cli/docs/design/v2/auth-login.md` 中 `clientType: "zcode"`（本仓 `apps/drora-cli/docs/design/v2/auth-login.md:176` 为 drora）与 `zcode-api-key`（本仓 :174/:190 为 drora-api-key；同文档 ：186 `appId=zcode` 已守豁免）。appId 是服务端注册值有 spec 实锤（规则 0）；clientType 与 api-key 名是否服务端注册值**未验证**（api-key 名偏客户端自建名，风险较低）。下轮同步 bigmodel OAuth 面时先甄别这两个字面量的服务端契约地位，再决定纳入规则 0 豁免或维持改名，不得静默跟随任一侧。
