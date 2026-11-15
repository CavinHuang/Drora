# ZCode 上游 v3.18.0 更新探索与 Drora 差异报告

- 日期：2026-11-11
- 性质：**差异分析报告（先不合并）**，为后续 `specs/upstream-v3.18.0-migration.md` 方案提供输入
- 上游版本：`b95ebaffea`（`chore: sync ZCode source v3.18.0`，2026-11-11 03:11 UTC，**tag/release 尚未发布**）
- 本仓基线：main @ `42bacc627`；上游合并基点 = `a9fe401ee`（v3.17.2，已是 HEAD 祖先，经 `9b71937e8` ancestry 记录）
- 上一轮集成记录：`specs/upstream-v3.17.2-migration.md`（D1 跟随上游裁测、冻结区 R3 保卫、test:drora 基线 1881 过/7 跳）

## 0. 数据获取方式与资产

- GitHub git smart HTTP / SSH 均被网络环境拦截（400/超时），经 `gh api` 下载 tarball（97.5MB，sha1 `5ab1ab180885`）
- tarball 经 `git hash-object -w --no-filters` 全量导入本仓 git 对象库（18,657 文件，含 116 个可执行位），树对象 **`736aed13ff988fb7f88d37b16f028cd85440b765`**（dangling，未挂任何 ref；gc 不受影响的前提是它 2 周内被引用或重新导入）
- 解压树与 tarball 已因磁盘 ENOSPC 删除（D 盘全程 0-400MB 余量）；后续合并需重新下载或直接复用对象库树
- 中间数据落盘于 `D:\workspace\tmp\upstream-v3.18.0\`（diff 清单/numstat/冲突候选，均小文件）

复现命令：

```bash
git --git-dir=D:/workspace/projects/Drora/.git diff a9fe401ee 736aed13ff988fb7f88d37b16f028cd85440b765 --stat -- <path>
git --git-dir=D:/workspace/projects/Drora/.git show 736aed13ff988fb7f88d37b16f028cd85440b765:<path>
```

## 1. 上游 v3.17.2 → v3.18.0 增量画像

| 维度 | 规模 |
|---|---|
| 变更文件 | **5,847**（含 rename） |
| 行数 | +223,528 / −608,131 |
| 按状态 | M 2,925 / A 2,171 / D 751 / R 0（git 未配对 rename，移动以上游目录重组的 A+D 对呈现，§3.2 blob 级配对实证 658 对） |
| 按包 | desktop 3,026（其中 test/ 占 1,081A+~680D）/ zcode-cli 1,248 / ui 605 / services+shared+server 331 / web 84 / 新包 3 个 |

### 1.1 目录聚合（name-status 全量）

（数据文件：`D:\workspace\tmp\upstream-v3.18.0\diff-name-status.txt`）

- `packages/desktop`：1,223 M + 1,125 A + 678 D —— **test/e2e 大重组为主体**（+1,081A/−678D 集中在 test/）
- `apps/zcode-cli`：633 M + 574 A + 41 D —— 其中 `packages/` 子目录 +569（vendored 资产，待 CLI 组确认）
- `packages/ui`：417 M + 179 A + 9 D —— 含 **i18n 新增三语言**（ja-JP 8,822 / ru-RU 8,786 / ko-KR 8,615 行）
- `packages/services`：118 M + 75 A；`packages/shared`：62 M + 67 A
- **全新包**：`packages/session-control`（@zcode/session-control，contracts/cli/app/testing 四导出）、`packages/plugin-api`（@zcode-dev/plugin-api **1.4.0**）、`packages/design-runtime`（@zcode/design-runtime）
- **vendoring 机制**：`third-party/upstream/*.txt`（sha256 命名快照记录）+ `third-party/inventory.json`（±3,066 行）
- **新原生件**：`scripts/windows-runtime-host/main.cpp`
- 文档：docs/testing 54 M / docs/ui 42 M / docs/superpowers 31 M / docs/issues 17 M / docs/working-memory 15 M / docs/desktop 15 M 等
- `THIRD-PARTY-NOTICES.md` +28,061 行（新 vendored 资产的许可证清单）
- 根 `package.json` version → **3.18.0**

### 1.2 高变动文件 Top（行数）

- THIRD-PARTY-NOTICES.md +28,061
- i18n/ja-JP +8,822、ru-RU +8,786、ko-KR +8,615（新语言）
- scripts/architecture/upstream-snapshot.json ±6,251
- desktop test：conversation-session-background 3,176+/3,153−（**同场景旧删新增 → 测试重写/搬迁**）、coding-plan-team-usage 3,100+/2,717−、e2e-coverage-matrix ±3,008、remote-data-sync-demo-walkthrough 1,782±（路径搬迁）、settings-ui-polish 1,759±（`e2e/settings/` → `e2e/settings/general/` 子域化）
- design-resources：open-design-landing-deck、html-ppt-zhangzara-*（monochrome/signal/broadside/grove）、live-artifact examples（crypto/stock-dashboard）——**上游新增设计资源/示例资产族**
- docs/plugins/extension-host.md +1,722（**插件扩展宿主新文档**）

## 2. Drora HEAD vs 上游 v3.18.0 总差异

### 2.1 Drora 自研面（merge-base a9fe401ee → HEAD，改名感知）

- **整包自研**（上游不存在，合并零冲突，仅依赖方向审查）：
  - `packages/mobile-web`（手机远控端整包，5,299 文件）
  - `packages/zcode-cua-helper`（Windows CUA helper，562 文件；含未跟踪的 `native/reverse/reference/`）
  - `packages/relay-v2-server`（自建 relay，43 文件）
  - `apps/website` + `website/`（产品官网，231 文件）
  - `packages/zcode-cua` 引擎目录（89 文件，cua 0.6.5 重切段）
  - `apps/drora-cli` 430 A（改名+独立 workspace 拆分产物）
- **适配面**：ui 1,488 M / desktop 1,410 M / services 365 M / shared 131 M（大部分为品牌字符串+协议改名 drora-protocol，少部分为功能自研）

### 2.2 三方冲突面（上游 v3.18.0 改动 ∩ Drora 自 v3.17.2 后改动，均以 v3.17.2 路径为键）

> **内容级精确版见 [01-merge-inventory.md](01-merge-inventory.md)**（逐文件分类器将改名规则变换后的期望内容与 HEAD 实际内容比较）：本节 2,490 为路径级近似，其中按内容级精确分类（基线已随 main 同步刷新至 `4c9be763b`）**532 条真分叉**（THREE-WAY）需人工三方合并，其余经品牌变换归一后落入机械桶（FAST-FORWARD 2,322 / DEL-FOLLOW 703）；另有 DEL-KEEP 47 与裁决区 MOD-ABSENT 2（forceUpdateGuard/manifestUpdateProvider，本仓 3813c0637 已删除而上游又改，对应 D5 裁定）。

总量 **2,490** 个文件候选，按 Drora 侧改动规模分层：

| 层 | 数量 | 说明 |
|---|---|---|
| 结构性（>100 行） | **94** | 需逐个三方合并（含生成物/锁文件） |
| 中等（20–100 行） | 401 | 逐个过，多数可机械合并 |
| 品牌级（<20 行） | 1,259 | transform-upstream-tree 改名后大多自动消解 |
| Drora 侧已改名（rename 源路径） | 736 | 上游改 + Drora 改名，映射后归类到上面三层 |

**结构性 Top（droraLines | upstreamLines | path）**——人工合并清单（摘要）：

```
37820 | 6251 | scripts/architecture/upstream-snapshot.json   （生成物，regenerate）
 8878 |  306 | pnpm-lock.yaml                                （重装收敛）
 4672 | 28061 | THIRD-PARTY-NOTICES.md                       （上游新增为主，取 theirs 重排）
 1410 |  750 | packages/ui/src/i18n/locales/en-US.ts         （键全集合并+本仓键保留，双语 parity）
 1303 |  690 | packages/ui/src/i18n/locales/zh-CN.ts         （同上）
  932 | 3066 | third-party/inventory.json                    （生成物）
  847 |  838 | architecture-policy.yaml                      （上游基线+本仓 adopt/例外重放，v3.17.2 同款）
  847 |  408 | packages/services/src/node.ts
  752 |   76 | docs/dynamic-workflow/launch.md
  458 |  276 | packages/desktop/wdio.conf.ts
  442 |   80 | packages/shared/src/channels.ts
  430 |   92 | packages/services/src/bots/botsService.ts
  404 |  201 | packages/desktop/build/installer.nsh
  400 |  445 | packages/ui/src/app-shell/WorkspaceShellLayout.tsx
  392 | 1454 | packages/ui/src/v4/SessionPane.tsx             （上游 v3.18.0 大改 1,454 行）
  388 |  222 | packages/desktop/src/host/index.ts
  364 |  185 | packages/desktop/src/main/index.ts
  350 |  246 | packages/ui/src/lib/conversationSelectionReference.ts
  336 | 1200 | packages/ui/src/v4/ConversationStatusPanel.tsx
  324 | 3008 | docs/testing/conversation-session-e2e-coverage-matrix.md
  259 |   16 | packages/desktop/src/main/manifestUpdateProvider.ts （本仓 update-feed-github 裁决区）
  259 |   20 | packages/desktop/src/renderer/src/desktopPlatform.ts
  258 |   83 | packages/desktop/electron-builder.config.js
```

### 2.3 自研功能域撞车预警

- **web-remote-relay（最大撞车区）**：上游 v3.18.0 继续大修 `packages/desktop/src/main/web-remote-relay/`（mobileLogPullExport、mobilePushConnection、index、webRemoteControlV2Http）+ relay-v2 文档族（login-pairing、register-token-pair）+ mobile-event-push/input-prediction/task-home-design 文档 —— 与本仓「远控官方/自建 Relay 双切换」（webRemoteControlRelayOrigin 特性）及 mobile-web 自研端正面重叠。
- **persona 词面重叠**：上游 `apps/zcode-cli/packages/dynamic-workflow/src/engine/persona.ts`（workflow 引擎内概念）与 `docs/ui/settings-personalization.md`（v3.17.2 已撞过、persona 批有本仓修改）；与 Drora 拟人系统是不同东西，合并时防误伤。
- **model-capabilities**：CLI 190 个真实逻辑分叉集中区 `core/src/runtime`(19 文件)/`bootstrap/src/app`(16) 与上轮 v3.17.2 §4-A 的 model-capabilities 接线文件（core/src/runtime/{deps,types}.ts、tool/executor/、helpers/runtime-tools.ts 等）同域——**上轮接线需在本次合并中逐一重放**。
- **冻结区 R3（cua 面）**：上游 v3.18.0 触碰 13 处——`packages/ui/src/ToolCallBlocks/renderers/cua-group.tsx` 与 `packages/ui/src/v4/conversationCuaGroups.ts` **被上游删除**（CUA 渲染重构）、`packages/desktop/scripts/prepare-windows-cua-helper.mjs` M、`cuaPermissionPanelMessages.ts` M、CLI node-repl-host dist-types 中 cua-bridge/broker 类型 D——与 Drora W1 换装（zcode-cua-helper）及 cua 0.6.5 重切段正面相关，合并时按 R3 保卫先例逐案核对（上游删除是否伴随等价新路径待 §3 确认）。

## 3. 各模块更新点分析（6 路并行深扫结论）

### 3.3 apps/zcode-cli（633 M + 574 A + 41 D；独立 workspace 结构 v3.17.2 已有，本次顶层零变化）

前提澄清：上游 CLI 无 `src/`，全部源码在 `packages/<子包>/src`（33 子包）；自带 pnpm-workspace+turbo+独立 lock——**Drora 3f8f2e63b 的拆分正是对齐该结构，完全同构**。

**+569 新增文件全部是 monorepo 内部源码（非 vendored npm）**：`design-plugin` 394 个 = **全新官方内置插件 `@zcode/design-plugin` v0.7.2**（HTML 设计稿/原型/演示稿工作流：plugin.json + skills/design + **361 个 design-resources 资产** + scripts/hooks/test + .claude-plugin 兼容清单）；bootstrap 92（active-transcript、cli-session-control、plugin-discovery、plugin-startup-budget、zcode-protocol-v4/materialization、plugin-secrets 等+55 测试）；core 54（session-fork-commit、tool/session-control、topic-resource、context-composition、prompt-snapshot、total-tokens、background-stall 等）；adapters 17；其余 12（plugin-discovery 契约、site-analytics、actor-budgets 等）。

**功能主题**：会话控制 12 工具（公共 8+App-only 4，权限键 `session_control.<method>`）；**插件发现**新工具 SearchPlugins/SuggestPluginInstall（错误码 `ZCODE_PLUGIN_SOURCES_CHANGED`/`ZCODE_PLUGIN_STARTUP_TIMEOUT`）；**ReadSessionContext 全链删除→ReadTopicResource**（只读当前会话话题快照，不再跨会话）；Assistant 块 `blockIndex` 持久化（修 Anthropic thinking 签名 400）；Context 组成观测；**Prompt 快照**（冷恢复复用保持 provider cache 前缀）；SQLite migration `0025_session_permanent_deletion`+schema.baseline +359 行；凭据安全（**zai_cn 渠道凭据键 `oauth:zai_cn:access_token/refresh_token/user_info`**、错误码 `ZCODE_CREDENTIAL_STORE_CHANGED`/`ZCODE_CREDENTIAL_DECRYPT_FAILED`/`ZCODE_FILE_LOCK_TIMEOUT`/`ZCODE_RUNTIME_MODEL_UNAVAILABLE`、plugin-secrets 适配器）；受管 worktree（env `ZCODE_DATA_BASE_DIR`，数据根 `<dataBaseDir>/.zcode/worktrees`）；后台子代理 stall 提醒（env `ZCODE_SUBAGENT_STALL_NOTIFY_MS`）；工作流 web 搜索预算（DEFAULT=128/MAX=1024）。

**V4 协议字面量净变化**（shared `zcode-protocol-v4/transport.ts`）：V4_METHODS +3（`v4/conversation/contextComposition`、`v4/storage/sessionData/deletionPreview`、`v4/storage/sessionData/deletionExecute`）；V4_NOTIFICATIONS +2（`v4/conversation/contextCompositionChanged`、`v4/telemetry/model-request-metrics`）；hostCapabilities +`pluginDiscovery`、clientHello/subscribe +`pluginDiscoveryUi`、subscribe +`worktreeSessionIds`；SessionEventType +4（`worktree_created`、`turn_steer_edit_lock_changed`、`plugin_install_requested`、`plugin_install_resolved`）；env +2（`ZCODE_DATA_BASE_DIR`、`ZCODE_SUBAGENT_STALL_NOTIFY_MS`）；Symbol.for 键零变化。

**CLI 命令面零新增/删除**（顶层子命令/参数契约/斜杠命令面全同）；变化在模型工具面（+SearchPlugins/+SuggestPluginInstall/+session-control 12/+ReadTopicResource/−ReadSessionContext；ListModels 改"有消费者才注册"）。依赖：cli +keyring、core +zod 4.6.5 +session-control、根 +`build:sea:prepare`。

**Drora 撞车量化**（上游改动 1,202 文件中 544 同路径、498 src/test 级）：**106 字节一致（可快进）+ 308 仅改名差异（改名归一后同内容）+ 190 真实逻辑分叉**（core 63/bootstrap 63/adapters 23/cli 14/contracts 10）；最热目录 `core/src/runtime`(19)、`bootstrap/src/app`(16：official-plugin-*/session-facade/workflow-driver/bundled-plugins)、`adapters/src/plugins`。包级差异：Drora 独有 obsidian-plugin；design-plugin 在 Drora 无对应。CLI 变更**非 apps 内闭合**——依赖根 session-control 包、shared credential-security、transport.ts 字面量（桌面协议复用面，bundle parity 将命中）。

