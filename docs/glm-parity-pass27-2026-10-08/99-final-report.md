# GLM 对拍 pass27 终稿：差距清单与修复对齐报告（2026-10-08）

真值：`D:\software\zcode\resources\glm\zcode.cjs`（0.16.9，Sep 22）+ 15 个明文内置插件包 + `provider/zcode-builtin.json`(rev 30)。
我方：`feat/migrate-remote-and-pet` @ 3cecb3c3，`apps/drora-cli/packages/*`。
方法：11 批 × 2 员 = 22 份零件报告（`parts/b01~b22`），全程静态对拍、只读、零代码改动。

## 一、总台账

| 域（报告） | REAL-GAP | EXTRA | SHAPE-DIFF | P1 |
| --- | --- | --- | --- | --- |
| b01 RPC 方法面 | 0 | 0 | 3 | — |
| b02 CLI 命令面 | 0 | 3 | 5 | — |
| b03 工具注册面 | 1 | 0 | 0 | 1 |
| b04 工具执行面 | 2→1 | 1 | 5 | — |
| b05 系统提示词 | 1 | 2 | 4 | — |
| b06 子代理面 | 1 | 1 | 1 | — |
| b07 会话/回合机 | 0 | 0 | 2 | — |
| b08 checkpoints/rewind | 0 | 1 | 3 | — |
| b09 压缩链 | 1 | 0 | 1 | — |
| b10 memory 链 | 4 | 0 | 4 | 1† |
| b11 插件宿主 | 2 | 3 | 6 | — |
| b12 插件商店 | 4 | 2 | 4 | 1 |
| b13 MCP | 0 | 1 | 1 | — |
| b14 skills | 1→0（销案） | 2 | 3 | — |
| b15 权限 | 2 | 0 | 1 | — |
| b16 hooks | 0 | 1 | 4 | — |
| b17 provider | 5 | 2 | 3 | 2 |
| b18 config/env | 9 | 2 | 4 | — |
| b19 遥测 | 2 | 0 | 0 | 1 |
| b20 dynamic-workflow | 0 | 0 | 2 | — |
| b21 browser/REPL | 6 | 1 | 3 | 1 |
| b22 附件/图片/office | 1 | 1 | 3 | — |

† b10 的 P1（Memory 段尾句）终裁降为 P2（见 §六仲裁）。销案与合并后净账：**P1×5（族）、P2×11、P3×约 20、EXTRA×约 24（多为品牌改名/死声明）、销案×2**。

逐域小结：22 个域中 10 个域零 REAL-GAP（RPC、CLI 命令、会话/回合机、checkpoints、MCP、hooks、dwf、压缩链实质零、skills 销案后零）；核心运行链（turn 机、rewind、压缩、MCP、dwf、附件图片链、usage 统计）均为逐函数/逐字节级忠实移植。

## 二、P1 清单（5 族）

### P1-1 `Workflow` 工具条目缺失（b03+b20 双证，已主控复证）
`apps/drora-cli/packages/core/src/tool/handlers/index.ts` 中 `workflowToolEntry` 的 import（:71）与数组条目（:136）均被注释；而 `bootstrap/src/app/create-app.ts:771` 无条件注入 workflowPort、灰度门常开（runtime-tools includeWorkflow=true）。端口在、门常开、条目不存在 ⇒ 脚本工作流主链路对模型不可达。
**修复**：恢复条目与 import；真值该条目构造点不在 bundle 内（8 处按名引用，疑运行时装配），修前先用真值 CLI 实跑抓 tools/list 确认 schema 形状。

