# GLM 对拍 pass27 战役计划（2026-10-08）

## 目标

以 `D:\software\zcode\resources\glm\`（zcode.cjs 0.16.9，Sep 22 构建）为唯一真值，
对当前检出 `feat/migrate-remote-and-pet`（HEAD 3cecb3c3）的 CLI 实现
（`apps/drora-cli/packages/*` + `packages/shared|rpc|client`）做全域静态差距收集，
产出最终差距清单与修复对齐报告。

## 真值侧资产

| 资产 | 路径 | 说明 |
| --- | --- | --- |
| 主 bundle | `D:\software\zcode\resources\glm\zcode.cjs` | 14.8MB 混淆 CJS；符号短名但字符串/方法名/JSON 字面量可 grep |
| 内置插件明文源码 | `D:\software\zcode\resources\glm\packages\` | 15 个包未混淆，可直接读：browser-use/documents/image-search/ios-simulator/android-emulator/node-repl-host/pdf/plugin-creator/presentations/restore-legacy-sessions/skill-creator/spreadsheets/zcode-cua/zcode-guide/bundled-skills |
| 模型目录 | `D:\software\zcode\resources\glm\provider\zcode-builtin.json` | revision 30，providerConfigRules |
| 打点副本 | `D:\software\zcode\resources\glm\debug\zcode-debug.cjs` | 带日志补丁，可交叉定位 |

## 我方侧资产

`apps/drora-cli/packages/`：adapters / bootstrap（drora-protocol、drora-protocol-v4）/ cli（command-center）/ contracts / core（agent、compact、mcp、memory、hooks）/ dynamic-workflow(-runtime) / telemetry / tui / i18n / node-repl-host / bundled-skills / browser-use-plugin / superpowers-plugin。
共享层：`packages/shared`（协议）、`packages/rpc`、`packages/client`。

## 批次 × 域分工（每批 2 员）

| 批 | 员 | 域 | 报告文件 |
| --- | --- | --- | --- |
| 1 | A1 | RPC wire 方法面（v1+v4、错误码、信封） | parts/b01-rpc-methods.md |
| 1 | A2 | CLI 命令面（slash/隐藏命令/flags/help） | parts/b02-cli-commands.md |
| 2 | B1 | 工具注册面（ToolEntry/schema/描述） | parts/b03-tool-registry.md |
| 2 | B2 | 工具执行面语义（bash 解析/文件/web） | parts/b04-tool-execution.md |
| 3 | C1 | 系统提示词（ContextBuilder 全段） | parts/b05-system-prompt.md |
| 3 | C2 | 子代理面（Task/Explore/embedded 提示词） | parts/b06-subagents.md |
| 4 | D1 | 会话/回合机（modes/steer/queue/busy） | parts/b07-session-turn.md |
| 4 | D2 | checkpoints/rewind/快照恢复链 | parts/b08-checkpoints.md |
| 5 | E1 | 压缩链（auto/manual/microcompact） | parts/b09-compaction.md |
| 5 | E2 | memory 链（抽取/索引/注入） | parts/b10-memory.md |
| 6 | F1 | 插件宿主（加载/重入/隔离） | parts/b11-plugin-host.md |
| 6 | F2 | 插件商店与 15 内置包对位 | parts/b12-plugin-market.md |
| 7 | G1 | MCP 面（pool/桥/schema） | parts/b13-mcp.md |
| 7 | G2 | skills 发现与命令装配 | parts/b14-skills.md |
| 8 | H1 | 权限/审批（kinds/规则/V4-PR） | parts/b15-permissions.md |
| 8 | H2 | hooks（trust/生命周期/授权） | parts/b16-hooks.md |
| 9 | I1 | provider/AI SDK（目录/签名/序列化） | parts/b17-provider.md |
| 9 | I2 | env/config/settings/存储 schema | parts/b18-config-env.md |
| 10 | J1 | 遥测/usage/诊断（OTel/rollout） | parts/b19-telemetry.md |
| 10 | J2 | dynamic-workflow（工具/DAO/运行时） | parts/b20-dwf.md |
| 11 | K1 | browser-use/js REPL（VM/broker/CDP） | parts/b21-browser-repl.md |
| 11 | K2 | 附件/图片/office 渲染链 | parts/b22-attachments.md |
| 终 | 主控 | 汇总去重定级 | 99-final-report.md |

## 判定纪律（全员必须遵守）

1. 证据只写键路径 / 文件:行（bundle 用字节偏移或 grep -n 行号）/ ≤20 字短摘；禁止整段原文抄录。
2. 方法面 grep 必须字面串 + 常量表双搜；`grep -c` 数行不数次。
3. 结论三分类：真值有我方无（REAL-GAP）/ 我方有真值无（EXTRA）/ 双侧同名形异（SHAPE-DIFF）。不确定的写 OPEN-QUESTION，不许静默翻案。
4. 级别：P1=功能缺失或行为性破坏；P2=形状/参数/时序差；P3=文案、诊断面等低危。
5. 只读对拍：除自己的报告文件外不得改动任何代码与共享文件。
6. 命名独占：本战役只写 `docs/glm-parity-pass27-2026-10-08/`，不碰其他 docs 目录。
