# B21 对拍报告：browser-use 插件与 js REPL（node_repl VM 内核、broker、CDP 链）

- 真值：`D:\software\zcode\resources\glm\zcode.cjs`（0.16.9）+ 明文包 `glm\packages\browser-use-plugin\`、`glm\packages\node-repl-host\`
- 我方：`apps\drora-cli\packages\{browser-use-plugin,node-repl-host,adapters,bootstrap,cli}\`、`packages\shared\`、`packages\zcode-cua\`（分支 feat/migrate-remote-and-pet）
- 方法：明文包逐文件 diff；我方 dist bundle 与真值 dist bundle 分区 diff；真值主 bundle 用 grep -ob / dd 取证。版本实测：node-repl-host 双方 0.6.0，browser-use-plugin 双方 0.5.1。

## §1 VM 内核（node_repl js 工具运行时）

结论：**内核逐段等价**（除 zcode→drora 改名与 esbuild 计数器差异外逐行一致）。

| 项 | 我方证据（dist/mcp/server.js） | 真值证据 | 结论 |
| --- | --- | --- | --- |
| NodeReplSession 类 | `:52789` | `:80227` | 等价：vm createContext 沙箱、`globalThis.globalThis=globalThis` 引导 |
| 定时器回收 | scoped setTimeout/interval 集合，`dispose()` 清空、sink 置 null | 同构 | 等价（回收三合一保留） |
| 同步执行超时 | `:52665` `run(code,…,syncTimeoutMs=5e3)`，`timeout:Math.max(1,trunc(…))` | `:80103` 同 | 等价 |
| IifeContextExecutor | `:52664`（meriyah AST 改写 import→importModule） | `:80102` | 等价 |
| createReplRequire | `:52729`（restrictedProcess 门面） | `:80167` | 等价 |
| importModule | `:53051`：PROCESS_MODULE_IDS 命中→受限 process，否则宿主 `import(specifier)` | `:80489` 同 | 等价；白名单=工具描述文本约束（node:* 与 skill root 下 file://），双方面一致 |
| 全局绑定 | console/tee、受限 process、Buffer/URL/TextEncoder、scoped timers、require、importModule、nodeRepl{cwd,homeDir,tmpDir,requestMeta,write,emitImage,emitStructuredResult,setResponseMeta} | 同 | 等价 |
| emitImage 通道 | bytes/base64/dataUrl→`currentSink.images`，非法抛 TypeError | 同 | 等价 |
| Worker 化 | `:54678` 每次调用 `new Worker(self)`，finish 时 `terminate()`；`AbortSignal.any` 三源 | `:117750` 同 | 等价（vm 化+每调用隔离保留） |
| 工具输入 schema | `timeout_ms` int.max(12e4)，描述文本逐字一致 | 同 | 等价 |

差异：真值 bundle 内 **kernel 区重复一份**（`repl/executors.js`+meriyah 各两份，我方一份；总行数 117,878 vs 54,806）。存活副本已验证与我方等价，多出约 6.3 万行为死副本/无关依赖（ajv、express 等，随真值 CUA SDK 打入）→ SHAPE-DIFF（见 §5）。

## §2 browser 桥（socket 协议、CDP、IAB、截图回传）

结论：**浏览器链全段等价**（browser-client → node_repl bridge → broker socket → BrowserControlPort → CDP 后端）。

1. browser-client.mjs（79,261 vs 78,937 B）：diff 仅 zcode→drora 字符串与注释前缀。关键锚点一致：`Symbol.for("drora|.node-repl.browser-control-bridge")`、fallback 不诱导复用 global binding、同站 URL 复用 tab、goto 后显式确认 DOMContentLoaded。
2. broker 服务端（我方 `bootstrap/src/app/node-repl-browser-broker.ts`，242 行可读；真值 zcode.cjs@14060800-14064000）：
   - 请求上限 1 MiB（我 `:16`，真 `NVa=1024*1024`）；token 32B hex + timingSafeEqual；subagent 直接拒绝（文案逐字同）。
   - socket 命名：win32 pipe `\\.\pipe\{zcode|drora}-node-repl-<uuid>`；POSIX 双方均为 `znr-<uuid>.sock`。
   - readLine/abort/EPIPE 收敛语义、unref、ready promise、close rm 逐段同。
3. 协议 schema（我 `packages/shared/src/browser-use/nodeReplBroker.ts:9-55` vs 真 pZt/$Xi@986866 附近）：字段、strict、discriminatedUnion 完全一致。
4. 接线（我 `bootstrap/src/app/create-app.ts:265-288`、`built-in-node-repl.ts`；真@14089682、@14065150）：条件（browserControlPort + browserUse 特性 + node_repl stdio）、双注入（configured + runtimeConfig）、`timeoutMs:600_000`、`isolation:"workspace"`、`protocolVersion:"2026-07-28"` 全同；env 注入均为按插件启用条件注入（DRORA_/ZCODE_PLUGIN_ROOT、*_CUA_PLUGIN_ROOT）。
5. CDP 后端（我 `adapters/src/browser/*`；真 zcode.cjs@4300700-4327500）：
   - launch：headless、`["--no-first-run","--no-default-browser-check"]`（我 `index.ts:205`；真@4324271）；context 1280x720、acceptDownloads:false（我 `:252-255`；真同）。
   - 断连 generation+1、close 超时 1500ms（我 `:40`；真 `m$s=1500`）、stale backend 文案逐字同。
   - 不支持清单（visibility/capabilities/claimTab/finalize/mark*/turnEnded/closeSession/cancelRequest→capability_unsupported）逐项同（我 `:333-350`；真@4326873）。
   - playwright 预算：`timeoutMs=min(3000,max(1,floor))`（我 `playwright-command.ts:8-12`；真 `Pct`@4303065）；networkidle 拒绝文案逐字同（我 `:236-243`；真@4307001）；导航 30s+waitUntil load（我 `page-command.ts:15`；真 `Rct=3e4`@4317789）；evaluate 走 CDP Runtime.evaluate 同构。
   - snapshot：ref `e{n}`、maxElements 200、maxDomNodes 300、stale-ref 文案同（我 `snapshot.ts:5,219,123`；真 `cpn`@4311545）。
   - executable 解析：Linux/mac/Windows 候选路径表、`--browser-executable` 校验文案逐字同；descriptor 9 条 apiSupportOverrides 逐字同（name/provider 改名）。
