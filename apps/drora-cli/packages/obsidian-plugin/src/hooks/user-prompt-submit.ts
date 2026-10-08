import { pathToFileURL } from "node:url";
import { buildUserPromptFocusContext, loadSessionFocus } from "../lib/agent-access.js";
import { pluginDataDirFromEnv, readHookStdinJson } from "./support.js";

/**
 * UserPromptSubmit：把面板当前聚焦的 Vault 位置按会话注入动态上下文（Proma
 * `<user_vault_context>` 等价物，见 specs/obsidian-plugin.md「焦点上下文联动」）。
 * 焦点缺失/根切换/目标消失/任何异常一律静默（无输出、exit 0）——上下文是尽力而为的
 * 工作线索，绝不阻塞用户消息。
 */
export async function main(): Promise<void> {
  try {
    const input = await readHookStdinJson();
    const sessionId = input?.session_id ?? input?.sessionId;
    const focus = await loadSessionFocus(
      pluginDataDirFromEnv(),
      typeof sessionId === "string" ? sessionId : undefined,
    );
    if (!focus) return;
    process.stdout.write(`${JSON.stringify({ additionalContext: buildUserPromptFocusContext(focus) })}\n`);
  } catch {
    // 静默：注入失败只意味着本轮缺上下文。
  }
}

// 开发态 node 直跑（argv[1] = 本脚本）自启动；宿主 __drora-plugin-hook 调用时
// argv[1] 是 CLI 入口，守卫不触发，由宿主调用 main()。
const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
