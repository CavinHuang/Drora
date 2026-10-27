# ZCode v3.15.1 合并记录

日期：2026-10-13（Asia/Shanghai）。分支：`integrate/upstream-v3.15.1`。

## 基线与历史

Drora `82b02c1411a995a4c33080d5ea497b1477ae6ded`，官方旧基线 `29628c9acdb81b703bbd4080c207a0e7ce5e276e`，新基线 `aac4755666d09fdcd70272fcf063c077a639015f`。实施后再次读取远端，两边 main 均未变化。

产品改名导致直接 Git 合并有 4,107 个冲突路径；按改名及豁免规则做文件级三方迁移，逐模块处理人工冲突。先提交可审查的产品树，再用保留当前产品树的 merge commit 记录官方新基线祖先，避免下次把本次全部增量重新引入。未推送或发布。

## 接入边界

| 能力         | 官方实现与 Drora 扩展                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| 手机远控     | 官方 web/UI、manager、device/browser transport、Host attachment；当前使用官方 V2 端点装配，旧自建/LAN 复刻已删除 |
| 页面部署     | mobile-web 从 packages/web 构建当前版本资产；旧冻结件退出生产候选列表                                            |
| Vault/知识库 | services/knowledge 与 ui/v4/vault 独立保留；Host 通过 services 扩展公开入口装配                                  |
| CUA          | 保留已有 0.6.3 SDK/Helper 复原资产；公开上游 0.6.4 为占位包；惰性环境适配放入 services 扩展                      |
| 桌面宠物     | Desktop 生命周期扩展和独立 UI，沿用宿主设置                                                                      |
| 更新器       | 官方轮询、重试、替换和下载状态机；Drora GitHub 发布源及安装失败恢复独立接入；保留已移除的启动最低版本门禁决策    |
| 权限         | 采用官方最新输入与审批路径，最终输入仍通过独立 S03 写入分级复核                                                  |
| 新官方能力   | MCP Apps/Visualize、Gen UI、辅助对话、工作流修补与保存、Bot/远程连接/终端/Provider 更新采用公开实现              |

新扩展目录均有 module/contract/example/test/CONTRACT 和架构策略登记。外部 `zcode_type`、MCP `zcode/csp`、OAuth 回调和原始插件 seed 已按官方契约处理。完整性复核发现的 CDN 对象目录、手机 HTTP header 和 Guide 图标误改已修复；真实 HTTP 契约已复核。公网制品兼容与平台验收边界见 [补齐验收](zcode-v3.15.1-followup-result.md)。

## 公开实现的限制

公开仓库没有云 Relay 服务端。2026-10-22 已按用户决定删除自建/LAN 复刻；当前只保留官方 V2 客户端和已有 Host attachment。此前旧链路的历史验收不能作为当前云端联调证据。

没有可获取的新版发行 zcode.cjs，因此不能完成发行 bundle 字面量 parity。macOS/Windows 签名、原生 Helper 安装、真实手机后台重连及用户模型/OAuth 端到端需要对应平台或账户，未作为当前机器验证结果。

CLI 的旧测试存在上游自身漂移：单独复制官方 runner-options 源码与测试、仅做产品改名，53 项中 45 项失败、8 项通过。源码扫描去除注释后的 token 与合并实现一致，证据见 [基线记录](zcode-v3.15.1-runner-baseline.json)。失败主要仍使用已删除的 capabilities/ref/request-budget 等输入形态。保持新 Provider/Model 实现；没有为这些旧测试恢复已删除的 ModelCatalog/Registry 运行时。本次不宣称整个 CLI 旧套件通过。

## 验证

完整验证结果与命令见 [验证记录](zcode-v3.15.1-validation.md)。

当前状态：公开源码迁移补齐与本地集成验证完成。Android/iOS 构建/staging、外部契约和 CLI 缺口已处理；49 项上游测试/实现不一致与两项公网归档访问失败保持可见，不宣称整个 CLI 工作区全绿。结果与原始证据见 [补齐验收](zcode-v3.15.1-followup-result.md)。未推送或发布。

后续同步先固定新的官方 commit 与已有 ancestor，按 [迁移策略](../../specs/upstream-v3.15.1-migration.md) 对照各扩展端口。不要重新修改冻结资产或在 UI/Host 中建立第二个远控控制器和任务所有者。
