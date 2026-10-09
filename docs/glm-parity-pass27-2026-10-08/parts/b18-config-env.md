# b18 配置面对拍：环境变量全集 / settings 层级 / 持久化 schema

- 真值：`D:\software\zcode\resources\glm\zcode.cjs`（0.16.9）
- 我方：`D:\workspace\projects\Drora`（feat/migrate-remote-and-pet，基线新鲜）
- 方法：bundle 内引号串/标识符双口径 grep + node 定点上下文验证；我方逐文件读取消费点。只读对拍。

## §1 env 全集差

### 真值 env 面（重测结果）
- `parseEnvConfig`（前缀拼接）：`ZCODE_` + STORAGE_DIR / SESSION_DB_PATH / SESSION_DB / HTTP_PROXY / NO_PROXY / AGENT_CA_CERT / HTTP_TIMEOUT / TIMEOUT / LOG_FORMAT / MAX_TOOL_CONCURRENCY（真值函数 `aun`，`Pjs="ZCODE_"`）。
- 直读 env（引号串/`e.env.X`）：引号级 ZCODE_* 共 66 个，其中可判定为 env 键的约 40 个（BASE_URL、ENDPOINT_ORIGIN、PRODUCTION_BASE_URL、TEST_BASE_URL、DATA_BASE_DIR、LOG_DIR、LOG_CONSOLE、RUNTIME_ENV、BETA、ENV、DEBUG、HOME、SESSION_ID、PROJECT_DIR、SKILL_DIR、PLUGIN_*、TELEMETRY_*、CUA_*、E2E_*、MODEL_RETRY_*、REMOTE_* 等）；其余为错误码/鉴权类型字面量/常量名。
- CLAUDE_* 兼容层 8 个：CLAUDE_CODE_SESSION_ID、CLAUDE_CODE_TMPDIR、CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID、CLAUDE_PLUGIN_DATA、CLAUDE_PLUGIN_ROOT、CLAUDE_PROJECT_DIR、CLAUDE_SESSION_ID、CLAUDE_SKILL_DIR。
- 其他前缀：ANTHROPIC_API_KEY、ANTHROPIC_BASE_URL（anthropic SDK 鉴权/baseURL env）、OPENAI_API_KEY、OPENAI_BASE_URL、AI_GATEWAY_API_KEY（随 bundled ai-sdk）、BIGMODEL_API_BASE_URL + PROD/TEST 变体、ZAI_OAUTH_* + PROD/TEST 变体（OAUTH_CLIENT_ID/OAUTH_APP_ID/OAUTH_ORIGIN/BUSINESS_BASE_URL）、GLM_BINARY_PATH（原生 glm agent 启动器 `binaryEnvVar`）、HTTP(S)_PROXY/http(s)_proxy/NO_PROXY/all_proxy（网络层）、DOTENV_KEY + DOTENV_CONFIG_DEBUG/QUIET（内嵌 dotenvx）。

