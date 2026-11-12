// 迁自 packages/services/src/knowledge/index/healthReport.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
/**
 * Vault 健康体检纯图计算（剥离 spec §8 N4，obsidian-knowledge.md §5h.3，B6）。
 *
 * 输入全部是当前 (vaultId, sourceEpoch) 索引快照行（documents 元信息 + 逐文档 chunk
 * body 重提取信号），输出孤儿/断链/空笔记报告——不做任何 IO、不读 vault 文件，可脱离
 * DB 单测（与 insightsAggregator 同款纯函数纪律）。文件实况不属本报告：体检是「上次
 * 完成索引」的事实，新鲜度由 reconcile 与 coverage 呈现承担（spec §5h.3 事实边界）。
 *
 * wikilink 解析口径（确定性、大小写敏感）：
 * ① relative_path 精确等值（含补 `.md` 两种形态）→ ② 路径后缀匹配（`=== target` 或
 * 以 `/<target>` 结尾，多候选取最短 relative_path）→ ③ basename 等值（多候选取字典序
 * 最小——存在同名笔记时链接仍解析，不误报断链）。`#标题`/`^块` 后缀在解析前剥离
 * （与 extractWikilinkTargets 的 V1 边界一致：目标整体保留，解析期才拆）。
 */
import type {
  KnowledgeHealthBrokenLinkEntry,
  KnowledgeHealthNoteEntry,
  KnowledgeHealthReport,
} from "../knowledgeTypes.js";
import { extractWikilinkTargets } from "./markdownChunker.js";

/** 每类条目数组的呈现上限；count 恒为全量计数，UI 据此呈现截断（spec §5h.3）。 */
export const KNOWLEDGE_HEALTH_MAX_ENTRIES = 200;

/** 参与体检的单文档元信息（当前 epoch 全量）。 */
export interface HealthDocumentMeta {
  id: number;
  relativePath: string;
  title: string;
}

/** 逐文档信号（调用方按 document 分组喂入，与 insights 快照同一次流式扫描产出）。 */
export interface HealthDocumentSignals {
  /** 该文档全部 wikilink 目标（chunk 内已去重，跨 chunk 并集由调用方维护 Set）。 */
  wikilinkTargets: ReadonlySet<string>;
  /** 除 frontmatter chunk（ordinal=0）外存在非空白正文。 */
  hasBodyContent: boolean;
}

export interface HealthReportInput {
  documents: readonly HealthDocumentMeta[];
  signals: ReadonlyMap<number, HealthDocumentSignals>;
}

/** 剥 `#标题`/`^块` 引用后缀：`#` 之后一律不是路径成分（解析期约定，§5h.3）。 */
function stripReferenceSuffix(target: string): string {
  return target.split("#")[0]?.trim() ?? "";
}

/** 去 `.md` 后缀的 basename（链接惯用形态与 vault 内 display 名一致）。 */
function basenameOf(relativePath: string): string {
  const withoutSuffix = relativePath.replace(/\.md$/u, "");
  const segments = withoutSuffix.split("/");
  return segments[segments.length - 1] ?? withoutSuffix;
}

/** 候选文档按 relativePath 字典序（解析与条目排序共用的确定性基线）。 */
function byRelativePath(left: HealthDocumentMeta, right: HealthDocumentMeta): number {
  return left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0;
}

export function resolveWikilinkTarget(
  rawTarget: string,
  /** 调用方按 relativePath 字典序预排序（computeHealthReport 只排一次；测试同约定）。 */
  sortedDocuments: readonly HealthDocumentMeta[],
): HealthDocumentMeta | null {
  const target = stripReferenceSuffix(rawTarget);
  if (!target) return null;
  const sorted = sortedDocuments;

  // ① 精确等值（含补 .md；两形态同候选取字典序最小，UNIQUE 约束下通常至多一行）。
  const exact = sorted.filter(
    (doc) => doc.relativePath === target || doc.relativePath === `${target}.md`,
  );
  if (exact.length > 0) return exact[0]!;

  // ② 路径后缀匹配：`folder/target` 形态链接省略上层目录时的 Obsidian 惯用解析。
  const suffix = sorted.filter(
    (doc) =>
      doc.relativePath.endsWith(`/${target}`) || doc.relativePath.endsWith(`/${target}.md`),
  );
  if (suffix.length > 0) {
    // 多候选取最短 relative_path（同后缀下最具体的路径优先，确定性不依赖扫描序）。
    return suffix.reduce((best, doc) =>
      doc.relativePath.length < best.relativePath.length ? doc : best,
    );
  }

  // ③ basename 等值：`[[笔记名]]` 惯用形态；多候选取字典序最小（不误报断链）。
  const byBase = sorted.filter((doc) => basenameOf(doc.relativePath) === target);
  return byBase[0] ?? null;
}

