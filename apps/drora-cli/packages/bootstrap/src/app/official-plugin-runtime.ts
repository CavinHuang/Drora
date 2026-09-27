import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  DRORA_OFFICIAL_PLUGIN_MARKETPLACE,
  DRORA_PLUGIN_HOST_COMMAND,
  DRORA_PLUGIN_HOOK_COMMAND,
  type McpServerConfig,
} from "@drora/contracts";
import { DRORA_PLUGIN_ID_ENV_KEY } from "@drora/shared";
import {
  createOfficialPluginCacheRetryBudget,
  type OfficialPluginCacheRetryBudget,
  writeTextFileAtomicallyWithRetry,
} from "./official-plugin-cache-fs.js";

type SeaModule = typeof import("node:sea");

const MCP_SERVER_RELATIVE_PATH = ["dist", "mcp", "server.js"] as const;
/** hooks.json 中 process 型 hook 的约定运行时标记：开发态由系统 node 直跑，重写态换宿主启动。 */
const HOOK_RUNTIME_COMMAND_MARKER = "node";

export function createBundledMcpRuntimeConfig(input: {
  cwd: string;
  env?: Record<string, string>;
  relativeServerPath?: readonly string[];
  rootPath: string;
  timeoutMs?: number;
}): McpServerConfig | undefined {
  const hostPrefixArgs = officialPluginHostPrefixArgs();
  if (!hostPrefixArgs) return undefined;
  return {
    args: [
      ...hostPrefixArgs,
      join(input.rootPath, ...(input.relativeServerPath ?? MCP_SERVER_RELATIVE_PATH)),
    ],
    command: process.execPath,
    cwd: input.cwd,
    env: {
      ...input.env,
      // 桌面打包态 process.execPath 是 Drora Helper；缺少 Node 模式会误进 Electron main。
      ELECTRON_RUN_AS_NODE: "1",
    },
    timeoutMs: input.timeoutMs,
    type: "stdio",
  };
}

interface OfficialRuntimeManifestInput {
  pluginName: string;
  retryBudget?: OfficialPluginCacheRetryBudget;
  rootPath: string;
}

export function writeOfficialPluginRuntimeManifest(input: OfficialRuntimeManifestInput): void {
  const manifestPath = join(input.rootPath, ".zcode-plugin", "plugin.json");
  const currentContents = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(currentContents) as Record<string, unknown>;
  // skill-only / command-only 类型的 official plugin 不带 mcpServers/hooks，直接跳过 rewrite。
  // 之前这里无脑 asRecord(manifest.mcpServers) 会对 undefined 抛错，
  // 把 seed 流程整个阻断，连带 listDroraSkills 拉不出 plugin skill。
  if (manifest.mcpServers === undefined && manifest.hooks === undefined) return;

  const hostPrefixArgs = officialPluginHostPrefixArgs();
  const hookPrefixArgs = officialPluginHookPrefixArgs();
  if (!hostPrefixArgs || !hookPrefixArgs) return;

  let mutated = false;

  if (manifest.mcpServers !== undefined) {
    const mcpServers = asRecord(manifest.mcpServers);

    // 保留对其他历史 official plugin MCP 的通用重写；drora-cua 当前是 skill/SDK-only，
    // 不会进入这个分支，也不会生成独立的 CUA MCP server。
    for (const [serverKey, serverRaw] of Object.entries(mcpServers)) {
      const mcpServer = asRecord(serverRaw);
      const mcpServerEnv = isRecord(mcpServer.env) ? mcpServer.env : {};
      mcpServer.command = process.execPath;
      mcpServer.args = [...hostPrefixArgs, join(input.rootPath, ...MCP_SERVER_RELATIVE_PATH)];
      mcpServer.env = {
        ...mcpServerEnv,
        // 桌面打包态的 process.execPath 是 Drora Helper。
        // 官方插件 MCP server 缺少 Node 模式 env 时会误进 Electron main，触发 deep-link 注册等桌面副作用。
        ELECTRON_RUN_AS_NODE: "1",
        // 权威写入插件身份（pluginName@marketplace，来自本地 plugin registry，manifest/user env 不可覆盖）。
        // 其他 official plugin 仍带上不可伪造的 plugin identity；CUA broker 凭据由 shared
        // node_repl 的可信配置注入，不再写入独立 server。
        [DRORA_PLUGIN_ID_ENV_KEY]: `${input.pluginName}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}`,
      };
      mcpServers[serverKey] = mcpServer;
      mutated = true;
    }
    manifest.mcpServers = mcpServers;
  }

  if (manifest.hooks !== undefined) {
    // hook 无法像 MCP server 一样假设宿主目录有 node 可执行文件（桌面打包态 PATH 上
    // 通常没有 Node）；约定 `command:"node"` 的 process 型 hook 在 seed 时统一重写为
    // `__drora-plugin-hook` 宿主启动。开发态（node/PATH 可用）不经过重写路径，直跑语义不变。
    const hooks = asRecord(manifest.hooks);
    for (const hookEntries of Object.values(hooks)) {
      if (!Array.isArray(hookEntries)) continue;
      for (const matcherEntry of hookEntries) {
        if (!isRecord(matcherEntry) || !Array.isArray(matcherEntry.hooks)) continue;
        for (const hookRaw of matcherEntry.hooks) {
          if (!isRecord(hookRaw)) continue;
          if (hookRaw.type !== "process" || hookRaw.command !== HOOK_RUNTIME_COMMAND_MARKER) continue;
          const scriptPath = resolveHookScriptPath(input.rootPath, hookRaw.args);
          if (!scriptPath) continue;
          const hookEnv = isRecord(hookRaw.env) ? hookRaw.env : {};
          hookRaw.command = process.execPath;
          hookRaw.args = [...hookPrefixArgs, scriptPath];
          hookRaw.env = {
            ...hookEnv,
            // 与 MCP 重写同一约束：打包态 execPath 是 Drora Helper，缺 Node 模式 env 会误进 Electron main。
            ELECTRON_RUN_AS_NODE: "1",
            [DRORA_PLUGIN_ID_ENV_KEY]: `${input.pluginName}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}`,
          };
          mutated = true;
        }
      }
    }
    manifest.hooks = hooks;
  }

  if (!mutated) return;

  const nextContents = `${JSON.stringify(manifest, null, 2)}\n`;
  // 启动时无条件 rename 同内容的 plugin.json 会放大 Windows 杀毒/索引器
  // 的短暂文件占用。字节完全一致时不触碰文件；真正有更新时仍保持原子的失败语义。
  if (nextContents === currentContents) return;
  writeTextFileAtomicallyWithRetry(
    manifestPath,
    nextContents,
    input.retryBudget ?? createOfficialPluginCacheRetryBudget(),
  );
}

