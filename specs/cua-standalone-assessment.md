# 独立 MCP 直跑（Computer Use 脱离桌面宿主）评估

## 结论（建议）

**维持现状：Computer Use 由桌面宿主托管运行；CLI/独立进程维持 fail-closed。**
不建议在 v0.0.x 阶段实施"独立 MCP 直跑"。理由与实施代价见下；若未来产品决定
支持"纯 CLI 用户的 Computer Use"，正确的形态是"Helper 生命周期编排 + TUI 权限
提示"作为独立特性立项，而不是恢复被开源剥离的 token 凭据回退。

## 现状（已验证的事实）

1. CUA MCP server（`packages/zcode-cua/src/mcp/server.ts` 的 `buildServer`）
   在缺少 `brokerSocketPath` 或 `brokerToken` 时注册 **0 个工具**——静默
   fail-closed，不崩、不越权。CLI 场景（插件由 manifest 直接 spawn、无宿主
   凭据注入）即此形态：agent 看不到 Computer Use 工具。
2. 凭据的合法来源只有桌面宿主：desktop 以 `__drora-plugin-host` 子命令拉起
   MCP server 时，经 `plugin-host-command.ts` 的三重断言（resolver 权威写入的
   plugin id + 完整捕获凭据组 + canonical broker socket）恢复 bearer token。
   断言防止第三方/被替换插件借宿主边界拿到 TCC 能力。
3. Windows 上原生能力经 helper（`windows-helper.js`，提权安装）+ broker
   中转；`unsafe-pointer.node`/`koffi` 原生绑定把 N-API 符号绑定到 NODE.EXE
   （见 specs/sea-tui-node-alias.md 同类问题）。权限请求（
   `permission-broker-client.ts`，574 行）依赖桌面 UI 完成用户授权手势。

## 解封需要什么（若产品决定支持）

| 工作块                        | 内容                                                                                                        | 规模 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| Helper 生命周期编排（CLI 侧） | 提权安装、启动、健康检查、升级、卸载——桌面宿主里这部分横跨 helper-installer/launcher/verifier/orphan-reaper | 大   |
| 权限提示 UX                   | broker 的 permission-request 目前由桌面窗口应答；CLI 需要 TUI/系统通知形态的授权流（且是安全敏感 UI）       | 大   |
| 凭据发放                      | CLI 宿主生成 token + 写 canonical socket + 注入 MCP env，替代 plugin-host-command 的宿主捕获路径            | 中   |
| 协议对齐                      | 原版 0.5.13 的 token 凭据组字段与现身份模式的字段差异逐一回放                                               | 中   |

## 建议

- v0.0.x：维持 fail-closed。当前行为**安全上正确**：没有宿主凭据的进程
  本就不该拿到桌面控制能力。
- 若要支持：以"CLI 宿主"为产品立项（Helper 编排 + TUI 授权 UI），另立
  spec 与实施计划；不要以恢复 token 回退的方式静默放开。
