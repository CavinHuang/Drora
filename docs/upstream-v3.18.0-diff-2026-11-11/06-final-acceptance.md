# v3.18.2 对齐终审验收报告（06-final-acceptance）

- 日期：2026-11-14；撰写：终审判定员（独立于执行方与三路审计，未参与任何战役执行，本会话只读复核）
- 审计对象：工作树态（分支 `codex/upstream-v3.18.0-integration`，HEAD 4c9be763b + 未提交的 v3.18.0/v3.18.2 两轮战役成果）
- 对照基准：`refs/upstream-trees/v3.18.2`（实测在库，`git cat-file -t` = tree、`git rev-parse` = `b479ec68bc6fd0034bef05bd146143bdfeb58ede` ✓ 与任务给定 b479ec68bc 一致）；变换树 `C:/Users/A/AppData/Local/Temp/dryrun/theirs-v3182`（实测在库）
- 输入材料：执行方自报 `specs/upstream-v3.18.0-migration.md` §12（:342-409，本会话实读）、`specs/drora-divergence-ledger.md` 台账 34-40（:408-634，本会话实读台账 40 :619-634）、`docs/upstream-v3.18.0-diff-2026-11-11/05-remaining-gaps.md`（186 行全读）；三路独立审计材料（确定性复核、剩余差异审计、主题落位、契约与门禁，由本 ask 提供）。
- 方法：材料不轻信——关键声明逐条独立复测（命令与输出见各节），其余按三路审计的程序化口径采信并如实标注"未复核"。
- **收口指针（2026-11-15）**：本报告 §6 行动项（漏网 1 项 + 存疑 5 项动作）已由后续收口批全部执行完毕——逐项证据与终态见 `07-three-version-acceptance.md` §5 对照表 + 头部/尾部收口批注（登记=分歧台账 41/42）；收口门通过，收口后对齐复验 93.72%（`final-alignment-post-close.tsv`）。本报告正文「完整对齐 = 否」裁定为 2026-11-14 审计时点快照，其遗留条件至此解除。

---

## §1 裁定

**完整对齐 = 否。**

一句理由：生产代码增量（148 件）与 13 个主题全部落位、typecheck/lint 硬门实测全绿、契约字面量四族无撕裂，但「零未解释」不成立——存在 **1 项漏网**（theirs 的 EnterPlanMode 权限安全测试用例 ~74 行本仓全库零存在且无内容面裁决）与 **6 组未闭环存疑**（含『5 locale clean-merge 自动成立』声明与 locale 死键实际不符、根侧生成物 regen 登记缺口、K3 逐件证据未发布），终审另勘误 2 处存疑项的方向（实为本仓自研适配未登记，非上游新增未跟）。差距窄、明确、可收口，但按验收口径不判"是"。

---

## §2 确定性复核

### 2.1 新鲜度（本会话实测：上游未过 v3.18.2，无新差距源）

- `gh api "repos/zai-org/ZCode/releases?per_page=5" --jq '.[].tag_name'` → 输出 `v3.17.2 / v3.17.1 / v3.14.3`；`tags?per_page=5` → `v3.17.2 / v3.17.1 / v3.15.1 / v3.14.3`。**上游官方 release/tag 仍止于 v3.17.2**，v3.18.x 无 tag 无 release bundle——与 05-remaining-gaps.md §5#1（:177）2026-11-14 实测一致，本轮终审（2026-11-14）复测无变化。
- 结论：对照基准 `refs/upstream-trees/v3.18.2` 仍是可得的最新上游树形态；**无新版本差距源**。D10 bundle parity（对原版 release bundle 跑 `check-bundle-key-parity`）维持挂起，属外部条件项（官方发布后触发）。

### 2.2 对账复算 vs 声明（本会话独立复算，全部吻合）

