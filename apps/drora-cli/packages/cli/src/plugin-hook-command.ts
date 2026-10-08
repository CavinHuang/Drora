import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DRORA_PLUGIN_HOOK_COMMAND } from "@drora/contracts/plugins";
import type { RunContext } from "@drora/shared-types";

const HOOK_USAGE = `${DRORA_PLUGIN_HOOK_COMMAND} <script-path>`;

type HookScriptModule = {
  main?: unknown;
};

export function isPluginHookInvocation(argv: readonly string[]): boolean {
  return argv[0] === DRORA_PLUGIN_HOOK_COMMAND;
}

// __drora-plugin-hook 在 agent 运行时进程内执行 official plugin 的 hook 脚本。
// 与 __drora-plugin-host 刻意不共用入口：plugin host 承载"恢复 CUA broker 凭据"的
// 宿主边界，其 fail-close 门禁按插件身份校验；hook 脚本只读写 stdin/stdout JSON，
// 不涉及 broker 凭据，若复用该入口会在已捕获凭据的环境里被按非 CUA 身份误拒。
// 因此这里不做任何凭据恢复，也不做插件身份校验——脚本是 seed 时权威重写进
// plugin.json 的路径，execPath/前缀同样来自权威 seed。
export async function runPluginHookCommand(ctx: RunContext, argv: string[]): Promise<number> {
  if (argv.length < 1) {
    ctx.stderr.write(`Usage: ${HOOK_USAGE}\n`);
    return 1;
  }

  const [rawScriptPath] = argv;

  try {
    if (rawScriptPath === undefined) {
      throw new Error("Hook script path is required.");
    }

    const scriptPath = resolve(rawScriptPath);
    if (!existsSync(scriptPath)) {
      throw new Error("Hook script file does not exist.");
    }

    const module = (await import(pathToFileURL(scriptPath).href)) as HookScriptModule;
    if (typeof module.main !== "function") {
      throw new Error("Hook script does not export main().");
    }

    // 不改写 process.argv：脚本的 argv[1] 自启守卫（开发态 node 直跑）必须在此处
    // 保持"argv[1] ≠ 脚本路径"才不会与宿主调用 main() 双跑。
    await module.main();

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Plugin hook failed: ${message}\n`);
    return 1;
  }
}
