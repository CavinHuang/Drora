# Drora 有意分歧台账

状态：**持续维护**（2026-10-21 依 v3.16.1 合并完整性审计 `docs/upstream-sync/2026-10-21-v3.16.1-merge-audit.md` 补建首批条目）。

本台账集中登记 Drora 与官方上游之间**常设性（跨版本）的有意分歧**，是 AGENTS.md「与官方行为有意分歧的能力必须在 specs/ 留下决策记录与对照说明」的落地载体。合并期一次性裁决（ours删/theirs改 之类）仍留在各轮迁移 spec（如 `specs/upstream-v3.16.1-migration.md` §合并引擎·决策表）；本台账记的是**下次上游同步还会再遇到、动手前必须先查这里**的分歧，用于区分「缺口」与「有意分歧」。

每条四要素：**上游行为 / 本仓行为 / 依据（文件:行）/ 下次同步注意**。编号一经分配不复用；条目回退对齐上游时保留编号并标注，不删除。

编号对照：审计报告的 F 编号与修复工单的 F 编号是两套体系（如工单 F2=审计 F7、工单 F12=审计 F1），代码注释引用的「分派单 Fx」均指工单侧编号。本台账各条同时标注两套：

| 工单侧 | 审计侧 | 条目                               |
| ------ | ------ | ---------------------------------- |
| F12    | F1     | 台账 1 CLI 版本策略                |
| F13    | F5     | 台账 2 任务模式投影                |
| F14    | F6     | 台账 3 pnpm-lock 插件 importer     |
| F15    | F14    | 台账 4 oxlint 覆盖面               |
| F2     | F7     | 台账 5 vault 侧栏入口回植          |
| F1     | F3     | 台账 6 appId 豁免转换形态          |
| —      | F16    | 台账 7 oxfmt markdown 篡改缺陷     |
| —      | —      | 台账 8 affected 首推基线回退       |
| —      | —      | 台账 10 工程测试首推基线回退（N2） |

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

> 2026-11-01 注：本条登记的旧链 `scripts/affected-unit-tests/scope.mjs` 已随上游 v3.17.1 改名退役（ledger UP05497）；回退目标字面 `origin/main` 在新链中修正为 `drora/main`，见台账 10（N2）。本条保留作历史依据，不再单独维护。

- **上游行为**：官方 ZCode 仓库存在 staging 集成分支，affected 单测的首次推送基线取 `origin/staging` 与 HEAD 的 merge-base；基线缺失即严格报错。
- **本仓行为**：本仓无 staging 集成分支（PR 直合 main），`firstPushBase` 在 `origin/staging` 为祖先时用之、否则回退 `origin/main`（`scripts/affected-unit-tests/scope.mjs:31-40`），不猜测其他分支、保持「无基线严格报错」语义。
- **依据**：提交 `337b00b5`（「fix(upstream): affected 首推基线回退 origin/main——本仓无 staging 集成分支」）；`scripts/affected-unit-tests/scope.mjs:33-35` 注释；`docs/testing/pre-push-hook.md`（受影响单测范围与输出合同）。
- **下次同步注意**：基线分支与本仓分支模型绑定，属环境适配而非行为分歧；若本仓日后引入 staging 类集成分支，需同步修订 `firstPushBase` 回退顺序与 `docs/testing/pre-push-hook.md`，不跟随上游新增的分支假设。

## 台账 9：远控「官方/自建 Relay」切换为 Drora 独有客户端能力（2026-10-31 新增）

- **上游行为**：官方桌面无远控 relay 指向设置——远控三 URL 面（注册 HTTP/relay WS/二维码页）恒跟随端点链默认官方域 `zcode.z.ai`；生产构建无任何用户可达的 relay 覆盖入口。
- **本仓行为**：新增设置键 `webRemoteControlRelayOrigin`（生产可写，无 DRORA_ENV 门禁）+ 远控弹窗内「官方/自建」切换区（`packages/ui/src/web-remote-control/WebRemoteControlRelaySourceSection.tsx`），仅覆盖远控三 URL 面，全局 endpoint 链不动；解析链 `resolveWebRemoteControlEndpointOrigin`（`packages/shared/src/droraEndpoint.ts`）。配套把手机页同源 WS 推导从 `/ws`（旧 v1 自建 relay 路径）改为 `/api/v1/remote/ws2`（`packages/web/src/drora-extensions/remoteEndpoint.ts`）。设计全文见 `specs/relay-v2-server.md` §8.7。
- **依据**：`specs/relay-v2-server.md` §8.7（2026-10-31 新增，解冻同文 §8.4 边界决策 3「产品化入口明确不做」）；`specs/drora-divergence-ledger.md` 台账 9（本条）。
- **下次同步注意**：上游若在 `webRemoteControlManager`/`desktop/src/main/index.ts` 的 `getEndpointUrls` 装配、`droraEndpoint.ts`、`validationAppSettings.ts`、`WebRemoteControlDialog` 相关区域改动，需甄别是否冲掉本特性的接线点（getEndpointUrls 的设置键读取、schema 两处登记、弹窗配置区嵌入）；上游若官方实现了自有 relay 切换面，评估迁移到官方契约后回退本条。手机页 `remoteEndpoint.ts` 的 ws2 推导为本仓 drora-extensions 独有文件，上游同步天然无冲突。

## 台账 10：工程测试首推基线 staging→drora/main 回退（v3.17.1 N2，2026-11-01 登记）

- **上游行为**：上游 v3.17.1 把 affected 单测链改造为 `run-affected-engineering-tests.mjs` + `scripts/engineering-tests/scope.mjs`，首次推送基线硬性要求 `origin/staging`（上游 CI 约定的集成分支）；基线缺失即严格报错。
- **本仓行为**：本仓无 staging 集成分支（PR 直合 main），且 `origin` 指向上游官方仓 zai-org——`origin/main` 是**上游 main**，不是本仓产品 main。`firstPushBase` 在 `origin/staging` 存在且为 HEAD 祖先时用之，否则回退 `drora/main`（产品远端；`scripts/engineering-tests/scope.mjs:33-43`），不猜测其他分支、保持「无基线严格报错」语义。若照抄台账 8 的 `origin/main` 字面回退，merge-base 会退回上一上游锚点导致全量误选（即 pre-push 历史崩溃模式）。
- **依据**：`scripts/engineering-tests/scope.mjs:33-43`（`firstPushBase` 实现与注释，自引「divergence 台账 8 / v3.17.1 N2」）；`docs/upstream-sync/2026-10-31-v3.17.1/tasks.md` S1 执行补记 N2 段（旧 `affected-unit-tests/scope.mjs` 随 UP05497 删除，本仓改动=台账 8 staging 回退，由本条在新链承继并修正回退目标）；`docs/ci/affected-unit-test-baseline.md`、`docs/testing/pre-push-hook.md`（N2 口径已同步）。
- **下次同步注意**：上游再动 `engineering-tests/scope.mjs` 的基线解析时，`drora/main` 回退必须保留（或在本仓引入 staging 类集成分支后按台账 8 的注意项整体重审）；不得把回退目标改回 `origin/main`，也不得引入对 `origin/*`（=zai-org）引用的静默依赖。

## 台账 11：zcode-* 官方通道别名保留（V3 审计补登记，2026-11-01）

- **能力**：`packages/shared/src/channels.ts` 的 `OFFICIAL_RPC_CHANNEL_ALIAS_PREFIX = "zcode-"`（单一出处，消费链 channels.ts → services/collection.ts → desktop/src/host/index.ts）：窗口 Host 除 `drora-*` 通道外同时注册 `zcode-*` 别名，供**官方托管手机页**按官方通道名调用（冻结快照实证：`packages/mobile-web/src/recovered/remote/v4/3.14.3/assets/index-*.js` 调用 `zcode-task/zcode-agent/zcode-session`）。
- **登记原因**：原登记文件 `specs/mobile-web-remote.md` 已于 2026-10-22（d1a46eafe，移除自研 Relay 复刻）删除；别名是**官方互操作 wire 契约**而非品牌残留，必须留在台账防止后续同步误改名；`windowHostAttachmentRpcPolicy.ts:138` 等注释的 spec 引用自本条承接。
- **下次同步注意**：上游若重构通道注册/别名机制，保持官方托管页按 `zcode-*` 可达；官方页若改用新通道名族，以最新冻结快照证据更新本条。

## 台账 12：分享与远程控制保持官方 zcode 原实现（用户裁定，2026-11-01 登记）

- **能力范围**：①conversation-share（会话分享）全链——CLI/desktop 生成与出站、web 的 `ConversationShareLandingPage` 分享落地页（含 `DRORA_DOWNLOAD_URL="https://zcode.z.ai"` 官方下载锚点，`packages/web/src/share/ConversationShareLandingPage.tsx:106`）与 ui 分享文案（`zh-CN.ts:696,8295`、`en-US.ts:752,8775` 的 `twitterText`/`copySummary` 官方链接）；②web-remote-control（手机远控）——官方 Relay V2 客户端、官方默认 endpoint（zcode.z.ai 域，droraEndpoint.ts 单一出处）、冻结的官方手机页快照（`packages/mobile-web/src/upstream|recovered`，逐字节还原资产）。
- **裁定**：两项能力**整体保持官方原实现运行**——官方契约（relay 协议/分享域/落地页/手机页）不做 Drora 化改造；Drora 增量仅限既有的 relay 官方/自建切换层（台账 9：`webRemoteControlRelayOrigin` + 三 URL 优先级 + ws2 同源推导）。本条同时关闭「待甄别」中 V3 审计 B 的分享链接挂起项：**维持现状不改链接**。
- **下次同步注意**：上游若演进分享/远控协议或页面，按官方实现继续吸收；不得在本能力范围内引入品牌化改造（如需 Drora 自有分享域/自有手机页，须另立 spec 并经用户重新裁定）；官方下载锚点改动视为产品行为变更，须用户确认。

## 台账 13：模型设置页「模型能力」分组对上游共享 UI 触点的加法扩展（2026-11-04 登记）

- **能力范围**：`packages/ui/src/settings/model-provider-section/`（上游同步提交承载的共享目录，git 史仅 3 次 upstream 同步）内的本役改动——`useModelProviderNavigation.ts` 新增 capabilities 第三分组（`MODEL_CAPABILITY_NAV_GROUP_ID` 单一出处）+ `connectionSelectionMatchesNavigationItem` 等价改写（`item.type === "custom"` → `"custom" || "capability"`）；`Navigation.tsx` 新增 `resolveNavItemTestId`（testid 统一化）；`Detail.tsx` 按 `type === "capability"` 分派到 `packages/ui/src/settings/model-capabilities/`（自研新模块，架构 adopt 登记 ui-model-capabilities）；`constants.ts` nav union 扩展。
- **裁定**：spec `specs/model-capabilities.md`（§5.1/§12）授权的最小增量接缝；全部新逻辑在自研新文件，共享文件只做接线与等价改写。provider 卡片/套餐区行为零变化。
- **下次同步注意**：上游若重写 settings 导航（v3.17.1 已有 project-sidebar 重写先例），按「官方形态为权威」合并后**回植三件事**：capabilities 第三分组构造（useModelProviderNavigation）、`capability:` 节点的 Detail 分派与 testid、`SettingsModelProviderTarget.capabilityPurpose` 深链认领（ModelProviderSection.applyModelProviderTarget）。登记先例：台账 5（project-sidebar）。

## 待甄别（非既定分歧，下轮同步前需核实）

- **clientType 与 api-key 名漂移嫌疑**（随工单 F1 观察到，未改）：同一上游文档 `apps/zcode-cli/docs/design/v2/auth-login.md` 中 `clientType: "zcode"`（本仓 `apps/drora-cli/docs/design/v2/auth-login.md:176` 为 drora）与 `zcode-api-key`（本仓 :174/:190 为 drora-api-key；同文档 ：186 `appId=zcode` 已守豁免）。appId 是服务端注册值有 spec 实锤（规则 0）；clientType 与 api-key 名是否服务端注册值**未验证**（api-key 名偏客户端自建名，风险较低）。下轮同步 bigmodel OAuth 面时先甄别这两个字面量的服务端契约地位，再决定纳入规则 0 豁免或维持改名，不得静默跟随任一侧。
- ~~**分享文案下载链接指向官方站（V3 审计 B）**~~ **已裁定关闭（2026-11-01）**：用户裁定分享与远程控制整体保持官方原实现，官方链接维持现状——见台账 12。
- **relay 校验工具的 `.zcode/toolchain-env.sh` 路径（V3 审计 C，low）**：`packages/relay-v2-server/tools/verify-same-origin.mjs:266,315-322` 寻找 `repoRoot/.zcode/toolchain-env.sh`——本仓 `.zcode/` 为 gitignore 运行时目录，钉版工具链入口实为 `scripts/mise-toolchain-env.mjs`。官方仓/worktree 布局残留，仅影响工具失败提示文案（找不到时回退手动指引，不致误判）；下次同步 relay 工具时顺带对齐。
- **drora-site-plugin 裸读 env 键（V3 审计 D，low）**：`apps/drora-cli/packages/drora-site-plugin/scripts/drora-site.mjs:145-146` 以裸字面量读 `DRORA_OFFICIAL_ENDPOINT`/`_TOKEN` 而非引用 `shared/src/runtimeEnv.ts` 常量——该脚本为零依赖 .mjs，引入 `@drora/shared` 会破坏其独立运行性；登记为接受的偏差（生产方 bootstrap 侧仍走常量单一出处）。

## 台账 14：上游 v3.17.2 开源裁测 vs 本仓保留测试运行网（2026-11-04 登记）

- **能力范围**：上游 Source-Sync `zcode-open-source-v1` 起裁掉 packages 单测（ui/test 1146→115、services/test 291→5、provider/server 系全删），desktop E2E 保留。
- **裁定**：D1 跟随上游删除（工作树已执行，−2000+ 文件）；**本仓自研路径与改造保留集**继续以双显式清单运转（drora 276 条/fork-isolated 4 条，vitest.config 双清单结构与 AGENTS.md 描述保 ours）。上游 zcode-cua vitest 工程路径引用不适用（本仓为冻结还原 0.6.3+自研常量，无该配置文件，沿用 v3.17.1 裁决）。
- **下次同步注意**：上游测试面变更不再逐文件对账，仅核 engineering 清单与 desktop E2E；本仓 drora 清单收缩后基线 1881 用例为回归底线。

## 台账 15：zcode-cua 冻结区 Helper 身份常量（2026-11-04 v3.17.2 补记）

- **能力范围**：`packages/zcode-cua/broker-helper-constants.js|d.ts`、broker.js|d.ts、index.d.ts、package.json 与 zcode-cua-plugin 三文件、third-party 清单——zone take-theirs 曾覆盖为上游原生值（HELPER_APP_NAME="ZCode Computer Use.app"、BUNDLE_ID=dev.zcode.cua-helper、包名 @drora/zcode-cua 0.6.5）。
- **裁定**：15 文件恢复本仓 HEAD（Helper Drora 化裁定 2026-09-28 的单一出处，R3 冻结 0.6.3+本仓常量），仅并入上游新增 `HELPER_GHOST_CURSOR_OVERLAY_ARG`（值一致）与 broker re-export 三处增量；包名 `@drora/drora-cua` 全仓统一（改名引擎的 @drora/zcode-cua 名不采纳，58 文件收敛）。
- **R3 修订（2026-11-09 用户裁定）**：对齐目标由「上游开源仓」改为「官方 3.17.2 发行 bundle」——producer 切段与 Helper SEA JS 按 bundle 证据还原至 0.6.5，addon 改逆向重建源自建（不再随包分发官方字节拷贝）；详见 `specs/cua-3.17.2-alignment.md` §3。**本条身份五常量与包名权威不变。**
- **下次同步注意**：上游 zcode-cua 再演进时，Helper 身份五常量与包名以本仓为权威；新增 re-export/常量可并入但值域按本仓命名。

## 台账 16：CUA 3.17.2 对齐的版本/license/win32 三裁定（2026-11-09 登记）

- **能力范围**：`apps/drora-cli/packages/zcode-cua-plugin/{.zcode-plugin/plugin.json,package.json}`、`packages/zcode-cua/package.json` 的 version/license 字段；`packages/zcode-cua-helper/build-cua-helper-app.mjs` 的 `CUA_HELPER_VERSION` 缺省（Helper `CFBundleShortVersionString` 版本线）；win32 runtime（vendored `@zcode/zcode-cua-helper-runtime` 0.6.3）。
- **裁定**（`specs/cua-3.17.2-alignment.md` §2）：① parity 达标后版本号 0.6.3→0.6.5、license MIT→Apache-2.0 跟随官方翻转（官方 0.6.5 manifest 已翻 Apache-2.0）；② Helper 版本线对齐官方「随 App 版本」策略（官方 3.17.2 Helper plist 版本=3.17.2，不再固定 CUA 版本号）；③ win32 线维持 0.6.3 随线，Windows 侧 3.17.2 实现由用户另行开展，本仓 darwin 改动以 win32 无损套件为零漂移底线。
- **下次同步注意**：版本一致性脚本（`check-version-coherence.mjs`/`check-cua-baseline.mjs`）基线值随本役 P2/P4 批更新；上游若再翻 license 或版本策略，按官方跟随并在本条补记。

## 台账 17：CUA 桥接 env 键双轨——ZCODE_ 键面=冻结切段消费面 / DRORA_ 名=内部面（2026-11-10 登记，差距修复 R1 批）

- **能力范围**：`packages/services/src/node.ts` 四桥接键常量区
  （`ZCODE_CUA_LAUNCHER_PID_ENV` / `ZCODE_CUA_BUNDLED_HELPER_APP_PATH_ENV` /
  `ZCODE_CUA_HELPER_INSTALL_VARIANT_ENV` / `ZCODE_CUA_WIN_HELPER_RECIPE_ENV`）、
  `packages/desktop/src/main/desktopHostProcess.ts` launcher-pid 注入。
- **分歧性质**：0.6.5 冻结切段 env 键保 ZCODE 名（P3 有意决策，段头注释），我方
  host 侧消费面（`drora-helper-locations.js` 等）用 DRORA_ 名。桥接一律走注入侧
  /env 路由（先例=manifest 第二十八轮方案 A：`ZCODE_HOME=resolveDroraHome()` 把
  Drora 数据根路由进豁免区），零改动冻结资产。其中 launcher-pid 因 DRORA_ 名全仓
  零消费者**直接切换不双写**（避免两名字义）；其余三键 DRORA_ 侧保留，形成
  「ZCODE_ 键面=切段桥接面、DRORA_ 名=我方内部面」双轨。契约键单一出处=services
  常量区，注释锚消费方切段行号，禁止字符串散写。
- **下次同步注意**：上游切段再演进时，桥接键以切段消费面实际键名为准同步；新增
  桥接键先进 services 常量区定义再引用。`ZCODE_HOME` 透传受 SANITIZED 键表负向
  测试钉住（cuaLazyLaunchBridge.node-test.mjs），同步时勿将 ZCODE_ 键加进清洗表。
  详见 `docs/cua-restoration-manifest.md` 第七十三轮 R1.1/R1.2。

## 台账 18：v3.18.0 S1 契约段有意分歧（2026-11-12 登记，specs/upstream-v3.18.0-migration.md §4 S1）

- **server 包 onnxruntime-node 依赖移除**：`packages/server/package.json` 采上游（dropped `onnxruntime-node`），`build-remote.ts` 的 `external: ["onnxruntime-node"]`（含 P7 注释）随之替换为上游 `REMOTE_SERVER_NATIVE_EXTERNALS`（=["@napi-rs/keyring"]，buildRemoteValidation.ts:7 单一出处）。依据：P7 本体清除（obsidian-vault-phase2 §1-C7）后知识语义检索栈已拆，远端 bundle 不再有 onnxruntime 消费面；上游移除方向与本仓 P7 一致。
- **platform.ts share 深链 scheme 注释**：上游注释面 `zcode://share/import` 为 transform 漏改（代码字面量无此串，仅 JSDoc），按本仓注册 scheme 回写 `drora://share/import`（platform.ts:962 一带）。
- **toolGrouping 三键暂缓删除（D9 责任块）**：`shared/src/protocol.ts`（toolGroupingExploreEnabled/TerminalEnabled/ChangesEnabled 三字段）与 `validationAppSettings.ts`（默认值+patch 面）按 §3.2 责任块表保留至 S6 原子删除；S1 删除即断 ui 六文件消费与全仓 typecheck。
- **collection.ts 第三参并集契约扩展**：上游 `exposurePolicy: ServiceExposurePolicy`（allowedChannels+credentialStoreRecovery）与本仓 `officialChannelAliases` 合并为单 options 对象（services/src/collection.ts:41-66）；两族调用方形态结构兼容，桌面附着链路（S5 域）零改动。
- **node.ts DRORA_CUA_BROKER_TOKEN_ENV_KEY 导入保留**：HEAD 即仅导入未消费（git grep 实证 1 处），按 R3 冻结区纪律保 ours 原样；如终门禁 lint 报 unused 再裁。
- **clean-merge 桶 38 件 EOL 幻影重合并**：apply-segment.mjs 的 git merge-file 以 git blob（LF）对变换树（CRLF）混跑，38 件 clean-merge 全部整文件假冲突并落了带标记内容；已按归一化 LF 三方重合并修复（38/38 干净，与 dryrun 分类器判定一致）。工具缺陷已实证，S2+ 各段 apply 后需复扫 `<<<<<<< ours` 残留（或先行修复 apply-segment.mjs 的 EOL 归一）。