| 项 | 声明（§12.5 / 材料） | 终审实测（命令） | 结论 |
|---|---|---|---|
| 复验 TSV 行数 | 1,164 DIFF + 8 MISSING = 1,172 | `wc -l final-alignment-recheck.tsv` = 1,172；`awk -F'\t' 'NR>1{c[$1]++}'` = DIFF 1163+MISSING 8（首行即数据行 DIFF，合计 DIFF 1,164） | ✓ |
| recheck 与 after 两 TSV 一致性 | cmp 逐字节一致无漂移 | `cmp final-alignment-recheck.tsv final-alignment-after.tsv` → `CMP_IDENTICAL` | ✓ |
| 对齐率 | 93.73%（17,508/18,680 等价） | 18,680−1,172=17,508，17,508/18,680=93.73%（据复算行数推算，与声明自洽） | ✓ |
| MISSING 8 构成 | D5 4 + R3 3 + docs 改名 1 | `grep -P "^MISSING"` 实测 8 行：`packages/desktop/src/main/forceUpdateGuard.ts`、`forceUpdatePrompt.ts`、`manifestUpdateProvider.ts`、`packages/shared/src/forceUpdate.ts`（D5）+ `apps/drora-cli/packages/zcode-cua-plugin/tsconfig.json`、`packages/zcode-cua/test/availability.test.ts`、`packages/zcode-cua/vitest.config.ts`（R3）+ `docs/cua-permission-broker/zcode-cua-permission-broker.md`（改名，ours 侧 `drora-cua-permission-broker.md` 在位） | ✓ 与台账 40#5/:629、:631 裁决链一致 |
| patchedDependencies | 根 9 键含 @ai-sdk 两键 + `allowUnusedPatches: true` | `node -e "…Object.keys(p.pnpm.patchedDependencies)"` → 9 键（含 `@ai-sdk/anthropic@3.0.81`、`@ai-sdk/openai-compatible@2.0.60`）+ `allowUnusedPatches: true` | ✓ |
| 版本面（T13） | 根 3.18.2 | `package.json:3` = `"version": "3.18.2"`、`package-lock.json:3` 与 `:9` 双处 3.18.2 | ✓ |
| 主题锚点抽验 | 主题落位材料 13 件 file:line | 抽验 6 件全部吻合（见 §4） | ✓ |

- 三路审计的独立度量（1,164 件中 469 词元等价 + 695 词元差；docs 65 件与台账 38 A53+B12 双向核对；12 件"已转绿"件等价性抽验）为程序化结论，脚本与中间产物在 `D:/workspace/tmp/upstream-v3.18.2/residual-audit/`——**本终审未重跑该脚本集**，采信其口径并标注。

---

## §3 剩余差异核验

### 3.1 三路审计 verdict（采信 + 关键项独立复测）

> 确认有据 228 / 存疑 11 / 漏网 1（触达 240/1,172 件口径，三层方法：程序化全量 + 实读 diff ~165 件 + 特别全查；剩余 ~930 件按域分布推定同构，469 件词元等价已程序化证明语义零差）。「零未解释」声明**不完全成立**。

### 3.2 漏网 1 项（终审独立复测：成立）

**`apps/drora-cli/packages/core/tests/mcp-runtime.test.ts` 缺 theirs 的 EnterPlanMode 权限安全用例（~74 行）**

- 终审实测：
  - theirs：`grep -c 'it(' theirs-v3182/.../mcp-runtime.test.ts` = **9**；`:411` `it("does not let EnterPlanMode unlock MCP tools without approval", …)`，`:410` 注释明载安全语义「EnterPlanMode 免确认；进入 Plan 后调用 MCP 仍须用户确认，模型不能借进入 Plan 绕过审批」，用例体 `:447` 构造 `toolCalls: [{ name: "EnterPlanMode", … }]`。
  - ours：`grep -c 'it('` = **8**；`grep -n "EnterPlanMode"` 全文件**零命中**；全库 `grep -rn "unlock MCP tools" apps/drora-cli/` 仅 theirs 侧命中。
