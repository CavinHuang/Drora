# 剩余差距清单（v3.18.2 增量 + 六域存量 + 专项遗留）

- 日期：2026-11-14；撰写：差距清单总撰（动态工作流 run.id `dwfrun-75eccee0-84b2-4251-9441-1ba1cb612a2b`，actor_3）
- 总裁定（用户，在案）：**全面以上游为基准**；本仓自研特性（persona / 双 relay / mobile-web / CUA 三件套 / obsidian / agents-team / 模型能力 / 发行通道 update-feed-github / CLI 独立 workspace 拆分）**保留不动**。
- **收口状态标注（2026-11-15）**：**全量对齐执行完毕**（执行与复验记录=`specs/upstream-v3.18.0-migration.md` §12，有意分歧汇总=台账 40）。§4 行动排序逐批对账：**批 0** 增量 148/148 落位（S1 20/S4 18/S5 21/S6 32/S7 27/S8 29/UNASSIGNED 1；S2/S3 零命中；root 版本 3.18.2）；**批 1 K4 清零**——#1-#4/#6/#7 全修（台账 34/37），#5=K5 生成物随双锁补扫（§5#2 外部条件）；**批 2** R3 类型面 #8-#11 收口（台账 37）；**批 3** K3 vendored **已恢复**——974 件逐字节恢复+131 条 ignorePatterns 登记，65 件内容差保留（A 类 53=冻结字面量待逐案仲裁、B 类 12=自研内容；台账 38），.agents/skills 117 件与 UI/桌面格式债留 oxfmt 0.47 收口段（§5#4）；**批 4** 专项小修全绿（subagent-workspace cygpath/session-facade 对齐上游/knowledgeMigration win32 注入，台账 35）+ cli 10 目标败全转绿（CUA host ×5/SEA ×4/build-sea，台账 36）；**批 5** 专项仲裁收口——persona fork 沿父链归属放行（安全面评估在案，台账 37）、build-sea 按拆分拓扑改写（台账 36）；**批 6** 挂起项不变（§5）。终态：对齐复验 **87.98%→93.73%**（不等价 2,245→1,172/18,680 件）；七门=typecheck/lint/test:architecture/fork-isolated/test:drora/test:unit:node 全绿 + test:upstream-cli 残红全为登记基线族（C 类=0，台账 39）。**剩余=外部条件项**（§5 六项）+commit 后三件（snapshot regenerate/verify:pre-push/affected）。
- **终审复核补写（2026-11-15 回填，判定与证据=`06-final-acceptance.md`；条目证据由补写会话独立复测 ✓）**：终审判定员（独立于执行方与三路审计）复核判定**「零未解释」不完全成立**——三路审计口径为确认有据 228 / 存疑 11 / 漏网 1（触达 240/1,172 件；全库剩余 ~930 件按域分布推定同构，其中 469 件词元等价已程序化证明）。① **漏网 1 件（真差距，§2.4#1）**：`apps/drora-cli/packages/core/tests/mcp-runtime.test.ts` 缺 theirs `:410-484` EnterPlanMode 权限安全用例（~74 行完整测试，本仓全库 grep 零存在；台账 32/39 仅登记其『await 语法死件』运行面，无内容面裁决；与上轮 video patch 同类）——**推翻 §2.1 CLI 行「无代码级语义缺口」的字面成立性**，上文「批 1 K4 清零」同步失效（K4 复活 1 件）。② **方向勘误 ×2（§2.4#2/#3，终审新发现）**：`run-production-build.test.ts:52` scheduler 断言与 `pointer-input.ts:6-7` win.show/focus 两处，三路审计标注 theirs-only **有误**，实为 **ours-only 本仓自研/既有适配**（HEAD 已在，非本轮引入），行动改为台账补注而非跟上游。③ 存疑另 4 组（ja/ko/ru locale 各缺 41 行 theirs 死键与「5 locale clean-merge 自动成立」表述不符、根侧 third-party/*.json+根 pnpm-lock regen 只登记了 CLI workspace 侧、K3『等价形态』逐件证据未发布、悬置仲裁统计）维持 06 §3.3 全列口径，收口动作见 06 §6.2。13/13 主题落位、契约字面量五族无撕裂、typecheck/lint 两硬门（§12.6）终审复跑一致，不受影响。
- 在案登记不重复报告：`specs/drora-divergence-ledger.md` 台账 18-33、`specs/upstream-v3.18.0-migration.md` §10/§11（S0-S8 实施记录与终验）。
- 数据源：
  - 存量：本目录 [final-alignment.tsv](final-alignment.tsv)（**2,151 行**，v3.18.0 战役终审逐件对账；行数本会话 `wc -l` 实测）+ 六域审计（run 同上）；
  - 增量：本目录 [diff-v3180-to-v3182.txt](diff-v3180-to-v3182.txt)（**148 行** = 123 M / 24 A / 1 D，`cut -f1 | sort | uniq -c` 本会话实测；唯一 D = `packages/ui/src/side-pane-full-view/enterRequest.ts`）+ 增量深扫（变换树 `C:/Users/A/AppData/Local/Temp/dryrun/theirs-v3182`，实测在库，147/148 映射命中）。
