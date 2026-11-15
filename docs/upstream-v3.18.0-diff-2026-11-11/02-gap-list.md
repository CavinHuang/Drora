# Drora main vs 上游 ZCode v3.18.0 差距清单

- 日期：2026-11-12
- 对比基线：**Drora main `4c9be763b`**（含 CUA W5 收官 + Vault 抽离）vs **上游 v3.18.0 `b95ebaffea`**（本地树 `refs/upstream-trees/v3.18.0` = `736aed13`）
- 已合并基线：v3.17.2（`a9fe401ee`）——Drora 是其「品牌改名 + 自研超集」，v3.17.2 本身的差距为零
- 数据源：[01-merge-inventory.tsv](01-merge-inventory.tsv)（5,847 条内容级分类，基线 `4c9be763b` 复跑版）+ [99-final-report.md](99-final-report.md) 六路模块分析
- 本文回答「**我们与上游差什么**」；合并操作清单见 01，模块语义见 99 §3

## 1. 总量差距

| 维度 | 数字 |
|---|---|
| 上游 v3.17.2→v3.18.0 变更 | 5,847 文件（M 2,925 / A 2,171 / D 751），+223K/−608K 行，**Drora 零吸收** |
| 机械可同步（无分叉阻力） | FAST-FORWARD 2,322 + NEW 2,171 + DEL-FOLLOW 703 + ALREADY 69 = **5,265（90%）** |
| 真分叉（合并需人工） | THREE-WAY **532**（难 212 / 中 245 / 易 75）+ DEL-KEEP 47 + MOD-ABSENT 2 = 581 |
| 整链缺失能力域 | **21 个**（§2.A，`ls` 全 MISS 实证） |
| 契约字面量落后 | 新频道 13+ / env 键 4+ / V4 方法 3+通知 2+事件 4 / 协议方法 14+ / 错误码 8+ / i18n 键 +575（§3） |
| 版本 | 根 package.json 3.17.2（上游 3.18.0）；release bundle 未发布（D10） |

## 2. 能力域差距清单（核心）

定性图例：**整链缺失**=Drora 零实现；**部分缺失**=有对应物但范围/语义落后；**分叉**=双侧各有演进；**有意分歧**=按裁定不跟随或自研替代。裁定项编号对应 99-final-report §6。

### A. 整链缺失（上游全新能力，Drora 零实现——21 域实证全 MISS）

