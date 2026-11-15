# 07 三版本完整性验收（v3.18.0 / v3.18.1 / v3.18.2）

- 日期：2026-11-14；撰写：三版本判定员（独立审计，只读不改代码，未参与任何战役执行）
- 审计对象：工作树（分支 `codex/upstream-v3.18.0-integration`，HEAD 4c9be763b + 未提交的 v3.18.0/v3.18.2 两轮战役成果）——即「三版本合并终态」
- 对照基准（本会话实测在库）：`refs/upstream-trees/v3.18.0=736aed13f`、`v3.18.1=bfd25ee60`、`v3.18.2=b479ec68b`（`git for-each-ref` 三行全中）；变换树 `C:/Users/A/AppData/Local/Temp/dryrun/theirs`（v3.18.0）、`theirs-v3182`（v3.18.2）；v3.18.1 无磁盘变换树，按 `git show refs/upstream-trees/v3.18.1:<path>` + 改名映射对照
- 输入材料：区间清单 `D:/workspace/tmp/upstream-v3.18.1/diff-3180-to-3181.txt`（111 条）与 `diff-3181-to-3182.txt`（46 条）、`bc-intersection.txt`（43 件）、`three-version-stats.json`；归因审计材料（43 件逐件归因 + 19 新文件双等 + 改名补审 7 件）与未决项复核材料（7 项）由本 ask 提供；既有报告 04/05/06 本会话实读
- 方法：材料不轻信——区间数字、口径脚本、43 件中 ~20 件的 B/C marker、19 新文件在位性、未决项 7 项证据、登记面行号均本会话独立复测（命令与输出见各节）；未逐行重跑 T2 溯源的件按材料采信并标注
- **收口批注（2026-11-15 终态覆盖）**：§5 未决项 **7 项已全部收口/归位**——① mcp-runtime 修复=台账 41（`it(` 8→9、EnterPlanMode 用例在位、定向 vitest 13/13 全绿）、②-⑥=台账 42、⑦ 悬置项=登记跟踪项无行动需求、维持在案；**收口门=通过**（定向 vitest 13/13 + typecheck exit 0 + lint 826 warn/0 err + licenses check 绿，见台账 41/42 实测记录；定向 vitest 经验收翻新会话复跑再证）。**对齐复验**（`final-alignment-post-close.tsv`）：18,680 件中逐字节/归一化对齐 17,507（其中二进制 178）/内容差异 1,165/工作树缺失 8，**对齐率 93.72%**；较收口前 93.73% 的唯一路径集变化=third-party/inventory.json 因 licenses 重生成入差异集（台账 42③ 登记动作的直接结果）。正文以下「未收口/未执行」表述均为 2026-11-14 审计时点快照，终态以本批注、§5 状态列与尾部 §7 收口批注为准。

---

## §1 三版本裁定

### 1.1 v3.18.0 —— 战役主体合并完成，携带 1 项已确认漏网未收口

- 依据：04-alignment-audit.md §1-§4（本会话实读）：责任面 5,847 件对齐率 92.95%，412 件差异/缺失逐件归类「零未解释」；21 个新能力域在位。该轮裁定的边界在 06 终审被部分推翻：**06 §3.2 漏网 1 项 = `apps/drora-cli/packages/core/tests/mcp-runtime.test.ts` 缺 theirs 的 EnterPlanMode 权限安全用例**。
- 本轮实测（裁定该缺口归属 v3.18.0 基线而非 B/C 区间，且原样在案）：
  - 上游三树该文件 `grep -c 'it('` = **9/9/9**（`git show refs/upstream-trees/v3.18.{0,1,2}:apps/zcode-cli/packages/core/tests/mcp-runtime.test.ts`），且不在 B（111 条）与 C（46 条）清单（`grep mcp-runtime` 两清单 0 命中）→ 用例在 v3.18.0 基线即存在，属 v3.18.0 战役漏网，非本轮两区间增量缺失；
  - 工作树 ours `it(`=**8**、全文件 `EnterPlanMode` **0 命中**；theirs-v3182 `:411` = `it("does not let EnterPlanMode unlock MCP tools without approval", …)`；全库 `git grep 'EnterPlanMode unlock' -- apps/ packages/` = **0**（实现侧 `EnterPlanMode` 144 行命中为工具名正常存在，缺的仅是用例）；ours `:466` 仍为 `await toolStarted.promise;` 语法死件形态；
  - `git status --short` / `git diff HEAD --numstat` 对该文件输出为空（战役后未触碰，与 HEAD 逐字节一致）；
  - 台账只有运行面登记（ledger `:335`『mcp-runtime.test.ts 语法错误（await in non-async，HEAD 同款）』），无内容面裁决；05 §2.4#1（:147）已回填为「theirs-only 真差距」并给出行动，**行动至今未执行**。
- **裁定：v3.18.0 主体合并成立（04 §4），但以 06/05 已确认的 1 项内容漏网未收口为保留项。**

### 1.2 v3.18.1 —— 区间增量完整合并（missing-3.18.1 = 0）

