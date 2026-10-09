# b13-mcp — G1 静态对拍报告（MCP 域）

- 日期：2026-10-08；分支：feat/migrate-remote-and-pet
- 真值：D:\software\zcode\resources\glm\zcode.cjs（0.16.9，14,820,819 B，单行）
- 我方：apps/drora-cli/packages/{core,adapters,bootstrap,contracts} + packages/shared
- 方法：grep -ob 取偏移 + node 按偏移截窗（≤2500B/次）；我方读源码逐函数比对。只读，未改任何代码。

## 总判定

我方 CLI MCP 面是真值 0.16.9 的忠实 1:1 迁移：常量、事件名、函数清单、错误文案逐字一致，
差异仅为系统性重命名（zcode→drora / ZCode→Drora / com.zcode→com.drora）。
未发现行为级 REAL-GAP。

§1 配置面
---------

协议层形状（真值 @741184 Ype ↔ 我方 packages/shared/src/mcp.ts:166 DroraAgentMcpServer）：
- stdio：{name, command, args[], env[{name,value}], isolation?(session|workspace),
  protocolVersion?(legacy|auto|2026-07-28), timeoutMs? >0}（.strict()）——逐字段一致。
- http/sse：{name, type:(http|sse), url, headers[], oauth?, isolation?, protocolVersion?, timeoutMs?}——一致。
- mcp/list 命令：{workspace, mcpServers?: array, mode: connect|status=default connect}
  （真值 @742421 kYe ↔ 我方 droraMcpListParamsSchema + drora-protocol/mcp.ts:78 mode 分支）。
- 状态快照：{status(enum6), transport(stdio|http|sse), toolCount, updatedAt, error?, failureKind?,
  serverRequestId?, protocolEra?(legacy|modern), authorization?{oauth_authorization_code}}
  （真值 @742121 Qir ↔ 我方 drora-protocol/index.ts:687 droraMcpServerStatusSnapshotSchema，逐字段一致）。

作用域：
- session：createSession.mcpServers 数组（真值 @1140184 ↔ 我方 bootstrap session 链路）。
- plugin：manifest.mcpServers + 插件根 .mcp.json 合并、`plugin:<id>:<key>` 命名空间、
  "path escapes plugin root" 诊断（真值 gre/Pat @4140111 ↔ 我方 adapters/src/plugins/mcp.ts:84）。
- user/project：CLI storage + config.mcp.servers 合并序
  {...pluginMcpServers, explicitSession || config.mcp.servers}
  （真值 @14547730 ↔ 我方 drora-protocol/mcp.ts:59-69，含 Xxt=protocolMcpServersToRuntimeMcpConfig、
  Wkt=resolveStartupPlugins、Zwt=resolveTrustedOfficialCuaServerNames、Ywt=omitMcpServers、Dje=listMcpServerStatuses 全部同名对应）。
- project untrusted 门：双方均为空 Set + 保留 "Project MCP server requires explicit connection
  before use."（真值 @13856656 ↔ 我方 bootstrap/src/mcp-config.ts:211）——同构死代码，非缺口。
- 遗留 http_headers 兼容：真值 4 hits ↔ 我方 getMcpServerRequestHeaders（shared/mcp.ts:206）。

热重载：双方均无 MCP 配置文件 watch；以 mcp/list 的 revalidate:true 重探测代替
（真值 revalidate 7 hits ↔ 我方 pool.ts:111 revalidateEntry）。parity（均无）。

§2 池化与生命周期
-----------------

- createMcpConnectionPool 1:1（真值 emn @4720215 ↔ 我方 adapters/src/mcp/pool.ts）：
  closeEntry/scheduleClose/revalidateEntry/lease refs、事件名
  mcp.pool.connection.{closed,created,close.failed,revalidated,stale}、
  mcp.pool.lease.{acquired,released} 逐字一致。
- 空闲回收默认 30s：真值 gHs=3e4（@4726536）↔ 我方 pool.ts:16 DEFAULT_IDLE_GRACE_MS=30_000；timer.unref 一致。
- connectionKey = [serverName, scope(leaseId|workspaceKey), stableStringify(config)]，workspaceKey =
  workspaceIdentity?.trim() || workingDirectory（真值 yHs/zeo ↔ 我方 pool.ts:435-453，含注释级同源语义）。
- adapter 层 connectConfiguredServers replace 收敛 + OAuth 共享连接等待（waitForSharedConnection，
  isDeepStrictEqual(config) 门）（真值 @4765230 ↔ 我方 index.ts:241-299）。
