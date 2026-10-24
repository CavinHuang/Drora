# 官方配置体系与常量族调研（batch4-target-config）

- 调研日期：2026-10-19
- 对象：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 B，esbuild bundle）+ `provider/zcode-builtin.json`（revision 30）
- 调研方式：只读（grep -o / grep -ob + tail -c 取上下文 / node -e 解析 JSON）；未修改任何文件
- 主要 grep 命令见 §7

## 1. env 键全表（162 distinct，含分类）

提取命令（允许数字，162 个 distinct；批次 1-3 的 162 与此一致）：

```bash
grep -o 'ZCODE_[A-Z0-9_]*' zcode.cjs | sort | uniq -c | sort -rn
```

### 1.1 非环境变量的 `ZCODE_` 字面量（先剔除，避免误当 env 键）

| 字面量 | 分类 | 证据（偏移/摘录） |
| --- | --- | --- |
| `__ZCODE_ENV__`、`__ZCODE_PRODUCT_FLAVOR__`、`__ZCODE_VERSION__`、`__ZCODE_COMMIT__`、`__ZCODE_BUILD_TIME__`、`__ZCODE_TELEMETRY_REPORT_ENDPOINT__`、`__ZCODE_ARMS_RUM_ENDPOINT__`、`__ZCODE_AUTO_UPDATE_ENABLED__` | esbuild `define` 编译期全局（8 个，形如 `ZCODE_ENV__` 被 `[A-Z0-9_]*` 截出） | @625927 `typeof __ZCODE_ENV__<"u"?__ZCODE_ENV__:void 0`；`normalizeZCodeEnv`/`normalizeZCodeProductFlavor` |
| `ZCODE_`（裸前缀） | env 配置命名空间前缀常量（`parseEnvConfig` 用） | `vJs="ZCODE_";r(egn,"parseEnvConfig")` |
| `ZCODE_TELEMETRY_`（裸前缀） | 遥测 env 前缀谓词 | @11050 `e.startsWith("OTEL_")\|\|e.startsWith("ZCODE_TELEMETRY_")\|\|e==="ZCODE_MODEL_TELEMETRY_ENABLED"`（函数 `Brr`，用于子进程 env 过滤） |
| `ZCODE_SLASH_COMMAND_HELP_ENTRIES` | 导出名（`BUILTIN_ZCODE_SLASH_COMMAND_HELP_ENTRIES`→TF），非 env | @1052580 导出注册表 |
| `ZCODE_KNOWN_TOOL_NAMES` | 导出名→`cbr` 已知工具名清单 | `cbr=["Read","Write","Edit","ApplyPatch","Bash","Glob","Grep","WebFetch","WebSearch","web_search","TodoRead","TodoWrite","GoalRead","ReadSessionContext","AskUserQuestion","SendMessage","RespondToCoordinator","TaskOutput","TaskStop","js","js_reset",...,"mcp__node_repl__js",...]` |
| `ZCODE_COMMAND_AGENT_SOURCE` / `ZCODE_COMMAND_AGENT_SOURCES` | 导出名→`bZt="zcodeAgent"`、`VJi=["zcodeAgent"]`（命令 agent 来源标识） | @1074340 |
| `ZCODE_ENABLED_AGENT_PROVIDERS` | 导出名→`Eme=[wH]=["glm"]`（当前启用 agent provider 白名单） | `Cme=m.enum(["claude","opencode","gemini","codex","glm"]).transform(()=>wH)` |
| `ZCODE_AGENT_PROVIDER` | 导出名→`wH="glm"`（provider id） | 同上 |
| `ZCODE_AGENT_PROVIDER_LABEL` | 导出名→`vZt="ZCode Agent"` | @1073986 |
| `ZCODE_AGENT_RUNTIME` | 导出名→`yyr` 运行时描述符 | `yyr={binaryKind:"native-binary",binaryEnvVar:"GLM_BINARY_PATH",bundledResourceDir:"glm",version:"0.13.3",spawnArgs:["app-server","--stdio"],nativeConfigDir:".zcode/cli",nativeConfigFileName:"config.json",missingBinaryMessage:"[ZCode Agent] glm binary 未找到，请设置 ZCODE_AGENT_WORKDIR、GLM_BINARY_PATH 或先准备 GLM 运行时资源",...}` |
| `ZCODE_AGENT_PROVIDER_NOT_READY` / `_CODE` / `_REASON` | 错误码+reason 常量 | `Nus="ZCODE_AGENT_PROVIDER_NOT_READY",Lus="provider_not_ready"` |
| `ZCODE_AGENT_LIFECYCLE_LOG_MARKER` | 导出名→日志标记 `EVi="[zcode-agent-lifecycle-reported]"` | @1073917 |
| `ZCODE_FILE_LOCK_TIMEOUT` / `ZCODE_FILE_LOCK_TIMEOUT_ERROR_CODE` | 错误码常量 `Qfe="ZCODE_FILE_LOCK_TIMEOUT"`（非 env） | @501005；`isZCodeFileLockTimeoutError` |
| `ZCODE_PLUGIN_SEED_INCOMPLETE` | 错误码（bundled 插件种子资产缺失） | @14036557 `code:"ZCODE_PLUGIN_SEED_INCOMPLETE"` |
| `ZCODE_CREDENTIAL_DECRYPT_FAILED` | 错误码（凭据解密失败） | `Nyr="ZCODE_CREDENTIAL_DECRYPT_FAILED"`，消息 `Myr="凭据解密失败："` |
| `ZCODE_UNSUPPORTED_HTTP_STATUS` | 错误码（`UnsupportedHttpStatusError`，`status` 不在可返回区间） | @2786423 |
| `ZCODE_PROTOCOL_NAME` / `ZCODE_PROTOCOL_VERSION` / `ZCODE_PROTOCOL_V4_WIRE_VERSION` | 协议身份常量导出（`zet`/`$et`/`hYi`），非 env | @1075617-1075684 |
| `ZCODE_VERSION` / `ZCODE_COMMIT` / `ZCODE_BUILD_TIME` | 构建信息导出（`a2`/`vur`/`bur`），非 env | @1076100 附近 |
| `ZCODE_APP_VERSION` / `ZCODE_BUILD_COMMIT_ID` / `ZCODE_DEBUG` | 半 env：`Rur=process.env.ZCODE_DEBUG`；`yme="ZCODE_APP_VERSION"`、`Pur="ZCODE_BUILD_COMMIT_ID"` 作为可覆盖键名 | @626170 `yme="ZCODE_APP_VERSION",Pur="ZCODE_BUILD_COMMIT_ID",Rur=process.env.ZCODE_DEBUG` |
| `ZCODE_PROVIDER_OPTIONS` | 导出名（`BOT_ZCODE_PROVIDER_OPTIONS`→`_Ki`，bot 侧 provider options） | @1052302 |
| `ZCODE_SOURCE_HEADERS` | 导出名→`pyr={"User-Agent":"ZCode/unknown"}`（运行时注入的源请求头基线） | @1076016 |
| `ZCODE_*_ENV_KEY` / `ZCODE_*_ENV`（约 20 个注册表名） | 导出注册表里的常量名（值才是真 env 键），如 `ZCODE_HTTP_PROXY_ENV_KEY:()=>afe`，`afe="ZCODE_HTTP_PROXY"` | @1073881-1076235 懒导出注册表 |