- K 分类口径（全文一致）：**K1** 自研特性/有据保留｜**K2** 平台/工具链适配（win32/Linux/测试链）｜**K3** 格式/等价形态（oxfmt/Prettier 噪声，语义零差）｜**K4** 真差距漏账（应跟未跟，行动项）｜**K5** 生成物（lock/notices/manifest，regenerate 收敛）。
- 本会话实测复核项（除材料声明外）：`scripts/upstream/merge-dryrun.mjs:22-23`（BASE_REF/THEIRS_REF 钉值）、`packages/shared/src/channels.ts:111`（别名前缀）、`packages/ui/src/browser-use/UnifiedBrowserView.tsx:8,1184`（enterRequest 引用）、根 `package.json` patchedDependencies（无任何 `@ai-sdk` 键）、`vitest.config.ts:101-103`（注释仍写 0.6.3）、`packages/zcode-cua/package.json`（@drora/drora-cua **0.6.5**，无占位桩标志）、`NOTICE.md:24`（断链）、上游 releases/tags（§5）。

---

## 1. 新增量差距（v3.18.1 → v3.18.2，148 文件）

总判断（增量深扫）：148 件中约 **95% 可走既有战役工具链机械/低风险吸收**，仅少量需裁定。运行时 env 键、权限键、RPC 方法集（V4_METHODS）、诊断码四族**零变化**（diff 全文 grep 实测）。

### 1.1 主题清单（T1-T13，合计 148，awk 程序化核验）

| 主题 | 文件数 | 内容 | 上游动机/证据 |
|---|---|---|---|
| T8 流式渲染重渲染 #185 | 4 | QueuedSummaryContent 拆 AnimatedSummaryContent 子组件（静态路径不 setState）+ min-w-0 | 纯 UI 小修+2 浏览器验收 |
| T9 子代理交互来源徽标 | 4 | OriginBadge 改全宽换行 span + launch.md 权限来源规范 | 纯 UI 小修 |
| T11 面板与菜单布局 | 6 | 对话列 minSize 35%→360px、侧面板 maxSize 65%→100%；ProjectComposerMenu `[app-region:no-drag]` | 11-11 用户反馈 |
| T6 macOS 字体平滑设置 | 8 | `zcode-macos-font-smoothing` localStorage 键 + fontSmoothingEnabled 广播字段（防回环族）+ CSS 边界 `:root.platform-mac-desktop.font-smoothing-enabled` | 新设置项 |
| T10 浏览器设计模式交互回退 | 8 | **整删 side-pane-full-view/enterRequest.ts**（window 事件机制）+ 点选不再自动弹调整面板 | D 文件连锁（见 §1.3） |
| T12 手机远控历史修复 | 4 | WebRemoteControlMobileShell pushState/back → replaceState 复用当前项 + useLayoutEffect 防闪 + CDP resetNavigationHistory e2e | mobile-web 共享面 |
| T1 CLI 内存诊断新模块 | 21 | `cli-memory-diagnostics` 模块 + shared/memoryDiagnostics.ts 契约 + v4-gateway 4 新计数 + 反馈归档三入口 | 全新模块 |
| T5 语音麦克风权限引导 | 19 | ResetMicrophoneAccess IPC + tccutil reset + 四态结果 + 权限浮层 + 4 test-id；permissionDenied 从 toast 改浮层 | mac 拒绝后无重授权入口 |
| T3 Start Plan 国内未关联登录 | 18 | `resolveStartPlanFamilyFromOAuthProvider(zai_cn→bigmodel)` + OAuthStartPlanMaterial 分离 + 回调带 `provider=zai_cn` | zai_cn 双入口误判 |
| T2 凭据安全双修复 | 16 | SystemCredentialCipher.shareKeyWithCopiedCredentials + Host↔Main `credential-key-share-*` 私有通道 + Linux 私有文件回退 | ZCT-2120723935487688704 |
| T7 Windows 安装器与更新链 | 21 | C++ installer-process-helper（替代 PowerShell 清理）+ 备份降级 + Authenticode 受限语言模式 | CR-01；需 Windows 构建验证 |
| T13 版本与家务 | 19 | package.json 3.18.0→3.18.2 + lock + README×2 + inventory 哈希 | 收口 |

### 1.2 契约字面量增量（按 specs/drora-rename.md 全链 grep 面）

