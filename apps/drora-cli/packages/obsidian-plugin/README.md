# @drora/obsidian-plugin

官方 Drora 插件：把本机 Obsidian Vault 接入 Agent（Proma 式原生访问）——发现/授权 Vault、
通过 SessionStart hook 注入 Vault 根目录与工作流规则、通过 PermissionRequest hook 授权
Vault 内的原生文件写入。Agent 用原生 Read/Write/Edit/Glob/Grep 以绝对路径直接操作
Vault 内的普通 Markdown 文件；Vault 的浏览/编辑 UI 与配置写入由 VaultView 面板对应的
host 服务（`packages/services/src/obsidian-vault/`）承载，两者共享同一 `vault-config.json`。

## Hook 面（无 MCP server）

| Hook | matcher | 语义 |
| --- | --- | --- |
| `SessionStart` | 全部 lifecycle | 读 `vault-config.json`，注入 Vault 根绝对路径 + Proma 式工作流规则（保留原始 Markdown、双链语义、笔记内容是用户数据、写授权状态） |
| `PermissionRequest` | `Write\|Edit` | 根内路径且 `allowAgentWrites=true` 时返回 allow（不持久化规则，逐请求校验）；根外或写门禁关闭时静默，走运行时正常询问 |

授权判定自带防逃逸校验：相对路径按会话 cwd 解析、realpath 根包含判定、已存在段逐段
lstat 拒软链；任何异常一律静默（绝不 fail-open 到 allow）。

打包态由 official-plugin-runtime 把 `command:"node"` 的 hook 重写为 `__drora-plugin-hook`
宿主启动（不经过 `__drora-plugin-host` 的 CUA 凭据门禁）；开发态保持 `node` 直跑。

安全不变量与验收场景见 `specs/obsidian-plugin.md`。

## 开发

```bash
pnpm --dir apps/drora-cli/packages/obsidian-plugin run build   # tsc + esbuild → dist/hooks/*.mjs
pnpm --dir apps/drora-cli/packages/obsidian-plugin run test    # agent-access 安全语义单测 + hook stdin/stdout E2E
pnpm --dir apps/drora-cli/packages/obsidian-plugin run typecheck
```
