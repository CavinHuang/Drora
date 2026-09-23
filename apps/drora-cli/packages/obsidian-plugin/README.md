# @drora/obsidian-plugin

官方 Drora 插件：把本机 Obsidian Vault 接入 Agent —— 发现/授权 Vault、安全地浏览与检索
Markdown 笔记、按乐观锁读写、独占创建未命名笔记、管理目录与图片附件。能力完整移植自
Proma 的 Vault 实现（安全语义逐条对齐），形态为 `node` stdio MCP server + `obsidian` skill。

## 工具面（server 名 `obsidian`）

| 工具 | 说明 |
| --- | --- |
| `obsidian_status` | 活动 Vault 概要 + 全部候选（含托管 Vault） |
| `obsidian_configure_vault` | 授权 Vault（`root_path` 或 `managed=true`）；`allow_agent_writes` 控制写权限 |
| `obsidian_list_files` | 有界遍历（深度 16 / 5000 笔记 / 1000 目录，跳过隐藏与软链） |
| `obsidian_read_file` | 读笔记（≤2MB），返回 sha256 供乐观锁 |
| `obsidian_write_file` | 写笔记；`expected_sha256` 冲突返回结构化 conflict，`create_only` 拒绝覆盖 |
| `obsidian_create_note` | Inbox/指定目录独占创建 `Untitled YYYY-MM-DD[ N].md` |
| `obsidian_create_folder` | 建目录（父目录须存在） |
| `obsidian_rename_file` / `obsidian_delete_file` | 改名/删除（可选 sha256 防御） |
| `obsidian_resolve_media` | 笔记内媒体引用 → Vault 内绝对路径 |
| `obsidian_save_pasted_image` | base64 图片（png/jpeg/gif/webp，魔数校验，≤10MB）落盘 `assets/` |

安全不变量与验收场景见 `specs/obsidian-plugin.md`。

## 开发

```bash
pnpm --dir apps/drora-cli/packages/obsidian-plugin run build   # tsc + esbuild → dist/mcp/server.js
pnpm --dir apps/drora-cli/packages/obsidian-plugin run test    # 安全语义单测 + stdio E2E
pnpm --dir apps/drora-cli/packages/obsidian-plugin run typecheck
```