| 族 | 增量 | 落点 |
|---|---|---|
| Renderer→Main 频道 | `PlatformChannels.ResetMicrophoneAccess = "zcode:reset-microphone-access"`（+PlatformChannelMap 登记） | shared/src/channels.ts |
| Host↔Main 私有通道 | `HostMessageTypes.CredentialKeyShareResult = "credential-key-share-result"` / `HostResponseTypes.CredentialKeyShareRequest = "credential-key-share-request"`（requestId uuid + targetBaseDir≤32767） | shared/src/channels.ts |
| wire schema | hostCredentialKeyShare 两 schema 入 hostIncoming/hostResponse 判别联合；错误码常量化 `CREDENTIAL_KEY_SHARE_UNAVAILABLE_ERROR_CODE = "CREDENTIAL_SECURE_STORAGE_UNAVAILABLE"`（**v3.18.0 已存在于 credential-security/bridge.ts:120，非新码，首次常量化**） | shared/src/validation.ts |
| 平台契约 | `MicrophoneAccessResetResult = "granted"\|"denied"\|"restart-required"\|"failed"`；`IPlatformService.microphone.resetAccess()`；preload `window.zcode.resetMicrophoneAccess` | shared/src/platform.ts:851-856、desktop preload |
| 凭据安全契约 | `shareKeyWithCopiedCredentials()`、`enablePrivateFileKeyFallback()`、`PrivateFileKeyFallbackOptions`；文件名字面量常量化（`credential-source`、`credential-secret`、`os\n`、`SYSTEM_PREFIX}os:`、指纹/编码正则） | shared/src/credential-security/* |
| Host 服务依赖 | `SettingServiceDependencies.shareCredentialKeyWithDataRoot?`；Main 侧推导 `join(targetBaseDir, ".zcode", "v2", "credentials.json")` | services/src/setting/settingService.ts:235-241 |
| 内存诊断契约 | `CLI_MEMORY_*` 常量组（16 文件/64KB/8 样本/32 分配/8 栈深）+ `format:"zcode-cli-memory-v1"` + sanitize 白名单 12 计数键（v4 新 4 键）+ 落盘 `~/.zcode/cli/memory-diagnostics` | shared/src/memoryDiagnostics.ts:10-16 |
| 反馈归档 | `FeedbackLogSource.contentPolicy` 新字面量 `"cli-memory"`；前缀 `.zcode/cli/memory-diagnostics` | services/src/feedback/*、exportLogs.ts |
| 架构登记 | 模块 id `cli-memory-diagnostics`（requires [shared, zcode-cli]，4 publicEntrypoints）；adapters 新导出 `./memory-diagnostics` | architecture-policy.yaml、adapters/package.json |
| 模型家族/OAuth | `resolveStartPlanFamilyFromOAuthProvider`、`OAuthStartPlanMaterial`、`loadStartPlanZcodeJwt`；回调 `provider=zai_cn` + polling 二次兑换短路 | model-provider-family.ts:133-147、oauthService.ts:811/1131-1151 |
| UI 持久化/广播 | `FONT_SMOOTHING_STORAGE_KEY`、BROADCAST_FIELDS 新 `fontSmoothingEnabled`、CSS 边界类 | ui/src/store/index.ts + styles.css |
| test-id / 搜索 / i18n | 4 个 voice-permission test-id；`SettingsSearchAvailability.macDesktop` + `settings.fontSmoothing`；5 locale 新键（fontSmoothing×2、voiceInput.permission×7）/ **删 2 键**（voiceInput.error.permissionDenied.mac/windows） | shared/src/test-ids.ts 等 |
| 窗口事件删除 | `SIDE_PANE_FULL_VIEW_ENTER_REQUEST_EVENT` 随 enterRequest.ts 整删 | ui/src/side-pane-full-view/ |
| NSIS/构建 | `ZCODE_INSTALLER_PROCESS_HELPER` define、`zcode-installer-process-helper.exe`、CMake 目标、build.json `installerProcessHelper` 指纹、安装器 stage 串新文案（process-cleanup-*/cleanup-*、recoverable=0\|1）、卸载注册表 InstallLocation、`.gitignore` 新 `packages/desktop/build/generated/` | electron-builder.config.js、installer.nsh、CMake |
| PowerShell | `escapePowerShellLiteral()`（U+2018/2019/201A/201B 双写）；`$zcodeArg0/$zcodeSignatureOutput`、签名 JSON 落盘、失败 exit 27 | desktop/scripts/powershell-command.mjs |
| macOS 系统命令 | `/usr/bin/tccutil reset Microphone <bundleId>`、`/usr/libexec/PlistBuddy`（bundle id 白名单 `/^[A-Za-z0-9.-]+$/`；开发版 com.github.Electron 跳过） | desktopMicrophoneAccess.ts |
| history-state | `zcodeMobilePage` 写策略 pushState/back → **replaceState**（变换树双侧一致改名，无跨进程契约） | WebRemoteControlMobileShell.tsx |

### 1.3 冲突预警（53 件 DIFF 责任面交集 + 10 件自研域接缝）

53 件交集 = final-alignment.tsv DIFF 行 ∩ 148 映射路径（`comm -12` 实测；抽样 4 件工作树仍异于 v3.18.0 变换树，冲突预测有效）。按台账 27 同族先 LF 归一化三方重并、hunk 数对账。**重点接缝 10 件**：

| # | 文件 | 冲突点与处置 |
|---|---|---|
| 1 | `packages/shared/src/channels.ts` | 上游新 3 键 × 本仓 `OFFICIAL_RPC_CHANNEL_ALIAS_PREFIX="zcode-"` 别名区（**实测 :111**）——**并集** |
| 2 | `packages/desktop/src/main/index.ts` | 上游新块在文件头（Linux 凭据回退）；本仓 voice(:246-248)/cuaPipFocusRouter(:704)/pet(:779) 接缝**不动** |
| 3 | `packages/desktop/src/host/index.ts` | 新 CredentialKeyShare 处理器 × 本仓别名注册区——**并集** |
| 4 | `packages/ui/src/WebRemoteControlMobileShell.tsx` | mobile-web 保留域；`droraMobilePage` 键（:15,:37）由变换统一改名，无跨进程撕裂 |
| 5 | `packages/web/test/e2e/.../remote-task-open.mjs` | mobile-web e2e；变换树已同步改名（theirs-v3182 :347,:365 实测） |
| 6 | `packages/ui/src/i18n/locales/*.ts` ×5 | **必须按台账 254 管理规则**：theirs 全量底 + Drora-only 追加块整体对账 + 2 改值键 in-place 覆写；**禁止裸 take-theirs**（en-US.ts:9080 块头注释实测在位） |
| 7 | `packages/desktop/wdio.conf.ts` | 新 mock 块 × 本仓 e2eSpecAdmission 准入面——**并集** |
| 8 | `packages/ui/src/v4/ConversationComposer.tsx` | 上游 voice-input 按钮接线 × 本仓 `@/voice` 自研域共存（实测仅命名差异，无 Drora 逻辑块） |
| 9 | `packages/ui/src/settings/ModelProviderSection.tsx` | 模型能力自研域邻接（实测仅命名差异） |
| 10 | `packages/ui/src/browser-use/UnifiedBrowserView.tsx` | D 文件连锁：`enterRequest.ts` 删除连带 App.tsx/index.ts 引用扫除（本仓 **:8,:1184 仍引用 requestSidePaneFullView，实测**） |

