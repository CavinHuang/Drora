// 文件类型图标还原单测（specs/mobile-relay-r3-frontend.md §32.17）。
// 覆盖：官方 NCe/PCe 映射闭集（与 public/material-icons 46 枚对账）、图标名选择器
// 分支（bundle ICe 逐分支）、回退链（UCe：原 URL → document.svg → 内联 → null）、
// 内联 SVG 与官方 bundle 字节级一致（还原资产守卫）。
// 运行：node --import tsx --test packages/mobile-web/test/fileIcon.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DEFAULT_FILE_ICON_BASE,
  DOCUMENT_ICON_INLINE_SRC,
  DOCUMENT_ICON_NAME,
  FILE_ICON_NAMES,
  FOLDER_ICON_NAME,
  fileNameToIconName,
  fileIconBaseUrl,
  fileIconNameFor,
  fileIconSrc,
  resolveFileIconFallbackSrc,
} from "../src/ui/fileIcon.js";

const packageRoot = resolve(import.meta.dirname, "..");

test("图标名闭集 = 46 枚，且与 public/material-icons 下发集逐名对账", async () => {
  assert.equal(FILE_ICON_NAMES.length, 46);
  const onDisk = (await readdir(join(packageRoot, "public", "material-icons"))).sort();
  assert.deepEqual(
    [...FILE_ICON_NAMES].map((name) => `${name}.svg`),
    onDisk,
  );
});

test("内联回退 SVG 与官方 bundle 字节级一致（还原资产守卫）", async () => {
  const bundle = await readFile(
    join(packageRoot, "upstream", "remote", "v4", "3.14.3", "assets", "index-NjWRUABD.js"),
    "utf8",
  );
  assert.ok(bundle.includes(DOCUMENT_ICON_INLINE_SRC), "LCe 内联字面量应逐字节存在于官方 bundle");
});

test("文件名映射（NCe）：点分段候选依插入序命中", () => {
  assert.equal(fileNameToIconName(".gitignore"), "git");
  assert.equal(fileNameToIconName(".env"), "settings");
  assert.equal(fileNameToIconName("babel.config.js"), "babel");
  assert.equal(fileNameToIconName("eslint.config.mjs"), "eslint");
  assert.equal(fileNameToIconName("pnpm-lock.yaml"), "lock");
  assert.equal(fileNameToIconName("package.json"), "json");
  assert.equal(fileNameToIconName("tsconfig.json"), "tsconfig");
  assert.equal(fileNameToIconName("DOCKERFILE"), "docker"); // 小写归一后命中
});

test("扩展名映射（PCe）与回退：未映射扩展名返回扩展名本身（线上 404 由回退链兜底）", () => {
  assert.equal(fileNameToIconName("src/index.tsx"), "react_ts");
  assert.equal(fileNameToIconName("src\\a.ts"), "typescript"); // 反斜杠归一（kh）
  assert.equal(fileNameToIconName("docs/README.MD"), "readme"); // stem 先命中文件名表（NCe 优先于 PCe）
  assert.equal(fileNameToIconName("docs/NOTES.md"), "markdown");
  assert.equal(fileNameToIconName("app.exefoobar"), "exefoobar");
  assert.equal(fileNameToIconName("LICENSE"), DOCUMENT_ICON_NAME); // 无扩展名未命中 → document
});

test("kind=directory 恒 folder（Mh 分支）；文件 kind 走名称选择器", () => {
  assert.equal(fileIconNameFor("src/components", "directory"), FOLDER_ICON_NAME);
  assert.equal(fileIconNameFor("src/a.py", "file"), "python");
  assert.equal(fileIconNameFor("src/a.py"), "python");
});

test("图标 URL 形状：官方基址 + name.svg；node:test 无 vite 注入时回落官方字面量", () => {
  assert.equal(fileIconBaseUrl(), `${DEFAULT_FILE_ICON_BASE}material-icons`);
  assert.equal(fileIconSrc("typescript"), "/remote/v4/3.14.3/material-icons/typescript.svg");
});

test("回退链（UCe）：原 URL → document.svg → 内联 → null 终止", () => {
  const unknown = fileIconSrc("exefoobar");
  const documentUrl = fileIconSrc(DOCUMENT_ICON_NAME);
  assert.equal(resolveFileIconFallbackSrc(unknown), documentUrl);
  assert.equal(resolveFileIconFallbackSrc(documentUrl), DOCUMENT_ICON_INLINE_SRC);
  assert.equal(
    resolveFileIconFallbackSrc("/other-base/material-icons/document.svg"),
    DOCUMENT_ICON_INLINE_SRC,
  ); // endsWith('/document.svg') 分支
  assert.equal(resolveFileIconFallbackSrc(DOCUMENT_ICON_INLINE_SRC), null);
});