### REAL-GAP（真值有、我方无）
| # | 变量 | 真值消费点（证据偏移：bundle 定位） | 我方现状 | 级别 |
|---|------|------|------|------|
| G1 | ZCODE_PRODUCTION_BASE_URL / ZCODE_TEST_BASE_URL | endpoint origin 选择链 `p1()`：按 ZCODE_ENV=test 取 TEST 否则 PROD，fallback ZCODE_BASE_URL ?? ZCODE_ENDPOINT_ORIGIN | 我方 `packages/shared/src/droraEndpoint.ts:148` 只读 DRORA_BASE_URL/DRORA_ENDPOINT_ORIGIN 单链；CLI OAuth `apps/drora-cli/packages/adapters/src/auth/cli-oauth.ts:4` 硬编码缺省 origin，无 PROD/TEST 变体 | P2 |
| G2 | BIGMODEL_PRODUCTION_API_BASE_URL / BIGMODEL_TEST_API_BASE_URL | 按 ZCODE_ENV 分流 | 我方仅 BIGMODEL_API_BASE_URL（droraEndpoint.ts `resolveBigModelApiOrigin`） | P3 |
| G3 | ZAI_PRODUCTION_OAUTH_* / ZAI_TEST_OAUTH_* / *_BUSINESS_BASE_URL PROD/TEST 共 6 个 | OAuth/业务端点按 env 分流 | 我方仅单值（droraEndpoint.ts:5-7） | P3 |
| G4 | ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL | 真值把 env 键喂给 anthropic SDK（`environmentVariableName:"ANTHROPIC_API_KEY"`、`g0e(V3({settingValue,environmentVariableName:"ANTHROPIC_BASE_URL"}))`，缺省 `https://api.anthropic.com/v1`） | 我方 `bash-readonly-policy-argv-io.ts:4` 仅把它列进安全赋值白名单；provider apiKey 只从配置文件取（`model-execution.ts:320 resolveApiKey`），无 env 名间接引用 | P2 |
| G5 | ZCODE_DEBUG（process.env 直读，模块级 DEBUG 开关） | 真值模块初始化 `trr=process.env.ZCODE_DEBUG` 导出 RUNTIME_ZCODE_DEBUG | 全仓无 DRORA_DEBUG 消费点 | P3 |
| G6 | GLM_BINARY_PATH + ZCODE_AGENT_WORKDIR | 原生 glm agent 启动器表：`binaryKind:"native-binary"`、`spawnArgs:["app-server","--stdio"]`、`nativeConfigDir:".zcode/cli"`、缺 binary 报错文案引用两变量 | 我方无原生 agent 启动器（desktop 直跑 resources/glm/drora.cjs，见 bundled-plugins.ts:633 注释），运行时工具只有 bfs/ugrep/rg（sea-runtime-tools.ts:74） | P3（疑架构性取代，见 OQ1） |
| G7 | CLAUDE_CODE_TMPDIR | 真值仅出现在磁盘满错误提示文案中（1 处 hit） | 我方 `adapters/src/exec/bash-file-output.ts:190` 有同类文案但无该变量名 | P3 |
| G8 | CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID | 真值独立常量（与 ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID 并存） | 我方仅 DRORA_OFFICIAL_PLUGIN_MARKETPLACE（bootstrap/plugins.ts:51），无 CLAUDE_ 别名常量 | P3 |
| G9 | OPENAI_API_KEY / OPENAI_BASE_URL / AI_GATEWAY_API_KEY | bundled ai-sdk 的 provider 缺省 env | 我方未单独消费；是否随我方 ai-sdk 依赖自动生效未验证 | P3 / OQ4 |

### EXTRA（我方有、真值无）
- env 键级：无（引号级差集为空，63/66 引号串按 ZCODE_→DRORA_ 改名一一对应）。
- 标识符级（内部常量，非 env）：DRORA_DEBUG_NETWORK_CAPTURE/HOST/PORT/CA_DIR/MAX_ENTRIES、DRORA_ATTACHMENT_FAULT_CODES、DRORA_DWF_CHILD_COMMAND、DRORA_MANIFEST_PATH、DRORA_API_KEY_NAME、DRORA_LOGO_LINES、DRORA_GUIDE_REQUIRED_SEED_PATHS、DRORA_CUA_HELPER_BUILD_ID、DRORA_CUA_CANONICAL_MODEL_PREFIX、DRORA_CUA_PROVIDER_SPELLING_ALIAS_PREFIX、DRORA_MCP_*_META_KEY、DRORA_OAUTH_BASE_URL、DRORA_INLINE_PLUGIN_MARKETPLACE 等。真值应有对应内部常量但命名不同，无法逐一映射。P3，无行为差异证据。

### 关键确认（非 gap）
- env→settings 映射表（STORAGE_DIR→storage.dir 等 10 条）与真值 `aun` 逐条一致：`apps/drora-cli/packages/adapters/src/config/env-config.adapter.ts:26-59`。
- DRORA_RUNTIME_ENV 的 development 判定与真值 F6s 一致：不读 NODE_ENV，按入口路径 `packages/cli/src` + `.ts` 判定（cli/src/env.ts:120-128）。
- beta 存储根逻辑逐字对齐：DRORA_BETA==="1" || DRORA_ENV==="beta" 或 argv 命中 `drora-beta` → `~/.drora-beta`（cli/src/env.ts:133-141 vs 真值 RMi）。DRORA_HOME（telemetry/bootstrap.ts:129）、DRORA_LOG_DIR、DRORA_LOG_CONSOLE==="1"（logging/index.ts:177）均与真值同形。
- DRORA_OFFICIAL_MCP_AUTH_TYPE 是鉴权类型字面量常量而非 env（adapters/src/mcp/index.ts:1087），与真值 CHt 同性质，不算 env 差。

## §2 settings 键面

