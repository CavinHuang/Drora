# W01 阶段交付报告（W01_DELIVERY）

**工作单：** W01 — Spec 与 Obsidian 自动授权最小收窄　**日期：** 2026-10-10　**实现分支：** `feat/vaultview-impl`　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`（本工作单开工时 HEAD 为 `2df17a2c`，即基线 + W00 文档提交）

> 路径约定：`path:line` 相对实施工作树根 `D:/workspace/projects/Drora-vaultview-handoff/`。
> 诚实声明：下表所有命令均为本会话在实施工作树实际执行，退出码为真实值；未执行的验证逐项写明原因。本工作单未做 git add/commit/push（按交接纪律由脚本统一提交）。

## 1. 完成内容与真实代码证据

### 1.1 文件清单（全部改动，`git status --porcelain` 实测共 9 个文件）

| 文件 | 改动 | 作用 |
| --- | --- | --- |
| `specs/obsidian-knowledge.md` | 新增 | VaultView 2.0 目标 spec：状态所有者表（§1）、方案 C L0–L3（§2）、W01 权限策略（§3）、查询语义（§4，W02）、Evidence 语义（§5，W03）、验收矩阵 K-POL/K-HOOK/K-IDX…（§6）。未实现条款全部标注"未实现，属 Wxx" |
| `specs/obsidian-plugin.md` | 修订 | ① 原「Proma 式原生访问重构」PermissionRequest 条目追加 2026-10-10 收窄指针；② 新增「W01 自动 allow 收窄（2026-10-10 修订）」章节：收窄策略、matcher `Write|Edit` 真实边界（不得宣称拦 Bash/MCP）、L1 与未来 Proposal（L2）对照表、验收场景 17–21 |
| `apps/drora-cli/packages/obsidian-plugin/src/lib/paths.ts` | 新增函数 | `isPlainVaultMarkdownPath`（`paths.ts:63`）：独立可测的纯形状策略——每段非空、非 `.`/`..`、不以 `.` 开头（拒 `.obsidian/**`、`.hidden/**`、点文件），末段 `.md` 结尾（大小写不敏感）；尾点/尾空格/ADS 形状保守拒绝 |
| `apps/drora-cli/packages/obsidian-plugin/src/lib/agent-access.ts` | 新增函数 + 文案 | `AuthorizedVaultWritePath`（`:71`）与 `resolveAuthorizedVaultWritePath`（`:83`）：realpath 根包含判定 + 逐段 lstat 拒软链 + 纯形状策略 + 已存在目标必须普通文件；返回相对 **realpath 根** 的路径（修复 W00 §3.9 候选补丁 realRoot 拼写缺陷的根源）；SessionStart 注入文案同步收窄（`:135-137`） |
| `apps/drora-cli/packages/obsidian-plugin/src/hooks/permission-request.ts` | 收窄 | `resolveWriteAuthorization` 改用 `resolveAuthorizedVaultWritePath`（`permission-request.ts:40`）；文件头 docstring 写明真实边界：只在基础判定为 ask 且工具为 Write/Edit 时触发，Bash/node_repl/MCP 写盘不经本 hook，不能也不宣称能阻断（`permission-request.ts:5-17`） |
| `apps/drora-cli/packages/obsidian-plugin/test/permission-path-policy.test.mjs` | 新增 | 18 个 node:test 用例：纯形状策略、防逃逸解析、UNC/`\\?\`/相对 cwd/Unicode/大小写/软链+junction/穿越/缺失坏配置（详见 §2） |
| `apps/drora-cli/packages/obsidian-plugin/test/hooks-e2e.mjs` | 扩充 | 新增 2 组 stdin/stdout E2E：根内 `.obsidian/**`、`.hidden/**`、点文件、非 Markdown → 静默；相对路径缺 cwd / 根外 cwd → 静默；SessionStart 断言收窄后诚实文案 |
| `apps/drora-cli/packages/obsidian-plugin/test/agent-access.test.mjs` | 扩充 | SessionStart 上下文断言补充收窄口径（`普通 .md 笔记` + `不能约束 Bash、MCP 等其他写入通道`） |
| `apps/drora-cli/packages/obsidian-plugin/package.json` | 修订 | `test` 脚本接入新测试文件：`agent-access && permission-path-policy && hooks-e2e`（CI `pnpm --dir … run test` 同款链路） |

### 1.2 逐项完成状态（对照工作单 4 项）

1. **新增 `specs/obsidian-knowledge.md`** —— 完成。含状态所有者（§1 表：vault-config.json / vault-focus.json / 索引【W02】/ Receipt【W03】/ Proposal 账本【W06】）、方案 C（§2，L0–L3 与 W00 P0/P1/P2 映射）、权限策略（§3）、查询与 Evidence 语义（§4/§5）、验收矩阵（§6）。**同步更新 `specs/obsidian-plugin.md`**，明确现有 allowAgentWrites hook（L1）与未来 Proposal（L2）的区别（对照表 + 验收场景 17–21）。
2. **自动 allow 最小收窄** —— 完成。判定链：`permission-request.ts:21 main` → `resolveWriteAuthorization`（配置有效 + allowAgentWrites + 工具名白名单，`:31-39`）→ `resolveAuthorizedVaultWritePath`（`agent-access.ts:83-116`：相对路径必须有 cwd `:94-96` → realpath 根包含 `:98-101` → 纯形状策略 `:105` → 逐段 lstat 拒软链 `:108` → 已存在目标必须普通文件 `:110-115`）；任何异常/不满足 → null → hook 无输出 exit 0，交回 Runtime 默认问询。绝不 fail-open 到 allow，绝不 exit 2。
3. **独立可测路径策略 + 全场景覆盖** —— 完成。形状策略为无 IO 纯函数（`paths.ts:63`）；解析策略独立成函数返回结构化结果。覆盖矩阵见 §2 测试表与 spec §6 K-POL-1..5。
4. **Hook 仅匹配 Write/Edit 的真实边界** —— 完成。边界写进两处 spec（`specs/obsidian-plugin.md`「matcher `Write|Edit` 的真实边界」、`specs/obsidian-knowledge.md` §2）与 hook docstring；全仓 grep 复查 UI/技能无夸大宣传：`VaultView.tsx:696` 的"阻断"指引用链路与本 hook 无关；`skills/obsidian/SKILL.md:17` 表述为"Writes may require user confirmation"（准确，未修改必要）；SessionStart 注入文案已收窄并明示"不能约束 Bash、MCP 等其他写入通道"（`agent-access.ts:135-137`）。

### 1.3 T0 候选 Patch 对照（仅对照，未 apply——按工作单要求）

`docs/vaultview-agent-handoff/05_REFERENCE/CANDIDATE_PERMISSION_PATCH_DO_NOT_BLINDLY_APPLY.patch` 未应用。对照结论：

- **同等收窄已用更安全的方式实现**：候选补丁在 hook 内对 `relative(access.rootPath, authorizedPath)` 二次求相对——根为软链/junction/subst 时与 `resolveAuthorizedVaultPath` 的 realpath 基准错位，自动 allow 整体静默退化（W00 证据报告 §3.9）。本实现让解析函数直接返回相对 realpath 根的 `relativePath`（`agent-access.ts:71-79,103-107`），从结构上消除错位，调用方无二次 `relative`。
- **按 AGENTS.md 顺序落地**：先改 spec（`specs/obsidian-plugin.md` 2026-10-10 修订），后改代码；候选补丁"行为超前于 spec"的偏差（W00 §3.3）已消除。
- 候选补丁的其余语义（空 rel/隐藏段/`..` 段拒绝、仅末段 `.md`）与本实现一致，并有测试锁定。

## 2. 测试

| 命令/场景 | 环境 | exit code | 证据 |
| --- | --- | ---: | --- |
| `node scripts/check-workspace-freshness.mjs` | worktree 根，node v24.1.0 / win32 | **0** | `基线新鲜：feat/vaultview-impl…ahead 331 / behind 0` |
| `pnpm --dir apps/drora-cli/packages/obsidian-plugin run build` | 同上 | **0** | `tsc && node scripts/build-hooks.mjs`（构建即包含 tsc 全量类型检查） |
| `pnpm --dir apps/drora-cli/packages/obsidian-plugin run typecheck` | 同上 | **0** | `tsc --noEmit` |
| `pnpm --dir apps/drora-cli/packages/obsidian-plugin run test`（CI 同款，工作单指定） | 同上 | **0** | 三段全绿：`agent-access` 17 ok；`permission-path-policy` 18 pass / 0 fail / 0 skipped（node:test 汇总 `tests 18, pass 18, fail 0`）；`hooks-e2e` 11 ok（含新增 3 用例） |
| `node --import tsx --test apps/drora-cli/packages/obsidian-plugin/test/permission-path-policy.test.mjs`（交接纪律指定形式） | 同上 | **0** | 18 pass / 0 fail / 0 skipped |
| 软链/junction 权限探针（`node -e` symlinkSync file/dir/junction） | 同上 | **0** | `{"junction":"created","symlink":"created"}` —— 逃逸用例的断言真实执行，未被"无权限跳过"架空 |
| `git diff --check` | worktree 根 | **0** | 无空白错误 |
| `pnpm typecheck`（仓库根） | — | **未执行** | 按 W01 验证分工由统一脚本执行；本会话未重跑，不做预判 |
| `pnpm lint` / `pnpm architecture:check --changed` / 全量 `node --test` | — | **未执行** | 同上；注意 obsidian-plugin 本身在 pnpm workspace 与根 lint 之外（`pnpm-workspace.yaml` 排除、`.oxlintrc.json` 忽略 `apps/drora-cli`），根门禁不覆盖本包，包内质量由上三行命令保证 |

### 2.1 路径策略覆盖矩阵 → 用例映射（`test/permission-path-policy.test.mjs`）

| 要求场景（工作单 3） | 用例 |
| --- | --- |
| Windows UNC | `解析（win32）：UNC 形式目标 → 静默`；`\\?\UNC\...` 同拒；`\\?\C:\...` 扩展路径即使指向根内也保守静默 |
| 相对 cwd | 根内 cwd 放行（正反斜杠等价）/ 缺失空白非字符串 cwd 静默 / 根外 cwd 静默 |
| Unicode | `中文目录/会议笔记.md`、`ünïcodé-Ω.md` 原样放行，不做 NFC 折叠 |
| 大小写 | `.MD`/`.Md` 后缀放行；（win32）`NOTES/A.MD` 命中已存在 `notes/a.md` |
| 符号链接 | 根内软链文件 → 静默；软链/junction 目录逃逸 → 静默（本机两种链均真实创建，探针为证） |
| 路径穿越 | `notes/../..`、`..\..\`、根本身、根外绝对路径、NUL、空串 |
| 缺失/坏配置 | env 未设/空白、目录缺失、JSON 损坏、根被删、根是文件、`allowAgentWrites=false`（e2e 层） |
| 附加别名防御 | 尾点 `a.md.`、尾空格、ADS `a.md:hidden`、目录冒充 `x.md`、空段 `notes//a.md`、点文件 `.draft.md` 全部不自动 allow |

A30（合法 Markdown 编辑不回归）：e2e `PermissionRequest：根内写入 + allowAgentWrites=true → allow 决策` 与 `agent-access` 既有放行用例全部保持通过；`resolveAuthorizedVaultPath`（焦点链路用）未改动，UserPromptSubmit 11 项 e2e 无回归。

## 3. 评估和安全

- **Source 权限与数据出站检查**：本工作单不触及出站链路；hook 判定全部本地 fs 只读（lstat/realpath）+ 无网络。无凭据/全文/绝对路径落日志：静默路径零输出，allow 输出仅 `{behavior:"allow"}` 结构。
- **跨 Host / Runtime admission / 队列**：不涉及。hook 语义不变式保持：不持久化规则、逐次校验、deny 不可翻案、与 broker 竞速由 Runtime 负责（未触碰）。
- **Jev 真联调与数据集结果**：本工作单未涉及，未执行（默认关闭，符合 ADR #5/#11）。
- **模拟/Fixture 与未验证部分**：测试全部使用 `mkdtemp` 合成临时 Vault，未触碰用户真实 Vault；无 Mock/Spike 依赖（T0 patch 仅静态对照）。未验证：真实桌面打包态（ELECTRON_RUN_AS_NODE 重写后 hook 运行，属既有 bootstrap 套件范围，本工作单未重跑）、POSIX 平台行为（win32 专属用例以 `process.platform` 门控，POSIX 语义依赖 Node path 跨平台语义，未在 Linux 实测）。

## 4. 结果与门槛

- **通过的验收 ID**：A29（`.obsidian`、隐藏目录、非 md、软链与越界不能 auto allow——e2e + 单测双层证据）、A30（原正常 Markdown Edit 在现有权限语义下可用——既有放行用例零回归）。spec §6 的 K-POL-1..5、K-HOOK-1..3、K-DOC-1 同步标记"已实现"并附证据路径。
- **未通过/有条件通过**：无未通过项。根门禁四项（typecheck/lint/architecture/全量 node --test）按分工待统一脚本出数，本报告不代填结论。
- **GO/NO-GO**：W01 范围 **GO**（代码/测试/spec 全部落地，指定验证全绿）。重申工作单边界：本阶段不等于强制拦截一切写操作——Bash/MCP/js/yolo 通道不经本 hook（W00_TOOL_WRITE_MATRIX §3/§4），L2/L3 门控归 W00/W06。
- **回滚步骤**：`git checkout 2df17a2c -- specs/obsidian-plugin.md apps/drora-cli/packages/obsidian-plugin/` 并删除 `specs/obsidian-knowledge.md`、`test/permission-path-policy.test.mjs`、本报告；`dist/` 为 gitignore 构建产物无需回滚。
- **下一阶段建议**：W02 落地 `IKnowledgeIndexService`/`IKnowledgeQueryService` 时按 `specs/obsidian-knowledge.md` §1 状态所有者表接线（SourceRegistry 只由活动 Vault + Profile 推导）；索引收录判定直接复用 `isPlainVaultMarkdownPath` + 门面不变量，勿另写第二套路径规则。

## 5. 与工作单假设的偏差记录

1. **相对路径 + 缺 cwd 从"按根解析"改为"静默"**：原实现（`agent-access.ts` 旧注释）在 stdin 缺 cwd 时按 vault 根解析相对路径——与 Write handler 实际按工作目录解析（`core/src/tool/path-policy.ts:32-34`）错位时构成 fail-open。Runtime 契约 `cwd` 为必发字段（`contracts/src/hooks/index.ts:69`），生产合法流不受影响；对用户只有"多问一次"方向的偏差，符合"异常静默交回问询"的工作单要求。
2. **SessionStart 注入文案随收窄同步修订**（`agent-access.ts:135-137`）：原文"Vault 内的文件写入无需用户逐次确认"在收窄后不再准确；新文案明示只覆盖"非隐藏目录的普通 .md"且"不能约束 Bash、MCP 等其他写入通道"。属工作单第 4 项（不夸大宣传）的直接落实，两处测试断言同步更新。
3. **新测试采用 node:test 风格**（按交接纪律"沿用仓库 node:test 风格"），与包内既有自定义 `test()` 助手脚本并存于同一 `pnpm run test` 链；两种风格均以进程退出码表达结果。
