#!/usr/bin/env node
// website/ 静态站的部署前门禁（零依赖，deploy-website.yml 的 check job 调用）：
//  1. 内链与资源完整性：href/src/og:image/data-atlas 指向的站内文件必须存在；
//     站内链接必须是相对路径（specs/website.md：子路径部署禁止根绝对路径）
//  2. 锚点完整性：#target 必须能在目标文件（或本文件）中找到 id
//  3. i18n 门禁：data-i18n 键必须存在于 main.js 词典；
//     带 data-i18n 的元素内不得嵌套 a/code/strong/u/b（applyLang 用 textContent
//     整体替换，嵌套子元素会被抹掉）
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../website/", import.meta.url));
const JS = path.join(ROOT, "assets", "js");

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = await walk(ROOT);
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const errors = [];

// ---------- 收集每个页面的 id 集合与引用 ----------
const idsByFile = new Map();
const pageUrls = new Set(); // 相对 ROOT 的 URL（"index.html"、"docs/install.html"）

for (const file of htmlFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  pageUrls.add(rel);
  const html = await readFile(file, "utf8");
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  idsByFile.set(file, { html, rel, ids });
}

// ---------- 词典键（i18n 门禁的对照面） ----------
const mainJs = await readFile(path.join(JS, "main.js"), "utf8");
const dictStart = mainJs.indexOf("en: {");
const dictKeys = new Set();
for (const m of mainJs.slice(dictStart).matchAll(/"([a-zA-Z0-9.]+)":/g)) dictKeys.add(m[1]);

// ---------- 逐页检查引用与 i18n ----------
let linkCount = 0;
let anchorCount = 0;

function resolveTarget(fromFile, ref) {
  // 返回 { file, anchor } 或 { error }
  const [rawPath, anchor] = ref.split("#");
  if (rawPath.startsWith("/")) return { error: `根绝对路径（子路径部署禁止）: ${ref}` };
  const base = path.dirname(fromFile);
  const target = rawPath === "" ? fromFile : path.resolve(base, rawPath);
  // 根目录本身（"./"）合法；其余必须在 ROOT 之下（两侧统一尾分隔符再比较）
  const rootNorm = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  const targetNorm = target.endsWith(path.sep) ? target : target + path.sep;
  if (targetNorm !== rootNorm && !targetNorm.startsWith(rootNorm)) return { error: `逃出 website/ 目录: ${ref}` };
  // 目录型链接（"./"、"./"、"docs/"）指向该目录的 index.html
  let final = target;
  if (rawPath.endsWith("/") || (!path.extname(target) && existsSync(target) && existsSync(path.join(target, "index.html")))) {
    final = path.join(target, "index.html");
  }
  if (!existsSync(final)) return { error: `目标不存在: ${ref}` };
  return { file: final, anchor };
}

for (const file of htmlFiles) {
  const { html, rel, ids } = idsByFile.get(file);

  const refs = [];
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/content="((?:\.\.?\/)?assets\/[^"]+)"/g)) refs.push(m[1]); // og:image 等
  for (const m of html.matchAll(/data-atlas="([^"]+)"/g)) refs.push(m[1]);

  for (const ref of refs) {
    if (/^(https?:|mailto:|javascript:|data:)/.test(ref)) continue;
    linkCount += 1;
    if (ref.startsWith("#")) {
      anchorCount += 1;
      if (!ids.has(ref.slice(1))) errors.push(`${rel}: 本页锚点不存在 ${ref}`);
      continue;
    }
    const t = resolveTarget(file, ref);
    if (t.error) {
      errors.push(`${rel}: ${t.error}`);
      continue;
    }
    if (t.anchor) {
      anchorCount += 1;
      const targetPage = idsByFile.get(t.file);
      if (!targetPage) {
        if (!existsSync(t.file)) errors.push(`${rel}: 锚点目标文件不存在 ${ref}`);
        continue;
      }
      if (!targetPage.ids.has(t.anchor)) {
        errors.push(`${rel}: 目标页缺少锚点 ${ref}（${path.relative(ROOT, t.file)}）`);
      }
    }
  }

  // i18n：键必须入典 + 禁止嵌套可交互子元素
  for (const m of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) {
    if (!dictKeys.has(m[1])) errors.push(`${rel}: i18n 键不在 main.js 词典: ${m[1]}`);
  }
  for (const m of html.matchAll(/<([a-z0-9]+)[^>]*data-i18n="[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (/<(a|code|strong|u|b)\b/.test(m[2])) {
      errors.push(`${rel}: data-i18n 元素内嵌套了 <${m[2].match(/<([a-z0-9]+)/)[1]}>（applyLang 会抹掉子元素）`);
    }
  }
}

// ---------- 汇总 ----------
const label = path.relative(process.cwd(), ROOT).split(path.sep).join("/") || "website";
console.log(
  `checked ${htmlFiles.length} pages, ${linkCount} links, ${anchorCount} anchors, ${dictKeys.size} i18n keys in ${label}/`
);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("website check: OK");