### 3.1 desktop 主体（非测试 151 文件：44 A + 107 M 无删除，+8,391/−1,195）

**A. 扩展进程（本版最大新能力）**：新目录 `src/extension-host/`（12 文件）+ `src/main/extensionHostSupervisor.ts`(518 行)。全 App 唯一扩展 UtilityProcess（`serviceName:"zcode-extension-host"`）；监管常量 `CRASH_WINDOW_MS=5min`、`RESTART_BACKOFF_MS=[1s,2s,4s]`、`PROBE_INTERVAL_MS=5s`、`PROBE_MAX_MISSES=3`、`DISPOSE_FORCE_KILL_MS=1500`；**env 白名单 15 键逐字**（PATH/HOME/USERPROFILE/TMPDIR/TEMP/TMP/LANG/LC_ALL/LC_CTYPE/SystemRoot/windir/APPDATA/LOCALAPPDATA/NODE_ENV）+ `ZCODE_PROCESS_LABEL="extension-host"`；日志环形缓冲 2000 条/单条 4KB；parentPort L0 消息 15 个（`extension-host/{init,ready,probe,probe-ack,dispose,attach-window,log,request-restart,pair,status,logs,window-ready,reload,logs-request,logs-snapshot}`）；激活超时 10s；错误码族 `not-declared/invalid-input/internal/host-unavailable/disposed`。pluginSandbox `contentKind` 增 `"extension"`、`sessionId` 可选、新文案 `Invalid extension view provenance`；扩展数据目录 `~/.zcode/v2/extensions`。构建：tsup 新 target `extension-host`、新 `tsconfig.extension-host.json`、dev marker `.extension-host-build-ready`。

