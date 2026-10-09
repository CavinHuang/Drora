# b11 插件宿主对拍报告（pass27 · 2026-10-08）

真值 = `D:\software\zcode\resources\glm\zcode.cjs`（0.16.9，14.8MB 单行混淆 bundle，证据给字节偏移）。
我方 = `D:\workspace\projects\Drora`（feat/migrate-remote-and-pet）。
域：插件加载、manifest、宿主重入链、隔离与生命周期。UI 插件商店（packages/ui）不在本报告。

---

## §1 插件发现与加载

### 真值（bundle 证据）
- 存储根：`getCliStorageRoot`（basename 非 "cli" 则 join "cli"，@13837580 一带）→ `getPluginStorageRoot = join(cliRoot, "plugins")`；默认 `storage.dir = "~/.zcode"` ⇒ `~/.zcode/cli/plugins`（offset 1302140 附近默认配置块）。
- manifest 发现顺序：`.zcode-plugin/plugin.json` → `.claude-plugin/plugin.json` → `.codex-plugin/plugin.json`（常量 qzs/Wzs/Vzs @4281897-4281992）；名字正则 `/^[a-z0-9][a-z0-9._-]{0,127}$/`，缺省版本 "0.0.0"（@4282039-4282066）。
- 候选来源顺序（`resolveCandidates` @4282400 窗口）：`plugins.dirs`（source "inline"、marketplace "inline"、defaultEnabled true）→ officialPluginRoots（seeded，source "official"）→ `scanOfficialCache` → 各 known marketplace（source "cache"）。同 id 去重：首个胜出，后续记 `plugin_duplicate_id` warning。
- 优先级：首插件 1000、步进 10（Gzs=1e3, Jzs=10 @4282039 窗口）；skills 取 priority，commandRoots 取 priority+1。
- manifest 键全集（15 个内置包实测 + bundle schema）：name/version/description/description_i18n/author{name,url}/homepage/license/skills/commands/agents/hooks/mcpServers/userConfig；诊断性保留键：channels/lspServers/outputStyles/settings（`Zzs` @4282100 → `plugin_unsupported_component` warning）。
- mcpServers 形状：stdio（command/args/cwd/env）与 http/sse（url/headers/http_headers/oauth/timeoutMs/isolation: session|workspace/protocolVersion: legacy|auto|"2026-07-28"）（offset 13436 窗口 `convertToZCodeAgentMcpServer`）；`zcode_official`+`jwt_token` 官方鉴权（@4139400）。
- 环境插值：`${ZCODE_PLUGIN_ROOT}/${ZCODE_PLUGIN_DATA}/${ZCODE_PROJECT_DIR}/${CLAUDE_*}/user_config.*/${ZCODE_*}env`（@4142400 窗口）；sensitive user_config 不得进非敏感 sink。
- 数据目录：`<pluginsRoot>/data/<sanitize(id)>`（小写化、非法段替换 "-"、80 截断、空则 "default"，offset 13793000 窗口 Sbe）。
- 配置键（offset 1300800 窗口）：`plugins.{dirs,enabled,enabledPlugins,extraKnownMarketplaces,options,suppressedBuiltins}`，默认 dirs=[] enabled=true enabledPlugins={} suppressedBuiltins=[]；启用判定 `enabledPlugins[id] ?? defaultEnabled`。
- 内置 14 插件注册表（`u9` @13821800 窗口）：每项 defaultEnabled/listing(author,category,displayName,displayName_i18n,icon,examplePrompts)/name/rootCandidates(4 级回退)/requiredSeedPaths/version/hostMcpServerNames(computer-use→["node_repl"])/runtimeTopLevelPaths(computer-use→["node_modules"])。
- seed 机制（@13830000-13835000 窗口）：SEA 资产前缀 `zcode-official-plugins/`，manifest 资产键 `zcode-official-plugins/manifest.json`；seed 标记 `.zcode-plugin-seed.json`{hash,marketplace,plugin,pluginVersion,source,version:1}；存储锁 `withPluginStorageLock`（promise 链）+ 文件锁 `<path>.seed-lock`，总预算 15s（o$a=15e3）；seed 文件顶层白名单含 .mcp.json/.zcode-plugin/README.md/agents/commands/dist/docs/hooks/output-styles/package.json/scripts/skills/templates；文件模式：`dist/mcp/server.js` 与 `hooks/*` 非 json/md/txt → 0755，其余 0644（`modeForSeedFile` @13833500 窗口）；缓存路径 `<pluginsRoot>/cache/zcode-plugins-official/<name>/<version>`；降级回退取同插件最新可用版本目录（跳过 .backup/.seed-lock/.tmp-）；`warnCacheDegraded` 日志 module=`bootstrap.official_plugin_cache`。

