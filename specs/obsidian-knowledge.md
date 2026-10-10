# Obsidian Knowledge / VaultView 2.0 Spec

来源：交接包 `docs/vaultview-agent-handoff/05_REFERENCE/PROPOSED_REPO_SPEC_obsidian-knowledge.md`
（用户明确批准的目标方案）+ `01_RULES_AND_DECISIONS/ADR_AND_NONNEGOTIABLES.md`。按 AGENTS.md
「先 spec 后代码」落地本文件后，各阶段工作单（W01–W07）在自己的范围内实现并回填验收证据。

**实现状态标记**：本文各节标注【已实现】/【未实现，属 Wxx】。标注"未实现"的条款是目标
契约而非现状描述——在对应工作单落地前，不得在代码、UI 或文档中宣称其已生效。

## 0. 范围与产品边界

- 一个活动 Vault 的精确文章找回（FIND_ARTICLE）、问库/比较（ANSWER/COMPARE）、来源验证与
  原文回跳；后续阶段扩展 Jev 可选决策（W05）与审核写入（W06）。
- UI 唯一入口 VaultView；四视图：笔记、智能问库、洞察、审核。不新增 Knowledge 顶级导航，
  不重建编辑器（ADR #2）。【未实现，属 W04】
- 原 Markdown 是唯一事实源；Knowledge 索引可重建，不得改写笔记冒充事实（ADR #4）。
- Drora 是唯一产品主体；不新建独立桌面 Agent（ADR #1）。

## 1. 状态所有者

| 状态 | 所有者 | 其他方 | 证据 |
| --- | --- | --- | --- |
| Vault 配置（rootPath/displayName/inboxPath/allowAgentWrites） | `vault-config.json` 单文件（插件数据目录），由 `packages/services/src/obsidian-vault/` 门面写入 | hooks 与 SessionStart 上下文只读、每次询问重读 | `specs/obsidian-plugin.md`「形态与状态所有者」 |
| 会话焦点投影 | `vault-focus.json`（services 面板单写，7 天/50 会话修剪） | UserPromptSubmit hook 只读 | 同上「焦点上下文联动」 |
| Knowledge 索引（chunk/FTS/rowid） | 共享 SQLite（按 Profile + Source + Epoch 隔离），可重建缓存 | 跨 Host lease/fencing 防迟到提交 | 【未实现，属 W02】 |
| EvidenceReceipt / 引用账本 | 服务端 opaque receipt，绑定 session/run/sourceEpoch/fileSha/quote selector | 模型文字不得自行构造可信 citation | 【未实现，属 W03】 |
| L2 治理 Proposal 与批准账本 | Proposal + 人工批准 + 版本校验和持久账本 | 未批准/过期批准绝不写文件 | 【未实现，属 W06】 |
| Session / CommandInbox / Memory / 手机远控 | 复用现有 Drora 运行时 | 禁止复制第二套（ADR #7、交接纪律） | 不变 |

配置事实源唯一：Knowledge 链路的 SourceRegistry 只由当前活动 Vault + Profile 推导，
sourceEpoch 变化使旧 Query、Index Job、Receipt 失效；不得复制独立 Vault 配置
（交接纪律「禁止第二份 Vault 配置事实源」）。【未实现，属 W02】

## 2. 方案 C：分级写入（已批准风险方案）

ADR #8。风险分级与运行时落盘通道的映射以 `docs/vaultview/delivery/W00_TOOL_WRITE_MATRIX.md`
的 P0/P1/P2 分级为准绳：

| 层级 | 语义 | 当前状态 |
| --- | --- | --- |
| L0 只读 | 原生 Read/Glob/Grep 直接读 Vault（授权根内），不触及写路径 | 【已实现】（SessionStart 注入，`specs/obsidian-plugin.md`） |
| L1 经授权编辑 | `allowAgentWrites=true` 时，PermissionRequest hook 对根内**普通 Markdown 笔记**的 Write/Edit 权限询问自动放行（收窄策略见 §3） | 【已实现，W01 收窄】 |
| L2 知识治理 | 结构性/批量治理写（重组、批量改名、索引物化等）必须走 Proposal → 人工批准 → 版本校验和持久账本；重复 operationId 幂等 | 【未实现，属 W06】 |
| L3 高风险 | 默认不自动执行（Bash/MCP/js 等可旁路通道的强制写承诺） | 【永久默认关闭，除非真实 Runtime 审计通过（ADR #10）】 |

