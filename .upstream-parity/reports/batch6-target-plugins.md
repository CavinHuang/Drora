# Batch 6：官方 ZCode 插件（plugin）系统还原调研

- 样本 bundle：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 字节，esbuild 单文件）。
- 方法：`r(minified,"retainedName")` 保留名反查定义 + 上下文摘录；插件包样本取自 `apps/drora-cli/packages/`（16 个含 `.zcode-plugin/plugin.json` 的包）。
- 结论先行：官方插件系统为** marketplace + 缓存安装 + 声明式贡献物（skills/commands/agents/hooks/mcpServers）+ 独立数据目录 + `plugin:<plugin>:<server>` 命名空间**；UI 扩展仅有一个窄口（MCP resource 型 uiSurfaces），无任意 widget 注入。

---

## 1. manifest schema（plugin.json）

### 1.1 清单定位与解析

- 标记目录（按优先级）：`.zcode-plugin/plugin.json` → `.claude-plugin/plugin.json` → `.codex-plugin/plugin.json`（skill 适配层还认 `.cursor-plugin/plugin.json`）。
  - `iKs=[".zcode-plugin/plugin.json",".claude-plugin/plugin.json",".codex-plugin/plugin.json",".cursor-plugin/plugin.json"]`（NodeSkillAdapter 侧，@4218846）
  - `Kdt(e){for(let t of[ZZs,YZs,XZs]){...}}`，其中 `ZZs=join(".zcode-plugin","plugin.json")` 等（@4333360 常量区）
- 解析：必须是 JSON object；`name` 必须匹配 `/^[a-z0-9][a-z0-9._-]{0,127}$/`（`tYs/a0n/zea` 同一正则三处）；`version` 缺省 `"0.0.0"`（`FLe/jea`）。
  - `readPluginManifestFromRoot`：`if(!a0n.test(i))throw new Error("Invalid plugin name: ...")`；`version: typeof o.version=="string"?o.version:FLe`（@4324959）
  - 无 zod strict schema——manifest 是松散 JSON object，字段逐处读取；不支持的字段只产出 warning。

### 1.2 字段清单（bundle 实际消费的证据）

