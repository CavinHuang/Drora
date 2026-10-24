# relay-v2-server

自建 Relay V2 服务端骨架（specs/relay-v2-server.md §13）：协议兼容平替官方 relay，单进程 Node 部署。
协议唯一权威是 [relay-v2-pairing](../docs/web-remote-control/relay-v2-pairing.md)；可执行行为参照
`packages/shared/test/fixtures/fake-relay-v2.ts`。

意图：只做鉴权、配对、心跳应答与 `data.payload` 透传，不解析 payload 内容，不持有任何私有持久
命令队列（`docs/web-remote-control-task-command-queue.md` 禁令）；task/session/workspace 状态归
桌面 Main / Host / CLI，不在本模块。

不变量：

- 每个状态只有一个写入路径（spec §4）：TokenStore（一次性 token，内存）、DeviceStore（SQLite 设备表）、
  PairingRegistry（连接与 `(SID, role)` owner，内存）；`pair_status` 永远从 owner 存在性派生，不单独存储。
- JWT、一次性 token、`data.payload` 正文与完整设备名不进日志；消息 trace 仅 `MSG_TRACE=true` 时输出
  且只允许摘要字段（`docs/web-remote-control-relay-message-logging.md` 的仓库裁决）。
- wire 类型一律 re-export 自 `@drora/shared/web-remote-relay`（契约键单一出处），本包不复制定义。
- 断连释放必须按连接身份判断（stale close 防护）；KICKED / 断连 / 配对推送的事件顺序见 spec §6.4–§6.6。

与其它模块的交集：唯一源码依赖是 `@drora/shared/web-remote-relay`（共享解析器与 wire 类型）；
仓库内无任何包依赖本包，不进桌面 bundle。部署只消费 tsup 产物（`ws` 由部署闭包提供）。
