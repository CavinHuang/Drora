# Drora mobile web 包

双轨构建（specs/mobile-relay-r3-frontend.md §13 P2a）：

- **源码应用（默认）**：`pnpm --filter @drora/mobile-web build` 用 vite 从
  `src/app`（React 入口）+ `src/ui`（自包含移动壳）+ `src/intl`（zh-CN/en-US）
  构建出官方路径形状的 `dist/remote/v4`（entry + `3.14.3/assets/*`）。数据层经
  `@drora/relay-client`（会话/rpc-frame）与 `@drora/rpc`/`@drora/client`/
  `@drora/services`（Host 服务面）；UI 不 import `@drora/ui`（D6 自包含）。
- **快照包（保底）**：`upstream/remote/v4` 是 2026-09-29 从
  `https://zcode.z.ai/remote/v4` 冻结的官方 3.14.3 页面字节（证据资产，保持逐字节
  不动）。`src/recovered` 由 `pnpm --filter @drora/mobile-web recover` 从快照再生
  （可读化 + 还原来源头）。`pnpm --filter @drora/mobile-web build:snapshot` 把
  recovered 拷贝为独立页面包（`--out` 指定目录，默认 `.tmp-snapshot-build`；不再写
  dist），供独立部署 `relay-server --mobile-dir` 使用。

relay-server 的 bundled 根优先级：`dist`（源码应用，entry 存在才启用）→
`src/recovered`（快照回退）→ 内建资产代理 → R2 兜底（spec §13.4）。桌面 LAN
host 在 D6 冻结期内仍直读 `src/recovered`。

`@drora/relay-server` 服务 `/remote/v4` 并把官方页的 WebSocket 端点出站改写为自身
`/ws`；源码应用直连同源 `/ws`，改写对其为 no-op。上游两个缺失引用
`docx_wasm_bg.js`、`duke_sheets_wasm_bg.js`（官方源站即 404）由资产测试记录。

测试：`pnpm --filter @drora/mobile-web test`（快照资产图 + 恢复保真 + dist 形状 +
i18n 同构 + D6 自包含边界）。
