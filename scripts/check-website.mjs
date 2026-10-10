#!/usr/bin/env node
// apps/website（Next.js 静态导出官网）的部署前门禁（零依赖，deploy-website.yml 的 check job 调用）。
// 门禁对象是注入式迁移产物 site-src/*.html 片段 + public/assets/ legacy 资产 + 路由清单，
// 静态等价于「next build 成功 + out 探针」的部署契约（specs/website.md）：
//  1. 内链/资源完整性：href/src/atlas 必须是 /Drora 绝对路径（Pages 子路径部署契约，specs/website.md）、
//     外链 http(s)/mailto，或本片段组 #anchor；映射规则：
//       /Drora/                    → 首页（src/app/page.tsx）
//       /Drora/docs/               → site-src/docs-index.html + src/app/docs/page.tsx
//       /Drora/docs/<slug>/[#a]    → site-src/docs-<slug>.html + slug 在 [slug]/page.tsx 的 DOCS_SLUGS 清单
//       /Drora/<page>/[#a]         → site-src/<page>.html + src/app/<page>/page.tsx
//       /Drora/assets/**           → apps/website/public/assets/** 文件存在
//  2. 锚点完整性：#target 在所属片段组的 id 集合内解析（首页 before/after 两片段共享 id 空间）
//  3. i18n 门禁：data-i18n(-placeholder) 键必须存在于 public/assets/js/i18n.js 的 en 词典；
//     带 data-i18n 的元素内不得嵌套 a/code/strong/u/b（applyLang 用 textContent 整体替换，
//     嵌套子元素会被抹掉）
//  4. data-base 契约：site-header/site-footer 必须是 "/Drora/"，docs-nav 必须是 "/Drora/docs/"
//
// 用法：
//   node scripts/check-website.mjs          # 静态门禁（CI check job）
//   node scripts/check-website.mjs --out    # 追加构建产物探针（deploy job 在 build 后、上传前跑）
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEBSITE_DIR = fileURLToPath(new URL("../apps/website/", import.meta.url));
const SITE_SRC = path.join(WEBSITE_DIR, "site-src");
const PUBLIC_DIR = path.join(WEBSITE_DIR, "public");
const APP_DIR = path.join(WEBSITE_DIR, "src", "app");

const errors = [];

// ---------- 片段清单与片段组（首页两片段共享 id 空间） ----------
const fragmentFiles = (await readdir(SITE_SRC)).filter((f) => f.endsWith(".html")).sort();
const GROUP_OF = { "home-before.html": "home", "home-after.html": "home" };
const groupIds = new Map(); // group -> Set<id>
const groupHtml = new Map(); // group -> 拼接后的 html（用于锚点与 i18n 扫描）

for (const file of fragmentFiles) {
  const group = GROUP_OF[file] ?? file.replace(/\.html$/, "");
  const raw = await readFile(path.join(SITE_SRC, file), "utf8");
  // 注释不是运行时 DOM（片段头部注释里的 <site-header> 等字样不参与匹配）
  const html = raw.replace(/<!--[\s\S]*?-->/g, "");
  if (!groupIds.has(group)) {
    groupIds.set(group, new Set());
    groupHtml.set(group, "");
  }
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) groupIds.get(group).add(m[1]);
  groupHtml.set(group, groupHtml.get(group) + "\n" + html);
}

// ---------- docs 路由清单（[slug]/page.tsx 的 DOCS_SLUGS，静态探针替代构建产物检查） ----------
const slugPage = await readFile(path.join(APP_DIR, "docs", "[slug]", "page.tsx"), "utf8");
const slugBlock = slugPage.match(/const DOCS_SLUGS = \[([^\]]*)\]/);
if (!slugBlock) {
  console.error("无法解析 src/app/docs/[slug]/page.tsx 的 DOCS_SLUGS 清单");
  process.exit(1);
}
const manifestSlugs = new Set([...slugBlock[1].matchAll(/"([A-Za-z0-9-]+)"/g)].map((m) => m[1]));