| 字段 | 类型/形态 | 证据 |
| --- | --- | --- |
| `name` | string，`^[a-z0-9][a-z0-9._-]{0,127}$` | @4324959 校验 |
| `version` | string，缺省 `"0.0.0"` | @4324959；`EYs` 读版本（@4280073 附近） |
| `description` | string（可加 `description_i18n` 记录） | plugin metadata 复制：`description:e.manifest.description`（@4366600 区段）；marketplace 层 `description_i18n` 见 `_0n` 删除列表 |
| `author` | string 或 `{name,url?}`（打包 seed 用 `cj={name:"Z.ai",url:"https://z.ai"}`） | @14024xxx seed 清单 |
| `skills` | string 或 string[]：技能根目录相对路径；缺省补 `<root>/skills` | `vso("skills",...)`：`Sgn(t.loaded.manifest.skills)`，`Kv(join(rootPath,"skills"))&&i.unshift("skills")`（@4376xxx）；`skills:"skills"` 见样本清单 |
| `commands` | ①string/string[]：markdown 命令目录（缺省补 `<root>/commands`）；②object：`{命令名:{source?|content?,description?,argumentHint?,model?,...}}`，物化为 generated-commands | `vso("commands",...)` + `ota/materializeCommandMetadataRoot`（@4376xxx），名字校验 `/^[a-z0-9][a-z0-9_:-]{0,63}$/`（`ita`） |
| `agents` | string/string[]（`agents/*.md` 目录）或 object `{名:{description}}` | `wdt/enumeratePluginComponents`：`Qno(root,manifest.agents,"agents")` 扫 `.md` 文件（@4366xxx） |
| `hooks` | object（`{事件名:matcher...}`）、string（路径）或数组；默认文件 `<root>/hooks/hooks.json` | `Tgn/listPluginHookSources`：`YKs=join("hooks","hooks.json")`；manifest.hooks 支持 object/path/array（@4325xxx） |
| `mcpServers` | ①object：`{serverName:{type:"stdio"|"http"|"sse", command,args,cwd,env,url,headers,oauth,auth,enabled,timeoutMs}}`；②string：`.mcp.json` 相对路径；③数组：以上混合；也接受 `{mcpServers:{...}}` 包裹（兼容 `.mcp.json` 全文） | `Voe/loadPluginMcpServerDefinitions`、`Uno`、`$no`、`VKs`（@4327xxx–4238xxx）；`BKs=new Set(["stdio","http","sse"])` |
| `userConfig` | `{key:{type,default,description,sensitive?,required?}}`；`${user_config.key}` 变量展开；`required:true` 且无 default → warning `plugin_variable_missing` | `woo`：`for(let[t,n] of Object.entries(e.manifest.userConfig??{})) n.required===!0&&n.default===void 0&&...`（@4327xxx）；`WKs` 读默认值 |
| `ui.surfaces`（经 `uiSurfaces` 输出） | `[{id≤128, title(串或 i18n record), icon?, server, resourceUri≤2048, availability:"session"}]` | `dgr=m.object({pluginId:yn,pluginName:yn,id:yn.max(128),title:...icon:...,server:yn,resourceUri:yn.max(2048),availability:m.literal("session")}).strict()`（@842451 区段）；metadata `...c.length>0?{uiSurfaces:c}:{}` |
| `license`/`metadata` | skill frontmatter 允许键集合同款：`nKs=new Set(["name","description","when_to_use","license","metadata"])`（@4218817，skill 侧；manifest 侧 license 仅随清单透传） | — |
| 明确**不支持（诊断级 warning）** | `channels`、`lspServers`、`outputStyles`、`settings` | `nYs=["channels","lspServers","outputStyles","settings"]`；`woo`：`plugin_unsupported_component` "diagnostic-only in this ZCode runtime"（@4327xxx） |
| MCPB/DXT | `mcpServers` 值以 `.mcpb`/`.dxt` 结尾 → warning "MCPB/DXT plugin bundles are recognized but not supported"（`koo`） | @4327xxx |

### 1.3 validate 实现

- CLI：`plugins validate <path>`（`runPluginsValidateCommand/avc`，@4334xxx 使用帮助区）——"Validate a plugin or marketplace manifest"；经 host 服务调用 `validatePluginPath`，返回诊断列表，`--json` 输出 JSON，退出码 0/1。
- 诊断码（`b0n/validatePluginRoot` + `woo` + `AYs`）：
  - `plugin_manifest_invalid` / `plugin_manifest_not_found` / `plugin_root_not_found`
  - `plugin_unsupported_component`（channels/lspServers/outputStyles/settings）
  - `plugin_variable_missing`（required userConfig 无 default；或 `${user_config.x}` 缺失）
  - `plugin_marketplace_source_unsupported`（npm/pip 来源、非 git/zip 的 url、MCPB/DXT）
  - `plugin_component_path_invalid`（路径逃逸 plugin root，`vT` 越界检查）、`plugin_skill_root_empty`、`plugin_hook_invalid`/`plugin_hook_unsupported_event`、`plugin_mcp_read_failed`/`plugin_mcp_invalid`/`plugin_mcp_server_disabled`、`plugin_marketplace_invalid`
- 安装期再校验：`mYs` — manifest 存在且 `manifest.name === marketplace entry.name`，否则 `Plugin manifest name '...' does not match marketplace entry '...'`（@4314727）。

---

## 2. 发现与安装布局

### 2.1 存储根