### P1-2 官方插件 12 包源码缺失（b12，b22 佐证）
`official-plugin-definitions.ts` 仍声明 14 插件（版本与真值逐一对齐），但 rootCandidates 指向的包不存在；打包链（prepare-agent-node-bundle.mjs、sea-official-plugin-assets.mjs）只嵌 browser-use-plugin/node-repl-host/bundled-skills ⇒ 生产 bundled 分区仅 2 插件，seed 对缺失包静默跳过，商店开箱目录较真值缺 12 项（含 office 四件：documents/pdf/presentations/spreadsheets，直接影响文档能力）。同族：claude-plugins-official 第二市场与 Claude 图标富化子系统整体缺失；drora-guide 0.2.0 落后真值 zcode-guide 0.3.0 一档。
**修复**：先取证官方 CDN marketplace.json 是否列全条目（若 CDN 全量下发则缺包影响降级）；否则按「vendor 同包同版逐字移植」既定裁决回迁 12 包。

### P1-3 Computer Use 运行时 stub（b21）
`packages/zcode-cua/index.js` 返回 "not available in this build"；但 js 工具描述逐字保留完整 CUA 指引 ⇒ 模型按描述调用必败。同根因：sharp 重编码链缺失、CUA meta 上限 16KB vs 真值 384KB。
**修复**：产品二选一——补迁移 CUA SDK（helper 安装/权限 broker/capture_app/sharp 链），或收敛 js 工具描述文本删 CUA 段（并与 P1-2 的 15 包对位一起裁）。

### P1-4 ClientRequestSigningV4 签名链整体缺失（b17，b19 遥测面佐证）
真值完整链：handshake（id.secret 凭据、HKDF+ed25519）、PoW（SHA-256 前导零）、七头（X-Client-Ts/Version/Sig/Session-Id/Nonce/App-Id/Pow）、feature gate（`/api/v1/agent/configs` 读 codingPlanSignature，TTL 1h）、拒绝重试 2 次后 bypass；遥测三件套（span 属性/事件/status sink）同样全缺。我方全仓 0 命中。受服务端 gate 控制属**定时炸弹**：gate 一开，官方套餐请求全拒。
**修复**：Wave 1 首项。先运行时取证 gate 现状（抓 `/api/v1/agent/configs`），再按真值栈移植签名链+遥测面。

### P1-5 内置目录 3 条 siteRules 半截改品牌（b17，主控三副本复证坐实）
我方 `config/provider/drora-builtin.json`（及 cli/dist、desktop dist 两副本）siteRules[28][35][36] 的 baseUrlMatch 被改成 `drora.z.ai`，而 providerRules 真实 baseUrl 仍是 `zcode.z.ai` ⇒ 3 条规则永不命中 ⇒ start-plan/off-peak GLM 丢图片/视频 inputFormat 与 supportsNativeWebSearch（WebSearch 将抛 InvalidModelRequest）。
**修复**：3 处一行回退（`drora\.z\.ai` → `zcode\.z\.ai`），随即同步桌面打包副本。

## 三、P2 清单（11 项）

