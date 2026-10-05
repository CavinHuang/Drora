# ZCode mobile web 包

双轨构建（specs/mobile-relay-r3-frontend.md §13 P2a / §33 页面主体裁定）：

- **官方快照（生产主体，§33.7/§33.11）**：`upstream/remote/v4` 保存官方 3.14.3
  原始字节；`src/recovered` 是从它再生的可读化参照稿（`pnpm --filter
@zcode/mobile-web recover`），不能代替原始字节做保真校验。开发态 relay-server 与
  桌面 LAN 宿主均优先托管 `upstream`；安装包经 electron-builder 将原始快照置于
  `mobile-web-official`。局域网纯 HTTP 响应另在出站注入 WebCrypto、随机 ID 与
  纯文本复制适配（`specs/mobile-relay-server.md` §12.10–12.11）。
- **源码应用（回退/开发参照）**：`pnpm --filter @zcode/mobile-web build` 用 vite 从
  `src/app`（React 入口）+ `src/ui`（自包含移动壳）+ `src/intl`（zh-CN/en-US）
  构建出官方路径形状的 `dist/remote/v4`（entry + `3.14.3/assets/*`）。数据层经
  `@zcode/relay-client`（会话/rpc-frame）与 `@zcode/rpc`/`@zcode/client`/
  `@zcode/services`（Host 服务面）。UI 对 `@zcode/ui` 仅走 §22 受控窄入口
  （remote-timeline/remote-frame/git-pane/remote-queue-panel，白名单由
  test/build.test.mjs 硬校验；§33.4 裁定后源码页不再逐项追赶官方形态）。
- **remote-dist（取证镜像）**：官方站点全量爬取（manifest/api-samples 取证副档），
  字节与 recovered 同源、入口布局为根级；不进 bundled 候选链，供 harness `--dist`
  显式引用与对照。再生命令：
  `node scripts/capture-remote-dist.mjs --url-file <含完整入口 URL 的文件>`
  （URL 必须带 `app_version=3.14.3` 钉版参数，缺省会拿到 latest 版本树；入口地址
  含 `&`，走文件传入防 shell 拆断）。发现机制 = 入口/JS/CSS 静态引用闭包 +
  upstream 冻结清单种子（material-icons 等运行时字符串拼接引用静态扫描不可见，
  靠种子回源验证）。源站 WAF（阿里云 ESA）对高频/裸 Node 指纹请求按 405 节流，
  脚本走 curl 传输 + 全局冷却退避，勿调大并发。

relay-server CLI 的 bundled 根优先级：`upstream`（官方原始字节）→
`src/recovered`（可读化回退）→ `dist`（源码应用末位兜底）→ 内建资产代理 →
R2 兜底。桌面 LAN 宿主优先 `upstream`；安装态随后依次尝试
`mobile-web-official`、存量 `mobile-web`，再尝试仓库内的 `src/recovered` 与
`dist`（spec §33.11）。

`@zcode/relay-server` 服务 `/remote/v4` 并把官方页的 WebSocket 端点出站改写为自身
`/ws`；源码应用直连同源 `/ws`，改写对其为 no-op。上游两个缺失引用
`docx_wasm_bg.js`、`duke_sheets_wasm_bg.js`（官方源站即 404）由资产测试记录。

测试：`pnpm --filter @zcode/mobile-web test`（快照资产图 + 恢复保真 + dist 形状 +
i18n 同构 + D6 自包含边界）。
