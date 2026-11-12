/**
 * obsidian-plugin-server 对外契约：调用方要想正确调用就必须知道的一切都写在这里；
 * 其余对外不可见（四服务接口与工具面的逐项映射见 docs/knowledge-mcp-mapping.md，
 * P3 交付物 + P4 agent 工具面增补——本契约只收模块级不变量与生命周期语义）。
 */

/** 数据面可用状态（platform/dataPaths D14 状态机的消费面投影）。 */
export type ObsidianPluginServerStatus =
  | {
      status: "ok";
      mode: "legacy" | "plugin";
      databasePath: string;
      modelRoot: string;
      pluginDataDir: string;
    }
  | {
      status: "dual_db_conflict";
      legacyDatabasePath: string;
      pluginDatabasePath: string;
      pluginDataDir: string;
    }
  /** P6 搬迁接线后启用（§5 迁移门）；P3 恒不产生，仅占位键。 */
  | { status: "migrating" };

export interface ObsidianPluginServerContract {
  /**
   * 启动 stdio MCP server（宿主经 g1 appService 常驻拉起或会话级 MCP client 直连）。
   * 前置：进程 env 已注入 DRORA_PLUGIN_DATA（宿主权威）；缺省回落本地推导。
   * 后置：stdin 关闭/SIGTERM/SIGINT 时停 run 事件流与定时器并关 DB（租约 TTL 兜底）。
   * 幂等性：进程级单次调用；重复调用行为未定义。
   */
  startKnowledgeMcpServer(): Promise<void>;
  /**
   * 读取数据面状态。dual_db_conflict 时**拒绝构造数据面**（不静默合并，D14），
   * 全部数据工具返回结构化冲突事实；migrating 为 P6 预留。
   */
  getServerStatus(): ObsidianPluginServerStatus;
}