- `resolvePluginStorageRoot = K0(config.storage.dir)`；默认配置 `storage:{dir:"~/.zcode", sessionDbPath:"~/.zcode/cli/db/db.sqlite"}`（@1364311）。可用 `ZCODE_STORAGE_DIR` 覆盖（clipboard 路径处同源逻辑，@4334xxx）。
- CLI 用户配置文件：`~/.zcode/cli/config.json`（`jto="config.json", Bto="~/.zcode/cli"`，@4184477）；workspace 级 `<ws>/.zcode/config.json`（`resolvePluginConfigPath`，scope==="workspace"）。
- 配置 JSON 里插件相关默认值（@1364311）：
  ```js
  plugins:{dirs:[],enabled:!0,enabledPlugins:{},extraKnownMarketplaces:{},options:{},suppressedBuiltins:[]}
  ```

### 2.2 目录布局（全部为相对 `~/.zcode` 的常量拼接）

| 内容 | 路径 | 证据 |
| --- | --- | --- |
| 安装缓存 | `<root>/cache/<marketplace>/<name>/<version>/` | `getPluginCacheDir(e,t,n,o)=join(e,"cache",M$(t),M$(n),M$(o))`（@4331613）；`M$` 为 id 段清洗 |
| 插件数据目录 | `<root>/data/<pluginId>/`（内含 `generated-commands/`） | `getPluginDataDir(e,t)=join(e,"data",M$(t))`；`AYs` 里 `dataPath:join(storageRoot,"data",M$(pluginId))` |
| 已安装清单 | `<root>/installed_plugins.json` | `i0n="installed_plugins.json"`（@4333346）；`Hdt/poo` 读写 |
| 已知市场 | `<root>/known_marketplaces.json` | `LLe="known_marketplaces.json"` |
| 市场清单缓存 | `<root>/marketplaces/<marketplaceId>/marketplace.json` | `z$(e,t)=join(e,"marketplaces",M$(t),Wdt)`，`Wdt="marketplace.json"`（@4308563） |
| 官方缓存 | `<root>/cache/zcode-plugins-official/<name>/<version>/` | `wae=Dp`，`officialPluginCacheRoot(e,t)=join(e,"cache",wae,t.name,t.version)`（@14042120） |
| 官方 seed 标记 | 插件根下 `.zcode-plugin-seed.json` | `_Xo=".zcode-plugin-seed.json"`；`JOn/isSeedCurrent` 比较 `{hash,pluginVersion}` |
| 官方运行时清单 | `zcode-official-plugins/manifest.json` | `gXo="zcode-official-plugins/",Arc=gXo+"manifest.json"` |

### 2.3 发现来源（NodePluginAdapter.resolveCandidates，@4376xxx，按序）

1. `config.plugins.dirs` → `source:"inline"`，marketplace=`"inline"`（`Zrr`），默认启用。
2. `officialPluginRoots`（`resolveOfficialPluginRoots`：storageRoot 内官方缓存 + 额外 roots，按 `suppressedBuiltins` 过滤）→ `source:"official"`，marketplace=`"zcode-plugins-official"`（`Dp`），默认禁用；但 `officialPluginsEnabledByDefault`（`s1t`）里的 `name@zcode-plugins-official` 默认启用。
3. `scanOfficialCache`（扫描 `<root>/cache/zcode-plugins-official/`）→ `source:"official"`。
4. `installed_plugins.json` 记录 → `source:"cache"`，rootPath=`installPath || cache/...`。

记录形状（`LYs/isInstalledPluginRecord`）：`{id,name,marketplace,version,installPath,installedAt,scope:"user"|"workspace"}`；id 格式 `<name>@<marketplace>`（`Xdt/parsePluginId`）。

### 2.4 安装/更新流程（`installMarketplacePlugin/lYs`，@4297xxx）

