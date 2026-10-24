# 官方插件同步（2026-10）：office 四插件 + office-runtime

状态：**已实施（2026-10-24，规划经一轮评审修订）**。修订记录：v2 修正 spreadsheets 官方证据（官方 0.2.1 对 spreadsheets 同样 lockstep 落地 mux+isolation，v1 的"仅清单变化、dist 无运行时漂移"系任务背景转述失实，已实测推翻）；登记 spreadsheets 两份清单的工作树预改状态；验收口径收窄为"仅对齐 isolation 键与双版本号"。实施结果（2026-10-24 实测）：office-runtime 包内 `pnpm typecheck` exit 0（含 xlsx.ts:202 显式标注）、`pnpm test` **16 文件 / 81 用例全绿**（基线 14/69 + sessions.test 9 + server.test 2 + files.test 1）；四插件清单终态经临时脚本逐字段核对通过（spreadsheets 为预改核对，本轮未编辑其文件）；接线用例经变异验证有效（临时破坏 `begin_file_import` 归属 → 用例失败 → 还原）；§5 loader 透传经三方对照定谳为与上游一致、原 blocker 撤销（详见 §5.1）。本文是 office 组本次同步的唯一实施依据；改动全部留在工作树，不提交。官方参考物（只读）：`D:/software/ZCode/resources/glm/packages/`（下称"官方新包"）；官方缓存包 `C:/Users/A/.zcode/cli/plugins/cache/zcode-plugins-official/`（下称"官方缓存包"，注意：其中 plugin.json 已被官方客户端在安装期重写为宿主启动形态，与官方新包的源形态不同层，见 §7.2-2）；官方旧版对照基线 `C:/Users/A/.zcode/cli/plugins/cache/zcode-plugins-official/pdf/0.2.1/`（下称"官方旧版"）。zcode-cua-plugin（0.6.3→0.6.5）的 producer 收编属 producer 组范围，不在本文（见 §10 范围边界）。

总目标：把官方 0.2.0→0.2.1/0.2.2 一轮的 office 插件差距同步进本仓——四个 office 插件清单补 `isolation:"workspace"` 并对齐版本号；office-runtime 按官方契约把查看器从"单实例"升级为"按 `_meta.session_id` 的会话多路复用"（LRU 上限 32、逐出提示文案、导入配额按会话计、load 令牌随会话释放）；附带处理 xlsx.ts:202 门禁基线。行为改动先落本文，再动代码。

## 1. 基线（开工前实测，2026-10-24）

| 项 | 命令（office-runtime 包内） | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | exit 0，**xlsx.ts:202 TS7006 不可复现**（依赖补装后 exceljs 类型齐全，`eachCell` 回调签名已带类型；见 §8） |
| 单测 | `pnpm test` | 14 文件 / 69 用例全绿，1.16s |
| 根 typecheck / lint | 由脚本开工时统一实测记录 | 本组不重复跑 |

工作树预改登记（2026-10-24 `git status --porcelain` + `git diff` 实证）：`apps/drora-cli/packages/spreadsheets-plugin/.zcode-plugin/plugin.json` 与 `package.json` 已在先前批次改为 0.2.1 并加 `"isolation": "workspace"`（四份清单中唯一已改的一份；diff 与本文 §3.2 目标状态一致）。本组实施时**不再改动**这两份文件，仅按 §7.2 核对终态；其余三插件清单与 office-runtime 源码均无未提交改动。

官方 dist 比对方法：官方 dist 为压缩产物，用 `rg -n` 与 node 单行脚本按行号切片定位，不做整读；旧版对照用 `String.includes` 级差分。

## 2. 官方变化盘点（证据）

### 2.1 清单：isolation 键 + 版本号（四插件）

官方四包 `.zcode-plugin/plugin.json` 的 `mcpServers.<name>` 均新增 `"isolation": "workspace"`，且 `plugin.json` 与 `package.json` 版本同步递增。**spreadsheets 并非仅清单变化**：官方缓存包实测（node 单行脚本，2026-10-24）——0.2.0 的 `dist/server.mjs` 无 `MAX_SESSIONS`（0 命中）无 `sessionOf`、`plugin.json` 无 isolation；0.2.1 的 `dist/server.mjs` 含 `MAX_SESSIONS`（首现 :65911）与 `sessionOf`（:78638）、`plugin.json` 有 isolation；官方新包 spreadsheets dist 与缓存 0.2.1 逐字节一致（`stat -c %s` 实测均 **2959190**，`sha256sum` 同为 `719f135c92ee22e437ffd161193769cef12672b4c3beeb92310d903a49d080cd`）。即官方这一轮对 spreadsheets 同样 lockstep 落地了 mux+isolation，与 §2.3 一致。

