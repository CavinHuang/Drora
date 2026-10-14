# ZCode v3.15.1 二次合并复核

审查日期：2026-10-13（Asia/Shanghai）。本地 `11d92f9b`，官方 `aac4755666d09fdcd70272fcf063c077a639015f`。再次通过 `git ls-remote upstream refs/heads/main` 确认上游 main 未更新。

审查时结论：官方主要公开实现已经迁入，未发现新的主要功能整段遗漏；发现一处 CUA 资源完整性校验遗漏。此项不是技能文件未迁入，也不要求替换冻结 SDK。上次补齐验收结论需补充本项。

后续处理：用户确认官方实现优先后，R01 已补回宿主 Skill 校验，新增 filesystem/SEA、首次安装/已有完整缓存四个回归场景。修复前四项均复现失败，修复后相关 79 项插件测试通过；详见 [官方优先收敛结果](zcode-v3.15.1-official-first-result.md)。以下保留原始审查证据。

## 已确认问题 R01（P2）：Bootstrap 漏校验 Computer Use Skill

位置：`apps/drora-cli/packages/bootstrap/src/app/official-plugin-definitions.ts:74`，`OFFICIAL_CUA_REQUIRED_SEED_PATHS`。

官方清单要求 `skills/computer-use/SKILL.md`。本地清单保留 docs/client，并增加 package/sharp，但漏了该 Skill。当前冻结 0.6.3 中实际存在这个文件，manifest 也声明 `skills: "skills"`，因此保留旧 SDK 不构成移除此检查的理由。Desktop staging 的 `prepare-agent-node-bundle.mjs:288` 已要求它，并在注释中要求与 Bootstrap 同步，两个入口现在不一致。

本轮直接调用生产函数 `findMissingOfficialPluginSeedPaths`：输入含当前要求的四个路径、刻意不含 Skill。

| 校验输入                | 返回                               |
| ----------------------- | ---------------------------------- |
| 当前 Bootstrap 清单     | `[]`                               |
| 官方清单                | `["skills/computer-use/SKILL.md"]` |
| 当前冻结 Skill 实际存在 | `true`                             |

生产 `bundled-plugins.ts:113` 仅在 `missingSeedPaths` 非空时拒绝残缺插件、告警并保留旧缓存。当前 Bootstrap 因而无法识别这种缺损，可能缓存一个缺少 Computer Use 指导的插件。正常桌面包有独立 staging 检查，不能把该问题扩大为当前全部 Computer Use 不可用。

建议（已落实）：在 Bootstrap 清单补回该路径，保留 package/sharp 及 0.6.3 冻结资产；增加缺 Skill 的负向 seed 检查，并对齐 filesystem/SEA 与 desktop 清单。原始审查阶段没有修改产品实现。

复现记录：`/workspace/.drora-migration-v3.15.1/re-review/cua-seed-guard.json`。

## 覆盖与方法

重新读取固定上游所有 11,737 个变更路径及当前本地内容。分类仍为：5,848 字节相同、5,443 品牌归一后相同、2 空白差异、420 文本差异、16 上游删除且本地不存在、8 有意不在原位置；没有差异二进制、遗留上游删除路径或 mode 差异。

品牌比较只作筛选。对 149 个生产源码文本差异进行 TypeScript AST/叶 token 比对，另检查品牌替换涉及的 695 个字符串候选，尤其是 URL、HTTP header 和 IPC/wire 名称。候选有重复，不代表 695 个问题。HTTP `X-ZCode`/`X-Zcode` 的大小写差异不改变 header 语义；内部 IPC 改名也不能直接视为外部协议破坏。

检查函数/方法声明在原文件消失的 13 个候选，分别追踪到迁址模块、保留的 re-export，或已有明确的强制升级/更新 feed/S03 分歧；没有据此认定函数漏迁。仅靠 AST 相等、声明存在或编译通过不能证明完整运行行为。

本次未重复数万项测试来扩大计数。重新执行类型、lint 与全量架构检查；动态证据新增的是 R01 生产校验函数复现。上一轮全量测试、构建、CLI smoke 与 E2E 保留各自范围，详见 `zcode-v3.15.1-followup-evidence.json`。

## 主要实现复核

| 范围                      | 复核结果与有意差异                                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 手机远控                  | 官方 Web/UI、manager、device/browser transport、HTTP workspace/view-state 控制与 Host attachment 已迁入；本地部署端点和按 origin 的 auth storage 为 Drora 装配扩展。HTTP header 保留官方名称，未发现仅有 UI 而缺少公开客户端控制链的情况 |
| Host/窗口/跨 workspace    | 窗口 Host、远程连接注册表、attachment 与 generation/owner/lease 链路保留；额外 serverInfo 为扩展字段，没有另建 Remote Host                                                                                                               |
| Agent/v4/队列/恢复        | 官方 runtime/CommandInbox/admission/residency 路径保留；model-execution、session-finalization 和 schema helper 的差异是迁址/复用；Knowledge Evidence 接入现有执行入口，不引入第二套队列                                                  |
| Provider/Model/Highspeed  | 新 Provider/Model 接口和执行配置保留，CLI model/effort 默认保存已接回；没有为了旧测试恢复已删除的 Registry/capabilities/request-budget                                                                                                   |
| Gen UI/MCP Apps/Visualize | 公开服务、协议、renderer/iframe 集成与插件资产已迁入，非单纯界面占位；旧服务测试迁为独立契约测试                                                                                                                                         |
| Android/iOS               | 源码、workspace、开发构建及 desktop staging 已接入；前轮 cold MCP initialize/tools-list 通过，实际模拟器操作仍是平台验收                                                                                                                 |
| 插件/Skill/工作流/Bot     | 官方发现、缓存、市场、工作流和 Bot 路径已迁入；CUA guard 有 R01；Webhook 旧品牌入站 alias 为独立扩展                                                                                                                                     |
| 工作区 UI/终端/设置       | 大段 WorkspaceShellLayout 文本 diff 主要来自格式；真实新增主要是 Vault 装配，不等于原版侧栏/终端实现被旧文件覆盖                                                                                                                         |
| 权限                      | 官方主执行链保留；Plan MCP 写与 P0 宽泛 allow 被 S03 收窄，属于已记录的行为分歧，不能宣称这部分与官方完全相同                                                                                                                            |
| 更新/发行                 | 官方通用更新状态机保留；ManifestUpdateProvider 由 Drora GitHub feed 替代，启动强制更新门控有意移除；这些是替代/删除，不是逐字官方实现                                                                                                    |
| Computer Use              | 冻结 0.6.3 SDK/Helper 与身份/原生运行时继续保留，未用公开 0.6.4 占位包覆盖；R01 只涉及宿主侧完整性清单                                                                                                                                   |

49 项包级测试/实现不一致仍按上次逐案例基线记录保留，两项公网 GitHub 归档访问仍未通过。本轮没有把这些失败改成成功，也没有重新运行并声称它们消失。

## 当前检查与边界

- `pnpm typecheck`：通过。
- `pnpm lint`：395 warnings、0 errors。
- `pnpm architecture:check`：0 violation、0 baseline、0 new。
- 原始审查阶段未修改生产源码、依赖、冻结资产和 Git 提交，只新增此审查记录；后续 R01 修复见上方处理记录。

公开仓库没有官方云 Relay 服务端；当前所称“已迁入”指公开客户端/Host/协议实现与本地替代部署，不意味着合并了未公开服务。官方公网 CDN 制品兼容、SSH/WSL/Docker 真部署、真机手机、macOS/Windows 原生 Helper 与新版发行 bundle parity 仍保持未验收。