- 裁决缺口：台账 32/39（ledger :297/:609）仅登记该文件『await 语法死件』运行面（HEAD 同败），无内容面裁决；05 §2.1（:92）『CLI 域 270 件有据保留、无代码级语义缺口』按字面被推翻——测试代码亦是上游实现的一部分，且此例涉权限安全语义（与上轮 video patch 同类的真差距）。
- 行动：补跟 theirs `:410-484` 用例（文件本身是语法死件，宜先修死件再整文件对齐 theirs 并保留 plan-mode 自研语义注释），台账补登内容面裁决。

### 3.3 存疑 6 组（全列；含终审方向勘误 2 处）

| # | 项 | 三路审计认定 | 终审独立复测 | 勘误/备注 |
|---|---|---|---|---|
| 1 | `packages/ui/src/i18n/locales/ja-JP.ts + ko-KR.ts + ru-RU.ts` 各缺 theirs 死键 ~41 行 | 双侧代码零消费、en-US 皆无此键、无功能影响；但 §12.2（:359）『5 locale 全 clean-merge（i18n 重放规则自动成立）』与实际不符，且 §12.5 构成声明无归属 | `grep -c toolGrouping` 实测：ours 三件全 0，theirs 三件全 6；en-US 双侧 0；`grep -rn toolGrouping packages/ui/src --include=*.tsx -l | grep -v locales` → zero consumers；`diff`（EOL 归一）ja-JP theirs-only 行数实测 **41** | **成立**。上游功能回撤后的 locale 残留死键未搬，属可接受但须登记的差异 |
| 2 | 根侧生成物 regen 无登记触发（`third-party/npm-overrides.json` 553 行 theirs-only / `embedded-components.json` 缺 QuickJS-NG / `native-search/sources.json` 哈希 / 根 `pnpm-lock.yaml`） | 05 §5#2（:178）双锁补扫只覆盖 CLI workspace 侧；实证 degenerator@5.0.1（ours）↔@7.0.1（theirs）且双侧 package.json 均无 pin | 未逐项重算依赖树（采信审计实证）；登记缺口成立 | **成立**。K5 归类有据但收口动作缺位 |
| 3 | `packages/desktop/test/run-production-build.test.ts:52` theirs-only 1 行 | 『`/repo/packages/desktop/out/scheduler` 断言项无登记解释，方向待确认（上游新增 or 本仓删）』 | 实测 **ours 有、theirs 无**（ours :52 含 scheduler 行，theirs 同块无）；v3.18.0 基线树（`Temp/dryrun/theirs`）亦无；`git show HEAD:…:52` 已存在；本仓 `packages/desktop/tsconfig.json:9` 引用 `tsconfig.scheduler.json`、`e2eDesktopBuildCache.test.ts` 同族引用 out/scheduler，theirs-v3182 无 `src/main/scheduler` 目录 | **终审方向勘误：非 theirs-only，实为 ours-only 本仓自研构建 project（scheduler）适配**。风险降级为"自研适配未登记"，行动改为台账补注而非跟上游 |
| 4 | `packages/desktop/scripts/mcp-apps-host-fixture/pointer-input.ts:6-7` theirs-only 2 行 | 『win.show()/win.focus() 疑似 win32 焦点适配但无注释无台账，方向待确认』 | 实测 **ours 有、theirs 无**；v3.18.0 基线树无；`git show HEAD:…:7-8` 已存在（战役前既有） | **终审方向勘误：非 theirs-only，实为 ours-only 本仓既有适配**（HEAD 已在，非本轮引入）。仍无注释无台账，须补注 |
| 5 | 『本仓旧实现 vs 上游新实现』存量形态差（代表：`ConversationDraftEmptyState.tsx:95,213-255` greeting ours useState 版 vs theirs useRef 测量版；`IntlProvider.tsx:699-705` document 守卫双侧不同实现） | 六域审计以 K3『等价形态』总括，逐件证据 JSON 未随 05 发布，语义等价性未逐件复核 | 未逐件复核（材料自认）；维持存疑 | 逐件证据未发布即不可验收为"已证"，须发布或下次同步逐件重估 |
| 6 | 悬置仲裁项登记统计 | 05 §5 六项 + commit 后三件 + A 类 53 件字面量仲裁 + normIfText 工具债（台账 27）+ upstream-cli 6 红包基线族 = 11 项在案；审计另发现根侧 regen 缺登记（即 #2） | 与 05 §5（:175-182）、§12.6（:409）、台账 40 交叉核对一致 | **成立**（在案，非新差距） |