**B. App 控制导航桥（SCT03/SCT07）**：新目录 `src/app-control-navigation/`（13 文件含 CONTRACT.md）。`APP_NAVIGATION_IPC="zcode:app-control-navigation"`；Host 消息 `app-navigation-{open,cancel,result}`；结果 reason 族 11 个（`host-disposed/cancelled/stale-connection/transport-unavailable/renderer-replaced/renderer-unavailable/ui-target-unavailable/duplicate-request/superseded/host-unavailable/window-closed`）；uiTarget `window:<id>`；SCT07 只读发现要求 Server 能力 `virtualProjects===true` 否则 `source_unsupported`。新 `tsconfig.app-navigation.json` 四端引用。

**C. 凭据安全（系统凭据库加密）**：`@zcode/shared/credential-security`（前缀 `enc:v1:`/`enc:v2:`、aes-256-gcm、keyring service 名 `"ZCode Credential Encryption"`、密钥文件 `credential-secret`、来源标记 `credential-source`）；Main fork 时 `createSystemCredentialCipher`（`~/.zcode/v2/.../credentials.json`）；Host↔Main 新消息 `credential-cipher-request`/`credential-cipher-result`；暴露策略 `credentialStoreRecovery:"local-desktop"`（仅 desktop-continuous+local）；asarUnpack keyring 原生 binding。

**D. Windows 原生 runtime host**：`scripts/windows-runtime-host/main.cpp`（C++17，176 行）= `zcode-runtime-host.exe`——CLI 内核进程 Job 归属边界：`CreateProcessW(CREATE_SUSPENDED)`+`PROC_THREAD_ATTRIBUTE_JOB_LIST` 创建瞬间入独占 Job；命名管道控制面（换行帧文本 `ready <pid>`/`start`/`close`/`started`/`root <exitcode>`/`empty`）；`kGraceMs=1800`、启动 deadline 10s、`--version`→`zcode-runtime-host 1`。构建 `build-windows-runtime-host.mjs`（CMake VS2022 x64/ARM64 或 mingw 跨编、sha256 台账 build.json、PE 机器字校验、env `ZCODE_WINDOWS_CXX`）；产物 `packages/desktop/bundled-tools/win32-<arch>/runtime-host/`；services `zcodeAgentProcessManager` Windows spawn 改经 `spawnWindowsRuntimeHost`（遥测 `runtimeHostPid`）；打包 extraResources+vsign；CLI 分发打包 stageCli 引用。

**E. 语音输入**：新 `src/main/microphone-access/`（6 文件）：`zcode:microphone-access`/`zcode:open-microphone-settings`；结果 `granted/denied/unsupported`；系统设置 URL 白名单（win32 `ms-settings:privacy-microphone`/`ms-settings:sound`，darwin x-apple.systempreferences…，Linux 不支持）；mac entitlements 增 `com.apple.security.device.audio-input`；wdio fake media stream。

**F. 内置浏览器**：新 `desktopCaptureBrowserGuestPage`（Main 取帧避 webview V8 崩溃；错误码 `guest_not_found/guest_not_owned/capture_in_progress/capture_timeout/capture_failed/clip_out_of_view`、`CAPTURE_DEADLINE_MS=15s`）；键盘路由 `withFocusedFrameSession`→CDP session、兜底 `webContents.sendInputEvent`（修 Esc 误停会话）；`promoteDraftTabs`（草稿 owner `BROWSER_VIEW_DRAFT_SESSION_ID="unscoped"` 升级真实 sessionId）+ 非当前任务 tab `setAudioMuted(true)`；新 preload `embeddedBrowserDesignBridge`（`__zcodeDesign` postMessage + Cmd/Ctrl+Z 撤销快捷键）。

