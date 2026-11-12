// 插件运行时产物聚合入口（P3）：hooks 自包含 .mjs + knowledge MCP server bundle。
// 存在原因：desktop prepare-agent-node-bundle 的 bootstrap-remote 路径对每个插件只
// 执行单个 runtimeBuildScript（低内存环境绕过 pnpm/tsc shim 的通道），0.4.0 起插件有
// 两类运行时产物（dist/hooks/*.mjs、dist/mcp/server.js），聚合在此单脚本后两条打包
// 路径（pnpm build / bootstrap 直跑）共享同一产物面。
// 注意：build-hooks.mjs 是顶层副作用脚本（import 即构建）；build-mcp.mjs 带入口守卫
// （被 import 时不自跑），必须显式调用其导出的构建函数。
// P5（§2/§10-P5）追加第三类产物：dist/ui/panel.html（React 单文件内联）。
await import("./build-hooks.mjs");
const { buildKnowledgeMcpBundle } = await import("./build-mcp.mjs");
await buildKnowledgeMcpBundle();
const { buildVaultPanelBundle } = await import("./build-ui.mjs");
await buildVaultPanelBundle();
