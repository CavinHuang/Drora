import { readFileSync } from "node:fs";
import path from "node:path";

// docs 子页 slug 清单（与 vanilla 站 docs IA / components.js DOCS_IA 一致）；欢迎页走 app/docs/page.tsx
const DOCS_SLUGS = [
  "install",
  "configuration",
  "goal",
  "history",
  "remote-control",
  "remote-dev",
  "pets",
  "skin",
  "usage-stats",
  "agents",
  "task-management",
  "memory",
  "skills",
  "subagents",
  "mcp",
  "hooks",
  "automation",
  "safety-confirm",
  "ADE-tools",
  "cli",
  "build",
  "faq",
  "keyboard-shortcuts",
] as const;

export function generateStaticParams() {
  return DOCS_SLUGS.map((slug) => ({ slug }));
}

// 静态导出：清单外的 slug 直接 404，不落兜底分支
export const dynamicParams = false;

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // 各子页 body：由 vanilla 站 website/docs/<slug>.html 迁移（注入式过渡），见 specs/website.md
  const bodyHtml = readFileSync(
    path.join(process.cwd(), `site-src/docs-${slug}.html`),
    "utf8",
  );
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