- 键注册表：真值 `fs` 39 个路径（modelStream.idleTimeoutMs … ui.theme）与我方 `ConfigKey`（contracts/src/config/index.ts:12-80）**完全一致**，含 SkillOverrides→"skill"、CommandOverrides→"command" 的短键映射。
- 默认值对象：真值 `Lm` 与我方 `DefaultRuntimeConfig`（contracts/src/config/index.ts:290-359）逐字段一致（含 modelStream 600000ms、permission mode "build"、network.timeout 180000、skills.metadataBudget 20000、hooks 32768/60000、ui locale en-US/theme auto），仅路径品牌 ~/.zcode→~/.drora。
- 作用域：真值 Ek 六层 System(0)<User(10)<Project(20)<Session(30)<Env(40)<Cli(50) 与我方 ConfigScopePriority（contracts/src/config/index.ts:168-175）完全一致；合并顺序同为 System→User→Project(root→cwd→explicit)→Env→Cli（config-factory.ts:129-210）。MCP servers 特例（user 遮蔽 project）两侧同构：我方 config-factory.ts:372-398 apply 顺序 system→project→user→env→cli。
- 文件面：user = `~/.zcode/cli/config.json` ↔ `~/.drora/cli/config.json`（file-config.adapter.ts:62）；project 发现 `zcode.json` / `.zcode/config.json` ↔ `drora.json` / `.drora/config.json`（shared/src/workspace-hook-config.ts:176-177）；project hooks pending-trust 诊断码与信任门两侧同构。
- config 级 MCP server schema：真值 `eun`（protocolVersion/enabled/timeoutMs）+ stdio/http/sse strict 对象 + oauth 两形态 union 与我方 schema.ts:46-109 完全一致；真值带 isolation/headers 数组的 schema 是运行时协议面而非配置面，我方 contracts/src/interfaces/mcp.port.ts:13-22 已有 isolation，配置面不收属一致行为，不是 gap。
- SHAPE-DIFF（微）：
  - S1 我方 config 文件 schema 额外允许顶层 `$schema` 且根对象 `.passthrough()`（schema.ts:286-306）；真值配置解析对未知键的处理未逐条验证。P3 / OQ2。
  - S2 我方 modelAnomalyGuard 额外有 `toolCallWarningThreshold` 配置入口（schema.ts:222）——真值协议/运行时同样存在该阈值（`ijs` schema 有 toolCallWarningThreshold），但配置文件 schema 是否暴露未验证。P3 / OQ3。

## §3 持久化 schema

- SQLite：库路径 `~/.zcode/cli/db/db.sqlite` ↔ `~/.drora/cli/db/db.sqlite`（adapters/src/storage/session-store/paths.ts:7）。迁移表 `schema_migration(id, checksum, app_version, time_applied)`、checksum 不可变语义逐字一致（migration-runner.ts:161-193 vs 真值 `Dwr/Owr/Mwr`）。
- 迁移集：真值 0.16.9 共 **22 个**（0001_base_session_store…0022_backfilled_session_reasoning，appVersion 0.2.0→0.16.5）；我方 migrations.ts 22 个 id 与 appVersion **逐一相同**（含 0007 workflow_script_runtime、0019_dwf_journal 0.16.5 等）。表集合 session/message/part/todo/session_entry/permission/input_history/local_setting/session_target(+next)/workflow_definition/workflow_run/workflow_activity/workflow_event/session_task_link/model_usage 一致。
- 会话外状态文件：`v2/credentials.json`、`v2/telemetry-state.json`、`v2/agents-state.json`、`v2/runtime/provider/<platform>/<appVersion>/<origin>/`（真值 `cZe`）↔ 我方 `.drora/v2/...` + `resolveDroraBuiltinCachePaths({environmentConfigRoot: ~/.drora/v2, platform, appVersion, droraEndpointOrigin})`（cli/src/provider-runtime-env.ts:80-86）、builtin 配置 `zcode-builtin.json`↔`drora-builtin.json`、personal 配置 env 直传文件路径，两侧同构。
- 会话工作目录：`.zcode/cli/exec`（命令输出根）、`.zcode/cli/sessions/<id>/workflows` ↔ 我方 `.drora/cli/exec`、`.drora/cli/sessions`（另有 cli/artifacts、cli/image-cache、cli/pdf-cache、cli/video-cache 为我方扩展目录，真值未见对应，EXTRA P3）。
- 项目内：`.zcode/{workflows,workflow-runs,workflow-drafts,agents,agent-memory,agent-memory-local,plans,AGENTS.md}` ↔ `.drora/` 同名全对应（plans: core/src/runtime/helpers/plan-file-continuity.ts:25；AGENTS.md: adapters/src/context/index.ts）。
- 迁移辅助：`migrateSubagentMarkdown` 系列、`windows_git_bash_auto_migration` 两侧均有（我方 core/src/runtime/methods/shell-environment.ts:4）。

## §4 目录品牌差清单

