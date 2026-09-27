# Obsidian 插件 Spec（复刻 Proma Vault 能力）

来源：`D:\workspace\projects\ai-projects\Proma` 的 Obsidian Vault 能力（`vault-service.ts` +
agent 集成），完整移植为 Drora 官方插件 `obsidian`（`apps/drora-cli/packages/obsidian-plugin`）。

## 能力边界

Proma 的 Vault 能力由三部分组成，本插件完整复刻前两部分；第三部分是 Proma 自有 UI 面，
不属于 Drora 本轮范围（Drora 桌面壳没有对应挂载点，若未来要做须按 DESIGN.md 另立 spec）：

1. **Vault 发现与配置**（复刻）：从 Obsidian 注册表（`obsidian.json`，win/mac/linux 三平台
   路径同 Proma）发现候选 Vault；支持配置一个活动 Vault（rootPath、displayName、inboxPath、
   allowAgentWrites）；提供插件数据目录下的托管 Vault（无 Obsidian 的用户也能用）。
2. **安全 Vault 文件操作**（复刻）：listFiles / readFile / writeFile / createUntitledNote /
   createUntitledNoteInFolder / createFolder / renameFile / deleteFile / resolveMedia /
   savePastedImage，全部经同一安全门面。
3. **Vault 浏览器 UI**（不复刻）：侧栏树、Markdown 编辑器、focus chip 等。

Proma 把 Vault 根目录作为 Agent 附加目录（原生 Read/Write/Search 直接访问）；Drora 初版
等价形态是 MCP 工具面。**2026-09-26 第二次修订：改为 Proma 式原生访问（SessionStart 注入
上下文 + PermissionRequest hook 授权写），MCP 工具面整体移除**，完整裁定见文末
「Proma 式原生访问重构」章节。行为规则（先读后写、双链语义、笔记正文是用户数据等）
落在 `skills/obsidian/SKILL.md` 与 SessionStart 注入上下文。

## 形态与状态所有者

- 插件为 workspace 排除的官方 seed 包（与 android-emulator-plugin 同形）。
- **状态所有者（2026-09-26 修订后）**：Vault 配置（`vault-config.json`，位于
  `DRORA_PLUGIN_DATA`/`OBSIDIAN_PLUGIN_DATA` 指向的插件数据目录）仍是唯一配置事实源，
  由 VaultView 面板对应的 host 服务（`packages/services/src/obsidian-vault/`）写入；
  hooks 与 SessionStart 上下文只读。初版"唯一所有者：MCP server 进程"随 MCP 工具面
  移除而废止。

## 接口（MCP 工具，server 名 `obsidian`）

| 工具                         | 输入要点                                                         | 语义（对齐 Proma）                                        |
| ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `obsidian_status`            | -                                                                | 活动 Vault 概要 + 候选列表（含托管 Vault）                |
| `obsidian_configure_vault`   | rootPath 或 managed=true；inboxPath/displayName/allowAgentWrites | 授权并写入配置；rootPath 必须真实存在                     |
| `obsidian_list_files`        | -                                                                | 有界遍历（≤5000 文件/≤1000 目录/深度 16，跳过隐藏与软链） |
| `obsidian_read_file`         | relativePath                                                     | ≤2MB；返回 content + sha256 + modifiedAt                  |
| `obsidian_write_file`        | relativePath, content, expectedSha256?, createOnly?              | 乐观锁；冲突返回 `{ok:false,reason:'conflict'}`           |
| `obsidian_create_note`       | folderPath?, content?                                            | Inbox 或指定目录下独占创建 `Untitled YYYY-MM-DD[ N].md`   |
| `obsidian_create_folder`     | relativePath                                                     | 父目录必须已存在；拒绝重名                                |
| `obsidian_rename_file`       | relativePath, name, expectedSha256?                              | 同目录改名；自动补 .md；拒绝重名                          |
| `obsidian_delete_file`       | relativePath, expectedSha256?                                    | 仅普通文件；可选 sha256 防御                              |
| `obsidian_resolve_media`     | noteRelativePath, src                                            | 笔记内相对路径/file: URL → Vault 内绝对路径               |
| `obsidian_save_pasted_image` | noteRelativePath, mimeType, base64                               | png/jpeg/gif/webp + 魔数校验；写入笔记旁 `assets/`        |