```
marketplace 清单缓存(marketplaces/<id>/marketplace.json)
  → resolvePluginSourceRoot(Jdt)：filesystem|sea(打包) / 相对路径 / {source:"git"|"github"|"directory"|"url"...}
      git/github: git clone --depth 1 [--branch ref] → tmp；sha 则 checkout（dYs）
  → 校验 manifest 名称匹配 entry（mYs）；版本取 manifest.version ?? entry.version ?? "0.0.0"
  → 目标 cache/<marketplace>/<name>/<version>/（相同则原地）
  → 事务移动（Fdt，authority=<root>/installed_plugins.json，prepare 写 .claude-plugin/plugin.json）
  → upsert installed_plugins.json 记录 {id,name@marketplace,version,installPath,installedAt,updatedAt,scope,dependencies?,cacheTransactionId?}
```

- 事务与锁：`withPluginStorageLock(AN)`（按 storageRoot 的 promise 链互斥）；cache 事务 `finalize()/rollback()`；官方 seed 有 `<path>.seed-lock` mkdir 锁（`cXo`，`owner.json`）。
- 缺 manifest 且 `entry.strict!==false` 时：把 marketplace entry 原始字段去掉展示字段后写成 `<target>/.claude-plugin/plugin.json`（`noo`+`_0n`，@4314727）——即 marketplace entry 是 plugin.json 的超集。

### 2.5 enable/disable 状态

- 存储：配置 JSON 的 `plugins.enabledPlugins`（键为 `<name>@<marketplace>`，值为 bool）。user scope → `~/.zcode/cli/config.json`；workspace scope → `<ws>/.zcode/config.json`。
- 读取优先级：`hta(e,t,n)=e.enabledPlugins[t]??n`（n=defaultEnabled 或官方默认启用集）。
- 写入函数：`updatePluginEnabledInFileConfig(Khn)`、`enablePluginsByDefaultInFileConfig(Zhn)`（缺省置 true）、`removePluginEnabledFromFileConfig`、`removePluginFromFileConfig`（卸载清理）、`updatePluginOptionsInFileConfig`；写入为临时文件+rename 原子替换，mode 0600（`mJ`）。

---

## 3. marketplace

### 3.1 默认市场（`ensureDefaultPluginMarketplaces/q$`，@4296419）

`CJt`（@514260）：
```js
[{id:"zcode-plugins-official", source:"https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
  description:"Official ZCode plugins marketplace: built-in and community plugins for ZCode."},
 {id:"claude-plugins-official", source:"anthropics/claude-plugins-official", ...}]
```
首个加载后把缺失的默认项补进 `known_marketplaces.json`（记录 `{id,source,name,description?,addedAt,lastUpdated,pluginCount}`）。官方 id 保留：`Cannot add a marketplace named "...": that id is reserved for the official marketplace`（`dte/isOfficialMarketplaceId`）。官方 zip 资产前缀 `https://cdn-zcode.z.ai/zcode/official-plugin/assets/`（`s0n/coo`），zip 上限 10MB、sha256 64 hex 校验（`HZs=10*1024*1024, loo=/^[a-f0-9]{64}$/u`）。

### 3.2 marketplace.json 清单格式（`Soo` 归一化 + `boo` 校验，@4331xxx）

```jsonc
{
  "name": "my-marketplace",          // 必填，同 plugin name 正则
  "description": "...",
  "plugins": [                        // 数组或 {名:entry} 映射
    {
      "name": "plugin-a",             // 必填
      "source": "...",                // 必填：相对路径串 或 {source:"git"|"github"|"directory"|"url","url"/"repo"/"path","ref"/"sha","type":"git"|"zip","sha256"?...}
      "version":"1.0.0","category":"...","description":"...",
      "cachePath":"...", "strict":true,
      "dependencies":["other@marketplace"],
      "tags":["..."],
      "listing":{ displayName,displayNameI18n,descriptionI18n,icon,category,author,authorUrl,
                  homepage,privacyPolicy,termsOfService,heroImage,examplePrompts,
                  examplePromptsI18n,requiresPaidPlan }   // ftt，strict schema
    }
  ],
  "allowCrossMarketplaceDependenciesOn":["other-marketplace"],
  "metadata":{"description":"...","pluginRoot":"..."},
  "featured":["plugin-a"]
}
```
- 来源解析（`Vdt/parseMarketplaceSourceInput`）：`http(s)://….git|/_git/` → git；github.com URL → git；`owner/repo` 简写 → github；本地 `.json` → file；本地目录 → directory；其余 http(s) → url。`#ref` 后缀取 ref。
- 依赖闭包：`foo/resolveDependencyClosure`，跨市场依赖默认禁止（`Cross-marketplace dependency is blocked`），可用 `allowCrossMarketplaceDependenciesOn` 放行。
- 目录内发现市场清单：`.claude-plugin/marketplace.json`（`KZs`）。

