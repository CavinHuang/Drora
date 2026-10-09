// Bundled 本地页面根解析（specs/mobile-relay-server.md §12.5「Bundled 本地根优先级」）：
// 候选按优先级排序，取第一个含 remote/v4/index.html 入口的目录；全缺失返回 null
// （调用方落回内建资产代理）。当前 CLI 候选序由 main.ts 注入：upstream 官方原始
// 资产 → src/recovered 可读化回退 → dist 源码应用末位兜底（spec §33.11）。
import { access } from "node:fs/promises";
import { join } from "node:path";

/** 候选目录里第一个持有官方路径形状入口（remote/v4/index.html）的根；无则 null。 */
export async function pickBundledMobileRoot(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(join(candidate, "remote", "v4", "index.html"));
      return candidate;
    } catch {
      // 尝试下一个候选。
    }
  }
  return null;
}