### 我方
- 路径/布局/顺序/优先级/名字正则/缺省版本/数据目录 sanitize：逐项一致。`adapters/src/plugins/index.ts:100-107`（三 manifest 路径）、`:104-105`（1000/10）、`:141`（data 根）、`:164`（duplicate id）、`:241-246`（inline dirs）。
- 配置键与启用判定一致：`adapters/src/config/schema.ts:165`（dirs）；`bootstrap/src/plugins.ts:365`（`?? false`）。
- 内置定义 14 项（10 显式 + documents/pdf/presentations/spreadsheets 生成）与真值一一对应：`bootstrap/src/app/official-plugin-definitions.ts`；`DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 对应 `$wt`；`resolveOfficialPluginHostMcpServerNames` 对应真值 y7o。
- seed：`bootstrap/src/app/bundled-plugins.ts`（SEA 前缀 `drora-official-plugins/`:34、marker:36、白名单:39-55、备份/回退:502-506、.pyc/.DS_Store 过滤:665）；`official-plugin-seed-lock.ts`（15s 预算，degraded 降级）。
- env 插值：`adapters/src/plugins/mcp.ts:384-445`（DRORA_*/CLAUDE_* 别名、user_config.*、sensitive 门控、DRORA_* env 分支）。
- 官方鉴权：`adapters/src/plugins/mcp-official-auth.ts`（drora_official+jwt_token 严格解析、拒绝别名）。
- 结论：发现与加载面 SHAPE 一致，无缺项。

## §2 宿主进程模型

### 真值
- 插件 MCP server 以 stdio 子进程运行：command=process.execPath，args=[宿主前缀..., `<root>/dist/mcp/server.js`]，env 追加 `ELECTRON_RUN_AS_NODE=1`（+`ZCODE_PLUGIN_ID=<name>@marketplace`）（`createBundledMcpRuntimeConfig`/`writeOfficialPluginRuntimeManifest` @13821800-13824359 窗口）；宿主前缀：SEA 内为 `["__zcode-plugin-host"]`，否则 `[...execArgv, resolve(argv[1]), "__zcode-plugin-host"]`（`officialPluginHostPrefixArgs` x7o @13824600）。
- 传输层：`ProcessTreeStdioClientTransport extends StdioClientTransport`（@4753400 窗口）：start 后 win32 用 koffi FFI 建 Job Object（LimitFlags=8192=KILL_ON_JOB_CLOSE，CreateJobObjectW/AssignProcessToJobObject/TerminateJobObject），`_dispose` = terminate job → taskkill 兜底 → 父类 close；记录 lastProcessExit/processAlive。
- MCP 池（`createMcpConnectionPool` @4726500 窗口）：lease 按会话（leaseId:seq、sessionId）、refcount、空闲宽限 30s（gHs=3e4）延迟 close（timer unref）；isolation=session|workspace（workspace 需显式声明）。
- stdio env：filterStringEnv 全量字符串 env + PATH 前插当前 node 目录（`fHs` @4718765）。
- 孤儿遥测：`createMcpTelemetryTracker`（@4756800 窗口）owner/session 归属、`orphanSuspected = owners空 && unowned>60s`、memoryScope=process_tree|direct_process；通知方法 `process/mcpTelemetry`、`process/mcpResourceSamples`（BR 枚举 @736155）。
- 关停：SIGINT/SIGTERM（win32）/SIGHUP（posix）→ cleanup（每步 6s 上限，nGe=6e3）→ exit watchdog 1s 强制退出（@16774 Tde 段）。
- 历史基线重测：111 孤儿泄漏案对应的 Job Object+taskkill+pool 宽限+信号关停+遥测五件套在 0.16.9 bundle 内全部在册。

### 我方
- 宿主前缀/ELECTRON_RUN_AS_NODE/SEA 判定：`bootstrap/src/app/official-plugin-runtime.ts:95-111` 与真值逐行同构。
- Job Object：`adapters/src/mcp/windows-job-object.ts`（KILL_ON_JOB_CLOSE 0x2000、koffi）+ `stdio-transport.ts:36-114`（terminate→taskkill 回退→close）。与真值同设计。
- 池：`adapters/src/mcp/pool.ts:16`（IDLE_GRACE 30s）、:162-184（lease/release/refcount）、:425-449（isolation 判定与真值同一表达式）。
- env：`adapters/src/mcp/network.ts:34`（filterStringEnv）+ prependRunningNodeDirectory（同注释语义）。
- 遥测：`adapters/src/mcp/telemetry.ts` + 通知 `process/mcpTelemetry`/`process/resourceSample`（shared/drora-protocol/index.ts:338,342）。
- 关停：`cli/src/shutdown.ts:94`（信号集与真值一致）+ runCliCleanupWithTimeout/exit watchdog 同构。
- 结论：进程模型五件套全部对齐，无孤儿治理缺口。

## §3 宿主重入链

### 真值
- face：`__zcode-plugin-host <server-path> [-- <server-arg>...]`（usage 常量 JMi @14140）；`isPluginHostInvocation(argv)= argv[0]===标记`（BCe @14036）。
- `runPluginHostCommand`（tGe @14140 窗口）：resolve 路径→existsSync→捕获 CUA broker 凭据→`assertCapturedBrokerLaunchIsAuthorized`（有凭据时强制 ZCODE_PLUGIN_ID==="computer-use@zcode-plugins-official" 且 `ZCODE_CUA_NODE_REPL_HOST==="1"`，否则拒绝，@15000 窗口 KMi）→动态 import→要求 `main()` 导出→替换 process.argv→条件恢复 broker socket env→finally 还原 argv/env→失败写 stderr "Plugin host failed: ..." 返回 1。
- 凭据相关 env：`ZCODE_CUA_PERMISSION_BROKER_SOCKET`/`ZCODE_CUA_NODE_REPL_HOST`/`ZCODE_CUA_PERMISSION_BROKER_TOKEN` 等（@9350 窗口）。
- 回流面：插件组件（skills/commands/hooks/mcpServers/agents）在 resolve 时并入会话（§1），hook 注入携带 plugin context{dataPath,id,name,rootPath,sourcePath}（`Zdn` @4276200 窗口）；技能引用信任校验：`plugin_suggested_reference_untrusted_source/conflict/not_listed`（@14537900 窗口），目录刷新 10s 超时 + `plugins/operationProgress` 通知。

### 我方
- `cli/src/plugin-host-command.ts`：face `__drora-plugin-host`、usage 文案、isPluginHostInvocation、捕获凭据授权校验（identity 模式：socket+pluginAuthority 成对 + plugin id==="computer-use@drora-plugins-official" + NODE_REPL_HOST==="1"，:83-106，含身份模式无 token 的中文依据注释）、main() 导出校验、argv/env 还原。与真值逐段对应（差异仅在 brand 与凭据身份模式演进）。
- 信任流：`bootstrap/src/drora-protocol/plugin-reference-catalog.ts:94,131,206`（三个 untrusted/conflict/not_listed 码与中文文案）；进度通知 `plugins/operationProgress`（shared:341）。
- 结论：重入链 parity；凭据门控我方按「身份模式（无 token）」演进，属有意分叉（有注释佐证），非缺口。

## §4 RPC 方法面

### 真值 wire 方法（`zcode.cjs` 实测）
服务层 16（@13851400 窗口 r() 注册表）：resolveZCodePlugins、getZCodePluginsOverview、listZCodePlugins、setZCodePluginEnabled、addZCodePluginMarketplace、removeZCodePluginMarketplace、updateZCodePluginMarketplace、installZCodeMarketplacePlugin、uninstallZCodeMarketplacePlugin、updateZCodeMarketplacePlugin、validateZCodePluginPath、restoreBuiltinPlugin、configureZCodePlugin、resetZCodePluginConfig、validateZCodePlugin、describeZCodePlugin。
另有：cancelPluginOperation（@grep 2 处）、getPluginReferenceCatalog（session|workspace authority，@14537900 窗口 LRn）、通知 plugins/operationProgress。CLI 依赖名→wire 名映射表 erc 共 10 项（@14766000 窗口）。CLI 子命令：list/install/uninstall/enable/disable/update/validate/marketplace（add/list/remove/update）（@14768000 窗口 switch）。

### 我方 wire 方法（packages/shared/src/drora-protocol/index.ts:3617-3646）
plugins/list、/referenceCatalog、/referenceCatalogWithCategory、/resolveSuggestedReference、/setEnabled、/overview、/marketplace/add|remove|update、/install、/cancelOperation、/uninstall、/update、/restoreBuiltin、/configure、/resetConfig、/validate、/describe（16+1 cancel+2 catalog）；另有 skills/referenceCatalog、process/childProcesses。
服务端 handler 14 个（bootstrap/src/drora-protocol/plugins.ts:201-487）+ server.ts cancelOperation:747。CLI 子命令集一致（cli/src/plugins-command.ts:70-86、plugins-marketplace-command.ts:31-68）。
wire schema 细节逐项一致：PluginInfo（含 packageStatus/rootSource/enabledSource/optionSources，shared:2535-2568 vs 真值 @771050 窗口）、hookDetail 13 字段（shared:2487 vs 真值 NGt @769500 窗口）、userConfig option（含 sensitive/title，type 枚举 string/number/boolean/directory/file，shared:2503 vs 真值 Qsr）。

### 对拍结论
方法面同构率极高。缺口与差异见 §6：validatePath 的 wire 入参（REAL-GAP）、命名风格（SHAPE-DIFF）。

## §5 生命周期

- enable/disable：双端同为写 `enabledPlugins[id]` 落 user/workspace config；「变更对新会话生效」文案一致（真值 @888000 窗口 `/plugins` 命令说明）。
- uninstall：marketplace 安装记录优先（installed_plugins.json 为所有权权威）→ 删记录+cache+data；内置插件走 suppression（suppressedBuiltins）+ 清 config + 删 data（保留 cache）；官方 CDN 插件卸载后自愈清理错误 suppression。我方 `bootstrap/src/plugins.ts:753-822` 与真值 Ebe/Abe + Z7o 语义一致（dryRun、dependencyClosure、跨市场依赖三诊断码 cycle/cross_marketplace/missing 均在）。
- restore：内置抑制后可恢复，computer-use 恢复受内部特性开关门控（真值 `wde(env)`；我方 `isDroraCuaInternalFeatureEnabled`，plugins.ts:346,894-899）；restore 即时 re-seed。
- update：先刷新所属 marketplace 再按同条目重装，保留 installedAt，不覆盖用户显式开关（plugins.ts:829-857）；updateStatus: none|update-available|version-changed（version/sha 双轴比对 comparePluginUpdate）。
- 冲突：同 id 去重 warning；同名多 marketplace → "ambiguous, use <plugin>@<marketplace>"（真值 L2n @14765600 窗口；我方 plugins.ts:1166）；workspace 声明同 id 异 source → fail-closed 诊断（官方 id 保留：`plugin_marketplace_declaration_reserved`，双端在册）。
- 版本升级与 seed：`packageStatus:"missing"`、seed hash/版本 marker 判定 isSeedCurrent、降级回退、备份 `.backup-<pid>-<ts>`、legacy `.backup` 清理：双端一致。
- 事件顺序图（卸载内置插件，双端同构）：
  ```
  UI/CLI → wire(uninstall) → [storage lock] → installed record? ──是→ uninstallMarketplacePlugin(删 cache+data) → 清 user config(enabled/options/suppression)
                                            └─否→ runtime source==="official"? ──是→ suppressedBuiltins += id → 清 config → 删 data（cache 保留）→ 投影返回
  ```

## §6 差集三分类

| # | 分类 | 级别 | 差异 | 真值证据 | 我方证据 |
|---|------|------|------|----------|----------|
| G1 | REAL-GAP | P2 | wire 缺「本地插件目录路径校验」方法：真值 CLI 依赖映射含 `validatePluginPath→"validateZCodePluginPath"` 可远程调用（入参 path）；我方 `plugins/validate` 仅 pluginName/marketplace/source，path 校验只在 CLI 进程内（bootstrap `validateDroraPluginPath`），远程/桌面无法经协议校验本地插件目录 | offset ≈14766000（erc 表） | packages/shared/src/drora-protocol/index.ts:3273；bootstrap/src/drora-protocol/plugins.ts:461 |
| G2 | REAL-GAP | P3 | drora-guide 内置定义版本 0.2.0，真值 zcode-guide 已 0.3.0：seed 缓存版本目录与上游资产存在漂移风险（是否有新增 skill/docs 未随迁待查 → OQ4） | offset ≈13822100（u9 zcode-guide version "0.3.0"） | bootstrap/src/app/official-plugin-definitions.ts:324 |
| S1 | SHAPE-DIFF | P3 | wire 命名风格：真值 camelCase `listZCodePlugins` 等 16 法；我方 `plugins/list` 等 16+ 法。语义同构，纯命名迁移 | offset 14766000 | shared/drora-protocol/index.ts:3617-3646 |
| S2 | SHAPE-DIFF | P3 | 身份 brand：marketplace id `zcode-plugins-official` vs `drora-plugins-official`；宿主命令 `__zcode-plugin-host` vs `__drora-plugin-host`；env `ZCODE_PLUGIN_ID` vs `DRORA_PLUGIN_ID`；manifest 目录名 `.zcode-plugin/` 双端一致保留（兼容） | offset 13928、13436 | contracts/src/plugins/index.ts:14；shared/src/mcp.ts:10,16 |
| S3 | SHAPE-DIFF | P3 | 官方 MCP 鉴权 type：`zcode_official` vs `drora_official`（provider jwt_token 一致，均拒绝别名） | offset 4139400 | adapters/src/plugins/mcp-official-auth.ts:24 |
| S4 | SHAPE-DIFF | P3 | SEA 资产前缀 `zcode-official-plugins/` vs `drora-official-plugins/`（manifest 键结构一致） | offset ≈13833600（L7o/r$a） | bootstrap/src/app/bundled-plugins.ts:34-35 |
| S5 | SHAPE-DIFF | P3 | computer-use `runtimeTopLevelPaths`：真值 ["node_modules"]（复制 native runtime）；我方 []（CUA 占位包，注释说明有意） | offset ≈13823000 | official-plugin-definitions.ts:347 |
| S6 | SHAPE-DIFF | P3 | reference catalog：真值单方法 + category flag 参数（LRn 第三参）；我方拆成 `plugins/referenceCatalog` 与 `plugins/referenceCatalogWithCategory` 两方法 | offset ≈14537400 | shared/drora-protocol/index.ts:3618-3619 |
| E1 | EXTRA | P3 | `process/childProcesses`：CLI 回报 MCP 子进程 pid 与插件归属，Host 侧采样（真值走 mcpTelemetry/mcpResourceSamples 通知在 CLI 侧采样）；我方同时保留 mcpTelemetry 通知 | offset 736155（BR 枚举无此方法） | shared/drora-protocol/index.ts:3659；bootstrap/src/drora-protocol/process-child-processes.ts |
| E2 | EXTRA | P3 | `packages/superpowers-plugin`、`packages/bundled-skills`（真值 bundled-skills 是纯资产目录，无对应插件包注册表项） | packages/ 目录清单 | apps/drora-cli/packages/superpowers-plugin |
| E3 | EXTRA | P3 | CUA 凭据「身份模式」（capture 组无 token，broker 按对端代码签名裁决）：真值仍校验凭据组完整 + plugin id 严格等于 computer-use@官方市场 | offset ≈15000（KMi） | cli/src/plugin-host-command.ts:83-106（中文注释说明演进） |

计数：REAL-GAP 2（P2×1，P3×1）｜SHAPE-DIFF 6（均 P3）｜EXTRA 3（均 P3）。

## §7 OPEN-QUESTION

1. OQ1：真值 `enrichCachedClaudeMarketplaceIconsForOverview`（缓存 Claude marketplace 图标 enrichment，offset ≈13835900）在我方未见同名实现；可能已并入「内置 + CDN 分片合并为 canonical manifest」路径（bootstrap/src/plugins.ts:293-298 注释），等价性未逐字段验证。
2. OQ2：真值 `${ZCODE_BASE_URL}` 占位（image-search .mcp.json）经 endpoint 层（ZCODE_BASE_URL/ZCODE_ENDPOINT_ORIGIN/ZCODE_PRODUCTION_BASE_URL，offset ≈708495）解析；我方 `${DRORA_*}` 走 env 分支（mcp.ts:426-433），行为等价但解析链路未逐层对拍。
3. OQ3：真值 `buildMcpStdioEnv` 中段变换 `wme(LQ(...))`（offset 4718765）未解码，疑似 env overlay/网络策略；我方 filterStringEnv 直通，两端「PATH 前插 node 目录」一致，中段待验。
4. OQ4：drora-guide 0.2.0 vs zcode-guide 0.3.0 内容差异（与 G2 关联）：上游新增的 skill/docs/commands 是否需要随迁。
5. OQ5：真值 desktop 端 `plugin-management`/`plugin-sync` 特性键（offset 910211）与我方 shared/src/channels.ts 的同名键的字段级一致性未展开（部分归 UI 商店域 F2）。