| # | 能力域 | 上游内容（v3.18.0） | Drora 现状 | 规模 | 裁定 |
|---|---|---|---|---|---|
| A1 | **Session Control 跨会话控制** | `@zcode/session-control`（contracts/cli 8 法/app 12 法）+ shared `app-control`（反向 RPC 封闭 12 方法）+ services `app-control/`(11) + CLI `tool/session-control`（12 模型工具，权限键 `session_control.<method>`）+ desktop `app-control-navigation/`(13 文件) + `session-control-boundary` 架构检查 | 无。相近自研：agents-team 多代理（feat/agents-team 分支）、drora-session 服务 | ~60 文件跨 6 包 | D1 |
| A2 | **Extension Host 插件扩展系统** | desktop `extension-host/`(12)+`extensionHostSupervisor`(518 行)；shared `extension-host/`(28，`EXTENSION_CAPABILITIES`/插槽清单/授权档位)；services `extensions/`(29)；ui `extension-slots/`(~34)；`@zcode-dev/plugin-api@1.4.0` npm 类型包；五类插槽+扩展进程+日志控制台+98 夹具 | 无。相近自研：drora-extensions（服务接入）、plugin-ui 面（UI 插件通道）——**语义易混，防误并** | ~110 文件跨 5 包 | D2 |
| A3 | **design 插件三件套** | `@zcode/design-runtime`（浏览器设计模式注入页运行时，parse5 源映射）+ `@zcode/design-plugin` v0.7.2（394 文件含 361 设计资产）+ ui browser-use 设计模式 12 文件（`useBrowserDesignMode` 741 行/导出 PNG·PDF/响应式预设） | 无 | ~410 文件（NOTICES +28K） | D2 |
| A4 | **插件发现** | 工具 SearchPlugins/SuggestPluginInstall + shared `plugin-discovery/`(4) + bootstrap plugin-discovery/startup-budget + 设置页开关（BM25 推荐） | 无（插件商店有，但无 Agent 侧发现工具） | ~15 文件 | 随 D2 |
| A5 | **受管 Git Worktree** | shared `managed-worktree/`(7，Hook Trust identity 唯一实现) + services `managed-worktree-tasks/`(10) + ui `managed-worktrees/`(~17：Toggle/Picker/Dialog 601 行/12 错误分类) + env `ZCODE_DATA_BASE_DIR` + v4 `worktree_created` 事件 + HostQuitBlocker(worktree-creating) | 无（普通会话 cwd 概念无 worktree 编排） | ~40 文件 | 跟随 |
| A6 | **系统凭据安全链** | shared `credential-security/`(6：`enc:v1/v2:`+aes-256-gcm+keyring service) + `@napi-rs/keyring` + Main 独占 cipher（`credential-cipher-request/result` 消息）+ `credentialStoreRecovery:"local-desktop"` 暴露策略 + CLI shared-credentials 大改（recovery guard）+ zai_cn 渠道凭据键 | 无（明文 credentials.json 时代） | ~25 文件 | 跟随 |
| A7 | **windows-runtime-host.exe** | C++ Job 归属原生件（main.cpp/CMake/验收）+ services 封装 + spawn 链替换 + 打包签名 + `prepare:windows-runtime-host` | 无（CLI spawn 直启；W1 换装有自研 helper 链但职责不同） | ~15 文件 | D3 |
| A8 | **voice-input 服务端听写** | services `voice-input/`(7，WebSocket ASR) + desktop `microphone-access/`(6) + ui `voice-input/`(~10：AudioWorklet PCM16/`setVoiceText`) + mac entitlement + wdio fake-media | **对撞**：自研 `ui/src/voice/`（厂商 ASR/TTS+音色+命令总线）+ `22038fc10` 系统级听写主干（右⌥+右⌘ 全局触发）——入口 Composer/Lexical 双命中 | ~23 文件 | D6 |
| A9 | **i18n 三新语言+五语言基建** | ja-JP/ko-KR/ru-RU（26K 行）+ `SUPPORTED_LOCALES` 五语言 + LocaleSwitcher 循环 + locale 基建迁 `@zcode/shared`（i18n.ts）+ `ZCODE_CLIENT_LANGUAGE` env + X-Client-Language 全链贯穿（遥测/远控/help/灰度门控） | 仅 zh-CN/en-US；locale 枚举两语言；无 X-Client-Language 链 | 3 语言文件+基建 ~20 文件 | D4 |
| A10 | **plugin-api npm 包** | `@zcode-dev/plugin-api@1.4.0`（`EXTENSION_API_VERSION`，import-type-only，对外发布） | 无 | 7 文件 | 随 D2 |
| A11 | **会话永久删除** | SQLite migration `0025_session_permanent_deletion` + v4 `v4/storage/sessionData/deletionPreview|deletionExecute` + Host `permanentlyDeleteArchivedTask`/preview + schema.baseline +359 行 | 无（归档即终点） | ~10 文件 | 跟随 |
| A12 | **agent-crash-diagnostic** | shared 模块（parse/sanitize/fingerprint/分类）+ desktop 上报收敛 + `test:agent-crash-diagnostic` 取样 CI | 无 | ~8 文件 | 跟随 |
| A13 | **浏览器截图导出族** | Main 取帧 `desktopCaptureBrowserGuestPage`（错误码 6 个/15s deadline）+ ui 页面导出 PNG/PDF/元素截图/图片标注编辑器（image-preview ~6） | 无（浏览器面板无导出） | ~10 文件 | 跟随 |
| A14 | **settings-search** | ui ~9 文件（搜索框+索引+`settingsNavigationSearch` 包裹层） | 无 | ~9 文件 | 跟随 |
| A15 | **web share-manage 页** | `/share/manage`（列表/撤销/恢复/删除/TTL）+ web `auth/` 契约化（webRegionalOAuth/Web Locks）+ core-js polyfill + pdfjs legacy | 无（conversation-share 有但无管理页；web auth 未契约化） | ~38 文件 | 跟随 |
| A16 | **分区登录 zai_cn** | CLI 渠道凭据键 + `docs/zcode-login-rework.md`（中国区/全球分区+套餐关联） | 无（单渠道） | 部分（CLI 键+文档） | 跟随（评估必要性） |
| A17 | **更新器安全强化** | pkijs CA 全链校验（keyUsage/EKU/弱算法/名称约束）+ `zcodejwttoken` manifest 鉴权 + autoUpdater session 纳管 + NSIS 卸载恢复机制 + `mac-electron-locales` fail-closed + **行为反转**（`autoInstallOnAppQuit=false`+删 before-quit 安装） | **裁决删除区**：forceUpdateGuard/manifestUpdateProvider 已按 update-feed-github spec 删（`3813c0637`），上游又改 176/232 行；autoUpdater.ts 真分叉（THREE-WAY 难层） | ~15 文件 | **D5** |
| A18 | **E2E 重组后新场景** | Dynamic Workflow 灰度 20 个（gray-always-on 全家桶）+ 扩展宿主 15 个 + 设计模式 4 + 凭据 4 + remote/R3 11 + 会话控制 4 + 131 测试/284 fixtures/19 helpers | 无（test 布局仍是 v3.17.2 形态；Drora 独有 43 文件共存） | 425 全新+658 迁移映射 | D7 |
| A19 | **hooks lint 强约定** | AGENTS.md 新条款 + `.oxlintrc.json` 全仓 `rules-of-hooks:error`/`exhaustive-deps:warn` + 7 存量例外 + react-doctor 0.9.22 + `react-hooks-lint.test.mjs` 入 test:architecture | 无 | 3 配置+规格文档 | D8 |
| A20 | **工具分组架构重构** | 删 cuaGroup/executeGroup/changesGroup 专用渲染器+`conversationCuaGroups`+explore.bucket+4 个 toolGrouping 设置开关 → 通用 `groupConsecutiveAssistantSummaries`+`ConsecutiveSummaryGroup`+BoundaryContext | 旧架构（v3.17.2 形态）；上轮 CUA 战役刚碰过 cua 面渲染 | ui ~10 文件删改+62 i18n 键删 | D9 |
| A21 | **runtime 观测面** | context-composition（模型请求组成投影+`v4/conversation/contextComposition` 方法+Changed 通知）、prompt-snapshot（冷恢复 cache 前缀保持）、`v4/telemetry/model-request-metrics`、total-tokens、BackgroundResultOriginMeta.subagentStall（env `ZCODE_SUBAGENT_STALL_NOTIFY_MS`）、workflow web 搜索预算（128/1024） | 无 | ~15 文件 | 跟随 |