## 台账 19：v3.18.0 S1 段门桥接修复（2026-11-13 登记，S6/S7/S8 段 take-theirs/重放时替换）

- **S1 引发跨段编译断的桥接修复（S6/S8/S5/S7 域文件最小 diff，均带「S6/S8 take-theirs 对齐」注释）**：ui 11 文件（V4InteractionDialogs pluginInstall 早退、builtinSkillI18n/IntlProvider/LocaleSwitchen 等 Record 收窄+toZhOrEnLocale、SessionPane healthy 空值保护、test-actions/marketing/rewards/codingplan/feedback/model-provider 调用点）、web 4 文件（communityUrl/main.tsx/webRemoteControlTransport/share 解析器）、desktop 11 文件（about/Finder/右键菜单/pet 表情 Locale 收窄、host index getDeviceMid 迁移、sourceServer cancelSourceUpdate 可选桥、terminal listTerminalIdsUnderPath、windowHostController 三成员 not-yet-wired 桩、desktopHostProcess 判别收窄 cast）、e2e 3 文件（凭据 mock 补桩 + locale 收窄）、CLI 4 文件（conversation-topic-publisher isWireConversationRow 守卫、contracts session.port 增 session/extension 来源与 PLUGIN_DISCOVERY_INPUT）。
- **CLI 工作区环境修复**：apps/drora-cli 独立 lockfile 的 node_modules 链接陈旧（contracts 解析 zod 走根 4.6.5 而非工作区 zod@3.25.76）——`pnpm --dir apps/drora-cli install --frozen-lockfile` 恢复；contracts/core/adapters dist 用工作区 TS 5.9.3 重建（误用根 TS 6.0.2 会产生不同 emit）。根 install --no-frozen-lockfile 曾致 pnpm-lock 变更（+166/−64），S8 生成物重跑时覆盖对齐。
- **test:drora 残留 16 失败均为非 S1**（证据在 §10 S1 条目）：contract.test ×2 与 team/contract ×1 为 HEAD 既有文本性漂移（22038fc10/更早提交未同步测试）；telemetryFieldContract ×9 为本机 git init NUL 设备故障；modelCapabilitiesMigration MC-2 为 Windows chmod 0o500 不阻止写入（探针实证）；simulatorPluginPackaging ×2 为 `import.meta.main`（Bun 语义）在 Node 24.1.0 下 undefined 致插件服务进程静默退出（vitest 外完整复现）；ensureElectronRuntime ×1 为并发 flaky（单跑 10/10）。

## 台账 20：S1 段门第 2 轮——四个非 S1 测试失败的工具链/平台根因与带绿处置（2026-11-13 登记）

- **simulatorPluginPackaging ×2（宿主 Node 漂移）**：Volta 默认 node 24.1.0 无 `import.meta.main`（Node ≥24.5 特性），android/ios-simulator-plugin 入口 `if (import.meta.main)` 恒假→MCP server 静默 exit 0→"Connection closed"。mise.toml 钉 24.14.0 但本机未装 mise。处置：`volta install node@24.14.0`（本机已有镜像）对齐钉版；24.14 下 SDK 全链复现 CONNECT OK。**下次同步注意：段门跑批前先核 `node --version` 与 mise.toml 一致。**
- **telemetryFieldContract ×9（测试助手平台缺陷）**：`GIT_CONFIG_GLOBAL=os.devNull` 在 win32 为 `\.\nul`，git-for-windows 无法当文件打开（`nul` 可）。处置：win32 条件用 `nul`（测试内 `gitDevNull` 常量+注释）。
- **modelCapabilitiesMigration MC-2 ×1（失败注入平台无效）**：NTFS `chmod(dir,0o500)` 仅设 readonly 属性不阻断目录写（writeFile/rename 探针均成功），「标记落盘失败」构造无效→顺序不变式断言误报。处置：`it.skipIf(win32)`（repo 四先例同款）；不变式其余用例照跑。
- **ensureElectronRuntime ×1（pnpm×vitest 工具链交互）**：`pnpm run` 把用户 ~/.npmrc `electron_mirror` 以大写 `NPM_CONFIG_ELECTRON_MIRROR` 注入脚本进程；vitest threads worker 的 process.env 为快照影印层，进程内覆写（vi.stubEnv/直写均取证）不反映到 `{...process.env}` 物化 spawn env。处置：`it.skipIf(注入键存在)`，干净环境（CI）照常执行；工具链升级后移除守卫。
- **voice 契约 ×2 / ui-team ×1（HEAD 既有批内脱节，非本战役）**：22038fc10 批一入 `VOICE_SETTINGS_KEYS.globalDictationEnabled` 而设置 schema/契约测试未跟；58f3f595a 增 session-line.ts 公共入口而 module 断言未跟。本轮补齐（schema 增 `voiceGlobalDictationEnabled` 默认 false+patch 面、测试期望列对齐）——批二如另有 UI 面，以本字段为既成 wire 面。

## 台账 21：v3.18.0 S2 会话控制段有意分歧与平台处置（2026-11-13 登记，S4/S5/S6/S8 段 take-theirs/重放时对齐）

- **session/messages 上游重写收编（Drora R2 分歧被上游取代）**：本仓「session/messages schema 漂移」有意分歧（specs/mobile-relay-server.md，映射到声明契约形状）被上游 v3.18.0 readMessages 重写收编——forward 冷读（规格 0.9，不恢复 runtime）、cursor 必命中、forward 取头部分页、mapSnapshotMessages 全量映射（媒体回填+工具元数据）。server-operations.ts 保留规格注释溯源；手机页消费面兼容性（R2 快照形状不变：仍走 mapMessageWithParts 投影）随段实测，S6/S7 手机 e2e 复核。本地投影簇（projectActiveSessionMessages/applyRewindBranch/filterRewindCommandAckMessages 等 165 行）由 active-transcript 模块（上游同款）替换删除，`isUserVisibleSessionMessage` 为该簇外独立谓词、按上游原样保留。
- **registerSessionRuntime 行留给 S4**：上游 create-app.ts:308 `if (ownsSessionStore) await sessionStore.registerSessionRuntime?.(sessionId)` 属会话驻留链（sqlite-session-store.ts:310 实现面在 S4 THREE-WAY 桶），S2 接线块按最小面省略该行；S4 重放 create-app 时补回。
- **e2e --import win32 说明符修复（2 文件）**：standalone-process/standalone-tui-approval 两 e2e 的 `tsxLoader` 上游为 `fileURLToPath(import.meta.resolve("tsx"))`——win32 裸盘符路径被 Node 24 当「d:」协议拒绝（ERR_UNSUPPORTED_ESM_URL_SCHEME 探针实证）；改为直传 `import.meta.resolve("tsx")`（已返回 file:// URL，勿再二次转换——pathToFileURL 包装会产出 `…/bootstrap/file:/D:/…` 双重包装，同样实证）。
- **SCT08 TUI 键盘用例 skipIf(win32)**：node-pty+ConPTY 下 @xterm/xterm 缓冲区混入未消费原始 ANSI 片段（失败取证 screen.txt L33「5hm2;15;20;25m」=被拆开的 SGR 尾段），"Type a prompt" 占位符永不到缓冲区、waitFor 30s 超时（双跑复现；TUI 本体已正常渲染）。同审批链 headless 孪生用例 win32 绿；POSIX CI 照跑本用例。Windows pty 重建为已知平台缺口，非产品缺陷。
- **治理 hunk 时序裁定（§3.2 #13 vs 责任块表）**：#13 文本「boundary 进 lint/test:architecture 命令链的注册随 S8」与责任块表「三命令插入= S2 责任块、段内完成 hunk 编辑」并读；按 #13 明文所指的责任块表执行——三命令插入、.oxlintrc 禁导入 override、policy 模块登记均 S2 段内落位，S2 段门以 `node --test`/直跑兜底验证 boundary（全量 lint/test:architecture 链由 workflow/S8 复跑），S8 重放其余 hunk 时与 S2 已落段 diff 去重。
- **policy 模块计数勘误（6→7+1）**：§4 S2「policy 6 模块（上游 17-74 行）」实落 7+1：cli-active-transcript（上游 76-84 行）因 cli-session-control-runtime 的 requires 链逐字引用必须同批登记；app-control-navigation（上游 103-114 行）因 S2 已落位 14 文件、architecture:check 不得新增 unmanaged 违例随文件登记。S8 的 82-id adopt 重放时与已落 8 id 去重（v3.17.2 8-id 重复前科）。
- **session-control 跨工作区依赖形态**：apps/drora-cli 为独立 pnpm workspace（root pnpm-workspace.yaml 不含它），@drora/session-control 依赖按 @drora/shared/drora-cua 先例用 `link:../../../../packages/session-control`（上游 workspace:* 形态不适用本仓双工作区结构）；@drora/core 新增 `./session-control` 子路径导出（上游同款位置）。
- **project-storage requires 同步（S1 残留修复）**：S1 已把 module.ts requires 加 task-groups 而漏同步 architecture-policy.yaml（manifest-policy-mismatch 违例），S2 按 upstream project-storage requires 同步补 task-groups（module id 915 行既有）。
- **S2 段门第 1 轮补（台账 21 续，2026-11-13）——S1 已落目录的 policy 登记提前收口**：13 个上游模块逐字照搬入库（extension-host-protocol/extensions-service/managed-worktree×3/voice-input-service/credential-security/agent-crash-diagnostic/windows-runtime-host/plugin-host-queries/context-composition/bot-topic-history-attachment/plugin-install-interaction，仅 zcode→drora 改名；mcp-apps-protocol/plugin-ui-bridge 已存在去重）；例外 8 条（上游 2 逐字 + 本仓 6：source-server 族/server-cli packaging 上游三处无登记按「对齐不接管」处置 + manifest 中间态聚合例外）；manifest-policy-mismatch 漏接 isException 修复 + 回归例。S8 adopt 时与在库 21 id 去重、authored 例外随消费段自愈核删。
- **S2 段门第 2 轮补（台账 21 续，2026-11-13）——S3/S4 消费方的 S5/S6 供应商前向收口**：全仓 typecheck 首跑暴露 S3 落位消费方引用 S5/S6 未落供应商的断链 14 错（5 类面）。① S6 take-theirs 桶五件提前落位（字节复制 theirs）：ui/plugin-ui/{hostPrimitives,index}.ts、components/PluginUiLauncherItems.tsx（SidePaneLauncherRow 加 testId）、adapters/usePluginUiContextImages.ts（useContextImageAttachments 重构+旧 hook 兼容）、mentions/mentionTypes.ts（MentionCategory +"extensions"/"elements"）——S6 重放时已是 theirs 形态幂等；hostPrimitives 新 3 re-export 的目标文件（domain/buildPluginUiHostContext、buildPluginUiHostCapabilities）为本仓自研演进版（不在 inventory=上游 v3.18.0 未改），自研 g9 hostActions/surfaceId 等字段全可选、与上游调用面（extensionViewPage.ts:117,215 三调用点实测参形）兼容，pluginUiHostTeardown.ts HEAD 与 theirs 逐字同——三目标文件均不落位维持自研版。② S5 clean-merge desktopRuntimeEnv.ts 仅提取 extensionHostModulePath 一行（:94-97 带中文注释，S3 落位的 extensionHostSupervisor.ts:23 消费；S5 重放以工作树为 ours，同内容行无冲突吸收）。③ S5 new tsconfig.app-navigation.json 提前落位；S5 conflict tsconfig.main.json **并集合并**——include 保自研 src/drora-extensions（§1 例外 3 物理隔离，上游版无此目录）+ 增 src/extension-host，references 增 ../rpc 与 ./tsconfig.app-navigation.json；**S5 重放该文件 conflict 时须以此并集为底稿，drora-extensions 不得丢**。④ S4 遗留 27 条 unmanaged-new-file 提前收口：4 模块 id 逐字照搬（cli-session-fork-commit/cli-conversation-materialization（zcode-protocol-v4→drora-protocol-v4 路径）/topic-resource-tool/cli-plugin-startup-budget）+ 5 上游例外逐字（instruction-files-delta/prompt-snapshot/dwf-websearch-budget/background-subagent-stall-notice/total-tokens-reminder）+ 1 authored 例外 plugin-discovery-manifest-subset-form（上游 module.ts 只声明 2 相对入口而 policy 登记 6 绝对入口的固有子集形态，git show 上游两文件实证；上游靠 --changed 基线吸收不显形，本仓工作树 diff 显形）。S8 联动：adopt 去重基数 21→25 id（S2 累计 8+13+4）；authored 例外核删清单 +1。

## 台账 22：v3.18.0 S3 Extension Host + design 段有意分歧与决策（2026-11-13 登记，specs/upstream-v3.18.0-migration.md §4 S3；S8 段收口时对齐）

- **@drora-dev/plugin-api npm 发布名决策**：上游 npm 类型包 `@zcode-dev/plugin-api`（官方手动发布、版本冻结，docs/plugins/plugin-publishing.md §3.3/§5）经兜底规则 8 变换为 `@drora-dev/plugin-api`（S3 落 13 件 + shared extension-host/CONTRACT.md 引用面）。本仓不拥有 `@drora-dev` npm scope；按 @zcode/→@drora/ scope 族决策以仓内变换形态为准，当前不发布 npm（是否以 @drora-dev 名义发布归发行域 specs/drora-unified-distribution.md 终裁）。版本恒等于 EXTENSION_API_VERSION="1.4.0"（双出处已同值：shared/src/extension-host/manifest.ts:16 + plugin-api/package.json:3，上游同位同行）。
- **design-resources verbatim 豁免补登与 19 件污染重放**：豁免登记前 theirs 树 361 件中 19 件（NOTICE.md、SKILL.md 系、example.html 系、schema.ts、template.html、checklist.md、anti-ai-slop.md——含 zcode 字面量的文本）已被改名规则污染；按本段登记的 drora-rename.md 豁免区 6 + transform VERBATIM_PREFIXES 以 `--subtree` 局部重放覆盖 theirs，361/361 sha256 对齐上游 blob（工作树全量复验）。**路径口径勘误**：豁免前缀实为 `apps/zcode-cli/packages/design-plugin/skills/design/design-resources/`——切段指令所写 `apps/zcode-cli/packages/design-plugin/design-resources/` 漏 `skills/design/` 两级、不匹配任何真实路径，按实际路径登记。
- **copied-components 差集口径勘误（「7 条」→实测 8 新增 + 2 演化/独有）**：upstream 20 vs ours 13（计数差恰为 7，指令口径来源）。by-id 实测：上游独有 9 ＝ 8 条设计域新组件（open-design design resources、html-ppt deck templates、Zara Zhang html-ppt deck templates、frontend-slides skill、gstack design skills、brand-guidelines skill、frontend-design skill、taste-skill）+ agent-browser skills id 演化（"including dogfood"→"including dogfood and electron"，file hash 014bb31e 同件）；本仓独有 2 ＝ OpenAI hatch-pet processing pipeline + agent-browser 旧 id。third-party/copied-components.json 为 S8 zone-decision 未动；S8 收口时保留 hatch-pet、采纳 8 条设计域新条目、agent-browser 按 file 认同演化 id。
- **S3 域 architecture 模块/例外提前登记（5 模块 id + 1 例外）**：extension-host / extension-slots / plugin-api / design-runtime / agent-plugin-discovery 五模块 + design-plugin-third-party-resources 例外（上游 policy 177-186/828-846/1653-1727/2310-2315 行逐字照搬，仅 zcode→drora 路径与 id 改名）。S3 段门本不含 architecture:check；按 S2 段门第 1 轮「段门按 changed 口径即时执行不等人」教训防御性提前收口，消掉 S3 新目录 71 条 unmanaged-new-file。agent-plugin-discovery 的 roots/publicEntrypoints 跨段引用 S4 装配面（bootstrap/src/plugin-discovery/、zcode→drora-protocol 两端口文件、core handler）——引用缺席文件不触发违例（plugin-install-interaction 引 S6 缺席件先例），S4 落位后自然闭合。S8 82-id adopt 时与在库 id 去重（S2 累计 21 + 本轮 5 = 26 id）。
- **段门命令勘误与修复（plugin-api typecheck）**：spec §4 S3 段门 `pnpm --filter @drora-dev/plugin-api typecheck` 实测 ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT——上游 plugin-api 即无 typecheck 脚本（仅 build），其 tsconfig 注释指明检查形态为 `tsc -b`（写声明到 out/tsc，产物 gitignored）。S3 段门第 1 轮实败于此（预告命中）。**处置（2026-11-13 第 1 轮修复）**：对 plugin-api/package.json 的 scripts 补 `"typecheck": "tsc -b"`——对上游文件的最小加法，理由：①与上游 design-runtime（有同型 typecheck 脚本）形态对齐；②段门命令为 workflow 固定面，改脚本比改门命令稳（不依赖 workflow 命令清单同步）；③产物落 gitignored out/tsc 不污染工作树。清增量产物强制全量复跑 =0。S8 take-theirs/adopt 重放该文件时保留此脚本行。

## 台账 23：v3.18.0 S4 CLI 主体段冲突处置与有意分歧（2026-11-13 登记，specs/upstream-v3.18.0-migration.md §4 S4；S7 测试段/S8 收口段 take-theirs/重放时对齐）

- **conflict 分支 EOL 假冲突与归一化重并（S1 台账 18 同族工具缺陷）**：apply-segment 的 conflict 分支仍以原始缓冲喂 merge-file（git blob LF × 变换树 CRLF），37 件落盘标记全部为整文件假冲突（1 块吞全文件）；按 clean-merge 同口径归一化重并后，37/37 件与 dryrun detail 块数逐件同数（含 create-app.ts 4 块）。工具缺陷待修（conflict 分支补 normIfText），本轮以归一化重并结果为解决底稿。
- **37 件冲突组合裁定总纲**：本仓标记块保 ours——model-capabilities §6 接线（imageGenerationPort 恒注入 / generate_image 恒注册 / build.mjs persona worker bundle / build.test persona worker 用例）、drora-persona 块（getOrCreateDroraPersonaSystem / personaCapturePort / personaLearningNotificationPort / applyPersonaContribution / server.ts PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1）、agents-team 接缝 α 全套（installDroraAgentsTeam / gateAgentsTeamSkillPort / agentsTeamEnabled 灰度门 / team·site-* 测试目录断言）、obsidian g1 常驻服务全套（officialPluginAppServices 三点 + hostServices/appService/uninstallKeepData 反查 + resolveOfficialPluginAppServiceSpawnConfig）、drora-marketplace-compat 别名入口、P7 插件 UI 面板 session 唯一形态投影、file-config DRORA_PLUGIN_CONFIG_* 别名、subagent win32 兼容用例；上游演进全取——Hook Trust D23（workspaceHookTrustIdentity + projectDirectory 映射）、registerSessionRuntime、webSearchBudgetPort 全链、pluginDiscovery 端口与 PLUGIN_DISCOVERY_INPUT、SiteDeploy onSiteDeploymentRequested 回调、requestCapabilityProjectionOptions、quote comment/agent 字段与 QUOTE_COMMENT_GUIDANCE、provider 投影 originEntries、SEA build:sea:prepare 链、@napi-rs/keyring external、官方插件 seeding 全 async 化（collectFilesystemPluginFiles/walkFiles/isAllowedSeedBranch → 上游 async 族）、writeOfficialPluginRuntimeManifest async、readMessages 上游重写收编（S2 已裁定）、grantPermissionFullAccess→grantPermissionMode 改名、conversation-topic-publisher 投影重构（量度/预算逻辑移出，量 -306 行为上游自身搬家）。
- **create-app.ts 装配缝合（diverge 1589 全段最关键单文件）**：4 冲突块组合——①配置装配：上游 createConfigWithPluginMigrations+Hook Trust 内联重构拆回中间变量 fileConfigResult，本仓 agentsTeamSetting 灰度门继续窄化前读取（中文注释载适配原因）；②双侧 try 外声明并集（standaloneSessionControl + officialPluginAppServices）；③persona 绑定块与上游 worktree 项目身份映射并存，projectID 取上游新形 projectIdFromDirectory(projectDirectory ?? workingDirectory)；④catch 收口并集（standaloneSessionControl.close + g1 harvest）。18 符号面逐一 grep 落位验证。
- **36 件重叠文件复核（apply ours=HEAD 覆盖 S2 责任块的风险面）**：apply 前保全 diff+副本；13 件 ours-pre 与 theirs 全等（S2 hunk 即上游原生，含 tui 全家/i18n 三件/mapper 等）；23 件残余差异逐件审——全部为上游演进（改名/重构/搬家），无本地内容丢失；S2 符号（createAppSessionControlBinding/isTranscriptVisibleMessage/projectActiveSessionMessages/standaloneSessionControl 等）在合并结果中全数在位。**worktree 前科发现**：apply 前工作树残留一次未完成 S4 尝试的痕迹（conversation-topic-publisher 的 isWireConversationRow 守卫注释「S4 take-theirs 全量对齐」、session.port.ts「S4 clean-merge 全量对齐」注释等）——本次 canonical apply 整体覆盖，上游原生含等价内容，无叠加损伤。
- **缝合适配 8 处（typecheck 驱动）**：①executor/types.ts theirs 侧 import 与合并上下文重复 ToolSearchExecutionContext，去重；②persona 投影泛型加 Origin 参数 + 可选 originEntries 字段（上游 ProviderRequestMessageProjectionResult 新必填字段），applyPersonaContribution 在场时插空组保持逐组对齐，调用侧 ?? [] 收敛回必填（三处中文注释载因）；③plugins.ts enrichCachedClaudePluginMarketplaceIcons 适配 resolvePluginContext 异步化（then 链保 fire-and-forget 语义）；④-⑧五处 both 模式连接点修复（official-plugin-definitions 注释 opener、official-plugin-runtime/plugins.ts×2 悬挂签名、build.test.mjs 与 adapters plugins.test.ts 测试收口 `});`）。CLI 四包 tsconfig 只含 src，tests 语法面以 TS parser parseDiagnostics 全量复扫（33 件 CLEAN + 3 件 JSON 已校验 + 1 件 md）。
- **平台条件跳过保留（repo 先例同款带取证）**：bootstrap tests/plugins.test.ts「preserves hook executable mode when rebuilding...」（上游重写名，断言面 mode & 0o111 在 win32 不可满足）与 session-persistence.test.ts 三件（上游重命名后的 Bash shell 快照用例，POSIX 假环境探测 win32 不可达）——均保留 it.skipIf(win32) + 本仓平台取证注释，注明「v3.18.0 合并：采用上游重写后的用例名，保留 win32 平台跳过条件」。
- **CLI 契约对账结论（spec §4 S4 段门项）**：①V4「双出处」在 v3.18.0 已被上游收敛为引用制——CLI transport.ts 仅引用 V4_METHODS.*/droraProtocolMethods.*（30 键引用），shared 定义 V4_METHODS 39 键/V4_NOTIFICATIONS 8 键，悬空引用 0（集合 diff 为空达成于引用面）；②错误码六码全 DRORA_ 形态在库（PLUGIN_SOURCES_CHANGED 4 文件/PLUGIN_STARTUP_TIMEOUT 2/CREDENTIAL_STORE_CHANGED 2/CREDENTIAL_DECRYPT_FAILED 1/FILE_LOCK_TIMEOUT 4/RUNTIME_MODEL_UNAVAILABLE 3），ZCODE_ 残留 0；③oauth:zai_cn:{access_token,refresh_token,user_info} 三键（adapters shared-credentials.ts:30-32，与上游同行号）与 ④drorajwttoken（node.ts 6 处 credentialService.load）均与 theirs 同集同形——**spec §6 表「zcodejwttoken 逐字」为上游原名口径勘误**：变换后契约面=drorajwttoken（S1 §6.1 已记），zcodejwttoken 仅存 mobile-web frozen 3.14.3 资产与历史 docs（D5 域未复活，CLI 包零命中）。
- **dist 陈旧三件重建**：contracts/adapters/dynamic-workflow 三包 dist 为 apply 前旧时点产物，CLI 四包 typecheck 首轮报错（SessionDeletionReference/ForkFromSourceInput/pruneUsage/DEFAULT_WEB_SEARCH_BUDGET_PER_ASK 缺失）全为陈旧 dist 假错——源面均已有（S4 take-theirs 落位），重建后复绿（S2 台账 21「dist 陈旧」同族教训，S5+ 各段 take-theirs 后若复用 CLI 链需先重建依赖面 dist）。