**明确的不变量**：hook 只匹配 Write/Edit，且只在运行时基础判定为 ask 时被触发。yolo/整工具
allow 规则/会话 allow 在 hook 之前短路；Bash、node_repl(js)、MCP server 进程内写盘完全不经过
PermissionRequest hook（实测证据：`docs/vaultview/delivery/W00_TOOL_WRITE_MATRIX.md` §3/§4/§8）。
因此：**不得在代码、UI、文档中宣称本插件 hook 能阻断 Bash/MCP 的 L2/L3 写入**——那是 W00/W06
的 Runtime 层门控议题，不是本插件的能力。L2 未落地前不存在"强制写入审核"。

## 3. 权限策略（W01 已实现）

PermissionRequest hook（matcher `Write|Edit`）的自动 allow 判定，全部满足才输出
`{behavior:"allow"}`；任何一条不满足或判定过程异常（IO 错误、坏输入、坏配置）一律**静默**
（无输出、exit 0），交回 Runtime 默认问询。绝不 fail-open 到 allow，也绝不 exit 2：

1. 插件数据目录可读且 `vault-config.json` 为有效配置、根真实存在（目录）；`allowAgentWrites=true`。
2. 工具名为 `Write` 或 `Edit`（matcher + 代码双重校验）。
3. `tool_input.file_path` 为非空字符串且不含 NUL。
4. 相对路径必须携带 stdin `cwd`（Runtime 契约必发，`contracts/src/hooks/index.ts:69`）；
   缺失/空白视为异常 → 静默。相对路径按该 cwd 解析——与 Write handler 的
   `resolveWorkspacePath` 语义一致（`core/src/tool/path-policy.ts:32-34`）。
5. 解析后的目标落在 `realpath(vault 根)` 内（拒绝 `..`、绝对路径与跨盘逃逸）。
6. 逐段 `lstat` 拒绝符号链接（根内软链把写入引出根即拒绝；Windows junction 同样命中）。
7. **普通 `.md` 明确授权**：相对根的路径（realpath 基准，`/` 分隔）每个段非空、不为 `.`/`..`、
   不以 `.` 开头（拒绝 `.obsidian/**`、`.hidden/**` 及点文件），末段以 `.md` 结尾
   （大小写不敏感，接受 `.MD`/`.Md`）。目标已存在时必须是普通文件（拒绝目录冒充）。
8. Unicode/中文文件名原样保留，不做 NFC/NFD 折叠（折叠会误伤合法路径）；Windows 保留名与
   大小写折叠行为遵循平台语义。

策略实现独立可测：形状策略为纯函数（`obsidian-plugin/src/lib/paths.ts` 的
`isPlainVaultMarkdownPath`），防逃逸解析为 `agent-access.ts` 的
`resolveAuthorizedVaultWritePath`（返回相对 realpath 根的路径，调用方不得再对原始 rootPath
做二次 `relative`——修复候选补丁在该处的 realRoot 拼写错位，见
`docs/vaultview/delivery/W00_EVIDENCE_REPORT.md` §3.9）。面板门面
（`packages/services/src/obsidian-vault/`）不变量不受影响：hook 收窄后与面板
`normalizeRelativeMarkdownPath` 的"仅非隐藏 `.md`"语义对齐，消除"W01 前 hook 对
`.obsidian` 与非 .md 自动 allow 而面板拒绝"的不对称。

**与未来 Proposal（L2）的区别**：L1 自动放行只覆盖"根内非隐藏目录的普通 .md 的 Write/Edit
ask 询问"，无持久化规则、每次询问重新校验、不可翻案 deny；L2 面向治理类/批量写，必须显式
Proposal + 人工批准 + 账本（W06），两者不共享放行路径，L1 的存在不构成 L2 的豁免。

## 4. 查询语义【未实现，属 W02/W04】

- FIND_ARTICLE 首先返回 3–5 篇候选及可核验证据（原文片段 + 位置），不默认写冗长总结（ADR #3）。
- ANSWER/COMPARE 只在有权威来源时经已有 Agent Session 生成；无模型/断网仍可浏览检索结果。
- 索引 partial、语义不可用（`semantic_unavailable`）、无答案都必须显式呈现，不编造标题/链接。
- 检索：中文 bigram 或经验证 tokenizer + 英文 BM25，MATCH 参数化；Embedding 走端口，
  不可用时显式降级。候选按 scope/sourceEpoch/runGeneration 隔离、去重聚合；模型不得扩展
  授权范围或日期筛选条件。