- B 区间（v3.18.0→v3.18.1）111 条全部吸收，四层证据：
  1. **43 件交集**（B∪C ∩ 工作树-vs-v3.18.2 残差集）：逐件归因全部 kept-ours——B/C 增量行到达、删除行同步，残差行为台账在案的自研保留/有意分歧（详见 §3；本轮对其中约 20 件做了 marker 独立抽验，全部命中）；
  2. **B-ONLY-GAP 25 件**（B 改过、C 未动、与终态不等——「缺 3.18.1 内容」嫌疑最大的集合）：材料归因 B 增量（macOS 字体平滑设置、麦克风权限引导、CR-01 installer-process-helper、memory-diagnostics 采集、enterRequest 整删等）100% 到达、delB 同步 57/57；本轮实测抽验：`.gitignore:117` `packages/desktop/build/generated/`、`ja-JP.ts:3542-3543`/`ko-KR.ts:3450-3451` fontSmoothing 两键（上游 B 侧 ja-JP `+3` 行实测，两键跨 3 行）、`zh-CN.ts:3554-3555`、`en-US.ts` `voiceInput.permission`×8 命中、`WorkspaceShellLayout.tsx:2973` `minSize=… "360px"`、`platform.ts` MicrophoneAccessResetResult×2、`test-ids.ts` TID_V4_COMPOSER_VOICE_PERMISSION×4、`App.tsx:13` import 已收窄为 `useSidePaneFullView` 单名且 `side-pane-full-view/enterRequest.ts` 已删（test -f 不存在）；
  3. **19 个 v3.18.1 新增文件**全部在位，抽 3 件与 theirs-v3182 `diff --strip-trailing-cr` = 0 行差（§4）；
  4. **改名路径盲点补审 7 件**（bc-intersection 以原始路径求交漏掉的 zcode→drora 改名件）：adapters/package.json、bootstrap v4-gateway.ts、drora-protocol/server.ts、v4-gateway.test.ts、cli/package.json、feature-graph.yaml、credential-security-linux-fallback.test.ts——7 件路径本会话 `ls` 全在位，`drora-protocol/server.ts` 的 B 增量 14 行 marker `includeEventStats` 工作树×2 命中（B 侧 `git diff v3.18.0 v3.18.1` +行数=14 实测），材料归因增量亦零缺失。
- 唯一携带形态改编（非缺失）：`test-installer-preserve-files.mjs` 上游 8 行 `"/INPUTCHARSET","UTF8"` 内联改写为 `INPUTCHARSET_ARGS` 常量 + spread 于同 4 调用点（台账 28 段门第 3 轮②/台账 40 适配重放，语义等价形态在先）；`upstream-snapshot.json` 按 regenerate 替代手工（台账 30「301 假 hunk 不手工解决」+ migration §12.2/:409，commit 后须再跑并核对 ref=v3.18.2）。
- **裁定：v3.18.1 增量完整合并；残差全部有台账在案依据，无未解释缺失。**

### 1.3 v3.18.2 —— 区间增量完整到达，06 终审收口动作未执行（维持「完整对齐=否」的保留项）

- 06-final-acceptance.md（本会话实读）裁定「完整对齐 = 否」：生产代码增量 148 件与 13 主题全部落位、typecheck/lint 两硬门复跑绿、契约字面量五族无撕裂，但存在漏网 1 项（§1.1 所述）与存疑 6 组。
- 本轮区间归因补充：C 区间（v3.18.1→v3.18.2）46 条在 43 件表中的 C 件全部 C:n/n 到达、delC 同步；本轮实测抽验：`package.json:3` `"version": "3.18.2"`、`README.md:38`/`README.en.md:37` 版本行、`channels.ts:742/:817` credential-key-share 对（`:278` `drora:reset-microphone-access` 为 B 侧）、`powershell-command.mjs` createEncodedPowerShellArgs×3、`settingService.ts` shareCredentialKeyWithDataRoot×2、`validation.ts` webRemoteControlTaskTargetSchema×2、`wdio.conf.ts` applyAgentsTeamEnvForWorker×2、`main/index.ts` forceUpdateGuard **0 命中**（= D5 保删除，与 06 §2.2 MISSING 4 件构成一致）。
- 06 §6 行动清单（漏网 1 + 存疑 5 项动作）经本轮逐项复核**全部未执行**（§5 对照表）；门禁（typecheck/lint）本轮未重跑，采信 06 §5.2 终审复跑结果。
- **裁定：v3.18.2 增量内容到达完整；但按 06 口径的「完整对齐」验收不成立——收口动作未执行，差距窄、明确、可收口。**

---

## §2 区间数据

