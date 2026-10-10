import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

// 官网支持与反馈页 body：由 vanilla 站迁移（注入式过渡），正文存 site-src/support.html
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/support.html"),
  "utf8",
);

// 标题/描述沿用原 website/support/index.html <head> 的元信息
export const metadata: Metadata = {
  title: "Drora 支持与反馈 | Issue 指南与社区渠道",
  description: "Drora 支持与反馈：GitHub Issues / Discussions / 飞书 / Discord，以及高效反馈模板。",
  openGraph: {
    title: "Drora 支持与反馈 | Issue 指南与社区渠道",
    description: "Drora 支持与反馈：GitHub Issues / Discussions / 飞书 / Discord，以及高效反馈模板。",
    images: ["/Drora/assets/icon.png"],
  },
};

export default function SupportPage() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