| 插件 | 官方版本 | isolation 证据 | 我方当前 |
| --- | --- | --- | --- |
| documents | 0.2.0→**0.2.1** | documents-plugin/.zcode-plugin/plugin.json mcpServers.documents | 0.2.0，无 isolation |
| presentations | 0.2.0→**0.2.1** | presentations-plugin/.zcode-plugin/plugin.json mcpServers.presentations | 0.2.0，无 isolation |
| pdf | 0.2.1→**0.2.2** | pdf-plugin/.zcode-plugin/plugin.json:24（任务给定证据，已核对） | 0.2.1，无 isolation |
| spreadsheets | 0.2.0→**0.2.1** | spreadsheets-plugin/.zcode-plugin/plugin.json mcpServers.spreadsheets；dist 同轮 lockstep 升级（见上） | **两份清单已在工作树预改为 0.2.1 + isolation**（来源：先前批次，登记见 §1；实施不再改动） |

版本对齐语义：`scripts/build.mjs`（office-runtime）读插件 `package.json` 的 `version` 写入 PROFILE → dist 的 `PLUGIN_VERSION`/`SERVER_NAME`（MCP server 上报版本），所以两份清单都要改。

### 2.2 运行时：查看器会话多路复用（四插件同源）

官方旧版（pdf 0.2.1）dist 无 `MAX_SESSIONS`/`sessionOf`/`root_session_id`/`viewer session was reset`（`String.includes` 全部 false；spreadsheets 0.2.0 缓存包同测 0 命中）；新版（pdf 0.2.2 / spreadsheets 0.2.1）全部存在——该轮运行时变化就是多会话，四插件同源落地。官方逻辑内嵌于 dist（源码注释保留），以下行号取自官方新包 presentations-plugin/dist/server.mjs（四包同源；pdf 与 spreadsheets 已抽查：spreadsheets 的 `MAX_SESSIONS` 首现 :65911、`sessionOf` :78638，与 presentations 对应段一致）：

1. **会话键解析** `sessionOf(meta)`（:56391-56395）：优先 `meta.root_session_id`，其次 `meta.session_id`，均须非空字符串，否则 `undefined`。
2. **register 包装器**（:56406-56420）：工具回调签名变为 `(input, extra)`，每次执行先 `owner.session(sessionOf(extra._meta))` 解析出会话对象再交给 execute。
3. **会话状态** `createSession(id)`（:43694-43833）：每会话独立持有 `current`（查看器当前文档）、`views`/`reports`（用户上报视图）、`tokens`（本会话 load 令牌）、`sequence`/`revealSeq`、`disposed` 标志；`info/open/show/read/search/load/report/views/releaseView/view/current/snapshot/close/list` 全部下沉到会话。
4. **LRU**（:43656-43657, :43839-43851）：`MAX_SESSIONS = 32`、`DEFAULT_SESSION = "default"`；`session(id)` 对 Map 做 delete+set 触碰刷新，超过 32 个逐出最旧并 `dispose()`。无 `_meta` 会话键的调用共享 default 会话（兼容直连 stdio 的旧客户端）。
5. **逐出提示文案**：会话被逐出后 `load()` 抛 `invalid_token`，文案 `"This viewer session was reset; reload the document."`（:43775-43779）；令牌失效仍为 `"This file handle expired; reload the document."`。
6. **load 令牌随会话释放**（:43780-43783, :43827-43831）：`MAX_HANDLES = 4` 从全局上限改为**每会话**上限；`dispose()` 把本会话全部令牌从全局 `handles` 表删除。
7. **chunk 尾块即释放**（:43863）：读完最后一块（`start + FILE_CHUNK_BYTES >= bytes.byteLength`）即 `handles.delete(token)`，不再等 LRU 淘汰。chunk 路由本身保持 owner 级（令牌全局唯一，无需会话键，:56755-56768）。
8. **导入配额按会话计**（files.ts，:44117-44131）：`begin(name, size, owner = "default")`，`MAX_IMPORTS = 4` 从全局改为**按 owner（会话键）**计数；上传记录携带 `owner`。chunk/finish/cancel 仍按导入 id 操作，无需会话键。
9. **共享不变**：解析缓存（`MAX_CACHED = 6`，按 path+fingerprint）与会话无关，继续进程级共享——文档是工作区文件，同一进程内跨会话共享解析结果安全。

### 2.3 官方为何现在加 isolation

`isolation:"workspace"` 让宿主按工作区（而非按会话）复用一个 server 进程：同一 workspace 的多个 agent 会话共享同一 stdio server，于是查看器状态必须按 `_meta.session_id` 分桶，否则互相覆盖。官方在同一轮 lockstep 落地（清单键 + server mux），本仓同样必须成对落地。

## 3. 我方落点

### 3.1 office-runtime：会话多路复用（本组主体）

现状（单实例模型，`src/app/documents.ts:34-242`）：`createDocumentOwner` 单例持有 `current`/`views`/`reports`/`handles`（全局 MAX_HANDLES=4，`documents.ts:26-27,171`），导入配额全局 4（`src/adapters/files.ts:162,237`），server 工具直接调 `owner.*`（`src/adapters/server.ts:184,205,231,270,289-329,409,423,437,450,472,486`）。