| 口径 | 数字 | 本轮实测 |
|---|---|---|
| B 区间（v3.18.0→v3.18.1） | **111 条**（M91 / A19 / D1） | 清单逐行读：A 行 19（行 5-13,33,56,99-103,107,109-110）、D 行 1（:89 enterRequest.ts）、M 91，与 three-version-stats.json `"B":111` 一致 |
| C 区间（v3.18.1→v3.18.2） | **46 条**（M41 / A5 / D0） | A 行 5（:4,21,22,23,26）、D 0、M 41，与 stats `"C":46` 一致 |
| B∪C 涉及文件 | **148** | stats `"union":148`；交叉验证：`comm -12` 两清单求交 = **9 件**（README×2/desktop-auth-config-e2e-cases/zcode-login-rework/package-lock/package.json/channels.ts/upstream-snapshot.json/third-party/inventory.json），111+46−9=148 自洽 |
| B∪C ∩ 工作树-vs-v3.18.2 差异集 | **43 件** | `bc-intersection.txt` 逐行读 = 43 行，与归因材料 gaps 数一致；口径经 `three-version-check.cjs` 源码实读确认：inter = B∪C ∩ `final-alignment-recheck.tsv`（1,164 DIFF+8 MISSING） |
| 其中 B 改过而 C 未动（B-ONLY-GAP） | **25 件** | stats `"bOnlyGap":25`；脚本口径 = inter ∩ B ∩ ¬C |
| B 新增且 C 删除（上游自身撤销） | **0** | stats `"reverted":0`；脚本口径 = B 的 A 集 ∩ C 的 D 集 = ∅ |

---

## §3 43 件归因表

总裁定（材料 + 本轮抽验）：**43 件全部 kept-ours——missing-3.18.1=0、missing-3.18.2=0、equivalent=0**。每件 = B/C 增量行到达 + 删除行同步 + 残差行为台账在案改编。「本轮验」列 = 本会话独立复测的 marker（未标注者为材料 T2 行级溯源采信，其方法=transform-upstream-tree.mjs 三方变换稿保真 fid=eq/eq + 行级 origin 溯源 + grep 独立复核）。

