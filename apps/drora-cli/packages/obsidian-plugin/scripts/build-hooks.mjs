import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const packageRoot = resolve(import.meta.dirname, "..");
const hooksOutDir = resolve(packageRoot, "dist", "hooks");

// hook 脚本打成自包含单文件（.mjs）：seed 的 requiredSeedPaths 只需引用两个产物，
// 不必携带整个 dist/lib。官方插件 seed 时由 official-plugin-runtime 把
// `command:"node"` 重写为 __drora-plugin-hook 宿主启动；开发态保持 node 直跑。
await build({
  bundle: true,
  entryPoints: [
    resolve(packageRoot, "src", "hooks", "session-start.ts"),
    resolve(packageRoot, "src", "hooks", "permission-request.ts"),
    resolve(packageRoot, "src", "hooks", "user-prompt-submit.ts"),
  ],
  format: "esm",
  legalComments: "none",
  outdir: hooksOutDir,
  outExtension: { ".js": ".mjs" },
  platform: "node",
  target: "node24",
});

await chmod(resolve(hooksOutDir, "session-start.mjs"), 0o755);
await chmod(resolve(hooksOutDir, "permission-request.mjs"), 0o755);
await chmod(resolve(hooksOutDir, "user-prompt-submit.mjs"), 0o755);