改动（文件与映射，逐行为官方 0.2.2 等价，中文注释标注官方版本+文件+行号）：

| 文件 | 改动 |
| --- | --- |
| `src/app/documents.ts` | 增 `MAX_SESSIONS=32`、`DEFAULT_SESSION="default"`；`createSession(id)` 承接现 return 对象（current/views/reports/tokens/sequence/revealSeq/disposed）；`load()` 加 `disposed` 检查与官方逐出文案；令牌上限改每会话 `tokens` 数组；`dispose()` 释放本会话令牌；owner 顶层只留 `session(id)`（LRU+逐出）与 `chunk(token,index)`（含尾块释放）。解析缓存保持共享。 |
| `src/adapters/files.ts` | `createDocumentImporter` 的 `begin(name, size, owner = "default")`：`uploads` 记录 `owner`，准入按同 owner 计数 `MAX_IMPORTS=4`；sweep/close 语义不变。 |
| `src/adapters/server.ts` | 增 `sessionOf(meta)`（root_session_id → session_id → undefined，导出供单测）；register 包装器改为 `(input, extra) => execute(input, owner.session(sessionOf(extra._meta)))`；全部工具的 `owner.*` 换成 `session.*`；`begin_file_import` 传 `session.id`；`chunk` 资源保持 `owner.chunk`。 |

接线可行性（已核实）：MCP SDK 1.29.0 工具回调第二参 `extra` 携带 `_meta`（`node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.d.ts:173-189`）；`sessionOf` 取到的 `session_id` 由宿主生产——模型调用 `adapters/src/mcp/index.ts:2303-2326`（`mcpRequestMeta` 把 `trace.sessionId` 写进 `_meta.session_id`，:1162-1168 附着到 callTool）；面板调用经 `bootstrap/src/app/session-facade.ts:471-527`（`callMcpToolForUi` 携带同一 `trace: deps.traceContext`，`TraceContext.sessionId` 契约见 `contracts/src/tracing/tracer.ts:20`）走同一条 `_meta` 链。同一 agent 会话的模型调用与面板调用路由到同一查看器会话。

### 3.2 四份清单：isolation + 版本（本组）

逐插件改两份文件（保持 DRORA_* 改名豁免，不引入 ZCODE 字面量）：

```text
apps/drora-cli/packages/<name>-plugin/.zcode-plugin/plugin.json
  - "version" 按对齐表递增
  - mcpServers.<name> 增加 "isolation": "workspace"
apps/drora-cli/packages/<name>-plugin/package.json
  - "version" 同步递增（build.mjs 读它生成 dist PLUGIN_VERSION）
```

不加分隔注释（JSON）；文档插件 dist 由打包管线生成，本组不改 dist。**spreadsheets 两份清单已在工作树预改至目标状态（§1 登记），实施跳过编辑、仅核对**；实施对象是 documents/presentations/pdf 三插件共六份清单文件。

### 3.3 附带：xlsx.ts:202 门禁标注（本组）

`src/adapters/parse/xlsx.ts:202` 的 `row.eachCell(..., (cell, c) => ...)` 参数补显式类型 `(cell: ExcelJS.Cell, c: number)`（`ExcelJS` 已在文件头导入，:1）。注释如实写明：属门禁修复范围；基线红 TS7006 在 office-runtime 依赖补装后不可复现（exceljs `index.d.ts:586` 回调签名自带类型，2026-10-24 `pnpm typecheck` exit 0），此处显式标注防类型环境变化回归。无行为改动。

### 3.4 契约文档更新（本组）

`src/CONTRACT.md` 的 "Viewer state … One per server process" 与 "Tokens … expire after newer loads" 两句改为会话模型表述（32 会话 LRU、逐出重载提示、令牌随会话释放、导入配额按会话）。

## 4. 多会话模型：状态所有者与事件顺序

**唯一所有者：`DocumentOwner`（进程级单例）**。它持有两张进程级表（解析缓存 `cache`、令牌表 `handles`）和一张会话表 `sessions`；每会话状态（current/views/reports/tokens）只存在于其 `SessionState` 内。server 工具与面板都不直接触碰这些表。

```text
                       ┌──────────────────── DocumentOwner（进程级所有者）────────────────────┐
                       │  cache: Map<path, Entry>      （共享，fingerprint 失效，MAX_CACHED=6）│
                       │  handles: Map<token, bytes>   （令牌全局唯一，chunk 按 token 读）      │
                       │  sessions: Map<id, SessionState>（LRU，MAX_SESSIONS=32）             │
                       └──────────────────────────────┬──────────────────────────────────┘
                                                      │ session(id)  每次工具执行解析一次
      _meta.session_id（host 产出）                    │
A(agent 会话 S1) ── open/show/read ──┐                ▼
A(agent 会话 S2) ── open/show/read ──┤   sessionOf: root_session_id → session_id → default
P(面板, trace=同一 S1) ── load/report ┘                │
                                                      ▼
                                   SessionState(S1)：current / views / reports / tokens(≤4) / disposed
```