| # | 路径 | B/C 到达（del 同步） | 残差（ours 保留面）与台账依据 | 本轮验 |
|---|---|---|---|---|
| 1 | `.gitignore` | B 3/3 | cua-helper 还原链忽略项+注释形态（预存在分歧，.e2e-home/.codex-runtime 在 :105-107）；台账 40「并集解决」 | `build/generated/` 命中 :117 |
| 2 | `README.en.md` | B 1/1、C 2/2 | 本仓发行/下载/badge 章节 vs 上游 logo 段（品牌+发行通道，台账 33/30 S8） | v3.18.2 行命中 :37 |
| 3 | `README.md` | B 1/1、C 2/2 | 同 en 版（Releases 表/CI badge 自研叙述）；台账 33/30 | 命中 :38 |
| 4 | `architecture-policy.yaml` | B 18/18 | 49 自研/authored 模块保留+登记注释（上游 228 ids 差集 ∅）；台账 30 | 未重跑 |
| 5 | `docs/conversation-session-case-catalog.md` | B 6/6、delB 0/0 | Persona v5/Agents Team 段落；台账 38 B 类 12（ledger :604 实读在案） | 未重跑 |
| 6 | `docs/testing/conversation-session-e2e-coverage-matrix.md` | B 6/6 | Persona v5 覆盖计划+ATUI 增量；台账 38 B 类 | 未重跑 |
| 7 | `docs/web-remote-control/web-remote-control-architecture.md` | B 1/1、delB 1/1 | 部署链接改写+drora_type 字面量双轨；台账 38 B 类 | 未重跑 |
| 8 | `package.json` | C 1/1（delB 1/1） | allowUnusedPatches（台账 34）+build:sea:prepare 拆分拓扑（台账 36）+verify:pre-push/test:* 自研 scripts；workspace:* 不回抄（台账 30） | `"version": "3.18.2"` 命中 :3 |
| 9 | `packages/desktop/electron-builder.config.js` | B 46/46 | desktopPet sharp 打包面+extractUnpackedApp（台账 33）+dev@drora.z.ai 等旧改名字面量（台账 38 A 类**存疑登记**，非区间缺失） | installerProcessHelperDefine×2 命中 |
| 10 | `packages/desktop/scripts/test-installer-nsh-smoke.mjs` | B 1/1 | INPUTCHARSET 拆 argv 注释；台账 28 段门 3② | 未重跑 |
| 11 | `packages/desktop/scripts/test-installer-preserve-files.mjs` | B 89/97 | 缺 8 行=INPUTCHARSET 内联×4 调用点，本仓以常量+spread 同 4 点（语义等价在先）；台账 28/40 | 未重跑 |
| 12 | `packages/desktop/src/preload/index.ts` | B 4/4 | DesktopPet bridge+voiceVendorProxyFetch（specs/model-capabilities.md §15.8）；台账 33 | 未重跑 |
| 13 | `packages/desktop/test/windowsInstallerCompile.test.ts` | B 44/44、delB 1/1 | INPUTCHARSET 注释；台账 28 | 未重跑 |
| 14 | `packages/services/src/feedback/feedbackLogArchive.ts` | B 51/51、delB 10/10 | isSameStatDevice win32 dev=0 修复（in-file 注释）；台账 40-6 族 | 未重跑 |
| 15 | `packages/shared/src/channels.ts` | B 7/7、C 7/7 | OFFICIAL_RPC_CHANNEL_ALIAS_PREFIX 双轨（台账 11）+模型能力/DesktopPet/obsidian 面注释；台账 33 | :278 reset-microphone-access、:742/:817 credential-key-share 双命中 |
| 16 | `packages/shared/src/index.ts` | B 1/1 | mobile-web 域再导出面；台账 33 | 未重跑 |
| 17 | `packages/shared/src/platform.ts` | B 11/11 | server/bot 连接选项、DesktopPet 三方法、voiceVendorProxyFetch+drora:// 注册；台账 33/38 A | MicrophoneAccessResetResult×2 命中 |
| 18 | `packages/shared/src/test-ids.ts` | B 10/10 | 模型能力/Server 连接 TID 族（specs/model-capabilities.md §5.1/5.2，台账 13） | TID_V4_COMPOSER_VOICE_PERMISSION×4 命中 |
| 19 | `packages/ui/src/App.tsx` | B 1/1、delB 17/17 | onDesktopPetOpenTask+agents-team handler+drora-mark.svg；台账 33 | import 单名 :13、enterRequest.ts 已删 |
| 20 | `packages/ui/src/SettingsPage.tsx` | B 6/6 | Persona/桌面宠物/Voice 设置节（specs/drora-persona-system.md §10）；台账 33 | 未重跑 |
| 21 | `packages/ui/src/app-shell/WorkspaceShellLayout.tsx` | B 2/2 | plugin-ui citation 路由（obsidian P7）+TeamNavigationProvider；台账 33 | minSize 360px 命中 :2973 |
| 22 | `packages/ui/src/i18n/locales/en-US.ts` | B 15/15、delB 4/4 | Drora 自研键追加块+personalization→Custom Instructions；台账 28/38 B | voiceInput.permission×8 命中 |
| 23 | `packages/ui/src/i18n/locales/ja-JP.ts` | B 3/3 | 上游 D9 死键（toolGrouping×6 等）本仓 S6 补删——**有意分歧**（台账 28）；构成补记属未决项② | fontSmoothing 两键 :3542-3543 在位、toolGrouping=0 |
| 24 | `packages/ui/src/i18n/locales/ko-KR.ts` | B 3/3 | 同 ja（台账 28） | 两键 :3450-3451、toolGrouping=0 |
| 25 | `packages/ui/src/i18n/locales/ru-RU.ts` | B 3/3 | 同 ja（台账 28） | toolGrouping=0（键族同删） |
| 26 | `packages/ui/src/i18n/locales/zh-CN.ts` | B 13/13、delB 4/4 | Drora 自研键块+「自定义指令」改值；台账 28/38 B | 两键 :3554-3555 命中 |
| 27 | `packages/ui/src/settings-search/settingsSearchIndex.ts` | B 7/7 | agentsTeamEnabled 索引条目（specs/agents-team.md §6.4）；台账 28 | 未重跑 |
| 28 | `packages/ui/src/styles.css` | B 4/4 | vault-live-markdown.css 迁入 @import（obsidian P7）+voice-rise 动画；台账 33 | 未重跑 |
| 29 | `packages/ui/src/v4/ConversationComposer.tsx` | B 2/2 | 语音听写与知识引用面；台账 33 | 未重跑 |
| 30 | `scripts/architecture/upstream-snapshot.json` | B 1/38、C 0/21、delB 47/48 | 生成物 regenerate 替代手工（W 26,955 行=index 基快照，含全部 C 件路径条目 1 entry/件）；台账 30+§12.2/:409（commit 后再跑核对 ref=v3.18.2） | `wc -l`=26,955 |
| 31 | `docs/desktop/auto-update-service-manifest.md` | C 1/1 | cdn.example.com/{zcode,drora} 2 行（ours 旧改名形态 vs 上游冻结字面量）——台账 38 A 类 53 **存疑登记** | 未重跑 |
| 32 | `packages/desktop/scripts/auto-update-source-security-smoke.mjs` | C 8/8、delC 3/3 | D5 通道语义（specs/update-feed-github.md）+win32 esbuild 说明符修复；台账 40-7/§12.2 | 未重跑 |
| 33 | `packages/desktop/scripts/powershell-command.mjs` | C 48/48、delC 18/18 | 残差仅 4 行中文注释（CLM PropertySetterNotSupported 载因）；台账 40-6 | createEncodedPowerShellArgs×3 命中 |
| 34 | `packages/desktop/src/host/index.ts` | C 51/51、delC 1/1 | startPlanCaptchaMainBridge+createModelCapabilitiesService；§12.2「并集」+台账 33 | 未重跑 |
| 35 | `packages/desktop/src/main/desktopHostProcess.ts` | C 33/33、delC 1/1 | ZCODE_CUA_LAUNCHER_PID_ENV 注入（台账 17）等 CUA 装配；台账 33 | 未重跑 |
| 36 | `packages/desktop/src/main/index.ts` | C 14/14 | forceUpdateGuard 族上游缺席=D5 保删除（台账 40-7 MISSING 4 件预期）+desktopPet/captcha/voice 装配；台账 33/27/30 | forceUpdateGuard **0** 命中（=D5 删除态） |
| 37 | `packages/desktop/test/powershell-command.test.ts` | C 122/122、delC 51/51 | GBK 代码页注释+UTF-8 钉版（in-file 注释引台账 24①） | 未重跑 |
| 38 | `packages/desktop/wdio.conf.ts` | C 16/16、delC 4/4 | applyAgentsTeamEnvForWorker 灰度门（specs/agents-team.md §14 缺口11）+appId 免改名（台账 6）；台账 33 | applyAgentsTeamEnvForWorker×2 命中 |
| 39 | `packages/services/src/node.ts` | C 8/8 | webhookSecret/cuaAgentEnvironment/模型能力导出+obsidian P7 注释；台账 33 | 未重跑 |
| 40 | `packages/services/src/setting/settingService.ts` | C 13/13、delC 1/1 | resolveAppSettingsFilePath/旧键迁移（specs/model-capabilities.md §3.3）；台账 13 | shareCredentialKeyWithDataRoot×2 命中 |
| 41 | `packages/shared/src/validation.ts` | C 25/25 | workspaceIdentity/remoteSessionId/pinned/archived 扩展；台账 33+AGENTS.md Workspace Identity | webRemoteControlTaskTargetSchema×2 命中 |
| 42 | `packages/ui/src/settings/ModelProviderSection.tsx` | C 6/6 | MODEL_CAPABILITY_NAV_PURPOSES 深链/invalidProviderTarget（in-file 注释 §12 F-5）；台账 13 | 未重跑 |
| 43 | `packages/ui/src/settings/model-provider-section/useModelProviderNavigation.ts` | C 6/6、delC 1/1 | 「模型能力」第三固定分组（契约常量，注释引 §5.1）；台账 13 | 未重跑 |

