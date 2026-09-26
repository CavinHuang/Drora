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

Proma 把 Vault 根目录作为 Agent 附加目录（原生 Read/Write/Search 直接访问）；Drora 的等价
形态是 MCP 工具面——文件 IO 全部发生在 MCP server 进程内，不放大 Agent 原生文件权限。
行为规则（先读后写、双链语义、笔记正文是用户数据等）落在 `skills/obsidian/SKILL.md`。

## 形态与状态所有者

- 插件为 workspace 排除的官方 seed 包（与 android-emulator-plugin 同形）：源码 + `tsc`
  构建 + esbuild 打包 `dist/mcp/server.js`。
- **唯一所有者：MCP server 进程**。Vault 配置（`vault-config.json`，位于
  `OBSIDIAN_PLUGIN_DATA`）与 Vault 内所有写操作只经过它；不存在第二条写入路径。
- 配置文件是唯一配置事实源；userConfig 不重复表达 allowAgentWrites，避免双头状态。

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
