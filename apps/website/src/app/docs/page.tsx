import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";

// docs 欢迎页 body：由 vanilla 站 website/docs/index.html 迁移（注入式过渡），见 specs/website.md
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/docs-index.html"),
  "utf8",
);

// 参考站 docs 页有专用标题（「ZCode 文档 | …」），welcome 不能回落首页通用题
export const metadata: Metadata = {
  title: "Drora 文档 | GLM-5.3 开源氛围编程工具",
};

export default function DocsHome() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