事件顺序（关键不变量）：

1. 每次工具执行开始：`session(id)` 命中即 LRU 触碰（delete+set），未命中即建；随后执行落到该 SessionState。
2. `load()`：先解析文档（可能慢，await 期间可能被逐出），**拿到 bytes 后**检查 `disposed` —— 逐出则会话的 load 抛 `invalid_token`（官方逐出文案），不给新令牌；未逐出则发令牌入本会话 `tokens`，超 4 淘汰本会话最旧令牌（只影响本会话，不跨会话挤占）。
3. `chunk(token)`：owner 级，令牌存在即读（含逐出会话遗留的在途读，直到尾块或 dispose 删表）；读尾块即删 handle；令牌缺失抛既有 `invalid_token` 文案。
4. 逐出（第 33 个会话加入或 LRU 重排后超限）：`dropped.dispose()` 先置 `disposed`、再从 `handles` 删本会话全部令牌；**不取消该会话在途请求**——在途 load 以 `invalid_token` 拒绝收尾，在途 read/open 等只读调用照常完成（结果对该调用仍正确，仅状态不再可见），在途 report 写入已分离对象、不复活会话（沿用 `reports` ticket 幂等，`documents.ts:200-218` 语义平移）。
5. 导入：`begin` 按调用时会话键计数准入；逐出不回收已开始的导入（sweep 按空闲超时回收，`files.ts:208-225` 不变）。
6. 无 `_meta` 会话键的调用（直连 stdio、smoke/e2e 脚本）全部落 `default` 会话——**在总会话数 ≤ 32 时**与今天的单实例等价。default 也是 LRU 成员：第 33 个会话加入可把 default 逐出，直连客户端的查看器状态被重置（下次 load 抛逐出文案、可重载恢复）。这是官方同构行为，不是分歧；后续按"default 永久等价"排障会被误导。

宿主连接语义（已支持，`adapters/src/mcp/pool.ts:532,553-556`）：`isolation:"workspace"` → 连接键按工作区复用进程；缺省 `session` → 每会话独立进程（今天的形态，天然无跨会话干扰）。两条链路下本模型都正确：workspace 复用时靠会话分桶；session 独占时每进程实际只有 default + 本会话两个桶。

## 5. 主机侧依赖与缺口（三方对照定谳：与上游一致）

契约与连接池已支持 `isolation` 键（`contracts/src/interfaces/mcp.port.ts:10,20`；`adapters/src/mcp/pool.ts:532`；`adapters/src/mcp/telemetry.ts:63`；protocol/DTO 透传 `packages/shared/src/mcp.ts:318,341`、`bootstrap/src/drora-protocol/protocol-mcp-config.ts:23,38`）。

**但插件清单 loader 会丢弃该键**：四插件清单经 `adapters/src/plugins/mcp.ts` 的 `resolveMcpServerConfig`（stdio 分支 :231-252、http 分支 :287-293）逐字段重建 `McpServerConfig`，`baseConfig`（:186-193）只读 alwaysLoad/enabled/timeoutMs/source，**未读 `server.isolation`**（全目录 grep 零命中）。因此只改清单不生效：四插件继续按缺省 `session` isolation 每会话一个进程，新 mux 全部落 default 兜底路径（行为安全）。

### 5.1 三方对照定谳（2026-10-24，应用户质询"上游开源版是否也一样"）

| 对照面 | 证据 | 结论 |
| --- | --- | --- |
| 上游开源 zai-org/ZCode main（GitHub raw，2026-10-24 拉取）`apps/zcode-cli/packages/adapters/src/plugins/mcp.ts` | 全文无 isolation：loader 只读 type/command/args/cwd/env/url/headers/auth/oauth/alwaysLoad/enabled/timeoutMs/source，手写校验（isRecord/requireString），无 zod | **上游开源 loader 同样不读清单 isolation** |
| 上游开源 v3.16.1 同代快照（zcode-src-20260922）与本仓 `adapters/src/mcp/pool.ts` | pool.ts `input.config.isolation === "workspace"` 才允许跨 session 复用（默认 session，仅无状态 server），遥测带 `mcp_isolation`；我方 pool.ts:532,553-556 逐字还原在位 | 池层语义上游早已有、我方已在位；其输入是**用户级 MCP 配置**的 `config.isolation`，不是插件清单 |
| 官方发行桌面 bundle（`D:/software/ZCode/resources/app/out`，新于 v3.16.1） | isolation 仅两处：`host/chunk-5YNPFY3L.js` zod 枚举 `e.enum(["session","workspace"])`（清单验证 + 遥测事件 schema `mcpInstanceId/mcpIsolation/mcpSource`）与 `main/index.js:1344` 遥测映射 `mcp_isolation:e.mcpIsolation`；host/main/scheduler 全目录无任何行为分支（无 `isolation==="workspace"` 比较、未参与实例键） | **官方发行版对清单 isolation 同样只做验证 + 遥测，行为接线未完成** |