- 失败恢复：调用前 disconnected 重连、裸 "Not connected" 单次重试（reconnectForCall）、
  运行期 OAuth Phase2→Phase1 恢复（recoverToolCallAuthorization）——真值 3/6/2 hits ↔ 我方 index.ts:455-524/768。一致。
- deactivate 清理：session closeMcp→port.close()（真值 closeMcp 1 hit ↔ 我方 session-facade.ts:301,591）。
- 传输：ProcessTreeStdioClientTransport（requestMetaProvider/mergeRequestMeta/windowsJobObjectFactory/
  lastProcessExit/processAlive/_dispose）逐字同构（真值 @4753858 ↔ 我方 stdio-transport.ts）；
  http=StreamableHTTPClientTransport、sse=SSEClientTransport + createMcpTransportFetch、
  buildMcpStdioEnv 链序 filterStringEnv→sanitize*RuntimeEnv→applyNetworkEgressEnv→prependRunningNodeDirectory
  （真值 jeo @4718765 ↔ 我方 network.ts:9-15）。

§3 工具桥
---------

- 命名：`mcp__{server}__{tool}` + [^a-zA-Z0-9_-]→_ 归并 + "unknown" 兜底；
  matchesModelVisibleMcpServerName 含 includes 宽匹配（真值 g4/zB/PSo @12566674 ↔ 我方 core/mcp/name.ts）。
- registerMcpTools：MCP_TOOL_TIMEOUT_MS=3e4、capability group "official_cua"、
  规范名 "mcp__computer-use__" / provider 别名 "mcp__computer_use__"、CUA title schema
  （minLength1/maxLength120/同文案）逐字一致（真值 ava/cva/Iwn/uva/lva @12572786 ↔ 我方 core/mcp/index.ts:37-47）。
- 注册入口：allowedTools/disallowedTools/officialCuaServerNames 三参 +
  computeOfficialCuaServerNames(servers, config.trustedOfficialCuaServerNames)（真值 @12909566 ↔
  我方 core/src/runtime/methods/mcp.ts:17,141 与 subagent.ts:149）。
- descriptor 归一化：normalizeMcpToolDescriptor/normalizeAnnotations（真值 @4711467 ↔ 我方 descriptor.ts）。
- schema bridge：normalizeInputSchema / createModelFacingMcpInputSchema（CUA title 叠加必填再剥离）
  与 McpToolOutputJsonSchema 逐字段一致（真值 hva/gva/mva ↔ 我方 core/mcp/index.ts:278-344）。
  历史 bridge.ts:77 缺口：当前两侧该函数均为"properties 非对象→{}、type 强制 object"，未见缺口残留。
- 结果整形：resultBudget 普通 100KB/50KB、官方 CUA 256KB、node_repl artifact 1MB/64KB tail、
  normalizeMcpToolResultForModel、formatMcpToolResult（structuredContent 空键保留、
  errorPresentation=message-only 时不再包 "MCP tool returned an error"）——真值同名函数全套（@12572786 区段）一致。
- 超时：工具默认 30s、resetTimeoutOnProgress:true、session OAuth 等待 15s（Sxa=15e3 ↔
  我方 core/src/runtime/methods/mcp.ts:11）、mcp/list OAuth 轮询 5s（tQa=5e3 ↔ drora-protocol/mcp.ts:27）。
- resources/prompts 面：双方 McpPort 均不投影 resources/prompts（真值与我方仅 SDK 内部
  "prompts/list","resources/list" 字面量，宿主无 listResources/listPrompts 调用）。parity（均缺）。

§4 错误映射
-----------

- -32002/-32042 属内联 SDK 层，宿主双方均不二次映射：
  - buildSchemas2026.encodeErrorCode e===-32002→-32602（真值 @4416802 ↔ 我方
    node_modules/@modelcontextprotocol/client 2.0.0 src-D_zzAWoS.mjs 同代支持：-32002×9、-32042×1、2026-07-28×69）。
  - ProtocolErrorCode ResourceNotFound=-32002 / UrlElicitationRequired=-32042（真值 @4410227 附近；
    我方 node-repl-host bundled copy 同源）。
  - 2026-07-28 RequestMetaEnvelopeSchema 入站校验（真值 @4382637/@4414898）与我方 SDK 同代。