| # | 差距 | 证据 | 修复方向 |
| --- | --- | --- | --- |
| P2-1 | 子代理 profile permissionMode 解析收窄：真值 6 值宽枚举归一（bypass/dontAsk→yolo、acceptEdits→edit），我方只收 auto\|plan，其余静默回退父模式 | b06+b15 交叉证实，profile.ts:16 | 补归一映射函数，child runtime 本身已支持 |
| P2-2 | automation 任务模式 wire 枚举拒收 dontAsk/bypassPermissions/default | b15，automation-port.ts:225 | 同上族：补归一（→yolo/build） |
| P2-3 | hooks env 键 ZCODE_*→DRORA_*：为 zcode 生态写的第三方 hook 引用 ZCODE_* 静默取空（`${ZCODE_*}` 展开同失效） | b16 P2 | 产品决策：加 ZCODE_* 并行兼容键 vs 接受改名分叉并写 spec |
| P2-4 | env 双环境分流缺失：真值按 ZCODE_ENV 分 PRODUCTION/TEST 两套 endpoint，我方单链 | b18 P2 | 移植分流常量表（低优先，内部测试用途） |
| P2-5 | ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL 不进 provider SDK（仅 bash 白名单） | b18 P2 | 补 anthropic provider 凭据/baseURL 消费 |
| P2-6 | plugins/validate wire 缺 path 校验通道（真值可远程传 path，我方仅进程内） | b11 P2 | wire schema 补 validateZCodePluginPath 对位方法 |
| P2-7 | ProviderEndpointRoutingService 缺失（endpoint 快照刷新/30s 冷却/映射≤256；我方仅 OTel 脱敏器） | b19 P2 | 按 b19 偏移移植路由服务 |
| P2-8 | /model 缺 `main\|lite` 别名（真值 usage/details/footer 三处都有） | b02 | handler 补两别名 |
| P2-9 | EXTRA：`--enable-workflow` 旗标我方独有（真值走偏好键） | b02 | 裁决保留则写 spec 声明分叉 |
| P2-10 | EXTRA：CLI login 接受 `[zai\|bigmodel]` 位置参数（真值仅 Z.AI 流程无参） | b02 | 裁决同上 |
| P2-11 | Memory 系统提示词尾句缺「system-reminder 召回记忆须先验证仍存在」警示（真值 @4881080 活文本；semantic-recall 本体双侧同为死分支，行为等价） | b10（原判 P1）+b05（判 P3），终裁 P2 | sections/memory.ts 补一句，字节对齐 |

## 四、P3 汇总（约 20 项，按族归并）

- **品牌改名族**（有意分叉，写 spec 即可闭账）：协议名 Drora Protocol、externalTurnFault/日志命名空间 drora.*、artifact URI `drora-artifact://`、contentType、trust store 根 `.drora`、configFileKind 入 digest、CLAUDE.md→AGENTS.md、输出目录 drora-agents、UA 残留 "Z Code@"（建议顺手清）。
- **文案/指引族**：Bash 输出丢失提示缺 TMPDIR 指引、磁盘满文案、help en/zh 条数真值自身不一致（对齐前先裁决基准）。
- **死声明/死代码族**：contracts 诊断码 7 个无发射点、SkillScope "admin" 死成员、applyPatch 契约 2 个未注册、shared/mcp.ts Linear/Figma/Sentry 遗留字段、v1 rewind 桥路由、checkpointRestored/retryNotice 死成员（双侧同形）。
- **NotebookEdit（b04 原 P2 终裁降 P3）**：真值 bundle 仅 2 次按名引用、无条目无定义，edit.ts 的 .ipynb 拒绝+指引文案双侧同形 ⇒ 属双侧共享的 UX 死胡同，非对拍差距；如要修属产品改进（真补 NotebookEdit 工具）。
- **其余**：drora-cua 凭据门控身份模式演进（有意）、playwright SEA 抽取器 EXTRA、离线包缺 README、render+30s 外层超时（增值）、错误码 -32002/-32042 未命名（SDK 层等价）。

## 五、历史基线翻案/闭合清单（本轮实证，旧结论作废）

1. 提示词构造器非「983 行 14 段」：0.16.9 为 13 段模块化 builder（b05 偏移地图为准）。
2. `alignment-probe` 子代理类型在 0.16.9 不存在；agent 全集=general-purpose+Explore+Markdown profile（b06）。
3. `sessionModeLedger` 双侧均不存在（b07）。
4. `restoreSnapshotTree` 全树覆写险案翻案：现行恢复只写 beforeContent/删文件（b08）；快照 24h/30d 之争不适用于 checkpoint（retentionDays 属 bash snapshot）。
5. 工具注册面 40 条目（非旧口径 28）；707 补全字典实为 @withfig/autocomplete 外部数据（b03/b02）。
6. -32002/-32042 属内联 MCP SDK 层，非应用协议面（b01/b13）；serverRequestId 透传、http/sse 半接线、bridge.ts:77 缺口全部闭合（b13）。
7. V4-PR `:*` 复合命令穿透双侧均不可复现；permission kind 枚举 bug 已修（b15）。
8. settings.json hooks 永无法授权案已修，trust 7 态链完整（b16）。
9. microcompact 阈值「149.4k」未复现：两侧同为 166k 推导；append-only 压缩半成品已不存在（b09）。
10. usage.delta fact 已发布、turn_usage 聚合列已真实写入、OTEL headers split 已修（b19）。
11. dwf 0019 迁移+256MB 子进程帽闭合（b20）；skills .js 说明符 FAIL 不复现（b14）。
12. 111 插件孤儿泄漏五件套双侧对齐（b11）；seed 裸写/i01 刷新持久化/guide 名错位收敛（b12）。
13. 图片 ref 水合、字节解码、附件 canonical 双向偏移等历史 P1 全部确认已修（b22）。