**定谳**：清单→池的透传在官方当前全部可见代码（开源 main + 发行 bundle）均未接通——这是官方尚未完成的设计意图，不是本仓差距。我方 loader 不读该键与上游行为**一致**，维持现状；原"待宿主组 blocker"撤销。

**替换条件（官方接通后跟进）**：当上游 loader 开始透传清单 isolation，或官方宿主出现按 isolation 的实例池行为分支时，本仓跟进：① loader `baseConfig` 一行透传（`isolation: isMcpIsolation(server.isolation) ? server.isolation : undefined` 级别）；② 验证池 workspace 复用路径下的会话分桶（本 spec §4 的 mux 模型在该路径已正确，回归用例见 §7.1）。危险顺序提醒仍有效：透传必须与 server mux 成对落地——mux 已在本轮落地，该风险已消除。

## 6. 版本对齐表（实施后应满足）

| 包 | plugin.json version | package.json version | isolation | 备注 |
| --- | --- | --- | --- | --- |
| documents-plugin | 0.2.1 | 0.2.1 | workspace | 本组实施改清单；运行时 mux 同步升级 |
| presentations-plugin | 0.2.1 | 0.2.1 | workspace | 同上 |
| pdf-plugin | 0.2.2 | 0.2.2 | workspace | 同上 |
| spreadsheets-plugin | 0.2.1 | 0.2.1 | workspace | **两份清单已在工作树预改**（§1）；共享运行时随 office-runtime 重建同源获得 mux，与官方同构（官方 0.2.1 dist 同样 lockstep 落地，§2.1 实测证据） |
| office-runtime | 0.2.0（不变） | — | — | 私有 workspace 包，官方同位包亦不随插件升版 |

## 7. 测试与验收

### 7.1 vitest 单测（落点与现有风格一致：裸 `it`/`expect`，fixtures 目录用 `office-runtime/fixtures`）

| 文件 | 用例 |
| --- | --- |
| `src/app/sessions.test.ts`（新） | ① 路由隔离：`session("a")` 与 `session("b")` 状态互不覆盖（a open 后 b 的 current 仍空，`view`/`views` 分桶）；② 无键落 default：`session(undefined)`、`session("")` 与 `session("default")` 同一对象；③ LRU：填满 32 后再入触发逐出，且触碰过的最旧会话不先逐出（delete+set 顺序）；④ 逐出释放令牌：被逐会话 load 出的 token 随 dispose 失效（`chunk` 抛既有 invalid_token 文案），同键重入得全新会话可重载恢复；⑤ 逐出后在途 load：解析 await 期间被逐出 → 完成后抛官方逐出文案；⑥ 逐出后在途 report 不复活会话、不崩；⑦ 每会话令牌上限：会话 A 压满 5 个 load 只淘汰 A 自己最旧令牌，会话 B 的令牌不受影响（防跨会话挤占回归）；⑧ chunk 尾块释放：读完最后一块后再读同 token 抛 invalid_token（对齐官方 :43863），并覆盖多块文件非尾块读后令牌仍在；⑨ default 会话可被逐出：无键调用的"与单实例等价"仅在会话总数 ≤ 32 时成立（§4#6），逐出后 default 状态重置、遗留令牌失效。 |
| `src/adapters/files.test.ts`（扩展） | 按 owner 配额：owner A 满 4 后 A 的第 5 个 begin 拒绝、owner B 的 begin 成功（现有"5 并发 4 过 1 拒"用例保持全 default 语义不变，`files.test.ts:45-60`）。 |
| `src/adapters/server.test.ts`（新） | ① `sessionOf` 纯函数：root_session_id 优先于 session_id、空串/非字符串跳过、缺省返回 undefined。② **server 级接线用例**（评审补充，防接线滑失）：经 SDK `InMemoryTransport.createLinkedPair()`（`@modelcontextprotocol/sdk/dist/esm/inMemory.js`，本包 devDep 1.29.0 已实证导出）连接 `createOfficeServer` 产物与 SDK Client，伪造 `_meta.session_id` 调 `open_document`/`load_document`，断言不同 session_id 的查看器状态分桶；`begin_file_import` 断言导入归属调用会话（若接线漏传 `session.id`，配额会全部落 default——该滑失只有此用例能抓住）。 |
| `src/app/views.test.ts`（实施适配） | 原有两个用例语义不变，仅改为经 `owner.session()` 访问（viewer 状态下沉会话后 owner 顶层不再直接暴露 report/views）；实施时随 §3.1 API 变化一并调整，不计入新增场景。 |

### 7.2 验收

