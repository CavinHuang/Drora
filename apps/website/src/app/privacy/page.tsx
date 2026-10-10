import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

// 官网隐私说明页 body：由 vanilla 站迁移（注入式过渡），正文存 site-src/privacy.html
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/privacy.html"),
  "utf8",
);

// 标题/描述沿用原 website/privacy/index.html <head> 的元信息
export const metadata: Metadata = {
  title: "Drora 隐私说明 | 本地优先的数据与网络行为",
  description: "Drora 隐私说明：本地存储位置、模型请求去向、凭据与反馈附件注意事项。",
  openGraph: {
    title: "Drora 隐私说明 | 本地优先的数据与网络行为",
    description: "Drora 隐私说明：本地存储位置、模型请求去向、凭据与反馈附件注意事项。",
    images: ["/Drora/assets/icon.png"],
  },
};

export default function PrivacyPage() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