### 1.4 吸收路径（对照 v3.18.0 战役工具链）

1. **预演**：沿用 `scripts/upstream/merge-dryrun.mjs`（实测 :22-23 当前钉 `BASE_REF="a9fe401ee"` / `THEIRS_REF="refs/upstream-trees/v3.18.0"`）；本轮换 `BASE_REF=refs/upstream-trees/v3.18.0`、`THEIRS_REF=refs/upstream-trees/v3.18.2`、`theirs-dir=C:/Users/A/AppData/Local/Temp/dryrun/theirs-v3182`；base 侧复用 `C:/Users/A/AppData/Local/Temp/dryrun/theirs`（v3.18.0 变换树，实测在库）；段表续用 `03-segment-rules.json`（覆盖校验脚本同源）。
2. **落地**：`apply-segment.mjs --segment S1..S8` 按 inventory 结局执行。24 件 A 纯 new 无冲突（memory-diagnostics 8 源码 + 4 组 manual-review 测试 + installer helper 源码对 + 杂项）；1 件 D 连带引用扫除（§1.3#10）。
3. **需裁定 8 点**：① i18n 5 locale 重放（§1.3#6）；② channels 并集；③ main/index.ts 文件头新块、自研接缝不动；④ host/index.ts 并集；⑤ wdio 并集；⑥ installer.nsh/electron-builder/CMake 三件套**连带 build-windows-runtime-host.mjs 的 build.json 指纹校验同批落**（缺一即 isRuntimeHostReady 失败）；⑦ architecture-policy.yaml 新模块 id × 本仓 S2 已登记 25+ id 去重（台账 196/197 联动），upstream-snapshot.json **regenerate 重建不手工**（台账 27）；⑧ 版本面 package.json 3.18.0→3.18.2 + THIRD-PARTY/inventory 哈希随段吸收。
4. **主题先行序**（风险从低到高）：T8/T9/T11 → T6 → T10 → T12 → T1 → T5 → T3 → T2 → T7（installer 链需 Windows 构建验证）→ T13 收口。**每段后跑 `pnpm typecheck` + `pnpm lint`（AGENTS.md 硬门）**。
5. 未执行任何合并（本审计只读）。

---

## 2. 存量差距六域表

### 2.1 总表（计数为各域审计 JSON 原值；K4=真漏账）

| 域 | totalDiff | K1 | K2 | K3 | K4 | K5 | 一句话结论 |
|---|---|---|---|---|---|---|---|
| docs/（文档域） | 1040 | 4 | 3 | 1031 | **1** | 1 | 99.1% 是 S7 全仓 fmt 格式噪声；真内容差 9 件（4 自研+3 测试链+1 档案+1 漂移） |
| CLI 域（apps/drora-cli/） | 271 | 94 | 165 | 8 | **1**（终审 +1→2） | 3 | 270 件有据保留；真差距 2 件=1 文档漂移 + **1 代码级漏网（mcp-runtime.test.ts 缺 theirs EnterPlanMode 权限安全用例；终审推翻原「无代码级语义缺口」结论，见 §2.4#1）** |
| UI 域（packages/ui/ + public/） | 274 | 95 | 11 | 168 | 0 | 0 | K4=0；61.3% 是 oxfmt 0.41↔0.47 宽窄表遗留（EOL 归一后真实差异仅 10001 行） |
| 桌面与服务域 | 331 | 149 | 26 | 156 | 0 | 0 | K4=0；47% 格式残留跟随下版 take-theirs 吸收 |
| 技能与 CUA 域 | 184 | 29 | 11 | 138 | **3** | 3 | 真漏账集中：@ai-sdk 两 patch 未跟 + NOTICE 断链；另有 R3 区 4 处类型面滞后 |
| 专项与遗留（六项开放项） | 0 | 2 | 19 | 6 | 0 | 0 | 全是测试失败现象而非 tsv 差异；K4=0（明细口径见 §3） |

### 2.2 K4 漏账全列（真差距行动项，共 5 件 + R3 区内漂移 4 处；**终审复核后另 +1 件 CLI 域代码级漏网，见 §2.4#1——「全列」以含 §2.4 为准**）

**核心漏账（无任何裁定记录，未入 01-merge-inventory 责任面清单）——须修复：**

| # | 项 | 证据（本会话实测者加 ✓） | 动作 |
|---|---|---|---|
| 1 | `patches/@ai-sdk__anthropic@3.0.81.patch` 缺失 | 本仓 patches/ 无文件；根 package.json patchedDependencies **无任何 @ai-sdk 键（✓ 实测 8 键全列）**；本仓源码注释明确预期该 patch（`apps/drora-cli/packages/adapters/src/model/transform.ts:535-536`、`tool-result-media-projection.ts:172`『由 patch 后的 @ai-sdk/anthropic 转 video block』）；当前 node_modules dist 含 video 代码（grep video_url=3 处，上次带 patch install 残留）——干净重装后 video 上传**静默失效** | 补 patch + 登记 patchedDependencies + 重装重验 |
| 2 | `patches/@ai-sdk__openai-compatible@2.0.60.patch` 缺失 | 同族（theirs package.json:135 有登记、本仓无） | 同上 |
| 3 | 根 `package.json` patchedDependencies 缺两键 + `@radix-ui/react-menu@2.1.16` 键在 136-143 JSON 重复（等值无害） | ✓ 实测键列表无 @ai-sdk | 随 #1/#2 一并清理重复键 |
| 4 | `NOTICE.md:24` 双重失实：链接 `packages/drora-cua/index.js` **断链**（✓ 实测目录不存在，实际 `packages/zcode-cua/`）；文案『不可用占位实现』与 @drora/drora-cua **0.6.5**（✓ 实测）完整还原引擎事实不符 | 改链接为实际路径、改文案为还原引擎事实 |
| 5 | `THIRD-PARTY-NOTICES.md` 缺 @ai-sdk 三条目（anthropic@3.0.81/gateway@3.0.96/openai-compatible@2.0.60） | K5 生成物，根因连 #1 | 补 patch 后重生成 |