### 3.3 命令实现（CLI usage 原文，@4334xxx）

```
plugins list [--json] [--available] | install <plugin>[@marketplace] [-s <scope>]
uninstall <plugin> [-s <scope>] [--keep-data] [--force] | enable <plugin> | disable [plugin] [-a|--all]
update <plugin> | validate <path>
marketplace add <source> [--scope <scope>] [--sparse <path>] | marketplace list [--json]
marketplace remove <name> | marketplace update [name]
Scopes: user (default), project. `zcode plugin` is an alias of `zcode plugins`.
```
RPC 面一一对称：`addPluginMarketplace(qci)/removePluginMarketplace(Wci)/updatePluginMarketplace(Vci)/installPlugin(Hci)/uninstallPlugin(Gci)/updatePlugin(Jci)/restoreBuiltinPlugin(Kci)/configurePlugin`，均经 `resolvePluginStorageRoot` + `withPluginStorageLock`。官方恢复：`restoreBuiltinPlugin`（`suppressedBuiltins` 恢复内置）。

---

## 4. 贡献物物化与命名空间

### 4.1 组件枚举（`wdt/enumeratePluginComponents`，@4366xxx）

`components = [{kind:"agent"|"command"|"skill"|"hook"|"mcp", items:[{name,description?}]}]`；plugin metadata 还带 `skillCount/skillRootCount/commandRootCount/mcpServerNames/declaredMcpServerNames/hookDetails`。

### 4.2 commands → generated-commands

- 目录式：`<root>/commands/*.md`（或 manifest.commands 路径数组）作为 commandRoot，条目 `{path,priority,scope:"official"?"system":"user",source:"plugin"}`。
- 声明式：`manifest.commands` 对象逐条物化为 `<dataPath>/generated-commands/<name>.md`（`ota/materializeCommandMetadataRoot`）：`source`（文件相对路径）与 `content`（内联文本）二选一；元数据转 frontmatter——`description`→`description:`、`argumentHint`→`argument-hint:`、`model`→…（`ata/applyCommandMetadataFrontmatter`）。命令名归一：去前导 `/`、小写，`/^[a-z0-9][a-z0-9_:-]{0,63}$/`。

### 4.3 skills

- 根条目 `{path, pluginId, priority, scope:"system"|"user", source:"plugin"}`；`<root>/skills` 缺省根。
- 命名空间（NodeSkillAdapter，@4218xxx）：插件技能追加别名 `qualifiedName:"<pluginName>:<skillName>"`（`resolvePluginSkillAlias`），保留原名+插件名双注册；frontmatter 必须有 `name`、`description`（≤1024 字符），支持 `when_to_use/license/metadata`。
- `safeToAutoLoad`：frontmatter 键全部属于允许集时 true；`policy:{allowImplicitInvocation:!0}`。

### 4.4 agents

- 位置 `<root>/agents/<name>.md`；命名：`namespacePluginAgentProfile` → `name:"<pluginName>:<bareName>"`；裸名唯一且不与保留冲突时同时注册裸名，冲突报 `agent_ambiguous_name`（"use plugin:name"）（@1482xxxx 区段 `kNn`）。
- 模型覆盖键 `DJt(pluginId,bareName)`；状态存 `<root>/v2/agents-state.json`（`pluginAgentModelSelectionOverrides/disabledAgentIds`）。

### 4.5 mcpServers