6. 自动截图 meta：`zcode|drora/browserTurnScreenshot`、`browserScreenshotContentIndices` 合并进工具结果逻辑同构（bridge 区 diff 干净）。

## §3 manifest / skill / docs 对位

- `.zcode-plugin/plugin.json`：browser-use 双方逐字节相同；node-repl-host 仅 description ZCode→Drora。
- docs/ 16 个文件：15 个 SAME 或纯改名级 diff（api.json 3 处、overview 15 行、workflow 4 行等，均为 Codex 字样移除/改名，无行为语义变化）。
- skills/control-browser/SKILL.md：33 行变更，除改名外唯一行为差异 = **CLAUDE_PLUGIN_ROOT 兼容回退被删**（真 `ZCODE_PLUGIN_ROOT ?? CLAUDE_PLUGIN_ROOT`，我仅 `DRORA_PLUGIN_ROOT`；SKILL.md:23 与真值 server.js 尾部 pluginRoot 同步删除）。
- build.mjs：真值多 `external:["sharp"]`、"修复原因"注释头、vitest test script；我方无（与 CUA stub 一致，见 §5）。
- node-repl-host README 仅标题改名；package.json 版本、依赖结构一致（catalog:→workspace:*、vitest 缺）。

## §4 数值预算对照（逐个）

| 预算 | 我方 | 真值 | 结论 |
| --- | --- | --- | --- |
| js 默认超时 | 6e4 | 6e4 | 同 |
| js 最大超时 timeout_ms / MAX_SYNC_TIMEOUT_MS | 12e4 / 12e4 | 12e4 / 12e4 | 同 |
| vm 内同步 run 默认 | 5e3 | 5e3 | 同 |
| MCP 启动 timeoutMs | 600_000 | 6e5 | 同 |
| broker 请求上限 | 1 MiB | 1 MiB | 同 |
| broker token | 32B hex | 32B hex | 同 |
| playwright 等待上限 | 3000ms | 3000ms | 同 |
| 下载等待上限（client 侧） | 120000ms | 120000ms | 同 |
| 导航超时 | 30_000 | Rct=3e4 | 同 |
| CDP close 超时 | 1500ms | 1500ms | 同 |
| snapshot | 200 元素/300 DOM 节点 | 200/300 | 同 |
| viewport 限制 | 320–3840 / 320–2160；zoom fit/50..200 | 同 | 同 |
| CUA app-associations meta 上限 | **16KB**（packages/zcode-cua/host-display-contract.js:3） | **384KB**（真 bridge 内 `384*1024`） | **不一致**（随 CUA stub） |
| CUA frame 合同 | stub：image-ref 恒 false、无 16M 像素/256K 凭证扫描 | 16M px、200KB base64、256K+1024 凭证 | 缺失（随 CUA stub） |