### 1.2 真 env 键语义分组（键 → 用途推断 / 默认值 / 上下文摘录偏移）

说明：偏移为 `grep -bo` 首次命中字节偏移，摘录见 §7 命令可复现。

**A. 端点与 base URL**
| 键 | 用途/默认 | 偏移/摘录要点 |
| --- | --- | --- |
| `ZCODE_BASE_URL` | 主 API base origin 覆盖；优先级 `ZCODE_BASE_URL ?? ZCODE_ENDPOINT_ORIGIN ?? 内置默认` | @768964 `sM(e,"ZCODE_TEST_BASE_URL");return cmr({env:n,envBaseOrigin:sM(e,"ZCODE_BASE_URL")??sM(e,"ZCODE_ENDPOINT_ORIGIN")??o,...}` |
| `ZCODE_TEST_BASE_URL` | 测试环境 origin | @768904 同上函数 |
| `ZCODE_PRODUCTION_BASE_URL` | 生产 origin 选择开关值 | @768870 `...("ZCODE_PRODUCTION_BASE_URL"):sM(e,"ZCODE_TEST_BASE_URL")` |
| `ZCODE_ENDPOINT_ORIGIN` | endpoint origin 覆盖（wss 用） | @768988；默认 `gne="https://zcode.z.ai"`，远端 `Aet="https://zcode.chatglm.site"`（`wss://zcode.chat...`） |
| `ZCODE_DEPS_BASE_URL` | 内网依赖下载根；否则 `INTRANET_MACHINE_HOST`，端口 12345 | @1016570 `throw new Error("Configure ZCODE_DEPS_BASE_URL or INTRANET_MACHINE_HOST in .env before downloading internal dependencies")`；`Ctn=12345` |
| `ZCODE_UNSUPPORTED_HTTP_STATUS` | （错误码，见 1.1） | — |

**B. 代理与网络权威**
| 键 | 用途 | 偏移/摘录要点 |
| --- | --- | --- |
| `ZCODE_HTTP_PROXY` | agent 侧 HTTP 代理 | @11502 常量定义块 `afe="ZCODE_HTTP_PROXY"` |
| `ZCODE_NO_PROXY` | 代理排除列表 | @11525 `gPe="ZCODE_NO_PROXY"` |
| `ZCODE_REMOTE_HTTP_PROXY` / `ZCODE_REMOTE_NO_PROXY` | 远程运行时代理下发 | @11591/@11621 |
| `ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY` | 远程运行时网络权威 | @11546 `w$t="ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY"` |
| `ZCODE_AGENT_CA_CERT` | agent 自定义 CA | @11649 `_Pe="ZCODE_AGENT_CA_CERT"` |
| `ZCODE_TOOL_ENV_PASSTHROUGH_JSON` | 工具子进程 env 透传白名单 JSON（排序后整体序列化写入） | @11675 `ste`；写入处 `return t.length===0?{}:{[ste]:JSON.stringify(Object.fromEntries(t))}` |

**C. 运行时身份/模式**
| 键 | 用途/默认 | 摘录要点 |
| --- | --- | --- |
| `ZCODE_RUNTIME_ENV` | 运行时 env 名（development/production/test），`GV()` 规范化 | @11478 `Qz="ZCODE_RUNTIME_ENV"` |
| `ZCODE_ENV` | 构建 env 名；`==="beta"` 触发 beta 存储重定向 | @14345 `e.ZCODE_BETA==="1"\|\|e.ZCODE_ENV==="beta"` |
| `ZCODE_BETA` | `"1"` → 存储目录切 `~/.zcode-beta`（叠加 argv 含 `zcode-beta` 判定） | @14325 `e.ZCODE_STORAGE_DIR=join(homedir(),".zcode-beta")` |
| `ZCODE_PRODUCT_FLAVOR` | 产品 flavor（导出 `Aur`） | @625927 |
| `ZCODE_SERVICE_AUTHORITY_MODE` | 服务权威模式，合法值 `["desktop-local","desktop-attached-remote","standalone-server"]` | @924999 `kyr="ZCODE_SERVICE_AUTHORITY_MODE",xyr=[...]`；`isServiceAuthorityMode`/`parseServiceAuthorityMode` |
| `ZCODE_DYNAMIC_WORKFLOW_MODE` | 动态工作流模式，合法 `["disabled","onDemand","alwaysOn"]`，默认 `disabled` | @764146 `bF=["disabled","onDemand","alwaysOn"],Bfr="ZCODE_DYNAMIC_WORKFLOW_MODE",Ufr="disabled"` |
| `ZCODE_DESKTOP_CONTEXT_PROMPT_ENABLED` | 桌面上下文提示开关 | @11713 `d7i="ZCODE_DESKTOP_CONTEXT_PROMPT_ENABLED"` |
| `ZCODE_MESSAGE_ENABLED` | `"1"/"true"` → 会话 mailbox 启用 | @13999359 `function TYo(e){return e.ZCODE_MESSAGE_ENABLED==="1"\|\|e.ZCODE_MESSAGE_ENABLED==="true"}` |
| `ZCODE_AUTO_UPDATE_ENABLED` | 自动更新开关（来自 define 全局 `__ZCODE_AUTO_UPDATE_ENABLED__`，默认 false） | @626366 `Mur=typeof __ZCODE_AUTO_UPDATE_ENABLED__<"u"?__ZCODE_AUTO_UPDATE_ENABLED__:!1` |
| `ZCODE_E2E_*`（6 个） | E2E 测试钩子：`COVERAGE`（`"1"`+NODE_V8_COVERAGE 时 takeCoverage）、`RUN_ID`、`STORE_BRIDGE`（配合 `VITE_ZCODE_E2E_STORE_BRIDGE==="1"`）、`FS_FAULTS`/`FS_FAULTS_ALLOW`（文件系统故障注入，白名单 appendFile/any/mkdir/rename/rm/sqliteOpen/sqliteRun/writeFile）、`ASK_USER_QUESTION_CLOCK_SCALE` | @20998/@964481/@1128120/@993223 |