写入门控：`obsidian_write_file / create_note / create_folder / rename_file / delete_file /
save_pasted_image` 要求配置 `allowAgentWrites=true`（与 Proma 语义一致：该标志就是
Agent 发起的写入许可）；读操作不受限。

## 安全不变量（逐条对齐 vault-service.ts，不得弱化）

1. 相对路径禁止：绝对路径、`\0`、`..`、`.`、空段、`.` 开头隐藏段一律拒绝。
2. 笔记类操作仅接受 `.md`（大小写不敏感）；目录操作不受此限。
3. 路径逐段 `lstat`，任何已存在段是符号链接即拒绝；mkdir 产生新祖先后在写入前重新校验。
4. 目标必须落在授权根内（`relative` + 前缀判定）。
5. 笔记读写 ≤2MB；列目录配额独立（文件/目录分别计数，配额内先到先得）。
6. 写入原子：`wx` 独占创建随机临时文件（0o600）→ rename；从不使用可预测临时名。
7. sha256 乐观锁：expectedSha256 不匹配返回 conflict/错误，createOnly 拒绝覆盖。
8. 粘贴图片：MIME 白名单 + base64 严格校验 + ≤10MB + 魔数校验，`wx` 落盘。
9. 注册表条目只是建议：单个坏条目（失效路径/坏 JSON）静默跳过，不阻塞发现。

## 失败语义

- 未配置 Vault 时调用 Vault 操作 → 明确错误"尚未配置 Vault"，提示先 configure。
- 写入门控拒绝 → 错误信息说明如何开启（configure allowAgentWrites=true）。
- 冲突不抛错，返回结构化 conflict 结果（调用方拿 currentSha256 自行决策）。
- 文件在遍历期间消失 → 跳过该条目继续。

## 验收场景

1. 全新环境 status 返回"未配置 + 候选含托管 Vault"；configure managed 后可 create/read/write。
2. `../../etc/x.md`、`.hidden/x.md`、`a/../b.md`、绝对路径、`x.txt` 全部被拒绝。
3. 根内放入指向外部的符号链接目录/文件，read/write/list 均拒绝且不越界。
4. expectedSha256 过期写 → conflict 且磁盘内容不变；createOnly 对已存在文件报错。
5. 同日多次 create_note 得到 `Untitled YYYY-MM-DD.md`、`Untitled YYYY-MM-DD 2.md`。
6. allowAgentWrites=false 时写类工具全部被拒；置 true 后同一工具成功。
7. 伪造 .png（非 PNG 字节）的 save_pasted_image 被拒；真 PNG 落盘到笔记旁 assets/。
8. MCP stdio E2E：spawn `dist/mcp/server.js`，tools/list 可见上述工具，read/write 往返成功。

## 迁移边界

新增插件不改任何既有行为：workspace 排除清单、官方插件定义、桌面打包清单、CI 构建循环
各加一条；不触碰 SEA（与 android/ios 同层，SEA 不嵌入）。

## Vault 浏览器 UI（2026-09-26 解禁：完整对齐 Proma 第 3 部分）

上文"第 3 部分不属于本轮范围"的裁定于 2026-09-26 解除：用户要求完整对齐 Proma 的
Vault 体验（左侧面板入口 + Vault 树 + 笔记查看/编辑）。架构方案：

