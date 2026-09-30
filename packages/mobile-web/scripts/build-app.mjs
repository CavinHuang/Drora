// R3 P2a 源码应用构建编排（spec specs/mobile-relay-r3-frontend.md §13）：
// 1) vite build（见 ../vite.config.ts，root=src/app，outDir=.vite-out）；
// 2) 排列成官方路径形状：dist/remote/v4/index.html + dist/remote/v4/3.14.3/assets/*；
// 3) 校验产物：入口存在、资产图闭合、无官方 URL 字面量、无 sourceMappingURL。
// dist 语义（spec §13.4）：dist = 源码应用产物；快照回退根是 src/recovered（build:snapshot
// 的产物历史上也写 dist，P2a 起快照不再复制进 dist，由 relay-server 直接读 src/recovered）。
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteOut = join(packageRoot, ".vite-out");
const dist = join(packageRoot, "dist");
const assetsTarget = join(dist, "remote", "v4", "3.14.3", "assets");

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

const viteBin = join(packageRoot, "..", "..", "node_modules", "vite", "bin", "vite.js");
await run(process.execPath, [viteBin, "build"]);

// 产物排列：entry html → /remote/v4/index.html；assets/* → /remote/v4/3.14.3/assets/*。
await rm(dist, { recursive: true, force: true });
await mkdir(assetsTarget, { recursive: true });
const viteAssets = join(viteOut, "assets");
const entries = await readdir(viteAssets);
let assetCount = 0;
for (const name of entries) {
  const source = join(viteAssets, name);
  const target = join(assetsTarget, name);
  if (name.endsWith(".js")) {
    const code = await readFile(source, "utf8");
    // 共享 UI 时间线静态依赖的服务默认地址与设置文案会进入惰性 chunk。
    // 手机远控只允许当前来源；把服务默认值改为页面 origin，文案去掉上游域名。
    const localCode = code
      .replaceAll("`https://zcode.z.ai`", "(globalThis.location?.origin??'')")
      .replaceAll("zcode.z.ai", "Drora");
    await writeFile(target, localCode);
  } else {
    await cp(source, target);
  }
  assetCount += 1;
}
for (const name of await readdir(viteOut, { withFileTypes: true })) {
  if (name.isDirectory() || !name.name.endsWith(".html")) continue;
  await cp(join(viteOut, name.name), join(dist, "remote", "v4", "index.html"));
}

// 验收：入口引用**绝对**资源路径（官方形状 /remote/v4/3.14.3/assets/*）。入口在
// /remote/v4（无尾斜杠）下被服务时，相对引用会解析到 /remote/ 下丢 v4 段——E2E
// 实证（P4a，spec §17），故不做相对化改写；产物无官方 URL 字面量、无 sourcemap。
const entryPath = join(dist, "remote", "v4", "index.html");
if (!(await stat(entryPath)).isFile()) {
  throw new Error("vite build did not emit an entry html");
}
const assetNames = await readdir(assetsTarget);
if (assetNames.length < 2 || !assetNames.some((name) => /^index-.*\.js$/.test(name))) {
  throw new Error("vite build asset set is incomplete");
}
let entry = await readFile(entryPath, "utf8");
const refs = [...entry.matchAll(/(?:src|href)="(\/remote\/v4\/3\.14\.3\/assets\/[^"]+)"/g)].map(
  (match) => match[1],
);
if (refs.length < 2) {
  throw new Error("entry does not use absolute official-shaped asset refs");
}
for (const ref of refs) {
  const name = ref.slice("/remote/v4/3.14.3/assets/".length);
  if (!assetNames.includes(name)) {
    throw new Error(`entry references missing asset: ${name}`);
  }
}

const forbidden = ["zcode.z.ai", "sourceMappingURL"];
// sourcemap 诊断模式豁免（MOBILE_ALLOW_SOURCEMAP=1）：.map 产物含 sourceMappingURL
// 与源码内官方 URL 字面量属预期（诊断不上产线；正式构建不设此 env 即恢复守卫）。
const allowSourceMap = process.env.MOBILE_ALLOW_SOURCEMAP === "1";
for (const name of [...assetNames, "index.html"]) {
  const text = await readFile(name === "index.html" ? entryPath : join(assetsTarget, name), "utf8");
  for (const needle of forbidden) {
    if (allowSourceMap) continue;
    if (text.includes(needle)) {
      throw new Error(`built asset ${name} contains forbidden literal: ${needle}`);
    }
  }
}

await rm(viteOut, { recursive: true, force: true });
console.log(`[mobile-web] built source app: ${assetCount + 1} assets under dist/remote/v4`);
