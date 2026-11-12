// Vault 面板构建（specs/obsidian-vault-phase2-true-extraction.md §2/§10-P5）：
// src/ui/main.tsx → dist/ui/panel.html（React 单文件内联，drora-site scripts/build.mjs
// 同款纪律——体积远低于宿主单次读 ui:// HTML 的 16 MiB 上限，不分片）。
// server 侧 dist/mcp/server.js 经 uiResources.resolvePanelPath 读同一产物。
import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeNotices } from "../../office-runtime/scripts/licenses.mjs";

const packageRoot = resolve(import.meta.dirname, "..");

export const buildVaultPanelBundle = async ({
  outfile = resolve(packageRoot, "dist", "ui", "panel.html"),
} = {}) => {
  await rm(join(packageRoot, "dist", "ui"), { recursive: true, force: true });
  await mkdir(dirname(outfile), { recursive: true });
  const panel = await build({
    metafile: true,
    entryPoints: [join(packageRoot, "src", "ui", "main.tsx")],
    jsx: "automatic",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
    write: false,
    logOverride: { "direct-eval": "silent" },
  });
  const html = (await readFile(join(packageRoot, "src", "ui", "panel.html"), "utf8")).replace(
    "/*__SCRIPT__*/",
    () => panel.outputFiles[0].text.replaceAll("</script", "<\\/script"),
  );
  await writeFile(outfile, html);
  await writeNotices([panel.metafile], join(packageRoot, "dist", "ui", "THIRD_PARTY_NOTICES.txt"));
  return { outfile };
};

const entryPath = process.argv[1];
if (entryPath && import.meta.url === new URL(`file://${entryPath}`).href) {
  const { outfile } = await buildVaultPanelBundle();
  console.log(`[obsidian-plugin] ${outfile}`);
}