1. office-runtime 包内 `pnpm typecheck`、`pnpm test` 全绿（现有 69 用例不回退 + 新增用例通过）。
2. 四插件清单对齐验收**只看本轮目标字段**：`isolation` 键存在且为 `"workspace"`、`plugin.json` 与 `package.json` 双版本号等于 §6 对齐表。**command/args/env 等既有部署形态差异按现状保留、不对齐**：官方缓存包 plugin.json 已被官方客户端在安装期重写为宿主启动形态（实测 pdf 0.2.2 缓存包：`command = ZCode.exe + zcode.cjs __zcode-plugin-host <server.mjs>`，env 含 `ELECTRON_RUN_AS_NODE`/`ZCODE_PLUGIN_ID`），而本仓源清单为 `node ${DRORA_PLUGIN_ROOT}/dist/server.mjs` + `DRORA_WORKSPACE_ROOT`——这层差异属分发形态：本仓 seed 期由 `bootstrap/src/app/official-plugin-runtime.ts` 产出同构的宿主形态（process.execPath + `__drora-plugin-host` + ELECTRON_RUN_AS_NODE + DRORA_PLUGIN_ID），对照时必须与官方**源形态**（glm/packages）比、不得与官方**缓存重写形态**比。spreadsheets 两份清单已在工作树预改至目标状态（§1），验收按"已预满足、来源先前批次"登记，不再编辑。除上述目标字段外与官方源形态的既有差异（描述品牌字段、`${ZCODE_*}`→`${DRORA_*}` 改名豁免、既有 env 键名）逐条维持现状；本轮新增字面量仅 `isolation`。
3. 每插件 `pnpm build`（office-runtime build.mjs）成功，dist `PLUGIN_VERSION` 等于新版本号；`smoke.mjs` 通过（无 `_meta` 直连路径 = default 会话可用）。
4. 仓库级门禁（root typecheck、oxlint、架构检查、新增测试）由脚本统一跑，本组不重复。
5. **E2E 延后**：真实"双会话共享一个 workspace 进程"的桌面 E2E 依赖 §5 blocker（loader 透传）先行落地才有被测对象，本轮明确不做；以 §7.1 单测覆盖 mux 语义，E2E 场景随 host 组批次补。

## 8. 已知差异与有意分歧（登记）

1. **root_session_id 无生产方**：`sessionOf` 按官方实现支持 root 优先，但本仓 host 当前不生产 `root_session_id`（全仓 grep 零命中），子代理调用将以自身会话键分桶，而非并入根会话查看器。登记为已知差异；host 侧补生产属宿主组后续演进，不在本轮。
2. **loader 透传缺失**（§5）：本批交付后隔离键暂不生效，行为停留在"每会话一进程"，无回归风险；生效时点由宿主组批次决定。
3. **CSP/资源键**：官方面板资源 `_meta` 用 `zcode/csp`，本仓沿用 `zcode/csp`（改名豁免区，`server.ts:492`），不动。
4. **default 会话可被逐出**：无 `_meta` 调用的"与单实例等价"仅在会话总数 ≤ 32 时成立（§4#6），官方同构，非分歧。
5. **spreadsheets 证据修正记录**：任务背景曾断言"spreadsheets 唯一变化是清单、dist 无运行时漂移"，经实测推翻（官方 0.2.1 dist lockstep 落地 mux，§2.1）；本文以实测为准，后续上游对账引用 §2.1 实测数据而非任务背景转述。

## 9. 实施顺序

1. 本 spec 评审通过（已完成撰写，随批次提交）。
2. office-runtime：documents.ts / files.ts / server.ts 会话模型 + §7.1 单测 + xlsx.ts:202 标注 + CONTRACT.md 更新；包内 typecheck+test 自检。
3. 三插件清单（documents/presentations/pdf，isolation + 双版本号）；spreadsheets 两份清单已预改（§1），仅核对不编辑；逐包 build+smoke 自检。
4. blocker（§5 loader 透传）移交脚本/宿主组处置；若获授权代改，随批附官方对照注释。

## 10. 范围边界

- zcode-cua-plugin 0.6.3→0.6.5（producer 收编、依赖 workspace:*、sync-skill/check-version 脚本、license）不在本 spec；producer 组另立记录。producer 仓 `packages/zcode-cua` upstream 切段本次不动。
- 本组不改：`adapters/`、`bootstrap/`、`contracts/`、`packages/shared` 等宿主路径（§5 缺口以 blocker 形式移交）。

## 11. dist 全面对照台账（2026-10-24，官方 0.2.1/0.2.2 vs 本轮构建 dist）

对照方法：官方四包 dist/server.mjs 先两两互 diff，再逐插件与我方配对 diff（四对各恰 41 行 = 9 删 18 增，四份 diff 内容行逐字节相同、仅行号不同 ⇒ "四对同构"）；ui/ 面按插件 kind 逐插件 cmp -l 穷举全部差异字节并逐簇取上下文定性；五面各经独立复核（agreed + corrections/additions）定谳。全部核验命令与本会话实跑记录见对照台账原文，此处登记结论与处置。