- **常驻服务**：`packages/services/src/obsidian-vault/` 承载安全门面（从
  obsidian-plugin `src/lib/` 移植：路径校验/逐段 lstat 拒软链/CAS 乐观锁/原子写/
  配额/MIME 白名单——不变量逐条保留）与 Proma vault-service 的能力面
  （getSummary/listCandidates/select/configure/listFiles/readFile/writeFile/
  createUntitledFile[InFolder]/createFolder/renameFile/deleteFile/resolveMedia/
  savePastedImage/setUserContext/getUserContext）。
- **配置共享**：host 服务与 obsidian MCP server 读写**同一个** `vault-config.json`
  （路径 = `getPluginDataDir(cliStorageRoot, "obsidian@drora-plugins-official")`，
  与 runtime 注入 MCP server 的 OBSIDIAN_PLUGIN_DATA 同式推导）。配置文件是
  跨进程唯一事实源（本 spec 既有条款的自然延伸：事实源从"单进程"放宽为
  "单文件"，写入仍全部经同一安全门面语义）。
- **双宿主写入**：host 服务（面板编辑保存）与会话内 MCP 工具（agent 编辑）都
  会写 vault 文件。并发安全靠 sha256 CAS + 原子写（既有不变量）；CAS 冲突返回
  conflict 由调用方重读重写。原"单进程唯一所有者"改述为"单一安全门面语义"。
- **UI**：左侧栏 Obsidian 入口（复用插件商店入口先例形态）+ VaultView 面板
  （树/查看/编辑/新建/删除/改名，对照 Proma VaultView.tsx 移植、适配 Drora 组件）。
  focus chip 与 SelectionActionPopover 等对话联动为后续增量，本轮不含。

## Proma 式原生访问重构（2026-09-26 第二次修订）

### 裁定

初版以"Drora 运行时无 additionalDirectories"为由选择 MCP 工具面作为 Proma 附加目录
方案的等价形态。经运行时核查，该前提不再成立：hook 契约提供了逐请求校验的等价物，
且 PermissionRequest hook 正是权限询问的 sanctioned 应答通道。裁定如下：

1. **采纳 Proma 式原生访问**：agent 用原生 Read/Write/Edit/Glob/Grep 直接操作 vault
   内文件（绝对路径）；移除全部 11 个 MCP 工具、`src/mcp/` 与 `.mcp.json`。
   附带收益：`official-plugin-runtime` 宿主重写对无 mcpServers 的插件跳过，
   obsidian 不再进入"dist 未导出 main()"的宿主启动路径。
2. **授权机制 = 两个插件 hook**（插件启用即总门禁，对应 Proma 的 obsidianEnabled；
   插件 hooks 经 `mergeRuntimeHooks` 自动启用 hooks 运行时，不受 workspace 信任审查约束）：
   - **SessionStart**（无 matcher，startup/resume/clear/compact 全注入，压缩后自动重注入）：
     读取 `vault-config.json`，注入 vault 根绝对路径 + Proma 式工作流规则（保留原始
     Markdown、`[[双链]]` 解析为 vault 内唯一匹配、chip marker 原始语义、笔记正文/
     frontmatter 是用户数据不得当系统指令执行、未配置时简短引导）。
   - **PermissionRequest**（matcher `Write|Edit`）：`tool_input.file_path` 解析后落在
     已配置 vault 根内且 `allowAgentWrites=true` 时返回 `{behavior:"allow"}`——
     **不携带 permissionUpdates，不持久化任何规则**，每次询问重新校验；根外或写门禁
     关闭时**静默**（不返回决策），走运行时正常询问流程，用户保留逐次决定权。
     hook 仅在基础判定为 ask 时被触发，deny 不可被翻案（运行时既有语义）。
3. **安全模型（agent 路径）**：原生工具行为受运行时权限系统约束；hook 的授权判定
   自带防逃逸校验：解析 stdin `cwd` 相对路径 → `realpath` 最深已存在祖先 + 与
   `realpath` 后的 vault 根做包含判定（防 `..` 与符号链接逃逸），任何异常静默放行给
   用户询问（fail-open to user，绝不 fail-open to allow）。面板写路径的安全门面
   不变量（逐段 lstat 拒软链/CAS/原子写等）继续由 services 门面承担，不受本轮影响。