**G. 更新器安全强化+行为修复**：`desktopNetworkPolicy.ts`(+399 重写级)——autoUpdater session 纳管设置页代理/CA；自定义 CA 从根指纹匹配重写为 pkijs 全链验证（keyUsage 位级、EKU serverAuth、弱签名 OID 拒绝、RSA≥2048、pathLen、名称约束、未知 critical 扩展白名单）；**更新请求鉴权**（凭据键 `zcodejwttoken`，manifest 带 `Authorization: Bearer`，`Cache-Control: no-cache`+redirect 拒绝）；行为反转——全平台 `autoInstallOnAppQuit=false` **删除 before-quit 主动安装**（修退出-重装循环）；`WINDOWS_NORMAL_SHUTDOWN_POLICY` 删除统一 `waitTimeoutMs:9_000`；**NSIS 安装器恢复机制**（installer.nsh +201：旧卸载器跑前备份受管文件/原子替换/失败回滚，patch marker `; zcode-uninstall-recovery-v1`）；新 `mac-electron-locales.mjs` fail-closed（MAC_ELECTRON_LANGUAGES=["en","zh_CN"]）。

**H. 本地化一致性**：新 `desktopApplicationLocaleBootstrap`（Main 同步读 setting.json，新字段 `uiLocale` 旧 `locale` 兜底；home 解析 `ZCODE_DESKTOP_HOME_DIR`→HOME→USERPROFILE）；语言未定前遥测/远控/help/灰度一律不带 `X-Client-Language`（修 ja/ru/ko 冷启动带 zh-CN）；`resolveLocaleFromLanguageTag`（zh*/ja*/ru*/ko*）；`toZhOrEnLocale` 收敛面板（含 cuaPermissionPanelMessages 修 ja/ru/ko undefined 崩溃）；远控 HTTP `buildWebRemoteControlClientLanguageHeader`；手机推送 `mobilePushEnabled!==false` 开关（关闭→`reason:"user_disabled"`）。

**I. 远程会话/Source Server 修复**：`sourceServerConnectionManager`(+166)——新错误类 `SourceServerUpdateInProgressError`（同 Profile 更新进行中拒绝连接）、同 Profile 单更新 flight、`cancelUpdate`、快照 `updateCancelable`、`resolveRelease` 可取消+进度、`SourceServerUpdateCanceledError` code `remote-connection-canceled`；新 RPC `cancelSourceUpdate`；`releaseUnboundProfileHost`（修孤儿 host-offline 行）；IPv6 `findRemoteProjectHostIdForProfile`；Main 放弃 attachment 发 `zcode:scoped-service-port-released`（main→preload→renderer 三处成套）；换代 session 回收失败 `publishRemoteSessionClosed`（修手机 tab 卡"连接中"）；`webRemoteControlManager.syncRuntimeRemoteSession`+启动恢复目标策略重写；web-remote-replayable 本地 attachment 显式注册 `IHighspeedCardService`（手机加速卡入口修复）；terminal scope 新 `listTerminalIdsUnderPath`。

**J. 任务生命周期**：`HostQuitBlocker`（`worktree-creating`）+ `quit-blockers-changed` + 单窗口关闭确认；任务归档/删除触发 `closeSession{closeTabs:true}` 浏览器 tab 清理；`previewArchivedTaskDeletion`/`permanentlyDeleteArchivedTask`（幂等）；Host 退出 remote-registry 与 service dispose 改并行。

**K. 日志脱敏重写**：exportLogs.ts +323——JSONL 整行 parse 递归脱敏、嵌套对象敏感键占位、字符串内嵌 JSON 递归、`MAX_JSON_REDACTION_DEPTH=256`、`JSON.rawJSON` 保字面量、token 计数键白名单大扩（cache_read_input_tokens 等）。

**L. 其他**：agent 崩溃诊断抽到 shared `agent-crash-diagnostic`（parse/sanitize/fingerprint）；unreadBadge 删点阵数字（纯红点）；新依赖 `@modelcontextprotocol/server@2.0.0`/`@napi-rs/keyring@2.1.2`/`pkijs@3.4.3`/devDep esbuild；wdio.conf.ts +276（强制 `ZCODE_ENV="test"` 清 `ZCODE_BASE_URL`、`ensureWindowsRuntimeHost`、官方插件缓存模板预热、`__INSTALL_PATH__` JSON.stringify 修 Windows 反斜杠、GLM-5-Turbo 退役）。

**Drora 冲突高危**（diff 密度×文件核心度）：`main/index.ts`(+185 八条线贯穿)、`host/index.ts`(+222 服务编排)、`preload/index.ts`(+58 桥面改名联动)、`desktopNetworkPolicy.ts`(+399 重写)、`exportLogs.ts`、**Windows CLI spawn 链**（runtime-host.exe 采纳与否=Drora runtime/ 官方二进制装配的结构裁定）、electron-builder/installer.nsh/package.json（签名安装器定制交叠）、autoUpdater 族（更新行为反转×Drora update-feed-github 裁决区）、远控修复群+ScopedServicePortReleased 三处成套（半合并即撕裂）、契约字面量 30+ 新增需按 specs/drora-rename.md 全链 grep。建议合并切分：A 扩展系统（跨 desktop+shared+services 原子）→ B 导航 → C 凭据 → D runtime-host → E 更新器 → F 本地化 → G 浏览器。

### 3.2 desktop/test E2E 重组（A=1,081 / D=678 / M=1,116；blob SHA 逐对实证）

**配对结果**：658 对移动映射 = **134 纯移动（逐字节相同）+ 524 移动+修改**（其中 381 个改动 ≤10 行、96 个 ≤50 行、49 个大改——迁移同时重写）；**425 全新文件**（131 e2e 测试/helpers + 284 fixtures + 10 test 根级）；**仅 22 个彻底删除**。M 中 1,030 个是 fixtures/cases+upstream 的 json（diff 只是 `spec` 字段指向新路径）。

**映射规则四轴**：① e2e 根级散文件按主题前缀归域（oauth/jwt/login→`auth-config/{login|session|credentials}`、coding-plan→`coding-plan/{account|upgrade|highspeed}`、browser→`browser/{tabs|permissions|files|design|settings}`、web-remote-control→`remote-control/*`、smoke→`infrastructure/smoke/` 等）；② **conversation-session 大分层**（514 对，最大头）拆入 29 子域（remote/{connection,installation,navigation,execution,data-sync,configuration,mobile}、projects/composer/tools/models/…/sharing/planning）；③ `manual-review/pending` 从集中目录降级为各域下执行档位子目录；④ settings/plugins/bots/ui-shell 内部继续分层。

**全新测试场景（425）**：**Dynamic Workflow 灰度 20 个**（gray-always-on-{run,stop,resume,restart,amend,compile,confirm,artifacts,questions,notify,snippet,transcript,overflow,lookup,cross-session,save-from-chat,run-permissions,run-pane-details,english-dark}+gray-on-demand，testid `data-workflow-run-status`/`data-phase-status`/`data-station-status` 等）；**插件扩展宿主 15 个**（plugin-extension-{sessions,sessions-read,sessions-write,host-runtime,jarvis-host,views,mention,logs,network,settings,start-draft,entries,plugin-project,session-approvals}+store-compat，配 98 个 `.zcode-plugin/extension.js` 夹具）；Browser 设计模式 4 个（`TID_BROWSER_DESIGN_*`）；系统凭据所有权 4 个；远程/R3 更新链 11 个；任务管理/会话控制；composer-voice-input；19 个新 helpers（asr-mock-server、browser-design-mode、extension-host-views 等）；test 根级 9 个新 node 测试（agent-crash-diagnostic、stdioTapCredentialRedaction、rendererTypecheckCoverage、e2eWindowsRuntimeHostPreflight 等）。