## §5 差集三分类

| # | 分类 | 级别 | 内容 | 证据（我方 / 真值） |
| --- | --- | --- | --- | --- |
| 1 | REAL-GAP | P1 | Computer Use 运行时整体 stub：`createComputerUseRuntime` 返回 "not available in this build"；js 工具的 CUA 半边（agent.computerUse、helper 安装、权限 broker、capture_app）不可用 | packages/zcode-cua/index.js:1-15 / 真 server.js:80540 起整段 SDK |
| 2 | REAL-GAP | P2 | `JS_TOOL_DESCRIPTION` 仍含完整 Computer Use 使用与 bootstrap 指引（逐字同真值），但运行时已 stub——模型可见文本与行为不一致（真值文本/行为一致） | dist server.js:54509 / 真 :117581 |
| 3 | REAL-GAP | P2 | sharp 截图重编码链缺失：真值 `external:["sharp"]` + 随包 `@img/sharp-win32-x64`，CUA 截图 decode/re-encode；我方全无 | 真 build.mjs:34,58、真 server.js:112007 / 我方 grep sharp 仅 1 处（unicode 符号） |
| 4 | REAL-GAP | P2 | CUA_APP_ASSOCIATIONS_MAX_META_BYTES 16KB vs 384KB（#1 同根因，若启用 CUA 需对齐） | packages/zcode-cua/host-display-contract.js:3 / 真 bridge `384*1024` |
| 5 | REAL-GAP | P3 | CLAUDE_PLUGIN_ROOT 兼容回退删除（skill 引导代码 + server.js pluginRoot 两处） | SKILL.md:23、dist server.js 尾 / 真 `?? CLAUDE_PLUGIN_ROOT` |
| 6 | REAL-GAP | P3 | 两个官方包 package.json 均无 vitest test script/devDep（真值有 `vitest run test`） | package.json scripts / 真同名文件 |
| 7 | EXTRA | P3 | `cli/src/sea-playwright-runtime.ts`：SEA 环境从 asset 抽取 playwright-core 运行时（非 SEA 回退 plain import）；真值 CLI 侧为直接 `import("playwright-core")`（真值 SEA 如何解析未见对应机制） | sea-playwright-runtime.ts:33-40 / 真 `iYr`@4303233 |
| 8 | SHAPE-DIFF | P3 | 真值 bundle 内 kernel 死副本（executors+meriyah×2，+~6.3 万行）；存活副本与我方等价，疑似真值构建未去重 | 真 server.js:43674 与 :71112 两份 meriyah；我方仅 :43674 |
| 9 | SHAPE-DIFF | P3 | meta key / symbol / env / 进程名成套改名：codex/*→drora/*、com.zcode→com.drora/request-context、Symbol.for、WORKER_KIND、pipe 前缀（POSIX `znr-` 双方相同） | nodeReplBroker.ts:6-7 等 / 真@986866 |
| 10 | SHAPE-DIFF | P3 | docs/SKILL 中 Codex 措辞移除（"Codex-compatible"→通用表述），无行为差异；"修复原因"注释前缀删除 | docs/overview.md:5 等 |

浏览器链核心（§1 内核、§2 桥、§3 文档、§4 预算除 CUA 两项外）**未发现行为级差距**。

## §6 OPEN-QUESTION

1. CUA stub（#1-#4）是 Drora 有意裁剪还是未迁移？若有意：js 工具描述（#2）应同步收敛 Computer Use 文本，避免模型按描述调用必败路径；若无意：需迁移真值 `@zcode/zcode-cua` SDK 全量（含 sharp、权限 broker、helper 安装 define `__DRORA_CUA_HELPER_BUILD_ID__` 链）。
2. 真值 SEA（单可执行）环境下 `import("playwright-core")` 的解析机制未在 bundle 中定位到对应物；我方 sea-playwright-runtime 的 asset 抽取是否为真值等价能力的另一种实现，待运行时验证。
3. 真值 bundle kernel 死副本是否为其 esbuild 配置缺陷（同一 `../core/dist/repl/*` 打入两份）；仅影响体积不影响行为。
4. 批2 B1"node-repl-host 0.6.0 只剩 js 工具"结论按工具面成立（双方 tools/list 均仅 `js`）；但真值运行时仍内置完整 CUA broker/runtime，"等价"结论应限定为工具面而非运行时载荷。
