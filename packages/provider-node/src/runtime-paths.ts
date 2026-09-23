export const DRORA_BUILTIN_PROVIDER_CONFIG_FILE_ENV = "DRORA_BUILTIN_PROVIDER_CONFIG_FILE";
export const DRORA_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV =
  "DRORA_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
export const DRORA_PERSONAL_PROVIDER_CONFIG_FILE_ENV = "DRORA_PERSONAL_PROVIDER_CONFIG_FILE";
export const PERSONAL_PROVIDER_CONFIG_FILE_NAME = "provider_config.json";

export interface NodeProviderRuntimePaths {
  readonly droraBuiltinFilePath: string;
  readonly personalFilePath: string;
}

export function createNodeProviderRuntimePathEnv(
  paths: NodeProviderRuntimePaths,
): Record<string, string> {
  return {
    [DRORA_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: paths.droraBuiltinFilePath,
    [DRORA_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: paths.personalFilePath,
  };
}

export function resolveNodeProviderRuntimePaths(
  env: Readonly<Record<string, string | undefined>>,
): NodeProviderRuntimePaths | null {
  const droraBuiltinFilePath = env[DRORA_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const personalFilePath = env[DRORA_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (!droraBuiltinFilePath && !personalFilePath) return null;
  if (!droraBuiltinFilePath || !personalFilePath) {
    throw new Error("Drora Built-in 与 Personal Provider Config 路径必须同时提供");
  }
  return Object.freeze({ droraBuiltinFilePath, personalFilePath });
}