**删除仅 22 个**：全为 tool-group/changes-group 域（`tool-group-settings-persistence`、`tool-stage-grouping-live-transition` 等 7 场景+1 helper）——与 ui 侧「工具分组架构重构」互相印证。

**测试基建**：`e2e-formal-spec-selection.mjs` 新增容器准入（远程队列用例必须有 `ZCODE_E2E_SSH_CONTAINER` 才准入，防多分片同主机互抢）+ SSH glob 递归化；`e2eRuntimePaths` 增「runtime 文件不得落系统 /tmp」守卫；两个 spec-duration-weights 129 键换新路径；新增 3 个 smoke（auto-update-network/ca-constraints/project-token-retry-after）。

**Drora 合并影响**：本仓 e2e 与上游 v3.17.2 布局同构（1,972 共同路径）；本仓独有 **43 文件**（acceptance/ 12、pets/ 4、obsidian 3、voice-lifecycle、agents-team-staged-approval 等——上游无对应域，作 Drora 扩展域保留并在 spec 登记）；共同路径 **1,073 逐字节相同**（可纯 move）、**899 已分歧**（多为品牌级小 diff）。迁移成本集中在「路径即契约」处（fixtures spec 字段 1,030 json、权重 129 键、准入 glob、断言、CI 脚本），必须与目录迁移**原子同步**否则 pre-push/分片/准入全挂。建议顺序：658 映射迁移→基建四件套同步→425 新文件分批→43 独有归位。

### 3.5 新包 + shared/services/server/web 协议面（全新能力链，非搬家）

已验证三个新包在 v3.17.2 基线**完全不存在**（extension-host/app-control 全树 grep 零命中）——扩展宿主 + 会话控制是整条全新能力链。

**session-control（@zcode/session-control，唯一依赖 zod）**：跨会话控制"纯核心"——模型/客户端对其他会话的发现、读写与编排（List/Read/Create/Fork/Send/Wait/Interrupt/Rename + App 特有 ListProjects/OpenSession/Archive/Pin），**不是暂停恢复/checkpoint**。导出面 `./contracts`（zod schema+端口：TrustedContext 只能由启动装配或 RPC 连接构造、CliScope/AppScope 判别联合、sessionId `sess_<UUID>` 形、幂等键由工具层注入）、`./cli`（8 方法）、`./app`（12 方法）、`./testing`。wait 默认 30s/上限 300s；adapter 须交付同 epoch 严格递增 revision。生产消费方：CLI bootstrap `cli-session-control/`+`session-control/`、CLI core `tool/session-control/`（权限规则名 `session_control.<method>`，写=system+needsApproval，结果 32KiB 预算）、services `app-control/`（11 文件）、shared `app-control/contract.ts`（反向 RPC 封闭 12 方法 `appControl/<name>` + `appControl/cancel`）、extensions `sessionControls.ts`（扩展写动作同一 App facade）。

**plugin-api 1.4.0 + extension-host**：四个 API 版本 1.1.0→1.4.0 **全部在 v3.17.2→v3.18.0 一个周期落地**。`@zcode-dev/plugin-api` 是发布 npm 纯类型包（import type only，version ≡ `EXTENSION_API_VERSION="1.4.0"`）；1.4.0 新增插件回答审批/提问（onDidChangeInteractions/resolveInteraction）、setPermissionMode、createSession 带 mode、`sessions.fullAccess` 档位。架构：每窗口代际一个扩展进程；Window Host 是静态表唯一 owner（带 rev）；能力表 `EXTENSION_CAPABILITIES` 唯一定义；`extension-window` 频道只有 `call`/`onDynamicSubscribe` 两个通用入口；授权档位 sessions.read/write/fullAccess + notifications；写走 `AppControlService.bindClient`（clientId `extension:<pluginId>`，fence `extension-host:<gen>:<pluginId>`）；视图 URI `ui://<pluginId>/<viewId>`；`EXTENSION_PROTOCOL_VERSIONS = {sessions:1, rows:4}`。

**design-runtime（@zcode/design-runtime，唯一依赖 parse5 7.3.0）**：内置浏览器「设计模式」的注入页运行时——页面侧函数 `.toString()` 序列化注入 guest（`window.postMessage({__zcodeDesign:1})`）、宿主侧解析器全限额（`DESIGN_PAGE_LIMITS`）、`sourceEdit.ts` 把选中元素映射回**本地 HTML 源文件**（只改 style/文本/`:root` 变量，expected-content 检查）。消费方 `ui/src/browser-use/*`；web 侧 fileService 明确 unsupported（桌面专属）。**不是 live-artifact 渲染**。

**契约字面量逐字清单（合并时按 AGENTS.md 常量族纪律核对）**：

- `channels.ts` 新增——ServiceChannels：`managed-worktrees`、`extensions`、`extension-views`、`extension-grants`、`voice-input`；PlatformChannels：`zcode:microphone-access`、`zcode:open-microphone-settings`、`zcode:capture-browser-guest-page`、`zcode:show-extension-notification`、`zcode:extension-notification-click`、`zcode:browser-view-promote-draft-tabs`；EmbeddedBrowserWebview：`zcode:embedded-browser-design-events`、`zcode:embedded-browser-design-undo-shortcut` + `EMBEDDED_BROWSER_DESIGN_BRIDGE={messageKey:"__zcodeDesign", maxMessageBytes:262144}`；InternalChannels：`zcode:scoped-service-port-released`；HostMessageTypes：`credential-cipher-result`；HostResponseTypes：`credential-cipher-request`、`quit-blockers-changed`
- `env.ts`：新增 `ZCODE_CLIENT_LANGUAGE_ENV = "ZCODE_CLIENT_LANGUAGE"`（X-Client-Language 链）
- `zcode-protocol/index.ts`：13 个 `appControl*` 方法常量 + `sessionReleaseUnderDirectory`、诊断事件 `startup/pluginsDegraded`、能力位 `worktreeCwd`/`extensionInputSource`/`conversationQuoteComment`/`pluginExtensionSummary`/`appControlEnabled`/`highspeedCardOwner`/`pluginDiscoveryUi`
- `zcode-protocol-v4`：新 `context-composition/`（模型请求组成投影给扩展读）+ `pluginInstall.ts`（`PLUGIN_LOCALIZED_LIMITS`）；command.ts 增 `worktreeCreationRecord`/`forkTargetCwd`/sendText `source`/`modelSelectionBasis`/submission `mode`；rows/snapshot/transport/input-intent 增 attachments、conversationQuotes、`v4ColdResumeWorkspace`
- `shared/src/protocol.ts`：Locale 扩 5 语言 `["zh-CN","en-US","ja-JP","ru-RU","ko-KR"]`；ResourceUsageCategory 增 `"task"`；AppSettings 增 `fileTreeHtmlClickOpensBrowser`/`mobilePushEnabled`/`pluginAutoRecommendationEnabled`、**删 toolGrouping* 三项**
- sqlite-migrations 快照格式 `version: 1|2`（v2 按行摘要）
- shared 新模块目录：extension-host(28 文件)/app-control(5)/plugin-discovery(4)/managed-worktree(7，Hook Trust identity 唯一实现)/credential-security(6，系统凭据库加密 v2)/agent-crash-diagnostic(6)/`locale.ts`/`plugin-store-visibility.ts`
- services 新模块：`extensions/`(29)/`app-control/`(11)/`git/managed-worktree/`(7)/`managed-worktree-tasks/`(10)/`voice-input/`(7，WebSocket ASR)/`windows-runtime-host/`(6，Windows Job 归组)/`bots/topic-history-attachment/`；services package.json +`@zcode/session-control`
- server：stdioServices 改 async + ready 前 `createServerCredentialCipher`；zcode-server-cli 仅打包面；**rpc 包零变更**
- web：新增 `auth/`（webRegionalOAuth 区域登录 + Web Locks 原子凭据提交）与 `share-manage/`（`/share/manage` 分享管理页）；main.tsx core-js polyfill（Chrome 109 toSorted）；vite pdfjs-dist 换 legacy 构建（Chrome 111-125 URL.parse 崩溃）；20 个 D 全为 manual-review/pending 用例迁移，无产品页删除