/**
 * hooks.json 的 `${DRORA_PLUGIN_ROOT}/...` 脚本参数 → 插件根内绝对路径。
 * 无法解析（缺 args/空串/根外逃逸）时返回 undefined，调用方跳过该条目（保持原样）。
 */
function resolveHookScriptPath(rootPath: string, args: unknown): string | undefined {
  if (!Array.isArray(args) || typeof args[0] !== "string" || args[0].trim() === "") return undefined;
  const raw = args[0];
  const stripped = raw.replace(/^\$\{(?:DRORA|CLAUDE)_PLUGIN_ROOT\}/u, "");
  if (stripped === raw && !raw.startsWith("/")) {
    // 既无模板前缀也不是绝对路径：无法安全定位脚本，交由运行时原样处理。
    return undefined;
  }
  const scriptPath = resolve(rootPath, `.${stripped}`);
  const resolvedRoot = resolve(rootPath);
  // 前缀判定必须带路径分隔符，否则 /root-evil 会被误判为 /root 的子路径。
  if (scriptPath !== resolvedRoot && !scriptPath.startsWith(resolvedRoot + sep)) return undefined;
  return scriptPath;
}

export function officialPluginHostPrefixArgs(): string[] | undefined {
  if (isSeaRuntime()) return [DRORA_PLUGIN_HOST_COMMAND];

  const entrypoint = process.argv[1];
  if (!entrypoint) return undefined;

  return [...process.execArgv, resolve(entrypoint), DRORA_PLUGIN_HOST_COMMAND];
}

/**
 * hook 脚本的宿主前缀：与 {@link officialPluginHostPrefixArgs} 同机制，但指向
 * `__drora-plugin-hook` 入口（不经过 plugin host 的 CUA broker 凭据门禁）。
 */
export function officialPluginHookPrefixArgs(): string[] | undefined {
  if (isSeaRuntime()) return [DRORA_PLUGIN_HOOK_COMMAND];

  const entrypoint = process.argv[1];
  if (!entrypoint) return undefined;

  return [...process.execArgv, resolve(entrypoint), DRORA_PLUGIN_HOOK_COMMAND];
}

function isSeaRuntime(): boolean {
  const getBuiltinModule = process.getBuiltinModule as ((id: "node:sea") => SeaModule) | undefined;
  try {
    return getBuiltinModule?.("node:sea").isSea() === true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Official plugin manifest has invalid mcpServers.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
