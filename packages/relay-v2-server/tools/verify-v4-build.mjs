// /remote/v4 手机页面构建校验（specs/relay-v2-server.md §8.2/§8.3，M3 部署链路）：
// 以自建域 env 起子进程跑 `vite build --base=/remote/v4/`，然后校验 packages/web/dist：
//   1) base 前缀生效——index.html 的资产引用带 /remote/v4/ 前缀（§8.1 静态托管的配套产物）；
//   2) OAuth redirect 推导烘焙了自建域（redirectUri = buildDroraEndpointUrls(origin)
//      .webRemoteCallbackUrl，webZaiOAuthConfig.ts 构建期推导）；
//   3) 官方域 redirect 反例（不得烘焙 zcode.z.ai 的远控推导）。
// 任一步失败非零退出并输出原因。
//
// 运行：
//   node tools/verify-v4-build.mjs
//
// env 关键事实（v2.2 实测，spec §8.2 已登记）：web 包 vite.config 的 define 经
// resolveRuntimeDroraEndpointOrigin 解析 `import.meta.env.VITE_DRORA_ENDPOINT_ORIGIN`，
// 消费的是**无 VITE_ 前缀的 DRORA_ENDPOINT_ORIGIN**——只设 VITE_ 变量时产物仍会烘焙官方
// 默认域（OAuth redirect 静默指回 zcode.z.ai）。因此本工具同时注入两个键并做反例校验。
//
// vite 解析：优先 packages/web/node_modules/.bin/vite，退回仓库根 node_modules/.bin/vite
// （pnpm 提升）；都不存在时报错退出（先 pnpm install）。
//
// 实现约束：输出统一走 process.stdout/stderr.write（禁 console.log）；构建子进程输出仅失败时
// 回显尾部。校验只扫描文本资产（.js/.html/.css），**不含 .map**——sourcemap 内嵌源码文本会
// 保留与运行时无关的官方域字面量，混入会造成假阳性。退出码：0 通过；1 任一步失败。

import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line) => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);

const SELF_HOSTED_ORIGIN = "https://relay.example.com";
const OFFICIAL_ORIGIN = "https://zcode.z.ai";
/** 官方域 redirect 推导的完整字面量（好构建中不应出现；源码内也无此硬编码，见 spec §8.2） */
const OFFICIAL_REDIRECT = `${OFFICIAL_ORIGIN}/remote/v4`;
/**
 * 坏构建（漏设 DRORA_ENDPOINT_ORIGIN）时 define 解析出的内联 env 对象条目形状（实测样本：
 * `VITE_DRORA_BASE_URL:`https://zcode.z.ai``）。只认「名字后紧跟引号值」的条目形态——
 * 源码里的回退链 `VITE_DRORA_ENDPOINT_ORIGIN?.trim()||`https://zcode.z.ai``（DEFAULT 常量
 * 无论好坏构建都在产物里）名字与值之间有 `?.trim()||`，不会被误报。
 */
const OFFICIAL_BAKE_SHAPE =
  /VITE_DRORA_(?:BASE_URL|ENDPOINT_ORIGIN)[`"']https:\/\/zcode\.z\.ai[`"']/;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`超时（${ms}ms）：${label}`)), ms).unref(),
    ),
  ]);

function assert(condition, label) {
  if (!condition) throw new Error(`校验失败：${label}`);
}

async function isFile(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 递归收集目录下指定后缀的文本资产（不含 .map，见头注） */
async function collectTextAssets(dir, suffixes, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectTextAssets(full, suffixes, acc);
    } else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      acc.push(full);
    }
  }
  return acc;
}