## 台账 24：v3.18.0 S4 段门第 1 轮 test:upstream-cli 失败修复（2026-11-13 登记；workflow 1h 超时元凶=cli 包悬挂，已解）

- **bash 快照 fork 风暴（产品修复，上游共享文件）**：adapters src/exec/shell-init-snapshot.ts 的快照创建脚本对每个 bash 函数做 `$(declare -f | base64)` 编码、source 时再逐函数 `eval "$(base64 -d)"` 解码——两侧都是每函数 ~2 fork。本机登录 shell 83 个函数 × Windows fork ~90ms，快照创建实测 8.3s（SNAPSHOT_TIMEOUT_MS=10s 边缘）、每个后续 bash 启动 source 再付同量，bash-direct-execution/exec/session-persistence/subagent-workspace 等 Git Bash 用例全量 5s 超时（CMD 方言不走快照路径故独活）。`declare -f` 输出本就是 bash 可直接 source 的规范形态，改为单管道逐函数原样追加，创建 8.3s→1.66s、source 实测 70ms，POSIX 行为不变（函数定义内容一致，仅少 eval 包裹）。shell-init-snapshot.test.ts 的 base64 断言同步改为原样追加形态。
- **esbuild `using`-in-loop 降层缺陷（工具链，四包 vitest 配置）**：esbuild（0.25.12 与 0.27.7 均复现）把 `using` 降层为函数级 var 的 `_error/_hasError` 追踪；「循环内某次迭代抛错、后续迭代成功 return」的形态会把陈旧异常在 finally 的 __callDispose 重抛（最小复现：es2022 目标返回 exhausted、esnext 直通返回 ok-2；native Node 语义正确）。命中面：target-completion-verification 的 verifier busy 重试（goal-verifier-model-options 假失败）与 model.ts 等 `using statusSink` 位点。处置：adapters/bootstrap/core/contracts 四包新增 vitest.config.ts 置 `esbuild.target=esnext`（mise 钉 Node 24.14 原生支持 using，测试执行原生语义），产品代码零改动。
- **win32 平台适配三件（测试/产品，上游 POSIX 盲区）**：①adapters plugins.test.ts 断言「文件当目录」读取报 ENOTDIR——win32 路径解析报 ENOENT（readFileSync 探针实证），断言放宽两码其一；②adapters src/mcp/node-fallback.ts 并发 agent rename 同名 shim 在 win32 报 EPERM（POSIX 原子覆盖无此形态），按该函数自身契约「并发写入同一字节、rename 谁赢都正确」补输者复查目标已当前即成功；③bootstrap plugin-secrets.test.ts 断言私有文件 workspace 键为裸路径——实现经 normalizePluginConfigPathForComparison 在 win32 归一（大小写不敏感+`/` 分隔，适配器注释载因），期望键改用同一归一函数（两平台一致）。
- **cli 包 devDeps 补 @mbears/opentui-{core,react}（环境/依赖声明）**：cli 测试直接 import @mbears/*（tui-login-polling/mode-switch/model-selection），历史上靠根 workspace hoisted node_modules 解析；S1 的根 pnpm install（2026-11-12 23:43）剪除未声明依赖留下空 @mbears 作用域目录 → ERR_MODULE_NOT_FOUND，且失败后 node --test 子进程不退出 → **workflow 段门 1 小时超时的直接元凶**（Nov 1 全量跑 tui-login-polling 即失败但当时模块尚在）。按「谁 import 谁声明」补 cli devDependencies（0.2.15 与 tui 同版）+ CLI workspace install；悬挂消除（进程正常退出，测试失败有界）。
- **升级待裁两项（上游携带，本仓字节一致实证）**：①session-store-permanent-deletion.test.ts 六用例——publishedChecksum=608f… 为已发布 0.17.1 SQL 摘要，当前树 0025 sql 摘要=1e83…（migrations.ts 与 theirs 逐字节一致；该测试注释自述用途即「钉住已发布 SQL 防漂移」），上游未发布树自身携带 sql/常量漂移，且真实旧库会因此触发 MigrationChecksumError；②provider-builtin-tool-rounds「keeps a discarded stream attempt (mcp_tool_use)」——server 变体过、mcp 变体注入断流前零事件面（compat 管道已建但 transform 未运行），recovery 以 discarded=0 拒绝重试；测试/fixture/compat/runner/coordinator 全链与 theirs 逐字节一致且独立复现非竞态。两项均升级 workflow 裁定处置（修上游内容 vs 台账登记跳过）。

## 台账 25：v3.18.0 S4 段门第 3 轮修复（2026-11-13 登记；轮内全量首次跑通=超时解除，9 包失败面逐类处置）

- **CUA 桥冻结符号 vs 变换树撕裂（node-repl-host，测试侧修复）**：S4 合并的 mcp-server.test.ts 单元格代码用 `Symbol.for("drora.node-repl.computer-use-bridge")`（上游变换树把测试与源同步改名），但本仓 cua-bridge.ts:9 的 `zcode.node-repl.computer-use-bridge` 为冻结线常量（:8 注释明载「宿主侧改名会导致桥接永远找不到」，browser 桥符号已 drora 化而 CUA 桥属冻结面）——测试按 drora.* 取桥得 undefined，`Cannot read properties of undefined (reading 'call')` 假败。测试两处改回 zcode.*（:769 调用/:796 assertAvailable）+ 注释载因；修后 mcp-server.test.ts 27/27 绿。
- **vitest testTimeout=15s（四包配置追加）**：Windows Git Bash 用例每只读冷快照 ~1.7s（fork 风暴修复后）+登录 shell spawn，整包并行 CPU 争用下 5s 默认边缘超时（串行全绿、并行必超——第 3 轮 adapters 5 用例+core bash 族同形态实证）；15s 对齐串行通过形态，bash-direct-execution+exec 两文件修后 152 过 0 败。
- **第 3 轮剩余失败面分类（未修，各有证据）**：①bootstrap 46 文件 205 用例＝ENOSPC 收集失败（27 处日志实证，磁盘 276MB 不够全量缓存重建）；②android-emulator-plugin 1 用例＝C: 盘 Temp copyfile ENOSPC（双盘皆满）；③tui 7 文件＝**AppView 渲染段原生 segfault**（tsx 直跑 exit=139、node 24.1.0 与 24.14.0 双版本复现＝非 node 版本回归、opentui-core 裸 import 与 testRender 探针均存活＝崩溃点在 tui src AppView 渲染链，需专项调试）；④drora-site-plugin 1 用例＝Node 内部断言 `env_->execution_async_id()==0`（zlib/async 族运行时缺陷，产品层不可修）；⑤design-plugin 6 用例＝S3 段门「未跑留 workflow」的递延面在本门首次显形（内容断言族）；⑥core 45 用例＝bash 族并行超时（testTimeout 已覆盖待复跑）+ENOSPC 混合；⑦cli 14＝第 1 轮已分类集合（9 既有放行+SEA 拓扑 2+打包缝 5 中已修 1）。 

## 台账 26：v3.18.0 S4 段门第 4 轮修复（2026-11-13 登记；node-repl-host 转绿确认、C: 临时盘清障、adapters 收敛至 2 个负载敏感用例）

- **C: 临时盘清障（8571→~4k 件 drora-* 测试夹具残留删除）**：四轮 gate/修复会话在 %TEMP% 累积 mkdtemp 夹具（drora-agent-custom-cwd/direct/bash/node-fallback/plugin/session/skill-sync-home/site-cli/owned-agent/installer-test 等 20+ 族）与 zcode-bash-*/zcode-official/android-tool-security-* 旧残留，C: 从 94MB 恢复到 2.2GB；均为可再生测试产物（崩溃/被杀运行泄漏的 finally-cleanup 缺席件）。android-emulator-plugin 4 用例（C: copyfile ENOSPC 族）清障后 8/8 复验绿。
- **vitest cacheDir→系统临时盘（四包配置再追加）**：D: 长期 <300MB 致变换缓存 ENOSPC、bootstrap/core 文件级收集失败（第 4 轮 241/304、217/337）；缓存改 tmpdir 所在盘与仓库盘解耦。注意：单次 bootstrap 全量（304 文件）仍需 GB 级临时空间（本轮 2.2GB 再度耗尽至 150MB、55 处 ENOSPC）——**全量验证需 ≥5GB 级空闲，双盘当前均不满足**。
- **adapters 收敛实证**：清障+配置后全量 2824 过/2 败——exec「settles completion...boundary races exactly once」与 mcp-resource-telemetry「运行时烟测」单独复跑均过（2283ms/1467ms）＝并行负载敏感 flakes（机器同时承载 workflow 会话）；其余全部绿（含第 1 轮 9 败与上游携带 skip 件）。
- **剩余真实失败面（非环境）**：bootstrap plugins/skills/catalog 族（第 1 轮原始清单即有，当前磁盘下无法干净测量真实子集）；cli 14（已分类：9 既有+SEA 拓扑 2+打包缝余量）；tui 7（AppView 渲染 segfault 专项）；design-plugin 6（S3 递延）；drora-site 2（Node 内部断言 env_->execution_async_id()==0）。

## 台账 27：v3.18.0 S5 desktop 本体段有意分歧与平台修复（2026-11-13 登记，specs/upstream-v3.18.0-migration.md §4 S5；S6 UI 段消费 8 新桥 API 时对齐，S8 收口段重估 authored 例外与 D5 剩余面）

- **D5 裁决区执行（发行通道保本仓，MOD-ABSENT 不复活）**：①autoUpdater.ts 冲突块 applyManifestUpdateProvider 保 ours 删除侧（theirs 演进新增 resolveDroraJwtToken 选项不回接），InitAutoUpdaterOptions 残留的可选 resolveDroraJwtToken 字段保留为上游形状（无传参方，行为等价）；②main/index.ts 五块冲突中两块保 ours（initAutoUpdater 的 deviceMid/resolveEndpointOrigin/updateFeedSource/resolveDroraJwtToken 选项块、force-update gate 块）；③干净合入的 drorajwttoken 四处传参（help/rollout 配置 fetcher ×2、initAutoUpdater、force-update gate）与 autoUpdateCredentialService 声明一并剔除——上游侧该凭据属 manifest 链同族，剔除后 fetcher 回落匿名请求与本仓既有行为一致；④take-theirs 件 desktopContextPromptRollout.ts:91/desktopHelpConfig.ts:17 的 optional resolveDroraJwtToken 字段保留（上游文件原状，无传参方即匿名）。grep 门：packages/desktop 域 forceUpdateGuard/zcodejwttoken/manifestUpdateProvider/drorajwttoken 代码引用零命中（仅裁定说明注释）。
- **auto-update-source-security-smoke D5 通道语义适配（+四项平台修复，修后三变体 24 PASS）**：场景期望全部 trusted——上游 dev 场景期望 override 的 startup-config feed 覆盖机制（resolveUpdateFeedSourceFromStartupConfig）随 D5 删除，本仓 feed 由打包期 app-update.yml 钉死，任何 argv/env/direct/backend 注入都改写不了 feed（这本身是 D5 通道安全不变量）；鉴权断言改为 8×null（无 jwt Bearer 链，登录态不进更新通道）；manifest 凭据日志断言移除；fixture initAutoUpdater 传参去除 manifest 链三选项。平台修复：①win32 反斜杠绝对路径进 esbuild alias/onLoad 说明符即解析失败（toPosixSpecifier 归一）；②esbuild alias 对 `@drora/shared/<sub>` 前缀拼接到 index.ts 之后——改插件显式解析，子路径入口以 packages/shared/package.json exports 为单一出处（credential-security 等目录入口是 module.ts 非 index.ts）；③@napi-rs/keyring 平台子包（.node 二进制）external；④format=cjs 下 services/shared 13 处 createRequire(import.meta.url) 的 import.meta 被 esbuild 置空（本仓依赖图经 services 引入，上游图不含故未暴露）——onLoad 重写为 __filename/__dirname。NSIS 签名检查块补 updateConfigPath 重设（electron-updater configOnDisk 为 Lazy 单例，中途写配置不触发重读——上游 fixture 同样潜伏，重设走 setter 内部重建）。
- **双 relay/voice/CUA/pet 接缝保 ours（§1 例外 3 成套面）**：web-remote-relay/index.ts 双 relay 导出（buildWebRemoteControlEndpointUrls，上游树零命中自研件）与 theirs 新增 buildWebRemoteControlClientLanguageHeader 并集；webRemoteControlManager.ts 不在 S5 清单零触碰；main/index.ts 的 voiceTranscriptIndicatorWindow import/pendingVoiceIndicatorPreloadRef/droraDesktopPet.refreshLocale/cuaPipFocusRouter 全在位；preload 三块并集（宠物域 onDesktopPetOpenTask/publishDesktopPet/manageDesktopPets + 导航桥 2 API + showExtensionNotification）；desktopPlatform.ts 并集（宠物 2 成员 + 扩展通知 2 成员）；main.tsx 并集（modelCapabilitiesService: true + managedWorktreeService/extensionsService）；tsconfig.main.json include 并集（drora-extensions 自研域 + extension-host 上游新面）。
- **mcp-apps-host-e2e 演进回填**：上游把内联 modes 迁到新文件 mcp-apps-host-options.mjs 后补 obsidian-only 组（P5 沙箱页 e2e 独立分组，上游无此组）；resolveMcpAppsHostLaunch 新签名（第三参改 env 对象，容器 --no-sandbox 由模块内处理）适配时把本仓 DRORA_E2E_NO_SANDBOX 开关保留在 args 末尾；watchdog 并集（obsidian 720s 本仓 P8 + managed 180s 上游冷恢复）；agent.ts 的 mcpServers helper 重构并回时回填 demo?.protocolVersion 演进（helper 形参类型同步加宽，session() 的 demo 形参同款注释）。
- **prepare 双脚本并集**：prepare-runtime-assets 挂 prepare:windows-runtime-host（D3，win32 目标）而 prepare:windows-cua-helper 保本仓 build 链单独调用不回加（package.json build 序列分流）；prepare-agent-node-bundle 取 theirs design-plugin seed 块（S3 域 Electron staging 面，requiredSeedPaths 与 official-plugin-definitions 一致）+ superpowers 下线注释保 ours 删除态。
- **D3 本机构建实测（工具链非默认路径）**：VS2022 Community 17.14.37411 安装于 D:\software\Microsoft Visual Studio2022\Community（vswhere 实证；默认路径不存在）；CMake 用 VS 自带 3.31.6（CMAKE env 显式传入）。`node scripts/build-windows-runtime-host.mjs` 成功：MSVC 19.44 编译，产出 packages/desktop/bundled-tools/win32-x64/runtime-host/drora-runtime-host.exe（167,424 字节）+ build.json（source/binary sha256 清单）；`node --test scripts/test/windows-runtime-host-build.test.mjs` 3/3 绿。electron-builder extraResources 织入随 theirs 干净合入（bundled-tools→tools/runtime-host，:882-887）。**未跑**：host-acceptance.cjs 验收夹具——需 buildDir 内 adapter.cjs（树内无生产方，上游 CI 侧产物），如实登记不可执行。
- **EOL 假冲突（S1 台账 18/S4 台账 23 同族工具缺陷）**：17 件 conflict 全部落盘为整文件假冲突，按 clean-merge 同口径归一化重并后与 dryrun detail 块数逐件同数（合计 29 真冲突块）；conflict 分支补 normIfText 的工具修复仍待做（三轮战役连续命中）。
- **architecture 提前收口（S2 教训防御性，段门本不含）**：①desktop-microphone-access 模块逐字照搬（上游 policy 1511-1523 行）；②上游两条例外逐字照搬（browser-device-presets-export-unmanaged-new-files 含 desktopCaptureBrowserGuestPage.ts、browser-design-preload-bridge-unmanaged-new-file 含 embeddedBrowserDesignBridge.ts；其余 ui/browser-use 路径为 S6 域预登记，文件落位前不生效）；③authored 一条 cli-vitest-config-unmanaged-new-files（adapters/contracts/core 三包 vitest.config.ts，S4 段门 esnext/testTimeout 修复件，上游无对应文件）；④source-server-management-unmanaged 扩两路径（host/sourceServerConnectionManager.ts、sourceServerReleaseResolver.ts，上游 policy 同样无登记，S8 adopt 收口重估）。修后 `pnpm architecture:check --changed` violations: 0；governance 测试 25/25。

## 台账 28：v3.18.0 S6 UI+i18n 段有意分歧与口径勘误（2026-11-14 登记，specs/upstream-v3.18.0-migration.md §4 S6；S7 测试重组段按 D9 同因果收口 22 测试删除时联动，S8 收口段复核 i18n parity 命令注册）