### 3.4 抽验面结论（采信）

抽验面内有据率 228/240；特别全查（theirs-only≥20 行源代码 31 件逐读、MISSING 8 件、patch 三处、public 12 图标、third-party 6、根散件 8、二进制品牌件）未见其他漏网。剩余 ~930 件未逐件实读为**审计方法边界**，非"已验证等价"——其中 469 件词元等价已程序化证明，其余按域分布推定同构。

---

## §4 主题落位表

三路审计判定 13/13 全部在位。终审独立抽验 6 项锚点（本会话实测）：

| 主题 | 审计锚点（采信） | 终审抽验（命令/实读） | 结果 |
|---|---|---|---|
| T1 CLI 内存诊断 | `packages/shared/src/memoryDiagnostics.ts:10-16` 常量组；adapters 8 源码件；v4-gateway :3085-3097 八计数 | `sed -n '10,16p'` 实测：`CLI_MEMORY_MAX_FILES=16 / MAX_FILE_BYTES=64*1024 / MAX_SAMPLES=8 / MAX_ALLOCATIONS=32 / MAX_STACK_DEPTH=8 / FILE_PATTERN` ✓；`ls adapters/src/memory-diagnostics/` = CONTRACT.md/contract.example.ts/contract.ts/index.ts/module.ts/recorder.ts/storage.ts/types.ts 8 件 ✓ | 在位 |
| T2 凭据安全 | channels.ts :742/:817 credential-key-share 对；systemCredentialCipher.ts:333；Linux 回退 main/index.ts:313-322 | `sed -n '742p;817p' channels.ts` 实测两键字面量在位 ✓ | 在位 |
| T3 Start Plan 国内登录 | model-provider-family.ts:141-147；oauthService.ts:811/:1134 | 未逐行复测（采信三路审计 theirs 同位比对） | 在位（采信） |
| T5 麦克风权限 | channels.ts:278 `drora:reset-microphone-access`；tccutil；四态契约 platform.ts:396 | `sed -n '278p' channels.ts` 实测 `ResetMicrophoneAccess: "drora:reset-microphone-access"` ✓（契约与门禁审计另证：原始上游 git show 为 `zcode:` 前缀，drora 变换正确，git grep `zcode:reset-microphone-access` 零残留） | 在位 |
| T6 字体平滑 | store/index.ts:71 键；BROADCAST_FIELDS:258；styles.css:111 | `sed -n '71p'` 实测 `const FONT_SMOOTHING_STORAGE_KEY = "drora-macos-font-smoothing"` ✓（原始上游为 `zcode-` 前缀，变换正确） | 在位 |
| T7 Windows 安装器 | C++ helper 三件 + CMakeLists:7 + electron-builder:636 `DRORA_INSTALLER_PROCESS_HELPER` + installer.nsh:17 | 未复测构建链（构建级验证本轮未执行，属执行方已声明的构建期事项） | 在位（采信）；构建验证未跑 |
| T8 流式渲染 #185 | QueuedSummaryContent.tsx:129 子组件；:107-112 静态路径；min-w-0 :221/:225 | `grep -n` 实测 `:105`（#185 根因注释）、`:117` AnimatedSummaryContent 消费、`:129` 子组件定义、`:221/:225` min-w-0 ✓ | 在位 |
| T9 徽标全宽换行 | InteractionRequestOriginBadge.tsx:36-46 | 未复测（采信） | 在位（采信） |
| T10 enterRequest 整删 | 目录零文件、引用零残留（git grep）；上游保留的 ENTER_STATE 与 theirs 同在位 | 采信（材料含 gitignored dist 残留备注，非源引用） | 在位（采信） |
| T11 面板布局 | WorkspaceShellLayout.tsx:2973 `minSize={… "360px"}` | 未复测（采信） | 在位（采信） |
| T12 手机远控历史 | WebRemoteControlMobileShell.tsx:25-41 replaceState 策略；e2e remote-task-open.mjs:347/:361/:365 | `grep -n droraMobilePage` 实测 `:17-22` 类型守卫在位 ✓ | 在位 |
| T13 版本与家务 | package.json 3.18.2 + lock 双处 + README×2 | `grep -n '"version"' package.json` → `:3 "3.18.2"`；package-lock.json `:3`/`:9` 同值 ✓；CLI 侧 0.1.0 为台账 1 登记的独立版本线分歧，非漏账 | 在位 |