// ---------- --out 模式：next build 产物探针（部署契约的第二道门） ----------
// node scripts/check-website.mjs --out
// 路径以脚本自身定位（与调用方 cwd 无关），形态为 trailingSlash: true 的导出契约：
// 首页/404 在 out 根，路由产物是 <route>/index.html（不存在 <route>.html 平铺形态，
// 见 specs/website.md「目录形链接为强制」条款）。
if (process.argv.includes("--out")) {
  const OUT_DIR = path.join(WEBSITE_DIR, "out");
  const outErrors = [];
  const relNeeds = [
    "index.html",
    "404.html",
    "docs/index.html",
    ...[...manifestSlugs].map((slug) => `docs/${slug}/index.html`),
    // not-found 路由的导出形态是 404/index.html（Next 同时产出根级 404.html 供 GitHub Pages 回退）
    ...fragmentFiles
      .filter((f) => !f.startsWith("docs-") && !(f in GROUP_OF))
      .map(
        (f) =>
          `${f.replace(/\.html$/, "") === "not-found" ? "404" : f.replace(/\.html$/, "")}/index.html`,
      ),
    // legacy 资产随 public/ 原样拷入
    "assets/css/style.css",
    "assets/js/components.js",
    "assets/js/i18n.js",
    "assets/js/main.js",
    "assets/pets/noir-idle.webp",
    "assets/favicon.svg",
  ];
  const missing = relNeeds.filter((rel) => !existsSync(path.join(OUT_DIR, ...rel.split("/"))));
  for (const rel of missing) outErrors.push(`缺 apps/website/out/${rel}`);

  // 首页产物：hero mock 已烘焙 + 子路径绝对引用 + 无 .html 链接
  const home = await readFile(path.join(OUT_DIR, "index.html"), "utf8");
  for (const needle of [
    "mock-wrap",
    "win-traffic",
    "chat-input",
    "/Drora/assets/js/components.js",
    'href="/Drora/docs/"',
  ]) {
    if (!home.includes(needle)) outErrors.push(`首页缺 ${needle}`);
  }
  if (/\.html"/.test(home)) outErrors.push("首页含 .html 链接");
  for (const m of home.matchAll(/<(?:script[^>]*src|link[^>]*href)="([^"]+)"/g)) {
    const u = m[1];
    if (/^https?:/.test(u)) continue;
    if (!u.startsWith("/Drora/")) outErrors.push(`首页存在非 /Drora 前缀引用: ${u}`);
  }

  // docs 子页骨架（取清单首页）
  const firstSlug = [...manifestSlugs][0];
  const doc = await readFile(path.join(OUT_DIR, "docs", firstSlug, "index.html"), "utf8");
  for (const needle of [
    `data-current="${firstSlug}"`,
    'data-base="/Drora/docs/"',
    'data-base="/Drora/"',
  ]) {
    if (!doc.includes(needle)) outErrors.push(`docs/${firstSlug} 缺 ${needle}`);
  }

  if (outErrors.length) {
    console.error(`out probe ${outErrors.length} problem(s):`);
    for (const e of outErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `out probe OK: ${relNeeds.length} artifacts (home/404/docs×${manifestSlugs.size}/secondary) + assets/content contracts under apps/website/out`,
  );
  process.exit(0);
}

// ---------- i18n 词典（en） ----------
const i18nJs = await readFile(path.join(PUBLIC_DIR, "assets", "js", "i18n.js"), "utf8");
const dictStart = i18nJs.indexOf("en: {");
if (dictStart < 0) {
  console.error("无法解析 public/assets/js/i18n.js 的 en 词典");
  process.exit(1);
}
const dictKeys = new Set();
for (const m of i18nJs.slice(dictStart).matchAll(/"([a-zA-Z0-9.]+)":/g)) dictKeys.add(m[1]);

// ---------- /Drora 绝对路径解析 ----------
function resolveDrora(ref) {
  // 返回 null（合法且无目标要求）或 { error }；带锚点的目标页锚点由调用方校验
  if (ref === "/Drora" || ref === "/Drora/") {
    if (!existsSync(path.join(APP_DIR, "page.tsx")))
      return { error: `首页路由缺失（src/app/page.tsx）: ${ref}` };
    return null;
  }
  const docs = ref.match(/^\/Drora\/docs\/(?:([A-Za-z0-9-]+)\/)?(#.*)?$/);
  if (docs) {
    const slug = docs[1] ?? "";
    const fragment = slug === "" ? "docs-index.html" : `docs-${slug}.html`;
    if (!fragmentFiles.includes(fragment))
      return { error: `docs 片段不存在: ${ref}（缺 ${fragment}）` };
    if (slug !== "" && !manifestSlugs.has(slug))
      return { error: `slug 不在 [slug]/page.tsx 的 DOCS_SLUGS 清单: ${ref}` };
    if (!existsSync(path.join(APP_DIR, "docs", "page.tsx")))
      return { error: `docs 路由缺失（src/app/docs/page.tsx）: ${ref}` };
    return { fragment, anchor: docs[2]?.slice(1) };
  }
  const page = ref.match(/^\/Drora\/([a-z]+)\/(#.*)?$/);
  if (page) {
    const name = page[1];
    const fragment = `${name}.html`;
    if (!fragmentFiles.includes(fragment))
      return { error: `页面片段不存在: ${ref}（缺 ${fragment}）` };
    if (!existsSync(path.join(APP_DIR, name, "page.tsx")))
      return { error: `路由缺失（src/app/${name}/page.tsx）: ${ref}` };
    return { fragment, anchor: page[2]?.slice(1) };
  }
  const asset = ref.match(/^\/Drora\/assets\/(.+)$/);
  if (asset) {
    if (!existsSync(path.join(PUBLIC_DIR, "assets", ...asset[1].split("/")))) {
      return { error: `资源不存在于 public/assets/: ${ref}` };
    }
    return null;
  }
  return { error: `无法解析的 /Drora 内链: ${ref}` };
}

// ---------- 逐片段检查 ----------
let linkCount = 0;
let anchorCount = 0;

for (const file of fragmentFiles) {
  const group = GROUP_OF[file] ?? file.replace(/\.html$/, "");
  const raw = await readFile(path.join(SITE_SRC, file), "utf8");
  // 注释不是运行时 DOM（片段头部注释里的 <site-header> 等字样不参与匹配）
  const html = raw.replace(/<!--[\s\S]*?-->/g, "");

  // 1) href/src/atlas 引用
  const refs = [];
  for (const m of html.matchAll(/(?:href|src|atlas)="([^"]+)"/g)) refs.push({ v: m[1] });

  for (const { v: ref } of refs) {
    if (/^(https?:|mailto:|javascript:|data:)/.test(ref)) continue;
    linkCount += 1;
    if (ref.startsWith("#")) {
      anchorCount += 1;
      if (!groupIds.get(group).has(ref.slice(1))) errors.push(`${file}: 本片段组锚点不存在 ${ref}`);
      continue;
    }
    if (!ref.startsWith("/Drora")) {
      errors.push(`${file}: 内链必须以 /Drora 为前缀（子路径部署契约）: ${ref}`);
      continue;
    }
    const t = resolveDrora(ref);
    if (t && t.error) {
      errors.push(`${file}: ${t.error}`);
      continue;
    }
    if (t && t.anchor) {
      anchorCount += 1;
      const targetIds = groupIds.get(t.fragment.replace(/\.html$/, ""));
      if (!targetIds || !targetIds.has(t.anchor)) {
        errors.push(`${file}: 目标页缺少锚点 ${ref}`);
      }
    }
  }

  // 2) i18n：键必须入典 + 禁止嵌套可交互子元素
  for (const m of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) {
    if (!dictKeys.has(m[1])) errors.push(`${file}: i18n 键不在 i18n.js en 词典: ${m[1]}`);
  }
  for (const m of html.matchAll(/<([a-z0-9]+)[^>]*data-i18n="[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (/<(a|code|strong|u|b)\b/.test(m[2])) {
      errors.push(
        `${file}: data-i18n 元素内嵌套了 <${m[2].match(/<([a-z0-9]+)/)[1]}>（applyLang 会抹掉子元素）`,
      );
    }
  }

  // 3) data-base 契约
  for (const m of html.matchAll(/<site-header[^>]*>/g)) {
    if (!/data-base="\/Drora\/"/.test(m[0]))
      errors.push(`${file}: site-header data-base 必须是 "/Drora/"`);
  }
  for (const m of html.matchAll(/<site-footer[^>]*>/g)) {
    if (!/data-base="\/Drora\/"/.test(m[0]))
      errors.push(`${file}: site-footer data-base 必须是 "/Drora/"`);
  }
  for (const m of html.matchAll(/<docs-nav[^>]*>/g)) {
    if (!/data-base="\/Drora\/docs\/"/.test(m[0]))
      errors.push(`${file}: docs-nav data-base 必须是 "/Drora/docs/"`);
  }
}

// ---------- 片段 ↔ 路由配对（防止片段无路由 / 路由无片段） ----------
for (const file of fragmentFiles) {
  const base = file.replace(/\.html$/, "");
  if (base === "home-before" || base === "home-after") {
    if (!existsSync(path.join(APP_DIR, "page.tsx")))
      errors.push(`${file}: 无对应路由 src/app/page.tsx`);
  } else if (base === "docs-index") {
    if (!existsSync(path.join(APP_DIR, "docs", "page.tsx")))
      errors.push(`${file}: 无对应路由 src/app/docs/page.tsx`);
  } else if (base.startsWith("docs-")) {
    if (!manifestSlugs.has(base.slice(5))) errors.push(`${file}: slug 不在 DOCS_SLUGS 清单`);
  } else if (base === "not-found") {
    if (!existsSync(path.join(APP_DIR, "not-found.tsx")))
      errors.push(`${file}: 无对应路由 src/app/not-found.tsx`);
  } else if (!existsSync(path.join(APP_DIR, base, "page.tsx"))) {
    errors.push(`${file}: 无对应路由 src/app/${base}/page.tsx`);
  }
}
for (const slug of manifestSlugs) {
  if (!fragmentFiles.includes(`docs-${slug}.html`))
    errors.push(`DOCS_SLUGS 清单中的 ${slug} 缺少 site-src/docs-${slug}.html`);
}
for (const entry of await readdir(APP_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "docs") continue; // docs 的配对已由 DOCS_SLUGS 清单覆盖
  if (!existsSync(path.join(APP_DIR, entry.name, "page.tsx"))) continue;
  if (!fragmentFiles.includes(`${entry.name}.html`)) {
    errors.push(`src/app/${entry.name}/page.tsx 缺少 site-src/${entry.name}.html 片段`);
  }
}

// ---------- 汇总 ----------
console.log(
  `checked ${fragmentFiles.length} fragments, ${manifestSlugs.size} docs routes, ${linkCount} links, ${anchorCount} anchors, ${dictKeys.size} i18n keys in apps/website/site-src/`,
);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("website check: OK");
