import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

// 官网社区页 body：由 vanilla 站迁移（注入式过渡），正文存 site-src/community.html
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/community.html"),
  "utf8",
);

// 标题/描述沿用原 website/community/index.html <head> 的元信息
export const metadata: Metadata = {
  title: "Drora 社区 | 飞书 · Discord · Discussions",
  description: "加入 Drora 社区：飞书社群、Discord、GitHub Discussions 与参与贡献指南。",
  openGraph: {
    title: "Drora 社区 | 飞书 · Discord · Discussions",
    description: "加入 Drora 社区：飞书社群、Discord、GitHub Discussions 与参与贡献指南。",
    images: ["/Drora/assets/icon.png"],
  },
};

export default function CommunityPage() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
