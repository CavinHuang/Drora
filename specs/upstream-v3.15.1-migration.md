# ZCode v3.15.1 同步与模块化扩展策略

状态：源码迁移与本地验收完成；CLI 上游旧测试漂移和平台限制见验证记录。用户于 2026-10-13 授权同步官方特性，优先确定远控迁移策略，再推进其余合并。

## 固定基线

- Drora：`82b02c1411a995a4c33080d5ea497b1477ae6ded`。
- 官方旧基线：`29628c9acdb81b703bbd4080c207a0e7ce5e276e`（v3.14.3）。
- 官方新基线：`aac4755666d09fdcd70272fcf063c077a639015f`（v3.15.1）。
- 实施分支：`integrate/upstream-v3.15.1`；不重写现有历史、不创建 worktree。

## 远控迁移决定

官方已公开浏览器 UI、两端传输、共享协议和桌面 Host 接入。外部 Relay 服务端实现不在公开仓库。

1. **页面唯一实现**：以官方 `packages/web` 的远控页面与共享 `packages/ui` 为后续同步来源。停止继续发展独立的逆向手机 UI；`packages/mobile-web` 迁为构建/资产部署适配入口，复用官方页面产物，不复制官方组件建立另一套行为。
2. **桌面唯一控制面**：以官方远控 manager、device transport 和 Host attachment 为控制面；已有逆向控制器退出正常启动链。自建 Relay 与 LAN 的服务端职责继续保留在独立模块，不能向官方 manager 插入另一份任务队列或业务投影。
3. **扩展接在装配层**：自建云中继只提供 endpoint/资产根配置；LAN 模块负责内嵌 Relay 生命周期、地址选择和凭据 origin 隔离。由独立 Drora 适配模块构造官方依赖。官方页面和控制器不直接 import 自建 Relay 实现。
4. **默认使用新源码构建页**：旧 3.14.3 发行快照保留取证用途，不能继续优先于新页面。页面 URL 与构建资源版本来自一个配置所有者，不以修改 app_version 掩盖跨版本不兼容。
5. **保留官方行为**：窄屏任务首页/聊天、宽屏任务列表、独立选中态、主题、重连、权限交互、任务生命周期及失败面采用公开实现。新增 Drora 操作与设置通过独立组件/扩展注册接入。
6. **不增加承诺范围**：官方未提供手机 Gen UI/MCP 沙箱时保持官方降级。远控不另起 Host 或 Agent，不在 Relay 存储 task/session/业务快照。

## 状态所有者与事件顺序

| 状态 | 唯一所有者 |
|---|---|
| task/session、被接受的输入、权限、工作流 | 既有 Agent/runtime 与 CommandInbox |
| workspace scope、owner/lease 与服务实例 | 窗口 scoped Host |
| attachment 创建/释放与远控会话路由 | 官方 desktop manager |
| WebSocket 握手、心跳、重连 | 官方 device/terminal transport |
| Relay 注册/鉴权/配对和透明转发 | 自建或官方 Relay 服务端 |
| LAN listen/stop、端点与凭据 origin | 独立 Drora LAN/endpoint 适配模块 |
| 手机当前选中任务、视图、主题、草稿 | 官方 Web 页面；不回写桌面选中态 |

```mermaid
sequenceDiagram
    participant UI as 官方手机页面
    participant Relay as 可替换 Relay
    participant Main as 官方桌面 manager
    participant Host as 既有窗口 Host
    participant Agent as 唯一 Agent owner
    UI->>Relay: 配对与 workspace-bridge-open
    Relay->>Main: 透明转发
    Main->>Host: attachment（workspaceIdentity / remoteSessionId）
    UI->>Relay: RPC / replayable 输入
    Relay->>Main: rpc-frame
    Main->>Host: 同一 attachment
    Host->>Agent: CommandInbox admission
    Agent-->>UI: snapshot / stream / gap 恢复
    Note over Host,Agent: 桌面 continuous 与手机 replayable 分开，同一任务所有者
```