**改名补审 7 件**（材料方法学盲点：bc-intersection 以原始路径求交漏掉的 zcode→drora 改名件，同法补审零缺失；本轮 7 件路径 `ls` 全在位 + server.ts marker 抽验）：

| 路径（工作树） | 到达 | 残差 | 本轮验 |
|---|---|---|---|
| `apps/drora-cli/packages/adapters/package.json` | B 4/4 | （材料：无未解释残差） | 在位 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/v4-gateway.ts` | B 4/4 | （同上） | 在位 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/server.ts` | B 14/14、delB 15/15 | （同上） | B 侧 +14 行实测；includeEventStats×2 命中 |
| `apps/drora-cli/packages/bootstrap/tests/v4-gateway.test.ts` | B 4/4 | （同上） | 在位 |
| `apps/drora-cli/packages/cli/package.json` | B 2/2 | workspace:*→link: 拆分拓扑（台账 30/34 族） | 在位 |
| `.agents/skills/feature-boundary-planner/references/drora-feature-graph.yaml` | C 1/1 | persona 节点保留（台账 30 union 先例） | 在位 |
| `apps/drora-cli/packages/adapters/tests/credential-security-linux-fallback.test.ts` | C 新增 | expectedSecretFileMode win32 守卫（台账 39） | 在位 |

存疑登记（不影响 B/C 区间结论，属台账 38 A 类 53 待仲裁族，ledger :626 实读在案）：#9 `dev@drora.z.ai`/schemes 字面量、#31 cdn drora/ 路径——「冻结字面量 vs 旧改名形态」待逐字面量对代码冻结面仲裁。

---

## §4 v3.18.1 新文件核验（19 件）

材料口径：内容 == transform(v3.18.1) == transform(v3.18.2)（C 未再动，EOL 归一逐行相等）。本轮实测：**19/19 `test -f` 全部 OK**；抽 3 件与 theirs-v3182 变换树 `diff --strip-trailing-cr` = **0 行差**（逐行相等复证）。

| 新文件 | 在位 | 双等证据（材料） | 本轮验 |
|---|---|---|---|
| `apps/drora-cli/packages/adapters/src/memory-diagnostics/CONTRACT.md` | ✓ | 双等 | — |
| `…/memory-diagnostics/contract.example.ts` | ✓ | 双等 | — |
| `…/memory-diagnostics/contract.ts` | ✓ | 双等 | **diff=0** |
| `…/memory-diagnostics/index.ts` | ✓ | 双等 | — |
| `…/memory-diagnostics/module.ts` | ✓ | 双等 | — |
| `…/memory-diagnostics/recorder.ts` | ✓ | 双等 | — |
| `…/memory-diagnostics/storage.ts` | ✓ | 双等 | — |
| `…/memory-diagnostics/types.ts` | ✓ | 双等 | — |
| `apps/drora-cli/packages/adapters/tests/memory-diagnostics/recorder.test.ts` | ✓ | 双等 | — |
| `docs/ui/macos-font-smoothing.md` | ✓ | 双等 | — |
| `packages/desktop/test/e2e/settings/appearance/manual-review/pending/macos-font-smoothing.test.ts` | ✓ | 双等 | — |
| `packages/ui/src/voice-input/ui/useMicrophonePermissionGuide.ts` | ✓ | 双等+ConversationComposer 消费接线 grep 命中 | **diff=0** |
| `packages/ui/test/browser/manual-review/pending/font-smoothing.test.mjs` | ✓ | 双等 | — |
| `packages/ui/test/browser/manual-review/pending/interaction-origin-badge.test.mjs` | ✓ | 双等 | — |
| `packages/ui/test/browser/manual-review/pending/queued-summary-streaming.fixture.tsx` | ✓ | 双等 | — |
| `packages/ui/test/browser/manual-review/pending/queued-summary-streaming.test.mjs` | ✓ | 双等 | — |
| `scripts/test/installer-process-helper.test.mjs` | ✓ | 双等 | — |
| `scripts/windows-runtime-host/installer-process-fixture.cpp` | ✓ | 双等 | — |
| `scripts/windows-runtime-host/installer-process-helper.cpp` | ✓ | 双等 | **diff=0** |