改名面无撕裂：抽验的 4 个品牌字面量（`drora:reset-microphone-access` / `drora-macos-font-smoothing` / `credential-key-share-*`（免改名，不含品牌词干）/ `droraMobilePage`）均与 theirs-v3182 变换树双侧同值。

---

## §5 契约与门禁

### 5.1 契约字面量五族（采信契约与门禁审计，抽验吻合）

| 族 | 结论 | 要点 |
|---|---|---|
| `zcode:reset-microphone-access` → `drora:reset-microphone-access` | 通过 | 原始上游 `git show refs/upstream-trees/v3.18.2:…channels.ts:259` 为 zcode 前缀；工作树 :278 与 theirs-v3182 :259 逐字一致；microphone-access 6 文件 `diff -r` IDENTICAL；`git grep zcode:reset-microphone-access` 零残留 |
| credential-key-share 两键 | 通过 | 免改名正确（字面量不含品牌词干），与原始上游逐字相同，wire schema validation.ts:1057/1066 在位 |
| `zcode-macos-font-smoothing` → `drora-macos-font-smoothing` | 通过 | 变换正确、与 theirs-v3182 :71 同行同文；终审抽验一致 |
| env/权限/V4 方法/诊断码四族零变化 | 通过 | 审计对 v3.18.0→v3.18.2 全量 diff（10,143 行）四族正则复扫各 0 命中；变更集 123M+24A+1D=148 与 §12.2 一致 |
| @ai-sdk patch 键与 patches/ 文件 | 通过 | 两 patch sha256 双侧一致（5139a9d6…/df8af1ab…）；终审实测根 patchedDependencies 9 键含两 @ai-sdk 键 + `allowUnusedPatches: true`（package.json:146） |

### 5.2 门禁（终审本会话独立复跑两项硬门 + 采信定向复跑）

- **`pnpm typecheck` → exit 0**（终审复跑，全链 @drora/session-control + tsc -b 六 tsconfig + bootstrap --noEmit 全过）——与 §12.6（:401）一致。
- **`pnpm lint` → exit 0**，`Found 826 warnings and 0 errors`（`Finished in 499ms on 6313 files`）+ session-control boundary 检查过——与 §12.6（:402）826 warn/0 error 一致。826 warn 为既有面（含 hooks 依赖告警族），非本轮新增（三路审计与 §12.2 段门记录一致）。
- 三红族定向复跑（采信契约与门禁审计）：① tui segfault——tsx 直跑 `Segmentation fault`/EXIT=139 复现，文件与 HEAD 一致，外部原生归因成立；② core mcp-runtime 语法死件——`git diff HEAD` 0 行=HEAD 同败、`node -e require` → SyntaxError、vitest `:466:8 ERROR: "await" can only be used inside an "async" function`，确定性死件非负载；③ bootstrap 负载族——文件级隔离复跑 74s 唯一败=win32 无 zsh 断言（台账 32 登记/台账 39 豁免项），两个 15s 超时项单测复跑双绿。备注：台账 39『逐一隔离复跑全绿』措辞与文件级实测有出入（文件另含登记 win32 项），建议改『负载超时项全绿（文件另含台账 32 win32 项除外）』。
- **本终审未跑**：`test:architecture` / `fork-isolated` / `test:drora` / `test:unit:node` / `test:upstream-cli` 五门及 Windows 实机构建（T7）——采信 §12.6（:403-407）与台账 39 终态，如实标注未复核。upstream-cli exit 1 的 6 红全部归入登记基线族（C 类=0）。

