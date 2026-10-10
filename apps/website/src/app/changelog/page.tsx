import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

// 官网更新日志页 body：由 vanilla 站迁移（注入式过渡），正文存 site-src/changelog.html
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/changelog.html"),
  "utf8",
);

// 标题/描述沿用原 website/changelog/index.html <head> 的元信息
export const metadata: Metadata = {
  title: "Drora 版本发布与更新",
  description: "Drora 各版本的更新说明与桌面端下载：新功能、问题修复与安装包发布记录。",
  openGraph: {
    title: "Drora 版本发布与更新",
    description: "Drora 各版本的更新说明与桌面端下载。",
    images: ["/Drora/assets/icon.png"],
  },
};

export default function ChangelogPage() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
