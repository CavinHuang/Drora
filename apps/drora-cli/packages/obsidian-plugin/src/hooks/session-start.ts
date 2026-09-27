import { pathToFileURL } from "node:url";
import { buildSessionStartContext, loadAgentVaultAccess } from "../lib/agent-access.js";
import { pluginDataDirFromEnv, readHookStdinJson } from "./support.js";

/**
 * SessionStart：把 Vault 根目录与工作流规则注入会话上下文（Proma 式提示词规则）。
 * 上下文注入是尽力而为：任何失败静默退出（无输出、exit 0），不阻塞会话启动。
 */
export async function main(): Promise<void> {
  try {
    await readHookStdinJson();
    const access = await loadAgentVaultAccess(pluginDataDirFromEnv());
    const context = buildSessionStartContext(access);
    process.stdout.write(`${JSON.stringify({ additionalContext: context })}\n`);
  } catch {
    // 静默：SessionStart 失败只意味着本轮缺上下文，会话必须照常启动。
  }
}

// 开发态 node 直跑（argv[1] = 本脚本）自启动；宿主 __drora-plugin-hook 调用时
// argv[1] 是 CLI 入口，守卫不触发，由宿主调用 main()。
const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
