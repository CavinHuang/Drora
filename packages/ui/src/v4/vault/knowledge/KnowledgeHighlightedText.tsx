import type { ReactNode } from "react";
import { planTextHitIntervals } from "@drora/shared";

function getQueryParts(query: string): string[] {
  const seen = new Set<string>();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => {
      if (seen.has(part)) {
        return false;
      }
      seen.add(part);
      return true;
    });
}

export function KnowledgeHighlightedText({
  text,
  query,
  terms,
}: {
  text: string;
  /** 空白分隔的查询串（默认形态）：拆词去重后作匹配词元。 */
  query?: string;
  /** 预提取的匹配词元（如知识检索的 CJK bigram/小写词，spec §5b.5）：提供时优先于 query。 */
  terms?: string[];
}) {
  const matchTerms = terms ?? getQueryParts(query ?? "");
  const ranges = planTextHitIntervals(text, matchTerms);
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const segments: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (cursor < range.start) {
      segments.push(<span key={`plain-${index}`}>{text.slice(cursor, range.start)}</span>);
    }

    segments.push(
      <mark key={`match-${index}`} className="rounded-sm bg-accent font-semibold text-foreground">
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });

  if (cursor < text.length) {
    segments.push(<span key="plain-end">{text.slice(cursor)}</span>);
  }

  return <>{segments}</>;
}