| 真值 | 我方 | 定性 |
|---|---|---|
| ~/.zcode | ~/.drora | 纯改名（storage.dir 默认值、config-factory、logging、paths 全链一致） |
| ~/.zcode-beta | ~/.drora-beta | 纯改名（判定条件逐字一致） |
| ~/.zcode/cli/{config.json,log,db/db.sqlite,exec,workflows,sessions} | ~/.drora/cli/ 同名 | 纯改名；我方多 artifacts/image-cache/pdf-cache/video-cache |
| 项目 .zcode/{config.json,workflows,workflow-runs,workflow-drafts,agents,agent-memory,agent-memory-local,plans,AGENTS.md} | .drora/ 同名 | 纯改名 |
| .zcode/v2/{credentials.json,telemetry-state.json,agents-state.json,runtime/provider/...} | .drora/v2/ 同构 | 纯改名 |
| .zcode-plugin/ + .zcode-plugin-seed.json | **保留 .zcode-plugin 原名**（adapters/src/plugins/index.ts:100、bootstrap/src/app/bundled-plugins.ts:36,41,349,438,470、skills/index.ts） | 未改名（SHAPE-DIFF）。定性：插件清单目录名是既有插件包兼容面，保留合理但形成品牌不一致；真值同为 .zcode-plugin，故与真值无差、与自身品牌不一致。P3 |
| .zcode-bundled-skills-seed.json | .drora-bundled-skills-seed.json | 已改名 |
| .zcode-runtime-tool.json | .drora-runtime-tool.json | 已改名 |
| zcode.json / .zcode/config.json | drora.json / .drora/config.json | 纯改名 |
| zcode-builtin.json | drora-builtin.json（SEA 资产键 drora-provider/drora-builtin.json、控制文件 drora-builtin-refresh.json） | 改名；控制文件名为我方命名，真值 controlFilePath 命名未逐字验证（OQ5） |
| GLM_BINARY_PATH / nativeConfigDir ".zcode/cli" | 无原生 glm 启动器 | 行为差（见 G6） |

## §5 差集三分类表

| 类别 | 计数 | 条目 |
|---|---|---|
| REAL-GAP | 9 | G1 PROD/TEST endpoint 分流 P2；G2 BIGMODEL PROD/TEST P3；G3 ZAI PROD/TEST P3；G4 ANTHROPIC_API_KEY/BASE_URL 消费 P2；G5 DEBUG 开关 P3；G6 GLM_BINARY_PATH 原生启动器 P3；G7 CLAUDE_CODE_TMPDIR 文案 P3；G8 CLAUDE marketplace 别名 P3；G9 OPENAI/AI_GATEWAY env P3 |
| EXTRA | 2 | E1 标识符级内部常量一批（无行为差异证据）P3；E2 cli/{artifacts,image-cache,pdf-cache,video-cache} 扩展目录 P3 |
| SHAPE-DIFF | 4 | S1 $schema/passthrough P3/OQ2；S2 toolCallWarningThreshold 配置入口 P3/OQ3；S3 .zcode-plugin 品牌未改名（与真值同形、与自身品牌不一致）P3；S4 错误提示文案缺变量名提示（G7 同源）P3 |
| 一致（重点确认） | — | env→settings 映射 10 条、ConfigKey 39 键、六层作用域+优先级、默认值对象、config 文件名与发现链、MCP config schema、22 个 sqlite 迁移 id+appVersion+checksum 语义、beta 根目录逻辑 |

P1 清单：无（本域核心面完成度高，无阻断级差异）。

## §6 OPEN-QUESTION

- OQ1 GLM_BINARY_PATH/ZCODE_AGENT_RUNTIME 原生 glm agent 启动器是被我方 drora.cjs 直跑架构有意取代，还是漏迁？若需兼容外部用 GLM_BINARY_PATH 指定运行时的场景，缺入口。
- OQ2 真值配置文件解析对未知顶层键是否 passthrough 未验证；我方 `.passthrough()` 更宽，反向兼容风险待测。
- OQ3 真值配置文件 schema 是否暴露 modelAnomalyGuard.toolCallWarningThreshold 未验证（运行时存在该阈值）。
- OQ4 我方 bundled ai-sdk 是否自动携带 OPENAI_API_KEY/ANTHROPIC_API_KEY 等 SDK 缺省 env 行为未实测。
- OQ5 真值 builtin provider 的 controlFilePath 文件名未逐字提取（我方为 drora-builtin-refresh.json），命名是否一致待查。
- OQ6 真值 `ZCODE_E2E_*` 三个引号串之外是否还有按前缀拼接的 E2E 变体未穷举。