旧 socket/迟到请求不得落入新 attachment。释放 attachment、关闭窗口、停止远控和凭据轮换沿用官方顺序；origin 隔离的 LAN/云凭据不互换。重复连接/命令的幂等和序号校验由原有对应 owner 执行。

## 其余同步与自研隔离

- 尽可能采用官方 shared 契约、Agent/runtime、动态工作流、MCP Apps/Visualize、Bot、会话投影、UI 与测试；按依赖闭包移植，不只复制界面。
- 自研知识检索/VaultView/Jev/ONNX、S03 写入分级、桌面宠物、自建 Relay、发行更新与 Helper 身份各有独立模块和契约，通过 ports、注册表、依赖注入和装配入口接入。
- 原实现文件内只保留明确接入点，不散落自研业务分支；还原权威文件不得 import 自研实现。新增跨模块边先登记契约和架构依赖。
- 保留现有 `knowledge/search`、Vault accessor、证据/审批账本及数据库升级路径。新权限流程的 resolveInput、hook 修改和 inputAdjustments 后均保持最终输入的 S03 复核。
- 保留已移除的上游 forceUpdate 门控决策和 Drora 更新渠道。上游 Computer Use/request-security 占位实现不能覆盖现有还原能力。
- 改名严格遵守 `specs/drora-rename.md`：外部服务、OAuth、wire headers、manifest 目录、官方字节/许可资产和新契约逐项处理，禁止盲目全仓替换。

## 实施顺序与验收

1. 共享契约、必要依赖/runner 与架构登记。
2. Agent/runtime、工作流、权限和插件。
3. 服务/Host、Bot、知识扩展装配。
4. MCP/Gen UI、会话/辅助对话、官方 Web/远控 UI。
5. Relay/LAN 适配与部署资产入口。
6. 类型检查、Lint、架构门禁、行为测试、构建与平台发行验证。

| 场景 | 验收 |
|---|---|
| 官方页面 + 自建云 Relay | 握手/配对、任务列表、输入、停止和审批实际贯通 |
| 官方页面 + 内嵌 LAN Relay | 本地端点和新源码页正确；凭据与云端隔离 |
| 桌面与手机在线 | 同一 owner；独立选中态；输入只 admission 一次 |
| 断网/切后台/重连 | ACK、gap、snapshot/replay 不丢失、不重复、不串 workspace |
| SSH/远程工作区 | 使用原 workspaceIdentity/remoteSessionId，已有连接重连 |
| VaultView/知识检索 | accessor、knowledge/search、引用/审批/索引迁移保持有效 |
| 新权限流程 | P0 逐次确认、plan 禁写、hook/inputAdjustments 不能绕过 |
| MCP/Gen UI | 实例归属、CSP、手势、资源预算与失效实例验证；Web 依官方降级 |
| 发行 | Drora 品牌/Helper/更新源不回退；许可和资产 provenance 完整 |

固定版本 `pnpm typecheck`、`pnpm lint`、架构门禁、CLI 深度 smoke 和模块行为测试必须实际运行。真实 Electron/Windows/macOS/移动浏览器/网络验证与 mock 分别报告，不把 mock 通过写成真机通过。旧上游 bundle 对拍不能代替 3.15.1 真值；未取得新版官方 bundle 时记录该限制，不伪造 parity 通过。

### 更新器收敛

更新器的轮询、下载重试、已下载版本替换和菜单状态采用 3.15.1 官方单一状态机。
Drora 发行源由独立适配层配置，默认复用安装包的 GitHub feed，显式 URL 覆盖走 generic feed；不装配 ZCode 云端 manifest provider。
启动时的最低版本阻断、forceUpdateGuard/Prompt/服务调用保持移除。更新器内部可复用的主动检查/下载入口不产生启动门控。
保护既有安装失败恢复回调，通过装配 hook 接入，不能改写更新事实或添加第二个队列。