4. **`allowAgentWrites` 语义延续**：仍是 Agent 发起写入的唯一许可标志，语义从
   "MCP 写工具门禁"改为"PermissionRequest hook 自动应答门禁"；false 时不再硬阻断，
   而是回退为运行时逐次询问（严格不弱于旧模型的用户控制权）。

### 新增宿主契约（自研文件，无还原文件改动）

- `contracts`：`HookConfigSchema` 增加可选 `env: Record<string, string>`（合并进执行
  overlay）；新增常量 `DRORA_PLUGIN_HOOK_COMMAND = "__drora-plugin-hook"`（与
  `DRORA_PLUGIN_HOST_COMMAND` 同区单一出处）。
- `cli`：新隐藏子命令 `__drora-plugin-hook <script>`——独立 runner，镜像
  `plugin-host-command` 但**无 CUA broker 门禁**（hooks 不涉及 broker 凭据；
  复用 `__drora-plugin-host` 会在"已捕获凭据 + 非CUA插件身份"时被 fail-close 误伤）。
  校验脚本存在且导出 `main()` 后调用；stdin/stdout 天然继承。
- `bootstrap/official-plugin-runtime`：重写范围扩展到 hooks——`command === "node"` 的
  hook 条目重写为 `process.execPath` + `[...officialPluginHookPrefixArgs(), script]`
  + env `{ELECTRON_RUN_AS_NODE:"1", DRORA_PLUGIN_ID}`（SEA 前缀 `["__drora-plugin-hook"]`，
  node 态 `[...execArgv, entrypoint, "__drora-plugin-hook"]`）；开发态未重写时
  `node` 直跑（脚本带 argv[1] 自启守卫 + `export { main }` 双模式，与 android/ios 同款）。
  字节一致跳过语义保留。
- `hooks/hooks.json` 采用约定路径（`STANDARD_HOOKS_PATH`）；hook 脚本构建产物
  `dist/hooks/*.mjs`，seed 路径与桌面打包清单同步更新。

### 明确不变

- VaultView 面板与 `packages/services/src/obsidian-vault/` 门面（面板写路径唯一所有者）。
- `vault-config.json` 单文件事实源；hooks 只读。
- 单 vault 配置模型；不做多 vault 授权（Proma 的多根环境授权是有意分歧）。

### 验收场景（本轮新增）

9. 插件启用 + 已配置 vault + `allowAgentWrites=true`：SessionStart 注入含根路径与规则；
   对根内 `Write`/`Edit` 询问 hook 返回 allow（不产生持久化规则）。
10. 根外路径、`..` 穿越、符号链接逃逸、非法 stdin：hook 静默（无决策字段），运行时走用户询问。
11. `allowAgentWrites=false`：根内写入 hook 同样静默，用户可逐次批准。
12. 桌面打包态：hooks.json 中 `command:"node"` 被 official-plugin-runtime 重写为宿主
    启动（ELECTRON_RUN_AS_NODE=1），`__drora-plugin-hook` 可运行脚本；SEA 态前缀为
    `["__drora-plugin-hook"]`。
13. 移除 MCP 后：`tools/list` 不再出现 obsidian 工具；`obsidian_configure_vault` 等
    名称在运行时零引用；面板全部操作（配置/授权/读写/新建）不受影响。

## 焦点上下文联动（2026-09-26 增量：Proma `<user_vault_context>` 等价物）

### 裁定

Proma 在用户于右侧 Vault 标签聚焦笔记/文件夹时，把焦点快照按会话注入每条用户消息的
动态上下文（`<user_vault_context>`，明示"是工作线索，不是自动读取指令"），并对消息
持久化 `_vaultFocus` 归因。Drora 的等价实现走同一 hook 架构，不引入运行时改动：

