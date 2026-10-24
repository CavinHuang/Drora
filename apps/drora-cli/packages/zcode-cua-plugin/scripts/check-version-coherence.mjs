#!/usr/bin/env node
// CUA 版本一致性校验 —— 本仓独立布局适配版（官方 0.6.5 workspace 断言的等价重写）。
//
// 官方依据（2026-10-24 同步）：官方 zcode-cua-plugin 0.6.5 scripts/check-version-coherence.mjs
// 把 producer 收编进官方 mono-repo 后重写为 workspace 断言：全部消费方必须以 workspace:*
// 引用 @zcode/zcode-cua；producer package.json 必须携带 zcodeCuaRuntime Windows Helper
// 发布契约与 ./frame-contract 公开子路径；全部版本记录（wrapper 两处 + producer manifest +
// official-plugin-definitions）以 producer 版本为唯一基准。
//
// 本仓适配（决策记录：specs/cua-standalone-assessment.md「2026-10-24 官方 0.6.5 同步记录」
// 与「2026-10-24 producer 重切段 0.6.5 实施记录」）：本仓是独立仓，不是官方 mono-repo——
// producer 是 packages/zcode-cua 的本地切段占位包（@drora/drora-cua，
// droraCuaPlaceholder=true，fail-closed），版本跟随 upstream 切段（2026-10-24 重切段后
// 冻结 0.6.5，与插件 wrapper 同版）；映射表留作未来版本解耦的显式出口。未来的重切段或
// 插件版本先行仍由映射表与本脚本的占位契约断言守边界，禁止随插件 bump 顺手带走。
//
// 断言（与官方逐条等价）：
//   1. wrapper package.json.version === .zcode-plugin/plugin.json.version（插件版本基准）。
//   2. producer 切段版本 === 映射表[插件版本]（未映射的插件版本回退旧不变量：同版本）；
//      droraCuaPlaceholder 必须 === true（占位 fail-closed 契约，重切段会移除它）。
//   3. producer ./frame-contract 公开子路径（官方 assertFinalRasterFrameContract 的等价；
//      本仓 producer 是平铺 d.ts/js 布局，非官方 dist/ 布局）。
//      官方另断言的 zcodeCuaRuntime Windows Helper 契约在本仓不适用：producer 是占位包、
//      不携带运行时；本地等价物是冻结 Helper 运行时资产（packages/zcode-cua-helper/runtime/
//      cua-helper，还原资产保留原名 @zcode/zcode-cua-helper-runtime，见 specs/drora-rename.md
//      豁免区）版本 === 映射切段版本——保证 Windows Helper 产物与 producer 切段同代。
//   4. 五个 workspace 消费方必须以 workspace:* 引用 @drora/drora-cua（官方消费方断言的
//      等价，包名按 specs/drora-rename.md 改名）；wrapper 自身是冻结 seed，已被
//      pnpm-workspace.yaml 排除，依赖保持 catalog:（见该文件「避免 install 解析其独立
//      catalog: 协议」注释），不在消费方断言之列。
//   5. official-plugin-definitions 的 computer-use version === 插件版本。该文件不在插件组
//      可改路径内（bootstrap 侧维护），其注释已预留「上游 0.6.5 待插件资产同步后再 bump」。
//
// 旧版（git catalog pin 时代）对 pnpm-workspace.yaml/pnpm-lock.yaml/upstream.json/
// .gitlab 字面量的断言随布局退役：本仓 producer 已改为本地 workspace 包，不再有 git pin。
// 旧链路的 bump/baseline/skill-sync 脚本（bump-zcode-cua-producer.mjs、
// check-cua-baseline.mjs、sync-skill-from-zcode-cua.mjs、resolve-pnpm-invocation.mjs）
// 原样保留，不在本脚本职责内。
//
// Usage:
//   node scripts/check-version-coherence.mjs --check   # 只读校验，漂移则非零退出
//   node scripts/check-version-coherence.mjs           # 写回：把 wrapper manifest 与
//                                                      # official-plugin-definitions 对齐到
//                                                      # wrapper package.json 版本（producer
//                                                      # 切段与映射表不可写回——那需要走
//                                                      # specs 的正式重切段决策）

import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../../../..");
const checkOnly = process.argv.includes("--check");

const wrapperPackageJsonPath = resolve(packageRoot, "package.json");
const wrapperManifestPath = resolve(packageRoot, ".zcode-plugin", "plugin.json");
const producerPackageJsonPath = resolve(repoRoot, "packages/zcode-cua/package.json");
const helperRuntimeManifestPath = resolve(
  repoRoot,
  "packages/zcode-cua-helper/runtime/cua-helper/package.json",
);
const officialPluginDefinitionsPath = resolve(
  repoRoot,
  "apps/drora-cli/packages/bootstrap/src/app/official-plugin-definitions.ts",
);