- 定义合并：`<root>/.mcp.json` + `manifest.mcpServers`（`Voe`）；key 命名空间：**`plugin:<manifest.name>:<serverName>`**（`$Ks`）——实际用例常量 `v3="plugin:computer-use:computer-use"`（@18739）。
- stdio 服务 env 注入（`VKs`）：`{CLAUDE_PROJECT_DIR,ZCODE_PROJECT_DIR=workingDirectory, CLAUDE_PLUGIN_DATA/ZCODE_PLUGIN_DATA=dataPath, CLAUDE_PLUGIN_ROOT/ZCODE_PLUGIN_ROOT=rootPath, ...server.env}`，再加 **`ZCODE_PLUGIN_ID=<id>`**；`kind:"builtin"|"plugin"`（官方市场为 builtin）。传输仅 stdio/http/sse；`auth` 仅 http/stdio，且不能与 `oauth` 并用；静态 headers 不得含保留头。
- 变量展开（`Rve` hook 版 / `QC` MCP 版 / `Fno` env 版）：`${CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|ZCODE_PLUGIN_ROOT|ZCODE_PLUGIN_DATA|CLAUDE_PROJECT_DIR|ZCODE_PROJECT_DIR|CLAUDE_SESSION_ID|ZCODE_SESSION_ID|CLAUDE_CODE_SESSION_ID|CLAUDE_SKILL_DIR|ZCODE_SKILL_DIR|user_config.<key>}`；SKILL_DIR 需 skill 上下文否则 ConfigurationError；`user_config.*` 缺失且 required → `plugin_variable_missing`。

### 4.6 hooks

- 源：默认 `<root>/hooks/hooks.json` + `manifest.hooks`（object/路径/数组，去重）；事件白名单 `Tl={SessionStart,UserPromptSubmit,PreToolUse,PermissionRequest,PostToolUse,PostToolUseFailure,Stop}`，未知事件 → `plugin_hook_unsupported_event`。
- 插件 hook 上下文 `createHookPluginContext/attachPluginToHook`：携带 pluginId/dataPath，变量展开同 4.5；禁用插件时 hooks 不解析（`canRunPluginHooks` + `mta/emptyComponents` 只保留 hookDetails）。

### 4.7 官方插件 host（与 node-repl-host 的关系）

- 官方打包插件的 MCP server 全部改写为经共享宿主运行（desktop main，@14032xxx）：
  - `officialPluginHostPrefixArgs(oXo)`：SEA 下 `[ "__zcode-plugin-host" ]`；否则 `[...process.execArgv, resolve(process.argv[1]), "__zcode-plugin-host"]`（`dfe="__zcode-plugin-host"`，@16436）。
  - `writeOfficialPluginRuntimeManifest(HOn)`：改写 `<root>/.zcode-plugin/plugin.json` 的每个 mcpServer 为 `{command:process.execPath, args:[...prefix, join(root,"dist","mcp","server.js")], env:{...,ELECTRON_RUN_AS_NODE:"1", ZCODE_PLUGIN_ID:"<name>@zcode-plugins-official"}}`。
  - CLI 侧 `runPluginHostCommand(rZe)`：`zcode.cjs __zcode-plugin-host <server-path> [-- args...]` → `import(server)` 并调用其 `main()`；`isPluginHostInvocation` 判定 argv[0]===`__zcode-plugin-host`。
  - CUA 凭据护栏 `assertCapturedBrokerLaunchIsAuthorized(L7i)`：捕获的 broker socket 仅允许在 `ZCODE_PLUGIN_ID==="computer-use@zcode-plugins-official"` 且 `ZCODE_CUA_NODE_REPL_HOST==="1"` 时启动共享 `node_repl` 宿主（env 常量 `ZCODE_CUA_PERMISSION_BROKER_SOCKET/ZCODE_CUA_NODE_REPL_HOST/ZCODE_CUA_DEV_MODE`，@11782–11822）。