---

## §5 未决项现状对照（06 §6 / 05 §2.4 行动 → 本轮实测）

| # | 项（出处） | 指定收口动作 | 本轮实测（2026-11-14） | 状态 |
|---|---|---|---|---|
| ① | `mcp-runtime.test.ts` 缺 theirs EnterPlanMode 权限安全用例（06 §3.2/§6.1，**唯一内容实差**） | 修 :466 await 死件→整文件对齐 theirs :410-484→ledger 补内容面裁决 | **2026-11-15 收口（台账 41）**：死件根因=b3e44cb2a（v3.17.2 合并）丢失 theirs EnterPlanMode 用例块（theirs :410-471）与 it.each 头部（:473-484，含 toolStarted 等 4 个局部声明）；按 theirs-v3182 变换树逐字补回（官方原始树 `git show refs/upstream-trees/v3.18.2` 实证该块逐字一致、无品牌字符串需变换），`it(` 8→9（it.each 展开 4、共 13 用例），修复点中文注释载因（:477-484）；补回后首跑暴露 3 处旧裁定残留（readOnlyHint 分歧/旧 deny 门拒绝文案断言/`permissionBroker,` 死引用），按台账 33（2026-11-14 总裁定，agent-write-safety.md 顶部修订）就近回退 theirs 原文；定向 vitest 13/13 全绿（台账 41 两次复跑一致；验收翻新会话复跑再证，`git grep 'EnterPlanMode unlock'`=1 命中）；台账 41 内容面裁决登记（ledger :636） | **已收口**（终态对 theirs 仅余 4 组中文裁定/修复注释，代码本体逐字一致） |
| ② | ja/ko/ru 缺 theirs locale 死键 ~41 行 + 『5 locale clean-merge 自动成立』表述（06 §3.3#1/§6.2#2） | 补记差异构成或全量底重放；修正 migration :359 表述 | **2026-11-15 收口（台账 42②）**：逐语 diff 实测 ja 41/ko 40/ru 41 行 theirs-only=每语 38 键+续行（键族 `settings.toolGrouping*`×6+`chat.toolCall.{explore.bucket×17,executeGroup×5,changesGroup×5,cua.group×5}`，与台账 28 补删同集）；双侧代码零消费（排除 locale 后 grep 均 0）；维持不搬。migration :359 表述已勘误为分语如实描述（en/zh 成立+personalization 两键值差=文案裁定；ja/ko/ru 死键残留+不搬理由） | **已收口**（登记面=migration §12.2+台账 42②；内容面维持有意分歧） |
| ③ | 根侧生成物 regen 四件 + 并入 05 §5#2 登记（06 §3.3#2/§6.2#3） | npm-overrides/embedded-components/native-search sources/根 pnpm-lock regen+登记 | **2026-11-15 收口（台账 42③）**：条目级实测勘误 07 原证据口径——「537/552 行」系缩进差整文件 diff 误读，真差异=theirs-only 19 条 override+QuickJS-NG **全部为 CLI 依赖域**（生产图探针 1,118 包全不在图，合入即 Stale 门禁打挂 notices）→按 CLI 拆分拓扑在案裁定保持 ours；native-search sources 自洽 0 mismatch；根锁 `pnpm install --no-frozen-lockfile` 字节不变（degenerator@7.0.1 在 CLI 锁=拓扑预期非漂移）；licenses 链 check 基线实测**红**（inventory 系 theirs 原样带入、S8 regenerate 未执行）→本仓图 notices 重生成后**转绿**；CLI 域材料登记缺口并入 05 §5#2（该行已扩容） | **已收口**（形态=拆分拓扑正确终态+登记归档；CLI 图扩展归 05 §5#2 外部条件） |
| ④ | K3『等价形态』逐件证据未发布（06 §3.3#5/§6.2#5） | 发布六域逐件证据 JSON 或下次同步逐件重估 | **2026-11-15 收口（台账 42④）**：`08-k3-itemized-evidence.md` 发布（1,164 件全覆盖：TOKEN_EQ 469+TOKEN_DIFF 695；判据=asymLines/词元逐位相等/品牌占比分层 90-1-604；sample 139 件标注；代表实体 IntlProvider/ConversationDraftEmptyState 行位在表；oxfmt 格式化入库） | **已收口**（TOKEN_EQ 469 件计『已证等价』；695 件分层归属在表，冻结双轨面待逐字面量仲裁维持台账 38 A 类流程） |
| ⑤ | `run-production-build.test.ts:52` scheduler 断言（06 §3.3#3 终审勘误=ours-only 自研适配） | 台账补注自研依据（**不需要跟上游**） | **2026-11-15 收口（台账 42⑤）**：自研依据登记=断言锚定本仓 resolveDesktopProductionCleanPaths 的 `out/scheduler` 清理行（run-production-build.mjs:20-22 带中文载因：tsup/tsc 双态覆盖+陈旧 chunk 进 app.asar）；scheduler 构建面双侧同构（tsconfig.scheduler.json 仅缩进差）而 theirs 清理清单与断言均无此行=本仓对共享构建面的清理加固 | **已收口**（07 勘误方向=自研非上游缺失，成立） |
| ⑥ | `pointer-input.ts:7-8` win.show()/win.focus()（06 §3.3#4 终审勘误=ours-only 既有适配） | 台账补注+可选载因注释 | **2026-11-15 收口（台账 42⑥）**：:6-11 中文载因注释已补（CDP 合成器输入不要求前台，但用例链断言 activeElement 并 insertText——Windows 前台锁拒绝无人交互隐式切换，后台窗口无键盘焦点时注入丢失）；台账登记同条 | **已收口** |
| ⑦ | 悬置仲裁项登记统计（06 §3.3#6，判『成立（在案，非新差距）』） | 无（登记跟踪项，非行动项） | 逐面复核 11 项全在位：05 §5 六项（:189-197）；commit 后三件（migration :409 实读）；A 类 53+B 类 12 保留清单（ledger :626/:604 实读）；normIfText（台账 27）；upstream-cli 基线族（ledger :533/:401） | **已收口**（登记跟踪项无行动需求；在案清单维持，其中 05 §5#2 行经台账 42③ 扩容并入 CLI 依赖域材料登记缺口） |