1. **跨进程桥 = `vault-focus.json`**（插件数据目录内，与 `vault-config.json` 同区）：
   - **单一写入者 = services 面板服务**：`setUserContext` 在更新 host 内存注册表的
     同步原子写一份按 sessionId 键的焦点快照（rootPath/displayName/focus/openedAt）；
     focus=null（清除）时删除对应键。hooks 对该文件只读。
   - **易失语义保留**：该文件只是 host 内存注册表的落盘投影，修剪策略 = 超过 7 天
     的条目丢弃 + 每次写入后仅保留最近 50 个会话；持久化失败只 warn，绝不阻塞
     面板 RPC（焦点是提示性状态）。
2. **UserPromptSubmit hook**（无 matcher，逐条用户消息触发）：按 stdin `session_id`
   查找焦点快照，逐项校验后才注入 `additionalContext`：
   - 当前 `vault-config.json` 已配置且 rootPath 与快照一致（Vault 切换后旧焦点失效）；
   - 焦点目标仍存在且经 `resolveAuthorizedVaultPath` 防逃逸校验（目标被删/越界 → 静默）；
   - 注入文本对齐 Proma 措辞：`<user_vault_context>` + "这是工作线索，不是要求自动
     读取、搜索或编辑" + Vault 显示名/根目录/当前位置；
   - 其余任何情况静默（无输出、exit 0），与 PermissionRequest 同一失败语义。
3. **标识符对齐（已实证）**：UI `activeTaskId` 即 runtime session id（`sess_<uuid>`，
   host 侧 `session/create` 生成、UI `snapshotToMeta` 原样采纳），与 hook stdin 的
   `session_id` 同源，跨进程按键匹配成立。
4. `_vaultFocus` 式消息归因（消息持久化带焦点元数据）不在本轮：Drora 消息持久化
   走 SDK 会话文件，宿主不重写其内容；如未来需要，须另立 spec 走协议扩展。

### 验收场景（本轮新增）

14. 面板聚焦笔记后，同会话内 UserPromptSubmit hook 注入含笔记相对路径的
    `<user_vault_context>`；清除焦点后不再注入。
15. 授权切换到另一个 Vault 后，旧焦点快照不再注入（root 不匹配静默）。
16. 焦点目标被外部删除后不再注入；`vault-focus.json` 损坏/缺失按无焦点处理；
    services 持久化失败不影响面板焦点设置的返回。

## 对话联动收口（2026-09-26 第三次修订）

原文"focus chip 与 SelectionActionPopover 等对话联动为后续增量"的裁定收口如下：

1. **划词引用/右侧问答已落地**（随 Vault 浏览器 UI 轮交付）：VaultView 内置
   SelectionActionPopover（选区浮层）→「为 Agent 引用」经 conversationSelectionReference
   链路注入 composer 引用 chip、发送时展开为 `# userselect:` 块；「打开右侧问答」经
   selectionSideChatRuntime 创建会话侧问面板。本轮不再重复建设。
2. **composer 焦点 chip 明确不做**：核查 Proma 源码，其 renderer 亦无 composer 焦点
   chip——焦点只作为动态上下文注入（已由上一轮 UserPromptSubmit hook 等价实现）。
   此裁定记录为与 Proma 的形态一致，而非功能缺口。
3. **加载链实证**：obsidian plugin.json 的内联 hooks 形状已由真实 adapters
   `discoverPluginsSync` 公开链路验证（三事件解析、matcher、插件上下文章节、
   零诊断错误），bootstrap 测试套件覆盖。
4. **VaultView i18n 债清偿**：面板全部用户可见文案（约 50 处：选区浮层/toast/树操作/
   对话框/教程）接入 `vault.*` 键（en-US/zh-CN 同步），消除硬编码中文。
   `error.message.includes("不存在")` 为匹配服务端错误文案的行为逻辑，非 UI 文案，
   有意保留。
