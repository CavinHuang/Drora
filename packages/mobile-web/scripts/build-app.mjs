import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const { version } = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const output = join(packageRoot, ".vite-out");
await new Promise((done, reject) => {
  const child = spawn(process.execPath, [join(repoRoot, "node_modules/vite/bin/vite.js"), "build", "--mode", "production", "--base", `/remote/v4/${version}/`, "--outDir", output, "--emptyOutDir"], {
    cwd: join(repoRoot, "packages/web"), stdio: "inherit", env: { ...process.env, DRORA_REMOTE_FRONTEND_VERSION: version },
  });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? done() : reject(new Error(`Canonical remote UI build exited ${code}`)));
});
const dist = join(packageRoot, "dist");
await rm(dist, { recursive: true, force: true });
const versionRoot = join(dist, "remote/v4", version);
await mkdir(versionRoot, { recursive: true });
await cp(output, versionRoot, { recursive: true, filter: source => !source.endsWith(".map") });
await cp(join(output, "index.html"), join(dist, "remote/v4/index.html"));
await rm(output, { recursive: true, force: true });
console.log(`[mobile-web] canonical @drora/web ${version} staged at ${dist}`);