**third-party/upstream vendoring**：哈希 txt = npm 许可原文快照（文件名=内容 SHA-256，实测验证）；inventory.json 由 `scripts/licenses.mjs notices && check` 在 frozen install 后生成（inputs 3461/packages 1189/patches 9/exceptions 15）；与代码零耦合。

**Drora 侧冲突**：当前 Drora 无上述 shared 六目录与 services 五模块——**全部缺失待同步（纯新增为主）**。两个注意点：(a) 新包带 `@zcode/*` 名与 `zcode:*` 频道字面量，按 specs/drora-rename.md 定改名策略与豁免；(b) Drora 已有 `services/src/drora-extensions/`（自研）与上游新 `services/src/extensions/` **目录名不同语义易混，防误并**。必冲突文件：`channels.ts`（Drora `drora-*` 改名+OFFICIAL_RPC_CHANNEL_ALIAS_PREFIX 别名桥 × 上游同一对象加 5 服务频道+6 平台频道+2 设计频道——文本+语义双冲突）、`zcode-protocol*/`（Drora 已改名 drora-protocol × 上游加 appControl 13 方法等）、`services/src/zcode-agent→drora-agent/`、`shared/src/protocol.ts`（Locale 枚举×62 行改动）、web main.tsx/vite.config、`ui/src/browser-use/*`。

### 3.4 packages/ui + i18n（605 处：417 M + 179 A + 9 D；新 src 文件 145 个）

**i18n 面变化**：

- 新增三语言文件：`ja-JP.ts`(+8,822) / `ko-KR.ts`(+8,615) / `ru-RU.ts`(+8,786)；新 `src/i18n/localeMessages.ts` 集中 LOCALE_MESSAGES 映射
- en-US **+575 新键 / −62 删键**，zh-CN +569（同步）。新键分组 Top：`chat.*` 134（toolCall 53/composerEdit 23/summaryGroup 20/selections 20/runtimeExit 3）、`extensions.*` 94（**新扩展域全量文案**）、`browser.*` 74（design/export/responsive preset）、`git.managedWorktree.*` 67（受管 worktree 全量）、`conversationShare.*` 48、`archives.*` 30、`voiceInput.*` 26、`settings.*` 24、`login.credentialStore.*` 18、`plugin.discovery.*` 11、`remoteSync.*` 10
- 删键 62 集中在：`settings.toolGrouping{Explore,Terminal,Changes}` 四组开关（工具分组设置项整体移除）、`chat.toolCall.{cuaGroup,executeGroup,changesGroup}.*`、`chat.toolCall.explore.bucket.*`、`chat.toolCall.workflow.card.agent*`、`chat.selections.*` 旧版
- **locale 基建迁移**：`isLocale`/`SUPPORTED_LOCALES`/`LOCALE_NATIVE_NAMES` 等从 IntlProvider 迁入 `@zcode/shared`（`packages/shared/src/i18n.ts`）+ 持久化迁移工具；LocaleSwitcher 两语言循环 → 五语言；IntlProvider 四项行为修正（localeResolved 防占位初值回写、偏好无条件回写 localStorage 修独立窗口回落、`<html lang>` 跟随、独立窗口经 storage 事件跟随主窗口）

**145 个新 src 文件按域**：

| 域 | 规模 | 内容 |
|---|---|---|
| **extension-slots** | ~34 文件，最大新域 | 插件扩展插槽系统：`composer.status`/`nav.primary`/`file.viewer`/`composer.mention`/`sidePane.launcher` 五类插槽、扩展授权（grants store + ConfirmDialog 复用）、扩展日志（Main 持缓冲 2000 条上限，UI 只持投影）、`extension-view` 侧栏标签页、`ExtensionViewsProvider`。**桌面本机 Host 专属，Web/手机远控不显示** |
| browser-use 设计模式 | ~12 文件 | `useBrowserDesignMode`(741 行)/`BrowserDesignInspector`(430)/页面导出 PNG/PDF/元素截图/响应式预设，依赖**新包 @zcode/design-runtime** |
| managed-worktrees | ~17 文件 | 受管 worktree 全链：WorktreeToggle/BranchPicker/创建进度/失败重试/ForkDestinationMenu/`ManagedWorktreesDialog`(601 行)/12 种错误分类 |
| composer-edit-mode | ~10 文件 | 编辑最后一条消息与排队消息复用底部 composer；editLock 由 CLI 裁决 |
| selection-comment | ~11 文件 | 选区注释（原文引用+评论）+正文编号标记+文字锚点还原；runtime capability `conversationQuoteComment` 门控 |
| voice-input | ~10 文件 | Composer 原生语音输入：AudioWorklet 16kHz PCM16、`useComposerVoiceInput` 状态机、经 `setVoiceText` 写入；可用条件=platform.microphone + base 连接 voiceInputService + 已登录 |
| settings-search | ~9 文件 | 设置页搜索框+索引+`settingsNavigationSearch` |
| conversation-share | 2 文件 | 分享 TTL 选择器；`SettingsShareManagement`(600 行) |
| image-preview | ~6 文件 | 标注/画笔/缩放编辑器+`ConversationImageFileMention` 正文图片引用气泡 |
| data-sync/ui | 3 文件 | DataSyncDialog footer/provider/最小化进度条 |
| task-row-hover | ~6 文件 | 任务行身份 hover 卡（桌面 hover 语义才挂载） |
| ToolCallBlocks/session | 6 文件 | ListSessions/ReadSession/SendToSession/WaitSessions 渲染器（多会话） |
| resource-manager | 4 文件 | 进程资源管理器 UI 契约（Host sampler + Main 合并 Electron 指标，仅 Desktop） |