// 插件版本 → producer upstream 切段版本。决策唯一出处：specs/cua-standalone-assessment.md
// 的「2026-10-24 producer 重切段 0.6.5 实施记录」节；改这里之前必须先更新该 spec。
// 2026-10-24 重切段后切段与插件同版（0.6.5），映射表为空；留作未来版本解耦的显式出口
// （例如插件先 bump 而切段未跟随时，在此登记映射并走 specs 决策）。
const PRODUCER_SLICE_BY_PLUGIN_VERSION = Object.freeze({});
// 未映射的插件版本回退旧不变量：切段与插件同版（0.6.3 及之前两版、0.6.5 起始终同版）。
const expectedSliceFor = (pluginVersion) =>
  PRODUCER_SLICE_BY_PLUGIN_VERSION[pluginVersion] ?? pluginVersion;

// workspace 消费方（官方 0.6.5 消费方名单的改名等价：desktop/services/node-repl-host/
// core/adapters；官方另有 wrapper 自身，本仓 wrapper 是冻结 seed，见上）。
const consumerPackageJsonPaths = [
  "packages/desktop/package.json",
  "packages/services/package.json",
  "apps/drora-cli/packages/node-repl-host/package.json",
  "apps/drora-cli/packages/core/package.json",
  "apps/drora-cli/packages/adapters/package.json",
].map((path) => resolve(repoRoot, path));
const PRODUCER_PACKAGE_NAME = "@drora/drora-cua";
const WORKSPACE_PROTOCOL = "workspace:*";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

// 官方 0.6.5 同款正则：official-plugin-definitions 里 computer-use 记录的 version 字段。
function readOfficialPluginVersion(source) {
  const block = source.match(/name:\s*"computer-use"[\s\S]*?version:\s*"([^"]+)"[\s\S]*?\n\s*\},/u);
  return block?.[1] ?? null;
}

// ─── 读取全部记录 ───

const wrapperPackageJson = await readJson(wrapperPackageJsonPath);
const wrapperManifest = await readJson(wrapperManifestPath);
const pluginVersion = wrapperPackageJson.version;
const expectedSlice = expectedSliceFor(pluginVersion);

// fatal 布局断言（两种模式都硬失败；与官方 assert* 契约等价）。
const producerPackageJson = await readJson(producerPackageJsonPath);
if (producerPackageJson.name !== PRODUCER_PACKAGE_NAME) {
  console.error(
    `[cua-version] producer 包名漂移：${producerPackageJson.name ?? "<missing>"}（expected ${PRODUCER_PACKAGE_NAME}，specs/drora-rename.md 改名）`,
  );
  process.exit(1);
}
if (producerPackageJson.droraCuaPlaceholder !== true) {
  // 占位 fail-closed 契约：本仓 producer 每个 runtime 面都不可用并 fail-closed
  // （见 packages/zcode-cua/package.json description）。该标志消失说明发生了重切段，
  // 必须先在 specs 立决策并同步本脚本，不允许静默换入真实运行时。
  console.error(
    "[cua-version] producer 丢失 droraCuaPlaceholder 占位契约——疑似发生未立项的重切段；" +
      "先在 specs/cua-standalone-assessment.md 立决策，再同步本脚本断言",
  );
  process.exit(1);
}

// 官方 assertFinalRasterFrameContract 等价（本仓平铺布局：./frame-contract.d.ts / .js）。
// 根因（沿袭官方注释）：semver 更高的旧主线可能不含最终栅格契约，版本号相等不代表
// 实现存在；必须验证不可伪装的公开子路径。
const frameContract = producerPackageJson.exports?.["./frame-contract"];
if (
  frameContract?.types !== "./frame-contract.d.ts" ||
  frameContract?.import !== "./frame-contract.js"
) {
  console.error("[cua-version] producer 缺失 ./frame-contract 公开子路径契约");
  process.exit(1);
}

// 官方 zcodeCuaRuntime Windows Helper 契约的本仓等价：冻结 Helper 运行时资产与
// producer 切段同代（还原资产名保留 @zcode/zcode-cua-helper-runtime，改名豁免）。
const helperRuntimeManifest = await readJson(helperRuntimeManifestPath);
if (helperRuntimeManifest.name !== "@zcode/zcode-cua-helper-runtime") {
  console.error(
    `[cua-version] 冻结 Helper 运行时资产名漂移：${helperRuntimeManifest.name ?? "<missing>"}` +
      "（expected @zcode/zcode-cua-helper-runtime，还原资产保留原名）",
  );
  process.exit(1);
}

// 消费方断言（官方 0.6.5：消费方必须引用 workspace 内 producer）。
const nonWorkspaceConsumers = [];
for (const path of consumerPackageJsonPaths) {
  const spec = (await readJson(path)).dependencies?.[PRODUCER_PACKAGE_NAME];
  if (spec !== WORKSPACE_PROTOCOL) {
    nonWorkspaceConsumers.push(
      `${relative(repoRoot, path)} ${PRODUCER_PACKAGE_NAME}: ${spec ?? "<未声明>"} (expected ${WORKSPACE_PROTOCOL})`,
    );
  }
}
if (nonWorkspaceConsumers.length > 0) {
  console.error("[cua-version] 消费方必须以 workspace:* 引用本仓 producer：");
  for (const line of nonWorkspaceConsumers) console.error(`  ${line}`);
  process.exit(1);
}

