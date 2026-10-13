import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// CLI 保留各包原生 runner；根 Vitest 的 discovery 不覆盖这些套件。
// 任何失败都会令入口失败，已知上游失败仅记录在迁移证据中，不作自动豁免。
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, process.env.DRORA_CLI_TEST_OUTPUT ?? ".drora-cli-test-results");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const discovery = spawnSync(
  pnpm,
  ["--filter", "./apps/drora-cli/packages/*", "list", "--depth", "-1", "--json"],
  { cwd: root, encoding: "utf8", shell: process.platform === "win32" },
);
if (discovery.status !== 0) throw new Error(discovery.stderr || "CLI workspace discovery failed");
const packages = JSON.parse(discovery.stdout);
await mkdir(output, { recursive: true });
const results = [];
for (const pkg of packages) {
  const manifest = JSON.parse(await readFile(resolve(pkg.path, "package.json"), "utf8"));
  if (!manifest.scripts?.test) continue;
  const selected = process.argv.slice(2);
  if (selected.length && !selected.includes(pkg.name)) continue;
  const started = Date.now();
  process.stdout.write(`Testing ${pkg.name}\n`);
  let log = "";
  const child = spawn(pnpm, ["--filter", pkg.name, "test"], {
    cwd: root,
    env: process.env,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const exit = await new Promise((resolveExit, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const filename = `${pkg.name.replace(/[^a-zA-Z0-9.-]/g, "_")}.log`;
  await writeFile(resolve(output, filename), log);
  results.push({
    package: pkg.name,
    command: manifest.scripts.test,
    ...exit,
    durationMs: Date.now() - started,
    log: filename,
  });
  await writeFile(resolve(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`${pkg.name}: ${exit.signal ?? exit.code}\n`);
}
if (!results.length) throw new Error("No CLI package test scripts selected");
process.exitCode = results.some((result) => result.code !== 0 || result.signal) ? 1 : 0;