**域级 K4 漂移（各有 1 件）：**

| # | 项 | 证据 | 动作 |
|---|---|---|---|
| 6 | `docs/cua-permission-broker/cua-dev-mcp-runtime-assets.md:31,63` 引用不存在的 `@drora/drora-cua-plugin` 与路径 `apps/drora-cli/packages/drora-cua-plugin/`；本仓实际包 `@zcode/zcode-cua-plugin`（apps/drora-cli/packages/zcode-cua-plugin/package.json:2，ls 实证目录不存在） | 文档漂移，**非跟随上游**（上游侧两处路径反而是对的） | 改成本仓实际包名 |
| 7 | `apps/drora-cli/docs/design/v2/model/README.md` 写 `x-drora-query-source`；本仓代码冻结 wire 名实为 `x-zcode-query-source`（adapters/src/model/model-request-headers.ts:2 定义、model-execution.ts:547 消费，均实读） | 1 行改动 | 改回冻结 wire 名 |

**R3 区内类型面滞后（K1 保留裁定的衍生，单列收口）：**

| # | 项 | 证据 | 动作 |
|---|---|---|---|
| 8 | `packages/zcode-cua/index.d.ts + runtime.d.ts`：上游 0.6.5 桩 d.ts 有 `trace?: Record<string,unknown>`、`runtimeScope:"main"\|"subagent"`、字面量联合、具名导出；本仓字段全 optional、联合弱化 string（src/runtime.ts:9-19）。全库无消费方（grep 零命中） | ✓ 实测 d.ts 文件在位 | 低成本补齐类型面 |
| 9 | `packages/zcode-cua/broker-server.d.ts` 缺 `BrokerLogger`/`injectPermissionBrokerAgentMcpServers` 声明；JS 实际有导出（src/broker/server/index.ts:51）——TS 消费方拿不到类型 | 补声明 |
| 10 | `packages/zcode-cua/request-access-contract.d.ts` 无具名接口 CuaRequestAccessStatus（语义等价 zod 推导，import 具名会失败；无消费方） | 轻微，顺手补 |
| 11 | `vitest.config.ts:101-103` 注释称『冻结还原 0.6.3（R3）』，实际 **0.6.5**（✓ 实测 package.json version；bf872a6c0 提交载因） | 改注释版本 |

### 2.3 K3 值得对齐清单（选择性，降低未来合并摩擦）

| 组 | 件数 | 理由与处置 |
|---|---|---|
| vendored 官方文档树恢复（electron/webdriverio/knip） | ~10 代表件（breaking-changes/browser-window/web-contents/app/security/mcp-tools/Selectors/generate-plugin-docs.ts/getting-started.mdx 等） | 上游随版本滚动更新概率最高，fmt 噪声会掩盖未来真实 breaking change（尤其 security.md）。建议整树入 `.oxfmtrc.json` ignorePatterns 并从上游恢复原文（同台账 74 处置） |
| `docs/testing/conversation-session-e2e-coverage-matrix.md` | 1（5526 行，docs 域最大单件） | 活文档滚动更新，噪声代价最高 |
| `docs/superpowers/specs/`（ssh-host-pooling / bigmodel-oauth 两件）+ `docs/working-memory/` + `docs/v4-refactor/11-deletion-plan.md` + `docs/model-io-full-retention-setting.md` | ~5 | 表格 padding 假阳性；OAuth 面下轮同步概率高（台账 121 点名），预消噪声 |
| `apps/drora-cli/packages/core/src/runtime/methods/streaming-tool-coordinator.ts` | 1 | v3.15.1 集成期抽出的 helpers/streamed-tool-results.ts + race-with-timeout.ts，上游已内联同语义；grep 实证无其他消费者——可内联删两文件（等价重构零行为差） |
| `packages/client/src/messageport.ts` | 1 | 整文件 EOL 幻影差异（两侧逐字相同），最便宜的单件减 diff |
| android-emulator-plugin / ios-simulator-plugin tsconfig + bootstrap bundled-plugins 空行 | ~3 | 琐碎形态差（多 3 编译项/1 空行） |
| `apps/drora-cli/packages/browser-use-plugin/docs/api.json` | 1 | 生成文档漂移（多 "Codex-compatible" 字样），随下次 browser-use 对齐 regenerate |
| `.agents/skills/react-best-practices/rules/`（69 件）+ `.agents/skills/ai-elements/references/`（48 件+SKILL.md） | 117 | 本仓 Prettier 形态 vs 上游原样，语义等价；**建议整体裁定**（一次统一或整树豁免），不逐件追 |
| K3 **不值得**专项对齐（跟随下版自然吸收） | UI 域 165 件（4717 行 churn，占真实差异 47%）、桌面与服务域 156 件、dev-docs capability-map 10 件、messageport 之外 e2e helper 重排族 | 上游本轮未动；oxfmt 升级 0.47 后全仓 fmt 一次性收口（§5） |

