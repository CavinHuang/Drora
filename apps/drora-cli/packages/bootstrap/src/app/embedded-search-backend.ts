import type { EmbeddedSearchBackend } from "@drora/contracts";
import { getRuntimeToolRuntime } from "@drora/shared";

const EMBEDDED_SEARCH_COMMAND_ENV = "DRORA_EMBEDDED_SEARCH_COMMAND";
const INTERNAL_SEARCH_ENTRYPOINT = "__internal-search";

export function resolveDefaultEmbeddedSearchBackend(input: {
  env?: NodeJS.ProcessEnv;
}): EmbeddedSearchBackend {
  const env = input.env ?? process.env;
  const commandOverride = env[EMBEDDED_SEARCH_COMMAND_ENV]?.trim();
  if (commandOverride) {
    return {
      kind: "internal-cli",
      command: commandOverride,
      args: [INTERNAL_SEARCH_ENTRYPOINT],
    };
  }

  const bfsRuntime = getRuntimeToolRuntime("bfs");
  const ripgrepRuntime = getRuntimeToolRuntime("ripgrep");
  const ugrepRuntime = getRuntimeToolRuntime("ugrep");
  return {
    kind: "native-binaries",
    findCommand: env[bfsRuntime.binaryEnvVar]?.trim() || "bfs",
    grepCommand: env[ugrepRuntime.binaryEnvVar]?.trim() || "ugrep",
    rgCommand: env[ripgrepRuntime.binaryEnvVar]?.trim() || "rg",
  };
}