- 散件：`AgentRuntimeExitBanner`、`PluginInstallCard`（protocol-v4 `PluginInstallRequestPayload`）、`ProjectIdentityHoverCard`（替代被删 RemoteIdentityHoverCard）、`PluginAutoRecommendationSetting` 等
- **既有页面大改**：`SessionPane.tsx`(+1,090/−364) 接入大部分子系统；**工具分组架构重构**——删 `cuaGroup/executeGroup/changesGroup` 三个专用分组渲染器 + `conversationCuaGroups.ts` + `explore.bucket` 聚合 + 4 个 toolGrouping 设置开关，改通用 `groupConsecutiveAssistantSummaries` + `ConsecutiveSummaryGroup` + `SummaryGroupBoundaryContext`
- 9 个 D 文件 = 分组渲染器旧实现 + 被 Emitter 通道化的 lib 工具（`taskNavigationTarget.ts` → store 内 `requestTaskNavigation`）
- **CONTEXT.md 需补「扩展插槽」整层新词汇**（插件商店之上的新抽象，94 个 `extensions.*` 键）

**store/hooks**：新 store `browserRecentVisitsStore`（localStorage、workspace+remoteSessionId+sessionId 作用域、20 条/作用域、50 作用域上限）、`extension-slots/app/` 四 store（只持最近一份+引用计数）、`composer-edit-mode/store`；session store workspace slice 新增 `draftWorktree`/`draftWorktreeCreationId`/`worktreeHandoff`（**受管 worktree 状态所有者**）；navigation slice 新增入站 `taskNavigationRequested` Emitter；新广播键 `zcode:web-element-contexts-removed`、`zcode:side-pane-full-view-enter-request`、`zcode:conversation-selection-edit`；`useAppPanels`(+483/−54) 大改

**gen-ui/live-artifact**：无新渲染面；`live-artifact`/`design-resources` 在 v3.18.0 packages/ 树 **零命中**（高变动文件里的 design-resources 资产不在 v3.18.0 ui 内——位于其他位置或为 docs 资产，见 §3.5/§3.6）

**Drora 侧冲突预测（同文件双改必冲突）**：i18n en/zh（键追加×大改，量大但机械）；`SessionPane.tsx`（上游 +1,090 × Drora paneEscapeStopGeneration 接线）；`ConversationComposer.tsx`（知识来源守卫+语音接线）；`SettingsPage/ settingsPageConfig/ settingsNavigation`（上游 settings-search 重构 × persona 四分区+能力分区）；`ModelProviderSection`+`useModelProviderNavigation`（capabilityNav）；`PermissionDialog.tsx`（persona P0b）；`resolveRenderer.ts`（generate-image 注册）；`LexicalChatInput.tsx`（双语音入口）。**结构性对撞**：上游 `voice-input/`（服务端 ASR dictation）vs Drora `voice/`（厂商 ASR/TTS+音色播报）需裁定共存或收编；上游 worktree 字段 vs Drora 并行 slice 字段对齐跟进

### 3.6 docs + 根配置（版本主题定谳）

**v3.18.0 = 大型功能与架构版，非依赖升级版（核心依赖零变化）**，四条主线：

- **A. 会话控制（Session Control，本版最大架构主题）**：新包 `packages/session-control`（contract/domain/application 三层、端口注入、禁 Node/React/services 导入）+ `packages/shared/src/app-control` 协议 + `packages/services/src/app-control` + CLI 侧 4 个新架构模块（session-control-tools/bootstrap/runtime/active-transcript/conversation-materialization）+ desktop `app-control-navigation`。设计文档 `docs/architecture/zcode-app-control-design.md`：统一工具名 ListSessions/CreateSession/ForkSession/SendToSession 等 8 共有 + 4 App 独有、独立 CLI 与 App 两种运行位置、跨进程 owner guard、11-02 修订删除 `cli_*`/`app_*` 前缀。`lint` 链入 `session-control-boundary.mjs` 架构检查。
- **B. 扩展系统（Extension Host）**：`docs/plugins/extension-host.md`（P1–P4 大部分已实现）：插件运行时代码跑在全 App 唯一扩展进程、五类插槽供数据、能力调用 App 功能。配套 `@zcode-dev/plugin-api@1.4.0`、`plugin-publishing.md`（商店门槛按插件 API 版本）、`agent-plugin-discovery.md`（BM25 检索推荐）、内置 design 插件（`apps/zcode-cli/packages/design-plugin` + design-runtime + 浏览器设计工具模式）。
- **C. 登录/凭据/远控安全**：分区登录（中国区 `zai_cn`/全球 `zai`）；credentials.json → 系统钥匙串（`@napi-rs/keyring`）；**Web 远控 Relay V2 收尾**（JWT 设备注册 + 一次性 token 替换 V1 匿名 pass_hash 二维码）；auto-update 自定义 CA 严格校验（pkijs，18 个 TLS 约束场景）；Windows 原生 runtime host（`zcode-runtime-host.exe` Job 归组，CMake 构建——即 §1 的 main.cpp 新原生件）。
- **D. 产品功能**：Git Worktree 任务（"worktree 只是会话 cwd"）、Composer 语音输入、编辑态复用主输入框、任务行悬浮卡、按设备设置记忆、设置页窄屏布局、计时整秒、侧栏渲染性能优化、LoaderCircle 统一、i18n 五语言、GPT-6.1 Terra 模板（revision 44）、X-Client-Language 贯穿。

**docs/issues**：17 个 M 全为 E2E 重组路径修正（无实质变化）；实质内容在 8 个新增文档——官方插件 seed 同步 writeFileSync 阻塞事件循环（冷启动 13.5s，needs-triage）、归档批量删除冷恢复（25 条 50-75s）、reasoning 签名修复每请求先 400 再重发（done）、断流恢复回放已丢弃 provider round（needs-triage）、内置子代理模型覆盖同步推远端（done）等。

**根配置**：`mise.toml`/`knip.json`/`pnpm-workspace.yaml` **未变**（Node 24.14.0 / pnpm 10.33.2）；package.json version→3.18.0、typecheck 纳入 session-control/design-runtime/plugin-api/renderer-services、lint 追加 session-control-boundary、`@radix-ui/react-menu@2.1.16` 补丁；workspace importers 47→51（+session-control/plugin-api/design-runtime/design-plugin）；architecture-policy 新增 **12 个 managed 模块登记**；`.oxlintrc.json` 三条 override（全仓 react hooks 两规则 error/warn + 7 存量文件例外 + session-control 禁导入清单）。

**AGENTS.md 上游仅 1 条新增**：修改 React 组件/hooks 后必须跑 `pnpm lint` 复核 `react/exhaustive-deps` 与 `react/rules-of-hooks`，即使通过也要复核、禁止机械补齐或禁用规则、被忽略文件按 `docs/testing/react-hooks-lint.md` 专项扫描。