### 2.4 终审复核补写（2026-11-15 回填；判定=06-final-acceptance.md §3.2/§3.3/§6，条目证据由补写会话独立复测，标 ✓）

终审独立复测命令与输出全文见 06；下表为逐条复测结果与回填裁决：

| # | 项 | 证据（补写会话复测） | 方向/裁决 | 动作 |
|---|---|---|---|---|
| 1 | **[漏网·真差距] `apps/drora-cli/packages/core/tests/mcp-runtime.test.ts` 缺 theirs `:410-484` EnterPlanMode 权限安全用例（~74 行）** | ✓ theirs（`Temp/dryrun/theirs-v3182` 同路径文件）`grep -c 'it('` = **9** vs ours = **8**；theirs `:411` `it("does not let EnterPlanMode unlock MCP tools without approval", …)`、`:410` 安全语义注释（EnterPlanMode 免确认；进入 Plan 后调用 MCP 仍须用户确认，模型不能借进入 Plan 绕过审批）、`:447` `toolCalls: [{ name: "EnterPlanMode", … }]`、`:484` 用例收尾；ours 全文件 `EnterPlanMode` **0 命中**；全库 `git grep "unlock MCP tools"` **0** + 工作树 `find apps packages -name "*.ts"`（排 node_modules/dist）**0**。台账 32/39（ledger :335）仅登记『await 语法死件（HEAD 同款，文件级死件）』运行面，无内容面裁决 | **theirs-only 真差距**（与上轮 video patch 同类：上游实现的一部分未跟，且涉权限安全语义）——**推翻 §2.1 CLI 行原「无代码级语义缺口」结论**（测试代码亦是上游实现的一部分） | 先修 ours `:466` `await toolStarted.promise` 非 async 语法死件使文件可运行（06 §5.2 vitest `:466:8 ERROR` 复证），再整文件对齐 theirs `:410-484` 用例并保留本仓 plan-mode readOnlyHint 自研语义注释；台账补登内容面裁决。终审判定其为阻断「完整对齐」的**唯一实差**（06 §6.1），行动归位 §4 批 1 最先执行 |
| 2 | **[方向勘误①] `packages/desktop/test/run-production-build.test.ts:52`（三路审计标「1 行 theirs-only，方向待确认」）** | ✓ ours `:52` `"/repo/packages/desktop/out/scheduler"` 在清理断言数组内，theirs 同块**无此行**；`git show HEAD:…` 该行战役前既有；`tsconfig.scheduler.json` 与 `src/scheduler` **双侧均在位**（theirs `tsconfig.json:9` 同引用 scheduler project、其 `e2eDesktopBuildCache.test.ts:199` 同引 `out/scheduler/index.js`）；真实差异面=本仓 `scripts/run-production-build.mjs:20-22` 把 `out/scheduler` 纳入生产清理清单（:20-21 中文载因注释：tsup/tsc 产物互相覆盖、陈旧 chunk 会入 app.asar）并在测试 :52 断言，theirs 清理清单无此项 | 三路审计方向标注**有误**：非 theirs-only，实为 **ours-only 本仓适配**（HEAD 已在，非本轮引入；非「上游新增未跟」） | 台账补注自研依据（生产清理面含 scheduler 的构建 project），**不需要跟上游** |
| 3 | **[方向勘误②] `packages/desktop/scripts/mcp-apps-host-fixture/pointer-input.ts:6-7`（三路审计标「2 行 theirs-only，方向待确认」）** | ✓ ours `:6-7` `win.show(); win.focus();`（debugger.attach 之前），theirs 同位置无；`git show HEAD:…:7-8` 战役前既有 | 三路审计方向标注**有误**：非 theirs-only，实为 **ours-only 本仓既有适配**（窗口焦点；非本轮引入） | 台账补注（现无载因注释无登记）；如顺手可在 :6-7 上方补一行中文载因注释 |

- 存疑其余 4 组（#1 locale 死键 / #2 根侧生成物 regen 登记缺口 / #5 K3 逐件证据未发布 / #6 悬置仲裁统计，编号沿 06 §3.3）与 13/13 主题落位表、契约五族、门禁结论维持 06 §3.3/§4/§5 采信口径，不在本清单重复；收口动作清单=06 §6.2（locale 补记与『5 locale clean-merge 自动成立』表述修正、根侧四件并入 §5#2 双锁补扫登记、K3 逐件证据发布）。
- 本节不改变 §1（v3.18.2 增量 148 件）与 §5（外部条件项）结论；13/13 主题在位、改名面双侧同值无撕裂、`pnpm typecheck`/`pnpm lint` 两硬门终审复跑均绿（06 §5.2）。

---

## 3. 专项与遗留（六项开放项：根因 / 成本 / 建议）

