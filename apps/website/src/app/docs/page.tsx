import { readFileSync } from "node:fs";
import path from "node:path";

// docs 欢迎页 body：由 vanilla 站 website/docs/index.html 迁移（注入式过渡），见 specs/website.md
const bodyHtml = readFileSync(
  path.join(process.cwd(), "site-src/docs-index.html"),
  "utf8",
);

export default function DocsHome() {
  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
