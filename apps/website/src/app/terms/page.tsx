import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

// 官网使用条款页 body：由 vanilla 站迁移（注入式过渡），正文存 site-src/terms.html
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/terms.html"),
  "utf8",
);

// 标题/描述沿用原 website/terms/index.html <head> 的元信息
export const metadata: Metadata = {
  title: "Drora 使用条款 | 开源许可与声明",
  description: "Drora 使用条款：Apache-2.0 开源许可、功能范围与维护、执行风险与责任限制。",
  openGraph: {
    title: "Drora 使用条款 | 开源许可与声明",
    description: "Drora 使用条款：Apache-2.0 开源许可、功能范围与维护、执行风险与责任限制。",
    images: ["/Drora/assets/icon.png"],
  },
};

export default function TermsPage() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