### B. 部分缺失 / 契约面落后（Drora 有对应物，但内容落后 v3.18.0）

| # | 面 | 上游 v3.18.0 | Drora 现状（main） | 差距 |
|---|---|---|---|---|
| B1 | **协议 v4 方法/事件集** | +`appControl*` 13 方法+cancel、`sessionReleaseUnderDirectory`、deletionPreview/Execute、contextComposition+Changed、model-request-metrics、SessionEventType+4（worktree_created/turn_steer_edit_lock_changed/plugin_install_requested/resolved）、能力位 +7（worktreeCwd/extensionInputSource/conversationQuoteComment/pluginExtensionSummary/appControlEnabled/highspeedCardOwner/pluginDiscoveryUi）、command 增 worktreeCreationRecord/forkTargetCwd/sendText source/modelSelectionBasis/submission mode、rows/snapshot 增 attachments/conversationQuotes/v4ColdResumeWorkspace | `drora-protocol`/`drora-protocol-v4` 停在 v3.17.2 集（+自研扩展） | 全部新方法/事件/能力位缺；合并时经 channels.ts 真分叉（THREE-WAY）落 |
| B2 | **channels/IPC 面** | 新 ServiceChannels 5（managed-worktrees/extensions/extension-views/extension-grants/voice-input）+ PlatformChannels 6+（microphone/capture-guest/show-extension-notification/promote-draft-tabs/design×2）+ `__zcodeDesign` 桥 + InternalChannels 1 + Host 消息 3 | `drora-*` 别名桥体系（自研），无上述新频道 | 新频道全缺；别名桥语义需扩展裁定（哪些官方频道要桥） |
| B3 | **模型工具面** | +SearchPlugins/+SuggestPluginInstall/+session-control 12/+ReadTopicResource；**−ReadSessionContext**（全链删除）；ListModels 改「有消费者才注册」 | 仍有 ReadSessionContext；ListModels 旧语义 | 工具净差 +16/−1；ReadSessionContext 退役迁移 |
| B4 | **AppSettings 键** | +fileTreeHtmlClickOpensBrowser/mobilePushEnabled/pluginAutoRecommendationEnabled；**−toolGrouping*** 三项 | 无新键、仍有 toolGrouping* | 键集差异 6 |
| B5 | **env 键族** | +ZCODE_DATA_BASE_DIR/ZCODE_SUBAGENT_STALL_NOTIFY_MS/ZCODE_CLIENT_LANGUAGE（+extension-host 白名单 15 键/进程标签） | 无 | 3 主键+进程面白名单 |
| B6 | **错误码族** | +ZCODE_PLUGIN_SOURCES_CHANGED/ZCODE_PLUGIN_STARTUP_TIMEOUT/ZCODE_CREDENTIAL_STORE_CHANGED/ZCODE_CREDENTIAL_DECRYPT_FAILED/ZCODE_FILE_LOCK_TIMEOUT/ZCODE_RUNTIME_MODEL_UNAVAILABLE（CLI）；startup/pluginsDegraded 诊断事件 | 无 | 6+1 |
| B7 | **i18n 键内容** | en +575/−62、zh +569（extensions 94/browser 74/managedWorktree 67/conversationShare 48/voiceInput 26…） | 双语键集停在 v3.17.2+自研键 | 键差 ~570×2；上游删 62 键与本仓交集需核对 |
| B8 | **远程链路演进** | Relay V2 收尾（JWT 设备注册+一次性 token）、`syncRuntimeRemoteSession`、启动恢复目标策略重写、`ScopedServicePortReleased` 成套链、换代回收失败 publishRemoteSessionClosed、手机加速卡入口修复、terminal `listTerminalIdsUnderPath`、Source Server 更新互斥/可取消（updateCancelable/cancelUpdate/cancelSourceUpdate）、mobilePushEnabled 开关+语言头 | 双 relay 切换自研（webRemoteControlRelayOrigin）基于 v3.17.2 面；无上述修复 | 上游 10+ 修复点未吸收，与自研双 relay 叠加成最大撞车区 |
| B9 | **桌面本体修复群** | 键盘路由焦点 iframe（修 Esc 误停）、tab 静音、日志脱敏重写（JSONL 递归/计数键白名单）、退出并行 dispose、任务归档关 tab、unreadBadge 纯红点、locale 冷启动修复（cuaPermissionPanelMessages ja/ru/ko 崩溃修复）、IPv6 hostId、GLM-5-Turbo 退役 | v3.17.2 形态 | ~20 修复点未吸收（多在 FAST-FORWARD 桶，机械可得） |
| B10 | **测试/CI 基建** | E2E 容器准入（ZCODE_E2E_SSH_CONTAINER）、权重 129 键换路径、`test:e2e:mr-changed:windows`（MR 失败自动 Draft）、定向取样 CI 例外、engineering 清单 +10、wdio 强制 test env | v3.17.2 形态 | 基建四件套与新 CI 入口缺（D7 联动） |
| B11 | **依赖** | +@napi-rs/keyring 2.1.2/core-js 3.51.0/pkijs 3.4.3/@modelcontextprotocol/server 2.0.0/react-doctor 0.9.22 + `@radix-ui/react-menu` 补丁 | 无 | 5 新依赖+1 补丁（electron/react/vite/AI SDK 零变化——W1 重编链安全） |
| B12 | **架构治理** | architecture-policy 12 新 managed 模块+准入、`session-control-boundary` 入 lint、4 新 tsconfig 工程（app-navigation/extension-host/renderer-services/design-runtime 并入 references）、typecheck/lint/test:architecture 命令形态 | v3.17.2+自研 adopt 段 | policy 基线漂移需重放（v3.17.2 同款工序） |