---

## §6 结论与收口清单

### 6.1 结论

1. **三版本区间增量合并 = 完整**：B 区间 111 条（含 19 新文件、改名 7 件）与 C 区间 46 条全部到达工作树，43 件残差集逐件 kept-ours 有据，missing-3.18.1=0、missing-3.18.2=0、上游自身撤销 0——「工作树 ⊇ 上游 v3.18.2 全部增量 + 台账在案自研保留面」的合并目标达成。
2. **三版本完整性验收 = 未完整**：v3.18.0 轮携带、经 06 终审确认并本轮复核原样在案的 1 项内容漏网（`mcp-runtime.test.ts` EnterPlanMode 权限安全用例，ours 8 vs theirs 9 `it(`，全库零存在、无内容面裁决）未收口；另有 06 §6.2 指定的 5 项登记/生成物/证据收口动作（未决项②-⑥）至今未执行。该结论与 06 §1「完整对齐=否」一致，本报告不推翻、只维持并给出三版本视角的归位。
3. 方法学盲点已闭合：bc-intersection 原始路径求交漏掉的 7 件改名件已补审（零缺失）；v3.18.1 无磁盘变换树的缺口以 `git show refs/upstream-trees/v3.18.1:<path>` 三树对照弥补（mcp-runtime 三树 9/9/9 实测即此法）。

### 6.2 收口清单（按优先级）

| 序 | 动作 | 验证门 |
|---|---|---|
| 1 | `mcp-runtime.test.ts`：修 :466 await 语法死件 → 整文件对齐 theirs `:410-484` EnterPlanMode 用例（保留本仓 plan-mode 自研语义注释）→ ledger 补内容面裁决（06 §6.1）——**已收口 2026-11-15（台账 41）**：根因=b3e44cb2a 合并丢块，按 theirs 逐字补回+3 处旧裁定残留按台账 33 回退，终态仅余中文注释残差 | vitest :466:8 错误消失（定向复跑 13/13 绿实证）；core 包 `test:upstream-cli` 全量复跑未执行，包级基线红收窄待 commit 后 verify 批次核 |
| 2 | locale 死键：§12.2/台账补记 ja/ko/ru 差异构成（上游功能回撤残留死键未搬，双侧零消费）+ 修正 migration :359『5 locale clean-merge 自动成立』表述（06 §6.2#2）——**已收口 2026-11-15（台账 42②）**：构成=每语 38 键+续行、双侧零消费 grep 实证、migration 表述勘误落盘 | grep 复核表述与构成登记一致 |
| 3 | 根侧生成物四件 regen（npm-overrides/embedded-components/native-search sources/根 pnpm-lock）+ 并入 05 §5#2 双锁补扫登记；degenerator 5.0.1↔7.0.1 分叉随 regen 消差（06 §6.2#3）——**已收口 2026-11-15（台账 42③，形态勘误）**：theirs 新增条目全为 CLI 依赖域（根图探针 0 命中）按拆分拓扑裁定不搬；根锁已收敛字节不变；licenses 链 notices 重生成+check 红→绿；CLI 域缺口并入 05 §5#2（已扩容） | regen 后 diff 哈希对账 |
| 4 | K3 逐件证据 JSON 发布（residual-audit 目录现存 sample.json 为抽样件）或声明下次同步逐件重估（06 §6.2#5）——**已收口 2026-11-15（台账 42④）**：`08-k3-itemized-evidence.md` 1,164 件全覆盖+判据分层+sample 标注 | 证据件数覆盖六域清单 |
| 5 | 台账两处补注：scheduler 断言（tsconfig.scheduler.json 构建 project 自研依据）、pointer-input win.show/focus（窗口焦点适配，可顺手补 :6-7 载因注释）——均为 ours-only，**不跟上游**（06 §6.2#4）——**已收口 2026-11-15（台账 42⑤⑥）**：两处补注+载因注释（pointer-input.ts:6-11）落盘 | ledger grep scheduler/pointer-input 命中 |
| 6 | commit 后三件不变（migration :409）：architecture snapshot regenerate（核对 ref=v3.18.2）/ `pnpm verify:pre-push` / `pnpm test:engineering:affected --scope push`（前置=干净树，本轮工作树态未跑、未复核） | 三件全绿 |
| 7 | 悬置跟踪（在案非行动）：A 类 53 冻结字面量仲裁（含 #9 dev@drora.z.ai、#31 cdn 路径两处存疑登记）、D10 bundle parity（上游 release 后）、opentui segfault、上游自带缺陷 | 外部条件触发 |

