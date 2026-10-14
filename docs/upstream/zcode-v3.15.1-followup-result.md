# ZCode v3.15.1 补齐实施与验收

日期：2026-10-13（Asia/Shanghai）。固定上游 `aac4755666d09fdcd70272fcf063c077a639015f`，补齐起点 Drora `4831598b`。分支 `integrate/upstream-v3.15.1`，未推送或发布。

公开源码的确认迁移缺口已补齐。根回归、完整 CLI、构建和真实 HTTP/MCP 检查通过；包级检查仍保留可复现的上游测试/实现不一致及两项公网归档访问失败，不能把整个 CLI 工作区描述为全绿。逐案例基线、计数、原始报告路径与 SHA256 见 [验收证据](zcode-v3.15.1-followup-evidence.json)。

## 已实施

| 事项 | 实现与结果 |
| --- | --- |
| Android/iOS | 加入根 workspace/锁文件，开发 Agent 和 desktop staging 自动构建官方 MCP 源码，缺产物即失败；无旧 dist 的独立源码构建、真实 MCP initialize/tools-list 两项通过，不需要 SDK/Xcode |
| CDN | 官方国内/海外默认对象目录恢复 `/zcode/electron/releases`；自建 CDN 必须明确 `OSS_PATH_PREFIX`，保留显式多源配置 |
| 手机 HTTP | 唯一共享契约 `X-ZCode-Mobile-Connection-Id`；真实 HTTP + WS 窗口就绪测试验证两个请求、workspace/view-state 路由和失效连接拒绝 |
| Guide 图标 | 保留官方 `zcode-guide` 对象 key，本地插件 ID 仍按 Drora 规则 |
| CLI 默认选择 | 恢复 `/model`、`/effort` 对现有默认偏好端口的保存调用；失败以 warning 呈现，不阻塞当前选择 |
| REPL 边界 | Core/桥接从已有 `@drora/contracts/mcp` 公共入口读取元数据常量，避免总入口求值；冻结 CUA 的物理路径和 bridge symbol 保留原契约 |
| Webhook | 新 Bot 使用官方 header；旧 Drora 入站 alias 经 services/drora-extensions 的纯 adapter 收敛，冲突拒绝，用户自定义出站 header 保留；真实 Bot 服务与 HTTP 六项鉴权测试通过 |
| 宠物与下载 | 去掉 App 的重复宠物 hook 装配；补回 `pipeline`，无 curl 的真实流下载及中途断流两项通过 |
| 文件权限 | 两个 restore-legacy-sessions 脚本恢复官方 0755，冻结 CUA semver 文件保留原 0644，无残余 mode 差异 |

远控继续由官方 UI/manager/transport/Host attachment 持有控制状态；Drora LAN/Relay 仅在现有扩展装配，不增加 Agent、Host 或 CommandInbox。Webhook 兼容也在扩展边界，不把别名状态复制进多个业务模块。强制升级启动门控仍按既有决定移除。

## 验证

| 范围 | 结果 |
| --- | --- |
| 根类型 / lint / 全量架构 | 通过；395 warnings、0 errors；0 violation、0 baseline、0 new |
| CLI/TUI/Contracts/REPL/Debug 类型检查 | 全部通过 |
| 根 Vitest | 18,091 通过、21 跳过、0 失败；1,936 文件，含两项跳过文件 |
| 根 Node | 572 通过、1 跳过、0 失败 |
| 完整 CLI | 511 通过、0 失败、0 跳过 |
| TUI / Contracts / REPL / Debug | 分别 230 / 340 / 51 / 18 通过 |
| Core 初次全套 | 3,898 通过、38 跳过、2 todo、0 失败；之后的 Core 窄入口修改经构建、REPL 与 CLI 集成检查覆盖 |
| Adapter 最终完整运行 | 2,020 通过、34 失败、4 跳过；失败全部逐项匹配原始官方源码/锁文件基线 |
| Bootstrap 最终完整运行 | 2,939 通过、17 失败、12 跳过；15 项与独立上游源码基线匹配，另两项为公网归档访问失败 |
| 工作流服务 / 跨进程 OAuth / 插件 | 完整文件分别 243 / 4 / 81 全部通过 |
| Agent / Server / Web / mobile-web / desktop | 构建通过，Main/Host/preload/sandbox/renderer 均产出；真实 prepare:agent-bundle 通过 |
| CLI 制品 smoke | 7 组全部通过，包括 startup 通知、plugins/skills/commands/doctor、工作流和核心工具 |
| Relay / 知识库 | 真实回归通过；其它未改动包的原生 runner 结果保留在证据目录 |

