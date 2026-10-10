import { readFileSync } from "node:fs";
import path from "node:path";

// 官网 404 页 body：由 vanilla 站迁移（注入式过渡），正文存 site-src/not-found.html
// not-found.tsx 同样用 readFileSync 注入；App Router 不支持在 not-found.tsx 导出 metadata
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/not-found.html"),
  "utf8",
);

export default function NotFound() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
