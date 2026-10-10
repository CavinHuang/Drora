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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = SLUG_TITLES[slug] ?? slug;
  return { title: `${name} | Drora 文档` };
}

const SLUG_TITLES: Record<string, string> = {
  install: "安装",
  configuration: "连接模型",
  goal: "任务与目标模式",
  history: "会话与编辑历史",
  "remote-control": "手机远控",
  "remote-dev": "远程开发",
  pets: "桌面宠物",
  skin: "皮肤中心",
  "usage-stats": "使用统计",
  skills: "技能与斜杠命令",
  subagents: "子智能体",
  mcp: "MCP 与插件",
  hooks: "Hooks",
  automation: "自动化任务",
  cli: "命令行 CLI",
  build: "从源码构建",
  faq: "常见问题",
};

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
