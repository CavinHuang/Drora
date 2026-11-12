# obsidian-plugin-server

一页以内。只写类型与测试表达不了的三样：模块存在的意图、不变量、与其它模块的交集在哪个 hook 点处理。

意图：Obsidian vault 的全部实现归属插件包（specs/obsidian-vault-phase2-true-extraction.md §0 真抽离）——
`src/server/` 是从 packages/services 物理迁入的知识栈 + vault 门面（HEAD `bf872a6c0` 逐文件对照，
双轨期本体原件 P7 拆），`src/mcp/` 是 `knowledge` stdio MCP server（P4 起 54 工具 = 四服务 RPC 面
1:1 的 52 件 + agent 工具 `vault_search`/`vault_neighbors` 2 件，C8 契约随迁 + evidence 工具内复验；
映射清单见 `docs/knowledge-mcp-mapping.md`）。P5 起 `src/ui/` 是 Vault webview 面板（React 单文件
内联产物，经 `ui://obsidian/panel.html` + `ui://obsidian/data/*` 资源面服务，见下方不变量）。

不变量：

- 数据路径唯一入口是 `src/server/platform/dataPaths.ts` 的 D14 状态机：双库并存 → `dual_db_conflict`
  拒绝启动数据面（不静默合并）；仅旧路径有库 → legacy（server 首启执行 §5 自动搬迁，P6）；
  P6 起无库首建落插件目录（P7 后旧 host 已不存在）。搬迁由 `platform/knowledgeMigration.ts`
  承担（checkpoint + owner PID 活性校验 + move+计数校验 + 失败回退；文件锁串行化并发首启），
  搬迁 running 期间数据工具结构化 `migrating` 拒绝、blocked/failed 回退后按 legacy 原件继续服务。
- 跨进程写竞争由 DB 级 index_lease/fencing 仲裁（随迁零改动，不进程内化，§6-g8）；
  vault 安全不变量集（软链拒绝/CAS/配额）随迁零弱化。
- MCP 工具面是四服务面的 1:1 重暴露：分页只加 offset/limit 维度，不改变服务语义；
  agent 工具（agent-tools.ts）是 C8 契约的消费面而非服务面形状——出站白名单同一
  收口（vaultSearchProtocol/knowledgeNeighbors），vault_search 候选附 evidence 复验
  注解（§4.2/D9 单层复验），近邻不附（向量事实非引用核验）；
  写类工具的审批豁免（g10）未裁定前不实施（D7/D13 保守缺省）——agent 工具随 MCP
  缺省逐次 ask。
- 迁入文件与 HEAD 的差异只允许：迁入头注释、导入重指（platform 值等价副本）、
  jevAssembly 的 D8 凭据缺省 fail-closed——除此之外的任何改动都违反 P3 逐文件对照纪律。
- 面板数据通道只走 `resources/read`（`src/mcp/uiResources.ts`：`mcp/uiReadResource` 限同
  插件 server、8 MiB、MIME 白名单，无审批）；面板**不得**经工具面读数据——页面工具调用
  复用 Agent 权限链逐次弹审批（D7/D13 保守缺省），读写两侧在 g10 终裁前都不接线
  （写操作 UI 降级提示）。面板草稿经 `ui/set-widget-state` 落宿主内存（回收重建恢复），
  服务端草稿持久化随写操作面补批。

与其它模块的交集：`shared`/`rpc`（链接依赖，契约常量与 Emitter）；宿主拉起点在 bootstrap
official-plugin-app-service（g1，P1 落地）——协议 stdio 之外无进程内交叉。
