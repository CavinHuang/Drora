// 迁自 packages/services/src/knowledge/review/reviewReleasePolicy.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
import type { ServiceAuthorityMode } from "@drora/shared";

/**
 * 本轮 S03 委托自审交付范围，见 S03_CLOSEOUT_2026-10-17.md。
 * 只装配桌面本地能力；Vault 开关与逐提案批准仍由 ReviewEngine 独立校验。
 */
export function isReleasedReviewWriteAuthority(
  authority: ServiceAuthorityMode | undefined,
): boolean {
  return authority === "desktop-local";
}