// ─── 版本记录核对 ───

const officialPluginDefinitions = await readFile(officialPluginDefinitionsPath, "utf8");
const records = {
  "wrapper .zcode-plugin/plugin.json.version": wrapperManifest.version,
  "producer packages/zcode-cua 切段版本": producerPackageJson.version,
  "冻结 Helper 运行时资产版本": helperRuntimeManifest.version,
  "official-plugin-definitions computer-use.version": readOfficialPluginVersion(
    officialPluginDefinitions,
  ),
};
// 每条记录对照各自的期望值：wrapper 记录对照插件版本，切段/Helper 资产对照映射切段。
const expectations = {
  "wrapper .zcode-plugin/plugin.json.version": pluginVersion,
  "producer packages/zcode-cua 切段版本": expectedSlice,
  "冻结 Helper 运行时资产版本": expectedSlice,
  "official-plugin-definitions computer-use.version": pluginVersion,
};
const drifted = Object.entries(records).filter(([where, version]) => version !== expectations[where]);

if (drifted.length === 0) {
  console.log(
    `[cua-version] 一致：插件 = ${pluginVersion}，producer 切段 = ${expectedSlice}（映射表解耦）`,
  );
  process.exit(0);
}

// 重切段特判：producer 版本被直接顶到插件版本但映射表仍指向旧切段时，给出指向决策的
// 显式错误，而不是泛泛的漂移文案。
if (
  producerPackageJson.version === pluginVersion &&
  expectedSlice !== pluginVersion
) {
  console.error(
    `[cua-version] producer 切段被 bump 到 ${pluginVersion}，但映射表仍要求 ${expectedSlice}——` +
      "重切段必须先在 specs/cua-standalone-assessment.md 立决策并更新映射表，禁止随插件 bump 顺手升级",
  );
  process.exit(1);
}

if (checkOnly) {
  console.error(
    `[cua-version] 版本漂移（插件基准 = wrapper package.json ${pluginVersion}，` +
      `producer 切段基准 = 映射表 ${expectedSlice}）：`,
  );
  for (const [where, version] of drifted) {
    console.error(`  ${where}: ${version} (expected ${expectations[where]})`);
  }
  console.error(
    "修复：node apps/drora-cli/packages/zcode-cua-plugin/scripts/check-version-coherence.mjs" +
      "（写回 wrapper manifest 与 official-plugin-definitions）；producer 切段升级须先走 specs 决策",
  );
  process.exit(1);
}

// 写回模式：只对齐 wrapper manifest 与 official-plugin-definitions 到插件基准版本。
// producer 切段 / 冻结 Helper 资产 / 映射表不可写回——它们表达 upstream 切段事实，
// 改动必须走 specs 正式决策（见文件头）。
async function writeVersionField(path, version) {
  const parsed = await readJson(path);
  if (parsed.version === version) return false;
  parsed.version = version;
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return true;
}

const wrote = [];
const writableDrift = drifted.filter(([where]) =>
  where === "wrapper .zcode-plugin/plugin.json.version" ||
  where === "official-plugin-definitions computer-use.version",
);
for (const [where] of writableDrift) {
  if (where === "wrapper .zcode-plugin/plugin.json.version") {
    if (await writeVersionField(wrapperManifestPath, pluginVersion)) {
      wrote.push(".zcode-plugin/plugin.json");
    }
    continue;
  }
  const officialVersionPattern =
    /(name:\s*"computer-use"[\s\S]*?version:\s*")([^"]+)("[\s\S]*?\n\s*\},)/u;
  if (!officialVersionPattern.test(officialPluginDefinitions)) {
    throw new Error("[cua-version] 未找到 official-plugin-definitions 中的 computer-use version");
  }
  const updated = officialPluginDefinitions.replace(officialVersionPattern, `$1${pluginVersion}$3`);
  if (updated !== officialPluginDefinitions) {
    await writeFile(officialPluginDefinitionsPath, updated);
    wrote.push("official-plugin-definitions.ts");
  }
}
const unwritable = drifted.filter(
  ([where]) => !writableDrift.some(([w]) => w === where),
);
if (unwritable.length > 0) {
  console.error("[cua-version] 以下漂移不可写回（须走 specs 正式决策后再改）：");
  for (const [where, version] of unwritable) {
    console.error(`  ${where}: ${version} (expected ${expectations[where]})`);
  }
  process.exit(1);
}
console.log(
  `[cua-version] 已把版本记录对齐到 ${pluginVersion}（写回：${wrote.join(", ") || "无变更"}）`,
);