- **agentsTeamEnabled 开关保留裁定（任务「4 设置开关」第 4 项的证据驱动偏离）**：任务行与 §4 S6 所指「4 设置开关」在 SettingsPage 冲突块中对应 toolGroupingExplore/agentsTeam/toolGroupingTerminal/toolGroupingChanges 四 useState——实测前三个为 base 既有（上游 v3.18.0 已删，D9 跟随删除），agentsTeamEnabled 为 Drora 自研域新增（base-transformed 无此键、i18n settings.agentsTeamEnabled{,Description} 两键属 drora-only 保留集、shared protocol.ts 字段在库（S1 重放 agentsTeam 字段）、CLI create-app.ts agentsTeamSetting 灰度门 S4 在位）——按 §1 例外 3 自研域物理隔离精神整块保留：开关/handler/trace 目录项/i18n/search 索引五面全保，并重放接入上游新 AgentBehaviorSectionContent 分区（props+类型+SettingsRow）与 settings-search 索引（settingsSearchIndex.ts 登记 settings.agentsTeamEnabled，section=agentBehavior）。
- **i18n「62 键」口径勘误（实测 41）与 ja/ko/ru 上游漏删清理**：键集对账实测上游删除集=41 键/语言（D9 面 30：toolGrouping×6+cua.group×5+executeGroup×5+changesGroup×5+explore.bucket×9；另 11 键上游自有清理（chat.queue.edit*/confirmDialog.taskArchive*/conversationShare.readonly*/imageEditor.eraser/settings.mcp.host.*/settings.plugins.toggle.pending）全采）；spec「+575/−62」为计划期近似，实测 en +554/−41、zh +553/−41。上游 ja/ko/ru 三语新文件自带 D9 死键 38 键/语言（en/zh 已删而三语漏删，含 .few/.many 复数变体）——S6 补删 38×3，终态三文件 grep 零命中；该缺口为上游清理遗漏，后续上游同步时若三语文件重落需复扫。
- **en/zh 键全集重建形态（可重放脚本化，非手工编辑）**：theirs 全量底+teamMessages spread 回接+Drora-only 追加块（ours−base 键集 en 521/zh 525，块头注释载「勿手工增删、上游合并按本块整体对账」管理规则）+两侧同名键 3/2 处取 theirs 文案+Drora 改值键 2 处 in-place 覆写（quickPick.command.personalization/settings.personalization.title→自定义指令）。en-US 1 处 TS2783（drora.error.modelSuspiciousEmpty 与尾部 requestSecurityMessagesEnUS spread 重复）删字面置写交 spread 提供。parity 脚本落位 packages/ui/scripts/check-i18n-key-parity.mts（en↔zh 对称差 0 为硬门，三语缺口族清单打印供登记）。
- **ui typecheck 脚本补齐（S3 台账 22 第 5 项同款）**：ui 包原无 typecheck 脚本（仅 lint），段门命令 `pnpm --filter @drora/ui typecheck` 原样命中 ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT——补 `"typecheck": "tsc --noEmit"`（S8 重放 ui package.json 冲突块时保留该行）。配套工程事实：ui→design-runtime 工程引用需 design-runtime dist 声明（S3 落包后首次被消费，tsc -b 补产）+pnpm install --no-frozen-lockfile 收敛工作区链接（package.json theirs 侧新增 @drora/design-runtime/@drora/provider/@drora/rpc 依赖）。
- **conflict 三处结构修复（union 边界残缺，非语义分歧）**：①WorkspaceShellLayout else 分支（automations ternary 的 chat 侧）缺外层 `</div>`——ours 的内层包装 div 结构与 theirs 的新 ternary 链在块外上下文错位；②message.tsx theirs 侧 messageRehypePluginsWithReveal useMemo 缺收尾 `);`（shared tail 的收尾被 ours 块抢占）；③pluginUiHostControllerContract theirs 侧 JSDoc 缺 `/**` opener（opener 被 ours 侧共用消耗）。三处均按两侧原意补齐闭合，零语义取侧。
- **RemoteConversationTimeline onEdit 契约对齐（Drora 独有文件适配上游演进）**：上游 v3.18.0 把行内编辑迁入 composer-edit-mode，ConversationRowView 的 UserInputEditHandler 收窄为单参 begin-edit（(target)=>void）；本仓远端回放组件的多参签名（newText/attachments/workspaceMode）在该接缝不可达且全仓无活跃消费方（grep 实证仅 dist 陈旧产物与注释引用）——对齐单参契约并注释载因。若后续远端回放需要恢复多参编辑流，走该组件自有通道重设计，不回改上游行级契约。
- **段门第 1 轮两根因收口（2026-11-14，台账 28 补录）**：①web/main.tsx `installDocumentHiddenMotionPause` 断链（S6 delete 桶删 ui/src/lib/documentHiddenMotionPause.ts，上游删除、ours==base；web 入口为 S8 域未合并旧形态）——按上游终态桥接移除 import（:21）与调用+注释（:222），theirs web/main.tsx 零引用+`data-document-hidden` 全源面零消费者双实证；docs/performance/hidden-document-motion-pause.md 陈旧文档留 S8 check-stale-doc-phrases 收口。②D9 三键删除的 e2e 类型面连带（tsconfig.e2e 在全仓 typecheck 链内，5 件 TS2353）——提前删除 5 件 D9 死测试（changes-group-responsive-file-summary/-unresolved-path、tool-group-reasoning-visibility-boundary、tool-groups-history-restore、tool-stage-grouping-live-transition，逐件 theirs 缺席=上游已删，S7 delete 桶对已删文件 no-op）；第 6 件 tool-group-settings-persistence.test.ts 类型检查通过（仅运行时引用 :101-103）留 S7 22 测试同批。修后 `pnpm typecheck` exit 0 / error TS 0。
- **段门第 3 轮五根因收口（2026-11-14，台账 28 补录；test:drora 13 败→0）**：①S7 一致性集跨段预落——e2e-formal-spec-selection.{mjs,d.mts}+e2eAllCoverageRunner/e2eSpecAdmission.test.ts（S7 take-theirs）+installer-preserve-files.nsi（S7 take-theirs）+legacy-self-manifest-uninstaller.nsi（S7 new）：S5 已落 json/脚本与 S7 未落模块/测试/夹具的撕裂面按 theirs 预落归位；e2eSpecAdmission 两断言按 pre-S7 文件树过渡适配（smoke.test.ts 根路径+conversation-session 平铺，S7 重放 take-theirs 时随上游原子路径恢复）。②makensis `/INPUTCHARSET UTF8` ×4 调用点（上游夹具中文注释+无 BOM，中文代码页 Windows 按 ANSI 读报 Bad text encoding；探针 raw FAIL/旗标 PASS/BOM PASS 三态实证，取旗标保夹具字节原样）。③**清单缺口**：packages/ui/src/assets/Z.svg 上游新资源在 5847 行清单零行覆盖（5 件 ui 测试收集失败的 root cause），从 theirs 补落——S8 收口时建议对 check-segment-coverage 做二进制新文件复核。④IntlProvider `<html lang>` effect 补 documentElement 守卫（Drora ui 单测 node 环境部分 document 桩；上游仅守 typeof document）。⑤三件 Drora SessionPane 测试桩对齐（useDraftConfigControl mock 补 composerDraft 最小形态+services 桩补 oauthService/highspeed getCurrentOwnerKey/droraAgentService.onAgentRuntimeExited——上游新消费面 mount 期触达）。修后 pnpm test:drora 277 文件/1932 用例/0 败全量复跑。

## 台账 29：v3.18.0 S7 测试重组段冲突处置与口径勘误（2026-11-14 登记，specs/upstream-v3.18.0-migration.md §4 S7；S8 收口段复核段门全量与 82-id adopt 时对齐）