async function main() {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const repoRoot = join(packageRoot, "..", "..");
  const webRoot = join(repoRoot, "packages", "web");
  const distRoot = join(webRoot, "dist");

  const viteBinCandidates = [
    join(webRoot, "node_modules", ".bin", "vite"),
    join(repoRoot, "node_modules", ".bin", "vite"),
  ];
  const viteBinResolved =
    ((await isFile(viteBinCandidates[0])) && viteBinCandidates[0]) ||
    ((await isFile(viteBinCandidates[1])) && viteBinCandidates[1]);
  if (!viteBinResolved) {
    throw new Error(
      `找不到 vite 可执行入口（尝试过 ${viteBinCandidates.join("、")}）；先在仓库根 pnpm install`,
    );
  }

  out("[1/3] 以自建域 env 构建：vite build --base=/remote/v4/");
  const build = spawn(process.execPath, [viteBinResolved, "build", "--base=/remote/v4/"], {
    cwd: webRoot,
    env: {
      ...process.env,
      VITE_DRORA_ENDPOINT_ORIGIN: SELF_HOSTED_ORIGIN,
      // vite define 链实际消费的键（无 VITE_ 前缀）——漏设它产物会烘焙官方域，见头注
      DRORA_ENDPOINT_ORIGIN: SELF_HOSTED_ORIGIN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const buildOut = [];
  build.stdout.on("data", (chunk) => buildOut.push(chunk));
  build.stderr.on("data", (chunk) => buildOut.push(chunk));
  const buildExit = await withTimeout(
    new Promise((resolve) => build.once("exit", (code, signal) => resolve({ code, signal }))),
    300_000,
    "vite build 未在时限内结束",
  );
  if (buildExit.code !== 0) {
    const tail = Buffer.concat(buildOut).toString("utf8").split("\n").slice(-15).join("\n");
    err(
      `vite build 失败（code=${buildExit.code} signal=${buildExit.signal}），输出尾部：\n${tail}`,
    );
    process.exitCode = 1;
    return;
  }
  out("[2/3] 构建成功，校验 packages/web/dist");

  const indexPath = join(distRoot, "index.html");
  if (!(await isFile(indexPath))) {
    throw new Error(`dist/index.html 不存在（${indexPath}），构建产物缺失`);
  }
  const indexHtml = await readFile(indexPath, "utf8");
  assert(
    /(?:src|href)="\/remote\/v4\//.test(indexHtml),
    "index.html 资产引用未带 /remote/v4/ 前缀（--base 未生效）",
  );

  const assets = await collectTextAssets(distRoot, [".js", ".html", ".css"]);
  assert(assets.length > 0, "dist 下没有任何 .js/.html/.css 资产");
  const bodies = await Promise.all(assets.map(async (path) => readFile(path, "utf8")));

  // 正向判别（实测在好/坏构建间翻转）：自建域被烘焙进产物 → redirect 推导取自建域
  assert(
    bodies.some((body) => body.includes(SELF_HOSTED_ORIGIN)),
    `产物未烘焙自建域 ${SELF_HOSTED_ORIGIN}——检查是否漏设 DRORA_ENDPOINT_ORIGIN（spec §8.2 实测注记）`,
  );
  // 反例：官方域 redirect 推导不得出现（完整字面量或内联 env 对象形状）
  const officialHit = assets.findIndex((_, index) => bodies[index].includes(OFFICIAL_REDIRECT));
  assert(officialHit < 0, `${assets[officialHit]} 烘焙了官方域 redirect ${OFFICIAL_REDIRECT}`);
  const bakeShapeHit = assets.findIndex((_, index) => OFFICIAL_BAKE_SHAPE.test(bodies[index]));
  assert(
    bakeShapeHit < 0,
    `${assets[bakeShapeHit]} 的内联 env 仍是官方域（VITE_DRORA_BASE_URL/ENDPOINT_ORIGIN → zcode.z.ai）`,
  );
  out(
    `[3/3] 校验通过：base=/remote/v4/ 前缀生效；${SELF_HOSTED_ORIGIN} 已烘焙；无官方域 redirect 痕迹`,
  );
  out("v4 构建校验通过");
}

try {
  await main();
} catch (failure) {
  err(`verify-v4-build 失败：${failure instanceof Error ? failure.message : String(failure)}`);
  process.exitCode = 1;
}