**依赖矩阵（顶层变化仅 4 项）**：+`@napi-rs/keyring@2.1.2`（钥匙串）、+`core-js@3.51.0`（web polyfill）、+`pkijs@3.4.3`（CA 校验）、+`@modelcontextprotocol/server@2.0.0`（desktop）、react-doctor 0.9.18→0.9.22。**electron 44.7.0 / react 19.2.7 / vite 7.3.3+8.0.8 / typescript 三版共存 / `ai` 6.0.x / zod 三版共存 全部不变**——对 Drora 是重大利好：W1 换装的 electron44 重编链无需重做。

**docs/testing 影响**：E2E 目录业务域重组契约（`e2e-business-scenarios.md`：目录整理不改行为/断言/CaseID）；新 CI 入口 `test:e2e:mr-changed:windows`（MR 只跑改动 spec + case 失败自动标 Draft）；React Hooks lint 规格三件套；unit-test-quality 增「定向取样 CI job」例外；engineering-test-files.json +10 项；coverage-matrix +3,008 行（SCT 全节等）。

## 4. bundle parity 前置状态

- 上游 **v3.18.0 tag/release 未发布**（releases 最新 v3.17.2, 2026-11-04, 7 assets）→ `check-bundle-key-parity.mjs` 无原版 bundle 可跑
- 同 v3.17.2 的 D5 裁定：源码级对账为准，spec 记录缺口；release 出包后补 bundle 级校验

## 5. 合并影响面与风险排序（六路深扫后定稿）

1. **Session Control + Extension Host 跨包原子性**（最高架构风险）：新能力链横跨 session-control 包 + shared(app-control/extension-host/context-composition/pluginInstall) + services(extensions/app-control) + CLI(bootstrap/core 4 模块) + desktop(supervisor/导航桥) + ui(extension-slots)——**半合并即撕裂**；channels.ts/transport.ts 契约面与 Drora 改名（drora-*+别名桥）正面交叠，需按 specs/drora-rename.md 决定新字面量改名与豁免，并全链 grep。
2. **远程链路三方冲突**（web-remote-relay × 双 relay 特性 × 上游 Relay V2 收尾+mobile push 开关+ScopedServicePortReleased 成套链路）——两链路语义（desktop-continuous / web-remote-replayable）都要验证；上游同步修了「换代 session 回收失败手机 tab 卡连接中」「手机加速卡入口」。
3. **CLI 190 个真实逻辑分叉**（core 63/bootstrap 63/adapters 23）：上轮 model-capabilities 接线（core/src/runtime、tool/executor）与 official-plugin-*/bundled-plugins 热区逐文件三方合并；好消息：106 字节一致可快进、308 改名归一后同内容，机械面大。
4. **i18n 四语言合并**：上游 en +575/−62、zh +569 × 三新语言 26K 行 × Drora persona/voice/能力键保留 + locale 基建迁 shared ×五语言切换——双语 parity 门禁 + 新语言是否跟随 + 上游删 62 键中 toolGrouping 系与 Drora 键的交集核对。
5. **desktop test/e2e 重组**（658 迁移映射+425 新增+「路径即契约」四件套原子同步 × Drora 43 独有文件归位）。
6. **更新器行为反转与安全强化**：autoInstallOnAppQuit=false/删 before-quit 安装/NSIS 恢复机制/pkijs CA 全链校验/`zcodejwttoken` 鉴权 × Drora update-feed-github 裁决区（v3.17.2 已拒上游恢复一次）——发行通道策略需重新对齐。
7. **windows-runtime-host.exe 采纳裁定**：Windows CLI spawn 链改经 Job 归属原生件（services+scripts+打包+签名+E2E 全链）× Drora runtime/ 官方二进制装配与 W1 换装链——Windows 构建/签名影响需实测。
8. **生成物/门禁重放**：architecture-policy 12 新 managed 模块+adopt 重放、upstream-snapshot regenerate、pnpm-lock（4 新依赖）、THIRD-PARTY-NOTICES（+28K）、engineering-test-files +10、hooks lint 新约定是否引入。

**利好**：核心依赖零变化（electron 44.7.0/react 19.2.7/AI SDK 全族不变）——W1 换装重编链无需重做；CLI workspace 结构 v3.17.2 已对齐本次零变化；CLI 大头是机械迁移（106+308/544）；desktop 非测试仅 151 文件无删除；rpc 包零变更。

## 6. 待用户裁定项（阻塞方案定稿）

| # | 裁定项 | 选项与默认建议 |
|---|---|---|
| D1 | **Session Control 整链采纳**（新包+协议+CLI 工具+导航桥+E2E） | 全量吸收（官方优先原则；与本仓 agents-team/多会话自研面重叠度高，需出对照表）；或暂缓登记分歧 |
| D2 | **Extension Host 整链采纳**（扩展进程+插槽+plugin-api 1.4+design-plugin） | 全量吸收；design-plugin 361 设计资产（~+28K NOTICES）可单独裁定 |
| D3 | **windows-runtime-host.exe** | 采纳（Windows 进程归属边界强化，与 W1 换装链兼容性需专项验证）；或登记分歧暂缓 |
| D4 | **i18n 三新语言**（ja/ru/ko ~26K 行） | 跟随（上游已做 locale 基建迁移与五语言切换）；或只保 en/zh 并登记差异（locale 枚举仍需对齐） |
| D5 | **更新器反转+NSIS 恢复+CA 强校验** × 本仓 update-feed-github 通道 | 逐项对照本仓 spec 裁决；建议采纳行为修复（退出-重装循环 bug 实锤）、发行通道细节保本仓 |
| D6 | **voice-input 收编 vs 共存**（上游服务端 ASR dictation × Drora 厂商 ASR/TTS+音色） | 双入口共存（dictation vs announcement）或收编上游通道 |
| D7 | **E2E 重组** | 跟随上游目录契约（658 映射迁移+基建四件套原子）+43 独有文件作 Drora 扩展域登记 |
| D8 | **hooks lint 新约定**（AGENTS.md 条款+oxlint 两规则+react-doctor 升级） | 建议引入（防回归收益明确）；7 存量例外文件按上游方式逐个修复 |
| D9 | **CLI 190 分叉与 toolGrouping 删除**（上游删 cuaGroup/executeGroup/changesGroup 渲染+62 键） | 工具分组重构跟随（上游通用 summaryGroup 替代）；Drora 侧如有依赖旧分组需改造 |
| D10 | **bundle parity 缺口**（v3.18.0 release 未发布） | 同 v3.17.2 D5：源码级对账为准，spec 记录缺口，出包后补跑 |

## 7. 建议下一步

1. 用户裁定 §6 十项（D1/D2/D3 为结构级，最先）
2. 依 v3.17.2 先例立 `specs/upstream-v3.18.0-migration.md`（本报告为输入）：transform-upstream-tree 双树变换（需磁盘 ~2GB，先清空间）→ merge-dryrun 三方预演 → apply-segment 分段（建议切分：S1 shared+services 契约面 → S2 Session Control 链 → S3 Extension Host 链 → S4 CLI → S5 desktop 主体 → S6 ui+i18n → S7 test 重组 → S8 docs/根配置收口）
3. v3.18.0 树已固定于本地 git `refs/upstream-trees/v3.18.0`（736aed13），后续合并可直接复用，无需重新下载
4. release 出包后补 `check-bundle-key-parity.mjs`（env 键/`_meta`/权限键/诊断码四族差分）
