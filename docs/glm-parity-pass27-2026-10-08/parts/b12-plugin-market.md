# b12 插件商店与 15 内置包对位（pass27 · 2026-10-08）

调查员：F2（静态对拍，只读）。真值 = `D:\software\zcode\resources\glm\zcode.cjs`（0.16.9）+ `D:\software\zcode\resources\glm\packages\`（15 包明文）。我方 = `D:\workspace\projects\Drora`（feat/migrate-remote-and-pet）。bundle 证据用字节偏移标注（`grep -ob`），我方证据用 `文件:行`。

## §1 商店机制

| 机制点 | 真值（bundle 偏移/证据） | 我方（文件:行） | 裁决 |
| --- | --- | --- | --- |
| 目录数据源 | 官方市场 source=`https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`（off 504908）；另有第二默认市场 `claude-plugins-official`（source `anthropics/claude-plugins-official`，off 504496） | `packages/shared/src/plugin-marketplaces.ts:32-42` 仅 1 个官方市场，source URL 与真值逐字相同 | 官方市场一致；**第二默认市场缺失（G2）** |
| 市场持久化 | `known_marketplaces.json` / `installed_plugins.json` / `marketplace.json`（off 4238900 段常量区） | `apps/drora-cli/packages/adapters/src/plugins/marketplace.ts:51-52` 同名同路径 | 一致 |
| 官方目录三分片 | `bundled-marketplace.json`+`cdn-marketplace.json`→`marketplace.json` 合并；函数集 writeBundledOfficialMarketplacePartitionSync/writeCdnOfficialMarketplacePartitionSync/rebuildOfficialMarketplaceSync/loadBundledOfficialPluginRootsSync（off 4155400-4155801） | `apps/drora-cli/packages/adapters/src/plugins/official-marketplace.ts:5-86` 同名同构；同名 CDN 条目优先、不删内置缓存（:69-83） | 一致（i01 刷新持久化案两侧均已收敛为分片+合并） |
| 写盘节流 | writeJsonFileSync 先读后写、同字节跳过（off 4155400 段） | `official-marketplace.ts:142-154` 同逻辑同注释语义 | 一致 |
| 刷新周期 | CLI 侧无定时器：`ensureMarketplaceManifestAvailable`（off 4201300 段 `tge`）缓存命中即返回；刷新只由 RPC 触发，周期在 UI | CLI 侧同（`bootstrap/src/plugins.ts:509-588` 纯 RPC）；UI 节流 10min（`packages/ui/src/settings/officialMarketplaceAutoRefresh.ts:15`） | 一致（真值 UI 窗口不可从 CLI bundle 验证，见 Q4） |
| 刷新失败持久化 | `persistMarketplaceRefreshFailure`（off 4241864）+ summary schema `refreshFailure{code,failedAt,message}`（off 776651） | `marketplace.ts:547-551,1870`；AbortError 不落盘（:543-545） | 一致 |
| 官方 id 重命名桥接 | 官方源 manifest 必须名 `zcode-plugins-official`，否则拒绝（off 4201300 段 `Tre` 尾部守卫） | `marketplace.ts:364-391` 先把 `zcode-plugins-official` 归一为 `drora-plugins-official` 再走同一守卫（:374-391） | 一致（rename 规则 0，我方多一步归一，属预期） |
| 版本比较 | `comparePluginUpdate` + `update-available`/`version-changed` 各 3 处 | `apps/drora-cli/packages/adapters/src/plugins/version-compare.ts:30`；overview 双轴 version+sha（`bootstrap/src/plugins.ts:316-331,369-381`） | 一致 |
| Featured 策展 | summary schema 含 `featured: string[]`（off 776651 段 `hYe`） | `marketplace.ts:2043-2058` 解析顶层 featured；`plugins.ts:101-102,294-311` 透传 | 一致 |
| pluginCount 口径 | 官方市场排除 `node-repl-host`（off 4203514 前 `I$a`：`e!==Yp?t.length:t.filter(n=>n.name!==Uwt).length`） | `bootstrap/src/plugins.ts:241-248` countVisibleMarketplacePlugins 同口径同注释理由 | 一致 |

## §2 seed 机制

| 机制点 | 真值 | 我方 | 裁决 |
| --- | --- | --- | --- |
| seed 函数集 | `seedBundledOfficialPlugins`/`resolveOfficialPluginRoots`/`writeOfficialMarketplace`/`isSeedCurrent`/`isSeedUsable`/`findUsableOfficialPluginFallback`/`replaceSeedRoot`/`createSeedBackupRoot`/`cleanupLegacySeedBackup`/`warnCacheDegraded`/`seedMarker`/`officialPluginCacheRoot`/`candidateBaseDirs`/`modeForSeedFile` 全部同名（off 13834636 注册区） | `apps/drora-cli/packages/bootstrap/src/app/bundled-plugins.ts` 逐一同名同构（:91-211,227-255,409-629） | 一致（我方为真值忠实移植） |
| seed 标记与预算 | `.zcode-plugin-seed.json`；锁预算 `15e3`（off 13834600 段） | `bundled-plugins.ts:36-37` 同名 marker + `SEED_LOCK_TOTAL_BUDGET_MS=15_000` 共享截止 | 一致 |
| 原子性 | temp 目录 + sha256 逐文件校验 + 唯一 backup + rename promote + 并发赢家识别 | `bundled-plugins.ts:146-209,515-575` 逐条对应 | 一致（历史"裸写"案两侧均已修复） |
| seed 锁 | `withOfficialPluginSeedLock` + `OfficialPluginSeedLockTimeoutError`（同名命中） | `bootstrap/src/app/official-plugin-seed-lock.ts:15,56`；超时降级回退旧缓存（`bundled-plugins.ts:186-207`） | 一致 |
| 顶层白名单 | `.mcp.json/.zcode-plugin/README.md/agents/commands/dist/docs/hooks/output-styles/package.json/scripts/skills/templates`（off 13834636 前行） | `bundled-plugins.ts:39-56` 逐项相同 | 一致 |
| 静默丢弃 | `resolveFilesystemSeedSource` flatMap：rootCandidates 找不到即跳过、无告警；缺 requiredSeedPaths 单插件降级告警（off 13834636 后 `Aje`/seed 循环 `jwt||A7o||DEn&&PEn` 分支） | `bundled-plugins.ts:294-314`（root 缺失静默 skip）+ `:113-128`（缺 seed 资产单插件告警降级） | 一致（"root 缺失静默"两侧同在，见 G1 影响放大） |
| 默认启用集合 | `browser-use,image-search,documents,pdf,presentations,spreadsheets,node-repl-host,skill-creator,plugin-creator,zcode-guide` 共 10 id（off 504444 段 `iji`） | `packages/shared/src/plugin-marketplaces.ts:13-30` 同 10 项（zcode-guide→drora-guide）；`official-plugin-definitions.ts:370-374` 双处机械对照 | 一致 |
| 命名空间映射 | 无映射，原名 `zcode-guide`/`computer-use` | guide 改名 `drora-guide`（definitions:316），cua 保持 `computer-use`（:335）；CUA 额外由 feature flag 门控（`bundled-plugins.ts:236-239`） | 一致性成立（真值 CUA 门控在 suppressedBuiltins 过滤处，off 4202238 段 `wde`） |
| 恢复内置插件 | `restorableBuiltins`（off 13837751）+ restore 守卫 | `bootstrap/src/plugins.ts:342-359,891-916`；CUA 恢复需 feature flag（:893-900） | 一致 |

## §3 15 包对位表

真值包 = `D:\software\zcode\resources\glm\packages\*`；"落地"指我方仓库是否存在对应源码包且会被打包链 stage（`packages/desktop/scripts/prepare-agent-node-bundle.mjs:96-126` 仅 stage browser-use-plugin/node-repl-host/bundled-skills 三个目录；`apps/drora-cli/packages/cli/scripts/sea-official-plugin-assets.mjs:28-63` SEA 仅嵌 node-repl-host+browser-use 两插件）。

| # | 真值包（名/版本/manifest name） | 功能 | 我方对应物 | 裁决 |
| --- | --- | --- | --- | --- |
| 1 | android-emulator-plugin 0.1.0 / android-emulator | Android 模拟器 MCP+技能 | definition 有（definitions:119-127, v0.1.0）；**包缺失** | REAL-GAP G1 |
| 2 | browser-use-plugin 0.5.1 / browser-use | Browser Use skill+client | `apps/drora-cli/packages/browser-use-plugin` @drora v0.5.1；skills（control-browser/web-gui-tester）与 docs 15 文件逐一相符 | 一致（@zcode→@drora 改名） |
| 3 | bundled-skills（无 npm 包）/ dynamic-workflows | CLI 内建技能包（插件系统外） | `apps/drora-cli/packages/bundled-skills`，skills/dynamic-workflows 三文件同构；缺 README.md | 一致（E2 琐碎差） |
| 4 | documents-plugin 0.1.7 / documents | DOCX 技能 | definition 有（definitions:157-183 map，v0.1.7）；**包缺失** | REAL-GAP G1 |
| 5 | image-search-plugin 0.1.1 / image-search | 搜图 MCP | definition 有（definitions:195-204, v0.1.1）；**包缺失** | REAL-GAP G1 |
| 6 | ios-simulator-plugin 0.1.0 / ios-simulator | iOS 模拟器 MCP | definition 有（definitions:216-224, v0.1.0）；**包缺失** | REAL-GAP G1 |
| 7 | node-repl-host 0.6.0 / node-repl-host | node_repl MCP 宿主 | `apps/drora-cli/packages/node-repl-host` v0.6.0，description 逐字同 | 一致 |
| 8 | pdf-plugin 0.1.7 / pdf | PDF 技能 | definition 有；**包缺失** | REAL-GAP G1 |
| 9 | plugin-creator-plugin 0.1.1 / plugin-creator | 插件创作技能 | definition 有（v0.1.1，requiredSeedPaths 8 项逐字同 bundle）；**包缺失** | REAL-GAP G1 |
| 10 | presentations-plugin 0.1.7 / presentations | PPTX 技能 | definition 有；**包缺失** | REAL-GAP G1 |
| 11 | restore-legacy-sessions-plugin 0.1.0 / 同名 | 旧版会话恢复 | definition 有（v0.1.0）；**包缺失** | REAL-GAP G1 |
| 12 | skill-creator-plugin 0.1.0 / skill-creator | 技能创作 | definition 有（v0.1.0）；**包缺失** | REAL-GAP G1 |
| 13 | spreadsheets-plugin 0.1.7 / spreadsheets | XLSX 技能 | definition 有；**包缺失** | REAL-GAP G1 |
| 14 | zcode-cua-plugin 0.6.3 / **computer-use** | Computer Use SDK+技能 | definition 有（computer-use v0.6.3，rootCandidates `packages/drora-cua-plugin`）；**包缺失**；SDK 侧 `packages/zcode-cua`=@drora/drora-cua 0.6.3 fail-closed 占位（真值为真实现）；runtimeTopLevelPaths 真值 `["node_modules"]` vs 我方 `[]` | REAL-GAP G1 + S1/S4 |
| 15 | zcode-guide-plugin **0.3.0** / **zcode-guide** | 配置指南+5 项诊断技能，无 commands；requiredSeedPaths=`[skills/zcode-configuration-guide/SKILL.md]`（bundle G7a） | 改名 **drora-guide v0.2.0**（definitions:316-325）；requiredSeedPaths=`commands/workflow.md + skills/dynamic-workflows/*`（:82-87）；**包缺失** | G1 + G3/S2 |

**superpowers-plugin 裁决**：`apps/drora-cli/packages/superpowers-plugin/` 仅含 LICENSE（1091B），无 manifest 无内容，由全量改名提交 7ad83db8 引入。真值 `resources/glm/packages/` 无此包；bundle 中 "superpowers" 仅 1 处且是路径过滤字符串（off 13993 `"/docs/superpowers/plans/"`），真值的 superpowers 是 claude-plugins-official 市场的可安装社区插件（本机 truth 安装缓存可证）。结论：**EXTRA 占位死包，非真值 15 包对应物**（E1）。

## §4 数据面（CLI 侧 RPC/事件）

真值 RPC schema 全集（bundle 命中）：zcodePlugins{Overview,List,SetEnabled,Install,Uninstall,Update,Validate,Describe,Configure,ResetConfig,RestoreBuiltin,CancelOperation,MarketplaceAdd,MarketplaceRemove,MarketplaceUpdate,ReferenceCatalog,ResolveSuggestedReference}{Params,Result}Schema。

我方：`packages/shared/src/drora-protocol/index.ts`（droraPlugins* 同名 17 组，CancelOperation :3179，ReferenceCatalog :2628）+ `apps/drora-cli/packages/bootstrap/src/drora-protocol/plugins.ts:2-15` 与 `plugin-reference-catalog.ts:7-8`、`server.ts:694`。方法集一一对位（zcode→drora 前缀）。overview 返回结构 `marketplaces/availablePlugins/installedPlugins/restorableBuiltins/diagnostics`（`bootstrap/src/plugins.ts:136-142`）与真值 off 4202238 段 `$ie` 返回键一致；summary 字段（id/name/source/description/lastUpdated/pluginCount/isOfficial/featured/refreshFailure）与真值 schema `hYe` 逐字段同构。**无缺口。**

## §5 差集三分类

| 编号 | 类别 | 级别 | 差异 | 证据 |
| --- | --- | --- | --- | --- |
| G1 | REAL-GAP | **P1** | 14 个官方插件定义中 12 个无源码包（android-emulator/documents/pdf/presentations/spreadsheets/image-search/ios-simulator/restore-legacy-sessions/plugin-creator/skill-creator/drora-guide/drora-cua）：本 checkout 与桌面包均缺失，seed 静默跳过 → 生产 bundled 分区仅 2 插件（browser-use/node-repl-host），商店开箱目录较真值（14 插件 seed）缺 12 项；刷新前商店公开段近乎空 | 我方 `prepare-agent-node-bundle.mjs:96-126`、`sea-official-plugin-assets.mjs:34-63`、`bundled-agents/win32-x64/glm/packages/` 仅 3 目录；真值 `glm/packages/` 15 包、census 缓存 14 插件 |
| G2 | REAL-GAP | P2 | 第二默认市场 `claude-plugins-official`（anthropics/claude-plugins-official）及整套 Claude 图标富化子系统缺失：icon-sources.json、applyClaudePluginIcons/enrichCachedClaudeMarketplaceIcons/loadClaudePluginIconSources/isSafePluginIconPath、CDN `assets/icon-sources.json`（bundle off 504496、4238900 段） | 我方 `plugin-marketplaces.ts:32-42` 仅 1 市场；`grep applyClaudePluginIcons|icon-sources` 我方 adapters 0 命中 |
| G3 | REAL-GAP | P2 | guide 插件版本漂移：真值 zcode-guide **0.3.0**（6 技能版型）vs 我方 drora-guide **0.2.0**；内容版型分叉见 S2；上游 0.3.0 的技能演进未跟进 | bundle `G7a=["skills/zcode-configuration-guide/SKILL.md"]`、manifest name/version；我方 `official-plugin-definitions.ts:82-87,324` |
| G4 | REAL-GAP | P3 | computer-use 图标 URL 指向 `drora-cua/icon.png`；真值与共享 CDN 实际发布路径为 `zcode-cua/icon.png`（z.ai CDN 不可改名）→ 大概率 404，UI 降级默认图标 | 我方 `official-plugin-definitions.ts:349`；bundle u9 `icon:`${OK}/zcode-cua/icon.png`` |
| E1 | EXTRA | P3 | `apps/drora-cli/packages/superpowers-plugin/`：LICENSE-only 占位死包，无 manifest；真值无对应内置包（superpowers 属 claude-plugins-official 社区插件，且我方未引入该市场） | `ls` 仅 LICENSE；git 7ad83db8；bundle superpowers 仅 1 处路径串 |
| E2 | EXTRA | P3 | bundled-skills 缺 README.md（真值有，说明"插件系统外内建技能"定位） | 真值 `bundled-skills/README.md` 存在；我方 `find` 无 |
| S1 | SHAPE-DIFF | P3 | computer-use `runtimeTopLevelPaths`：真值 `["node_modules"]` vs 我方 `[]`（有意：CUA SDK 为 fail-closed 占位，不复制 native runtime） | bundle u9 尾部；我方 `official-plugin-definitions.ts:358-359` |
| S2 | SHAPE-DIFF | P3 | drora-guide 内容版型：我方自加 `commands/workflow.md` + dynamic-workflows 技能拷贝（真值 guide 无 commands，dynamic-workflows 在 bundled-skills）；诊断技能沿用 | 我方 definitions:82-87,296-325；真值 `zcode-guide-plugin/skills/` 6 目录无 commands |
| S3 | SHAPE-DIFF | P3 | 命名空间整体重命名 zcode→drora：市场 id、包名 @zcode→@drora、listing 文案（"操作 Drora 内置浏览器"等）；官方 CDN manifest name 经归一桥接接入 canonical id —— 有意且两侧守卫语义等价 | `plugin-marketplaces.ts:10,44-45`；`marketplace.ts:364-391` |
| S4 | SHAPE-DIFF | P3 | `packages/zcode-cua`=@drora/drora-cua 0.6.3 为 fail-closed 占位 SDK（真值 @zcode/zcode-cua 为真实现）；影响 computer-use 插件无法真实运行 | `packages/zcode-cua/package.json:1-6` |

计数：REAL-GAP 4（P1×1、P2×2、P3×1）· EXTRA 2（P3×2）· SHAPE-DIFF 4（P3×4）。

## §6 OPEN-QUESTION

- Q1：`https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json` 的实际条目集与 featured 名单离线不可验证；若 CDN 列全 12 个缺失插件且用户联网刷新过，G1 的用户可见影响从"商店近空"降为"开箱目录空、刷新后恢复"。建议在线拉取一次或检查桌面 mock-cdn 扩充计划（现 mock-cdn 也仅 2 插件，`packages/desktop/mock-cdn/releases/3.14.3/glm/darwin-arm64/packages/`）。
- Q2：12 个插件包离开 monorepo 是有意（改由 CDN 下发、仓库减负）还是迁移遗漏？definition 的 rootCandidates、SEA 清单（sea-official-plugin-assets 仅 2 插件）与 prepare-agent-node-bundle 三方都只覆盖 2-3 个包，但 definitions 仍声明 14 个——若是前者，definitions 与 requiredSeedPaths 是死配置；若是后者，需补包。
- Q3：claude-plugins-official 市场与 Claude 图标子系统（G2）是有意裁剪还是待迁移？CONTEXT.md 将 Official Marketplace 定义为"唯一分发渠道"，与真值双默认市场矛盾，需产品裁决。
- Q4：真值 UI（renderer bundle 不在本次真值资产内）的 Catalog Auto-Refresh 节流窗口无法验证；我方为 10min（`officialMarketplaceAutoRefresh.ts:15`），仅能确认 CLI 侧"无定时、RPC 触发、缓存短路"语义两侧一致。
- Q5：drora-guide 0.2.0 的 requiredSeedPaths 含 `skills/dynamic-workflows/examples.md`，但 bundled-skills 的同名技能在真值 0.16.9 中同样存在——两份拷贝的分工（guide 内 vs CLI 内建）在我方是否有意，待与 skill 域调查员对拍。