**D. 路径与存储**
| 键 | 用途/默认 | 摘录要点 |
| --- | --- | --- |
| `ZCODE_STORAGE_DIR` | 存储根，默认 `~/.zcode`（beta `~/.zcode-beta`） | @14284；三处默认 `ZCODE_STORAGE_DIR?.trim()\|\|join(homedir(),".zcode")` |
| `ZCODE_DATA_BASE_DIR` | 数据基目录，默认 homedir；其下 `.zcode/v2/provider_config.json`、`.zcode/v2/...` | @1123568 `e.dataBaseDir??e.env.ZCODE_DATA_BASE_DIR?.trim()??homedir()`；错误码 `DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR` 禁止设为 Windows 安装目录 |
| `ZCODE_HOME` | 遥测 device-mid 文件的 home 覆盖 | @13992091 `Wnc(e.ZCODE_HOME?.trim())` |
| `ZCODE_MAILBOX_ROOT` | 会话 mailbox 根，默认 `~/.zcode/mailbox` | @14336879 `f8o({rootDir:K0((e.env??process.env).ZCODE_MAILBOX_ROOT??"~/.zcode/mailbox")})` |
| `ZCODE_LOG_DIR` / `ZCODE_LOG_CONSOLE` | 日志目录 / `"1"` 时 stderr 输出 | @4165755 `o=e.logDir??e.env?.ZCODE_LOG_DIR??xGs(),i=...e.env?.ZCODE_LOG_CONSOLE==="1"?process.stderr:...` |
| `ZCODE_GEN_UI_OUTPUT_ROOT` | 生成式 UI 输出根 | @513581 `xJt="ZCODE_GEN_UI_OUTPUT_ROOT"` |
| `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` | 个人 provider 配置路径覆盖（默认 `<dataBase>/.zcode/v2/provider_config.json`） | @1122695 `Rne="ZCODE_PERSONAL_PROVIDER_CONFIG_FILE",gnt="provider_config.json"` |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE` / `ZCODE_BUILTIN_PROVIDER_CONFIG_ASSET_KEY` | 内置 provider 配置路径/SEA 资产键；`resolveNodeProviderRuntimePaths` 要求 builtin+personal 同时提供 | @1122605 `OH="ZCODE_BUILTIN_PROVIDER_CONFIG_FILE",hnt="..._BUNDLED_CONFIG_FILE"`；"ZCode Built-in 与 Personal Provider Config 路径必须同时提供" |
| `ZCODE_AGENT_WORKDIR` | agent 工作目录（缺失二进制提示中要求设置） | @923398 `missingBinaryMessage:"...请设置 ZCODE_AGENT_WORKDIR、GLM_BINARY_PATH..."`；`GLM_BINARY_PATH`（无 ZCODE_ 前缀，2 处）为二进制路径 env |
| `ZCODE_RG_BINARY` / `ZCODE_UGREP_BINARY` / `ZCODE_BFS_BINARY` / `ZCODE_GIT_BINARY` / `ZCODE_EMBEDDED_SEARCH_COMMAND` | 搜索/git 二进制覆盖（`binaryEnvVar` 逐工具映射，bundledResourceDir ripgrep/ugrep/bfs） | @15664-15928 `SPe={bfs:{binaryEnvVar:"ZCODE_BFS_BINARY",...},ripgrep:{binaryEnvVar:"ZCODE_RG_BINARY",...},ugrep:{...}}`；git：`process.env.ZCODE_GIT_BINARY?.trim()\|\|"git"` |
| `ZCODE_WINDOWS_OUTPUT_ENCODING` | Windows 输出编码覆盖 | @2186329 `Sks="ZCODE_WINDOWS_OUTPUT_ENCODING",wks={PYTHONIOENCODING:"utf-8",PYTHONUTF8:"1"}` |

**E. 子进程注入 env（ZCODE_↔CLAUDE_ 双写，见 §2.4）**
| 键 | 用途 | 摘录要点 |
| --- | --- | --- |
| `ZCODE_SESSION_ID` / `ZCODE_PROJECT_DIR` / `ZCODE_SKILL_DIR` / `ZCODE_PLUGIN_ROOT` / `ZCODE_PLUGIN_DATA` / `ZCODE_PLUGIN_ID` / `ZCODE_PLUGIN_NAME` | 插件/MCP/hook 子进程 env；同时是插件模板变量（`${ZCODE_SESSION_ID}` 等） | @4234736 `Fno({CLAUDE_PROJECT_DIR:t.workingDirectory,ZCODE_PLUGIN_DATA:t.dataPath,ZCODE_PLUGIN_ROOT:t.loaded.rootPath,ZCODE_PROJECT_DIR:t.workingDirectory,CLAUDE_PLUGIN_DATA:...,CLAUDE_PLUGIN_ROOT:...})`；@5169375 `set:{...o,CLAUDE_PLUGIN_DATA:e.dataPath,...,ZCODE_PLUGIN_ID:e.id,ZCODE_PLUGIN_NAME:e.name,...}`；@4237728 模板变量 switch：`case"CLAUDE_PROJECT_DIR":case"ZCODE_PROJECT_DIR":return t.workingDirectory` 等，缺上下文时抛 `Plugin variable requires a runtime session context` |
| `ZCODE_CUA_PRODUCT_HELPER` / `ZCODE_CUA_PERMISSION_BROKER_SOCKET` / `ZCODE_CUA_PERMISSION_BROKER_TOKEN` / `ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER` / `ZCODE_CUA_PLUGIN_AUTHORITY` / `ZCODE_CUA_NODE_REPL_HOST` / `ZCODE_CUA_DEV_MODE` / `ZCODE_CUA_PLUGIN_ROOT` | computer-use 官方插件 broker/host 握手 env | @11713-11858 常量块；@9915 `Lrr` 用 socket+authority(+refreshMarker) 冻结 broker 状态 |
| `ZCODE_CUA_OFFICIAL_PLUGIN_ID`（值 `computer-use@zcode-plugins-official`）/ `ZCODE_CUA_OFFICIAL_MCP_NAMESPACE_NAME`（值 `plugin:computer-use:computer-use`） | CUA 插件身份常量 | @18822 `CI="computer-use@zcode-plugins-official",v3="plugin:computer-use:computer-use"` |
| `ZCODE_NODE_REPL_BROWSER_BROKER_SOCKET` / `ZCODE_NODE_REPL_BROWSER_BROKER_TOKEN` | node-repl 浏览器 broker 握手（zod schema：uuid id、runtimeScope enum ["main","subagent"]、token min 32） | @1018310 `Atn="ZCODE_NODE_REPL_BROWSER_BROKER_SOCKET",Ptn="ZCODE_NODE_REPL_BROWSER_BROKER_TOKEN",Wbr=m.object({...})` |
| `ZCODE_OFFICIAL_MCP_DEV_TRUSTED_ORIGINS` | 开发期官方 MCP 信任 origin 列表 | @767229 `tXt="ZCODE_OFFICIAL_MCP_DEV_TRUSTED_ORIGINS"`；`parseDevTrustedOrigins` |
| `ZCODE_OFFICIAL_MCP_AUTH_TYPE`（值 `zcode_official`）/ `ZCODE_OFFICIAL_MCP_AUTH_PROVIDER_JWT_TOKEN`（值 `jwt_token`） | 官方 MCP 鉴权类型/token 字面量 | @1075189 |
| `ZCODE_WORKSPACE_IDENTITY` | 官方 MCP 身份头（workspace 身份隔离） | @767274 `nXt="ZCODE_WORKSPACE_IDENTITY"` |
| `ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID`（值 `zcode-plugins-official`） | 官方插件市场 id（CLAUDE 侧映射名 `CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID` 同值） | @513581 附近 `a7="zcode-plugins-officia[l]"` |

**F. 鉴权/凭据**
| 键 | 用途 | 摘录要点 |
| --- | --- | --- |
| `ZCODE_CREDENTIAL_SECRET` | 凭据加密密钥来源（aes-256-gcm，密文前缀 `enc:v1:`，IV 12B、tag 16B） | @4390112 `V0n="enc:v1:",Mso="aes-256-gcm",Nso=12,Nta=16,Lta="ZCODE_CREDENTIAL_SECRET";...createZCodeCredentialCipher/deriveCipherKey/resolveCredentialSecret` |
| `ZCODE_JWT_INVALID_BROADCAST_CHANNEL` | JWT 失效广播频道名 `auth:zcode-jwt-invalid` | @1074997 `cls="auth:zcode-jwt-invalid"` |

**G. 遥测（可禁用面）**
| 键 | 用途 | 摘录要点 |
| --- | --- | --- |
| `ZCODE_MODEL_TELEMETRY_ENABLED` | 模型遥测开关（与前缀谓词配合，可整体剥离） | @13992091 `erc(e.ZCODE_MODEL_TELEMETRY_ENABLED)`；遥测 env 全族在子进程透传白名单 `Nrr` 尾部 |
| `ZCODE_TELEMETRY_DEVICE_MID` / `ZCODE_TELEMETRY_USER_ID` / `ZCODE_TELEMETRY_USER_ID_HASH` / `ZCODE_TELEMETRY_USER_SUBJECT_ID` / `ZCODE_TELEMETRY_IDENTITY_STATE` / `ZCODE_TELEMETRY_RUNTIME_SURFACE` / `ZCODE_TELEMETRY_RUNTIME_DISTRIBUTION` | 遥测身份/运行面标识（透传白名单成员） | @12612-12799 白名单数组 `Nrr` |
| `ZCODE_TELEMETRY_REPORT_ENDPOINT` / `ZCODE_ARMS_RUM_ENDPOINT` | 遥测上报端点（编译期 define 注入，运行时只读导出 `Our`/`Dur`） | @626276 `Our=typeof __ZCODE_TELEMETRY_REPORT_ENDPOINT__<"u"?...:""`；`mapZCodeEnvToArmsRumEnv` |

**H. 限流/超时/重试/采样（可 env 覆盖阈值）**
| 键 | 默认值 | 摘录要点 |
| --- | --- | --- |
| `ZCODE_MODEL_RETRY_MAX_RETRIES` / `ZCODE_MODEL_RETRY_BASE_DELAY_MS` / `ZCODE_MODEL_RETRY_BACKOFF_FACTOR` / `ZCODE_MODEL_RETRY_MAX_DELAY_MS` | `maxAttempts:11, baseDelayMs:2000, backoffFactor:2, jitter:true, maxDelayMs:60000` | @3816722 `PNe={backoffFactor:2,baseDelayMs:2e3,jitter:!0,maxAttempts:11,maxDelayMs:6e4}`；`resolveAiSdkModelRetryOptions` |
| `ZCODE_MCP_RESOURCE_SAMPLE_INTERVAL_MS` | 300000（5min） | `Vet=5*6e4` |
| `ZCODE_CLI_RESOURCE_SAMPLE_INTERVAL_MS` | 60000 | `cdr=6e4` |
| `ZCODE_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS` | 15000 | `att=15e3` |
| `ZCODE_WORKFLOWS_RUNS_MAX_LIMIT` | 50（`limit` schema `.max(ptt)`） | `ptt=50` |
| `ZCODE_WORKFLOWS_FOR_RUN_MAX_CANDIDATES` | 8（`candidates` schema `.max(kgr)`） | `kgr=8` |
| `ZCODE_PLUGIN_SEED_LOCK_TIMEOUT` | 60000；stale 锁接管阈值 15000 | @14035821 `sXo=50,Src=6e4,wrc=15e3,aXo="ZCODE_PLUGIN_SEED_LOCK_TIMEOUT"`；`withOfficialPluginSeedLock` |
| `ZCODE_FILE_LOCK_TIMEOUT` | （错误码，见 1.1；锁超时数值未单独设 env） | — |
| `ZCODE_FILE_STREAMING_TOOL_INPUT_PREVIEW_MIN_INTERVAL_MS` | 1000 | `gtn=1e3` |
| `ZCODE_ACTIVE_STREAMING_TOOL_INPUT_EAGER_DELTA_COUNT` / `_PREVIEW_MIN_INTERVAL_MS` / `_PREVIEW_MIN_RAW_GROWTH` / `_TIME_BUDGET_MAX_RAW_INPUT` | 1 / 750 / 8192 / 8192 | `K4c=1,Z4c=750,Y4c=8192,X4c=8192` |
| `ZCODE_PROCESS_DIAGNOSTIC_PREFIX` / `_NAME_MAX_CHARS` / `_MESSAGE_MAX_CHARS` / `_MAX_LINE_CHARS` / `_STACK_MAX_CHARS` | `"[zcode-process-exception] "` / 128 / 4000 / 131072(128*1024) / 16000 | `PRe="[zcode-process-exception] ",mXe=128,hXe=4e3,lcr=128*1024,gXe=16e3` |
| `ZCODE_MODEL_REASONING_SEPARATOR` | `"$"`（推理段分隔符） | `BRe="$"` |
| `ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY` | `"preflight-v1"`（默认上下文预算策略） | `aM="preflight-v1"`（导出名 `DEFAULT_ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY`） |

**I. 其他**
| 键 | 用途 | 摘录要点 |
| --- | --- | --- |
| `ZCODE_DEBUG` | 调试开关（`process.env.ZCODE_DEBUG` 读入导出 `Rur`） | @626170 |
| `ZCODE_E2E_COVERAGE` 等 | 见 C 组 | — |
| `ZCODE_CREDENTIAL_SECRET` | 见 F | — |

**J. 工具子进程 env 透传白名单（`Nrr` 数组，@11480-12830）**
`NODE_ENV, ELECTRON_RUN_AS_NODE, NODE_NO_WARNINGS, HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY, NODE_EXTRA_CA_CERTS, SSL_CERT_FILE, SSL_CERT_DIR, REQUESTS_CA_BUNDLE, CURL_CA_BUNDLE, GIT_SSL_CAINFO, ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY, ZCODE_REMOTE_HTTP_PROXY, ZCODE_REMOTE_NO_PROXY, ZCODE_CUA_PERMISSION_BROKER_SOCKET, ZCODE_CUA_PERMISSION_BROKER_TOKEN, ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER, ZCODE_CUA_PLUGIN_AUTHORITY, OTEL_EXPORTER_OTLP_ENDPOINT/TRACES_ENDPOINT/HEADERS/TRACES_HEADERS/METRICS_ENDPOINT/METRICS_HEADERS, OTEL_SERVICE_NAME, OTEL_RESOURCE_ATTRIBUTES, OTEL_EXPORTER_OTLP_COMPRESSION, ZCODE_MODEL_TELEMETRY_ENABLED, ZCODE_TELEMETRY_DEVICE_MID, ZCODE_TELEMETRY_USER_ID, ZCODE_TELEMETRY_USER_ID_HASH, ZCODE_TELEMETRY_USER_SUBJECT_ID, ZCODE_TELEMETRY_IDENTITY_STATE, ZCODE_TELEMETRY_RUNTIME_SURFACE, ZCODE_TELEMETRY_RUNTIME_DISTRIBUTION`。
另一子集 `p7i`（CUA 内部最小集）与正则 `f7i=/^(npm_config|yarn|pnpm)_(http_proxy|https_proxy|proxy|all_proxy|no_proxy|cafile|ca)$/i`；删除谓词 `Brr`（OTEL_/ZCODE_TELEMETRY_/MODEL_TELEMETRY_ENABLED 全剥）。

### 1.3 CLAUDE_ 兼容映射结论

`grep -o 'CLAUDE_[A-Z0-9_]*' | sort -u` 仅 7 个：`CLAUDE_PLUGIN_ROOT(8)、CLAUDE_PLUGIN_DATA(8)、CLAUDE_SESSION_ID(7)、CLAUDE_PROJECT_DIR(7)、CLAUDE_CODE_SESSION_ID(7)、CLAUDE_SKILL_DIR(6)、CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID(1)`。

- **双写而非兼容读取**：构造插件/MCP/hook 子进程 env 时同时注入两套键（证据 @4234736、@5169375、`Rve` 函数 `i={CLAUDE_CODE_SESSION_ID:n.sessionId,CLAUDE_PROJECT_DIR:n.cwd||o,CLAUDE_SESSIO...}`）。
- **模板变量成对解析**：插件 `${VAR}` 解析 switch 中 `CLAUDE_X` 与 `ZCODE_X` 每个case成对出现（@4237728-4237847）。
- **市场 id 同值**：`CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID` 导出与 `ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID` 同为 `zcode-plugins-official`（@513581 附近 `a7="zcode-plugins-official"`、`IJt`）。
- **结论**：官方不存在"读 CLAUDE_* 配置"的兼容层；CLAUDE_ 键只是对旧插件/工具的**注入适配**（保持第三方插件脚本可继续用 CLAUDE_* env）。Drora 侧若全面改用 DRORA_*，仅需保证对内的注入面自洽；对外第三方插件适配层需自行决定是否保留 CLAUDE_ 注入。

## 2. settings/配置文件布局

### 2.1 核心事实：无 settings.json，官方配置面为

| 文件 | 角色 | 证据 |
| --- | --- | --- |
| `zcode.json`（项目根） | 项目配置（本仓发现的 hooks 声明面） | @4189263 `Vto(e)=e.flatMap(t=>[join(t,"zcode.json"),join(t,".zcode","config.json")])` |
| `.zcode/config.json`（项目） | 项目配置（唯一 `editable:true` 的项目级文件） | @4190004 `editable:!n&&t===resolve(e.workingDirectory,".zcode","config.json")`；`configFileKind` enum `["zcode.json",".zcode/config.json","explicit"]` |
| `~/.zcode/cli/config.json` | GLM agent 原生配置（native config） | @923260 `yyr={...,nativeConfigDir:".zcode/cli",nativeConfigFileName:"config.json"}` |
| `~/.zcode/v2/provider_config.json` | 个人 provider/模型配置（可被 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 覆盖） | @1123773 `a=n??join(o,".zcode","v2",gnt)`，`o=dataBaseDir??env.ZCODE_DATA_BASE_DIR??homedir()` |
| 插件清单 `.zcode-plugin/plugin.json` + 插件根 `.mcp.json` | 插件与插件级 MCP servers | @4232331 `Voe(e)={...zno(join(e.loaded.rootPath,".mcp.json"),e),...Uno(e.loaded.manifest.mcpServers,e)}`；`.zcode-plugin/plugin.json`、`.claude-plugin/plugin.json` 双形态识别 |
| `~/.zcode-plugin-seed.json` / `.zcode-bundled-skills-seed.json` | 官方插件/技能种子标记 | `Arc="zcode-official-plugins/manifest.json",_Xo=".zcode-plugin-seed.json"`；种子白名单 `Rrc=new Set([".mcp.json",".zcode-plugin","README.md","agents","commands","dist","docs","hooks","output-styles","package.json","scripts","skills","templates"])` |
| `.zcode-runtime-tool.json` | 运行时工具注册（单文件字面量 1 次） | grep `.zcode/` 全表 |

- `settings.json` 字面量在 bundle 中出现 **0 次**；无 `managed-settings`、无 `policySettings`/`managedSettings`/`systemSettings` 标识（grep 0 命中）→ **官方没有企业托管配置层**。
- `.claude/` 目录字面量仅 `.claude-plugin`(5)/`.claude-plugin/plugin.json`(1)/`.claude`(1)，**不存在 `.claude/settings.json` 兼容路径**。

### 2.2 项目配置发现顺序与合并

- 函数链：`RJs`（从 cwd 向上收集祖先目录直到含 `.git` 的根，`DJs`=存在 `.git` 文件/目录即停，结果反转成根→cwd 顺序）→ `Vto`（每目录产出 `zcode.json`、`.zcode/config.json` 两个候选）→ `Gto`/`CJs`（过滤 existsSync，外加可选 `explicitProjectConfigPath`，`Hto` 去重保序）→ `ldt`（逐个 JSON.parse，仅取 `hooks` 字段，`zoe.parse(c.hooks)` 校验，记录 `discoveryOrder`（数组序）、`configFileKind`、`editable`）。
- 合并语义：`discoveryOrder` 保留发现顺序（根目录在前、cwd 在后）；hook 生效需四开关齐备：`sourceRootEnabled && declarationEnabled && runtimeHooksEnabled`（`Wto`：`configuredEnabled=source&&declaration&&runtime`）。唯一可写回的项目配置是 cwd 的 `.zcode/config.json`（`Workspace Hook toggle target is not the current editable project config` 守卫，@14105372）。
- 快照 schema（`v0s`，@1369319）：`{schemaVersion, workspaceIdentity, discoveredAt, sourceFiles:[{canonicalPath, baseDir, discoveryOrder, configFileKind, explicitProjectConfig, editable, hooksRoot:{enabled?,timeoutMs?,maxOutputBytes?}, hooks:[...]}]}`。

### 2.3 应用级偏好与模型选择

- 运行时偏好存储命名空间：`Vus="settings:app-runtime-preferences"`（@993223；schema：`askUserQuestionAutoResolutionEnabled`、`modelIoFullRetentionEnabled`(default false)）。
- 模型选择：`NodeModelSelectionConfigRepository`（@608048）读写 personal repository 的 `defaultModelSelection`；个人配置解析 `CGi.parse(t)` → `{providers(Elr), models(Rlr(PGi(modelConfigRules))), providerOrder, defaultModelSelection?}`（@609164）。遗留字段 `manualProviderModelRules` 由 `normalizeLegacyManualRules`(PGi) 迁移。
- provider 配置合并：`FA.composeEffective(builtin, personal)` —— 内置规则在前，personal 仅追加 `provider-model/manual-provider-model` 类规则；`setExact` 可精确覆写；provider 刷新经 `ProviderConfigService`（dispose 守卫，@579288）。

### 2.4 CLAUDE 兼容映射（配置文件侧）

不存在 `.claude/settings.json`/`.claude.json` 读取；兼容仅限 §1.3 的子进程 env 双写与 `.claude-plugin/plugin.json` 插件清单形态识别。`.zcode-plugin/plugin.json` 与 `.claude-plugin/plugin.json` 均被插件加载器识别（各 1-7 处字面量）。

## 3. 权限规则模型

### 3.1 规则结构

- 规则对象：`{toolName: string.min(1), ruleContent?: string}`（@1372521 `rules:G.array(G.object({toolName:G.string().min(1),ruleContent:G.string().optional()}))`）。
- 行为枚举：`qdr=m.enum(["allow","deny","ask"])`（规则/更新）；判定枚举 `WQe=m.enum(["allow","deny","escalate","modify"])`（PermissionRequest hook 决策）；更新类型 `type:"addRules"`（批量）/`"addRule"`（单条，`ADi`/`bt addRule`）。
- 去重：`afa dedupePermissionRules`；应用：`H4e applyPermissionUpdates`、`GNn buildSessionPermissionUpdates`、`xmo projectPermissionUpdates`（`dfa ruleContentFromInput` 从输入抽 ruleContent）。

### 3.2 匹配函数与语法

- **通用调用匹配** `LSo matchesInvocationRule(e=命令串, t=ruleContent)`（@7434175）：
  - `t` 以 `:*` 结尾 → 前缀匹配：`e===n || e.startsWith(n+" ") || e.startsWith(n+"\t")`（n=去 `:*` 前缀）——即 `Bash(npm:*)` 语义是"命令 `npm` 或 `npm ...`"。
  - `t` 含其他 `*` → 正则（`Ngt(t)` 编译）。
  - 否则全等。
- **Bash 规则评估** `FSo evaluateBashRules`（@7433761）+ `Pwa createBashPermissionRulePolicy`（@7434507）：复合命令解析（`uE` 拆分、`Dwa` 判定 safe、`Yve` 逐子命令检测、`USo buildInvocationRuleSubjects` 生成 subject 组）。语义：
  - 任一规则无 ruleContent（裸工具名规则）→ 直接放行该评估路径；
  - 非 safe（复杂/不安全命令）→ allow 不可能（需逐条问询）；
  - allow：**每个** subject 组都要有匹配 allow 规则（`every`）；deny/ask：任一匹配即可（`some`）。
- 工具别名：`R4e(t.name)` 生成 matchValues（如 `mcp__node_repl__js` ↔ `js` 族）。
- 钩子覆盖：`nmo`（@5103302）PreToolUse hook `allow`+ask 决策→`{decision:"allow",ruleId:"hook.PreToolUse.allow"}`；hook `ask`+allow 决策→escalate `{ruleId:"hook.PreToolUse.ask"}`。PermissionRequest hook 决策枚举 `allow|deny|escalate|modify`（`modify` 携带 `modifiedInput`，@5102062）。特殊内置：`memory.file.markdown`（memory md 写入直allow）、`zcode:permission-capability:official_cua`（CUA 能力组，`nne`）。

### 3.3 权限模式与持久化

- 模式全集：`gZi=["default","yolo","guarded","plan","edit","acceptEdits","auto","dontAsk","bypassPermissions","autoEdit","build"]`（@748321；`auto` 在集合中但无实现分支——与批次 1-3 结论一致；`acceptEdits`/`dontAsk`/`bypassPermissions` 为别名面）。
- **持久化位置：SQLite 表 `local_setting`**（非文件）。`TRr getProjectPermissionMode` 读 / `IRr saveProjectPermissionMode` 写（@1573483）：
  ```sql
  select value from local_setting where scope=? and scope_id=? and namespace=? and key=?
  insert into local_setting (scope, scope_id, namespace, key, value, schema_version, time, ...)
  ```
  记录：`scope="project", namespace="permission", key="mode", value=JSON {mode}, schemaVersion=1`。
- 规则集作用域：`Smo loadProjectPermissionRuleset`（@5118603）——session 内授权 `scope:"session"` 存 session；否则 `sessionStore.getProjectPermission(projectID)`；`cfa persistProjectPermissionUpdates` 无 sessionStore 时 warn 跳过（不落盘）。
- 沙箱/审批相关：CUA 权限 broker 走 socket+token+authority env（§1.2E）；`resolveToolPermission`(_gt)、`resolveBashPermissionCapability`(Uwa)、`resolveRuntimePermissionCapability`(W4e)；"guarded" 模式下 hook modifiedInput 重写走 `pgt` 净化（@5117486 `i==="guarded"&&(g=pgt(g),c.source==="hook")`）。

## 4. 数值阈值常量表

| 常量 | 值 | 语义 | 摘录 |
| --- | --- | --- | --- |
| `BASH_DEFAULT_TIMEOUT_MS`（无前缀 env） | 默认 120000 | Bash 默认超时 | @（`Ixn`）`t=KSo(e.BASH_DEFAULT_TIMEOUT_MS)??12e4` |
| `BASH_MAX_TIMEOUT_MS`（无前缀 env） | 默认 600000 | Bash 最大超时 `max(default,max)` | 同上 `n=KSo(e.BASH_MAX_TIMEOUT_MS);maxTimeoutMs=Math.max(n??6e5,t)`；`C_t` 取 `min(requested\|\|default, max)` |
| MCP 请求超时 `_mt` | 60000 | MCP client 默认请求超时（`options.timeout` 未给时） | `_mt=6e4`；`defaultTimeoutMs:n?.timeout??_mt` |
| Hook 默认超时 | 60000 | `InMemoryHookRunner.defaultTimeoutMs??6e4`；hooksRoot 可 per-hook `resolvedTimeoutMs`/`resolvedMaxOutputBytes` 覆盖 | @5177727 |
| 模型重试 | maxAttempts 11, base 2000ms, factor 2, max 60000ms, jitter | AI SDK 重试 | `PNe={backoffFactor:2,baseDelayMs:2e3,jitter:!0,maxAttempts:11,maxDelayMs:6e4}` |
| resultBudget（工具结果预算，按工具面分档） | maxInlineBytes：32000（`Qie`/`m6e`，多数工具默认档）、100000（`kK`/`xyt`）、24000（`xbt`/`lbt`/`hbt`）、16000（`qyt`）、4096（`zyt`）、1000000（个别大结果面 `1e6`）、32768（hook 输出字面量档） | 工具结果内联字节预算，超限截断（`truncatedByTokenCap` 等） | `resultBudget:Lyt`/`{maxInlineBytes:1e6}`/`{maxInlineBytes:kK}`...；hook `maxOutputBytes:32768` |
| auto-compact | 阈值非内置常数：compact boundary 记录 `autoCompactThreshold?: int>=0`（事件元数据）；判定 `autoCompactThreshold!==void 0?_n>=o.autoCompactThreshold:void 0`；保护 `autoCompactConsecutiveFailures`；触因枚举 `UserRequested/ContextLimit/ModelDownshift/ProviderOverflow`，phase `StandaloneTurn/PreRequest/MidTurn/Reactive`，summary 来源 `model/session_memory` | 自动压缩 | @（compact boundary schema）`zTr=G.object({boundaryId,trigger:enum([...]),...autoCompactThreshold:G.number().int().nonnegative().optional(),...})` |
| 上下文窗口 | 规则面默认 200000（`contextWindow:200000`，`modelRules` 通配规则）；GLM 特例 1000000（providerSiteRules glm-5.3-flash @opencode zen） | 模型上下文 | provider/zcode-builtin.json |
| 重复工具调用告警 | 阈值 3，每轮预算 3 | `repeatedToolCallWarningThreshold??3, maxBudgetWarningsPerTurn??3` | @（`BOo`） |
| 工作流 | runs 列表 limit ≤50；for-run candidates ≤8 | `ptt=50`、`kgr=8` | §1.2H |
| 进程诊断截断 | prefix `[zcode-process-exception] `，name 128，message 4000，line 131072，stack 16000 | `PRe/mXe/hXe/lcr/gXe` | §1.2H |
| 流式工具输入预览 | eager delta 1、间隔 750ms、最小增量 8192、预算原始输入 8192；文件流间隔 1000ms | `K4c/Z4c/Y4c/X4c/gtn` | §1.2H |
| 插件种子锁 | 超时 60000、stale 接管 15000 | `Src/wrc` | §1.2H |
| 凭据加密 | aes-256-gcm，IV 12B，tag 16B，前缀 `enc:v1:` | `Mso/Nso/Nta/V0n` | §1.2F |
| 内网依赖 | 端口 12345、探针 3850 `/api/intranet/probe`、`studio.zcode-ai.com` | `Ctn/Rbr/Abr` | §1.2A |

## 5. provider/ 配置消费

### 5.1 文件结构（provider/zcode-builtin.json，revision 30）

```
{ schemaVersion:1, revision:30, config:{
    providerConfigRules:{
      templateRules[20]:  {templateId, templateNameMap{zh-CN,en-US}, config{access{type,apiKeyManagementUrl|mode|accountType}, api{type,baseUrl}, builtinModelIds[], logo{type:"builtin",key}}}
      providerRules[8]:   {providerId("account:zai-individual-coding-plan"...), providerName, config{group("zai-family"), builtinModelIds[], access{type:"zhipu-account",mode:"individual-coding-plan",accountType:"zai"}, api{type:"anthropic-messages",baseUrl}, logo}}
    },
    modelConfigRules:{
      modelRules[84]:            {modelMatch(regex), config{enabled,properties{contextWindow,inputFormat,outputFormat,supportsToolCall,...},optionSpecs{maxOutputTokens{max},reasoningLevel{values,map}}}}
      modelApiRules[72]:         {modelMatch, apiTypeMatch("anthropic-messages"...), config{properties{...}}}
      providerSiteRules[52]:     {modelMatch, apiTypeMatch?, baseUrlMatch(regex), config{properties{...}}}
      templateModelRules[244]:   {templateId, modelId, config{enabled}}
      builtinProviderModelRules[26]: {providerId, modelId, config{enabled}}
    } } }
