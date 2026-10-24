# 双 CLI 运行时对比验证报告（zcode.cjs vs drora.cjs）

- 日期：2026-10-20
- 方法：不以静态报告为准，实际拉起两侧 CLI 逐面对比。官方侧 `D:/software/zcode/resources/glm/zcode.cjs`（CLI 0.16.9，桌面 3.14.3），本仓侧 `apps/drora-cli/packages/cli/dist/drora.cjs`（与 `packages/desktop/bundled-agents/win32-x64/glm/drora.cjs` 同一构建）。
- 复核对象：`.upstream-parity/upstream-parity-report.md`（2026-10-19，11 批次静态调研）的结论，加上本轮独立运行时证据。
- 探针脚本（临时，不入库）：`%TEMP%/zcmp/probe.mjs`、`probe-all.mjs`、`probe2.mjs`。

## 1. 运行时证据汇总

| 对比面 | 方法 | 结果 |
| --- | --- | --- |
| 顶层 `--help` | 全文 diff | 仅 4 处品牌差异（名称/Usage/协议名/版本号），选项、子命令、斜杠命令帮助逐字一致 |
| `version` / `doctor` | 实跑 | 字段与格式一致；版本号 0.16.9 vs 0.0.1（发行策略，非能力） |
| `commands list` / `skills list` / `plugins list --json` | 实跑（空仓 cwd） | 行为一致；plugins --json 条目 schema 17 字段完全相同 |
| 错误文案 | 4 种非法输入（未知子命令/未知 flag/commands inspect 不存在/plugins 未知动作） | 逐字节一致，仅品牌词不同 |
| 协议方法全集 | 从 `packages/shared/src/drora-protocol/index.ts` 提取 106 个方法名，双端 app-server 空参探测，按 JSON-RPC 错误码分类 | **106/106 分类完全一致**：3 ok（runtime/capabilities、session/list、process/childProcesses）、74 -32602（存在待参）、2 -32603、27 -32601（两侧同为未注册集，均为 host/surface 侧方法） |
| 带参响应结构 | plugins/list、plugins/overview、plugins/listUiSurfaces、mcp/list、skills/referenceCatalog、usage/stats、workflows/list、session/list（同参） | **8/8 响应字段结构一致**（shape 签名相同） |
| 键族 | `scripts/check-bundle-key-parity.mjs` + `.upstream-parity/capability-sweep.mjs` | env 67/67、meta 4/4、permission 1/1、diag 94/94、hooks 7/7、权限模式 11/11、CLI 子命令 6/6、静态协议方法 56/56 全部 identical，脚本退出码 0 |
| 工具面 | sweep 成员检测 | 官方 41 工具名全部在位；本仓多 7 个自研（TeamTask×6、VaultSearch） |
| 斜杠命令 | sweep | 官方 20 个全在位；本仓多 `/team`（自研） |
| SQLite | sweep | 官方 24 表全在位；本仓多 `evidence_receipts`（自研） |
| 遥测 | sweep | 官方 137 vs 本仓 133；官方独有 4 条：`client_signing`×3（=GAP-2）、`zcode.chatglm.site`（见 §3） |
| OAuth 设备码 | bundle 字面量 | `${t}/oauth/cli/init` / `poll` 两侧都在（此前 sweep 的证据字面量写错导致误报"缺失"） |

## 2. 确认的真差距（与 10-19 报告一致，本轮独立复核维持）

### GAP-1：自研 `/team` 在 TUI/headless 面报 Unknown command（自研接线问题，非官方能力缺失）

源码证据（本轮复核）：
- `apps/drora-cli/packages/cli/src/command-center/slash-commands.ts` 全文 0 处 `team`（parseSlashCommand 无分支）；
- `create.ts:208-234` 仅有 `/init`、`/workflow` 的原文回交先例，无 `/team`；
- facade 侧 `bootstrap/src/builtin-prompt-command.ts:74` 与帮助表 `packages/shared/src/drora-slash-command-help.ts:202-206` 均已注册 team。
- 官方 zcode.cjs 无 `/team`，此差距不构成"落后官方"，属自研功能三面（facade/TUI/headless）不一致。

### GAP-2：V4 客户端请求签名未还原（唯一落后官方 bundle 的能力面）

本轮 bundle 复测：`X-Client-Sig`、`X-Client-Pow`、`c1f3a7e2`、`client_signing`、`requiresClientRequestSigning` 在官方 bundle 全部命中，本仓 bundle 全部 0 命中；`packages/adapters/src/model/request-security-edition/index.ts:6` 仍为直通占位。配套遥测差 3 条 `zcode.model_attempt.client_signing*` 指标，与本缺口互为印证。缓解事实与"不做伪还原、补 spec 决策记录"的处置建议不变（官方为 bundle-only 实现，开源 3.15.1 源码同样没有）。

## 3. 本轮甄别结论（新证据）

| 项 | 结论 |
| --- | --- |
| `zcode.chatglm.site` 遥测差 | 官方备用 web/relay 域（`wss://zcode.chatglm.site/ws` 分流 + origin 白名单）。本仓收敛为恒定 `wss://zcode.z.ai/ws`，由 `specs/mobile-relay-server.md` 自建托管改造记录覆盖 → **有意分歧，非缺口**。外观注记：drora bundle 白名单出现重复条目 `["https://zcode.z.ai","https://zcode.z.ai"]`，无行为影响 |
| `/api/v1/oauth/cli/init` "两侧都无" | 误报。实际字面量为模板串 `` `${t}/oauth/cli/init` ``，两侧均在 → **OAuth 设备码流程对齐** |
| headless 真实模型链路 | **两侧均未跑通，无法运行时对比**：zcode 侧 `Model creation failed`（其凭据/模型配置失效）；drora 侧 `Select a model before continuing`——桌面保存的 `model.main = "builtin:bigmodel-coding-plan/GLM-5.3-Flash"` 带 `builtin:` 前缀，独立 CLI 的 modelSelectionConfigRepository 解析不到默认选择。疑点：zcode 独立 CLI 能走到模型创建（读的是 `zai-coding-plan/glm-5.3` 标准格式），drora 独立 CLI 在等价场景缺默认模型 → **待办观察项 O-1**：确认 standalone CLI 对 `builtin:` 前缀模型的默认解析是否应支持，或桌面写入 config 的模型 id 格式是否应改为 standalone 可解析形式 |

## 4. 最终差距结论

对照 zcode.cjs 全部能力域（CLI 入口、子命令、斜杠命令、41 工具、权限、hooks、MCP、插件/marketplace、skills、SQLite 存储、compact、协议 v1/v4、API/OAuth、可观测性）：

1. **落后官方的能力缺口仅 1 项：V4 请求签名（GAP-2）**，且属官方 bundle-only、无开源对照实现，处置为 spec 决策记录而非伪还原。
2. **GAP-1（/team 接线）是自研功能内部不一致**，不是对官方的落后；TUI/headless 面失效，facade 面正常。
3. 本仓为官方严格超集：多 7 工具、1 斜杠命令、1 表、bundled skills（agents-team、create-pet 等），均有 spec 依据。
4. 键族/文案/协议/存储四层经独立运行时复核全部一致；新增观察项 O-1（standalone 默认模型解析）待甄别。