- 只索引现有安全门面接受的 Markdown；隐藏/软链/超配额排除并计入 coverage。

## 5. Evidence 语义【未实现，属 W03】

- 服务端创建 opaque EvidenceReceipt，绑定 session/run/sourceEpoch/fileSha/quote selector；
  打开引用与发送前再次验证授权与文件当前版本（改动 → `stale`，删除 → `missing`，
  切库/撤权 → `forbidden/stale`）。
- `# userselect` 的 `{text,path}` 不是 Receipt；模型文字不得自行构造可信 citation；点击前
  必须由服务端 resolveCitation。
- busy 排队期间源更改/撤权 → admission 不信任旧证据（复用 W00 S02 结论的接线点）。
- 本地检索默认可用；未经授权不把笔记正文或片段送 Jev/Embedding/回答模型（ADR #11）。

## 6. 验收矩阵（本 spec 范围）

证据规则：每项记录真实 command / environment / exit code；`NOT_RUN` 必须写原因。

| ID | 场景 | 期望 | 状态 |
| --- | --- | --- | --- |
| K-POL-1 | 纯形状策略：`.obsidian/**`、`.hidden/**`、点文件、非 .md、空段、`..`、空串 | 全部拒绝自动放行 | 已实现（`test/permission-path-policy.test.mjs`） |
| K-POL-2 | Unicode/中文文件名、`.MD` 大小写 | 原样保留并放行（平台大小写语义内） | 已实现（同上） |
| K-POL-3 | 防逃逸：根外绝对路径、UNC 路径、`\\?\` 扩展路径、`..` 穿越、根内软链文件/目录逃逸、已存在目录冒充 `.md` | 一律静默（交回问询） | 已实现（同上） |
| K-POL-4 | 相对路径带根内 cwd / 无 cwd / 根外 cwd | 放行 / 静默 / 静默 | 已实现（同上） |
| K-POL-5 | 缺失/坏配置：env 未设、目录缺失、JSON 损坏、根被删、根是文件、`allowAgentWrites=false` | 全部静默，不产生 allow 决策 | 已实现（既有 + 新增用例） |
| K-HOOK-1 | hook stdin/stdout E2E：根内 `.md` Write/Edit + allow → allow 决策，无持久化规则 | 结构化 allow，其余静默 exit 0 | 已实现（`test/hooks-e2e.mjs`） |
| K-HOOK-2 | E2E：`.obsidian/**`、`.hidden/**`、非 Markdown、软链、root 外、`allowAgentWrites=false` | 均不得自动 allow（静默） | 已实现（A29） |
| K-HOOK-3 | 合法 Markdown 编辑与既有默认问询不回归 | 根内 .md 仍 allow；其余行为不变 | 已实现（A30） |
| K-DOC-1 | matcher `Write|Edit` 真实边界写入 spec；代码/UI 不宣称能拦 Bash/MCP L2/L3 写入 | 文档与代码一致 | 已实现（本 spec §2 + `specs/obsidian-plugin.md`） |
| K-IDX-1..n | 索引/召回/中文检索/多 Host lease（A02–A05、A07） | 见 `04_ACCEPTANCE/ACCEPTANCE_MATRIX.md` | 未实现，属 W02 |
| K-EV-1..n | Receipt/stale/伪造 citation/admission 复验（A12–A19） | 同上 | 未实现，属 W03 |
| K-UI-1..n | VaultView 四视图（A01、A20–A22） | 同上 | 未实现，属 W04 |
| K-JEV-1..n | Jev 默认关闭/降级（A23–A28） | 同上 | 未实现，属 W05 |
| K-W06-1..n | Proposal 账本/幂等/conflict（A31–A34） | 同上 | 未实现，属 W06 |

## 7. 测试与日志边界

- 测试只用合成临时 Vault（`mkdtemp`），绝不修改用户真实 Vault；软链不可用平台（Windows 非
  开发者模式）跳过对应用例并以 junction 补目录逃逸覆盖。
- 日志不写笔记全文、凭据、绝对路径；hook 静默路径不产生任何输出。
- Jev 与一切外发默认关闭（ADR #5/#11）。