- **node-repl-host 结论：是官方内置 JS 运行宿主**。seed 清单 `{name:"node-repl-host", version:"0.6.1", defaultEnabled:true, requiredSeedPaths:["dist/mcp/server.js"]}`（@14026267）；`computer-use` seed 声明 `hostMcpServerNames:["node_repl"]`（@14025xxx）——computer-use/browser-use 的部分工具由共享 `node_repl` host MCP 服务承载，各插件只贡献自己的 skills/docs/runtime 资产。与仓库内 `apps/drora-cli/packages/node-repl-host`（自述 "Shared node_repl runtime host ... Browser Use and Computer Use enable it"）一致。
- 官方 seed（desktop，`Drc/seedBundledOfficialPlugins`）：从 SEA 模块或入口旁 `packages/<plugin>` 目录收集文件（顶层白名单 Rrc=`.mcp-skill-styles/package.json/scripts/skills/templates…`+`runtimeTopLevelPaths`），sha256 整包 hash + 版本写入 `.zcode-plugin-seed.json`，复制到 `<root>/cache/zcode-plugins-official/<name>/<version>`；hook 权限 493（可执行）仅 `dist/mcp/server.js` 与 `hooks/` 非文档文件（`QOn/modeForSeedFile`）。seed 清单 `oq`（17 项）：documents(pdf/docx/pptx/spreadsheets 0.1.8，含 `agents/visual-judge.md`)、image-search 0.1.1（requiredSeedPaths `.mcp.json`）、ios-simulator 0.1.0、restore-legacy-sessions 0.1.0、plugin-creator 0.1.1、skill-creator 0.1.0、zcode-guide 0.3.0、computer-use、browser-use、zcode-cua 0.6.4、android-emulator、visualize 0.1.0、node-repl-host 0.6.1、superpowers 等；默认启用集 `s1t` 与 UI store 内置串一致（@514003）。

### 4.8 环境变量双写键汇总（批次 4 的 7 键 + 补充）

`Rve/SSn/VKs` 三处一致：
- CLAUDE/ZCODE 双写：`CLAUDE_PROJECT_DIR`/`ZCODE_PROJECT_DIR`、`CLAUDE_SESSION_ID`/`ZCODE_SESSION_ID`、`CLAUDE_PLUGIN_ROOT`/`ZCODE_PLUGIN_ROOT`、`CLAUDE_PLUGIN_DATA`/`ZCODE_PLUGIN_DATA`、`CLAUDE_SKILL_DIR`/`ZCODE_SKILL_DIR`（模板展开）；另有 `CLAUDE_CODE_SESSION_ID`（仅 CLAUDE 形）。
- 仅 ZCODE：`ZCODE_PLUGIN_ID`、`ZCODE_PLUGIN_NAME`（`SSn` set 里无 CLAUDE_PLUGIN_ID/NAME）。

---

## 5. 插件包样本对照

### 5.1 zcode-guide-plugin（本仓 `apps/drora-cli/packages/drora-guide-plugin/`）

```json
{"name":"drora-guide","version":"0.3.0","description":"...","author":{"name":"Z.ai"},"license":"MIT","skills":"skills"}
```
- 与官方 seed 清单 zcode-guide@0.3.0 对齐（仅品牌改名 drora/zcode，见 specs/drora-rename）。字段验证了 `name/version/description/author/license/skills`；无 MCP、无 commands/agents/hooks——纯技能包，走 `<root>/skills` 缺省根（这里显式 `"skills":"skills"`）。

### 5.2 browser-use-plugin

- `plugin.json`：`name:"browser-use", version:"0.5.1", skills:"skills"`；目录含 `docs/`、`skills/control-browser|web-gui-tester`——与官方 seed `_rc=["docs/api.json",...,"skills/control-browser/SKILL.md","skills/web-gui-tester/SKILL.md"]` 完全对应。无根级 `.mcp.json`：MCP 服务由宿主（`dist/mcp/server.js` + `__zcode-plugin-host`）承载，与 bundle 的 `hostMcpServerNames` 机制一致。