| # | 项 | 根因（审计实证） | 成本 | 建议 |
|---|---|---|---|---|
| 1 | **persona fork 会话被上游 lineage 预检拒**（`apps/drora-cli/packages/bootstrap/tests/persona/persona-protocol.test.ts:378`） | K1×自研×上游碰撞：fork 子会话无 path/directory/workspaceID → registerForkedSession（server-operations.ts:2682）→ lifecycle 默认 kind=restore → validateSessionActivationWorkspace（:1881）在 :1909 抛 `project.session-lineage-invalid`；vitest 复跑同败实证；两层崩溃守卫（isSameSessionWorkspacePath :1821-1824）已修 | 中（涉安全语义） | **先仲裁后修**：预检对 fork 子会话沿父链归属放行（父会话 live 且已过校验）；不得用超时/兜底绕过（AGENTS.md） |
| 2 | **subagent-workspace win32 败**（bootstrap/tests/subagent-workspace.test.ts:88） | K2 win32：git-bash `pwd -P` 把 %TEMP% 写成 MSYS `/tmp/...`，git-bash.ts:23 转成 `\tmp\...`（当前盘相对）→ cwd-capture.ts:63 statSync 失败 → resolvedCwd undefined（探针复现 status=completed/exit 0） | 小 | git-bash 方言捕获改 `cygpath -w` 输出原生 Windows 路径，或 normalizeCapturedCwdForHost 把 /tmp 映射回 os.tmpdir() |
| 3 | **session-facade 超时孤儿用例**（bootstrap/tests/session-facade.test.ts:407） | K3 遗留：用例期待 6000ms owner-drain 超时（bff94f4bd v3.17.1 S2 引入），b3e44cb2a v3.17.2 合并用上游无超时形态覆盖 → 用例挂起（vitest 15s 假超时复跑实证） | 小 | 总裁定上游基准：**改写/删除该用例对齐上游语义**，顺带删 src/app/session-facade.ts:112 残留 timeoutMs 字段（与 theirs 仅差这 1 行） |
| 4 | **tui segfault 族**（tui/tests 7 文件 12 用例：tui-app/zz-app/tui-input/tui-focus/tui-image-paste/tui-ctrl-c-draft/tui-background-approval） | K2×外部：官方通道 pnpm test 实测 193/186/7 败（复跑）；tsx 直跑 Segmentation fault EXIT=139 复现；tui/src 与 theirs EOL 归一后逐字节同；上游同源同败（Nov 1 日志实证）——崩溃在 opentui native 渲染链 | 大（外部） | 挂起跟踪上游/社区修复；本仓不深挖（台账 32 在案） |
| 5 | **cli 既有 14 败**（505/477/14 复跑实证；首轮 16 败已收口 2） | 三分：① tui 渲染族 5 败——同 #4 segfault 需上游；② CUA host 5 败——**冻结 wire 键缝**：runtimeEnv.ts:14 `ZCODE_CUA_PERMISSION_BROKER_SOCKET`（冻结）× 测试 DRORA_ 字面量（theirs 同为 DRORA_ 前缀，两文件 HEAD 即如此）——**测试改用导出常量即绿**（前例台账 32③ mcp-tool-bridge 同款）；③ SEA runtime 缓存 4 败——win32 EPERM rename/ENOTEMPTY rmdir 竞态，小修收口；另 build-sea root-graph 1 项 K1：上游 --filter 假设根 workspace glob，本仓 CLI 拆分（3f8f2e63b）已删三行 glob——需脚本按拆分拓扑改写或留仲裁 | 小×9（②③）+外部×5+仲裁×1 | ②③ 即收口；① 挂起；build-sea 随 CLI 拆分保留裁定处置 |
| 6 | **obsidian knowledgeMigration win32 败**（obsidian-plugin/test/knowledgeMigration.test.ts:219；6 用例 5 过 1 败，tsx --test 复跑实证） | K2 win32：故障注入 chmodSync(目录, 0o500) 在 win32 对目录无效（探针实证写 0o500 目录成功）→ 注入不触发 → migration completed 而非 failed+rollback | 小 | win32 兼容注入（独占句柄锁目标路径 / 父目录置为文件）。obsidian-plugin 为 4c9be763b Vault 抽离产物，上游树无此包 |

专项域合计：可即收口小修 4 项（#2、#3、#5②③、#6）；需仲裁 2 处（#1 persona fork 安全语义、#5 build-sea 拓扑）；外部条件 2 族（#4/#5① opentui native）。**无任何新增「应跟上游而未跟」漏账（K4=0）**。

---

## 4. 行动排序（按「上游基准」原则）

| 序 | 批次 | 内容 | 验证门 |
|---|---|---|---|
| **0** | **吸收 v3.18.2 增量**（148 件，95% 机械面） | §1.4 路径：merge-dryrun 换 ref → apply-segment S1..S8 → 主题序 T8/T9/T11 → T6 → T10 → T12 → T1 → T5 → T3 → T2 → T7 → T13；8 个裁定点按 §1.3/§1.4 处置（i18n 禁裸 take-theirs、installer 四件套同批、snapshot regenerate） | 每段 `pnpm typecheck` + `pnpm lint`（AGENTS.md 硬门）；T7 另需 Windows 构建（isRuntimeHostReady/build.json 指纹） |
| 1 | **K4 漏账**（§2.2 #1-#7） | @ai-sdk 两 patch + package.json 登记 + 重装验证 video 面 → regenerate pnpm-lock/package-lock/THIRD-PARTY → NOTICE.md 断链与失实文案 → 两处文档漂移（cua-dev-mcp-runtime-assets / model README wire 名） | patch 后 `pnpm install` 干净重装 + grep video_url 消失面复测；notices 重生成 diff 审 |
| 2 | **R3 区类型面滞后**（§2.2 #8-#11） | zcode-cua 三个 d.ts 补齐 + vitest 注释版本 | `pnpm typecheck` |
| 3 | **K3 选择性对齐**（§2.3） | vendored 文档树 ignorePatterns+恢复原文（~10 代表件）→ e2e-matrix/working-memory/v4-refactor → streaming-tool-coordinator 内联删两文件 → messageport.ts EOL → skills 117 件整树裁定 | `pnpm fmt:check` + 对上游 diff 归零抽查 |
| 4 | **专项修复（小修四项）** | subagent-workspace cygpath / session-facade 用例对齐上游 + 删 timeoutMs / CUA host 测试改导出常量 / obsidian win32 注入 | 各自测试套件复跑全绿 |
| 5 | **专项仲裁** | persona fork lineage 放行（安全语义先对齐）→ build-sea 按拆分拓扑改写 | persona-protocol.test 全绿；build-sea 演练 |
| 6 | **挂起跟踪**（§5） | tui segfault、v3.18.2 release bundle、CDN 图标、oxfmt 0.47 | 外部条件触发 |