---

## §6 遗留与建议

### 6.1 漏网项行动（阻断"完整对齐"的唯一实差）

1. `mcp-runtime.test.ts` 补 theirs `:410-484` EnterPlanMode 权限安全用例：先修 `:466` await 语法死件使文件可运行，再整文件对齐 theirs 并保留本仓 plan-mode readOnlyHint 自研拒绝语义注释；台账补登内容面裁决（现台账 32/39 只有运行面）。修后 `pnpm test:upstream-cli` core 包将少一个登记基线族。

### 6.2 存疑项行动（登记与收口，非代码差距）

2. locale 死键：在 §12.2/台账补记 ja/ko/ru 三件差异构成（上游功能回撤后残留死键未搬，双侧零消费无功能影响），或按 theirs 全量底重放消差；同步修正『5 locale clean-merge 自动成立』表述。
3. 根侧生成物 regen：把 `third-party/npm-overrides.json`、`embedded-components.json`、`native-search/sources.json`、根 `pnpm-lock.yaml` 四件并入 05 §5#2 双锁补扫登记（regen 触发条件+哈希对账）；degenerator 5.0.1↔7.0.1 分叉已证根锁滞后。
4. **方向勘误两处**（终审新发现，见 §3.3#3/#4）：`run-production-build.test.ts:52` scheduler 断言与 `pointer-input.ts:6-7` win.show/focus 均为**本仓自研/既有适配（ours-only，HEAD 已在）**而非 theirs-only——三路审计的方向标注有误；行动改为台账补注自研依据（scheduler=tsconfig.scheduler.json 构建 project；win.show/focus=窗口焦点适配），不需要跟上游。
5. K3『等价形态』逐件证据（greeting useRef 版、IntlProvider 守卫等族）：发布六域审计逐件证据 JSON，或下次同步时逐件重估；证据未发布前不得计为"已证等价"。

### 6.3 悬置仲裁与外部条件项（在案，非本轮差距）

6. 05 §5 六项外部条件：D10 bundle parity（v3.18.2 无官方 release，终审复测上游 releases/tags 止于 v3.17.2）、CLI 双锁补扫、CDN 图标资产确认、oxfmt 0.47 升级收口、opentui native segfault、上游自带缺陷（session-store 0025/mcp_tool_use skip）。
7. A 类 53 件 docs 冻结字面量逐案仲裁（台账 38/40#2）、normIfText 工具债（台账 27）、persona fork 安全语义放行（台账 37/40#3）维持登记跟踪。
8. commit 后三件不变（§12.6 :409）：architecture snapshot regenerate（核对基准 ref=v3.18.2）、`pnpm verify:pre-push`、`pnpm test:engineering:affected --scope push`——前置为干净树，本轮工作树态未跑，**未复核**。

### 6.4 终审方法边界（如实声明）

- 终审独立复测覆盖：上游新鲜度（gh api）、TSV 复算与 cmp、MISSING 8 枚举、patchedDependencies、版本面、漏网项全文比对、locale 死键双侧 grep+diff、两处方向勘误（三树对照+HEAD 对照）、主题锚点 6 件、typecheck/lint 两硬门复跑。未覆盖：1,172 件逐件实读、七门中五门、T7 Windows 构建、K3 逐件等价性——均标注采信来源。本报告为只读审计产物，未修改任何产品文件（仅新增本报告文件）。
