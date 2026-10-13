# ZCode v3.15.1 完整性复核记录

日期：2026-10-13（Asia/Shanghai）。审查对象：Drora `4831598b` 对官方 `aac4755666d09fdcd70272fcf063c077a639015f`；官方旧基线 `29628c9acdb81b703bbd4080c207a0e7ce5e276e`。审查时上游 main 未变化。

补齐前结论：主链源码已迁入，但有打包接入、外部契约和 CLI 验收缺口。本页保留 `4831598b` 审查时的复现；这些确认缺口已在后续补齐。当前结果、上游基线与未验收边界见 [补齐验收](zcode-v3.15.1-followup-result.md)。

## 全量路径检查

独立读取三侧 Git tree/blob，按改名目录映射覆盖官方全部 11,737 个变更路径；没有使用 merge ancestry 作为完整性证明。

| 分类                 |  数量 |
| -------------------- | ----: |
| 字节相同             | 5,849 |
| 宽泛品牌归一化后相同 | 5,472 |
| 空白归一化后相同     |     2 |
| 文本差异             |   390 |
| 官方删除且当前不存在 |    16 |
| 不在映射原位置       |     8 |

品牌归一化只用于筛选：它会掩盖外部路径/header 被改名的问题。生产源码的对外字符串另行核查。8 个原位置缺失对应已移除的 force-update 门控、替换的云 manifest feed、保留的 CUA 0.6.3 资产形态及迁址的 Gen UI 契约测试，均有迁移策略依据。

未发现 MCP Apps/Visualize、Gen UI、workflow hole/fill/save、辅助对话、Bot topic/channel、官方 Web/manager/transports/Host attachment 的整块源码遗漏。此结论不代表全部运行行为或平台已经验收。

## 确认缺口

| 编号 | 优先级 | 证据与影响                                                                                                                                                                                        | 对应批次 |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| U01  | P1     | desktop prepare-agent-node-bundle 对 Android/iOS 设置 requiresRuntime=false，workspace 又排除两包，dist 均不存在。真实 staging 函数在隔离输出目录分别报 missing staged official plugin seed asset | A        |
| U02  | P1     | 官方域名下的发布根被改为 /drora/electron/releases。生产默认 resolver 实际返回该路径，偏离官方 /zcode/electron/releases；影响无覆盖配置的远端资源来源                                              | B1       |
| U03  | P2     | Web workspace-bridge/mobile-view-state 两个 HTTP 请求使用 X-Drora-Mobile-Connection-Id，而官方为 X-ZCode-Mobile-Connection-Id。raw Relay/LAN 测试未覆盖该 HTTP 分支                               | B2       |
| U04  | P3     | 新推荐提示的 Guide 图标把官方对象 key assets/zcode-guide/icon.png 改为 assets/drora-guide/icon.png                                                                                                | B1       |

公网探测在代理 CONNECT 阶段收到 403，未得到 CDN 自身响应。U02/U04 已证明地址偏离官方实现，没有声称 CDN 自身返回 404。U03 没有在未公开的官方云 Relay 服务端复现拒绝。

## CLI 验收缺口 V01

从 Bootstrap cwd 重新执行 `session-persistence.test.ts`、`v4-cold-resume.test.ts`、`v4-gateway.test.ts`：**188 项，178 通过，10 失败，0 跳过**，退出码 1。

| Suite               | 失败数 | 需要定性的问题                                              |
| ------------------- | -----: | ----------------------------------------------------------- |
| session-persistence |      6 | Shell snapshot、启动迁移通知、严格配置 schema、恢复消息数量 |
| v4-cold-resume      |      3 | Durable selection、旧 fork/transcript 模型与 thought DTO    |
| v4-gateway          |      1 | 旧 revision retry/file rewind 的 stale ACK                  |

根 Vitest include 不包含这批 CLI tests。前次根套件 18,070 通过不能替代 CLI 结果。此前 [runner-options 上游证据](zcode-v3.15.1-runner-baseline.json) 只覆盖那个套件，且依赖为 Drora 当前锁定依赖；不能据此把其余失败统称上游问题。完整 CLI 失败仍需按方案 C 定性。

本轮 typecheck 通过、Lint 395 warning/0 error、全量架构检查 0 violation/0 baseline/0 new；没有重跑完整根套件或完整安装包构建。

## 既有问题

| 编号 | 问题                                                                  | 已有证据                                                                                                                                           |
| ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01  | UI 新建 Webhook 配置 x-drora-bot-secret，HTTP 只取 x-zcode-bot-secret | 真实 HTTP server + 最小服务记录器：官方 header 200/secret 已转发，Drora header 401/未转发；状态由记录器依据收到 secret 返回，不是完整 Bot 服务联调 |
| E02  | App 两次调用相同 useDesktopPet                                        | 两处装配均在 82b02c1 已存在；独立 listener/timer/publish                                                                                           |
| E03  | prebuild fetch fallback 缺 pipeline import                            | 82b02c1 已存在；本轮没有执行 curl 不可用分支                                                                                                       |

这些问题在迁移前存在，独立处理，不记作新增上游回归。

## 证据保存

当前云工作区详细证据在 `/workspace/upstream-analysis/zcode-v3.15.1/audit/`：`inventory.json` 含三侧 blob SHA/mode，`staging-reproduction.json`、`cdn-default-reproduction.json`、`cdn-probes.json`、`cli-selected-result.json` 和各验证日志支持上述结果。该目录是本次运行证据，未作为仓库依赖；后续批次把必要的稳定回归和逐项基线证据落入测试及 docs/upstream，不复制整个临时 checkout。

仍未验证：新版官方发行 bundle parity、官方云 Relay 服务端、macOS/Windows 签名和原生 Helper、真实手机后台恢复、真实模型/OAuth。公开源码、本地功能、平台与发行验证分别记录。
