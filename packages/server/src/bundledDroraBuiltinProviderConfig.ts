import { materializeDroraBuiltinProviderConfig } from "@drora/services/node";

declare const __DRORA_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

interface MaterializeBundledDroraBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

/** 返回构建时嵌入远端 Server 的 Drora Built-in Provider Config。 */
export function readBundledDroraBuiltinProviderConfig(): string {
  if (typeof __DRORA_BUILTIN_PROVIDER_CONFIG_JSON__ !== "string") {
    throw new Error("当前构建未嵌入 Drora Built-in Provider Config");
  }
  return __DRORA_BUILTIN_PROVIDER_CONFIG_JSON__;
}

/**
 * 将 Drora Built-in Config 原子物化到所属环境的固定资源副本。
 * 升级前退出旧进程；不保留按内容 hash 增长的历史文件。
 */
export async function materializeBundledDroraBuiltinProviderConfig(
  options: MaterializeBundledDroraBuiltinProviderConfigOptions,
): Promise<string> {
  return materializeDroraBuiltinProviderConfig(options);
}
