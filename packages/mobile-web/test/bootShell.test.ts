// 入口壳还原守卫（specs/mobile-relay-r3-frontend.md §32.19）。
// 官方入口 HTML（upstream 冻结字节）的浏览器表面语义逐项对齐：
// theme-color #161616 默认 + color-scheme meta + 内嵌 base64 favicon +
// 预渲染启动壳（loading 屏/主题 bootstrap 属性/表面覆盖）+ 单一主题源 zcode-theme
// （ui 主题 store 同键，值族 zai-*，默认 zai-dark）+ 运行时切换同步。
// 运行：node --import tsx --test packages/mobile-web/test/bootShell.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readEntryHtml(): Promise<string> {
  return readFile(join(packageRoot, "src/app/index.html"), "utf8");
}

test("入口 meta：theme-color 暗色默认 #161616 + color-scheme（官方壳语义）", async () => {
  const html = await readEntryHtml();
  assert.ok(html.includes('<meta name="theme-color" content="#161616" />'));
  assert.ok(html.includes('<meta name="color-scheme" content="dark" />'));
  // 脚手架残留浅色值不得回归
  assert.ok(!html.includes("#f5f5f5"));
});

test("内嵌 favicon：base64 data-uri 32x32（官方 Chrome dev 不发 favicon 请求的修复结构）", async () => {
  const html = await readEntryHtml();
  assert.ok(
    /rel="icon" type="image\/png" sizes="32x32" href="data:image\/png;base64,[A-Za-z0-9+/=]{200,}"/.test(
      html,
    ),
  );
});

test("首帧脚本：单一主题源 zcode-theme（zai-* 值族/默认 zai-dark/官方归一化/旧键迁移回退）", async () => {
  const html = await readEntryHtml();
  assert.ok(html.includes('var STORAGE_KEY = "zcode-theme"'));
  assert.ok(html.includes('var DEFAULT_THEME = "zai-dark"'));
  assert.ok(html.includes('var LEGACY_STORAGE_KEY = "zcode-mobile-theme"'));
  // 官方 normalizeResolvedTheme 四分支
  assert.ok(html.includes('"zai-dark") return "dark"'));
  assert.ok(html.includes('"zai-light") return "light"'));
  assert.ok(html.includes('saved === "system"'));
  assert.ok(html.includes("prefers-color-scheme: dark"));
  // 官方 BROWSER_THEME_COLORS 表
  assert.ok(html.includes('var BROWSER_THEME_COLORS = { dark: "#161616", light: "#f8f8f8" }'));
  // storage 异常回落暗色面（官方 catch 分支语义）
  assert.ok(/catch[\s\S]{0,400}syncBrowserThemeSurface\("dark"\)/.test(html));
});

test("预渲染启动壳：loading 屏 + logo 壳 + 表面背景覆盖（官方 .zcode-boot-loading 结构）", async () => {
  const html = await readEntryHtml();
  assert.ok(html.includes('class="zcode-boot-loading"'));
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('aria-busy="true"'));
  assert.ok(html.includes("zcode-boot-loading__logo-shell"));
  // ui 全局样式的 vibrancy 透明背景覆盖（官方 browser-theme-surface !important 修复）
  assert.ok(html.includes('html[data-zcode-browser-theme-surface] body'));
  assert.ok(html.includes("!important"));
});

test("运行时切换同步：toggleTheme 写单源 zcode-theme（zai-* 值）+ meta/theme-zai 类联动", async () => {
  const app = await readFile(join(packageRoot, "src/app/App.tsx"), "utf8");
  assert.ok(app.includes('localStorage.setItem("zcode-theme"'));
  assert.ok(app.includes('"zai-dark"'));
  assert.ok(app.includes('"zai-light"'));
  assert.ok(app.includes('meta[name="theme-color"]'));
  assert.ok(app.includes('meta[name="color-scheme"]'));
  assert.ok(app.includes('"#161616"'));
  assert.ok(app.includes('"#f8f8f8"'));
  assert.ok(app.includes('classList.toggle("theme-zai-dark", dark)'));
  assert.ok(app.includes("data-zcode-browser-theme-surface"));
});
