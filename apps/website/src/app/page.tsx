import { readFileSync } from "node:fs";
import path from "node:path";

// 官网首页 body：由 vanilla 站迁移（注入式过渡），mock 区域将由真实组件替换
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/home.body.html"),
  "utf8",
);

export default function Home() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