各运行有交集，计数不相加。完整检查发现的时序和夹具问题保留了失败报告，修复后分别复核：授权 URL 在事件发布后断言；并发授权与兄弟取消用明确屏障建立现场；TUI 超时必释放 renderer；CLI 文件并行度为 2，原超时/断言不变；非 Git 夹具隔离边界外的沙箱占位；Linux Z 状态确认已终止，不把运行/阻塞进程放行；本地插件夹具只模拟可选图标，真实 HTTP/Git 与图标专项断言不变。

入口 `pnpm test:upstream-cli` 从实际 workspace 发现包并逐包执行原生 test script，可传包名，日志在 `.drora-cli-test-results` 或 `DRORA_CLI_TEST_OUTPUT`。任何失败返回非零，没有白名单豁免、删除断言或全局 skip。云环境设置草稿已保存 revision 7，包含新增构建/验证入口及冻结 seed 权限恢复。

## 上游基线与验收边界

34 项旧 runner-options 失败逐项匹配原始官方源码、原始测试与官方 frozen lock 的运行（53 项：8 通过、45 失败）。当前已迁移部分夹具，因此本地失败数减少；没有恢复已移除的 capabilities/ref/request-budget 运行时来满足旧测试。

15 项 Bootstrap 失败逐项匹配品牌目录映射后的官方源码/测试独立重放，依赖明确为 Drora 的锁定依赖。283 个源码 blob 有 provenance 记录；该次 570 项运行 554 通过、16 失败，其中 Provider 展示夹具已修复。另运行真实官方 frozen lock，325 项中 280 通过、45 失败，部分受 `/home/agent/.zcode` 写入限制影响；不把这些附加失败当作语义基线。失败仍留在 runner 和逐案例台账中。

两个 GitHub 导入用例保留非零失败：Git ls-remote 可达不能证明实际使用的公网 ZIP 归档可达；原有不可达早退也不能计为功能通过。本地导入、真实本地 Git 和归档解析/来源安全回归通过。官方 CDN 的先前探测在代理 CONNECT 阶段被拒绝，未获得 CDN 自身状态码。

官方云 Relay 服务端未公开；公网 CDN 制品与 Drora 扩展的实际兼容、SSH/WSL/Docker 真部署、真机手机、macOS/Windows Helper/签名安装及新版发行 bundle parity 未在此环境验收。公开源码迁移和本地构建不代表这些发行/平台验收完成。自建发行源需使用 Drora 自己构建的 manifest/components。

## 差异台账

固定上游 11,737 个变更路径重新读取当前工作树，保存上游 blob/mode 与本地内容 SHA256：5,848 字节相同、5,443 品牌归一后相同、2 空白差异、420 文本差异、16 上游删除且本地不存在、8 有意不在原位置。没有差异二进制、残留上游删除路径或 mode 差异。品牌相等只作筛选，外部 URL/header 已单独核验。

420 个文本差异包含改名例外、Drora 既有扩展、公开占位与冻结 CUA 的差别、文档/锁文件、根 workspace 编排及本轮测试夹具。沿用原逐模块审查，补齐部分的实现、spec 与测试对应关系如上；原始 diff/provenance 在证据目录。8 个缺位分别为冻结 CUA tsconfig、强制升级源码/测试四项、替换成 GitHub feed 的 ManifestUpdateProvider 源码/测试两项、迁址的 Gen UI 契约测试。它们都有既有迁移/改名 spec 依据。