```

5 类模型规则合计 84+72+52+244+26 = **478**（与批次 1-3 一致）；20 模板 + 8 账号计划（providerRules，id 形如 `account:zai-individual-coding-plan`、组 `zai-family`）。templateIds 全集：zai-api, zai-standard-api, bigmodel-api, bigmodel-standard-api, moonshot-kimi, minimax, deepseek, qwen-alibaba-model-studio-cn, qwen-alibaba-model-studio-intl, xiaomi-mimo, openai, anthropic, xai, openrouter, opencode-go-chat, opencode-go-messages, opencode-go-responses, opencode-zen-responses, opencode-zen-messages, opencode-zen-chat。

### 5.2 bundle 消费函数与匹配逻辑

- 解析：`Clr parseZCodeBuiltinProviderConfigRules`（`xlr.parse` → `{providers:Dlr(providerRules), providerTemplates:eGi(templateRules)}`）；`Plr parseZCodeBuiltinModelConfigRules`（`WXe.parse` → `new FA([...五类规则], type:"model"/"model-api"/"provider-site"/"template-model"/"provider-model")`）；`Rlr parsePersonalModelConfigRules`（`VXe.parse`，personal 侧含 `providerModelRules`→type `provider-model`，遗留 `manualProviderModelRules`→`manual-provider-model`，经 `PGi normalizeLegacyManualRules`）。
- 匹配：`FA`（`ModelConfigRules`）`.resolve({providerId,modelId,templateId?,apiType?,baseUrl?})`（@553600）：按数组顺序叠加（`LA.overlay(config)`，后写胜）：
  1. `provider-model`/`manual-provider-model`：`providerId`+`modelId` 全等 → overlay；
  2. `template-model`：`templateId`+`modelId` 全等 → overlay；
  3. 正则类：`sKt(i.modelMatch, t.modelId, /*case-insensitive*/true)` 即 `new RegExp("^(?:"+p+")$","i")` 全串大小写不敏感匹配；`model-api`/`provider-site` 还需 `apiTypeMatch` 命中 `apiType`；`provider-site` 还需 `baseUrlMatch` 命中 `JHi normalizeBaseURLForRuleMatch`（去 query/hash、去尾斜杠）后的 baseUrl；不满足则跳过。
  - 合并：`composeEffective(builtin, personal)` = builtin 全量 + personal 的 provider-model/manual 规则。
- 运行时注入：CLI 侧 `prepareCliProviderRuntimeEnv`(mfs)（@1123773）把 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`（bundled/CDN 路径）与 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`（默认 `<dataBase>/.zcode/v2/provider_config.json`）传给 agent 进程；SEA 打包时用 `SEA_ZCODE_BUILTIN_PROVIDER_CONFIG_ASSET_KEY` 内嵌资产；带 `revision` 的刷新上报（`source=CDN`）。
- 附属表：推理级别遗留映射 `WSr`（`{modelMatch:".*glm-5(?:[.\\-:/\\[].*)?", oldLevel:"off"},{modelMatch:".*GLM-5\\.2...",oldLevel:"nothink"},...glm-4.7...}`，用于旧 reasoningLevel 迁移）。

## 6. 与 Drora 对照要点（供 parity 判断）

1. **配置文件名面完全不同**：官方 `zcode.json` + `.zcode/config.json` + `~/.zcode/cli/config.json` + `~/.zcode/v2/provider_config.json`；无 settings.json 家族、无 managed/policy 层。Drora 的 DRORA_ 键与 `_meta.*` 族在官方 **0 对应**——命名空间映射需按"语义对应"而非"字面量对应"做。
2. **CLAUDE_ 兼容面极小**（7 键，子进程注入双写 + 插件清单形态），不是配置兼容层。
3. **权限模式持久化在 SQLite `local_setting` 表**（scope/namespace/key 四元组），Drora 若用文件/状态所有者需在 spec 记录分歧。
4. **权限规则语法**与 Claude Code 家族一致（`toolName` + 可选 `ruleContent`，`prefix:*`/正则/全等三层），`:*` 前缀匹配包含"裸命令后跟空白"分支；Bash 复合命令按 subject 组 every/some 评估。
5. **无 `auto` 模式实现**（枚举保留）；`escalate`/`modify` 是 hook 决策层概念而非规则 behavior。

## 7. 复现命令

```bash
cd D:/software/zcode/resources/glm
# 全表
grep -o 'ZCODE_[A-Z0-9_]*' zcode.cjs | sort | uniq -c | sort -rn
grep -o 'CLAUDE_[A-Z0-9_]*' zcode.cjs | sort | uniq -c | sort -rn
grep -o '__ZCODE_[A-Z0-9_]*__' zcode.cjs | sort -u
# 单键上下文（off=grep -bo 首命中偏移）
grep -bo 'ZCODE_BASE_URL' zcode.cjs | head -1 | cut -d: -f1   # → OFF
tail -c +$((OFF+1)) zcode.cjs | head -c 400
# 常量定义块 / 导出注册表
tail -c +11300 zcode.cjs | head -c 1500 | tr ',' '\n'
tail -c +1073800 zcode.cjs | head -c 2500
# 配置文件与权限
grep -o '"\.zcode[^"]*"' zcode.cjs | sort | uniq -c | sort -rn
grep -o 'settings\.json' zcode.cjs | wc -l                    # 0
grep -bo 'matchesInvocationRule\|evaluateBashRules' zcode.cjs
grep -bo '"yolo","guarded","plan","edit","acceptEdits","auto","dontAsk","bypassPermissions"' zcode.cjs
grep -bo 'function IRr(\|function TRr(' zcode.cjs             # local_setting 持久化
# provider
node -e "const c=require('./provider/zcode-builtin.json').config; ...counts..."
grep -bo 'function Plr(\|function Clr(' zcode.cjs
```

## 8. 边界与未尽事项

- `ZCODE_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS` 的注册表变量 `att=15e3` 与另一局部 `att=function` 同名（esbuild 作用域重名），15e3 采信度高但建议后续以行为验证。
- resultBudget 分档对应的工具面归属（哪个工具用哪档）未逐条映射，仅记录档位值。
- auto-compact 无内置百分比默认值（阈值来自运行时偏好/会话状态），如需 Drora 对齐应以会话偏好字段为准而非常量。
- `E2E_ASK_USER_QUESTION_CLOCK_SCALE` 的消费函数未展开（仅确认存在与归属 app-runtime-preferences 模块）。