排序依据：总裁定「全面以上游为基准」→ 增量吸收最大程度回归上游主线（且 95% 机械低风险，工具链已就绪）；K4 是仅有的真漏账（含一处静默失效风险）；K3 只做摩擦消减不逐件追；专项修复在上游基准稳定后进行，避免与增量吸收互相踩工作树。

---

## 5. 外部条件项

| # | 项 | 状态（本会话实测） | 触发动作 |
|---|---|---|---|
| 1 | **D10 bundle parity（v3.18.2 release）** | ✓ 实测 `gh api repos/zai-org/ZCode/releases?per_page=10` 与 `/tags`（2026-11-14）：最新 release **v3.17.2**（2026-11-04T10:41:06Z，7 assets），tags 止于 `v3.17.2 a9fe401ee`；`releases/tags/v3.18.2` → **404**。v3.18.0/3.18.1/3.18.2 均无 tag/release bundle | **挂起**：官方 release 发布后下载原版 bundle，跑 `node scripts/check-bundle-key-parity.mjs <原版bundle> <本仓bundle>`（AGENTS.md 规程）做字面量族差分；当前增量吸收只能以源码树（`refs/upstream-trees/*` 变换树）为基准 |
| 2 | **CLI workspace 双锁文件补扫 + CLI 依赖域许可材料登记** | apps/drora-cli/pnpm-lock.yaml 3,933/2,167 行差异 = CLI 拆分拓扑（3f8f2e63b）衍生生成物（K5，regenerate 即可）；apps 侧另有 package-lock.json 同族。**2026-11-15 收口补充（台账 41③）**：上游根 third-party 数据文件的 theirs 新增条目同属 CLI 域——npm-overrides 19 条（quickjs-wasi/yoga-layout/react-devtools-core/rrweb@2.0.0 等）+ embedded-components QuickJS-NG（parentPackage=quickjs-wasi@2.2.0）经生产图探针（collectNpmNotices 同函数）实测**全部不在根侧 1,118 包生产图**，合入即触发 `Stale npm notice override`/`Stale embedded component` 打挂根 notices 生成（CLI 独立 workspace 且无自有 third-party/ 目录）；其引用的 31 个材料文件已在 third-party/upstream/ 在位（材料在、登记缺）；根 NOTICES 经 prepare-prebuilds.mjs:1209-1212 与 build-drora.mjs:190-191 随 server/glm/agent 发行物分发，当前不覆盖 CLI 依赖域 | ① §4 序 1 的 @ai-sdk patch 落地后（已落，K4 批 1），**在 CLI 拆分拓扑下重跑两锁文件生成**，并补扫 patch 传导（apps 侧 patchedDependencies 是否也需登记），再对 regenerate 结果做哈希对账；② **licenses 链生产图扩展到 CLI workspace**（readWorkspaceProductionGraph/scanInstalledPackages 跨 workspace）后把 CLI 域 19+1 条登记与 31 材料文件收编进 third-party 数据文件——设计变更，须用户对齐后实施；在此之前根侧数据文件保持 ours 形态（generate-third-party-notices.mjs:37-40/:92-93 门禁是预期阻断） |
| 3 | **CDN 图标资产确认**（ui/src/v4/officeSuggestedPrompts.ts，1 行） | 本仓指官方 zcode-guide 资产；theirs（drora 变换形态）指 drora-guide，疑为改名工具产物，真实可达性未知 | 确认 CDN 侧资产后再定夺（K2 边界项，非 K4） |
| 4 | **oxfmt 升级 0.47** | UI 域 165 件/4,717 行 + 桌面域 156 件格式债（oxfmt 0.41 宽表 vs 上游 0.47 窄表，v3.17.2 时代遗留） | 升级后全仓 fmt **一次性收口**（避免逐文件混排放大合并摩擦）；收口独立成段，不与功能吸收混批 |
| 5 | **opentui native 修复** | tui segfault 族（12 用例面）上游同源同败（Nov 1 官方日志实证），崩溃在渲染链 native | 跟踪上游/社区修复后恢复套件 |
| 6 | **上游自带缺陷**（跟随下版） | session-store 0025 迁移 checksum 漂移（6 用例 it.skip）与 mcp_tool_use 变体注入断流（skip）——上游修复后恢复 it.each | 下版同步时复查 |

---

*本文为只读审计汇总；除引用材料声明外，标注 ✓ 的检查均为本会话（run `dwfrun-75eccee0-84b2-4251-9441-1ba1cb612a2b`）实测。未执行任何合并、未修改任何产品文件。2026-11-15 终审补写（头部补写标注、§2.1/§2.2 修订、§2.4 新增）由报告补写员会话回填：判定依据=06-final-acceptance.md，§2.4 各条证据由补写会话对工作树/theirs-v3182 变换树/HEAD 独立复测。2026-11-15 收口会话按 07 §5③ 指定动作对 §5#2 行做登记扩容（CLI 依赖域许可材料登记并入双锁补扫项，实测证据=台账 41③）；除该行外本文维持只读审计形态。*