### 5.3 node-repl-host

- `plugin.json`：`name:"node-repl-host", version:"0.6.1"`，无 skills/commands/mcpServers 声明，自述"Shared node_repl runtime host...not user-facing"。与官方 seed（`requiredSeedPaths:["dist/mcp/server.js"]`、`hostMcpServerNames:["node_repl"]` 消费方为 computer-use）互证：**node-repl-host 就是官方内置 js 工具（node_repl MCP）的共享宿主插件**。

### 5.4 双 MCP 声明与占位符形态（补充 android-emulator / image-search）

- `android-emulator-plugin`：`plugin.json.mcpServers` 用 **`${DRORA_PLUGIN_ROOT}`/`${DRORA_PLUGIN_DATA}`/`${DRORA_PROJECT_DIR}`**（= 官方 `${ZCODE_PLUGIN_ROOT}` 等的改名），`.mcp.json` 用 **`${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_DATA}`**；两者 server 定义逐字段相同。官方 bundle 侧 `Uno` 同时接受 manifest 内嵌与 `.mcp.json` 路径——本仓的"双声明并存"是给两种生态读的同一事实。
- `image-search-plugin`：`plugin.json` 与 `.mcp.json` 均声明 http 型 `image_search`（`${DRORA_BASE_URL}` + `auth:{type:"drora_official"}`），无 `${CLAUDE_PLUGIN_ROOT}`（远程 URL 型无需根路径）。
- `userConfig` 实例：android-emulator 的 `sdk_path/default_avd/api_level/...` 七项，全部有 default，`.mcp.json` env 用 `${user_config.*}` 展开——与 4.5 的展开机制吻合。

---

## 6. UI 扩展结论

- **没有通用 UI 插件机制**：全 bundle 无 `uiPlugin`、`ui_extension`、widget 注入类 API（计数为 0）。
- 唯一 UI 口是 **plugin uiSurfaces**（§1.2）：插件可声明 `{id,title,icon,server,resourceUri,availability:"session"}` 的会话级 UI 面，绑定到自己某个 MCP server 的 resource（`plugin:<plugin>:<server>` 命名空间），宿主经 RPC `listPluginUiSurfaces`（请求 `{workspace}`，响应 `{surfaces:[...]}`）枚举并渲染为 MCP resource 视图。属于"声明式、资源型"扩展，不能注入任意 React 组件或面板。
- TUI 侧仅有管理命令 `/plugins [list|enable <plugin>|disable <plugin>]`（别名 `plugin`，@918710、@15032402），无插件 UI 渲染面。

---

## 7. 对 Drora 的对照要点（供 parity 决策）

1. manifest 校验单位是"逐常量"：name/version 正则、不支持组件警告集 `["channels","lspServers","outputStyles","settings"]`、命令名正则 `[a-z0-9][a-z0-9_:-]{0,63}`、诊断码族——后续 parity check 脚本应把这些字面量纳入 `check-bundle-key-parity` 的键族。
2. 目录契约：`cache/<marketplace>/<name>/<version>`、`data/<id>`（内 generated-commands）、`installed_plugins.json`、`known_marketplaces.json`、`marketplaces/<id>/marketplace.json`、`.zcode-plugin[-seed].json`——均为持久化键前缀级契约。
3. 命名空间契约：插件 id `<name>@<marketplace>`、MCP key `plugin:<plugin>:<server>`、agent/skill 别名 `<plugin>:<name>`、env 键 `ZCODE_PLUGIN_ID/NAME/ROOT/DATA`（本仓对应 DRORA_*，需在 rename spec 中登记豁免映射）。
4. 双 MCP 声明（plugin.json 内嵌 + .mcp.json）为官方可解析形态，非本仓发明；`${CLAUDE_*}` 占位符在官方 `${ZCODE_*}` 同一展开器中并存。