- failureKind 19 值枚举逐字一致（真值 Yir @742121 ↔ 我方 packages/shared/src/drora-protocol/index.ts:664）。
- failConnection 分类链：official_origin_untrusted→connectionDiagnosticByServer→
  (McpTimeout&&非tool_list_failed→connection_timeout)→connection_failed；错误文案拼
  `${message} - ${serverRequestId}`（真值 @4783286 ↔ 我方 index.ts:1360-1382）。一致。
- 工具调用错误形状：{content[], structuredContent?, isError?, _meta?}；
  in-band 失败（HTTP200+isError）按 span 回填 x-request-id 到 _meta（§5）；
  官方工具错误码 OFFICIAL_MCP_TOOL_ERROR_CODES=[quota_exceeded, coding_plan_required]
  （真值 @1006330 ↔ 我方 packages/shared/src/official-mcp-tool-error.ts:20）。一致。
- meta 键重命名（有意）：zcode/errorPresentation↔drora/errorPresentation、
  zcode/officialMcpServerRequestId↔drora/officialMcpServerRequestId、
  com.zcode/request-context↔com.drora/request-context、com.zcode/official-mcp-auth↔com.drora/official-mcp-auth。
  本仓库 bundled agent（packages/desktop/bundled-agents/.../node-repl-host）已全部用 drora/*，无跨进程错配。

§5 serverRequestId 透传链（live 残叶复核）
------------------------------------------

结论：非残叶，真值同构存在，链路完整：
1. auth fetch wrapper 读响应头 x-request-id → rememberServerResponse（span 键、容量 64、
   后写覆盖、即取即删不兜底）——真值 serverRequestIdBySpan/yGs=64 @4770065 ↔ 我方 index.ts:102,217-562。
2. in-band isError → takeServerRequestId(spanId) → _meta["drora/officialMcpServerRequestId"]
   仅失败附加（真值 @4770815 ↔ 我方 index.ts:711-740）。
3. 连接期诊断 → status.serverRequestId（真值 Qir @742421 ↔ 我方 mcp.port.ts:119 + index.ts:1730-1744）。

§6 差集三分类表
---------------

| # | 分类 | 级别 | 项 | 真值证据 | 我方证据 |
|---|------|------|----|----------|----------|
| 1 | SHAPE-DIFF | P3 | 系统重命名 zcode→drora：meta 键、clientName 默认值（"zcode"→"drora"，OAuth clientName `${clientName}-${serverName}` 随之变化）、resolveZCodeApiOrigin→resolveDroraApiOrigin、SharedZCodeCredentialStore→SharedDroraCredentialStore | @4764700 clientName??"zcode"；grep com.zcode/* | index.ts:226 "drora"；contracts:135-159 |
| 2 | EXTRA | P3 | shared/mcp.ts McpServerConfig 含 Linear/Figma/Sentry 专属字段注释（personalAccessToken/apiEndpoint/issueType/organizationName 等），真值 CLI 无 | grep personalAccessToken=0 | packages/shared/src/mcp.ts:33-46；仅 desktop 共享层，不进 CLI runtime contracts 类型，无行为影响 |
| 3 | REAL-GAP | — | 探查面（配置形状/作用域/池/传输/工具桥/schema/错误码/requestId）未发现 | — | — |

计数：REAL-GAP 0 / EXTRA 1 / SHAPE-DIFF 1。P1=0，P2=0。

§7 OPEN-QUESTION
----------------

1. SDK 构建差异：我方 npm @modelcontextprotocol/client 2.0.0 中 -32002×9 / UrlElicitationRequired×8，
   真值内联 SDK 为 -32002×3 / UrlElicitationRequired×6——疑似同代不同构建（枚举重复度不同），
   宿主可观察行为未见差异，静态无法确认字节级一致。
2. bundled node-repl-host（packages/desktop/bundled-agents）携带 drora/nodeReplEmittedImage、
   drora/toolSurface，真值 0.16.9 无对应串——bundled agent 与 0.16.9 的版本领先/落后关系未定。
3. 历史"bridge.ts:77 缺口 / http-sse 半接线 / serverRequestId live 残叶"三条基线：
   当前两侧源码均呈闭合/同构态（§3/§5），本 pass 静态证据无法判断其他分支是否仍有残留。
4. contracts mcp.port.ts:155 注释提及 Go 侧键 com.drora/mcp-unavailable（真值 0 hits）——
   仅注释引用，非代码路径；若该键已废弃建议后续清理注释（不属本 pass 改动范围）。
