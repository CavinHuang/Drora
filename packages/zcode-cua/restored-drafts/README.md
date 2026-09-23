# Computer Use in-app 库还原（完整链路，2026-09-22）

MCP server 引擎已从 vendored 产物拆解为可读源码：`src/mcp/{errors,client,session,tools,server}.ts`
（约 1 万行 CUA 自有实现；内联的 zod v3 / zod-to-json-schema / MCP SDK 保留在
`vendor/mcp-server.dist.mjs` 作为第三方预构建档案，经其导出符号供 src/mcp 引用）。
构建链：tsc（src 主体，src/mcp 除外）+ esbuild（src/mcp → 根 mcp/，与 tsc 产物镜像）。
E2E：mock broker + stdio initialize → tools/list 30 工具 → tools/call request_access 全链路通过。

## 历史（2026-09-21 完成核心链路）

`@drora/drora-cua` 的真实实现已从草稿落地为 `src/` 源码（tsc 0 错误、根级 typecheck+lint+fmt 全绿、mock broker 冒烟通过）。本目录保留为还原过程档案，`.txt` 草稿不再参与任何流程；后续语义化（混淆名 → 语义名）直接在 `src/broker/server/*.ts` 上继续。

## 已落地（packages/zcode-cua）

- `src/broker/client.ts` + `src/broker/index.ts`：broker 客户端（brokerExchange / callBrokerMethod / probeHelperHealth / 错误工厂）。
- `src/broker/socket-path.ts`：稳定 socket（`broker.sock`）与临时 socket 铸造、runtime 目录、过期回收（原 `$c/Uu/fa/ma`，function-map 257-300）。
- `src/broker/protocol.ts`：宿主侧协议工具（parseRequestLine/okResponse/dispatchRequest 等，方法表镜像 helper 的 types.ts）。
- `src/broker/server/*.ts`：14 个 server 模块 + `index.ts` 出口（混淆名 → `broker-server.d.ts` 契约名的映射集中在 index.ts）。真实实现覆盖：installer/verifier/launcher/helper-host（CuaHelperHost 类）/product-helper-host/permission-broker-client/orphan-reaper/cua-spec/refresh-marker/trust-policy/canonical-installer/windows-helper-host（含 PiP 会话事件 schema 的 host 侧镜像）。
- 构建：`pnpm --filter @drora/drora-cua build`（tsc，outDir "." 镜像发射到包根 `broker/`，产物随包分发并已加入 oxlint ignorePatterns）；根 facade（broker.js / broker-server.js / broker-helper-health.js / broker-socket-path.js）只做 re-export。
- 仍 fail-closed（与原发行物一致）：`createComputerUseRuntime`、pip-session 运行时、ax 原生插件加载、LaunchServices 权限请求变体、WINDOWS_DEV_CONTROL_PROTOCOL。

## 还原时修掉的草稿损坏（后续语义化注意）

- `cua-spec.ts`：`replace(/z/g, "-")` 是美化器损坏，原版为 `replace(/_/g, "-")`（pretty 区 94 行可证）。
- helper-launcher/orphan-reaper 的 dev bundle id 常量被美化器误标为 `HELPER_BUNDLE_ID_VALUE`，实际语义是 `DEV_CUA_HELPER_BUNDLE_ID_VALUE`（helper-host 活体校验、orphan-reaper 期望 bundle id 两处已按语义归位）。
- 美化器把 options 属性访问写成调用的残渣（`t(t as any).x`）已全部清理。

## 无法从发行物还原（保持 fail-closed / 语义重建）

- `ax_native.node` 的宿主侧加载链；`createComputerUseRuntime` / `createPipSessionClient`（所有发行物均 fail-closed，真实工具流是 node_repl MCP → helper broker）。
- 原版二进制已按"直接拷贝复原"进仓库：helper app 见 `packages/desktop/resources/cua-helper/`（含 ax_native.node，签名 TeamID 8A5X4JJ39T 已验证），`ax_native.node` 另存 `packages/zcode-cua-helper/native/`，window-bounds 工具在 `packages/desktop/resources/macos-window-bounds/`。electron-builder extraResources 已接线 `resources/cua-helper → resources/cua-helper`。
- 原版编译产物参考源：本机插件缓存 `~/.zcode/cli/plugins/cache/zcode-plugins-official/computer-use/0.5.14/dist/mcp/server.js`（未混淆 esbuild bundle，但被 tree-shake 成 client-only，不能当完整库用）。
