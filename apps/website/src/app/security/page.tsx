import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

// 官网提交漏洞页 body：由 vanilla 站迁移（注入式过渡），正文存 site-src/security.html
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/security.html"),
  "utf8",
);

// 标题/描述沿用原 website/security/index.html <head> 的元信息
export const metadata: Metadata = {
  title: "Drora 提交漏洞 | 安全问题报告渠道",
  description: "报告 Drora 的安全与隐私问题：GitHub 私密漏洞报告、测试范围与处理流程。",
  openGraph: {
    title: "Drora 提交漏洞 | 安全问题报告渠道",
    description: "报告 Drora 的安全与隐私问题：GitHub 私密漏洞报告、测试范围与处理流程。",
    images: ["/Drora/assets/icon.png"],
  },
};

export default function SecurityPage() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