---

*本文为只读审计产物，未修改任何产品文件（仅新增本报告）。标注「本轮实测」的检查均为本会话运行；未逐行重跑的 43 件中 ~23 件与门禁（typecheck/lint）按材料/06 采信并如实标注。最终验收裁定：三版本增量合并完整，三版本完整性验收未完整（1 项内容漏网 + 5 项收口动作未执行）。*

---

## §7 收口批注（终态，2026-11-15）

> 本节由收口后验收翻新批写入。批次标识=**v3.18.2 收口批（2026-11-15，登记=台账 41/42）**——本仓库无 run.id 凭据体系，批次凭据=台账编号 + `final-alignment-post-close.tsv` 复验清单 + 各修复点中文载因注释。§1-§6 正文（含 §6.1 结论 2 的「未收口/未执行」表述）为 2026-11-14 审计时点快照，已被本批全部解除。

**七项处置终态**（对应 §5 表，细节以台账 41/42 为准）：

1. **① mcp-runtime.test.ts 修复（台账 41）**：根因 b3e44cb2a（v3.17.2 合并）丢失 theirs EnterPlanMode 用例块+it.each 头部 → 按 theirs-v3182 逐字补回，`it(` 8→9（共 13 用例）；首跑暴露 3 处旧裁定残留按台账 33（agent-write-safety.md 2026-11-14 修订）回退 theirs 原文；终态对 theirs 仅余 4 组中文注释，代码本体逐字一致。
2. **② 三语死键（台账 42②）**：不搬维持（每语 38 键+续行、双侧零消费）；migration §12.2 S6 表述勘误。
3. **③ 生成物四件（台账 42③）**：npm-overrides/embedded 按生产图探针保持 ours（theirs 新增 19 条+QuickJS-NG 全为 CLI 依赖域、根图 1,118 包 0 命中，合入必挂 Stale 门禁）；根锁字节不变；licenses 链 notices 以本仓图重生成后 check 红→绿；CLI 域登记缺口并入 05 §5#2。
4. **④ K3 逐件证据（台账 42④）**：`08-k3-itemized-evidence.md` 发布（1,164 件=TOKEN_EQ 469+TOKEN_DIFF 695）。
5. **⑤ scheduler 断言（台账 42⑤）**：ours-only 自研构建加固依据登记，不跟上游。
6. **⑥ pointer-input win.show/focus（台账 42⑥）**：clickHostPoint 内 win.show()/win.focus() 前置中文载因注释 + 台账登记（收口批唯一代码触面；行号引台账登记 :6-11）。
7. **⑦ 悬置仲裁项**：登记跟踪项、无行动需求，维持在案。

**门=通过**：定向 vitest（core 包 `tests/mcp-runtime.test.ts`）13/13 全绿（台账 41 两次复跑一致，验收翻新会话复跑再证 13/13）；`pnpm typecheck` exit 0 / `pnpm lint` 826 warn 0 err（与 §12.2 基线零差分）/ `node scripts/licenses.mjs check` 绿 / `pnpm fmt:check` 7,503→7,504（+1 件已逐项排查无基线可归因、08 格式化后 0 命中）——后四项为台账 42 验证节实测记录，验收翻新会话未复跑。

**对齐复验（`D:/workspace/tmp/upstream-v3.18.2/final-alignment-post-close.tsv`）**：theirs 总文件 18,680；逐字节/归一化对齐 17,507（其中二进制 178）；内容差异 1,165；工作树缺失 8；**对齐率 93.72%**（收口前 93.73%）。变动构成（收口前后 TSV 路径集 comm 实测）：唯一变化=third-party/inventory.json 新入差异集，系 licenses notices 按本仓生产图重生成（台账 42③）的直接结果、有意分歧在案；mcp-runtime.test.ts 修复后余纯中文注释残差，仍在差异集（登记态，非遗漏）。

commit 后三件（§6.2#6）不变：architecture snapshot regenerate（核对 ref=v3.18.2）/ `pnpm verify:pre-push` / `pnpm test:engineering:affected --scope push`（前置=干净树）。
