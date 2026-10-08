import { pathToFileURL } from "node:url";
import { loadAgentVaultAccess, resolveAuthorizedVaultPath } from "../lib/agent-access.js";
import { pluginDataDirFromEnv, readHookStdinJson } from "./support.js";

/**
 * PermissionRequest（matcher Write|Edit）：已配置 Vault 内且 allowAgentWrites=true 的
 * 写入自动应答 allow（不携带 permissionUpdates，不持久化规则，每次询问重新校验）。
 * 其余情况一律静默（无输出、exit 0）——交还运行时默认询问流程；
 * 绝不 fail-open 到 allow，exit 2（deny 语义）同样不可接受。
 */
export async function main(): Promise<void> {
  try {
    const input = await readHookStdinJson();
    const decision = await resolveWriteAuthorization(input);
    if (decision) {
      process.stdout.write(`${JSON.stringify(decision)}\n`);
    }
  } catch {
    // 静默：授权判定只能收紧不能放宽，异常时的正确行为是无决策。
  }
}

async function resolveWriteAuthorization(input: Record<string, unknown> | null): Promise<unknown> {
  if (!input) return null;
  const access = await loadAgentVaultAccess(pluginDataDirFromEnv());
  if (!access || !access.allowAgentWrites) return null;
  const toolName = input.toolName ?? input.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") return null;
  const toolInput = input.toolInput ?? input.tool_input;
  const candidate =
    toolInput && typeof toolInput === "object"
      ? (toolInput as Record<string, unknown>).file_path
      : undefined;
  const authorizedPath = await resolveAuthorizedVaultPath(access.rootPath, input.cwd, candidate);
  if (!authorizedPath) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  };
}

// 开发态 node 直跑自启动；宿主调用时守卫不触发（见 session-start.ts 同款约定）。
const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