### C. 有意分歧（不跟随 / 自研替代——合并时保 ours 或裁定保留）

| # | 分歧 | Drora 立场 | 上游 v3.18.0 关系 |
|---|---|---|---|
| C1 | 品牌与命名体系 | zcode→drora 全域改名+官方锚点豁免（specs/drora-rename.md）+`OFFICIAL_RPC_CHANNEL_ALIAS_PREFIX` 别名桥 | 每轮合并 transform 消解；新字面量需逐族定改名/豁免 |
| C2 | 裁测策略 | D1 跟随上游裁掉 packages 单测（test:drora 基线 1881） | 上游 v3.18.0 延续该策略，无新冲突 |
| C3 | 发行更新链 | update-feed-github spec：forceUpdateGuard/manifestUpdateProvider 删除、自有 feed | 上游继续演进两者（+鉴权头/logger）→ **D5 需重裁** |
| C4 | 手机远控端 | mobile-web 整包（5,299 文件）+ 双 relay 切换 | 上游手机页走官方链路；relay 面每轮撞车（B8） |
| C5 | CUA 三件套 | zcode-cua-helper（W1-W5 刚收官）+ zcode-cua 引擎重切 + 冻结区 R3 保卫 | 上游删 cua-group 渲染/改 prepare-windows-cua-helper → D9 联动，按 R3 先例逐案 |
| C6 | 拟人系统/persona | drora-persona（ui+services）+预设评测资产 | 上游无对应（dynamic-workflow persona.ts 是另一概念，防误伤） |
| C7 | 厂商语音 | ui/voice（ASR/TTS/音色/命令总线）+系统级听写主干 | 上游 voice-input 是 dictation 通道 → D6 共存或收编 |
| C8 | obsidian 插件 | obsidian-plugin（Vault 抽离官方插件化，`4c9be763b`） | 上游无 |
| C9 | agents-team | feat/agents-team（内核/协议/UI/journal，分支在途） | 上游无（A1 Session Control 部分场景重叠 → D1 对照表） |
| C10 | 自研独有包 | android/formal-proof/provider/provider-node/relay-client/relay-server/share-ui/stream-animate/web-share/model-option-map/e2e-report 等 | 上游无，合并零冲突 |