- **apply 工具 conflict 分支 mkdtemp win32 缺陷（S1 台账 18 同族遗漏面）**：apply-segment.mjs conflict 分支 `mkdtempSync("/tmp/apply3-")` 在 win32 解析为 `D:\tmp\`（不存在）→ 17 件 ENOENT 未落盘（工作树保持 HEAD）；clean-merge 分支 S1 修复时改走 `os.tmpdir()` 但 conflict 分支未同步。处置=mkdir D:\tmp 后幂等重跑（take-theirs/new/clean-merge 重写同内容、delete no-op、conflict 落标记底稿），计数与预演一致。S8 后续段如再触 conflict 分支沿用此预热。
- **conflict 17 逐块全 theirs（25 真冲突块，归一化重并后与 dryrun detail 逐件同数）**：①8 件 docs/testing md=上游文档重组（spec 路径迁新目录+计数 221→232+旧执行记录清理，theirs 保留 2026-10-28/29 更新记录），ours 侧差异全为 oxfmt 表格对齐+旧值（md 不门禁先例，禁 fmt:fix）；②4 件 fixtures json=上游断言演进（anthropic-reasoning whitespace/retry 断言重写、running-send-now 删 lastUserMessageIncludes）+ReadSessionContext 面 matcher 删除（S4 ReadTopicResource 净迁移同因果）；③e2eWorkerIsolation 5 块+devStartupReadyState=纯路径迁移（conversation-session/{background,models}/ 子目录）+上游新断言（extension-host ready 标记）；④run-windows-e2e-shards.mjs import 行=theirs 新接口（isFormalSpecAdmittedByEnvironment+normalizeE2EDesktopBuildEnv，配套 S5/S6 已预落的 theirs 版 selection/ensure 脚本）；⑤subagent 两件（helpers/subagent-config-proxy.mjs+subagentConfigProxy.test.ts）=上游官方实现接管本仓 S2 win32 ESM URL 修复（theirs 注释明载「WDIO 以 file:// URL 注入预加载（Windows 不接受裸绝对路径），这里按同一形式剥离」，注入端统一 URL+剥除端单形态；本仓 HEAD 四形态兼容超集退役，AGENTS.md 官方实现优先），重放后 subagentConfigProxy.test.ts 6/6 绿。
- **wdio.conf.ts 桶位勘误（任务/conflict 口径 vs 实测）**：任务步骤与 §4 S7 行述「conflict 17 含 wdio.conf.ts」——实测 inventory wdio.conf.ts=clean-merge（不在 17 件内），三方合并已自动保留 Drora 双块：applyAgentsTeamEnvForWorker（:971 定义+:4998 调用）与 appId 豁免注释（:1541-1543「appId=zcode 不得写作 drora」rename 规则 0 豁免区）；`pnpm --filter @drora/desktop typecheck:e2e` 工程含该文件（tsconfig.e2e include:14）exit 0。按 inventory 实测口径执行（§7-9 纪律），Drora 保留块零丢失。
- **DEL-KEEP 44 三级判据筛语义（canonical：strip 空白→归一化尾随逗号→引号/括号/分号格式）**：40 件纯 oxfmt 格式噪音（本仓 pretier 尾随逗号 `},)` vs base `,}` 等）+1 件断言重复无行为差异（send-message-resume-stop：ours 侧同一断言双行+两处换行重排，theirs 新路径 :104 单次正常形态）→41 件跟随上游删除；3 件真语义重放至上游新路径：feedback-upload-privacy（fieldLabels[index] ?? "" nullish 收紧，新路径 feedback/upload/）、web-remote-control-auth-gate（自研 LAN/配对栈删除守卫块 14 行：select 不存在+五个 preload 旧方法零暴露断言，新路径 remote-control/authentication/manual-review/pending/）、remote-login-v2（appId 断言「drora」→「zcode」+rename 规则 0 豁免注释——**变换树 transform 曾把该 wire 值误改名**，新路径 :334 现场修正，wdio.conf.ts 同族契约漂移）。44 件旧路径全部删除（deleted=44/missing=0）。
- **「91 本仓独有」口径勘误（实测 86=desktop 31+ui 33+web 22）**：desktop 域 basename 口径实测 31 件（desktopPet×9/voice×5(含 doubaoAsr)/agents-team e2e×4/pets×4/自研单件×9），spec 名义 36 为 S7 切段计划近似（计划原文未落库不可复核）；对账恒等式：HEAD 独有 53（desktop basename 口径）− 22（D9/退役同因果删除：toolGrouping 系 7 组死测试×3 副本+conversation-session-tool-groups.ts helper，与 S6 台账 28 第 1 轮 5 件预删衔接）=31。86 件 keepOurs 原位保留（上游目录重组不迁移自研件——e2eSpecAdmission 准入 glob 实测不拒本仓独有旧路径，四件套+admission 5 文件 54 用例全绿为证）。S8 收口段如需精确复刻 91 口径，以本条 86+22 实测为准。
- **generate-drora-test-files.mjs 收敛与 explicit 15 件补录（glob 盲区回归修复）**：重跑收敛清单（+20 本轮 S1-S7 各段新测试：session-control 7/drora-extensions contract 2/desktop 新 9/plugin-api+server 各 1），但把 HEAD 清单的人工增补面 15 件洗掉（apps/drora-cli obsidian-plugin 5+ui/src 内嵌 10：drora-persona 3/plugin-ui 3/model-capabilities 3/mcp-apps 1——均不在 `packages/*/test`、`ui/src/voice`、`contract.test.ts` glob 通配内）——15 件全部现存（existsSync 实证），补进脚本 explicit 数组（注释载因，baseline-gap#3 同族防孤儿化），重跑 lost=0/gained=20/drora=300，二次重跑 diff 稳定（幂等）。**LEDGER 判定：v3.17.1 upstream-ledger.tsv 无需更新文件**（retiring 排除集与现存文件求交幂等，本轮退役走 inventory+本台账体系且已物理执行；脚本 retiringTotal=1926 报告值不变）。
- **段门第 1 轮五败收口（2026-11-14，台账 29 补录；根因单一=S7 新测试先行、被测基建在 S8 域未合并的跨段前向断链，S6 段门第 1/3 轮同款）**：①desktopE2EContainerScript（verified preset 断言空串败）←预落 scripts/test-desktop-e2e-container.sh（S8 take-theirs，CONVERSATION_SESSION_VERIFIED_E2E_SPEC=25 个 conversation-session/workflows/ 新路径，bash -n 过）；②radixMenuListenerPatch ×2（node_modules bundle 无幂等 remove 败）←预落 patches/@radix-ui__react-menu@2.1.16.patch（S8 new）+ root package.json patchedDependencies 增 react-menu 行 + `pnpm install --no-frozen-lockfile` 应用（10.4s，react-menu 2.1.16 本已在装，dist/index.{mjs,js} removeEventListener 各 5 处实证 patch 生效；pnpm-lock.yaml patchedDependencies 段同步，S8 frozen install 复核）；③rendererTypecheckCoverage（根 typecheck 工程闭包缺 renderer 面）←root package.json typecheck 的 tsc -b 列表按 theirs 加 `packages/design-runtime`（shared 后）+`packages/desktop/tsconfig.renderer-services.json`（host 后）+`packages/plugin-api`（尾部），本仓自研面（relay-v2-server×2/tsconfig.pet.json/apps/drora-cli bootstrap 三段命令）保留——**S8 收口 root package.json（conflict 桶）时与本次预落 hunk 去重**（S2 治理 hunk 责任块模式）；④stdioTapCredentialRedaction（tap 日志明文 secret 败）←预落 scripts/dev/drora-stdio-tap.mjs（S8 take-theirs，:116-128 interaction/requestCredentialCipher 请求 params/回复 result 整体 `<redacted>`）。修后复跑：4 文件 11 过/3 跳全绿（container 3 跳为既有环境条件）；`tsc -b packages/desktop/tsconfig.renderer-services.json`=0（新增工程即时编译验证，S2 段序教训防积压）；四件套回归 40/40。S8 联动：三件预落文件+typecheck hunk+patch 行共五处，S8 重放时 take-theirs/no-op 或 diff 去重。
- **段门第 2 轮一败收口（2026-11-14，台账 29 补录；drora-fork-isolated pluginE2EAdmissionScripts「dry-runs promotion」）**：根因=win32 路径分隔符——promote-plugin-e2e.mjs（S5 take-theirs）:94 的 dry-run actions 输出 `Move ${relative(...)} -> ${relative(...)}` 未做正斜杠归一化，win32 下 relative() 返回 `packages\desktop\...` 反斜杠，测试断言（S7 take-theirs，:111 `toContain(" -> packages/desktop/...")`）败；同文件 :55/:103/:110 三处本就有 `.replaceAll("\\","/")` 归一化，:94 为上游遗漏行（POSCI 下测试恒绿，win32 显形——S2 --import/S5 INPUTCHARSET 平台修复同族）。修复=:94 两处 relative 补同款归一化（中文注释载因），node --check 过；修后 `pnpm exec vitest run --project drora-fork-isolated` 全套 **24 用例 18 过/6 跳/0 败**（6 跳=cdnPreloadScript 既有环境 skip）。上游同步提示：该行属上游脚本遗漏，上游若后续版本自行修复则以 theirs 为准对齐。

## 台账 30：v3.18.0 S8 文档+根配置+web+生成物段收口与有意分歧（2026-11-14 登记，specs/upstream-v3.18.0-migration.md §4 S8；全战役终段）

- **应用计数对账与 11 重叠件保全**：apply-segment S8 → take-theirs=262/new=55/clean-merge=75/delete=1/decision=14(zone-decision)/conflict=35/keep-ours=9/error=0，与预演逐桶一致。apply 前 11 件工作树重叠全副本备份（Temp/s8-preapply-backup）；conflict/clean-merge 分支 ours=HEAD blob 会覆盖 S2-S7 已落 hunk——.oxlintrc（clean-merge 实证保住 S2 session-control override +86 行）、CONTEXT.md（take-theirs 丢 S6「扩展宿主与插槽」节→重加 +21 行）、package.json/architecture-policy/main.tsx（以备份为 ours 重并）；scripts/drora-stdio-tap.mjs、test-desktop-e2e-container.sh、react-menu patch 三件预落件与 theirs 逐字节相同（重写 no-op）；communityUrl/webRemoteControlTransport/conversationSharePreviewClient 四件桥接由上游正式实现接管（S6 桥接注释自述预期）。
- **conflict 35 处置（33 归一化重并 + snapshot regenerate 替代手工）**：33 件（除 package.json 前置解决、upstream-snapshot.json 外）按台账 18/23/27/28 同族先 LF 归一化三方重并——hunk 数与 dryrun detail 逐件同数（main.tsx 3 vs 1 为备份侧 S6 修复增面、architecture-policy 10 vs 5 为 S2-S5 policy 增面，均已裁定吸收）；docs TW 面全 pattern＝ours oxfmt 宽表 vs theirs 上游演进（superpowers 8 件全为 S7 e2e 子目录路径迁移→取 theirs；launch/authoring/presentation/model-io/office-file-preview/chat-message-queue/mr-1466/openrouter/desktop-context/windows-installer/drora-protocol 均上游内容演进取 theirs）；逐块非取 theirs 的裁定：.gitattributes＝ours 全量规则+theirs design-plugin 三条（vendor/** 被 ours assets/** -text -whitespace 覆盖，ours 注释明载）；conversation-session-case-catalog＝union（ours Persona v5/Agents Team 节+theirs SCT 会话控制工具节，同锚异容）；builtin-plugin-icons＝theirs 新段落+computer-use 行保 ours `assets/drora-cua/icon.png`（本仓 featureSuggestedPrompts.ts 实际资产名，transform 对 docs 内 zcode-cua 未改名的现场校正）；settings-personalization＝theirs e2e 新路径（settings/agent/，S7 已迁移实证）+ours「自定义指令」标签（本仓 i18n 改值键，e2e 断言同词）；feature-graph 两 hunk＝union（ours persona 节点/边+theirs archive-permanent-deletion 节点/边）；generate-large-task-fixture 两 hunk 取 theirs（bash_shell_selection 上游删除实证 base:106、workspace_id null+session-lineage-invalid 修复注释）；main.tsx＝core-js polyfill 块置顶（上游注释要求最前）+resolveHostedRemoteRelayUrl 自研 import 保留（:837 用法在合并公共区存活）+其余两 hunk 取 theirs（S6 桥接注释随上游终态移除）。upstream-snapshot.json 301 假 hunk 不手工解决，以 regenerate 重建。
- **D8 落地与版本适配**：.oxlintrc 三 override 经 clean-merge 自动落位（hooks rules-of-hooks=error/exhaustive-deps=warn、7 例外文件降 warn、session-control 禁导入），7 例外路径与本仓路径逐字同形（实测 EXISTS ×7）无需重映射；AGENTS.md 一条款 clean-merge 落位（:49，自研节全保）；react-hooks-lint.test.mjs 上游版断言 `eslint-plugin-react-hooks(...)`/`eslint-plugin-unicorn(...)` code 前缀为本仓 oxlint 锁定版 1.81.0（v3.17.1 收口钉版）所无——按本仓工具链适配三处 code 字面（react-hooks(...)/unicorn(no-useless-spread)），断言语义（severity/插件保留/例外降级）不变，适配后 4/4 绿。
- **architecture-policy 收口（82-id 口径勘误+全局去重）**：实测 adopt 需求＝36（modules 侧 30+exceptions 侧 6 形态）而非名义 82——S1-S7 各段治理 hunk/例外已提前收口其余（spec §4 S8 行的「82 全量 adopt 重放」按段内责任块前置消化）。10 冲突 hunk 裁定（mcp-ui+sample-model 与 requires 演进取 theirs、S1 残留注释保 ours、四组同锚异容 union、hunk8 去 design-plugin-third-party-resources 重复）；**全局去重删 34 份 theirs 插入副本**（8-id 前科机制的全量形态：merge-file 把 theirs 新条目插入公共区而 ours 原位同 id 条目保留→同 id 双份；29 份差异仅 ours 登记注释/尾空行、5 份为条目边界伪差异，kept 形态=上游逐字稿）+补 adopt 1 id（opensource-cua-test-project-config）。终态 **277 ids / 135 managed / 0 重复 / 上游差集 ∅**（上游 228 全覆盖+本仓 49 自研/authored 保留）；module.ts 两处补齐对齐上游 policy（project-storage+migrations.ts/prepared.ts、resource-manager+`../processResourceSampler.ts` 跨根相对名，manifest-policy-mismatch 清零）；2 件过渡态 authored 例外（EditConnectionProfileDialog/SourceServerManagementPanel：均为上游既有文件、分支相对 merge-base 新增面+未提交中间态 snapshot 无法 admitted，提交后 regenerate 重新接纳即可核删）；snapshot regenerate 显式 `--upstream refs/upstream-trees/v3.18.0`（files 24338/introduced 2609；**index 基快照——用户 commit 后需再跑一次**纳入本轮全部新文件，否则新文件落入 unmanaged 面）。
- **pnpm-workspace 拓扑仲裁＝保 ours 拆分**：不加回 theirs 的 apps/drora-cli glob 三行（3f8f2e63b 既有拆分裁定，本仓 pnpm-workspace.yaml 不在本轮清单零动作）。后果登记：root package.json 的 build:sea:prepare（theirs 逐字，S4 预落）内 `--filter="{./apps/drora-cli/packages/*}..."` 在根 workspace 无匹配——S4 台账 24 遗留的 build-sea 两用例继续未决（补齐需 CLI 入根 workspace 或脚本按拆分改写，均超机械合并面）；provider:regression 保 ours `--dir apps/drora-cli exec turbo` 形态（base 同款过滤形态在本仓拓扑不可解析）。
- **licenses 面三重既有断裂收口（全部 pre-existing：v3.17.2 拆分后 notices 从未重跑，HEAD NOTICES 仍是 rrweb@2.0.0 时代）**：①21 包缺完整许可证据→新增 override 84→70 条收敛：rrweb@2.1.6 五件套+@next/env+@next/swc×9 以真实上游 LICENSE 补（raw.githubusercontent 拉取，rrweb@2.1.6 与 2.0.0 材料 sha 相同=字节全同实证）、client-only@0.0.1（MIT）与 @img/sharp-libvips-*@1.2.4×6（LGPL-3.0-or-later）按 third-party/README.md 既有口径以标准条款补（libvips 仓库 LICENSE 为 Apache-2.0 系构建脚本许可、不代表 LGPL 二进制，未采用）；②19 条 stale override 清理（14 件 CLI-workspace 依赖=拆分拓扑退出根扫描面：unsafe-pointer/quickjs-wasi/@ai-sdk/provider-utils×2/parse-bmfont-ascii/omggif/@tokenizer/token/react-devtools-core/exif-parser/rrweb@2.0.0×5 + 5 件 prod 图漂移 yaga-layout/http-mitm-proxy/semaphore/boolbase/keyv）+quickjs-wasi embedded 退出——**CLI workspace 依赖通知随拆分退出 THIRD-PARTY-NOTICES.md，双锁文件补扫属后续工程项**（上游根 workspace 含 CLI 无此问题）；③native-search pin 陈旧（b3e44cb2a 配置演进未重钉，版本键零改动实证→pin 更新为现值；上游自身 pin 同样与其文件不匹配=floating 状态）。checker 修复一处：Apache 4(b) 文件内修改声明接受 `Modified by ZCode:`（design-resources 等逐字节还原资产被 sha256 溯源钉住不可改写，仅认 Drora: 会永久红；本仓自改文件仍 Drora:）。终跑：notices 1118 版本/21 copied 组件/18 native 归档/3414059B，check 过（2092 实装包；20 reviewRequired 项为 README 既有在案口径）。
- **copied-components 收口（S3 台账 22 第 4 项执行）**：8 条设计域新条目 adopt（open-design/html-ppt/Zara Zhang/frontend-slides/gstack/brand-guidelines/frontend-design/taste-skill），上游 manifest 路径未过 drora 变换（third-party 溯源区 transform 跳过）→roots/modifiedFiles 全量 `apps/zcode-cli/`→`apps/drora-cli/` 改写（18 处）；agent-browser 对齐上游 v3.18.0（上游已删 electron 技能→roots/modifiedFiles 去 electron、id 回「(including dogfood)」；HEAD 侧曾含 electron 系 S7 前本仓自身演化，.agents/skills/electron/SKILL.md 随 S8 delete 桶删除、空目录清理）；另修 3 处陈旧路径（bash-command-registry/superpowers-plugin LICENSE/zcode-protocol-v4→drora-protocol-v4）；8 份 zone-decision 上游证据 txt 从 theirs 树补齐（sha256=文件名自校验过）。终态 21 条目、全部 roots 在位（os.path.exists 全过）。
- **drora-builtin.json 键级三方（S4 联动验收）**：12 键 head/base/theirs/now 四方同集零漂；revision 43→44 与上游模板演进取 theirs（gpt-6-terra 等）；wire URL（zcode.z.ai/api.z.ai 全族）与 theirs 同集同形（transform 未误改名、clean-merge 未扰动）；drora-builtin.test.json 同步 rev 44。
- **docs/ZCode 防双份**：`git ls-tree HEAD docs/ZCode`＝0（gate 原样成立）、全树 grep `docs/ZCode` 引用仅 spec 自身、campaign 清单零 ZCode/Drora 路径行——无双份风险，零动作。
- **段门实测（2026-11-14）**：`pnpm install --frozen-lockfile` 过（先 --no-frozen 补 packages/web core-js@^3.51.0 锁行）；全仓 `pnpm typecheck`＝exit 0；`pnpm lint`＝0 error/827 warn（既有 443+D8 exhaustive-deps warn 面，7 例外降 warn 生效）；`pnpm test:architecture`＝61 过/1 跳（win32 既有）/0 败；`pnpm architecture:check --changed`＝violations 0；`pnpm docs:stale-phrases:check`＝2427 文件 0 陈旧；licenses notices+check 过；notices 测试族 13/13；web `tsc -b packages/web`＝0；全树冲突标记复扫 0（NOTICES 内 1 处 `=======` 为许可文本 setext 标题，HEAD 同款）；`pnpm verify:pre-push` 如预期于 check-push-worktree 失败（树未提交，硬纪律 1 禁 commit），其链分量逐项直跑：check-vault-extraction-residuals OK（8738 文件）、check:e2e-remote-targets skipped（私有队列缺席=既有环境条件）、lint/stale/db:schema/test:architecture/architecture:check 各自过；test:engineering:affected --scope push 因同款干净树前置不可跑——**两项留用户 commit 后由 workflow/用户复跑**。未跑（留 workflow 全量门）：pnpm test:drora、drora-fork-isolated。
- **test:drora 终验唯一红项收口（2026-11-14，台账 30 补录）**：终验全量 297 文件/2094 过/25 跳全绿但带 1 unhandled rejection（Errors=1 退出码 1）——`packages/web/test/webRemoteControlHttpContract.test.ts`「routes real workspace/view requests ... rejects a stale connection」用例。归属判定：整条异步链为上游 v3.18.0 原样携带（`git diff refs/upstream-trees/v3.18.0` 实证 transport/entry/authService/repo 四文件仅 zcode→drora 改名，行号一致）：stale 连接被 relay 401 拒绝→`webRemoteControlTransport.connect:191`→`enterTerminalFailure:633`→main.tsx `onFailure:1269`→`renderBootstrapFailure:1029`→`webRemoteControlEntry.ts:338` **fire-and-forget `void this.switchAccount()`**→`:358 await auth.logout()`→`webAuthService.ts:307`→`clearSession:224`（桩 navigator 无 locks 走同步分支）→`browserOAuthCredentialRepo.clearAll:353 window.dispatchEvent(...)` 在测试 window 桩上抛 `TypeError: window.dispatchEvent is not a function`，链路未被 await 即成 unhandled rejection。测试文件本身为本仓 S8 自研（上游 `packages/web/test/` 仅 manual-review e2e .mjs，无此文件）。**处置＝测试桩缺口补齐而非改上游实现**：生产浏览器恒有 `window.dispatchEvent`，缺陷面是本仓测试 window 桩少该方法；stub 补 `dispatchEvent: vi.fn()`（测试内中文注释载上游证据链）。**上游弱点登记不修**：`void switchAccount()` 浮动 promise 意味着真实浏览器上 logout 链任何异常同样会成为 unhandled rejection——属上游实现固有形态，按「还原文件仅修还原错误」纪律不动，上游后续若自行补 catch 以 theirs 为准。修后定向复跑 1 过/0 error。
- **（2026-11-14 追记）@ai-sdk 两 patch「按本仓既有删除保持」项废止**：本台账上文根 package.json 语义合并条目所载「@ai-sdk 两 patch 按本仓既有删除保持（base 有而 ours 删、theirs 未动）」（specs/upstream-v3.18.0-migration.md:317）经 05-remaining-gaps §2.2 K4 复核裁定推翻，patch 已回收登记——详见台账 34。


## 台账 31：v3.18.0 全批终验收口与三项归因（2026-11-14 登记，主会话终验七门之后）

- **终验七门（/tmp/v318-final-verify）**：typecheck/lint/test:architecture/fork-isolated 四门绿；三红项全部归因收口如下。
- **cuaLazyLaunchBridge ×2（darwin 宿主假设既有项，非合并回归）**：A/B 实证注入链零内容变更（node.ts/cuaStandaloneStatusLaunch/drora-helper-locations/broker-server 均 git diff 空）；docs/cua-restoration-manifest.md 第八十轮（win32 W1，2026-11-11）已记档同两条为"darwin 路径断言在 win 宿主的平台敏感项"。机理：R1.2 用例锁 darwin 桥接面但漏传 `platform`（契约注释明示测试注入面，姊妹用例 R1.2.2 win32 面传了）→ win 宿主缺省落 win32 recipe 空桥接；R1.2.1 期望 posix 硬编码字面量而产品 win 宿主按 node:path join 反斜杠。修复=测试侧（补 `platform: "darwin"`×4 + installedPath join 派生，产品代码/R3 冻结区/ZCODE_CUA_* 键名零改动，中文注释载因）；定向 7/7 绿。
- **permission-service-write-tier ×2（v3.17.2 漏账，安全语义待用户终裁）**：A/B 实证（文件级备份→HEAD 版复跑同败→恢复）非 v3.18.0 合并引入——`git diff HEAD` 对 service.ts 仅 +10 行（confirmationHandledByTool 面，不触及该两用例流向），且 plan 闸门段（mode.plan.mcp ask / readOnly 过闸）自 b3e44cb2a（v3.17.2 合并）即在。**根因=v3.17.2 合并把上游 plan-MCP 宽语义（readOnly MCP 过闸+非只读 ask no-always-allow）带进来时，与本仓 S03 write-gating 安全门测试期望（plan 模式第三方 MCP 恒 deny `mode.plan.nonReadOnly`）冲突未被发现**（v3.17.2 验证时 test:unit:node 未跑出该两条或漏记；W1 记档"2 失败"仅 cua 两条口径）。两案待裁：A=恢复 S03 deny 门（本仓安全 spec 优先，改 checkPlanMode 对第三方 MCP 先 deny 再谈上游语义）；B=采纳上游 ask 语义并改两条测试期望（官方对齐优先，S03 spec 需修订）。裁定前维持现状（红），不擅自改语义。
- **knowledgeMigration ×1（Vault 抽离遗留既有）**：obsidian-plugin 包工作树零改动（git status 空）定向复跑同败（"应 failed 且回退恢复全部已搬文件"）——4c9be763b（Vault 能量抽离官方插件化）遗留，非本战役范围。
- **test:drora 终验红项已修**（见台账 30 末条）；修后全量 EXIT=0（2094 过/25 跳/0 错误）。
- **test:unit:node 修后预期终态**：371 测试 360 过/8 跳/3 既有败（permission ×2 待裁 + obsidian ×1 遗留）——按 S4 终局口径（非既有且非上游携带=0）达标。

## 台账 32：v3.18.0 终验 test:upstream-cli 三红轮归因与修复（2026-11-14 登记；7 包 exit 1 → 复跑见末条）

- **A 类（上游携带 skip）复核**：session-store-permanent-deletion（8 tests | 6 skipped 过）与
  provider-builtin-tool-rounds（mcp 变体过滤后 13 tests 过）均不在失败面，台账 24 skip 生效。
- **testTimeout 配置位修复（影响面最大的一件）**：四包 vitest.config.ts 的 `testTimeout: 15_000`
  写在根级——vitest 只认 `test.testTimeout`，被静默忽略（探针实证：6s 用例按 5s 默认超时），
  台账 25 声称的 15s 从未生效；bootstrap 整包并行 153 败的大面积 "Test timed out in 5000ms"
  即由此而来。移入 test 段后 bootstrap 26 文件/153 败 → 7 文件/10 败。
- **工具级/合并缺口修复（中文注释均在文件内）**：①bootstrap plugins.test pluginCount 16→17 ×2
  （S3 design 并入漏改）；②official-plugin-definitions drora-site 0.5.0→0.5.1（上游自带
  def/package 漂移，本仓三处一致门拦下，def 对齐实际包版本）；③cua-seed-completeness await
  适配（resolveOfficialPluginRootes 已 async 化）；④protocol-slash-commands：vi 导入缺失
  （HEAD 同败）+ pluginDiscovery 空桩与 site-* 期望自相矛盾（去桩保留存储隔离）+ v3.18.0
  site-analytics 新命令补录；⑤bundled-skills dynamic-workflows SKILL.md CRLF→LF（违反
  .gitattributes eol=lf 钉定，上游 blob 为 LF）；⑥design-plugin：.gitattributes 补
  SKILL.md/references/*.md eol=lf + 工作树归一 + 规则层清单 win32 分隔符归一 + 4 个
  SessionStart hook 用例 win32 PATH 适配（POSIX 字面 PATH 在 win32 解析不了 sh.exe）。
- **core 修复**：①behavior-gates census 17→19（runtime-reminders:289 战役前漏登 + runtime-tools
  :85 includePluginDiscovery v3.18.0 新门，逐点复核 teammate 继承后 FROZEN_GATES/spec §9 同批）；
  ②DRORA_KNOWN_TOOL_NAMES 补 v3.18.0 新增 15 工具（会话控制 12→新 family session-control、
  ReadTopicResource→session-context、SearchPlugins/SuggestPluginInstall→plugin）；
  ③mcp-tool-bridge 播种键修复（socket 键为还原区冻结 wire 值 ZCODE_CUA_PERMISSION_BROKER_SOCKET，
  测试此前用 DRORA_ 字面量 → 半组凭据 fail-closed、投影恒不生效，HEAD 同败；改用导出常量）；
  ④context.ts readProjectMemoryIndex indexPath 归一（沿 resolveProjectMemoryRoot 既有约定）；
  ⑤read-text.ts token 上限部分视图分支漏归一（modelPath 约定 HEAD 即漏）；⑥subagent runner
  完成序恢复 Drora 侧序（上游 v3.18.0 先标 completed 再写产物，翻转了「产物未落盘不得
  completed」不变量，上游自身无此用例）；⑦subagent-explore 夹具 id 文件系统安全化（JSON 串带
  win32 非法字符，HEAD 同败）；⑧bash-permission expectedByMode 定义未消费（HEAD 同败）；
  ⑨bash-command-permission-policy 整工具 allow 断言按 S03 洞 3 有意分歧适配（上游新测试
  断言恒短路语义）；⑩bash-handler/runtime-compact/tool-executor-read-deny-probe/
  post-compact-file-restore/runtime-tool-loop/runtime-context-announcements/
  runtime-persistence win32 路径形态归一（POSIX 夹具经 resolve 变盘符反斜杠，期望侧镜像归一，
  产品对真实 win32 路径两侧同形态不受影响）。
- **persona fork 继承与上游 lineage 预检的域冲突（本轮唯一登记未闭环项）**：persona fork 会话
  无 path/directory/workspaceID，撞上 v3.18.0 新增 validateSessionActivationWorkspace 的
  project.session-lineage-invalid 预检（server-operations 本仓函数，上游无 resolveLegacyRemote*
  ——Drora 遗留远端域）。已修两层崩溃守卫（directory undefined → null；isSameSessionWorkspacePath
  storedPath undefined → false），语义仲裁（persona fork 沿父链证明归属）留专项。
- **未修登记（证据在案）**：mcp-runtime.test.ts 语法错误（await in non-async，HEAD 同款，文件级
  死件）；permission-service plan-mode 用例（本仓 S03 不变量与上游断言冲突，HEAD 同败）；
  session-persistence "- Shell: zsh"（win32 Git Bash 方言，上游 POSIX 绿）；EBUSY/ENOTEMPTY
  临时目录竞态族与 15s 仍超时的负载敏感个案（复跑/隔离可过）；subagent-workspace ×2
  resolvedCwd（win32 真适配器 cd 跟踪，需专项）；tui 7 文件 AppView 渲染原生 segfault
  （第 3/4 轮已登记需专项；Nov 1 cli 包 tui 渲染族同败佐证既有）。
- **终跑实数（2026-11-14 复跑 pnpm test:upstream-cli，日志 /tmp/v318-final-verify/test-upstream-cli-rerun.log）**：
  design-plugin 1→**0**（全绿）；adapters 5 用例→1（Git Bash 方言计时 flake，隔离过）；bootstrap
  26 文件/153 败→9 文件/12 败（其中 drora-protocol ×4 + script-workflow ×3 + model-switch ×1
  为并行负载挂起（隔离 130/131 过），zsh ×1 平台，persona fork ×1 开放项，subagent-workspace ×2
  开放项，session-facade ×1 开放项）；core 20 文件→2（mcp-runtime 语法死件 + permission-service
  S03 冲突，均 HEAD 同败）；cli 15=登记集不变；tui 7=segfault 专项；drora-site 2=既有。按 S4
  终局口径（非既有且非上游携带=0）：C 类残留=persona fork 语义仲裁、subagent-workspace win32
  cd 跟踪、session-facade fake-timer 挂起三项（均已登记），其余全部收口。


## 台账 33：上游基准重放批（2026-11-14 用户裁定）

**总裁定原文背景**：用户 2026-11-14 裁定——全面以上游为基准；本仓自研特性（persona/双 relay/
mobile-web/CUA 三件套/obsidian/agents-team/模型能力/发行通道 update-feed-github）保留不动，
**其余与上游的语义冲突一律改为上游行为**。本批把此前按「保 ours」处理的三个语义冲突点反向
对齐上游（台账 31 permission ×2 待裁项落定 = 裁定 B；台账 32 修复项 ⑥/⑨ 的反向回放）。

- **反向一：plan-MCP 安全门 → 上游语义（台账 31 裁定 B 落地）**。放弃的 ours 语义：S03
  洞 1a「plan 模式第三方 MCP（无论 readOnlyHint）一律 deny（`mode.plan.nonReadOnly`）」deny 门
  （`test/permission-service-write-tier.test.ts` 两条用例旧期望）。上游行为依据：
  `permission/service.ts` `checkPlanMode`（上游 v3.18.0 同款，未改实现）= ① 非 readOnly、非
  destructive 的 MCP → `mode.plan.mcp` ask（排在 allow 规则之前、`optionsPolicy=
  no-always-allow`，不提供始终允许）；② readOnly 且非 destructive 的 MCP → 过闸（undefined）
  按原模式判定（第三方 MCP 能力面 `src/mcp/index.ts` `needsApproval` 恒 true，实测落
  `mode.build.sideEffect` P0 逐次确认）。两条用例先探针实测（ask/ruleId/optionsPolicy 逐字段）
  再改断言；OfficialCua readOnly allow 用例原样保留（宿主验证信任锚不受裁定影响）。spec 同步：
  `specs/agent-write-safety.md` 顶部新增「2026-11-14 用户裁定注记」+ 洞 1a/洞 3 节内修订指针，
  其余内容不动。
- **反向二：Bash 整工具 allow ×P0 守卫（S03 洞 3）→ 上游恒短路**。放弃的 ours 语义：
  `bash-command-rule-evaluator.ts` 洞 3 守卫（整工具 allow 仅 safe 命令短路、非 safe 一律
  逐次确认）。上游行为依据：`git show refs/upstream-trees/v3.18.0:apps/zcode-cli/packages/
  core/src/tool/handlers/bash-command-rule-evaluator.ts` 首行 `if (rules.some((rule) =>
  !rule.ruleContent)) return true;`（无 ruleContent 整工具规则恒短路，含非 safe 命令）。
  落地：evaluator 恢复上游行（仅留中文裁定注释，`diff refs/upstream-trees/v3.18.0` 除注释外
  零差异）；`tests/bash-command-permission-policy.test.ts` 恢复上游断言原文（zcode→drora
  变换后与 theirs 逐字节一致）；本仓自设洞 3 单测 `test/bash-command-rule-evaluator.test.ts`
  S03-P0-1 期望翻转（false→true）并载裁定注释；`service.ts`/`write-tier-policy.ts` 中引用
  洞 3 的陈旧注释同步改写。**保留不变面**（裁定未列，照旧生效）：洞 2 三层（建议/评估/持久化
  消毒）、`allowedTools` 命中 P0 不豁免的 service 守卫（「P0 全局 allowedTools 不得绕过」用例
  原样绿）、js/MCP P0 逐次确认、OfficialCua 豁免。
- **反向三：subagent runner 完成序 → 恢复上游 v3.18.0 顺序**。放弃的 ours 语义：台账 32 修复
  项 ⑥ 恢复的 Drora 不变量「产物未落盘不得 completed」（先 `writeCompletedAgentArtifacts`
  再走 executionId claim 守卫标 completed）。上游行为依据：`git show refs/upstream-trees/
  v3.18.0:apps/zcode-cli/packages/core/src/subagent/runner.ts` 完成段顺序 = 先
  `registry.update`（executionId 原子 claim）标 completed、`!completedClaimed` 抛停取消、再
  `await writeCompletedAgentArtifacts` 写产物。落地：runner.ts 恢复上游顺序（diff theirs 除
  中文裁定注释外零差异）；钉住旧不变量的 `tests/subagent-background.test.ts`「cancels
  auto-background timeout」用例期望翻转（产物写阻塞期间 running→completed）并载裁定注释。
  上游自身无该不变量用例（上游 tests/subagent-background 无「cancels auto-background
  timeout」条目，系本仓自设）。
- **复验实录（2026-11-14，全部真实输出）**：①定向：write-tier node:test 11/11（permission
  ×2 转绿）、rule-evaluator node:test 5/5、bash-policy vitest 21/21、subagent-background
  vitest 31/31、邻接面 bash-permission/permission-service/bash-handler/bash-run-conformance
  268 过/1 败（唯一败=permission-service 上游 plan-mode readOnly MCP×项目整工具 allow 用例，
  HEAD 同败既有，见台账 32 未修登记——与本批改动无涉，该面守卫属保留不变面）、
  background-subagent-stall+subagent-explore 78/78；②`pnpm --dir apps/drora-cli/packages/core
  exec tsc --noEmit`＝exit 0；③core 包 `pnpm exec oxlint src --no-ignore`＝0 warn/0 error；
  ④`pnpm test:unit:node`＝**371 tests：362 过/8 跳/1 败**——唯一败为 obsidian-plugin
  knowledgeMigration「失败回退」既有项（Vault 抽离遗留，台账 31），与任务预期终态（371 中仅
  剩 obsidian ×1）一致；⑤upstream-cli core 官方通道（`pnpm --filter @drora/core test`＝
  `vitest tests`）：**2 文件败/335 过（5289 过/27 跳/1 败）**——败集＝mcp-runtime 语法死件 +
  permission-service S03 洞 2 保留面冲突，均 HEAD 同败（台账 32 口径 2 文件），**败数不升**。
  另：全量 core vitest 误通道（含 test/ 目录 node:test 文件）会多出 7 个「No test suite
  found」假败，非官方通道口径，不计。
- **migration spec 同步**：`specs/upstream-v3.18.0-migration.md` §11 表 permission 行更新为
  「已裁定 B 并对齐上游」，待裁项①闭环。

## 台账 34：@ai-sdk 两 patch 根级回收——台账 30 对应项废止 + allowUnusedPatches 拆分拓扑适配（2026-11-14 登记，05-remaining-gaps K4 前置）

**废止对象**：台账 30 S8 根 package.json 语义合并中的「@ai-sdk 两 patch 按本仓既有删除保持
（base 有而 ours 删、theirs 未动）」（specs/upstream-v3.18.0-migration.md:317）。

- **废止理由（K4 裁定，05-remaining-gaps §2.2 #1-#3）**：本仓 adapters 源码明确预期该
  patch——`apps/drora-cli/packages/adapters/src/model/transform.ts:535-536` 注释「patch 后的
  @ai-sdk/openai-compatible / @ai-sdk/anthropic 转成 video_url / video block」、
  `tool-result-media-projection.ts:172` 同款；若依赖图失去 patch，video/* file part 不再被
  provider 包转换，video 上传静默失效。全面上游基准总裁定下根级登记面跟进 theirs-v3182。
- **事实勘正（执行期实测，修正 K4 文档的两处预估）**：①CLI workspace 侧 3f8f2e63b 拆分时
  两 patch 系「随迁」而非删除——`apps/drora-cli/patches/` 两文件、`apps/drora-cli/package.json:60-63`
  patchedDependencies、CLI pnpm-lock.yaml:7-13 三处在位，CLI 侧干净重装本就一直会重新施加
  patch（K4 文档「干净重装后 video 上传静默失效」的推断对 CLI workspace 不成立）；真缺口是
  根级（patches/ 文件 + 根 package.json 键）与 theirs-v3182 的形态差。②「grep video_url=3 处」
  实属 @ai-sdk/openai-compatible patch 的产物（其 dist/index.js video_url=3）；anthropic patch
  产物为 `type:"video"` block（dist 内 video_url 字面量=0）。
- **回收动作**：patches/@ai-sdk__anthropic@3.0.81.patch、patches/@ai-sdk__openai-compatible@2.0.60.patch
  自 theirs-v3182 变换树逐字节拷入根 patches/（双侧 sha256 一致：5139a9d6…/df8af1ab…，
  与 apps/drora-cli/patches/ 现存两件亦逐字节同）；根 package.json patchedDependencies 按
  theirs 键名/顺序补两键，顺带删除 @radix-ui/react-menu@2.1.16 JSON 重复键（原 :136/:143
  等值双写，保一处）。
- **拆分拓扑适配器（新增有意分歧，对 theirs 独有）**：根 workspace 图内无 @ai-sdk/anthropic
  与 openai-compatible（CLI 独立 workspace 所辖），pnpm 10.33.2 对「声明未用」patch 直接
  ERR_PNPM_UNUSED_PATCH 硬错——theirs 单 workspace 不触发此错。处置=根 package.json pnpm 段
  增 `allowUnusedPatches: true`（pnpm 10.33.2 实证支持：临时探针工作区复现 ERR 后加该键
  install 通过；上游无此键，未来若 workspace 拓扑并回上游可删）。
- **锁面记录**：根 pnpm-lock.yaml patchedDependencies 增两 @ai-sdk 条目——hash e7de52af/91822065
  =sha256(LF 归一后 drora 改名版 patch)；theirs 锁 d3a7c381/9632fe9d =sha256(上游原版 LF)，
  差异=品牌改名注释（zcode patch→drora patch）+EOL，非内容分歧。同文件 EOL 语义：pnpm 以
  CRLF→LF 归一内容计算 hash（探针实证 aiden0z 纯 LF 件文件 sha=锁 hash）。
- **验证（2026-11-14 实测）**：根 `pnpm install --no-frozen-lockfile` 过（补 allowUnusedPatches
  后）、二次运行锁幂等、`pnpm install --frozen-lockfile` 根/CLI 双过；删包重装证明——
  基线 CLI 侧 anthropic dist 含 patch 标记（'drora patch: video' index.js/index.mjs 各 1、
  openai-compatible dist video_url 各文件 3）→物理删除 .pnpm/@ai-sdk+anthropic@3.0.81_pa_245c…
  整目录与 adapters 符号链接→CLI 重装→同 hash 后缀目录复活且标记重现（patch 由
  apps/drora-cli/patches 文件真实施加，非残留）；根 `pnpm typecheck` exit 0。
- **随件修复（K4 #4）**：NOTICE.md:24 断链 packages/drora-cua/index.js→packages/zcode-cua/index.js
  （目录实测存在/不存在各证一次），「不可用占位实现」失实文案改为如实描述（官方 zcode-cua
  0.6.5 运行时完整还原引擎，见 packages/zcode-cua/package.json description）。K4 #5
  THIRD-PARTY-NOTICES 三条目为 K5 生成物，归后续重生成任务。

## 台账 35：05-remaining-gaps §3 专项小修三项收口（2026-11-14 登记，行动排序批 4 前三项）

**收口对象**：台账 32 登记的 session-facade ×1 / subagent-workspace ×2 开放项 + 台账 31 登记的
knowledgeMigration ×1 既有项。

- **subagent-workspace ×2（win32 cd 跟踪，有意分歧=上游共享文件的潜伏 bug 修复）**：
  根因链（探针实证）=Git Bash 把 TMP/TEMP 视为 MSYS 虚拟挂载 /tmp，`pwd -P` 写出
  `/tmp/...` → `gitBashPathToWindowsPath`（contracts/src/path/git-bash.ts:23）三形态
  （//、/cygdrive、/<盘符>/）均不匹配 → 兜底 `replaceAll("/","\\")` 得当前盘相对
  `\tmp\...` → `readCapturedCwd` statSync 失败 → resolvedCwd 恒 undefined（用例
  status=completed/exit 0 仍断言失败）。上游 v3.18.2 同款实现同款潜伏（其 CI 非 win32
  Git Bash 方言不显形），故此修复为对 theirs 的有意分歧而非漏跟。落地=adapters
  `cwd-capture.ts` 新增 `createGitBashCwdCaptureCommand`：捕获改
  `pwd -P | cygpath -w -f -`（本机探针 /tmp→%TEMP%、/d/workspace/x→D:\workspace\x、
  单尾部换行均实证），posix/cmd 方言不变；`exec.test.ts` git-bash 断言同步为 cygpath
  形态并载因。定向复跑：subagent-workspace 3/3 绿、exec.test.ts cwd capture 4/4 绿。
- **session-facade ×1（K3 遗留，对齐上游=零分歧）**：v3.17.1 S2（bff94f4bd）引入的 6s
  owner-drain 超时语义被 b3e44cb2a（v3.17.2 合并）用上游无超时形态覆盖后，用例
  `timeout reports failure but retains store until the actual owner drain completes`
  成孤儿——实现已无 6s 拒绝路径，`await failed` 挂起至 vitest 超时。上游 v3.18.2 该
  语义已移入 session-facade-shutdown.test.ts（"keeps actual close pending beyond the
  former six-second budget" 等，本仓工作树已吸收）。落地=删 session-facade.test.ts 尾部
  orphan 用例、删 session-facade.ts `SessionResourceCloseInput.timeoutMs` 残留字段、删
  shutdown 测试 `timeoutMs: 50` 唯一消费点；修后 session-facade.ts 与 session-facade.test.ts
  对 theirs（品牌归一）逐字节一致（diff exit=0）。定向复跑两文件 12/12 绿。
- **knowledgeMigration ×1（win32 注入，工作树既有修复本轮实证）**：该修复（chmodSync
  目录 0o500 → 目标父目录置普通文件触发 mkdir(recursive) ENOENT，注释载探针证据）已在
  战役工作树就位（`git diff HEAD` 可见），本轮 `node --import tsx --test` 定向复跑
  6/6 绿收口台账 31 登记项。
- **验证（2026-11-14 实测）**：三个测试入口命令与通过数见上各条；根 `pnpm typecheck`
  exit=0（0 TS 错误）、CLI workspace `pnpm typecheck`（turbo）exit=0；根 `pnpm lint`
  exit=0（0 error）。CLI 侧 `pnpm lint` 入口（run-cli-lint.mjs）因根 .oxlintrc.json
  `apps/drora-cli/**` 全忽略致多数包 oxlint 输出「No files found」前缀+JSON、脚本
  JSON.parse 崩——工作树既有工具链态（逐包探针复现，与批次改动无关），本轮按台账 33
  同款口径以 `pnpm exec oxlint src tests --no-ignore` 定向验证：adapters 0 warn/0 err、
  bootstrap 1 warn/0 err（唯一 warn 为 tests/persona/persona-system.test.ts 既有
  no-unused-vars，非本轮文件）。workspace freshness 门禁因 github 远端不可达（HTTP 400）
  无法执行 fetch，环境限制如实登记。

## 台账 36：05-remaining-gaps §3 cli 14 败收口——CUA host ×5 / SEA runtime ×4 / build-sea 拓扑改写（2026-11-14 登记，行动排序批 4 收尾）

**收口对象**：05-remaining-gaps §3 #5 的 ②③ 两分项（9 败）+ build-sea root-graph K1（1 败）；
① tui 渲染族 5 败维持挂起（opentui native segfault，台账 32 在案，本轮零触碰）。

- **CUA host ×5（测试改导出常量，零产品改动）**：根因=socket wire 键是还原区冻结的
  `ZCODE_CUA_PERMISSION_BROKER_SOCKET`（@drora/shared runtimeEnv.ts 导出为
  DRORA_CUA_BROKER_SOCKET_ENV_KEY），cli.unit.test.ts 四用例与 plugin-host-entry.test.mjs
  两用例此前播种/探测 `DRORA_` 前缀字面量——capture 读不到 socket → 守卫不触发（fail-open
  假象）、token 无法恢复；且 DRORA_ 名不在 sanitize 清单，socket 直接泄漏进子进程 env，
  identity-mode 用例借泄漏"假绿"。落地=两测试文件 socket/token 键全量改用 @drora/shared
  导出常量（内嵌 server.js 探针经 JSON.stringify 插值），载因注释在 import 处；台账 32③
  mcp-tool-bridge 同款先例的补全。定向复跑：cli.unit.test.ts CUA 族 4/4 绿、
  plugin-host-entry.test.mjs 2/2 绿。
- **SEA runtime 缓存 ×4（win32 宿主语义，源侧小修=对上游的有意分歧）**：根因链（探针
  实证）=isCacheCurrent 按 options.platform（测试注入 darwin）校验执行位，而 win32 宿主
  stat().mode 无 x 位语义（libuv 只映射只读属性，x 位仅按 .exe/.bat 等扩展名合成）→ 缓存
  恒判 stale → 每次重装 rename 覆盖既有目录 → win32 上该操作映射 EPERM 且不在
  isDirectoryReplaceRace 集合 → 首次 rename 即抛；并发用例再由孤儿 promise 与 finally
  清理互踩出 ENOTEMPTY rmdir。上游同源同败（其 CI 非 win32 宿主不显形）。落地
  （sea-runtime-tools.ts，注释均载因）：① isCacheCurrent 执行位校验加宿主感知（
  process.platform!=="win32" && platform!=="win32"——可观察性属宿主文件系统而非目标平台；
  生产 host==platform 零行为差）；② isDirectoryReplaceRace 在 win32 宿主纳入 EPERM
  （unix EPERM 另有语义维持原集合），沿用既有收敛序（先复查缓存有效性再清目录重试）；
  ③ 测试侧两处执行位断言按 process.platform 守卫（win32 上 chmod 0o644/0o755 同为
  0o666，"执行位修复"面不可测，unix 行为不变）。定向复跑 sea-runtime-tools.test.ts 8/8 绿。
- **build-sea ×1（根脚本按拆分拓扑改写，K1 分歧主登记）**：根因=3f8f2e63b CLI 拆分后根
  workspace 无 apps/drora-cli glob，root package.json build:sea:prepare（theirs 逐字）内
  `--filter="{./apps/drora-cli/packages/*}..."` 从根解析恒为空集（实测 []，exit 0 静默
  no-op），尾部 `--filter @drora/cli` 同样无匹配——该脚本是 CLI build:sea 链（cli 包
  build:sea 经 --dir 调根 prepare）与 sea-runtime-package-resolution 报错指引的活入口，
  拆分后功能性断裂。裁定=选「脚本按拆分拓扑改写」而非 skipIf：测试可免改即绿（其契约
  正是"根图能解析出 session-control"），且 skipIf 会把断裂的生产入口一并豁免。落地=中段
  改七个根侧闭包选器（provider/provider-node/session-control/formal-proof/
  model-option-map/zcode-cua/rpc，即 CLI workspace 经 link: 消费的全部根包+其依赖闭包，
  实测解析 8 包含 shared），尾段改 `pnpm --dir apps/drora-cli build`（turbo 全量 CLI 包，
  对应上游"先建闭包再建 cli"的两段语义）；`--filter=!@drora/cli` 保留（从根永远无匹配，
  维持上游契约形状）。对照 theirs=同脚本同测试上游在单 workspace 拓扑下成立，本仓按
  3f8f2e63b 拆分裁定改写，上轮 pnpm-workspace 拓扑仲裁条目（"继续未决"）就此闭环。
  实测：`pnpm build:sea:prepare` exit=0（7 根包 + turbo 21 任务）；build-sea.test.mjs
  root workspace graph 用例 1/1 绿。
- **验证（2026-11-14 实测）**：定向复跑见各条；终局 `pnpm test:upstream-cli` 全量复跑（19 包）：
  cli 包 505 测试/487 过/**4 败+1 取消**——败集恰为本条登记不修的 tui 渲染族
  （login-URL/mode-switch/model-selection/startup 四败 + subagents 取消），10 项目标败
  （CUA×5+SEA×4+build-sea×1）全数转绿；其余红包与台账 32/35 记录基线一致（core=登记对 mcp-runtime 死件+
  permission-service S03；adapters/bash-direct-execution 与 credential-* =负载计时 flake；
  bootstrap 红文件隔离复跑 73 过/0 败=并行负载挂起族；drora-site=win32 tar 既有；tui=segfault
  专项）；dynamic-workflow convergence 计时断言全量负载下超阈（10989ms>10000ms）——与本批
  改动无涉（cli 域外），隔离复跑 17/17 绿记为负载 flake。根 pnpm typecheck exit=0、CLI 包
  typecheck exit=0、根 pnpm lint 0 error（826 warn 既有面）；触及四文件经临时配置定向
  oxlint 0 warn/0 err（根 .oxlintrc ignorePatterns 含 apps/drora-cli/**，按 react-hooks-lint
  专项口径补扫；触及文件无 React hooks 面）。

## 台账 37：K4 余项 + R3 类型面收口——persona fork 沿父链归属放行（安全语义分歧主登记）（2026-11-14 登记，05-remaining-gaps 行动排序批 1/2/5）

- **persona fork lineage 放行（对上游的有意分歧，安全语义）**：上游 registerForkedSession
  （theirs v3.18.2 与本仓逐字一致）以 lifecycle 默认 kind=restore 对 fork 子会话跑
  validateSessionActivationWorkspace——以子会话自身持久化 lineage 事实为准；persona
  （自研保留域）的 fork 注册用例（persona-protocol.test.ts「fork 继承」）子会话行不含
  可解析事实，预检抛 project.session-lineage-invalid（vitest 复跑实证）。裁定
  （05-remaining-gaps §3#1 仲裁，用户总裁定「自研特性保留」）：fork 子会话沿父链归属
  放行——父会话 live（context.sessions 登记即本次传入 record，经 create claims 或
  resume/attach restore 预检入场，workspace 已校验）且 fork 对象指向本父
  （parentSessionId 缺省视为本父，v4-bridge:585 同款约定）时，注册走 kind=create 跳过
  子会话 lineage 预检；guard 不满足回落 restore 维持上游 fail-closed。安全面评估
  （放行不超预期，未升级）：registerForkedSession 非 RPC handler，生产调用方仅
  forkSession（session/fork，经 requireSession 权限与 active-turn guard）与 v4-bridge
  三处 registerCommittedForkBestEffort，fork 对象全部由 runtime 产
  （forkWorkspaceFromCheckpoint / createSelectionSideConversation），子会话 id 不可由
  RPC 注入，子会话 runtime 钉死第三参 record.workspace（父 workspace），无跨 workspace
  逃逸面；非 fork 的 lineage 校验（resume/ensureReady/restart）上游逐字不动。落地=
  server-operations.ts registerForkedSession 计算 forkChainAttributedToLiveParent 选
  kind（中文注释全文载裁定与调用方清单）；同批修 persona-protocol.test.ts 子会话桩为
  SessionInfo 生产形态（旧桩字段名 sessionId/workspace/sessionKind 均不存在，产出生产
  永不落盘的双缺 path/directory 形态，卡死在 resolveResumeWorkspaceRef 必填 directory
  契约——生产 fork 子行由 core buildForkedSessionInput 复制父行 directory/path，故修桩
  不加产品兜底分支）。定向复跑 persona-protocol.test.ts 25/25 绿；fork/lineage 回归
  drora-protocol + protocol-unbound-resume + v4-cold-resume 259/259 绿。
- **R3 类型面四处补齐（仅类型声明，运行时零改动）**：packages/zcode-cua 的
  runtime.d.ts/index.d.ts 对照上游 v3.18.2 官方 0.6.5 桩 d.ts
  （refs/upstream-trees/v3.18.2:packages/zcode-cua/index.d.ts）补字面量联合
  （runtimeScope "main"|"subagent"、clientMode/deliveryKind
  "web-remote-replayable"|"desktop-continuous"、trace?）与具名导出
  （ComputerUseRuntimeContext/ExecuteInput/Options 单一出处在 runtime.d.ts，index.d.ts
  具名再导出并保留本仓 mcp/server 五导出面）；actionTitle 为官方 0.6.5 切段真字段而
  上游桩漏列（upstream/zcode-cua-0.6.5.index.js:38485-38486 解析、:44958 消费为
  title），本仓 node-repl-host cua-broker parseContext 已按此产出，故补入并载切段
  证据。broker-server.d.ts 补 BrokerLogger（logger?: unknown→BrokerLogger 收紧；
  services ServiceLogger 与 desktop 安装器适配器结构同形，desktop 本地重复类型定义
  改引包导出单一出处）与 injectPermissionBrokerAgentMcpServers 声明（JS 经
  broker-server.js 的 export * 转出，src/broker/server/index.ts:51，源码零消费者）。
  request-access-contract.d.ts 换上游具名接口形态（CuaRequestAccessStatus/
  CuaRequestAccessStatusSchema；两消费者 result-display.ts:387 与
  cua-permission-observation.ts:32 均只用 .success/.data 不触 .error zod 专有面，
  实测结构兼容）。定向验证：tsc -p packages/zcode-cua、tsc -b packages/services +
  desktop main、drora-cli turbo typecheck（node-repl-host/core/bootstrap，--force
  旁路 link: 依赖缓存盲区）全绿。vitest.config.ts:102-103 注释勘误 0.6.3→0.6.5
  （bf872a6c0 换代后 package.json 实测版本）。
- **K4 文档漂移两处**：docs/cua-permission-broker/cua-dev-mcp-runtime-assets.md:31,63
  包名/路径改本仓实际 @zcode/zcode-cua-plugin
  （apps/drora-cli/packages/zcode-cua-plugin/package.json:2 实测；:63 目标文件
  scripts/computer-use-client.mjs 实存在位；同文档 :33/:60-62 的
  @drora/browser-use-plugin 为真实包名与实存路径，非漂移不动）；
  apps/drora-cli/docs/design/v2/model/README.md:384 x-drora-query-source→
  x-zcode-query-source（冻结 wire 名，adapters/src/model/model-request-headers.ts:2
  定义、model-execution.ts:547 消费均实读；同段 x-drora-session-features 与代码一致
  不动）。

## 台账 38：vendored 上游文档域 fmt 改写恢复——974 件还原 + ignorePatterns 域登记（2026-11-14 登记，05-remaining-gaps §2 K3 / §4 序 3）

- **背景与根因**：v3.17.2 时代 S7 全仓 fmt sweep（oxfmt 0.41）把本仓 docs/ 下的上游 vendored 文档改写成 oxfmt 形态（宽表、`*`→`-`、代码块引号/分号/重排、强调定界符 `_x_`→`*x*`、转义搅动；含台账 7 缺陷族实伤：`TASK_GROUP_*`→`TASK*GROUP*\*`、表格在 inline code 的 `|` 处劈行（`docs/conversation-product-protocol.md` 的 `queue | guide`、`docs/off-peak-task/implementation-notes.md` 的 `offPeak/create|list`）、JS 对象字面量被搅成 `{ type: ("mobile-session-request", sessionId); }`）。对照树为 v3.18.2 变换树 `C:/Users/A/AppData/Local/Temp/dryrun/theirs-v3182`（`refs/upstream-trees/v3.18.2` 的 drora 命名形态），差分清单 `D:/workspace/tmp/upstream-v3.18.2/final-alignment-v3182.tsv` 的 docs/ 域 DIFF 行共 **1,054** 件。
- **判定方法（双证，逐件全量而非抽样）**：① oxfmt 0.41 不动点法——两侧各拷贝临时树跑 3 遍 `oxfmt --write`（空配置），不动点后逐字相等即「ours == fmt(theirs)」，证明 ours 是 theirs + 本仓 fmt 改写（内容零差）；② 词元序列独立复核——`[\p{L}\p{N}]+` 词元序列逐位相等（格式化器不增删调序词元）。结果：**FMT_EQUIV 974 / 内容差 65 / 已先行对齐 15**（15 件在 TSV 生成后已被其他批次收口，raw 归一化即相等）。唯一词元级例外为 `docs/electron/docs/fiddles/features/navigation-history/style.css` 的十六进制色 `4CAF50`↔`4caf50`（大小写规范化，纯格式）。抽样人工核验另做 37 域 ×3 件（最大/中位/最小 diff，共 92 件原始 diff 逐段目检），全部为格式噪声。
- **恢复执行**：974 件从 theirs-v3182 **逐字节**拷回工作树（保留上游原始 EOL/BOM 形态；git autocrlf 归一入库与本仓其余文本一致，final-audit 口径 EOL 归一比较不受影响）。拷贝后逐件复读校验 normText 相等（restore.mjs 内建，无一失败）。`.gitattributes` **不加** `-text`：这些文档无哈希锚定消费方（区别于 LICENSE/runtime 资产），按仓库既有 text 归一即可。
- **65 件内容差保留清单（A 类 53 + B 类 12，全部不动并在此报告）**：
  - **A 类（仅改名字面量差异，53 件）**——theirs 保留冻结 `zcode*` wire 字面量、ours 是旧改名工具过度改名形态（或反向），逐字面量需对代码冻结面仲裁后才能吸收，本轮不做（深 link scheme 双轨：代码 `zcode://` 13 文件 / `drora://` 8 文件并存——OAuth 回调用 zcode://、Drora 自有入口（`desktopFinderOpenFolderWorkflow.ts:26`、`conversationSharePreviewClient.ts:69`）用 drora://；其余族代码侧证据：`X-ZCode-Mobile-Connection-Id` 4:0、`x-zcode-query-source` 6:0、`zcode_type` 30:2、`x-zcode-rpc-client-mode` 2:0、`x-zcode-intranet-token` 3:0、`x-zcode-workspace-file` 4:0、`zcode-cua-helper-meta` 5:0、`zcode-cua-windows-dev` 12:0，git grep 实测）：`docs/conversation-share-v1.md`、`docs/cua/windows-source-development.md`、`docs/cua/2026-09-14-windows-cua-indicator-repair-spec.md`、`docs/cua-permission-broker/2026-09-21-cua-helper-lazy-startup-spec.md`、`docs/cua-permission-broker/cua-helper-installation.md`、`docs/cua-permission-broker/local-dev-helper-runbook.md`、`docs/desktop/dev-deep-link.md`、`docs/desktop/finder-open-folder-deep-link.md`、`docs/desktop/drora-preview-packaging.md`、`docs/desktop/auto-update-service-manifest.md`、`docs/desktop/linux-appimage-deep-link.md`、`docs/desktop/linux-pacman-package.md`、`docs/desktop-bundle-size-architecture.md`、`docs/desktop-ci-cd.md`、`docs/development-mise-runtime.md`、`docs/mobile-remote-control-android.md`、`docs/linux-appimage-desktop-icon-integration.md`、`docs/highspeed/highspeed-access-mode-migration.md`、`docs/security/deep-link-project-trust-boundary.md`、`docs/v4-refactor/01-topology.md`、`docs/v4-refactor/05-transport-and-backpressure.md`、`docs/v4-refactor/10-protocol-spec.md`、`docs/web-remote-control-relay-message-logging.md`、`docs/oauth/oauth-multi-provider-implementation.md`、`docs/oauth/oauth-multi-provider-final-plan.md`、`docs/analysis/credentials-json-code-audit.md`、`docs/architecture/intranet-probe.md`、`docs/builtin-plugin-icons.md`、`docs/ui/workspace-file-tree.md`、`docs/testing/conversation-telemetry-differential-regression-plan.md`、`docs/off-peak-task/mr-1466-complete-change-walkthrough.md`、`docs/working-memory/provider-refactor/design/registry/request-compatibility-and-access-protocols.md`、`docs/working-memory/provider-refactor/research/todo103-staging-source-inventory.json`、`docs/superpowers/plans/2026-03-31-bigmodel-oauth-login.md`、`docs/superpowers/plans/2026-04-27-zai-backend-oauth-token.md`、`docs/superpowers/plans/2026-07-28-windows-cua-development-runtime.md`、`docs/superpowers/plans/2026-07-29-windows-cua-product-runtime.md`、`docs/superpowers/plans/2026-07-29-windows-cua-native-clipboard.md`、`docs/superpowers/plans/2026-07-29-windows-cua-pointer-foundation.md`、`docs/superpowers/plans/2026-07-29-windows-cua-tool-call-and-app-launch-reliability.md`、`docs/superpowers/plans/2026-07-29-windows-cua-wgc-visual-capture.md`、`docs/superpowers/plans/2026-08-04-windows-cua-upstream-main-forward-port.md`、`docs/superpowers/plans/2026-08-07-dev-cua-sharp-reseed.md`、`docs/superpowers/plans/2026-09-21-cua-helper-lazy-startup.md`、`docs/superpowers/specs/2026-03-31-bigmodel-oauth-login-design.md`、`docs/superpowers/specs/2026-04-27-zai-backend-oauth-token-design.md`、`docs/superpowers/specs/2026-04-28-web-remote-login-design.md`、`docs/superpowers/specs/2026-04-28-window-level-web-remote-control-design.md`、`docs/superpowers/specs/2026-06-09-agent-model-request-session-header-design.md`、`docs/superpowers/specs/2026-07-28-windows-cua-development-runtime-design.md`、`docs/superpowers/specs/2026-08-04-windows-cua-upstream-main-forward-port-design.md`、`docs/superpowers/specs/2026-08-07-dev-cua-sharp-reseed-design.md`、`docs/superpowers/specs/2026-08-18-windows-cua-runtime-diagnostics.md`。**后续建议**：按 K4 #7 同族逐字面量仲裁（theirs 侧与代码冻结面一致者可吸收并顺带消 fmt 噪声；`drora://`/`drora-plan` 等本仓有意双轨者保持 ours）。
  - **B 类（本仓自研/勘误内容，12 件，K1/K2）**：`docs/conversation-session-case-catalog.md`（Persona v5 / Agents Team / voice 生命周期段落）、`docs/testing/conversation-session-e2e-coverage-matrix.md`（同上）、`docs/ui/settings-personalization.md`（2026-11-03「个性化」→「自定义指令」用户裁定）、`docs/web-remote-control/web-remote-control-architecture.md`（部署文档链接改写 + 2 处字面量，混合）、`docs/windows-test-compatibility.md`（原生 Node 用例发现段）、`docs/desktop/oss-cdn-multi-target-migration.md`（v3.15.1 远端资源来源修正段）、`docs/testing/pre-push-hook.md`（Drora 保留回归工程段）、`docs/bots.md`（Webhook wire header 旧 Drora 配置兼容段）、`docs/ci/affected-unit-test-baseline.md`（台账 8 适配段）、`docs/plugins/2026-09-17-official-plugin-version-sync-spec.md`（改写为本仓实际包名/路径）、`docs/cua-permission-broker/cua-dev-mcp-runtime-assets.md`（台账 34 已修的 @zcode/zcode-cua-plugin）、`docs/monitoring/process-resource-telemetry.md`（packages/zcode-cua-helper 修正）。
- **对上游 `.oxfmtrc.json` 的有意分歧（本条主旨）**：上游 v3.18.2 的 ignorePatterns 不豁免这些文档域（上游根仓 fmt:check 对 vendored 文档同样会报，但上游不以全仓 fmt 门执法）；本仓因 S7 教训必须豁免，否则任何全仓 `pnpm fmt` 都会把 974 件再次改写（同台账 7 先例）。登记形态：32 个纯上游域（域内 ours 文件 100% 存在于 theirs，无自研件）域级 glob + `docs/superpowers/**`（反选豁免唯一自研件 `plans/2026-10-29-drora-persona-p0.md`，oxfmt 0.41 `!` 反选实测生效）+ 混合域（docs/ 根 66 / docs/testing 29 / docs/cua-permission-broker 1 / docs/upstream 1）逐文件登记恢复件，共 131 条新 entry。混合域中未登记的已对齐上游件（docs/ 根约 210、docs/testing 约 71）仍受 fmt 管辖，留待 oxfmt 0.47 收口段统一裁定。
- **验证（本会话实测）**：`pnpm fmt:check` 基线 9,298 件报未格式化（战前既有债，exit 1）→ 恢复+登记后 7,503 件，**新增 0 件**（comm 差分），移除 1,795 件全部在 docs/（974 恢复件 + glob 附带覆盖的上游件）；`pnpm lint` 前后均 826 warnings / 0 errors / exit 0（零差分）；`pnpm docs:stale-phrases:check` 过（2430 件，词元等价性预见词组面不变）；typecheck 未跑——全仓 tsconfig 无一 include docs/**（grep 实证），改动集为文档 + 配置 + 本台账，无编译面。逐域对账：TSV docs 域 DIFF 1,054 = 恢复 974 + 保留 65 + 先行对齐 15（明细见 restore-report.tsv；electron 376/0、webdriverio 117/0、knip 40/0、working-memory 53/2、superpowers 125/20、v4-refactor 17/3、monitoring 8/1、docs 根 66/11、testing 29/3、browser-use 27/0、ui 15/2、cua 15/2、desktop 7/7、其余域见报告）。
- **顺带观察（不在本批处置）**：`docs/cua-permission-broker/drora-cua-permission-broker.md`（ours）↔ theirs `zcode-cua-permission-broker.md` 为同名文档的路径改名差（TSV MISSING 行），属 S 批路径裁决面。

## 台账 39：终验第 3 轮 test:upstream-cli 修复——credential ×2 平台守卫 + design-plugin 采集期兜底（2026-11-14 登记）

**输入**：终验第 3 轮 gate `pnpm test:upstream-cli` 7 包 exit 1（adapters/bootstrap/cli/core/design-plugin/drora-site-plugin/tui）。逐包对照台账 32/35/36/37 基线后，两件为基线外新败（已修），其余全部落入既有登记族（本轮隔离复跑逐一实证，见下）。

- **credential-security-linux-fallback ×2（上游携带 win32 平台断言；台账 36 归因勘误）**：gate 与隔离复跑同败 `expected 438 to be 384`（0o666 vs 0o600，:85/:195 两处 secret 文件权限断言）——证明台账 36「credential-*=负载计时 flake」归因有误，实为**确定性平台断言败**：libuv 在 win32 只把只读属性映射进 `stat().mode`，产品 `chmod 0o600`（属主读写）观察为 0o666，权限位区分面不可测（cli 包 sea-runtime-tools.test.ts 执行位断言同款先例，台账 36 SEA 节）。上游 v3.18.2 `apps/zcode-cli/packages/adapters/tests/credential-security-linux-fallback.test.ts` :85/:195 原文同款断言且无平台门控（git show 实证；其 CI 跑 POSIX 不显形）——按总裁定「上游携带」不做产品改动，测试侧加 `expectedSecretFileMode`（`win32 ? 0o666 : 0o600`，注释载因）：win32 侧退化为断言可观测的「属主可写」（读到 0o444 只读仍会败），unix 语义不变。定向复跑 11/11 绿。
- **design-plugin ×1（新间歇：全量 gate 并行压力下 describe 采集期 spawn 瞬时失败炸 suite）**：16:08 gate 中 SessionStart 组 describe 体（采集期求值）的 `spawnSync("sh",["-c","cygpath -w /usr/bin"])` 瞬时启动失败（status=null、stdout=undefined），`.stdout.trim()` 把整个 suite 炸成 Failed Suites（1 failed | 3 passed）；16:18 隔离复跑 19/19 全绿。本机 Node 24.14 探针实证：spawn 启动失败（含 ENOENT）时 `stdout` 为 **undefined** 而非 null（`{"status":null,"stdoutType":"undefined","err":"ENOENT"}`）。落地=探针包装 `resolveUsrBin()`：探针 status===0 走 cygpath；失败时按 PATH 直查 sh.exe 所在目录（与 Node spawn 命中同一目录；Git usr\bin 有 sh 无 node，「PATH 无 Node」用例语义不变；两路皆败返回空串让用例以真实 spawn 失败显形而非采集期炸 suite）。兜底分支直跑实证得 `D:\software\Git\usr\bin`，与 cygpath 探针输出一致。定向复跑 4 文件/57 测试全绿。
- **本轮基线核对（非新败，隔离/复跑实证）**：①adapters exec.test.ts「settles the background task at root exit…」gate 中败因为全量负载下 bash 子进程 `sleep: command not found` 瞬时 PATH 解析劣化——隔离复跑 78 过/47 跳全绿（负载 flake，台账 36 族）；②bootstrap 失败文件集**轮换**（第 3 轮 16:02 集=drora-protocol×4+script-workflow×3+session-persistence×2+v4-worktree-cwd×1；复跑集=session-persistence×2+app-unbound-resume×4+protocol-runtime-shutdown×2+dynamic-workflow-policy/draft-permission-full-access/session-features-site-deploy 各×1），全部为 15s 超时（并行负载挂起族典型形态），**两轮共 10 个文件逐一隔离复跑全绿**（含 session-persistence「blocks app startup on database migration」与「uses the current model…after a model switch」两超时项单测定向过）；唯「initializes the Bash shell」zsh ×1 为登记在案 win32 平台项（台账 32）；③core（mcp-runtime 语法死件+permission-service S03 洞 2）、cli（tui 渲染族 4 败+subagents 取消）、tui（7 文件；tui-focus 直跑 exit=139 复证原生 segfault）、drora-site（Node 内部断言 env_->execution_async_id + win32 tar CRLF/mojibake）与台账 33 ⑤/36 登记集逐项一致零新增。
- **复跑实数（2026-11-14 16:27 起 `node scripts/test-upstream-cli.mjs` 全量 19 包）**：adapters 1→**0**、design-plugin 1→**0**（两修复在全量负载下保持绿）；bootstrap/cli/core/drora-site/tui 仍 exit 1=上条③登记集（bootstrap 本轮 11 败=10×15s 超时负载族+zsh ×1）。按 S4 终局口径（非既有且非上游携带的失败=0）：**C 类残留=0**。
- **工具链态备注**：两触及文件在根 `.oxlintrc.json` `apps/drora-cli/**` 忽略域内（台账 35 登记的既有态），`--no-ignore` 与临时配置定向 lint 均被配置级 ignorePatterns 拦（「No files found」）；语法与运行时正确性由 vitest 转换+全绿执行覆盖。两包 tsconfig 不含 tests（adapters include 仅 `src/**/*`；design-plugin 无 tsconfig），typecheck 图不受影响，改动零产品代码。

## 台账 40：v3.18.2 全量对齐轮有意分歧汇总索引（2026-11-15 收口登记，specs/upstream-v3.18.0-migration.md §12 同批）

**登记性质**：本轮（v3.18.2 增量吸收 148 件 + 存量修复四路 + 专项收口，2026-11-14 执行）各批有意分歧已由执行者直登台账 34-39；本条按收口指令做**去重合并汇总索引**（指令原编「台账 34」，因 34-39 已被各批占用，按「编号一经分配不复用」规则顺延为 40），供下次上游同步一跳直达，明细不在此重复。

| # | 分歧 | 主登记 | 下次同步注意（一句话） |
|---|---|---|---|
| 1 | **前置 patch 决策推翻台账 30 对应项**——@ai-sdk 两 patch 根级回收，「按本仓既有删除保持」废止 | 台账 34 | 根级 patches/ 两件+patchedDependencies 两键常在；`allowUnusedPatches: true`（根 package.json:146）为 CLI 拆分拓扑适配器，上游无此键，workspace 并回上游时可删；CLI workspace 侧随迁件（apps/drora-cli/patches/）为 CLI 重装施加源 |
| 2 | **vendored 上游文档域恢复与 ignorePatterns** | 台账 38 | 974 件已从 theirs-v3182 逐字节恢复+.oxfmtrc 131 条域/文件登记；任何全仓 `pnpm fmt` 前先核豁免（台账 7/38 同族）；65 件内容差保留=A 类 53（zcode 冻结字面量 vs 旧改名形态，待逐字面量对代码冻结面仲裁）+B 类 12（自研/勘误内容，保 ours） |
| 3 | **persona fork 沿父链归属放行（安全面）** | 台账 37 | registerForkedSession 对 live 父的 fork 子会话走 kind=create 跳过子行 lineage 预检（forkChainAttributedToLiveParent 中文注释全文载裁定与调用方清单）；guard 不满足回落 restore 维持上游 fail-closed；非 fork 的 lineage 校验逐字不动；上游若重构 fork 注册链需重估本放行 |
| 4 | **build-sea 根脚本按拆分拓扑改写** | 台账 36 | root package.json build:sea:prepare 中段=七个根侧闭包选器（provider/provider-node/session-control/formal-proof/model-option-map/zcode-cua/rpc）、尾段=`pnpm --dir apps/drora-cli build`；上游单 workspace 形态不回抄；`--filter=!@drora/cli` 保留上游契约形状（从根恒空集） |
| 5 | **R3 zcode-cua 类型面补齐与冻结面维持** | 台账 37（+14/15 承继） | 三个 d.ts 对齐官方 0.6.5 桩（runtimeScope 字面量联合/BrokerLogger/injectPermissionBrokerAgentMcpServers/CuaRequestAccessStatus；actionTitle 为切段真字段上游桩漏列）；上游树 zcode-cua 测试/工程面 3 件（availability.test.ts/vitest.config.ts/tsconfig.json）沿冻结裁定不采纳（对齐复验 MISSING 3 件即其产物） |
| 6 | **上游共享文件的 win32 潜伏 bug 修复族**（对 theirs 的修复型分歧，防上游同步时误判为漏跟） | 台账 35/36/39 | subagent-workspace cygpath 捕获（`pwd -P \| cygpath -w -f -`）、SEA runtime win32 宿主执行位/EPERM 语义、credential-security 0o600→win32 观测 0o666 断言守卫、design-plugin resolveUsrBin 采集期兜底、promote-plugin-e2e:94 正斜杠归一——上游 CI 非 win32 不显形；上游后续版本自修则以 theirs 为准对齐复核 |
| 7 | **D5/R3/MOD-ABSENT 决策面维持**（本轮零变更，复验确认） | 台账 30/27（承 12/15） | 对齐复验 MISSING 8 件中 4 件=forceUpdateGuard/forceUpdatePrompt/manifestUpdateProvider/shared forceUpdate（D5 保删除）；1 件 docs 路径改名（drora-cua-permission-broker.md↔zcode-*，台账 38 顺带观察，S 批路径裁决面）；同步时这些缺失是预期终态 |

- **本轮增量吸收自身（148 件）零新增独立分歧**：7+1 件 conflict 全按既有台账规则解决——cli/package.json 保 ours 版本线（台账 1）、auto-update-source-security-smoke/test-installer-preserve-files 按台账 27/28 的 D5 语义/INPUTCHARSET 适配重放、host/index.ts 并集、upstream-snapshot.json regenerate 替代手工（台账 27/30 先例）、.gitignore 并集（`packages/desktop/build/generated/` 落位 :117）、settingService.ts 全取（shareCredentialKeyWithDataRoot 契约）。契约字面量增量随段落地并经收口 grep 实证：channels.ts:278 `ResetMicrophoneAccess="drora:reset-microphone-access"`（PlatformChannels zcode:→drora: 变换族）、:742/:817 `credential-key-share-{result,request}` 成套（Host↔Main wire 免改名）、services/setting/settingService.ts:271/:457。
- 执行计数、段门失败面（tc-s4 memory-diagnostics TS2307 及修复）、终验三轮与七门终态、对齐复验数字（87.98%→93.73%）全记录=`specs/upstream-v3.18.0-migration.md` §12。

## 台账 41：07 §5 项① / 06 §3.2 漏网项收口——mcp-runtime 死件修复 + EnterPlanMode 安全用例移植（2026-11-15 登记）

**条目①（本条唯一条目）**：`apps/drora-cli/packages/core/tests/mcp-runtime.test.ts` 复活收口，台账 39 ③登记的「core（mcp-runtime 语法死件）」待修项就此闭环。

- **死件根因（git 考古实证）**：b3e44cb2a（v3.17.2 合并）时该文件即已是死件（`git show HEAD:` 与工作树逐字一致）——合并把 theirs 的 EnterPlanMode 安全用例块与 `it.each` 头部（参数表、用例名、async 回调签名、toolStarted/releaseTool/refreshes/modelSteps 四个局部声明）一并丢失，残留回调体悬在 describe 顶层，`await toolStarted.promise` 落在非 async 作用域（TS parseDiagnostics :633 与 vitest :466:8 报错同源）；同时 bff94f4bd 引入的洞 1a/S03-P1-8 适配（回调内自声明放行 broker）被删头部带走，`permissionBroker,` 传参行成未定义死引用。
- **修复与移植**：按 theirs-v3182 变换树补回 EnterPlanMode 用例（theirs :410-471，`git show refs/upstream-trees/v3.18.2:apps/zcode-cli/...` 实证该块与官方原始树逐字一致、无品牌字符串需变换）与 it.each 头部（theirs :473-484），it 声明 8→9（it.each 展开 4，共 13 用例）；修复点中文注释载因。
- **复活后暴露的 3 处旧裁定残留，按台账 33（2026-11-14 总裁定）就近回退 theirs 原文**（非本轮新增分歧，裁定链依据=specs/agent-write-safety.md 顶部修订「洞 1a/S03-P1-8 deny 门废弃，改上游 checkPlanMode ask 语义」）：① lookup 工具 `annotations: { readOnlyHint: true }` 分歧（旧 deny 门要求自报收口）→ 删；② 第二次请求「Plan mode only allows…」拒绝文案断言（旧 deny 门语义；新语义下非 readOnly MCP 走 mode.plan.mcp ask、broker 放行即真实执行，tool 消息应为工具结果）→ 回退 theirs「lookup:plan context」断言；③ it.each 内 `permissionBroker,` 死引用（上游 v3.17.2 已自改 yolo 免审批，bff94f4bd 的 build+broker 适配前提消失）→ 删。三处均就地注释载裁定编号。终态与 theirs 全文 diff 仅剩 4 组中文裁定/修复注释，代码本体逐字一致。
- **验证（本会话实测）**：`pnpm --dir apps/drora-cli/packages/core exec vitest run tests/mcp-runtime.test.ts` 首跑 8 过/5 败（4×`ReferenceError: permissionBroker is not defined` :507 + 1×:383 拒绝文案断言，归因如上）→ 修复后 **13/13 全绿**（两次复跑一致）；`node --import tsx --test tests/mcp-runtime.test.ts` parse 层通过（无 SyntaxError，模块加载执行至 :17 describe——vitest suiteFn 需 vitest runner config，node:test 裸跑环境限制非语法问题）。
- **工具链态备注**：该文件不在 `scripts/drora-test-files.json` / `scripts/engineering-test-files.json` 双清单（grep 实证），验证入口为包内定向 vitest；文件位于根 `.oxlintrc.json` `apps/drora-cli/**` 忽略域（台账 35/39 既有登记态），语法与运行时正确性由 vitest 转换+全绿执行覆盖。

## 台账 42：07 §5 项②③④⑤⑥收口——三语死键登记/根侧生成物链闭合/K3 逐件证据发布/scheduler 与 pointer-input 补注（2026-11-15 登记）

**编号说明**：收口指令原编「台账 41 条目②⑤⑥」；执行时 41 已被 07 §5 项① 收口（mcp-runtime，:636）占用，按「编号一经分配不复用」规则（台账 40 在案）顺延为 42。上游基准=`refs/upstream-trees/v3.18.2` 变换树。本条为登记与生成物收口，零产品代码变更（唯一代码触面=pointer-input.ts 中文载因注释）。

- **② 三语 D9 死键构成登记（不搬，维持既有裁定）**：与 theirs-v3182 逐语 diff 实测（EOL 归一）——ja-JP 41 行/ko-KR 40 行/ru-RU 41 行 theirs-only，构成=每语 **38 键**+值续行（ja/ru 各 3、ko 2）：`settings.toolGrouping*`×6 + `chat.toolCall.explore.bucket*`×17（fetch/search/list/file 各 one/other/few/many + items）+ `executeGroup*`×5（label/command.one/command.other/failed/stopped）+ `changesGroup*`×5（label/file.one/file.other/tool.one/tool.other）+ `cua.group*`×5（completedLabel/event.one/event.other/message.one/message.other）。38 键/语言与 v3.18.0 轮台账 28 补删对象同集（上游 v3.18.2 三语仍漏删，非新增面）。双侧代码零消费实证：排除 locale 文件后全仓 grep（packages/+apps/，*.ts/*.tsx）ours 与 theirs 均 0 命中。处置=**不搬**（D9 功能回撤跟随裁定的推论；搬死键会与 en/zh 不一致）。en/zh 残余差=personalization 两键值差（ours "Custom Instructions"=2026-11-03 文案裁定，en-US.ts:1321/:3834 键在位，非结构差）。migration spec §12.2 S6 行表述已勘误（「5 locale 全 clean-merge（i18n 重放规则自动成立）」→分语如实描述并指向本条）。
- **③ 根侧生成物四件（CLI 拆分拓扑下的正确终态，非漏跟）**：
  - **npm-overrides.json 保持 ours**：条目级实测 ours 65 / theirs 63、同键 44 条内容全等；theirs-only 19 条（parse-bmfont-ascii/unsafe-pointer/quickjs-wasi/yoga-layout/@ai-sdk/provider-utils@4.0.39 与 @4.0.23/omggif/http-mitm-proxy/@tokenizer/token/semaphore/react-devtools-core/boolbase/exif-parser/rrweb 系@2.0.0/@electron-internal/extract-zip@1.0.5）经生产图探针（collectNpmNotices 同函数只读实测，根图 1,118 包）**全部不在根侧生产图**——它们是 CLI workspace 依赖域材料（上游根 workspace 含 `apps/drora-cli*` 故登记在根；本仓 CLI 独立 workspace 且无 third-party/ 目录），合入即触发 generate-third-party-notices.mjs:37-40 `Stale npm notice override` 打挂 notices 生成。ours-only 21 条（rrweb@2.1.6 系 5/@next@15.5.27 系 9/@img/sharp-libvips 系 6/client-only）全部在图内=本仓自研依赖材料必保。07 ③「ours-only 537/theirs-only 552 行」系缩进差（ours 1 空格 vs theirs 2 空格）致整文件 diff 的口径误读，条目级 true diff=+19（全 CLI 域）/−21（ours 材料）。
  - **embedded-components.json 不合入 QuickJS-NG**：theirs 新增条目 parentPackage=`quickjs-wasi@2.2.0` 同上不在根图，合入即 `Stale embedded component`（generate:92-93）。theirs-only 条目引用的 31 个材料文件已在 third-party/upstream/ 在位（材料在、登记缺）。台账 40#4「build-sea 按拆分拓扑改写、上游单 workspace 形态不回抄」在案裁定的推论。
  - **native-search/sources.json 零变更（自洽实证）**：inputs 2 项记录哈希与本仓实际文件 0 mismatch；除 inputs 外与 theirs 深度相等（其余 diff 全为数组折行格式差）；唯一哈希差=`scripts/native-search-tools-config.mjs`（ours 登记 f0a9b98c=本仓实际=theirs 树该文件实际 hash，双侧文件 diff exit 0 逐字节相同；theirs 登记的 7cadab53 为变换前 zcode 原稿哈希）。
  - **根 pnpm-lock 已收敛**：`pnpm install --no-frozen-lockfile` 实跑 exit 0（resolved 0/added 0），锁字节级不变（sha256 前后同 `04903bcc…`，备份=D:/workspace/tmp/upstream-v3.18.2/pnpm-lock.backup-20261114-220706.yaml）。degenerator@7.0.1 由 `pac-resolver@9.0.1(quickjs-wasi@2.2.0)` 驱动、位于 CLI 锁（apps/drora-cli/pnpm-lock.yaml:2828/:6429/:7529）；根图仅 pac-resolver@7.0.1→degenerator@5.0.1（根锁 :7163/:17482）——「5.0.1↔7.0.1 分叉随 regen 消差」的前提（根依赖图驱动）不成立，分叉=拆分拓扑预期形态非锁漂移。prepare 钩子副作用：`build:cua` 重建 packages/zcode-cua/mcp/*.js，相对 HEAD 内容差仅 server.js 16 处 `/* @__PURE__ */` 注解有无（esbuild 版本差、语义零差）+3 文件纯 EOL；install 为 no-op 故工具链前后一致、构建确定性，推断为既有工作树态（台账 34 当日重装已跑同一 prepare；无 install 前快照，标注为推断）。
  - **licenses 链闭合（check 基线红→绿）**：收口前实测 `node scripts/licenses.mjs check` **已失败**（noticesSha256 失配，third-party-notices.mjs:19）——工作树 third-party/inventory.json 系 S8 从 theirs 原样带入（与 theirs 变换树 EOL 归一后逐字节一致；inputs 3,461 项中 402 缺失（399 个 `apps/zcode-cli/*`）+288 哈希漂移、packages 1,189=上游单 workspace 口径），S8 标注的「K5 regenerate」实际未执行。本轮 `node scripts/licenses.mjs notices` 以本仓图重生成（1,118 package versions/21 copied/18 native archives，内建门禁全过 exit 0）后 **check 转绿**（2,092 实装包 exit 0；reviewRequired 20 项待补材料警告属 `--strict` 域既有待办，未跑 --strict）。regen 差异概要（改前备份=D:/workspace/tmp/upstream-v3.18.2/closeout-regen-backup-20261114-221444/）：packages 1189→1118（−192 上游 CLI 面/+121 本仓面：rrweb@2.1.6 系/@next 系/sharp 系/extract-zip@1.0.8 补入，quickjs-wasi/yoga-layout/degenerator@7.0.1/rrweb@2.0.0/@ai-sdk 旧版面移除）、inputs 3,461→3,437（`apps/zcode-cli/*` 399→`apps/drora-cli/*` 392）、embedded 2→1（QuickJS-NG 出、Skia 留）、copied 20→21、reviewRequired 19→20（CLI 域 6 项出、client-only+sharp-libvips 系 7 项入）、NOTICES 3,414,059→3,414,359 字节而 npm 条目集 1,118 不变（05 §4#109 的 @ai-sdk 三条目此前已在）。
  - **归档**：CLI 依赖域材料登记缺口（19 override 条+QuickJS-NG+31 材料文件在位）并入 05 §5#2 双锁补扫项（该行已扩容）——licenses 链生产图扩展到 CLI workspace=设计变更，须用户对齐后实施；根 NOTICES 经 prepare-prebuilds.mjs:1209-1212 与 build-drora.mjs:190-191 随 server/glm/agent 发行物分发，是 CLI 发行物唯一声明源，当前不覆盖 CLI 依赖域。
- **④ K3 逐件证据发布**：`docs/upstream-v3.18.0-diff-2026-11-11/08-k3-itemized-evidence.md`（1,164 件全覆盖=TOKEN_EQ 469+TOKEN_DIFF 695；判据列=asymLines/ours-only/theirs-only/Δtok/brand/ratio 与品牌占比分层 ≥90%×90、50–90%×1、<50%×604；sample.json 139 件分层抽样标注 `★sample:<层>`；代表实体 IntlProvider.tsx/ConversationDraftEmptyState.tsx 行位在表）。数据=residual-audit 三 TSV 汇编（未重跑度量脚本，06 §3.3「终审采信脚本集口径」标注沿用）。07 §5④/§6.2#4 开口解除。
- **⑤ run-production-build.test.ts:52 scheduler 断言（ours-only 自研适配，不跟上游）**：断言对象=本仓 `resolveDesktopProductionCleanPaths` 清理清单（run-production-build.mjs:20-22 含 `out/scheduler` 行+中文载因：tsup 打包态与 tsc 声明态产物互相覆盖、陈旧 chunk 跨构建代残留会被 `out/**/*` 打进 app.asar 重新暴露未压缩 JS 与 sourcemap）。scheduler 构建面双侧同构（tsconfig.scheduler.json ours/theirs 仅缩进差、outDir 同 out/scheduler、package.json 双侧均无 scheduler 接线），但 theirs 清理清单（theirs run-production-build.mjs:16-25）与测试断言均无 scheduler 行——本仓在双侧共享的构建面上加了清理加固，:52 断言是该自研实现的回归锚点。07 勘误方向（自研非上游缺失）成立。
- **⑥ pointer-input.ts win.show()/win.focus()（ours-only 既有 win32 适配，不跟上游）**：theirs fixture 直接 debugger.attach（无此两行，:7 实读）；ours 在 attach 前显式 show+focus，:6-11 中文载因注释已补——CDP Input.dispatchMouseEvent 走合成器通道不要求前台，但用例链后续断言 document.activeElement=#input（:55）并以 Input.insertText 注入文本（:60-62）；Windows 前台锁在 e2e 无人交互授权环境下拒绝隐式前台切换，后台窗口收不到键盘焦点时 insertText 会派发到错误目标或被丢弃。
- **验证（本会话实测）**：`pnpm typecheck` exit 0；`pnpm lint` 826 warn/0 err exit 0（与 §12.2 基线零差分）；`pnpm fmt:check` 7,503→7,504（08 证据文档经 `oxfmt --write` 格式化后仍净 +1：该 +1 件无台账 38 基线清单可归因，已逐项排除 pointer-input.ts(报告 0 命中)/THIRD-PARTY-NOTICES.md(ignorePatterns 豁免域)/third-party/inventory.json(0 命中)/migration spec(编辑前后句对抗测试同判 issue=既有债)；08 格式化后报告 0 命中）；`node scripts/licenses.mjs check` 绿（见③；其收口前红为既有失败非本轮引入）。

## 台账 43：10-plugin-audit §三.1/§四 非 obsidian 域收口——zcode-cua-plugin verbatim producer 脚本链 A 方案处置 + schema.baseline 表序差补登（2026-11-15 登记）

**编号说明**：10-plugin-audit §三.1（producer 脚本链）用户裁定 A 方案=保 verbatim+登记；§四 LOW 卫生项同批修复（各自就近载因），分歧登记面收口于本条。

- **① producer 脚本链 verbatim 保真（休眠态，不接 CI、不进测试清单）**：`apps/drora-cli/packages/zcode-cua-plugin/scripts/` 的 5 件（check-version-coherence / check-cua-baseline / bump-zcode-cua-producer / sync-skill-from-zcode-cua / resolve-pnpm-invocation）为官方仓 verbatim 移植（比本仓跟踪树 v3.18.2 更新的官方 producer 链形态；v3.18.2 树仅含 check-sdk / computer-use-client / sync-cache 三件，`git ls-tree refs/upstream-trees/v3.18.2:apps/zcode-cli/packages/zcode-cua-plugin/scripts` 实证）。在本仓**手跑必红**的两根因（本会话实测均 exit 1）：
  - **官方契约名断言**：`check-version-coherence.mjs:130` `packageJson?.name !== "@zcode/zcode-cua"`——本仓 workspace 包名为 `@drora/drora-cua`（packages/zcode-cua/package.json:2），实测报 `[cua-version] installed producer is missing the Windows Helper runtime contract` exit 1；
  - **官方仓硬路径**：`check-cua-baseline.mjs:30` 读 `upstream.json` 实测 ENOENT exit 1；同族 `check-version-coherence.mjs:59` 与 `bump-zcode-cua-producer.mjs:250` 硬编码 `apps/zcode-cli/...` 路径（本仓为 apps/drora-cli 拆分拓扑，走到即 ENOENT）。
  处置=保持 verbatim 不适配（价值=下次官方同步时的字面量/行为对照参照物，改写即失效），登记文档=`apps/drora-cli/packages/zcode-cua-plugin/docs/producer-scripts.md`（包内无 README 故落 docs/）。随批同包两补：**tsconfig.json 补齐**（v3.18.2 原文 336B 逐字节落位，零品牌串免变换；本包与官方一致无 src/，`tsc -p . --noEmit` 双侧均为 TS18003 预期休眠态）；**package.json test 修正**（`pnpm run build && node --test tests/*.node-test.mjs` 悬空——0.6.5 producer 测试面未随迁、包内无 tests/ 目录，改为空操作+注释，`pnpm test` 实测 exit 0；官方 v3.18.2 的 test 形态 `node scripts/check-sdk.mjs` 已由本包 build/typecheck 脚本承载）。
- **② schema.baseline.sql 表序差补登（语义等价生成顺序差，非漏跟）**：`apps/drora-cli/packages/adapters/src/storage/session-store/schema.baseline.sql` 的 `drora_database_identity` 建表位置本仓=文件头部（:1），官方 v3.18.2 对应文件=`zcode_database_identity` 在 :419（`git show refs/upstream-trees/v3.18.2:...` 实证；双侧均 907 行、146 对象一致）。差异=identity 块生成顺序差，无语义影响；specs/upstream-v3.18.0-migration.md:254（"本仓 drora_database_identity 位置（首部）保留"）与 :260（clean-merge 差=identity 块位置）在案，02-gap-list A11 域审计同批。services 侧 `packages/services/src/project-storage/schema.baseline.sql` 双侧 253 行无 identity 表、零差（排除项）。
- **③ 同批 LOW 修复就近登记索引（非本条分歧面）**：zcode-cua src/ 还原标记两档口径统一（specs/win32-cua-0.6.5-implementation-design.md §七.7）；stage.test GNU tar `--force-local`+win32 x 位断言守卫、embedded-build-id non-darwin SKIP 守卫、CONTRACT.md 1.3.0→1.4.0、services node_modules 旧名 @zcode/zcode-cua junction 删除（10-04 残留，无消费方引用 grep 实证，目标 packages/zcode-cua 完好）、mcp-server.test.ts:351 文案勘误（drora-cua-plugin→zcode-cua-plugin）——均为注释/测试/文档/登记面，中文载因在各文件就地。

## 台账 44：语音收编整合——官方服务端 ASR 收编为自研第 4 引擎 + composer 单入口互斥（2026-11-15 登记，D6 升级用户裁定）

**上游行为**：官方 v3.18.0 起 composer 自带语音输入链路（`packages/ui/src/voice-input/` + `packages/services/src/voice-input/voiceInputService.ts`——drora-server realtime ASR：ticket → WS → PCM16 上行/result/completed 事件）+ 登录态 mic 按钮（`useComposerVoiceInput` → `VoiceInputButton`，wdio E2E 17 例 `packages/desktop/test/e2e/ui-shell/composer/composer-voice-input.test.ts`）。本仓此前另有自研语音体系（`packages/ui/src/voice/`，specs/voice-agent-integration.md：VoiceAsrPort 三引擎 webSpeech/remote 批量/豆包流式 + TTS + 系统级听写 §5.6），两套 mic 入口并存。

**本仓行为**（用户裁定 D6 升级，决策与验收冻结于 specs/voice-agent-integration.md §11）：
- **官方 ASR 收编为第 4 引擎（`official`）**：新自研文件 `packages/ui/src/voice/officialServerAsrAdapter.ts` 实现既有 VoiceAsrPort——注入句柄（结构即官方 IVoiceInputService，装配点 `useVoiceEntrySupport`/`useVoiceComposerEntry` 从 useBaseWorkspaceServices 直传真实服务对象）、采集复用本模块 `pcmStreamCapture`（与豆包 sauc 同格式 16k/mono PCM16；官方 startPcmCapture 属 voice-input 模块内部件不在其 publicEntrypoints，架构治理禁 deep-import，官方采集件保持官方链路自用）、权限预检注入官方 `microphone.ensureAccess`；事件映射 result→onPartial / completed→onFinal 恰一次+stop 空串（对齐 remoteAsrAdapter 批量交付契约）/ error→§11.2 错误码映射。
- **单入口互斥**：官方 `VoiceInputButton` 渲染谓词单一出处 `resolveOfficialVoiceButtonVisible`（voiceComposerEntryState.ts 纯函数层，ConversationComposer 消费）——自研 voice 入口可见时官方按钮让位；可见性派生抽 `useVoiceEntrySupport.ts`（新文件）供入口 hook 与互斥门共用（不建第二判定源）。
- **官方还原文件零改动**：`packages/ui/src/voice-input/`、`packages/services/src/voice-input/`、`useComposerVoiceInput`、microphone-access 平台实现零行改动（桥接全部在新文件；方向=自研只读 import 官方）；TTS/豆包流式/系统级听写全保留。
- **E2E 兼容策略**：互斥门条件=「自研入口可见才隐藏官方按钮」；默认 `voiceComposerEntryHidden=true`（§6.1 开关 1 默认隐藏）→ 官方按钮照常渲染 → 官方 17 例语义不变（静态断言钉在 `officialVoiceButtonGate.test.ts`）。
- 引擎枚举扩展落点：`contracts/modelCapabilities.ts` asr.engine + `"official"`（档案默认仍 webSpeech——收编是能力归一非默认切换，理由：official 改变音频数据去向且依赖登录态，spec §11.2）；`drora-protocol-v4/input-intent.ts` engine 枚举同步 additive（renderer 现零生产方，附录 C CLI-first 门禁维持）。

- **依据**：specs/voice-agent-integration.md §11（2026-11-15 增补，含验收场景）；适配器 `packages/ui/src/voice/officialServerAsrAdapter.ts`；路由 `packages/ui/src/voice/resolveAsrAdapter.ts`（officialSupported 缺省 false fail-closed）；装配 `packages/ui/src/voice/useVoiceEntrySupport.ts`；互斥门 `packages/ui/src/v4/ConversationComposer.tsx`（官方按钮渲染条件 + 中文载因注释）；测试 `officialServerAsrAdapter.test.ts` / `officialVoiceButtonGate.test.ts` / `resolveAsrAdapter.test.ts` / `V4ComposerVoiceEntry.test.tsx`（official 回退回归）。
- **下次同步注意**：上游若改官方 voice-input 模块（事件形状 `VoiceInputEvent`、`IVoiceInputService` 方法签名、`startPcmCapture` 采集契约、`microphone.ensureAccess` 返回值），桥接句柄 `OfficialServerAsrEngineHandle` 的结构兼容会先在 typecheck 红——按「适配器放宽 string code 兜底 network」的既有映射语义对齐，不改官方文件；上游若给官方按钮加新渲染条件，`resolveOfficialVoiceButtonVisible` 的 officialAvailable 输入侧（voiceInput.available && remoteAvailable）在 ConversationComposer 组合点同步；官方 wdio 17 例与本仓互斥门共存的前提=默认 voiceComposerEntryHidden=true 不变（该默认值属 §6.1 冻结裁决）。