### Host 知识装配的模块边界

`assembleDroraKnowledgeHost` 归属 services 自研扩展，由 `@drora/services/node` 提供公开入口；Desktop Host 只调用装配结果，不导入 Host tsconfig 范围外的桌面源码。装配读取设置，按需创建零出站本地 embedding 端口；Jev 每轮重新解析设置，失败降级，不新增会话所有者。

### 回归测试入口

上游 Vitest 测试与 Drora 的 Node test runner 用例保持各自原生运行器。根 `test:unit` 必须运行两者；通过导入 `node:test` 识别 Node 用例，避免 Vitest 报零 suite，禁止排除后不执行。Node TS 用例用已声明的 tsx loader，保留原断言与跳过统计。

桌面冷启动仍按官方时序在平台 IPC 注册后调用 `primaryWindowCoordinator.ensurePrimaryWindow("app-ready")`，再绑定首屏性能监控；后台更新不能阻止该入口。实际 Electron 验收必须有渲染页面和 Host 响应，不能只检查进程。

清理三路合并产生的重复 switch/object 键。Server/Docker 按官方 dedicated remoteSessionId 保持逻辑会话生命周期，不采用被遮蔽的旧 Server 同目标复用分支；SSH/WSL 仍按官方规则复用。旧冻结控制器只保留取证与回归：其 grace 定时器依据 `relay-wire/replayBuffer.ts` 的严格 `now > queuedAt + graceMs` 和官方 chunk-C6VCYWB4.js @8551 所记录 deadline 口径，触发时间加 1ms，防止恰好落在边界时一次性看门狗失效。

构建约束：ONNX 的本机二进制由 Node 的 `onnxruntime-node` 包加载，HTTP/桌面 Main、Host、scheduler 都外置该依赖；对应部署包显式声明运行时依赖。不能把某个平台的 `.node` 文件内联为 esbuild 的临时资源。UI 扩展传入 memo 组件的展示节点和回调保持稳定引用。

### Linux 进程退出观测

容器内 PID 1 可能不回收僵尸条目：实测失败 PID 已是 `/proc/<pid>/stat` 的 `Z` 状态，`kill(pid, 0)` 仍成功。保持官方进程身份复核、信号顺序和 deadline，在最终退出结果中异步读取 Linux procfs，仅排除已确认为 Z 的条目；读取失败保守保留。测试验收使用现有 `isPidRunning`，仍要求真正可执行的后代结束。

CUA 懒启动仍由官方 Helper lifecycle 统一 admission；Windows 的懒启动 fallback 保留稳定 named pipe 和 recipe，不能使用 macOS Unix socket 路径。macOS/Windows 的真实原生 Helper 安装验收需要对应平台，当前 Linux 只验证装配和既有契约。

### 旧手机页面退役

3.14.3 的逆向 app/ui/intl 迁入 `packages/mobile-web/legacy-v3.14.3`，保持取证和历史辅助函数回归。旧 Vite 配置归档，不再提供第二个开发/生产页面入口；当前 mobile-web 的 dev 转发 packages/web，build 直接构建 packages/web。原始发行 snapshot/recovered 仅供 provenance。历史 Node 测试继续运行其原断言，不能拿历史 UI 用例代替当前官方页面验证。

CLI 构建产物冒烟保持 stdin pipe，按 Desktop 的真实 stdio 生命周期等待首条 startup 通知；stdin EOF 是单独退出事件，不能把启动前直接 EOF 与协议就绪混为一谈。

实施结果：[合并记录](../docs/upstream/zcode-v3.15.1-merge.md)、[验证记录](../docs/upstream/zcode-v3.15.1-validation.md)。

全量架构检查补齐 Gen UI 服务的契约测试入口：把已有的 sandbox provenance/状态转义/完整文档拒绝回归迁到 `gen-ui/contract.test.ts`，改经公开 `node.ts` 构造服务。保留全部原断言，不增加重复 suite，不修改产品行为或 baseline。