**任务前提修正**：官方四包 server.mjs 并非 sha256 一致（documents `eedd4ff3…`/2,210,814B、presentations `eba1f047…`/2,211,694B、spreadsheets `719f135c…`/2,959,190B、pdf `7d3e4b28…`/5,108,536B——各包内嵌各自 PROFILE 与按 kind 的解析器），"lockstep 同源"仅在共享运行时面成立；故按四对逐插件对照（每对我方恰 +726B，构成：中文还原注释主体 + `.drora` 改名 +1 + `DRORA_WORKSPACE_ROOT` +2 + 换行差异），覆盖强度高于单份对照。

### 11.1 结论：kind=behavioral 差距 0 条

五面（shared·server + documents/presentations/spreadsheets/pdf 各 ui）行为零差距。server 面逐项核验一致：15 个 MCP 工具名（begin/cancel/write/finish_file_import、check/get/list/load/open/read/release/report/search/show_in_viewer、get_viewer）、register 注解面（readOnlyHint、`_meta.ui`{resourceUri,surface,visibility}、openai/ui fullscreen）、9 个 OfficeError 码集合与全部错误文案（corrupt_file/file_too_large/invalid_anchor/invalid_path/invalid_resource/invalid_token/not_found/path_outside_workspace/unsupported_type）、_meta 会话语义（sessionOf 先 root_session_id 后 session_id、无则 DEFAULT_SESSION="default"、LRU MAX_SESSIONS=32 静默 dispose 逐出）、配额/令牌常量（MAX_FILE_BYTES=100MiB、MAX_UNZIPPED_BYTES=512MiB、FILE_CHUNK_BYTES=4MiB、MAX_HANDLES=4、MAX_SESSIONS=32、MAX_IMPORTS=4、IMPORT_IDLE_MS=10min）、资源 URI（PANEL_URI/SURFACE_ID/SERVER_NAME=PROFILE.name）、内嵌模块清单 14 个；ui 面各插件文件清单/资产哈希/内嵌库版本零漂移（react、react-dom 19.2.7，jszip 3.10.1，pdfjs-dist 5.4.296，@extend-ai/react-xlsx 0.16.0 wasm 同源，docx-preview 双侧 dist 无版本串、bundle 字节等故行为等价）。**依赖锁定无需升级**：官方 dist 内嵌版本证据与我方 `office-runtime/package.json` 锁定逐一相同。

### 11.2 intentional 差异（接受理由：`specs/drora-rename.md` 改名政策，上游同步时按豁免规则重放）

| 面 | 差异 | 接受理由 |
| --- | --- | --- |
| shared·server | 导入暂存目录 `.zcode/document-imports` → `.drora/document-imports`（官方 documents dist :44082 vs 我方 :44083，源头 `src/adapters/files.ts`；四对 diff 中唯一路径差异） | drora-rename.md 规则 3（`.zcode` → `.drora`）；用户工作区可见落盘路径随之不同，属有意分歧 |
| 四面 ui | `experimental["zcode/surface"]` → `["drora/surface"]`（每插件 panel.html ×3 + bundle-0.txt ×3，面板窗口状态存取键） | 契约常量 `MCP_APPS_SURFACE_EXPERIMENTAL_KEY="drora/surface"`（`packages/shared/src/mcp-apps/contract.ts:154`）单一定义；宿主生产方 `buildPluginUiHostCapabilities.ts` 与面板消费方（`office-runtime/ui/host.ts:57,125,136`）端到端 lockstep，非漂移 |
| 四面 ui | `_meta["zcode/truncated"]` → `["drora/truncated"]`（各 bundle-0.txt ×1，截断后触发 get_viewer 重取） | 契约常量 `MCP_APPS_TRUNCATED_META_KEY`（contract.ts:131）；生产方在宿主侧 `pluginUiToolFeed.ts:56`（双方插件 server.mjs 该键均 0 命中），面板消费方 `office-runtime/ui/main.tsx:272-275`。备注：main.tsx:273 硬编码字面量未 import 常量，属内部单一出处规则小瑕疵，不影响 dist 行为 |
| pdf·ui | FontFace 族名 `"zcode-cjk-fallback"` / `` `zcode-cjk-${t}` `` → `"drora-cjk-*"`（bundle-0.txt 偏移 833104/835661 两处） | 面板内经 `document.fonts` 自注册/自查询的 CJK 回退字体族（非 localStorage 持久化键：`qz` 与 localStorage 交集 0，bundle 内 localStorage 仅 surface stateKey 读/写 2 处）；无跨进程消费方（官方 dist 全树仅 bundle-0.txt 含 zcode-cjk），改名自洽，仅一次性本地缓存键变化 |

已接受的其余非差距类别（不复述为差距）：品牌词（Drora/Z.ai、面板标题、css 注释与 contextFailed 双语文案中的品牌词）、环境变量键 `DRORA_*`、bundler 产物形状（esbuild vs 官方打包器）、THIRD_PARTY_NOTICES 与 license 文本排版、isolation 行为接线（官方亦未接，§5.1 已定谳 parity）。