## 六、跨员仲裁记录

| 争点 | 双方 | 终裁 |
| --- | --- | --- |
| Memory 段尾句定级 | b05=P3 / b10=P1 | **P2**：活文本缺口但 recall 系死分支，今日行为影响低；字节对齐必补 |
| NotebookEdit 缺失 | b01=P2 REAL-GAP / b03=真值无条目 | **降 P3**：主控复证真值仅 2 次按名引用+ipynb 拒绝文案双侧同形，非差距 |
| OpenAI 容器技能序列化 | b14=P2 跨域移交 | **销案**：b17 裁决为 inlined @ai-sdk/openai 休眠能力，stock SDK 同内置 |
| siteRules 改品牌 | b17=P1 / 主控初查未见 | **坐实 P1**：JSON 点号转义致初查漏检；config/、cli/dist、desktop dist 三副本全中 |

## 七、修复 Wave 建议

- **Wave 0（速修，≤半天）**：P1-5 siteRules 三处回退（含两份打包副本同步）；P2-1/P2-2 两个模式归一函数；P2-8 /model 别名；P2-11 Memory 尾句；P1-1 Workflow 条目恢复（先 tools/list 取证 schema）。
- **Wave 1（结构性）**：P1-4 签名链移植（gate 运行时取证先行）+b19 遥测三件套；P2-7 EndpointRoutingService；P2-6 validate path wire；P2-5 ANTHROPIC_* 消费；P1-3 按产品裁决执行。
- **Wave 2（产品决策+生态）**：P1-2 12 包回迁 vs CDN 取证后定案；claude 市场与图标富化跟齐与否；P2-3 ZCODE_* 兼容键策略；drora-guide 0.3.0 随迁；EXTRA 三项（--enable-workflow、login 位置参数、协议名）写 spec 声明分叉或回退。
- 每项修复后跑 `pnpm typecheck`+`pnpm lint`+对应回归面板；涉及时序/远端的项按 AGENTS.md 附所有者与事件顺序图。

## 八、OPEN-QUESTION 汇总（按优先级）

1. 签名 gate 现状（运行时取证 `/api/v1/agent/configs`）——决定 P1-4 是现行故障还是定时炸弹。
2. 官方 CDN marketplace.json 是否列全 12 缺包——决定 P1-2 影响面。
3. 真值 Workflow 工具条目构造点与 schema（bundle 内无，疑运行时装配）。
4. `${ZCODE_BASE_URL}` 解析链、claude 图标 enrichment 等价性（b11 §7）。
5. 桌面域 gray 门取数来源（b20：CLI 面等价，宿主侧归属待桌面域对拍）。
6. 真值 SEA 下 playwright 解析机制（b21 运行时验证）。
7. persistent memory 模板字节 diff、Poppler 错误细分类位置（b10/b22）。

## 九、产物索引

- 计划：`00-plan.md`；零件报告：`parts/b01~b22-*.md`（22 份，含全部证据偏移）。
- 本战役零代码改动（纯只读对拍+文档），未跑 typecheck/lint（无代码变更）。
