/**
 * obsidian-plugin-server 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import type { ObsidianPluginServerContract } from "./contract.js";

export function exampleObsidianPluginServer(contract: ObsidianPluginServerContract): void {
  // 最常见的一次完整调用：宿主拉起常驻 server（dist/mcp/server.js 即 main 入口），
  // 消费方（appService 启动链/会话级 MCP client）只经 stdio 协议交互，不进程内直调；
  // 状态探测经 knowledge_server_status 工具（getServerStatus 的协议投影）。
  void contract.startKnowledgeMcpServer();
}