### 11.3 packaging 差异（本轮处置 2 项，其余接受）

1. **陈旧还原注释 ×2（已修复）**：`src/adapters/files.ts:232` 与 `src/app/documents.ts:194` 的还原注释误述官方 0.2.1 语义——官方在所引行**本就**是按 owner 计数（dist :44117 `begin: (name, size, owner = "default")`、:44123-44124 per-owner 过滤 `>= MAX_IMPORTS`）与每会话 tokens 上限（:43780-43783，`tokens` 为会话私有闭包数组、:43830 dispose 同域 splice），我方代码与官方逐字节一致、纯注释陈旧；若不修正会给后续上游同步留下"我方有语义分歧"的假象。修复方案：改写两条注释为准确的官方语义描述（中文注释含官方版本+文件+定位+修正依据），代码零改动。**注意**：该注释在 esbuild server 构建（非 minify）中位于对象字面量属性前、会保留进 dist——经 `grep -c` 复测，`MAX_IMPORTS 从全局上限` 在**四个**插件 dist 各留存 1 处（复核初稿称仅 documents 1 处，以四包复测为准）；故注释修正后须重建四包 dist 才体现（+726B 差值随之变化）。**处置结果（本轮实测）**：注释改写为 4 行准确描述后重建四包，四对 server.mjs 差值统一 +726B → **+912B**，四对 diff 内容行均 29（9 删 20 增），hunk 分类不变（JSDoc 注 / sessionOf 纯提升 / `.drora` / execute 换行 / `DRORA_WORKSPACE_ROOT` / 注释行），旧句 `MAX_IMPORTS 从全局上限改为按 owner 计数`、`MAX_HANDLES 从全局上限改为每会话上限` 四包 grep 均 0 残留。`documents.ts:185/:194` 的注释则被构建剥除、不在任何 dist 中——**后续审查不得把"源码有注释、dist 无注释"误判为 dist 陈旧**（esbuild 对函数体内语句前的 `//` 剥除、对象字面量属性/调用实参前的保留）。
2. **documents dist/ui 杂散文件（已清除）**：我方 `documents-plugin/dist/ui/` 在官方恰有的 4 文件（assets.json/bundle-0.txt/panel.css/panel.html）之外多出 0 字节文件 `classes.add(c))`（mtime 16:44 晚于 16:35 构建产物，文件名为 JS 代码片段，疑为对照过程 shell 转义事故残留，非 build.mjs 输出——`build.mjs:40` 每次 `rm(dist)` 全量重建、不可能产生该文件）；其余三插件无此问题。处置：随本轮全量重建清除，恢复与官方 4 文件结构同构；dist/ 在 `apps/drora-cli/.gitignore:1` 忽略，不涉 git 状态。
3. 其余 packaging 差异接受：esbuild 产物形状（变量名/分块）不对照；ui bundle 顶层 4 文件（pdf 294 文件含 pdfjs/cmaps 169、standard_fonts 16、wasm 6、fonts 97 分片、pdf-worker.js、cjk-fallback.json；xlsx 另有 sheets.wasm/xlsx-worker.js）清单与哈希同构。

### 11.4 复核 corrections 采信记录（原文相应数字作废）

- documents·ui：CSS 选择器计数改用可复现口径——panel.css 规则块 `{` = 209/209、唯一 `.` 类名 token = 135/135、按 `{` 切分逗号展开选择器段 = 1461/1461（双侧一致）；初稿"134 个"口径不可复现，作废。
- documents·ui：`drora/truncated` 生产方定位修正为**宿主侧** `pluginUiToolFeed.ts:56`（初稿"与 server 侧 _meta 生产方同源"定位不准：双方插件 server.mjs 该键字面量均 0 处）。
- presentations·ui：pdfjs 计数修正为"2 条动态导入路径常量（`pdfjs-dist/build/pdf.min.mjs`@1158597、`pdf.worker.min.mjs`@1158632）+ 共 15 处字符串（偏移双侧逐一相同）"；初稿"1 处"作废。pdfjs-dist 库本体确未捆绑（版本串 5.4.296 双方 0 命中）。
- spreadsheets·ui：所引偏移为 0 基标注（cmp -l 为 1 基：panel.html 实际 1 基 602201/603437/603595 等），簇数/内容/字节量（12/24）不受影响。
- pdf·ui：字节级 sha256 相同文件数为 **291**（294−3：bundle-0.txt/panel.css/panel.html），初稿 290 作废；cjk 键定性修正为 FontFace 字体族名（初稿"localStorage self-write/self-read"不成立）；"panel.html 121 个 CSS 类名"不可复现，作废（panel.html 无 class= 属性，panel.css 唯一类选择器 135）。
- shared·server：误述注释的 dist 留存范围修正为四包各 1 处（见 11.3#1）。
