// 自检：从 server 模块文本提取 PHONE_PAGE_HTML 的字面内容（模拟模板求值），
// 1) 校验页面 <script> JS 语法；2) 校验没有 ${ 残留（会被外层模板插值）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const file = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "main",
  "desktopMobilePairingServer.ts",
);
const src = readFileSync(file, "utf8");
const start = src.indexOf("const PHONE_PAGE_HTML = `") + "const PHONE_PAGE_HTML = `".length;
const end = src.indexOf("`;", start);
const literal = src.slice(start, end);
if (literal.includes("${")) throw new Error("template interpolation leaked into page");

// 模拟模板字面量求值：处理常见转义。
const evaluated = literal
  .replace(/\\\`/g, "`")
  .replace(/\\\$/g, "$")
  .replace(/\\\\/g, "\\");
// 反向检查：页面 JS 里不能出现真实反斜杠换行碎片。
const scriptStart = evaluated.indexOf("<script>") + "<script>".length;
const scriptEnd = evaluated.lastIndexOf("</script>");
const js = evaluated.slice(scriptStart, scriptEnd);
const result = ts.transpileModule(js, { compilerOptions: { target: 99 } });
if (result.diagnostics && result.diagnostics.length > 0) {
  throw new Error("page JS diagnostics: " + JSON.stringify(result.diagnostics));
}
new Function(js);
console.log("page JS syntax OK, length:", js.length);
console.log("has join newline handling:", js.includes("String.fromCharCode(10)"));
console.log("has auto reconnect:", js.includes("retryTimer"));
console.log("has list auto refresh:", js.includes("startListTimer"));
console.log("has timeline auto refresh:", js.includes("startChatTimer"));
