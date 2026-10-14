# ZCode v3.15.1 验证记录

日期：2026-10-13（Asia/Shanghai）。Node 24.14.0 / pnpm 10.33.2 / Electron 41.0.3，Linux 云环境。

最新补齐与验收已完成，见 [最终记录](zcode-v3.15.1-followup-result.md) 与 [逐案例证据](zcode-v3.15.1-followup-evidence.json)。本页保留首轮迁入与补齐前复核的执行范围和限制，不将历史计数当作最终结果。

## 首轮源码门禁与构建（补齐前）

| 检查                                                                                  | 结果                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm typecheck`                                                                      | 通过                                                                     |
| `pnpm lint`                                                                           | 0 错误、395 警告；保留已有/上游警告                                      |
| `pnpm architecture:check`（全量）/ `--changed`                                        | 0 violation / 0 baseline / 0 new；未刷新 baseline                        |
| `pnpm test:unit:vitest`                                                               | 1,930 文件通过，2 文件跳过；18,070 用例通过，21 跳过                     |
| `pnpm test:unit:node`                                                                 | 572 用例通过，1 跳过，0 失败；包含历史页面辅助函数回归                   |
| `pnpm --filter @drora/mobile-web test`                                                | 8 项资产/历史字节完整性与当前部署检查、212 项历史辅助用例通过            |
| `node scripts/build-desktop-agent-cli.mjs`                                            | CLI 各包与 bundled-agent 构建/分发通过                                   |
| `node scripts/ci/cli-app-server-smoke.mjs apps/drora-cli/packages/cli/dist/drora.cjs` | 7 组通过：startup 通知、plugins/skills/commands/doctor、工作流与核心工具 |
| `pnpm --filter @drora/server build`                                                   | HTTP 和远程单文件构建通过，ONNX 运行时外置                               |
| `pnpm --filter @drora/web build` / `pnpm --filter @drora/mobile-web build`            | Web 与同一源码的 3.15.1 手机资产构建通过                                 |
| Desktop `tsup` / `vite build`                                                         | Main、Host、scheduler、preload、sandbox 与 renderer 构建通过             |

各套件有交集，表中计数不相加。全量初跑失败后逐项修复，最终完整 Vitest 重跑得到上表结果。移动历史代码随后只迁移物理路径，完整 Node 和 mobile-web 包测试重跑通过。Gen UI 的既有服务回归迁为契约入口后，公开入口与文件/状态 adapter 的 12 项回归通过，全量架构检查通过。

## 行为与当前机器启动

- 官方 device + browser transport 经真实 Drora Relay：配对、HMAC、加密与双向 wire 通过；`zcode_type` 保持官方字段。
- 远控部署切换：等官方 manager stop 成功才保存下一配置；stop 失败保留当前部署、显示可恢复提示。
- 知识 Host：设置读取失败不创建语义端口、不阻断 Host；Jev 每轮解析失败关闭该轮功能。
- 更新器 59 项状态机回归通过；Linux AppImage/deb/rpm/pacman 4 项真实下载、校验与缓存复用通过。Generic/GitHub 元数据使用文件名，继续保留 `.pkg.tar.zst` 产物。
- 进程清理 20 项通过、1 跳过；Linux 最终退出结果排除已由 procfs 证实的僵尸条目，无法确认时保守保留失败。
- Web 与后端实际启动：直连与 Web 代理 `/api/server-info` 都为 200、version=3.15.1、workspace=/workspace/Drora、websocketRpc=true；首页和源码模块请求正常。
- 完整 Electron 应用实际启动：Drora renderer 欢迎页面、窗口 scoped Local Host RPC、官方 manager 的 LAN 启动/停止和 3.15.1 页面 HTTP 200 验证通过。临时应用目录按 electron-builder 的根版本 metadata 配置，未改产品源码去适配云环境。
- Electron 自带 Node 的真实 PTY：创建 `/bin/sh`、收到预期输出并正常退出；Electron 41.0.3 / NODE_MODULE_VERSION 145 的 native 绑定有效。
- Gen UI 实际 Electron E2E：隔离、状态、尺寸/主题、Tweak、日历/轮播、锚点、历史挂载与离线导出通过。
- MCP Apps 实际 Electron E2E：SDK/Agent/MCP 资源链路、审批取消/迟到许可、多窗口、工具注册/调用、崩溃重建、80 次 feed 切换和存储/订阅清理通过。

GUI 使用 workspace Xvfb 和测试专用 `DRORA_E2E_NO_SANDBOX=1`；当前功能验收不能代表操作系统 sandbox 的安全认证，产品配置未改。

## 保留的限制

- 官方清洁 runner-options 源码/测试仍有 45/53 项失败；[上游基线证据](zcode-v3.15.1-runner-baseline.json) 与合并源码 token 一致。整个 CLI 旧套件没有宣称通过；没有为旧 DTO 恢复生产兼容层。
- 未获取新版发行 zcode.cjs，无法执行真正的发行 bundle 字面量 parity。当前同步基于公开源码。
- macOS/Windows 的签名/原生 Helper 安装、真实手机后台恢复、用户模型调用/OAuth 需要对应平台或账户。CUA 原生平台限制产生的 skip 单独保留。
- 上游未公开云 Relay 服务端；本次用独立 Drora Relay/LAN 接公开控制链路。

## 环境复用

已保存 `install_script` 和 `start_skill`，包括固定工具、冻结依赖安装、native hooks、构建、Web/后端启动与就绪检查；保留已有网络/凭据设置。配置保存不等于发布环境，也不代表在新机器再次验证过。

## 完整性复核追加结果

- Android/iOS 插件真实 staging 函数在临时输出目录均因缺少 dist/mcp/server.js 失败；先前 CLI/tsup/Vite 构建不覆盖完整 prepare:agent-bundle。
- Bootstrap 三个会话/网关 suite 复跑 188 项：178 通过、10 失败、0 跳过。完整 CLI 没有通过结论，也不能将这些失败全部归因于 runner-options 的独立上游基线。
- 生产默认 CDN resolver 返回误改的官方桶 /drora/ 目录；公网探测被代理 CONNECT 403 拒绝，没有得到 CDN 状态码。手机 HTTP connection ID header 和 Guide 图标对象 key 仍待修正。
- 复核时 typecheck、Lint 与全量架构检查通过；没有再次执行全部根用例、完整安装包构建或真实平台/账户验证。
