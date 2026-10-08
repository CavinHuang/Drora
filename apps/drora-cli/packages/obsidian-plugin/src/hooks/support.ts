/** 读取运行时按 JSON-over-stdin 契约写入的 hook 输入；空/坏输入返回 null。 */
export async function readHookStdinJson(): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function pluginDataDirFromEnv(): string | undefined {
  return process.env.DRORA_PLUGIN_DATA ?? process.env.OBSIDIAN_PLUGIN_DATA;
}