/**
 * 体检主计算：入链图（解析后的 wikilink 边）+ 逐文档信号 → 三类发现。
 * 排序一律字典序；条目数组截断至 KNOWLEDGE_HEALTH_MAX_ENTRIES，count 恒为全量。
 */
export function computeHealthReport(input: HealthReportInput): KnowledgeHealthReport {
  const sortedDocuments = [...input.documents].sort(byRelativePath);
  const inbound = new Set<number>();
  const broken: KnowledgeHealthBrokenLinkEntry[] = [];

  for (const doc of sortedDocuments) {
    const signals = input.signals.get(doc.id);
    if (!signals) continue;
    for (const rawTarget of signals.wikilinkTargets) {
      const resolved = resolveWikilinkTarget(rawTarget, sortedDocuments);
      if (!resolved) {
        broken.push({ sourcePath: doc.relativePath, target: rawTarget });
        continue;
      }
      // 自指边不计入链（[[本笔记#段]] 不构成知识连接，spec §5h.3）。
      if (resolved.id !== doc.id) inbound.add(resolved.id);
    }
  }

  const orphans: KnowledgeHealthNoteEntry[] = input.documents
    .filter((doc) => !inbound.has(doc.id))
    .sort(byRelativePath)
    .map((doc) => ({ relativePath: doc.relativePath, title: doc.title }));

  const emptyNotes: KnowledgeHealthNoteEntry[] = input.documents
    .filter((doc) => input.signals.get(doc.id)?.hasBodyContent !== true)
    .sort(byRelativePath)
    .map((doc) => ({ relativePath: doc.relativePath, title: doc.title }));

  broken.sort((left, right) =>
    left.sourcePath !== right.sourcePath
      ? left.sourcePath < right.sourcePath
        ? -1
        : 1
      : left.target < right.target
        ? -1
        : left.target > right.target
          ? 1
          : 0,
  );

  return {
    orphanNotes: orphans.slice(0, KNOWLEDGE_HEALTH_MAX_ENTRIES),
    orphanCount: orphans.length,
    brokenLinks: broken.slice(0, KNOWLEDGE_HEALTH_MAX_ENTRIES),
    brokenLinkCount: broken.length,
    emptyNotes: emptyNotes.slice(0, KNOWLEDGE_HEALTH_MAX_ENTRIES),
    emptyNoteCount: emptyNotes.length,
  };
}

/** 体检信号累积器：insights 快照流式扫描 chunk 行时逐文档收集（单遍纪律）。 */
export class HealthSignalsCollector {
  private readonly targets = new Map<number, Set<string>>();
  private readonly bodyContent = new Map<number, boolean>();

  /**
   * 逐 chunk 喂入。正文非空判定（§5h.3 空笔记口径，宁漏勿误——空笔记会被清理提案
   * 指向删除，误判不可接受）：trim 非空，且**不是**「ordinal=0 且形态上为闭合
   * frontmatter 块」的 chunk。注意 ordinal=0 不等价于 frontmatter chunk——无
   * frontmatter 的文档首块就是正文（chunkMarkdown：frontmatter 边界由 `---` 包围
   * 判定，非恒在），仅按 ordinal 排除会把真实笔记误判为空（knowledgeInsights
   * K-N4-1 集成用例实证）。形态判定与 markdownChunker.parseFrontmatterChunkTags
   * 同口径：首行 `---` 且存在闭合 `---`。
   */
  addChunk(documentId: number, ordinal: number, body: string): void {
    if (body.trim().length > 0 && !(ordinal === 0 && isFrontmatterBlockShape(body))) {
      this.bodyContent.set(documentId, true);
    }
    let set = this.targets.get(documentId);
    if (!set) {
      set = new Set<string>();
      this.targets.set(documentId, set);
    }
    for (const target of extractWikilinkTargets(body)) set.add(target);
  }

  snapshot(): ReadonlyMap<number, HealthDocumentSignals> {
    const signals = new Map<number, HealthDocumentSignals>();
    for (const [id, targetSet] of this.targets) {
      signals.set(id, {
        wikilinkTargets: targetSet,
        hasBodyContent: this.bodyContent.get(id) === true,
      });
    }
    return signals;
  }
}

/** frontmatter 块形态判定（与 markdownChunker.parseFrontmatterChunkTags 边界同口径）。 */
function isFrontmatterBlockShape(chunkText: string): boolean {
  const lines = chunkText.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return false;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]?.trim() === "---") return true;
  }
  return false;
}
