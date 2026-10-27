# 手机远控页面构建与原版取证资产

当前页面的唯一实现是 `packages/web` 与 `packages/ui`。
`pnpm --filter @drora/mobile-web build` 从官方页面入口构建
`dist/remote/v4/index.html` 与 `dist/remote/v4/<根版本>/`；`dev` 转发到 packages/web。
页面通过外部 Relay V2 接入已有桌面 Host，包内不提供服务端或旧协议客户端。

`upstream/remote/v4` 保留原版 3.14.3 原始字节；`src/recovered` 是可读化参照，
不能代替原始字节进行完整性校验。`recover` 与 `build:snapshot` 仅供历史取证，
这些资产不参与当前页面启动。`test/assets.test.mjs` 检查冻结资产及再生一致性。

当前协议与恢复边界见 `docs/web-remote-control/web-remote-control-architecture.md`。
