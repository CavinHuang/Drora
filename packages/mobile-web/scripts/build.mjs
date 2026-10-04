// 快照构建（D7 语义，R3 P2a 修订）：把 src/recovered 官方 3.14.3 快照逐字节拷贝为
// 独立页面包，供独立部署 `relay-server --mobile-dir <out>` 使用。
// P2a 起 dist = 源码应用产物（scripts/build-app.mjs，spec §13.4），快照不再写 dist——
// 输出目录经 --out 显式注入（仅允许包外或临时目录，防止覆盖源码应用产物）。
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(packageRoot, "src", "recovered");

const outIndex = process.argv.indexOf("--out");
const outArg = outIndex > 0 ? process.argv[outIndex + 1] : undefined;
if (!outArg) {
  throw new Error("build:snapshot requires --out <dir> (dist is reserved for the source app)");
}
const target = resolve(outArg);

// 防呆：输出不得落在包内受控目录（src/upstream/scripts/dist）——包外目录或包内
// .tmp-* 临时目录皆可。
const targetRelative = relative(packageRoot, target);
const outsidePackage = targetRelative.startsWith(`..${sep}`);
if (!outsidePackage && !targetRelative.startsWith(".tmp-")) {
  throw new Error("snapshot build --out must stay outside the package or in a .tmp-* dir");
}

const entry = join(source, "remote", "v4", "index.html");
const assets = join(source, "remote", "v4", "3.14.3", "assets");
if (!(await stat(entry)).isFile()) throw new Error("recovered remote/v4 entry is missing");
const chunks = await readdir(assets);
if (chunks.length < 50 || !chunks.some((name) => /^index-.*\.js$/u.test(name))) {
  throw new Error("recovered 3.14.3 asset set is incomplete");
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(`[mobile-web] built ${chunks.length + 1} remote page assets from recovered source`);