## 3. 契约字面量差距计数（供 bundle parity 与全链 grep）

- ServiceChannels +5；PlatformChannels +6；EmbeddedBrowserWebview +2（+`__zcodeDesign` 桥常量）；InternalChannels +1；Host 消息对 +3（credential-cipher/quit-blockers）；preload 桥 API +8
- 协议方法：`appControl/<name>`×12+cancel、`sessionReleaseUnderDirectory`、v4 方法 +3、通知 +2、SessionEventType +4、能力位 +7、权限键模式 `session_control.*`×12
- env：`ZCODE_DATA_BASE_DIR`、`ZCODE_SUBAGENT_STALL_NOTIFY_MS`、`ZCODE_CLIENT_LANGUAGE`（→DRORA_ 域）+ extension-host 白名单 15 键与 `ZCODE_PROCESS_LABEL`
- 凭据/持久化：`zcodejwttoken`、`enc:v1:`/`enc:v2:`、keyring service `"ZCode Credential Encryption"`、`credential-secret`、`credential-source`、`~/.zcode/v2/extensions`、`BROWSER_VIEW_DRAFT_SESSION_ID="unscoped"`、setting.json `uiLocale` 字段
- 错误码/诊断：CLI 6 个 + `startup/pluginsDegraded` + source server `remote-connection-canceled`/`SOURCE_SERVER_UPDATE_IN_PROGRESS_ERROR_CODE`
- i18n：en +575/−62（zh 同步）；Locale 枚举 2→5
- 完整逐字清单见 99-final-report §3.1/§3.5

## 4. 差距的合并路径映射

| 差距类 | 数量/规模 | 路径 |
|---|---|---|
| A 整链缺失（21 域） | ~830 文件 | D1-D10 裁定后分段吸收（S2/S3 切段）；多数为 NEW 桶纯落位 |
| B 契约/修复落后 | ~4,500 文件变更的 90% | FAST-FORWARD/DEL-FOLLOW 机械桶 + THREE-WAY 中易层 320 条 |
| B 难层 | 212 文件 | 逐 hunk 三方合并（清单 01 §2 Top40） |
| C 有意分歧 | — | 保 ours / 裁定登记（C3/C5/C7 需逐案） |

**结论**：与上游的差距 = **一整个 v3.18.0 大版本**（21 条全新能力链 + 10 余项安全/远程修复 + 五语言国际化 + E2E 体系重组），其中 90% 文件面无分叉阻力可机械同步；真正的难点集中在 532 个真分叉文件（i18n 双语、协议面、drora-agent/host/main 三个 index、远程链路、上轮 model-capabilities 接线区）与 10 项裁定（D1 Session Control / D2 Extension Host / D3 runtime-host / D5 更新链 / D6 语音 为结构级）。
